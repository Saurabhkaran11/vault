# Deployment, scale, and security

Written for the actual situation: **one user now, possibly many later.** So
it is ordered by *when a thing becomes necessary*, not by how important it
sounds. Doing the multi-user work today would be wasted; doing it the day
after someone else signs up is too late.

- [Stage 1 — deploy it (free)](#stage-1--deploy-it-free)
- [Stage 2 — before anyone else uses it](#stage-2--before-anyone-else-uses-it)
- [Stage 3 — when you outgrow free](#stage-3--when-you-outgrow-free)
- [Security: what is already handled](#security-what-is-already-handled)
- [Security: what is not](#security-what-is-not)
- [What breaks first as it grows](#what-breaks-first-as-it-grows)

---

## Stage 1 — deploy it (free)

Everything here has a free tier that comfortably fits one person.

| Piece | Service | Root directory |
|---|---|---|
| Frontend | Vercel | `frontend` |
| API | Render web service | `backend` |
| Worker | Render background worker | `backend` |
| Database | Neon or Supabase | — |
| Redis | Upstash | — |
| Files | Cloudflare R2 | — |
| Auth | Clerk | — |
| Errors | Sentry | — |

### Order matters

1. **Clerk** — create the app, copy both keys and your instance domain
2. **Database** — create it, then run `CREATE EXTENSION vector;` once
3. **Redis** — copy the `rediss://` URL
4. **R2** — create a bucket, keep public access blocked, copy the S3-compatible
   endpoint and keys
5. **Render (API)** — root `backend`, health check path `/health/ready`, leave
   the Docker command alone (it runs `alembic upgrade head` first)
6. **Render (worker)** — same repo and root, command
   `arq worker.tasks.WorkerSettings`, same `DATABASE_URL` and `REDIS_URL`
7. **Vercel** — root `frontend`; set the variables **before** the first build
8. **Back to Render** — set `CORS_ORIGINS` to the Vercel URL and redeploy

### Variables

```bash
# Render — API and worker
DATABASE_URL=postgresql+asyncpg://…      # note the +asyncpg
REDIS_URL=rediss://…
AUTH_MODE=jwt
JWT_ISSUER=https://your-app.clerk.accounts.dev
JWT_JWKS_URL=https://your-app.clerk.accounts.dev/.well-known/jwks.json
CORS_ORIGINS=https://your-app.vercel.app
S3_BUCKET=vault-files
S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
EMBEDDINGS_URL=…                          # local Ollama is NOT reachable from Render
SENTRY_DSN=…
SENTRY_ENVIRONMENT=production
```

```bash
# Vercel — must be set BEFORE the first build; NEXT_PUBLIC_* is baked in
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…
CLERK_SECRET_KEY=sk_…
NEXT_PUBLIC_API_URL=https://your-api.onrender.com
```

### Verify

```bash
curl https://your-api.onrender.com/health/ready     # both checks "ok"
```

Then sign in, add a note, hard-refresh, and confirm it survives. That single
check exercises auth, the database, the mirror and the read path at once.

### Expect

- The free API **sleeps after ~15 minutes idle**; the next request takes 30s+
- Free Postgres **pauses after about a week** of no traffic
- Migrations run automatically on deploy — no manual step

---

## Stage 2 — before anyone else uses it

The day a second person's data is in there, these stop being optional.

### Operational

- **Backups run daily in CI** via `.github/workflows/backup.yml`. It dumps
  the database, immediately restores that dump into a throwaway Postgres and
  asserts the tables (so only a dump that actually loads is kept), and stores
  it as a 30-day GitHub artifact — no S3 account required. To turn it on, add
  one repository secret, `NEON_DATABASE_URL`, in the **libpq** form
  (`postgresql://…?sslmode=require`, not `postgresql+asyncpg://`). Until the
  secret exists, scheduled runs no-op instead of failing nightly.
- **For longer retention**, `backend/scripts/backup.sh` also uploads to S3
  when `BACKUP_BUCKET` + AWS creds are set; pair it with an S3 lifecycle rule.
- **Uptime check on `/health/ready`** — free via UptimeRobot.
- **Watch the worker.** If it dies, indexing silently stops and nothing says
  so. A stale-job alert or a heartbeat is enough.
- **Confirm Sentry fires** by triggering one deliberate error.

### Legal and privacy

- **Privacy policy and terms.** You are storing other people's notes and
  finances. This is a legal requirement in most jurisdictions, not polish.
- **Account export and delete.** There is no endpoint for either — the
  frontend can export its own localStorage, but there is no way to hand
  someone everything you hold or to erase them. Both are GDPR rights and both
  need building.
- **Say where data lives.** Region matters to some users; pick one and
  document it.

### Technical

- **Per-user primary keys.** Every table except items keys on the frontend's
  own id. UUIDs make a collision practically impossible and the API refuses
  cross-account ids with a 409, so this is contained — but it is the right
  normalisation before real multi-tenancy.
- **Frontend tests.** Vitest + React Testing Library cover the core logic
  and flows, run in CI (`.github/workflows/frontend.yml`). Grow coverage as
  features land.

---

## Stage 3 — when you outgrow free

Move when cold starts become embarrassing or the database gets close to its
free ceiling — not before.

| Piece | AWS |
|---|---|
| API + worker | App Runner (simplest) or ECS Fargate — one image, two commands |
| Database | RDS Postgres 16, `CREATE EXTENSION vector` |
| Redis | ElastiCache |
| Files | S3 (drop `S3_ENDPOINT_URL`; the rest is unchanged) |
| Frontend | Keep it on Vercel — there is little upside to moving it |
| Secrets | Secrets Manager, not the task definition |
| Registry | ECR, or keep ghcr.io |

**Do not rebuild per environment.** Build the image once, tag it with the git
SHA, and promote that exact artifact. Rebuilding means you tested a different
artifact than you shipped.

On AWS, drop the access keys entirely and give the task an IAM role — the
code already prefers ambient credentials.

### Migrations at scale

Containers run `alembic upgrade head` on start, so during a rolling deploy the
**old code briefly runs against the new schema**. Schema changes therefore need
to be backward compatible in stages:

1. Add the new column as nullable; write both, read the old
2. Backfill; switch reads to the new
3. Drop the old

Renaming a column in one release takes production down for the length of the
roll. `alembic` has no automatic rollback — the backup is the safety net,
which is why the restore check matters.

---

## Security: what is already handled

Worth knowing so you do not redo it:

- **Real token verification** — signature, issuer, audience and expiry against
  the provider's JWKS. Forged and expired tokens are rejected, and the old
  `X-User-Id` header buys nothing in `jwt` mode.
- **An unauthenticated deploy is impossible by construction** — the API
  refuses to boot in dev auth mode once `CORS_ORIGINS` names a public origin.
  A CI job asserts that guard still holds.
- **Tenant isolation is tested per feature**, including that AI search never
  retrieves another account's items and that scoping a question to someone
  else's document id returns nothing.
- **Errors leak nothing** — 500s carry only a request id; bodies, headers,
  query strings and stack-frame locals are all scrubbed before reaching
  Sentry.
- **Files are private** — the bucket blocks public access and everything goes
  through presigned URLs that expire in 15 minutes, with ownership checked
  before signing.
- **Rate limiting** per identity, and a request body cap.
- **Money is exact** — integer cents end to end.

## Security: what is not

- **No account export or delete** (above)
- **Production Clerk domain in the CSP.** The frontend ships a CSP + security
  headers (`next.config.mjs`); it allows Clerk *development* instances
  (`*.clerk.accounts.dev`). A production Clerk instance on a custom domain
  must add its `clerk.<domain>` to `script-src`/`frame-src` there.
- **No audit log** — the `events` table is a delivery outbox, not a record of
  who did what. Fine for one user; expected once there are several.
- **No secret rotation** — keys live in host environment variables with no
  rotation story
- **No abuse controls beyond rate limiting** — no signup throttling, no
  storage quota per account. A free-signup product needs both.

---

## What breaks first as it grows

In the order you will actually hit them:

1. **Cold starts** — the free tier sleeping. Fixed by paying (~$7/month).
2. **One worker** — embedding and extraction queue behind each other. Fixed by
   running more worker instances; the queue already supports it.
3. **`/files/download-url` scans every file row** for the caller on each
   download to check ownership. Fine at hundreds, wasteful at tens of
   thousands. Fixed by indexing the storage key.
4. **Search filtering loads all rows** when `q` or `tag` is used — pagination
   protects the response, not the memory. Fixed by moving the filter into SQL.
5. **Connection limits** — serverless Postgres caps connections hard; use the
   pooled connection string before adding API replicas.
6. **Embedding cost and latency** — every item and every document chunk is
   embedded. Batching and caching by content hash both help.

None of these are urgent for one user. All of them are cheap to fix when the
number they depend on actually gets large — and knowing the order means you
fix the one that is actually hurting rather than guessing.

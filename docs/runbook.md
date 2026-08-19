# Vault runbook — from a fresh clone to production

Every step, in the order it has to happen. Steps marked **(you)** need an
account or a credential only you can create; everything else is a command.

- [1. Run it locally](#1-run-it-locally)
- [2. Turn on sign-in](#2-turn-on-sign-in-clerk)
- [3. Turn on file storage](#3-turn-on-file-storage-s3)
- [4. Set up backups](#4-set-up-backups)
- [5. Deploy](#5-deploy)
- [6. Pre-launch checklist](#6-pre-launch-checklist)

---

## 1. Run it locally

### 1.1 Prerequisites

| Tool | Why | Check |
|---|---|---|
| Docker Desktop | Postgres + Redis | `docker ps` |
| Node 20+ | frontend | `node --version` |
| Python 3.12 + [uv](https://docs.astral.sh/uv/) | backend | `uv --version` |

### 1.2 Backend

```bash
cd backend
docker compose up -d db redis
uv venv --python 3.12 .venv
uv pip install -r requirements.txt -r requirements-dev.txt
VIRTUAL_ENV=.venv uv run alembic upgrade head
```

That migration is **not optional** — the API deliberately refuses to boot
against an unmigrated database rather than improvising a schema. If you skip
it you get a clear `Database has no Alembic revision` error.

Then, in three terminals:

```bash
.venv/bin/uvicorn app.main:app --reload --port 8100
```

```bash
.venv/bin/arq worker.tasks.WorkerSettings
```

The worker builds the AI search index and drains the events outbox. The app
works without it; Ask-your-Vault just won't find anything new.

Confirm it's alive:

```bash
curl localhost:8100/health/ready
# {"ok":true,"checks":{"database":"ok","redis":"ok"}}
```

> **Port 8100, not 8000.** Compose defaults to 8000; this project uses 8100
> in development because 8000 is often taken. If you change it, change the
> URL in Settings → Backend sync too.

### 1.3 Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:3100
```

### 1.4 Connect the two

In the app: **avatar → Settings → ☁ BACKEND SYNC**

1. URL `http://localhost:8100`, User ID anything (e.g. `me`)
2. **Enable sync**

Enabling asks the server what it already holds. On the browser that owns the
vault it uploads; on a new device it restores instead — so a fresh device
can't overwrite your real vault with its sample data.

### 1.5 Run the tests

```bash
cd backend && VIRTUAL_ENV=.venv uv run pytest -q     # 46 passing
```

---

## 2. Turn on sign-in (Clerk)

Until this is done, identity is the `X-User-Id` header — a string anyone
could type. The backend **refuses to start** in that mode once it's serving a
public origin, so this is mandatory before deploying, not optional polish.

Frontend and backend must change **together**. Doing one leaves you worse off
than doing neither.

### 2.1 Create the Clerk application **(you)**

1. Go to [dashboard.clerk.com](https://dashboard.clerk.com) → create an application
2. Choose your sign-in methods (email, Google, whatever you want)
3. **API keys** → copy the **Publishable key** (`pk_…`) and **Secret key** (`sk_…`)
4. Note your instance domain — it looks like `your-app-12.clerk.accounts.dev`
   and appears on the API keys page

### 2.2 Frontend

Create `frontend/.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Restart `npm run dev`. You'll now get a sign-in screen.

### 2.3 Backend

```bash
AUTH_MODE=jwt
JWT_ISSUER=https://your-app-12.clerk.accounts.dev
JWT_JWKS_URL=https://your-app-12.clerk.accounts.dev/.well-known/jwks.json
```

Restart the API. It now rejects any request without a valid token.

### 2.4 Move your existing data **(you)**

Your user id changes from whatever you typed to a Clerk id like `user_2abc…`,
so previously synced rows are still attached to the old string.

**Easiest** — sign in, then Settings → Backend sync → **Sync everything
again**. This pushes the browser's copy up under the new identity.

**Or** re-point the rows once:

```sql
UPDATE items       SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE tasks       SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE boards      SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE expenses    SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE bills       SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE incomes     SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE pay_methods SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE budgets     SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE goals       SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE custom_tags SET user_id = 'user_2abc...' WHERE user_id = 'me';
UPDATE embeddings  SET user_id = 'user_2abc...' WHERE user_id = 'me';
```

Find your Clerk id in the Clerk dashboard under **Users**.

Full detail: [docs/auth.md](auth.md).

---

## 3. Turn on file storage (S3)

Without this, uploaded document *bytes* stay in the browser that saved them.
A document restored on another device shows its name and size but can't be
opened. The app is honest about this rather than showing a broken viewer.

### 3.1 Create the bucket **(you)**

```bash
aws s3 mb s3://vault-user-files --region us-east-1
aws s3api put-public-access-block --bucket vault-user-files \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

**Keep it private.** All access is via presigned URLs that expire in 15
minutes. A public bucket would make every user's files world-readable.

CORS on the bucket, so browsers can upload directly:

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedOrigins": ["https://your-domain.com"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

### 3.2 Backend

```bash
S3_BUCKET=vault-user-files
S3_REGION=us-east-1
# On AWS, omit the keys and use the task/instance role instead.
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Verify: `curl localhost:8100/files/status` → `{"enabled":true}`

---

## 4. Set up backups

```bash
cd backend
DATABASE_URL=postgresql://user:pass@host:5432/vault \
BACKUP_BUCKET=vault-backups \
./scripts/backup.sh
```

**`pg_dump` must match your server's major version.** It refuses to dump a
newer server, which is how backup jobs silently stop working after a database
upgrade. The script checks and tells you; run it in a matching container:

```bash
docker run --rm -e DATABASE_URL -e BACKUP_BUCKET -v $PWD:/w -w /w postgres:16 bash scripts/backup.sh
```

### Then prove it restores

```bash
DATABASE_URL=... BACKUP_BUCKET=vault-backups ./scripts/restore-check.sh
```

This restores the newest dump into a throwaway database and asserts the
tables, rows and schema revision. **Schedule it.** The failure that hurts
isn't "we had no backups", it's "the backups were never going to restore" —
and you find out on the day you need one.

| Job | Frequency |
|---|---|
| `backup.sh` | daily |
| `restore-check.sh` | weekly |
| RDS automated snapshots | leave on — independent of these scripts |

More: [docs/operations.md](operations.md).

---

## 5. Deploy

### 5.1 Railway first (recommended)

Shake out configuration on something cheap before committing to AWS. Same
containers, far less setup.

1. New project → deploy from your GitHub repo
2. Add **PostgreSQL** and **Redis** plugins
3. Backend service: root directory `backend`, and set the variables below
4. Frontend service: root directory `frontend`
5. Point `CORS_ORIGINS` at the frontend's URL, and the frontend's backend URL
   at the API

Postgres needs pgvector. On Railway use the `pgvector/pgvector:pg16` image
rather than the stock plugin, or run `CREATE EXTENSION vector` once.

### 5.2 AWS

| Piece | Service | Notes |
|---|---|---|
| API + worker | App Runner or ECS Fargate | two services from one image, different commands |
| Database | RDS Postgres 16 | enable pgvector: `CREATE EXTENSION vector` |
| Cache/queue | ElastiCache Redis | |
| Files | S3 | private, presigned access only |
| Frontend | Amplify or Vercel | it's a standard Next.js app |
| Secrets | Secrets Manager / SSM | never in the task definition |

Migrations run before the API starts — the Dockerfile's `CMD` does
`alembic upgrade head && uvicorn …`, and compose runs a dedicated one-shot
`migrate` service. On ECS, prefer a separate migration task so two API
replicas never race.

**Health checks:**
- Load balancer target group → `/health/ready`
- Container liveness → `/health/live` (dependency-free on purpose, so a
  database blip can't get healthy processes killed)

### 5.3 Production environment variables

```bash
DATABASE_URL=postgresql+asyncpg://user:pass@rds-host:5432/vault
REDIS_URL=redis://elasticache-host:6379
CORS_ORIGINS=https://your-domain.com

AUTH_MODE=jwt
JWT_ISSUER=https://your-app-12.clerk.accounts.dev
JWT_JWKS_URL=https://your-app-12.clerk.accounts.dev/.well-known/jwks.json

S3_BUCKET=vault-user-files
S3_REGION=us-east-1

RATE_LIMIT_PER_MINUTE=300
LOG_LEVEL=INFO
```

Note the `+asyncpg` in `DATABASE_URL` for the app — the backup scripts strip
it automatically, since `pg_dump` doesn't understand it.

---

## 6. Pre-launch checklist

- [ ] `AUTH_MODE=jwt` and sign-in works end to end
- [ ] `CORS_ORIGINS` lists your real domain, nothing else
- [ ] The API starts — if it refuses, it's telling you auth isn't configured for a public origin
- [ ] `curl https://api.your-domain.com/health/ready` → both checks `ok`
- [ ] S3 bucket private, CORS set, `/files/status` → `enabled: true`
- [ ] A backup has been taken **and `restore-check.sh` passed**
- [ ] Backup + restore-check scheduled
- [ ] Secrets in a secret store, not env files in the repo
- [ ] `npm audit` clean in `frontend/`
- [ ] Log aggregation collecting stdout (JSON, one object per line)
- [ ] Error tracking (Sentry) — **not yet wired; see below**

### Known gaps

| Gap | Impact | When it matters |
|---|---|---|
| No error tracking | You learn about 500s from users, not alerts | Before real traffic |
| Whole-vault sync, not per-record merge | Two devices editing simultaneously: last writer wins on the whole record | Multi-device users |
| Global string primary keys | Two accounts *could* collide on a row id | Mitigated — ids are UUIDv4, and a collision 409s rather than leaking |
| AI keys in the browser | An extension or XSS could read the user's own key | Before offering AI to non-technical users |
| No per-user usage limits | One heavy account can consume shared capacity | At scale |

None of these block launch. The first is the one I'd close soonest.

---

## Troubleshooting

**`Database has no Alembic revision`** — run `alembic upgrade head`. Working
as designed: the app won't invent a schema.

**API won't start, complains about dev auth** — you set a public
`CORS_ORIGINS` while `AUTH_MODE=dev`. That interlock exists so an
unauthenticated backend can't reach the internet. Set `AUTH_MODE=jwt`.

**"Failed to fetch" in the browser** — nearly always CORS. Check the origin
is in `CORS_ORIGINS` exactly, including scheme and port.

**Sync says `Incomplete read`** — the paging loop couldn't get the full set,
usually because `X-Total-Count` isn't reaching the browser. Confirm your
proxy or CDN isn't stripping `Access-Control-Expose-Headers`.

**Ask AI returns nothing** — the worker isn't running, or nothing has been
indexed. Start it, then Settings → Backend sync → Sync everything again.

**`pg_dump: server version mismatch`** — your client is older than the
server. Use the matching `postgres:N` container image.

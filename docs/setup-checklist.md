# Setup checklist — accounts, keys, and where each one goes

Everything that needs *you*: an account to create, a key to copy, a value to
paste. Ordered by how much it matters.

For the surrounding commands (installing, migrating, deploying) see the
[runbook](runbook.md). This page is only the parts I can't do for you.

| # | What | Needed for | Time |
|---|---|---|---|
| 1 | [Embeddings provider](#1-embeddings-provider) | AI search that understands meaning | 5 min |
| 2 | [Clerk](#2-clerk-sign-in) | real sign-in — **required before deploying** | 10 min |
| 3 | [AWS S3](#3-aws-s3-file-storage) | documents that open on every device | 10 min |
| 4 | [Hosting](#4-hosting) | putting it online | 30–60 min |
| 5 | [Error tracking](#5-error-tracking-not-wired-yet) | knowing when it breaks | needs code first |

Backend variables go in `backend/.env` (local) or your host's environment
(production). Frontend variables go in `frontend/.env.local`. Neither file is
committed — `.gitignore` already covers them.

---

## 1. Embeddings provider

**Why first:** it's the cheapest win. "Ask your Vault" currently matches
shared *words*, not meaning — `"notes about forming better routines"` returns
a system-design course instead of Atomic Habits. The whole pipeline is built
and running; it just has a placeholder embedder behind it.

### ⚠ The dimension has to match

The database column is `vector(768)` and **rejects any other size**. Pick a
768-dimension model, or you'll need a migration.

### Option A — Ollama, local and free *(recommended)*

Nothing leaves your machine, and `nomic-embed-text` is natively 768.

1. Install: <https://ollama.com/download>
2. Pull the model: `ollama pull nomic-embed-text`
   (model card: <https://ollama.com/library/nomic-embed-text>)
3. Backend `.env`:

```bash
EMBEDDINGS_URL=http://localhost:11434/v1
EMBEDDINGS_MODEL=nomic-embed-text
# EMBEDDING_DIM stays 768 — no migration needed
```

For a deployed backend, Ollama has to run somewhere the API can reach; on a
single box that's `http://localhost:11434/v1`, otherwise use option B.

### Option B — OpenAI, hosted

1. Create a key: <https://platform.openai.com/api-keys>
2. Backend `.env`:

```bash
EMBEDDINGS_URL=https://api.openai.com/v1
EMBEDDINGS_API_KEY=sk-...
EMBEDDINGS_MODEL=text-embedding-3-small
```

`text-embedding-3-small` is natively 1536, and the code truncates to 768.
That's fine *for this model family* — it's trained so shortened vectors stay
meaningful — but don't assume it holds elsewhere. Ollama's `llama3`, for
instance, returns 4096 dimensions and is **not** trained for truncation, so
chopping it to 768 would quietly produce poor search. Prefer a model that is
natively 768, or change `EMBEDDING_DIM` and migrate.

### After changing it

Re-index, or old items keep their placeholder vectors:

```bash
curl -X POST localhost:8100/ai/reindex -H 'X-User-Id: your-id'
```

**The worker must be running** or nothing gets indexed and nothing warns you:

```bash
cd backend && .venv/bin/arq worker.tasks.WorkerSettings
```

---

## 2. Clerk (sign-in)

**Required before deploying.** Without it, identity is a header anyone could
type — which is why the backend refuses to start in dev mode once it's
serving a public origin.

1. Sign up and create an application: <https://dashboard.clerk.com>
2. Pick your sign-in methods (email, Google, whatever you want)
3. Open **API keys** and copy both keys
4. Note your instance domain on that page — `your-app-12.clerk.accounts.dev`

**Frontend** — `frontend/.env.local`:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

**Backend** — substitute your domain:

```bash
AUTH_MODE=jwt
JWT_ISSUER=https://your-app-12.clerk.accounts.dev
JWT_JWKS_URL=https://your-app-12.clerk.accounts.dev/.well-known/jwks.json
```

Restart both. Change them **together** — the frontend sending tokens to a
backend still in dev mode, or vice versa, is worse than neither.

Your user id changes from whatever you typed to a Clerk id, so existing rows
need moving. Easiest: sign in, then **Settings → Backend sync → Sync
everything again**. The SQL alternative is in [auth.md](auth.md#4-existing-data).

Docs: <https://clerk.com/docs/quickstarts/nextjs>

> Clerk Core 3 (March 2026) changed the control components. This code already
> uses the current API — don't let an older tutorial talk you into
> `<SignedIn>`, which now throws.

---

## 3. AWS S3 (file storage)

Without this, uploaded document *bytes* stay in the browser that saved them:
a document restored on another device shows its name and size but won't open,
and the app says so rather than showing a broken viewer. Turning it on also
lifts the per-file cap from 2 MB to 25 MB, because bytes stop having to fit
in localStorage.

Files saved before you enable it keep working exactly as they do now — the
two storage shapes coexist, so this is a switch, not a migration.

1. Console: <https://console.aws.amazon.com/s3>
2. Create a bucket — **keep "Block all public access" ON**

```bash
aws s3 mb s3://vault-user-files --region us-east-1
```

3. Add CORS so browsers can upload directly (bucket → Permissions → CORS):

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["GET", "PUT", "POST"],
  "AllowedOrigins": ["http://localhost:3100", "https://your-domain.com"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

4. Create an IAM user with access to just this bucket:
   <https://console.aws.amazon.com/iam>

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    "Resource": "arn:aws:s3:::vault-user-files/*"
  }]
}
```

5. Backend `.env`:

```bash
S3_BUCKET=vault-user-files
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

On AWS compute, skip the keys entirely and attach the policy to the task or
instance role.

Check it: `curl localhost:8100/files/status` → `{"enabled":true}`

**Never make the bucket public.** Access is entirely through presigned URLs
that expire in 15 minutes.

---

## 4. Hosting

### Railway first *(recommended)*

Shake out configuration somewhere cheap before committing to AWS.

1. <https://railway.app> → new project from your GitHub repo
2. Add the **Redis** plugin
3. For Postgres, use a custom service with image `pgvector/pgvector:pg16` —
   the stock plugin has no pgvector. Then once: `CREATE EXTENSION vector;`
4. Backend service → root directory `backend`; frontend service → `frontend`
5. Set `CORS_ORIGINS` to the frontend's URL, and point the frontend's backend
   URL at the API

### AWS, when you're ready

| Piece | Service |
|---|---|
| API + worker | App Runner or ECS Fargate — one image, two commands |
| Database | RDS Postgres 16 (`CREATE EXTENSION vector`) |
| Cache/queue | ElastiCache Redis |
| Files | S3 (above) |
| Frontend | Amplify, or <https://vercel.com> |
| Secrets | Secrets Manager — not the task definition |

Load balancer health check → `/health/ready`. Container liveness →
`/health/live`. Full deployment detail in the [runbook](runbook.md#5-deploy).

---

## 5. Error tracking (not wired yet)

**This is the one gap where the code doesn't exist yet.** Right now you'd
learn about a 500 from a user rather than an alert — and five crashes turned
up in a single hour of probing, so this matters more than it sounds.

Signing up won't help on its own; the SDK needs adding to both apps first.
It's about an hour of work — say the word and I'll do it. Then setup is:

1. <https://sentry.io/signup/> → create two projects (Python + Next.js)
2. Copy each DSN
3. `SENTRY_DSN=...` (backend), `NEXT_PUBLIC_SENTRY_DSN=...` (frontend)

---

## Order I'd actually do it

1. **Embeddings** — 5 minutes, and immediately makes AI search feel real
2. **Clerk** — the launch blocker
3. **S3** — before anyone relies on documents syncing
4. **Sentry** — ask me to wire it, then 5 minutes of setup
5. **Deploy** — Railway, then AWS

Nothing here blocks using Vault locally today; it already works.

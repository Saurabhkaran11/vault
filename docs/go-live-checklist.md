# Go-live checklist — what's needed from you

The code is done. This is the config that turns every feature on in production.
Fastest path to "full AI live" is **§1 + §2**. Each section says what it unlocks.

Legend: ✅ already set · ⬜ you set it.

---

## 0. What's already configured (don't touch)

On Render (API) these are set and healthy (`/health/ready` → database ok, redis ok):

```
DATABASE_URL   = postgresql+asyncpg://…      # Neon (direct endpoint, ?ssl=require)
REDIS_URL      = rediss://…                   # Upstash
AUTH_MODE      = jwt
JWT_ISSUER     = https://<your-app>.clerk.accounts.dev
JWT_JWKS_URL   = https://<your-app>.clerk.accounts.dev/.well-known/jwks.json
CORS_ORIGINS   = https://<your-app>.vercel.app
```

On Vercel (frontend), set at build time:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = pk_…
CLERK_SECRET_KEY                  = sk_…
NEXT_PUBLIC_API_URL               = https://vault-4h26.onrender.com
```

---

## 1. Turn on the AI (chat + embeddings) — Render → API → Environment

Unlocks: **server-side answers without a browser key**, and **semantic RAG search**.
Any OpenAI-compatible provider works. The app appends `/chat/completions` and
`/embeddings` to the base URLs, and truncates embeddings to 768 dims — so you
never touch `EMBEDDING_DIM`.

**Option A — OpenAI (simplest, one provider for both):**
```
⬜ CHAT_URL          = https://api.openai.com/v1
⬜ CHAT_API_KEY      = sk-…
⬜ CHAT_MODEL        = gpt-4o-mini
⬜ EMBEDDINGS_URL     = https://api.openai.com/v1
⬜ EMBEDDINGS_API_KEY = sk-…                      # same key
⬜ EMBEDDINGS_MODEL   = text-embedding-3-small
```

**Option B — split: Groq for chat (fast, free tier) + OpenAI for embeddings:**
```
⬜ CHAT_URL          = https://api.groq.com/openai/v1
⬜ CHAT_API_KEY      = gsk_…
⬜ CHAT_MODEL        = llama-3.3-70b-versatile
⬜ EMBEDDINGS_URL     = https://api.openai.com/v1
⬜ EMBEDDINGS_API_KEY = sk-…
⬜ EMBEDDINGS_MODEL   = text-embedding-3-small
```

**Option C — fully local/free (uses your AWS credit):** run Ollama on a small
always-on box, `ollama pull nomic-embed-text && ollama pull llama3.3`, expose it,
then point both URLs at `http://<host>:11434/v1` with `EMBEDDINGS_MODEL=nomic-embed-text`
(native 768 — best retrieval quality). No API key needed.

Verify: `curl https://vault-4h26.onrender.com/ai/status` → should read
`{"server_completion": true, "model": "…"}`.

---

## 2. Background worker — Render → New → Background Worker

Unlocks: **automatic indexing, PDF/Word extraction, and the digest jobs.**
(This is the one paid Render instance — Starter is fine.)

- Same repo, same `backend/Dockerfile`, same environment group as the API.
- **Start command / Docker command:** `arq worker.tasks.WorkerSettings`
- After it's live, backfill everything already saved: sign in, then
  `POST /ai/reindex` once (new/edited items index automatically from then on).

---

## 3. File storage (S3 or Cloudflare R2) — Render → API → Environment

Unlocks: **uploaded PDFs/Word files store and get their text extracted.**

**Cloudflare R2 (no egress fees):**
```
⬜ S3_BUCKET            = vault-files
⬜ S3_ENDPOINT_URL      = https://<account-id>.r2.cloudflarestorage.com
⬜ AWS_ACCESS_KEY_ID     = <R2 access key>
⬜ AWS_SECRET_ACCESS_KEY = <R2 secret>
⬜ S3_REGION            = auto
```
Steps: R2 → create bucket `vault-files` → create an API token (Object Read & Write)
→ paste the keys. Keep the bucket **private** (the app serves files via short-lived
presigned URLs).

**AWS S3 instead:** same four keys, `S3_REGION=us-east-1`, and **leave
`S3_ENDPOINT_URL` unset**. On AWS you can drop the access keys and give the
service an IAM role — the code prefers ambient credentials.

---

## 4. Backups (2 min) — GitHub → repo → Settings → Secrets → Actions

Unlocks: the **daily verified-backup workflow** (`.github/workflows/backup.yml`).

```
⬜ NEON_DATABASE_URL = postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```
Note the **libpq** form (`postgresql://`, not `postgresql+asyncpg://`). Until set,
the nightly job no-ops instead of failing.

---

## 5. Error alerts (optional) — Render → API → Environment

```
⬜ SENTRY_DSN         = https://…@…ingest.sentry.io/…
⬜ SENTRY_ENVIRONMENT = production
```
Confirm by triggering one deliberate error; it should appear in Sentry, scrubbed.

---

## 6. Production Clerk (when you have a domain)

Today auth runs on a Clerk **development** instance. For production:

1. Clerk dashboard → create a **Production** instance → add your domain, follow
   the DNS steps.
2. Get the production keys and update **Vercel**:
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = pk_live_…`, `CLERK_SECRET_KEY = sk_live_…`.
3. Update **Render** to the production Clerk domain:
   `JWT_ISSUER = https://clerk.<your-domain>`,
   `JWT_JWKS_URL = https://clerk.<your-domain>/.well-known/jwks.json`.
4. In `frontend/next.config.mjs`, add `https://clerk.<your-domain>` to the CSP
   `script-src` and `frame-src` (the CSP already allows Clerk **dev** domains).

---

## 7. Calendar sync — Phase 1 (when you want live Google sync)

The backend is scaffolded and inert until these are set:

1. Google Cloud → new project → enable **Google Calendar API**.
2. Configure the **OAuth consent screen**; add yourself as a test user.
3. Create an **OAuth 2.0 Client ID → Web application**. Set the authorized
   redirect URI to exactly:
   `https://vault-4h26.onrender.com/calendar/google/callback`
4. Generate a token-encryption key locally:
   `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
5. Set on **Render → API**:
```
⬜ GOOGLE_CLIENT_ID     = ….apps.googleusercontent.com
⬜ GOOGLE_CLIENT_SECRET = …
⬜ GOOGLE_REDIRECT_URI  = https://vault-4h26.onrender.com/calendar/google/callback
⬜ CALENDAR_TOKEN_KEY   = <the Fernet key from step 4>
```
Then tell me and I'll build the "Connect Google" button + the pull (Phase 1).

---

## 8. Verify everything (5 min)

1. `curl https://vault-4h26.onrender.com/health/ready` → `database: ok, redis: ok`.
2. `curl https://vault-4h26.onrender.com/ai/status` → `server_completion: true`.
3. Sign in on the live app, add a note, ask a question in **Ask your Vault** → a
   cited answer (proves auth + DB + embeddings + retrieval).
4. Upload a PDF, wait ~1 min, then ask about its contents → proves storage +
   worker + extraction.
5. Check the **backup** workflow ran (Actions tab) and left an artifact.

Done = every checkbox above is ticked.

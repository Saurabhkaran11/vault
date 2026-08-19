---
name: backend-integration
description: Master skill — how Vault's frontend syncs to the FastAPI backend; sync model, field mappings, verification stack, and the per-feature skill index.
---

# Backend integration — master skill

## Sync model (phase: write-through mirror)

- **localStorage is the working copy** — instant, offline, keeps file bytes.
- When Settings → Backend sync is ENABLED, every mutation also fires a
  **mirror** call to FastAPI via `frontend/lib/api.js` (`mirror(path, opts)`).
  Mirrors are fire-and-forget: UI never blocks; failures land in a durable
  retry queue (`vault.backend.queue.v1`) flushed by `flushQueue()`.
- First-time enable runs `fullSync()` → `POST /sync/import` (the frontend's
  export shape) → `POST /ai/reindex`.
- Auth: `X-User-Id` header (demo seam). Clerk JWTs replace it later —
  only `backend/app/deps.py` and `lib/api.js` headers change.

## Canonical field mappings (frontend ⇄ backend)

| Frontend | Backend |
|---|---|
| item `id` (Date.now number) | `client_id` (string); server has own int `id` |
| item `date` | `added_on` |
| item `deleted` | `deleted_on` |
| item `file` {name,type,size,data} | `file_meta` {name,type,size} — **bytes stay local until S3 phase** |
| expense `pay` | `pay_method_id` |
| expense/income `date` | `spent_on` / `received_on` |
| task `doneAt` / `created` | `done_at` / `created_on` |
| bill `paidOn` | `paid_on` |
| board `current` / sprint `ended` | `current_sprint` / `ended_on` |
| card `sprint` | `sprint_id` |

Upsert rule: string-id entities (tasks, expenses, bills, incomes, goals,
pay methods, boards, cards) use their frontend id as the server primary
key — POST endpoints must be **upserts** (insert or update) so mirrors are
idempotent. Items upsert by `client_id`.

## Dev verification stack

- API for testing runs at **http://localhost:8100** (dev instance; port
  8000 is the compose default and may be held by another app).
  Start: `cd backend && docker compose up -d db redis && .venv/bin/uvicorn app.main:app --port 8100`
- Verify with `curl -H 'X-User-Id: <test-user>'`; inspect Postgres via
  `docker exec backend-db-1 psql -U vault -c '...'`.
- **Do not** start the frontend dev server or drive the browser pane from
  a subagent — the main session owns those. Frontend changes must keep
  behavior identical when `backendOn()` is false.

## Per-feature skills (each owns disjoint files — safe to run in parallel)

| Skill | Frontend files | Backend files |
|---|---|---|
| `items-sync` | `hooks/useStore.js` | `routers/items.py` |
| `todos-sync` | `components/TodoBoard.jsx` | `routers/todos.py` |
| `finance-sync` | `components/FinanceBoard.jsx` | `routers/finance.py` |
| `boards-sync` | `components/CustomBoards.jsx` | `routers/boards.py` |
| `tags-capture-sync` | `lib/tags.js`, `components/QuickCapture.jsx`, `components/App.jsx` (Settings UI), `docs/integration.md` | `routers/tags.py` |

Every skill ends with a **Status log** — append what you did and verified.

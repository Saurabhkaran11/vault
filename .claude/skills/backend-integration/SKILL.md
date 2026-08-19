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

## Status log

- 2026-08-19: **Browser e2e VERIFIED end to end** (user `e2e`, API :8100, fresh DB).
  Fixes that made it pass, all committed on `feat/backend-sync`:
  - `/sync/import` rewritten idempotent + user-scoped: same-user string ids
    update in place (items by `(user, client_id)`, budgets by scope, tags by
    value, boards via snapshot-replace); any id owned by another user → 409
    with the colliding ids and NOTHING written. Curl-proved: double import →
    1 row updated; cross-user → 409 with CORS headers present.
  - `app/main.py`: global exception handler returns JSON 500s inside the
    middleware stack — bare Starlette 500s skip CORSMiddleware and surface
    in browsers as "Failed to fetch", which masked every real error.
  - `lib/api.js` queue semantics: PUT mirrors (whole-board snapshots)
    coalesce per path — only the newest snapshot replays, so a stale
    pre-`ensureKeys` snapshot can't resurrect reminted sprint ids; jobs the
    backend REJECTS (HTTP status) are dropped with a console.warn instead of
    wedging the in-order queue forever (deterministic bodies fail identically
    on every replay); only network failures keep the queue.
  - Seed collisions: fixed ids (`sp1/sb1/se1/pm-cash/…`) randomized at seed
    time in TodoBoard/CustomBoards/FinanceBoard + `seeded` flag; CustomBoards
    `ensureKeys` heals stores that already duplicated `sp1` across boards
    (remint + remap current/card refs).
  - `App.jsx`: `items`/`trashed` are now `useMemo`-stable — the render-fresh
    `.filter()` identity fed effect deps (`[items]`) and looped setPulse
    forever on the dashboard (50+ nested updates, console spam, CPU burn).
  Evidence: full sync imported 18 items · 12 tasks · 15 finance rows · 2
  boards (sb1 upserted over the mirror-created row); retry queue 4 → "3
  mirrored" (stale snapshot coalesced) → 0; live captures landed in
  Postgres (note `1787124193655`, task `nblp135` due parsed from
  "tomorrow", expense `hzwp2yu` $4.50, board card `4gvmvmd` in To do /
  current sprint via debounced snapshot PUT) — plus the user's own two
  resume uploads mirrored live mid-test; worker restart drained queued
  reindex jobs → 20 embeddings; `/ai/ask` returns the minutes-old browser
  note as top pgvector hit (score 0.47). Known pre-launch gap unchanged:
  global string PKs must move to `(user_id, client_id)` before multi-user.

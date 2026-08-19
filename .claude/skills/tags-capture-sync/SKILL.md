---
name: tags-capture-sync
description: Mirror custom tags and Quick-capture writes; build the Settings "Backend sync" UI (enable, full sync, status, retry queue); write docs/integration.md.
---

# Tags + capture sync, Settings UI, integration doc

Owned files: `frontend/lib/tags.js` · `frontend/components/QuickCapture.jsx` ·
`frontend/components/App.jsx` (Settings dialog section ONLY) · `docs/integration.md`.
Read `../backend-integration/SKILL.md` first. Do NOT touch other components.

## Frontend work

1. **tags.js**: in `addCustomTag` → `mirror("/tags?tag="+encodeURIComponent(t), {method:"POST"})`;
   in `removeCustomTag` → `mirror("/tags/"+encodeURIComponent(t), {method:"DELETE"})`.
2. **QuickCapture.jsx**: it writes todos/expenses straight to localStorage —
   after those writes, mirror: todo → `POST /todos` upsert body
   (`done_at:null, created_on: today, due, high, label`); expense →
   `POST /finance/expenses` upsert body (`pay_method_id:null, spent_on`).
   (Items go through onAddItem → useStore, which items-sync mirrors — do
   nothing for items here.)
3. **App.jsx — Settings → new "☁ BACKEND SYNC" section** (place between
   CONNECTED APPS and YOUR DATA):
   - URL input (default http://localhost:8000) + User ID input (default demo)
   - Enable toggle button; on first enable run `fullSync()` (show result
     counts inline), set `syncedAt`
   - Status line: healthy? (`backendHealthy()`), last synced, pending
     retry-queue count (`pendingMirrors()`) + "Retry now" (`flushQueue()`)
   - "Sync everything again" button (re-runs fullSync — WARNING copy: may
     duplicate string-id-less rows; fine pre-launch, note it)
   All state local to the Settings dialog; import from `@/lib/api`.

## docs/integration.md

Document the whole sync architecture for the repo: the write-through
model, retry queue, field mappings table (copy from master skill), how to
run backend + enable sync, current limitations (files metadata-only,
bill-recurrence id divergence offline, single-user header auth), and the
upgrade path (Clerk auth → server-authoritative reads → realtime).

## Verify

curl tags upsert/delete under `qa-tags`; `node --check` on all touched
files; do NOT run the dev server or browser.

## Status log

- 2026-08-18: skill created; work pending.

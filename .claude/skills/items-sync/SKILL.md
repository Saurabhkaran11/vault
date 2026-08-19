---
name: items-sync
description: Sync Vault items (notes/videos/library/documents) between the frontend store and the FastAPI items API — upsert-by-client_id contract, mirroring rules, verification.
---

# Items sync (notes · videos · library · documents)

Owned files: `frontend/hooks/useStore.js` · `backend/app/routers/items.py`.
Read `../backend-integration/SKILL.md` first (mappings, dev stack).

## Backend work

Add an idempotent upsert endpoint (mirrors need retry-safety):

- `POST /items/upsert` — body = ItemIn + required `client_id`. If a row
  with (user_id, client_id) exists → update all fields; else insert.
  Returns ItemOut. Trash/restore/hard-delete by client id:
  `POST /items/by-client/{client_id}/trash` (sets deleted_on),
  `POST /items/by-client/{client_id}/restore`,
  `DELETE /items/by-client/{client_id}`.

## Frontend work (useStore.js)

Import `{ mirror }` from `@/lib/api`. After each local mutation, mirror:

- `add(it)` → `mirror("/items/upsert", {method:"POST", body: toApi(it)})`
- `update(it)` → same upsert call
- `remove(id)` → hard delete by client id
- soft-delete/restore happen via `update` in App.jsx (deleted field) —
  the upsert body must carry `deleted_on` so trash state mirrors too.

`toApi(it)`: client_id=String(it.id), date→added_on, deleted→deleted_on,
file→file_meta (STRIP `data`), drop undefined. Never block or throw into
the UI path; `mirror` already swallows/queues failures.

## Verify (curl, user `qa-items`)

1. upsert insert → GET /items shows it; upsert again with changed title →
   still ONE row, new title.
2. trash by client id → include_deleted lists it with deleted_on; restore
   clears; DELETE removes.
3. `node --check` passes on useStore.js (syntax).

## Status log

- 2026-08-18: skill created; work pending.
- 2026-08-18: implemented. Backend (`routers/items.py`): `ItemUpsert(ItemIn)`
  schema (required `client_id`, adds `deleted_on`), `POST /items/upsert`
  (select by user_id+client_id → update all fields, else insert + emit
  item.created; enqueues embed_item), `POST /items/by-client/{id}/trash`,
  `POST /items/by-client/{id}/restore`, `DELETE /items/by-client/{id}`.
  Frontend (`hooks/useStore.js`): `toApi()` mapping (String(id)→client_id,
  date→added_on, deleted→deleted_on always carried as null|date, file→
  file_meta with `data` stripped, undefined dropped); add/update mirror
  `POST /items/upsert`, remove mirrors `DELETE /items/by-client/{id}` —
  all fire-and-forget via `mirror()`, no-op when sync is off. Verified on
  :8100 as `qa-items`: upsert twice with changed title → ONE row (psql
  count=1, same server id), new title; trash by client id → hidden by
  default, listed with deleted_on under include_deleted; restore clears
  deleted_on; DELETE removes (404 on repeat); trash/restore also proven
  through the upsert `deleted_on` field (App.jsx update path); qa rows
  cleaned up after. `node --check hooks/useStore.js` passes.

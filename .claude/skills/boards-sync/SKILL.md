---
name: boards-sync
description: Mirror Vault custom kanbans (boards/sprints/columns/cards) to the FastAPI boards API via whole-board snapshot upsert — simplest correct sync for nested state.
---

# Boards sync

Owned files: `frontend/components/CustomBoards.jsx` · `backend/app/routers/boards.py`.
Read `../backend-integration/SKILL.md` first.

## Design decision

Boards are deeply nested and mutate in many small ways (drag, rename,
labels, hours, sprint ops). Per-mutation endpoint mirroring would need a
dozen call sites and ordering guarantees. This phase uses **snapshot
upsert**: after any board mutation, mirror the ENTIRE board object to one
idempotent endpoint that replaces its children. Payloads are tiny (a
board is a few KB) and retries are naturally safe.

## Backend work

Add `PUT /boards/{board_id}/snapshot` — body is the FRONTEND board shape:
`{id, name, seq, current, sprints:[{id,name,ended}], cols:[{id,title,cards:[{id,num,sprint,text,desc,hours,labels}]}]}`.
Upsert the board row (create if missing, user-scoped), then replace
children (delete sprints/columns/cards for the board, re-insert in order,
positions = array index; map `current`→current_sprint, `ended`→ended_on,
card `sprint`→sprint_id). Also `DELETE /boards/{board_id}` for board
deletion. Keep existing granular endpoints (they stay valid API surface).

## Frontend work (CustomBoards.jsx)

Import `{ mirror }` from `@/lib/api`. The store already funnels every
mutation through `setStore`/`setBoards`/`patchBoard`. Add ONE effect:

```js
useEffect(() => {
  if (!hydrated) return;
  // mirror each board snapshot (debounced ~800ms) after changes
}, [store, hydrated]);
```
Debounce with a ref timer; on fire, for each board call
`mirror("/boards/"+b.id+"/snapshot", {method:"PUT", body: b})`.
Track deletions: diff previous board ids (ref) vs current; deleted ids →
`mirror("/boards/"+id, {method:"DELETE"})`.

## Verify (curl, user `qa-boards`)

1. PUT snapshot creates board with sprints/cols/cards; GET /boards returns
   equivalent structure (num/hours/labels intact).
2. PUT again with a card moved between columns + a sprint marked ended →
   reflected, no duplicates.
3. DELETE board removes it. `node --check` on CustomBoards.jsx.

## Status log

- 2026-08-18: skill created; work pending.
- 2026-08-18: implemented. Backend: `PUT /boards/{id}/snapshot` (frontend-shaped
  body models defined in the router; board upserted user-scoped, children
  replaced with FK-safe ordering — delete cards→columns→sprints, insert
  sprints→columns→cards, positions = array index; `current`→current_sprint,
  `ended`→ended_on, card `sprint`→sprint_id) and `DELETE /boards/{id}`
  (idempotent — returns `{ok,deleted}` instead of 404 so a retried mirror can
  never wedge the ordered retry queue; child rows deleted leaf-first after an
  ownership check). Frontend: CustomBoards.jsx imports `mirror`, one
  `[store, hydrated]` effect debounces ~800ms (ref timer) then PUTs every
  board's snapshot; deletions diffed via a previous-ids ref → mirror DELETE.
  Verified on :8100 as `qa-boards`: snapshot create → GET equivalent
  (num/hours/labels/desc/sprint_id + positions intact); second snapshot with
  k1 moved Backlog→Doing + Sprint 1 ended/Sprint 2 current, PUT twice → 4
  cards, zero duplicates, ended_on set; foreign-user PUT 404s and foreign
  DELETE no-ops; owner DELETE → GET `[]`, repeat DELETE ok:false-deleted,
  Postgres shows 0 orphan sprint/column/card rows; granular POST /boards +
  add_card still 201. Syntax: `py_compile` passes; CustomBoards.jsx checked
  via Next's SWC JSX transform piped through `node --check` (raw `node
  --check` cannot parse .jsx) — passes.

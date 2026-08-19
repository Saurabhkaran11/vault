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

---
name: todos-sync
description: Mirror Vault to-dos to the FastAPI todos API — idempotent upsert, completion stamps, verification.
---

# To-dos sync

Owned files: `frontend/components/TodoBoard.jsx` · `backend/app/routers/todos.py`.
Read `../backend-integration/SKILL.md` first.

## Backend work

Make `POST /todos` an **upsert** (task id is the primary key): if the id
exists for this user, update every field; else insert. Keep the
`task.completed` event emit on the false→true done transition (it fires in
update path today — preserve that behavior inside the upsert).

## Frontend work (TodoBoard.jsx)

Import `{ mirror }` from `@/lib/api`. Central choke point: `setTasks` is
called from add/toggle/patch/del/clearDone/Resched. Mirror at each
call site (NOT inside setTasks — updater functions must stay pure):

- add → `mirror("/todos", {method:"POST", body: toApi(task)})`
- toggle/patch/reschedule → same upsert with the updated task
- delete / clearDone → `mirror("/todos/"+id, {method:"DELETE"})` per task

`toApi(t)`: {id, text, done, done_at: t.doneAt??null, due: t.due??null,
high, label: t.label??null, created_on: t.created}. Dates are already
ISO `YYYY-MM-DD` strings — pass through; convert undefined→null.

## Verify (curl, user `qa-todos`)

1. POST insert → GET /todos has it; POST same id with done=true +
   done_at → still one row, done=true.
2. agenda buckets reflect due dates.
3. DELETE removes; `node --check` passes on TodoBoard.jsx.

## Status log

- 2026-08-18: skill created; work pending.
- 2026-08-18: DONE. `POST /todos` is now an idempotent upsert keyed on the
  frontend task id (insert if new; update every field if it exists for this
  user; 409 if the id belongs to another user). The `task.completed` emit is
  preserved inside the upsert's update path on the false→true done transition
  — verified it fires exactly once and that replaying the same done=true body
  does not duplicate it. `DELETE /todos/{id}` made idempotent too (missing row
  → `{ok:true}`), so retry-queue replays can't wedge `flushQueue` behind a 404.
  TodoBoard.jsx imports `{ mirror }`, adds module-level `toApi()`, and mirrors
  at every setTasks call site: add → POST upsert; patch (also covers toggle +
  reschedule, which route through it) → POST upsert with the updated task;
  del → DELETE; clearDone → one DELETE per completed task. Updaters stay pure;
  behavior unchanged when backend sync is off. Verified via curl as `qa-todos`
  on :8100: insert → GET shows it; same-id POST with done=true → still 1 row,
  done=true, done_at stamped; agenda buckets correct (overdue/today/upcoming/
  someday, done task excluded); DELETE removes, re-DELETE still 200. Syntax:
  `node --check` cannot parse `.jsx` (ERR_UNKNOWN_FILE_EXTENSION even on the
  pristine file), so the gate run was: Next's bundled SWC parses TodoBoard.jsx
  (jsx:true) → compiled JS → `node --check` passes on that output. QA rows
  cleaned up afterward.

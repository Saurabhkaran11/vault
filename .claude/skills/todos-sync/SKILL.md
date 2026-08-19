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

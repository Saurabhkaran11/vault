from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..pagination import Page, page_params, paginate
from ..events import emit
from ..models import Task
from ..schemas import TaskIn, TaskOut

router = APIRouter(prefix="/todos", tags=["todos"])


@router.get("", response_model=list[TaskOut])
async def list_tasks(response: Response, page: Page = Depends(page_params),
                     session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    stmt = select(Task).where(Task.user_id == user).order_by(Task.created_on.desc(), Task.id)
    return await paginate(session, stmt, page, response)


@router.post("", response_model=TaskOut, status_code=201)
async def upsert_task(body: TaskIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Idempotent upsert keyed on the frontend task id, so fire-and-forget
    mirrors (and retry-queue replays) are safe. Emits `task.completed` on the
    false→true done transition, same as the PUT path."""
    task = await session.get(Task, body.id)
    if task is not None and task.user_id != user:
        raise HTTPException(409, "Task id belongs to another user")
    if task is None:
        task = Task(user_id=user, **body.model_dump())
        session.add(task)
    else:
        was_done = task.done
        for k, v in body.model_dump().items():
            setattr(task, k, v)
        if body.done and not was_done:
            task.done_at = body.done_at or date.today()
            await emit(session, user, "task.completed", {"text": task.text})
    await session.commit()
    return task


@router.put("/{task_id}", response_model=TaskOut)
async def update_task(task_id: str, body: TaskIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    task = await session.get(Task, task_id)
    if not task or task.user_id != user:
        raise HTTPException(404, "Task not found")
    was_done = task.done
    for k, v in body.model_dump().items():
        setattr(task, k, v)
    if body.done and not was_done:
        task.done_at = body.done_at or date.today()
        await emit(session, user, "task.completed", {"text": task.text})
    await session.commit()
    return task


@router.delete("/{task_id}")
async def delete_task(task_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Idempotent like the upsert: deleting an already-gone task is a no-op
    success, so retry-queue replays never wedge behind a 404."""
    task = await session.get(Task, task_id)
    if task is not None and task.user_id == user:
        await session.delete(task)
        await session.commit()
    return {"ok": True}


@router.get("/agenda")
async def agenda(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """The smart-list buckets, computed server-side — one call feeds the
    bell, the day view and (later) the daily digest email."""
    t0 = date.today()
    rows = (await session.execute(select(Task).where(Task.user_id == user, Task.done == False))).scalars().all()  # noqa: E712
    return {
        "overdue": [TaskOut.model_validate(t) for t in rows if t.due and t.due < t0],
        "today": [TaskOut.model_validate(t) for t in rows if t.due == t0],
        "upcoming": [TaskOut.model_validate(t) for t in rows if t.due and t0 < t.due],
        "someday": [TaskOut.model_validate(t) for t in rows if not t.due],
    }

"""Account data lifecycle: export everything we hold, and erase it.

These are the two rights a stored-personal-data product owes its users
(GDPR portability and erasure) and the frontend cannot provide alone — it
only ever sees this browser's localStorage, never the server's copy.

Both operate strictly on the authenticated user's own rows: every table is
scoped by user_id, and the nested board tables are reached through the user's
boards, so nothing outside the account is read or touched.
"""

from datetime import date, datetime

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..models import (
    Bill, Board, BoardColumn, Budget, CalendarAccount, Card, CustomTag,
    Embedding, Event, Expense, Goal, Income, Item, PayMethod, Sprint, Task, User,
)
from ..storage import delete_object, storage_enabled

router = APIRouter(prefix="/account", tags=["account"])

EXPORT_VERSION = 1


def _ser(value):
    """JSON-safe scalar: dates and datetimes to ISO strings, everything else
    (str/int/bool/None/list/dict from JSON columns) is already fine."""
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _rows(objects) -> list[dict]:
    return [
        {c.name: _ser(getattr(o, c.name)) for c in o.__table__.columns}
        for o in objects
    ]


async def _all(session: AsyncSession, model, where):
    return (await session.execute(select(model).where(where))).scalars().all()


@router.get("/export")
async def export_account(
    session: AsyncSession = Depends(get_session),
    user: str = Depends(current_user_id),
):
    """Everything we hold for this account, as one downloadable JSON.

    Embeddings and the event outbox are deliberately excluded: they are
    derived data and internal plumbing, not something the user gave us.
    Uploaded file *bytes* are not inlined — file_meta carries the name, type,
    size and storage key, and the bytes stay downloadable via /files.
    """
    profile = (await session.execute(select(User).where(User.id == user))).scalar_one_or_none()

    boards = await _all(session, Board, Board.user_id == user)
    board_ids = [b.id for b in boards]
    columns = await _all(session, BoardColumn, BoardColumn.board_id.in_(board_ids)) if board_ids else []
    column_ids = [c.id for c in columns]
    sprints = await _all(session, Sprint, Sprint.board_id.in_(board_ids)) if board_ids else []
    cards = await _all(session, Card, Card.column_id.in_(column_ids)) if column_ids else []

    payload = {
        "format": "vault-account-export",
        "version": EXPORT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "user_id": user,
        "profile": (_rows([profile])[0] if profile else None),
        "items": _rows(await _all(session, Item, Item.user_id == user)),
        "tasks": _rows(await _all(session, Task, Task.user_id == user)),
        "boards": _rows(boards),
        "sprints": _rows(sprints),
        "columns": _rows(columns),
        "cards": _rows(cards),
        "pay_methods": _rows(await _all(session, PayMethod, PayMethod.user_id == user)),
        "expenses": _rows(await _all(session, Expense, Expense.user_id == user)),
        "bills": _rows(await _all(session, Bill, Bill.user_id == user)),
        "incomes": _rows(await _all(session, Income, Income.user_id == user)),
        "budgets": _rows(await _all(session, Budget, Budget.user_id == user)),
        "goals": _rows(await _all(session, Goal, Goal.user_id == user)),
        "tags": _rows(await _all(session, CustomTag, CustomTag.user_id == user)),
        # Connected calendars, without the tokens — those are credentials, not
        # the user's own data, and never belong in an export.
        "calendar_accounts": [
            {"id": a.id, "provider": a.provider, "external_email": a.external_email,
             "connected_at": a.created_at.isoformat() if a.created_at else None}
            for a in await _all(session, CalendarAccount, CalendarAccount.user_id == user)
        ],
    }
    counts = {k: len(v) for k, v in payload.items() if isinstance(v, list)}
    payload["counts"] = counts

    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="vault-account-{stamp}.json"'},
    )


@router.delete("")
async def delete_account(
    session: AsyncSession = Depends(get_session),
    user: str = Depends(current_user_id),
):
    """Permanently erase the account and everything in it.

    Order matters: children before parents, because not every foreign key
    cascades from users (items/tasks/finance key on user_id without an
    ON DELETE rule), so deleting the user first would hit a constraint. The
    board family DOES cascade, so deleting the boards takes their sprints,
    columns and cards with them — but we resolve the ids first to purge cards
    explicitly too, keeping the behaviour identical whether or not the
    database enforces the cascade.

    Stored files live outside Postgres, so their bytes are removed from object
    storage before the rows that point at them disappear. A file that fails to
    delete is reported, not swallowed — an orphaned object is a privacy issue,
    not a cosmetic one.
    """
    # 1. Object storage: delete the bytes behind every uploaded file.
    files_deleted, files_failed = 0, 0
    keys: list[str] = []
    if storage_enabled():
        items = await _all(session, Item, Item.user_id == user)
        keys = [k for i in items if (k := (i.file_meta or {}).get("s3_key"))]
        for key in keys:
            try:
                delete_object(key)
                files_deleted += 1
            except Exception:  # noqa: BLE001 — a failed file delete is reported, never aborts erasure
                files_failed += 1

    # 2. Rows, children first.
    counts: dict[str, int] = {}

    board_ids = (await session.execute(select(Board.id).where(Board.user_id == user))).scalars().all()
    if board_ids:
        col_ids = (await session.execute(
            select(BoardColumn.id).where(BoardColumn.board_id.in_(board_ids)))).scalars().all()
        if col_ids:
            counts["cards"] = (await session.execute(
                sql_delete(Card).where(Card.column_id.in_(col_ids)))).rowcount
            await session.execute(sql_delete(BoardColumn).where(BoardColumn.board_id.in_(board_ids)))
        await session.execute(sql_delete(Sprint).where(Sprint.board_id.in_(board_ids)))

    # CalendarAccount deletes cascade their events (FK ON DELETE CASCADE).
    for model in (Board, Embedding, Item, Task, Expense, Bill, Income,
                  PayMethod, Budget, Goal, CustomTag, Event, CalendarAccount):
        res = await session.execute(sql_delete(model).where(model.user_id == user))
        counts[model.__tablename__] = res.rowcount

    counts["users"] = (await session.execute(sql_delete(User).where(User.id == user))).rowcount
    await session.commit()

    return {
        "deleted": True,
        "user_id": user,
        "rows": counts,
        "files_deleted": files_deleted,
        "files_failed": files_failed,
    }

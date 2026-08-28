"""Day-one migration: the frontend's existing JSON export IS the import
format. POST the whole localStorage snapshot and the account is populated;
then /ai/reindex builds the RAG index.

IDEMPOTENT: re-importing updates rows in place (keyed on the frontend's
string ids per user, items by client_id, budgets by scope, tags by value),
so import-after-mirror and repeated syncs are always safe. A string id
that already belongs to ANOTHER user 409s atomically with the offending
ids listed — the global-PK → per-user-key schema change is tracked as
pre-launch work in docs/backend-architecture.md."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..models import Bill, Board, BoardColumn, Budget, Card, CustomTag, Expense, Goal, Income, Item, PayMethod, Sprint, Task

router = APIRouter(prefix="/sync", tags=["sync"])


class Snapshot(BaseModel):
    items: list[dict] = []          # vault.items.v1
    todos: dict = {}                # vault.todos.v1
    finance: dict = {}              # vault.finance.v1
    boards: dict = {}               # vault.boards.v1
    tags: dict = {}                 # vault.tags.v1


def _d(v, fallback=None):
    try:
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return fallback


def _cents(v) -> int:
    """The snapshot is a raw localStorage dump, so money arrives as dollars
    here — the ONLY place in the API that accepts them. Round once, on the
    way in; everything downstream is integer cents."""
    try:
        return int(round(float(v or 0) * 100))
    except (TypeError, ValueError):
        return 0


def _ms(v) -> int:
    """Client LWW clock, ms since epoch. Import keeps its replace-everything
    semantics (no staleness check), but it must WRITE the clocks through —
    dropping them would zero every row and disarm the upsert guard until the
    next stamped edit. Anything unparseable is 0 = unstamped."""
    try:
        return max(int(v or 0), 0)
    except (TypeError, ValueError):
        return 0


async def _upsert(session: AsyncSession, model, pk: str, user: str, values: dict, conflicts: list):
    """Insert-or-update by string PK, refusing to touch another user's row."""
    row = await session.get(model, pk)
    if row is None:
        session.add(model(id=pk, user_id=user, **values))
    elif row.user_id == user:
        for k, v in values.items():
            setattr(row, k, v)
    else:
        conflicts.append(f"{model.__tablename__}:{pk}")


@router.post("/import")
async def import_snapshot(snap: Snapshot, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    counts = {}
    conflicts: list[str] = []

    # ---- items: upsert by (user, client_id) ----
    existing_items = {
        r.client_id: r for r in (await session.execute(
            select(Item).where(Item.user_id == user, Item.client_id.is_not(None))
        )).scalars()
    }
    for it in snap.items:
        vals = dict(
            type=it.get("type", "note"), title=it.get("title", ""), meta=it.get("meta", ""),
            url=it.get("url"), cloud=it.get("cloud"), status=it.get("status", "Inbox"),
            tags=it.get("tags", []), folder=it.get("folder"), alias=it.get("alias"),
            pinned=bool(it.get("pinned")), progress=it.get("progress"), blocks=it.get("blocks"),
            links=it.get("links"),
            file_meta={k: v for k, v in (it.get("file") or {}).items() if k != "data"} or None,
            added_on=_d(it.get("date"), date.today()), deleted_on=_d(it.get("deleted")),
            updated_at=_ms(it.get("updated_at", it.get("updated"))),
        )
        cid = str(it.get("id"))
        row = existing_items.get(cid)
        if row:
            for k, v in vals.items():
                setattr(row, k, v)
        else:
            session.add(Item(user_id=user, client_id=cid, **vals))
    counts["items"] = len(snap.items)

    # ---- tasks ----
    tasks = snap.todos.get("tasks", [])
    for t in tasks:
        await _upsert(session, Task, str(t["id"]), user, dict(
            text=t.get("text", ""), done=bool(t.get("done")), done_at=_d(t.get("doneAt")),
            due=_d(t.get("due")), high=bool(t.get("high")), label=t.get("label"),
            created_on=_d(t.get("created"), date.today()),
            updated_at=_ms(t.get("updated_at", t.get("updated"))),
        ), conflicts)
    counts["tasks"] = len(tasks)

    # ---- finance ----
    fin = snap.finance
    for e in fin.get("expenses", []):
        await _upsert(session, Expense, str(e["id"]), user, dict(
            desc=e.get("desc", ""), amount_cents=_cents(e.get("amount")), cat=e.get("cat", "Other"),
            pay_method_id=e.get("pay"), spent_on=_d(e.get("date"), date.today()),
        ), conflicts)
    for b in fin.get("bills", []):
        await _upsert(session, Bill, str(b["id"]), user, dict(
            title=b.get("title", ""), amount_cents=_cents(b.get("amount")), due=_d(b.get("due"), date.today()),
            paid=bool(b.get("paid")), paid_on=_d(b.get("paidOn")), recur=b.get("recur"),
        ), conflicts)
    for i in fin.get("incomes", []):
        await _upsert(session, Income, str(i["id"]), user, dict(
            source=i.get("source", ""), amount_cents=_cents(i.get("amount")),
            received_on=_d(i.get("date"), date.today()),
        ), conflicts)
    for m in fin.get("payMethods", []):
        await _upsert(session, PayMethod, str(m["id"]), user, dict(
            name=m.get("name", ""), kind=m.get("kind", "credit"),
        ), conflicts)
    for g in fin.get("goals", []):
        await _upsert(session, Goal, str(g["id"]), user, dict(
            name=g.get("name", ""), target_cents=_cents(g.get("target")), saved_cents=_cents(g.get("saved")),
        ), conflicts)
    budgets = fin.get("budgets", {})
    caps = {"overall": budgets.get("overall"), **(budgets.get("byCat") or {})}
    existing_budgets = {
        b.scope: b for b in (await session.execute(select(Budget).where(Budget.user_id == user))).scalars()
    }
    for scope, cap in caps.items():
        if not cap:
            continue
        if scope in existing_budgets:
            existing_budgets[scope].cap_cents = _cents(cap)
        else:
            session.add(Budget(user_id=user, scope=scope, cap_cents=_cents(cap)))
    counts["finance"] = sum(len(fin.get(k, [])) for k in ("expenses", "bills", "incomes", "payMethods", "goals"))

    # ---- boards: same replace-children semantics as PUT /boards/{id}/snapshot ----
    for b in snap.boards.get("boards", []):
        bid = str(b["id"])
        board = await session.get(Board, bid)
        if board and board.user_id != user:
            conflicts.append(f"boards:{bid}")
            continue
        if not board:
            board = Board(id=bid, user_id=user)
            session.add(board)
        board.name = b.get("name", "")
        board.seq = b.get("seq", 0)
        board.current_sprint = b.get("current")
        col_ids = select(BoardColumn.id).where(BoardColumn.board_id == bid).scalar_subquery()
        await session.execute(delete(Card).where(Card.column_id.in_(col_ids)))
        await session.execute(delete(BoardColumn).where(BoardColumn.board_id == bid))
        await session.execute(delete(Sprint).where(Sprint.board_id == bid))
        session.add_all([Sprint(id=str(s["id"]), board_id=bid, name=s.get("name", ""),
                                ended_on=_d(s.get("ended")), position=i)
                         for i, s in enumerate(b.get("sprints", []))])
        session.add_all([BoardColumn(id=str(c["id"]), board_id=bid, title=c.get("title", ""), position=i)
                         for i, c in enumerate(b.get("cols", []))])
        await session.flush()
        session.add_all([Card(id=str(k["id"]), column_id=str(c["id"]), sprint_id=k.get("sprint"),
                              num=k.get("num", j + 1), text=k.get("text", ""), desc=k.get("desc"),
                              hours=k.get("hours"), labels=k.get("labels", []), position=j)
                         for c in b.get("cols", []) for j, k in enumerate(c.get("cards", []))])
    counts["boards"] = len(snap.boards.get("boards", []))

    # ---- custom tags: dedupe by value ----
    existing_tags = {
        t.tag for t in (await session.execute(select(CustomTag).where(CustomTag.user_id == user))).scalars()
    }
    for t in snap.tags.get("custom", []):
        if t not in existing_tags:
            session.add(CustomTag(user_id=user, tag=t))

    if conflicts:
        await session.rollback()
        raise HTTPException(409, {"message": "Some ids already belong to another account — nothing was written.",
                                  "colliding": conflicts[:20]})

    await session.commit()
    return {"imported": counts}

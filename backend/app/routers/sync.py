"""Day-one migration: the frontend's existing JSON export IS the import
format. POST the whole localStorage snapshot and the account is populated;
then /ai/reindex builds the RAG index."""

from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
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


@router.post("/import")
async def import_snapshot(snap: Snapshot, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    counts = {}

    for it in snap.items:
        session.add(Item(
            user_id=user, client_id=str(it.get("id")), type=it.get("type", "note"),
            title=it.get("title", ""), meta=it.get("meta", ""), url=it.get("url"),
            cloud=it.get("cloud"), status=it.get("status", "Inbox"), tags=it.get("tags", []),
            folder=it.get("folder"), alias=it.get("alias"), pinned=bool(it.get("pinned")),
            progress=it.get("progress"), blocks=it.get("blocks"), links=it.get("links"),
            file_meta={k: v for k, v in (it.get("file") or {}).items() if k != "data"} or None,
            added_on=_d(it.get("date"), date.today()), deleted_on=_d(it.get("deleted")),
        ))
    counts["items"] = len(snap.items)

    tasks = snap.todos.get("tasks", [])
    for t in tasks:
        session.add(Task(id=str(t["id"]), user_id=user, text=t.get("text", ""), done=bool(t.get("done")),
                         done_at=_d(t.get("doneAt")), due=_d(t.get("due")), high=bool(t.get("high")),
                         label=t.get("label"), created_on=_d(t.get("created"), date.today())))
    counts["tasks"] = len(tasks)

    fin = snap.finance
    for e in fin.get("expenses", []):
        session.add(Expense(id=str(e["id"]), user_id=user, desc=e.get("desc", ""), amount=e.get("amount", 0),
                            cat=e.get("cat", "Other"), pay_method_id=e.get("pay"), spent_on=_d(e.get("date"), date.today())))
    for b in fin.get("bills", []):
        session.add(Bill(id=str(b["id"]), user_id=user, title=b.get("title", ""), amount=b.get("amount", 0),
                         due=_d(b.get("due"), date.today()), paid=bool(b.get("paid")),
                         paid_on=_d(b.get("paidOn")), recur=b.get("recur")))
    for i in fin.get("incomes", []):
        session.add(Income(id=str(i["id"]), user_id=user, source=i.get("source", ""), amount=i.get("amount", 0),
                           received_on=_d(i.get("date"), date.today())))
    for m in fin.get("payMethods", []):
        session.add(PayMethod(id=str(m["id"]), user_id=user, name=m.get("name", ""), kind=m.get("kind", "credit")))
    budgets = fin.get("budgets", {})
    if budgets.get("overall"):
        session.add(Budget(user_id=user, scope="overall", cap=budgets["overall"]))
    for cat, cap in (budgets.get("byCat") or {}).items():
        session.add(Budget(user_id=user, scope=cat, cap=cap))
    for g in fin.get("goals", []):
        session.add(Goal(id=str(g["id"]), user_id=user, name=g.get("name", ""),
                         target=g.get("target", 0), saved=g.get("saved", 0)))
    counts["finance"] = sum(len(fin.get(k, [])) for k in ("expenses", "bills", "incomes", "payMethods", "goals"))

    for b in snap.boards.get("boards", []):
        board = Board(id=str(b["id"]), user_id=user, name=b.get("name", ""), seq=b.get("seq", 0),
                      current_sprint=b.get("current"))
        session.add(board)
        for pos, s in enumerate(b.get("sprints", [])):
            session.add(Sprint(id=str(s["id"]), board_id=board.id, name=s.get("name", ""),
                               ended_on=_d(s.get("ended")), position=pos))
        for cpos, c in enumerate(b.get("cols", [])):
            session.add(BoardColumn(id=str(c["id"]), board_id=board.id, title=c.get("title", ""), position=cpos))
            for kpos, k in enumerate(c.get("cards", [])):
                session.add(Card(id=str(k["id"]), column_id=str(c["id"]), sprint_id=k.get("sprint"),
                                 num=k.get("num", kpos + 1), text=k.get("text", ""), desc=k.get("desc"),
                                 hours=k.get("hours"), labels=k.get("labels", []), position=kpos))
    counts["boards"] = len(snap.boards.get("boards", []))

    for t in snap.tags.get("custom", []):
        session.add(CustomTag(user_id=user, tag=t))

    await session.commit()
    return {"imported": counts}

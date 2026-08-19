from datetime import date
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..events import emit
from ..models import Bill, Budget, Expense, Goal, Income, PayMethod
from ..schemas import BillIn, BillOut, BudgetIn, ExpenseIn, ExpenseOut, GoalIn, GoalOut, IncomeIn, IncomeOut, PayMethodIn, PayMethodOut

router = APIRouter(prefix="/finance", tags=["finance"])


async def _get(model, id_, session, user):
    row = await session.get(model, id_)
    if not row or row.user_id != user:
        raise HTTPException(404, f"{model.__name__} not found")
    return row


async def _upsert(model, body, session, user, insert_event=None):
    """Insert-or-update by the frontend-owned string id.

    POST create endpoints must be upserts so frontend mirror calls are
    idempotent (see backend-integration skill) — a replayed mirror updates
    all fields instead of erroring on the duplicate key."""
    row = await session.get(model, body.id)
    if row is not None and row.user_id != user:
        raise HTTPException(409, f"{model.__name__} id belongs to another user")
    if row is None:
        row = model(user_id=user, **body.model_dump())
        session.add(row)
        if insert_event:  # only a genuinely new row is an "event"; replays stay silent
            kind, payload = insert_event
            await emit(session, user, kind, payload)
    else:
        for k, v in body.model_dump(exclude={"id"}).items():
            setattr(row, k, v)
    await session.commit()
    return row


async def _delete(model, id_, session, user):
    """Idempotent delete: a row that is already gone is success, so a
    replayed mirror DELETE never wedges the frontend retry queue."""
    row = await session.get(model, id_)
    if row is not None and row.user_id == user:
        await session.delete(row)
        await session.commit()
    return {"ok": True}


# ---------- expenses ----------
@router.get("/expenses", response_model=list[ExpenseOut])
async def expenses(month: str | None = None, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    stmt = select(Expense).where(Expense.user_id == user).order_by(Expense.spent_on.desc())
    rows = (await session.execute(stmt)).scalars().all()
    if month:
        rows = [r for r in rows if r.spent_on.isoformat().startswith(month)]
    return rows


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
async def add_expense(body: ExpenseIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _upsert(Expense, body, session, user,
                         insert_event=("expense.logged", {"amount_cents": body.amount_cents, "cat": body.cat}))


@router.put("/expenses/{eid}", response_model=ExpenseOut)
async def edit_expense(eid: str, body: ExpenseIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = await _get(Expense, eid, session, user)
    for k, v in body.model_dump(exclude={"id"}).items():
        setattr(row, k, v)
    await session.commit()
    return row


@router.delete("/expenses/{eid}")
async def del_expense(eid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _delete(Expense, eid, session, user)


# ---------- bills (recurring auto-reschedule lives HERE, server-side) ----------
def _advance(due: date, recur: str) -> date:
    return due + {"weekly": relativedelta(weeks=1), "monthly": relativedelta(months=1), "yearly": relativedelta(years=1)}[recur]


@router.get("/bills", response_model=list[BillOut])
async def bills(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Bill).where(Bill.user_id == user).order_by(Bill.due))).scalars().all()


@router.post("/bills", response_model=BillOut, status_code=201)
async def add_bill(body: BillIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _upsert(Bill, body, session, user)


@router.post("/bills/{bid}/pay", response_model=list[BillOut])
async def pay_bill(bid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = await _get(Bill, bid, session, user)
    row.paid, row.paid_on = True, date.today()
    created = [row]
    if row.recur:
        nxt_due = _advance(row.due, row.recur)
        exists = (await session.execute(select(Bill).where(
            Bill.user_id == user, Bill.title == row.title, Bill.paid == False, Bill.due == nxt_due  # noqa: E712
        ))).scalar_one_or_none()
        if not exists:
            import uuid
            nxt = Bill(id=uuid.uuid4().hex[:12], user_id=user, title=row.title,
                       amount_cents=row.amount_cents, due=nxt_due, paid=False, recur=row.recur)
            session.add(nxt)
            created.append(nxt)
    await emit(session, user, "bill.paid", {"title": row.title, "amount_cents": row.amount_cents})
    await session.commit()
    return created


@router.delete("/bills/{bid}")
async def del_bill(bid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _delete(Bill, bid, session, user)


# ---------- income / pay methods / budgets / goals ----------
@router.get("/incomes", response_model=list[IncomeOut])
async def incomes(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Income).where(Income.user_id == user))).scalars().all()


@router.post("/incomes", response_model=IncomeOut, status_code=201)
async def add_income(body: IncomeIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _upsert(Income, body, session, user)


@router.delete("/incomes/{iid}")
async def del_income(iid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _delete(Income, iid, session, user)


@router.get("/pay-methods", response_model=list[PayMethodOut])
async def pay_methods(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(PayMethod).where(PayMethod.user_id == user))).scalars().all()


@router.post("/pay-methods", response_model=PayMethodOut, status_code=201)
async def add_pay_method(body: PayMethodIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _upsert(PayMethod, body, session, user)


@router.delete("/pay-methods/{pid}")
async def del_pay_method(pid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _delete(PayMethod, pid, session, user)


@router.put("/budgets")
async def set_budget(body: BudgetIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = (await session.execute(select(Budget).where(Budget.user_id == user, Budget.scope == body.scope))).scalar_one_or_none()
    if row:
        row.cap_cents = body.cap_cents
    else:
        session.add(Budget(user_id=user, scope=body.scope, cap_cents=body.cap_cents))
    await session.commit()
    return {"ok": True}


@router.get("/goals", response_model=list[GoalOut])
async def goals(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Goal).where(Goal.user_id == user))).scalars().all()


@router.post("/goals", response_model=GoalOut, status_code=201)
async def add_goal(body: GoalIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _upsert(Goal, body, session, user)


@router.delete("/goals/{gid}")
async def del_goal(gid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return await _delete(Goal, gid, session, user)


# ---------- summary: one SQL round-trip feeds tiles, charts and reports ----------
@router.get("/summary")
async def summary(month: str | None = None, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    ym = month or date.today().isoformat()[:7]
    y, m = int(ym[:4]), int(ym[5:7])
    start, end = date(y, m, 1), date(y, m, 1) + relativedelta(months=1)

    spent = (await session.execute(select(func.coalesce(func.sum(Expense.amount_cents), 0)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end))).scalar_one()
    by_cat = (await session.execute(select(Expense.cat, func.sum(Expense.amount_cents)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end).group_by(Expense.cat))).all()
    by_pay = (await session.execute(select(Expense.pay_method_id, func.sum(Expense.amount_cents)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end).group_by(Expense.pay_method_id))).all()
    income = (await session.execute(select(func.coalesce(func.sum(Income.amount_cents), 0)).where(
        Income.user_id == user, Income.received_on >= start, Income.received_on < end))).scalar_one()
    pending = (await session.execute(select(Bill).where(Bill.user_id == user, Bill.paid == False))).scalars().all()  # noqa: E712
    budgets = (await session.execute(select(Budget).where(Budget.user_id == user))).scalars().all()

    # Every figure here is integer cents — exact, because SUM over integers
    # cannot drift. The frontend divides by 100 once, at display time.
    return {
        "month": ym,
        "spent_cents": int(spent),
        "income_cents": int(income),
        "savings_rate": round((income - spent) / income * 100) if income else None,
        "by_category_cents": {c: int(v) for c, v in by_cat},
        "by_pay_method_cents": {p or "none": int(v) for p, v in by_pay},
        "bills_pending": [BillOut.model_validate(b) for b in pending],
        "budgets_cents": {b.scope: b.cap_cents for b in budgets},
    }

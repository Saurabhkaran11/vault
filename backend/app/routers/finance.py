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
    row = Expense(user_id=user, **body.model_dump())
    session.add(row)
    await emit(session, user, "expense.logged", {"amount": body.amount, "cat": body.cat})
    await session.commit()
    return row


@router.put("/expenses/{eid}", response_model=ExpenseOut)
async def edit_expense(eid: str, body: ExpenseIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = await _get(Expense, eid, session, user)
    for k, v in body.model_dump(exclude={"id"}).items():
        setattr(row, k, v)
    await session.commit()
    return row


@router.delete("/expenses/{eid}")
async def del_expense(eid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    await session.delete(await _get(Expense, eid, session, user))
    await session.commit()
    return {"ok": True}


# ---------- bills (recurring auto-reschedule lives HERE, server-side) ----------
def _advance(due: date, recur: str) -> date:
    return due + {"weekly": relativedelta(weeks=1), "monthly": relativedelta(months=1), "yearly": relativedelta(years=1)}[recur]


@router.get("/bills", response_model=list[BillOut])
async def bills(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Bill).where(Bill.user_id == user).order_by(Bill.due))).scalars().all()


@router.post("/bills", response_model=BillOut, status_code=201)
async def add_bill(body: BillIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = Bill(user_id=user, **body.model_dump())
    session.add(row)
    await session.commit()
    return row


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
                       amount=row.amount, due=nxt_due, paid=False, recur=row.recur)
            session.add(nxt)
            created.append(nxt)
    await emit(session, user, "bill.paid", {"title": row.title, "amount": row.amount})
    await session.commit()
    return created


@router.delete("/bills/{bid}")
async def del_bill(bid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    await session.delete(await _get(Bill, bid, session, user))
    await session.commit()
    return {"ok": True}


# ---------- income / pay methods / budgets / goals ----------
@router.get("/incomes", response_model=list[IncomeOut])
async def incomes(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Income).where(Income.user_id == user))).scalars().all()


@router.post("/incomes", response_model=IncomeOut, status_code=201)
async def add_income(body: IncomeIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = Income(user_id=user, **body.model_dump())
    session.add(row)
    await session.commit()
    return row


@router.get("/pay-methods", response_model=list[PayMethodOut])
async def pay_methods(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(PayMethod).where(PayMethod.user_id == user))).scalars().all()


@router.post("/pay-methods", response_model=PayMethodOut, status_code=201)
async def add_pay_method(body: PayMethodIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = PayMethod(user_id=user, **body.model_dump())
    session.add(row)
    await session.commit()
    return row


@router.delete("/pay-methods/{pid}")
async def del_pay_method(pid: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    await session.delete(await _get(PayMethod, pid, session, user))
    await session.commit()
    return {"ok": True}


@router.put("/budgets")
async def set_budget(body: BudgetIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = (await session.execute(select(Budget).where(Budget.user_id == user, Budget.scope == body.scope))).scalar_one_or_none()
    if row:
        row.cap = body.cap
    else:
        session.add(Budget(user_id=user, scope=body.scope, cap=body.cap))
    await session.commit()
    return {"ok": True}


@router.get("/goals", response_model=list[GoalOut])
async def goals(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    return (await session.execute(select(Goal).where(Goal.user_id == user))).scalars().all()


@router.post("/goals", response_model=GoalOut, status_code=201)
async def add_goal(body: GoalIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    row = Goal(user_id=user, **body.model_dump())
    session.add(row)
    await session.commit()
    return row


# ---------- summary: one SQL round-trip feeds tiles, charts and reports ----------
@router.get("/summary")
async def summary(month: str | None = None, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    ym = month or date.today().isoformat()[:7]
    y, m = int(ym[:4]), int(ym[5:7])
    start, end = date(y, m, 1), date(y, m, 1) + relativedelta(months=1)

    spent = (await session.execute(select(func.coalesce(func.sum(Expense.amount), 0)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end))).scalar_one()
    by_cat = (await session.execute(select(Expense.cat, func.sum(Expense.amount)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end).group_by(Expense.cat))).all()
    by_pay = (await session.execute(select(Expense.pay_method_id, func.sum(Expense.amount)).where(
        Expense.user_id == user, Expense.spent_on >= start, Expense.spent_on < end).group_by(Expense.pay_method_id))).all()
    income = (await session.execute(select(func.coalesce(func.sum(Income.amount), 0)).where(
        Income.user_id == user, Income.received_on >= start, Income.received_on < end))).scalar_one()
    pending = (await session.execute(select(Bill).where(Bill.user_id == user, Bill.paid == False))).scalars().all()  # noqa: E712
    budgets = (await session.execute(select(Budget).where(Budget.user_id == user))).scalars().all()

    return {
        "month": ym,
        "spent": float(spent),
        "income": float(income),
        "savings_rate": round((income - spent) / income * 100) if income else None,
        "by_category": {c: float(v) for c, v in by_cat},
        "by_pay_method": {p or "none": float(v) for p, v in by_pay},
        "bills_pending": [BillOut.model_validate(b) for b in pending],
        "budgets": {b.scope: b.cap for b in budgets},
    }

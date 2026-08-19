---
name: finance-sync
description: Mirror Vault finance (expenses, bills, incomes, pay methods, budgets, goals) to the FastAPI finance API — upserts, recurring-pay flow, verification.
---

# Finance sync

Owned files: `frontend/components/FinanceBoard.jsx` · `backend/app/routers/finance.py`.
(Leave FinanceGoals/FinanceBudgets components untouched — their onChange
flows through FinanceBoard's setFin; mirror from FinanceBoard handlers.)
Read `../backend-integration/SKILL.md` first.

## Backend work

Make the POST create endpoints **upserts** by primary-key id:
expenses, bills, incomes, pay-methods, goals (update-all-fields on
conflict). `PUT /finance/budgets` is already an upsert. Keep `/bills/{id}/pay`
as-is (server owns recurrence).

## Frontend work (FinanceBoard.jsx)

Import `{ mirror }` from `@/lib/api`. Mirror at handler level:

- addExpense / saveExpEdit → `mirror("/finance/expenses", POST upsert body)`
  with `pay_method_id: e.pay ?? null`, `spent_on: e.date`
- delExpense → DELETE `/finance/expenses/{id}`
- addBill/saveBillEdit → upsert `/finance/bills` (`paid_on: b.paidOn??null`)
- setPaid(paid=true) → **call `mirror("/finance/bills/"+id+"/pay", {method:"POST"})`**
  (server auto-schedules next occurrence — do NOT also upsert the next
  occurrence from the client when mirroring; local logic still runs for
  offline mode, ids will differ between local/server next-bills — acceptable
  this phase, noted in integration doc). setPaid(false) → upsert with paid:false.
- delBill → DELETE. addIncome/delIncome → upsert/DELETE `/finance/incomes`.
- addMethod/delMethod → upsert/DELETE `/finance/pay-methods`.
- Budget changes (setFin budgets) → `mirror("/finance/budgets", PUT {scope,cap})`
  for overall + each byCat entry that changed (mirror from FinanceBudgets'
  onChange handler inside FinanceBoard where setFin is called).
- Goals add/contribute/remove (onChange in FinanceBoard) → upsert/DELETE
  `/finance/goals` per changed goal (diff old vs new arrays by id).

## Verify (curl, user `qa-fin`)

1. expense upsert ×2 same id → one row, updated amount; summary reflects it.
2. bill upsert → pay → response has next occurrence for recurring.
3. pay-method + goal upserts idempotent; DELETEs work.
4. `node --check` passes on FinanceBoard.jsx.

## Status log

- 2026-08-18: skill created; work pending.
- 2026-08-18: DONE — backend + frontend shipped and verified.
  - `routers/finance.py`: POST expenses/bills/incomes/pay-methods/goals are
    now upserts by frontend id via `_upsert` (update-all-fields on conflict;
    409 if the id belongs to another user; `expense.logged` emits only on
    genuine insert so replays stay silent). Added missing
    `DELETE /finance/incomes/{id}` and `DELETE /finance/goals/{id}`. All
    finance DELETEs are idempotent (`{"ok":true}` even when already gone) so
    a replayed mirror DELETE can't wedge the retry queue. `/bills/{id}/pay`
    and `PUT /budgets` untouched.
  - `FinanceBoard.jsx`: imports `mirror`; module-level `expToApi/billToApi/
    incToApi/pmToApi/goalToApi` mappers (pay→pay_method_id, date→spent_on/
    received_on, paidOn→paid_on, undefined→null). Mirrors at handler level:
    addExpense/saveExpEdit/delExpense, addBill/saveBillEdit/delBill,
    setPaid(true)→`POST /finance/bills/{id}/pay` (server owns the next
    occurrence — client does NOT upsert it; local copy still created for
    offline), setPaid(false)→upsert paid:false, addIncome/delIncome,
    addMethod/delMethod, smartAdd (all three kinds), `changeBudgets` (PUT per
    changed scope: overall + byCat diff; cleared cap mirrors as cap 0 since
    BudgetIn.cap is a required float and the UI treats 0/absent as no cap),
    `changeGoals` (diff by id → upsert changed, DELETE removed). Deletes
    mirror only after the click-again confirm. Behavior unchanged when
    backendOn() is false (mirror() no-ops).
  - Verified via curl as `qa-fin` on :8100 (live Postgres, server restarted):
    expense upsert ×2 same id → 1 row, amount 5→7.5, summary shows spent 7.5
    / by_category Food 7.5 / by_pay_method qp1; bill upsert ×2 → 1 row, pay
    → response = [paid bill, next occurrence due +1 month], pay replay does
    not duplicate the next occurrence; pay-method/goal/income upserts ×2 all
    → 1 row with updated fields; DELETEs remove and replay 200-ok; cross-user
    upsert of an existing id → 409; budgets PUT + summary reflects
    {overall:2500, Food:0}; events table shows exactly 1 expense.logged after
    2 POSTs. qa-fin rows cleaned after the run.
  - Syntax: `python -m py_compile` OK on finance.py. Note: plain
    `node --check FinanceBoard.jsx` cannot parse the .jsx extension on
    Node 26 (ERR_UNKNOWN_FILE_EXTENSION — true for every component here), so
    the equivalent check was run: Babel (next/dist/compiled/babel) JSX parse
    of the source passes, and `node --check` passes on the JSX-stripped
    transform output.

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

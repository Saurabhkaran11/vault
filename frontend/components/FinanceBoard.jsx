"use client";

import React, { useEffect, useMemo, useState } from "react";
import { fmtStamp, today, daysAgo } from "@/lib/seed";
import FinanceAnalytics from "./FinanceAnalytics";
import FinanceBudgets from "./FinanceBudgets";
import FinanceGoals from "./FinanceGoals";
import { askJSON } from "@/lib/ai";
import { useAiReady } from "@/hooks/useAiReady";
import { mirror, toCents } from "@/lib/api";
import { uid } from "@/lib/id";

/* Finance — expenses, bills (with recurrence), income, budgets and goals.
 *
 * Storage is a VERSIONED schema (vault.finance.v1 key, schema version 2) with
 * a migration step on load, so shipped data never breaks when the model grows —
 * and the entities (expense, bill, income, budget, goal) map 1:1 onto the
 * future backend's API models. */


export const CATEGORIES = ["Food", "Transport", "Shopping", "Bills", "Health", "Fun", "Other"];
const CURRENCIES = [
  { code: "USD", sym: "$" },
  { code: "EUR", sym: "€" },
  { code: "GBP", sym: "£" },
  { code: "INR", sym: "₹" },
  { code: "JPY", sym: "¥" },
  { code: "CNY", sym: "CN¥" },
  { code: "AUD", sym: "A$" },
  { code: "CAD", sym: "C$" },
  { code: "SGD", sym: "S$" },
  { code: "AED", sym: "AED " },
  { code: "CHF", sym: "CHF " },
];
const LEGACY_SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "₹": "INR" };

const emptyFinance = {
  version: 2,
  currency: "USD",
  currencyChosen: false,
  seeded: true,
  expenses: [],   // {id, desc, amount, cat, date}
  bills: [],      // {id, title, amount, due, paid, paidOn?, recur?: "weekly"|"monthly"|"yearly"|null}
  incomes: [],    // {id, source, amount, date}
  budgets: { overall: null, byCat: {} },
  goals: [],      // {id, name, target, saved}
};

/* First-run sample data — dates are relative to "today" so the charts,
   budgets and bills always look alive. Delete anything freely. */
const dRel = (days) => { const t = new Date(); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };
const monthStart = (offset) => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth() + offset, 1).toISOString().slice(0, 10); };
const sampleFinance = () => ({
  expenses: [
    { id: uid(), desc: "Groceries — weekly run", amount: 82.4, cat: "Food", date: dRel(-1) },
    { id: uid(), desc: "Coffee", amount: 4.5, cat: "Food", date: dRel(0) },
    { id: uid(), desc: "Metro card top-up", amount: 25, cat: "Transport", date: dRel(-3) },
    { id: uid(), desc: "Gym membership", amount: 45, cat: "Health", date: dRel(-6) },
    { id: uid(), desc: "Movie night", amount: 28, cat: "Fun", date: dRel(-8) },
    { id: uid(), desc: "Headphones", amount: 129, cat: "Shopping", date: dRel(-5) },
    { id: uid(), desc: "Electricity bill", amount: 60, cat: "Bills", date: dRel(-12) },
    { id: uid(), desc: "Groceries", amount: 76.1, cat: "Food", date: dRel(-27) },
    { id: uid(), desc: "Fuel", amount: 40, cat: "Transport", date: dRel(-33) },
    { id: uid(), desc: "Pharmacy", amount: 22, cat: "Health", date: dRel(-40) },
    { id: uid(), desc: "Dinner out", amount: 54, cat: "Fun", date: dRel(-24) },
    { id: uid(), desc: "T-shirt", amount: 30, cat: "Shopping", date: dRel(-36) },
    { id: uid(), desc: "Groceries", amount: 68, cat: "Food", date: dRel(-60) },
    { id: uid(), desc: "Taxi", amount: 18, cat: "Transport", date: dRel(-69) },
    { id: uid(), desc: "Books", amount: 42, cat: "Shopping", date: dRel(-55) },
  ],
  bills: [
    { id: uid(), title: "Rent", amount: 1200, due: monthStart(1), paid: false, recur: "monthly" },
    { id: uid(), title: "Netflix", amount: 15.99, due: dRel(3), paid: false, recur: "monthly" },
    { id: uid(), title: "Credit card statement", amount: 430, due: dRel(2), paid: false, recur: null },
    { id: uid(), title: "Water bill", amount: 32, due: dRel(-4), paid: false, recur: null },
    { id: uid(), title: "Internet", amount: 39.99, due: dRel(-10), paid: true, paidOn: dRel(-10), recur: "monthly" },
    { id: uid(), title: "Internet", amount: 39.99, due: dRel(20), paid: false, recur: "monthly" },
  ],
  incomes: [
    { id: uid(), source: "Salary", amount: 4200, date: monthStart(0) },
    { id: uid(), source: "Freelance — landing page", amount: 350, date: dRel(-7) },
    { id: uid(), source: "Salary", amount: 4200, date: monthStart(-1) },
    { id: uid(), source: "Salary", amount: 4200, date: monthStart(-2) },
  ],
  budgets: { overall: 2500, byCat: { Food: 300, Shopping: 150, Fun: 100, Transport: 80 } },
  goals: [
    { id: uid(), name: "MacBook Pro", target: 2000, saved: 750 },
    { id: uid(), name: "Emergency fund", target: 5000, saved: 3200 },
  ],
});

const seedFinance = { ...emptyFinance, ...sampleFinance() };

/* Payment methods — which card/wallet paid for what (Mint/Spendee pattern).
   Users add their own; two sensible defaults so the picker is never empty. */
export const PAY_KINDS = [
  ["credit", "Credit card"], ["debit", "Debit card"], ["cash", "Cash"],
  ["wallet", "Wallet / UPI"], ["bank", "Bank transfer"],
];
const DEFAULT_PAY_METHODS = [
  { id: "pm-" + uid(), name: "Cash", kind: "cash" },
  { id: "pm-" + uid(), name: "Visa ···· 4242", kind: "credit" },
];

/* migrate any stored shape (v1 or partial) up to schema v2.
   Stores that have never been seeded AND hold no data get the samples —
   real user data is never touched. */
function migrate(saved) {
  let currency = LEGACY_SYMBOLS[saved.currency] || saved.currency;
  if (!CURRENCIES.some((c) => c.code === currency) || !saved.currencyChosen) currency = "USD";
  const out = {
    ...emptyFinance,
    ...saved,
    version: 2,
    currency,
    bills: (saved.bills || []).map((b) => ({ recur: null, ...b })),
    incomes: saved.incomes || [],
    budgets: { ...emptyFinance.budgets, ...(saved.budgets || {}), byCat: { ...(saved.budgets?.byCat || {}) } },
    goals: saved.goals || [],
    payMethods: saved.payMethods?.length ? saved.payMethods : DEFAULT_PAY_METHODS,
  };
  const isEmpty = !out.expenses.length && !out.bills.length && !out.incomes.length && !out.goals.length;
  if (!saved.seeded && isEmpty) Object.assign(out, sampleFinance());
  out.seeded = true;
  return out;
}

const COLS = [
  { key: "upcoming", title: "Upcoming", color: "var(--blue)" },
  { key: "due", title: "Due soon", color: "var(--gold)" },
  { key: "paid", title: "Paid", color: "var(--moss)" },
];

const colOf = (b) => {
  if (b.paid) return "paid";
  const days = -daysAgo(b.due);
  return days <= 7 ? "due" : "upcoming";
};

export const RECUR_OPTS = [["", "One-time"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
const RECUR_MONTHLY = { weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

/* next due date for a recurring bill */
function advanceDue(dueIso, recur) {
  const d = new Date(dueIso + "T00:00:00");
  if (recur === "weekly") d.setDate(d.getDate() + 7);
  else if (recur === "monthly") d.setMonth(d.getMonth() + 1);
  else if (recur === "yearly") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

const parseAmount = (v) => {
  const a = parseFloat(v);
  return Number.isFinite(a) && a > 0 ? Math.round(a * 100) / 100 : null;
};

/* ---------- backend mirroring (write-through; .claude/skills/finance-sync) ----------
 * localStorage stays the working copy; when Settings → Backend sync is on,
 * every handler below also fires a fire-and-forget mirror() call. These
 * mappers rename fields per the backend-integration skill (pay →
 * pay_method_id, date → spent_on/received_on, paidOn → paid_on) and
 * normalize undefined → null so the JSON body is explicit. */
const expToApi = (e) => ({ id: e.id, desc: e.desc, amount_cents: toCents(e.amount), cat: e.cat, pay_method_id: e.pay ?? null, spent_on: e.date });
const billToApi = (b) => ({ id: b.id, title: b.title, amount_cents: toCents(b.amount), due: b.due, paid: !!b.paid, paid_on: b.paidOn ?? null, recur: b.recur ?? null });
const incToApi = (i) => ({ id: i.id, source: i.source, amount_cents: toCents(i.amount), received_on: i.date });
const pmToApi = (m) => ({ id: m.id, name: m.name, kind: m.kind });
const goalToApi = (g) => ({ id: g.id, name: g.name, target_cents: toCents(g.target), saved_cents: toCents(g.saved ?? 0) });

export default function FinanceBoard() {
  const [fin, setFin] = useState(seedFinance);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vault.finance.v1");
      if (raw) setFin(migrate(JSON.parse(raw)));
    } catch (e) { console.error(e); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("vault.finance.v1", JSON.stringify(fin)); }
    catch (e) { console.error(e); }
  }, [fin, hydrated]);

  const cur = (CURRENCIES.find((c) => c.code === fin.currency) || CURRENCIES[0]).sym;
  const fmt = (n) => `${cur}${(+n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  /* ---------- month browsing (expenses + income lists) */
  const thisMonth = today().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 15);
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthLabel = new Date(month + "-15T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  /* ---------- expenses (add + inline edit) */
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("Food");
  const [pay, setPay] = useState("");           // payment method id ("" = first available)
  const [editExp, setEditExp] = useState(null); // {id, desc, amount, cat, date, pay}
  const methods = fin.payMethods || [];
  const methodName = (id) => methods.find((m) => m.id === id)?.name;
  const methodKind = (id) => PAY_KINDS.find(([k]) => k === methods.find((m) => m.id === id)?.kind)?.[1] || "";

  const addExpense = () => {
    const a = parseAmount(amount);
    if (!desc.trim() || !a) return;
    const payId = pay || methods[0]?.id;
    const exp = { id: uid(), desc: desc.trim(), amount: a, cat, pay: payId, date: today() };
    setFin((f) => ({ ...f, expenses: [exp, ...f.expenses] }));
    mirror("/finance/expenses", { method: "POST", body: expToApi(exp) });
    setDesc(""); setAmount("");
  };

  /* ---------- payment methods (user-managed) */
  const [pmName, setPmName] = useState("");
  const [pmKind, setPmKind] = useState("credit");
  const [pmArm, setPmArm] = useState(null);
  useEffect(() => {
    if (!pmArm) return;
    const t = setTimeout(() => setPmArm(null), 3000);
    return () => clearTimeout(t);
  }, [pmArm]);
  const addMethod = () => {
    const name = pmName.trim();
    if (!name) return;
    const m = { id: uid(), name, kind: pmKind };
    setFin((f) => ({ ...f, payMethods: [...(f.payMethods || []), m] }));
    mirror("/finance/pay-methods", { method: "POST", body: pmToApi(m) });
    setPmName("");
  };
  const delMethod = (id) => {
    if (pmArm !== id) { setPmArm(id); return; }   // expenses keep their record; they just show "—" afterwards
    setFin((f) => ({ ...f, payMethods: f.payMethods.filter((m) => m.id !== id) }));
    mirror(`/finance/pay-methods/${id}`, { method: "DELETE" });
    if (pay === id) setPay("");
    setPmArm(null);
  };
  const delExpense = (id) => {
    setFin((f) => ({ ...f, expenses: f.expenses.filter((e) => e.id !== id) }));
    mirror(`/finance/expenses/${id}`, { method: "DELETE" });
  };
  const saveExpEdit = () => {
    const a = parseAmount(editExp.amount);
    if (!editExp.desc.trim() || !a || !editExp.date) return;
    const patch = { desc: editExp.desc.trim(), amount: a, cat: editExp.cat, date: editExp.date };
    setFin((f) => ({
      ...f,
      expenses: f.expenses.map((e) => (e.id === editExp.id ? { ...e, ...patch } : e)),
    }));
    const prev = fin.expenses.find((e) => e.id === editExp.id);
    if (prev) mirror("/finance/expenses", { method: "POST", body: expToApi({ ...prev, ...patch }) });
    setEditExp(null);
  };

  const spentToday = fin.expenses.filter((e) => e.date === today()).reduce((a, e) => a + e.amount, 0);
  const spentMonth = fin.expenses.filter((e) => e.date.startsWith(thisMonth)).reduce((a, e) => a + e.amount, 0);
  const spentByCat = useMemo(() => {
    const map = {};
    fin.expenses.filter((e) => e.date.startsWith(thisMonth)).forEach((e) => { map[e.cat] = (map[e.cat] || 0) + e.amount; });
    return map;
  }, [fin.expenses, thisMonth]);

  /* selected month's expenses grouped by day, newest first */
  const byDay = useMemo(() => {
    const map = {};
    fin.expenses.filter((e) => e.date.startsWith(month)).forEach((e) => { (map[e.date] = map[e.date] || []).push(e); });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [fin.expenses, month]);

  const catTotals = useMemo(() => {
    const map = {};
    fin.expenses.filter((e) => e.date.startsWith(month)).forEach((e) => { map[e.cat] = (map[e.cat] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [fin.expenses, month]);
  const catMax = Math.max(1, ...catTotals.map(([, v]) => v));
  const monthSpendShown = catTotals.reduce((a, [, v]) => a + v, 0);

  /* ---------- income */
  const [incSource, setIncSource] = useState("");
  const [incAmount, setIncAmount] = useState("");
  const addIncome = () => {
    const a = parseAmount(incAmount);
    if (!incSource.trim() || !a) return;
    const inc = { id: uid(), source: incSource.trim(), amount: a, date: today() };
    setFin((f) => ({ ...f, incomes: [inc, ...f.incomes] }));
    mirror("/finance/incomes", { method: "POST", body: incToApi(inc) });
    setIncSource(""); setIncAmount("");
  };
  const delIncome = (id) => {
    setFin((f) => ({ ...f, incomes: f.incomes.filter((i) => i.id !== id) }));
    mirror(`/finance/incomes/${id}`, { method: "DELETE" });
  };
  const incomeMonth = fin.incomes.filter((i) => i.date.startsWith(thisMonth)).reduce((a, i) => a + i.amount, 0);
  const incomesShown = fin.incomes.filter((i) => i.date.startsWith(month));

  /* ---------- bills (recurring + inline edit) */
  const [bTitle, setBTitle] = useState("");
  const [bAmount, setBAmount] = useState("");
  const [bDue, setBDue] = useState("");
  const [bRecur, setBRecur] = useState("");
  const [editBill, setEditBill] = useState(null); // {id, title, amount, due, recur}
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const addBill = () => {
    const a = parseAmount(bAmount);
    if (!bTitle.trim() || !a || !bDue) return;
    const bill = { id: uid(), title: bTitle.trim(), amount: a, due: bDue, paid: false, recur: bRecur || null };
    setFin((f) => ({ ...f, bills: [...f.bills, bill] }));
    mirror("/finance/bills", { method: "POST", body: billToApi(bill) });
    setBTitle(""); setBAmount(""); setBDue(""); setBRecur("");
  };

  /* paying a recurring bill auto-schedules the next occurrence */
  const setPaid = (id, paid) => {
    const bill = fin.bills.find((b) => b.id === id);
    setFin((f) => {
      const bill = f.bills.find((b) => b.id === id);
      if (!bill) return f;
      let bills = f.bills.map((b) => (b.id === id ? { ...b, paid, paidOn: paid ? today() : undefined } : b));
      if (paid && bill.recur) {
        const nextDue = advanceDue(bill.due, bill.recur);
        const exists = f.bills.some((b) => !b.paid && b.title === bill.title && b.recur === bill.recur && b.due === nextDue);
        if (!exists) bills = [...bills, { id: uid(), title: bill.title, amount: bill.amount, due: nextDue, paid: false, recur: bill.recur }];
      }
      return { ...f, bills };
    });
    if (!bill) return;
    if (paid) {
      /* the server owns recurrence: /pay marks the bill paid AND schedules
       * the next occurrence itself — do NOT also upsert the local next bill
       * (local/server next-occurrence ids differ this phase; the local copy
       * above keeps offline mode working). */
      mirror(`/finance/bills/${id}/pay`, { method: "POST" });
    } else {
      mirror("/finance/bills", { method: "POST", body: billToApi({ ...bill, paid: false, paidOn: undefined }) });
    }
  };

  const [armBill, setArmBill] = useState(null);   // bill id awaiting click-again delete confirm
  useEffect(() => {
    if (!armBill) return;
    const t = setTimeout(() => setArmBill(null), 3000);
    return () => clearTimeout(t);
  }, [armBill]);
  const delBill = (id) => {
    if (armBill !== id) { setArmBill(id); return; }   // no window.confirm — blocked in embedded browsers
    setFin((f) => ({ ...f, bills: f.bills.filter((b) => b.id !== id) }));
    mirror(`/finance/bills/${id}`, { method: "DELETE" });
    setArmBill(null);
  };
  const saveBillEdit = () => {
    const a = parseAmount(editBill.amount);
    if (!editBill.title.trim() || !a || !editBill.due) return;
    const patch = { title: editBill.title.trim(), amount: a, due: editBill.due, recur: editBill.recur || null };
    setFin((f) => ({
      ...f,
      bills: f.bills.map((b) => (b.id === editBill.id ? { ...b, ...patch } : b)),
    }));
    const prev = fin.bills.find((b) => b.id === editBill.id);
    if (prev) mirror("/finance/bills", { method: "POST", body: billToApi({ ...prev, ...patch }) });
    setEditBill(null);
  };

  const dropOn = (colKey) => {
    if (dragId) setPaid(dragId, colKey === "paid");
    setDragId(null);
    setOverCol(null);
  };

  const pending = fin.bills.filter((b) => !b.paid).reduce((a, b) => a + b.amount, 0);
  const paidMonth = fin.bills.filter((b) => b.paid && (b.paidOn || "").startsWith(thisMonth)).reduce((a, b) => a + b.amount, 0);
  const overdue = fin.bills.filter((b) => !b.paid && daysAgo(b.due) > 0);
  const recurringMonthly = fin.bills
    .filter((b) => !b.paid && b.recur)
    .reduce((a, b) => a + b.amount * RECUR_MONTHLY[b.recur], 0);

  /* savings = income − (expenses + bills paid) this calendar month */
  const outMonth = spentMonth + paidMonth;
  const savedMonth = incomeMonth - outMonth;
  const savingsRate = incomeMonth > 0 ? Math.round((savedMonth / incomeMonth) * 100) : null;

  /* ---------- budgets + goals (children own the UI; persistence + mirroring live here) */
  const changeBudgets = (budgets) => {
    const prev = fin.budgets || { overall: null, byCat: {} };
    setFin((f) => ({ ...f, budgets }));
    /* PUT per changed scope; a cleared cap mirrors as 0 (BudgetIn.cap_cents
     * is required — the UI already treats a 0/absent cap as "no cap"). */
    if ((prev.overall ?? null) !== (budgets.overall ?? null))
      mirror("/finance/budgets", { method: "PUT", body: { scope: "overall", cap_cents: toCents(budgets.overall ?? 0) } });
    const cats = new Set([...Object.keys(prev.byCat || {}), ...Object.keys(budgets.byCat || {})]);
    cats.forEach((c) => {
      if ((prev.byCat?.[c] ?? null) !== (budgets.byCat?.[c] ?? null))
        mirror("/finance/budgets", { method: "PUT", body: { scope: c, cap_cents: toCents(budgets.byCat?.[c] ?? 0) } });
    });
  };
  const changeGoals = (goals) => {
    const prev = fin.goals || [];
    setFin((f) => ({ ...f, goals }));
    /* FinanceGoals hands back the whole next array — diff by id */
    const prevById = new Map(prev.map((g) => [g.id, g]));
    goals.forEach((g) => {
      const p = prevById.get(g.id);
      if (!p || p.name !== g.name || p.target !== g.target || p.saved !== g.saved)
        mirror("/finance/goals", { method: "POST", body: goalToApi(g) });
    });
    const kept = new Set(goals.map((g) => g.id));
    prev.forEach((g) => { if (!kept.has(g.id)) mirror(`/finance/goals/${g.id}`, { method: "DELETE" }); });
  };

  /* ---------- CSV export (spreadsheet-friendly backup) */
  const exportCSV = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["type", "date", "description", "category", "payment method", "amount", "currency", "status", "due", "recurrence"]];
    fin.expenses.forEach((e) => rows.push(["expense", e.date, e.desc, e.cat, methodName(e.pay) || "", e.amount, fin.currency, "", "", ""]));
    fin.bills.forEach((b) => rows.push(["bill", b.paidOn || "", b.title, "Bills", "", b.amount, fin.currency, b.paid ? "paid" : "pending", b.due, b.recur || "one-time"]));
    fin.incomes.forEach((i) => rows.push(["income", i.date, i.source, "", "", i.amount, fin.currency, "", "", ""]));
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `vault-finance-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [tab, setTab] = useState("board"); // board | analytics

  /* ---------- ✦ natural-language smart add */
  const aiReady = useAiReady();
  const [smartQ, setSmartQ] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartMsg, setSmartMsg] = useState(null);
  const smartAdd = async () => {
    const text = smartQ.trim();
    if (!text || smartBusy) return;
    setSmartBusy(true); setSmartMsg(null);
    try {
      const out = await askJSON(
        `Today is ${today()}. Parse this personal finance entry:\n"${text}"\n\n` +
        `An entry with a due date (or words like "due", "bill", "pay by") is a bill; money already spent is an expense; salary/payment received is income. ` +
        `Detect recurrence words ("monthly", "every week", "subscription" implies monthly). Resolve relative dates to ISO. Amounts are plain numbers.`,
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["expense", "bill", "income"] },
            description: { type: "string" },
            amount: { type: "number" },
            category: { type: "string", enum: CATEGORIES },
            date: { type: "string", format: "date" },
            due: { type: "string", format: "date" },
            recurrence: { type: "string", enum: ["weekly", "monthly", "yearly"] },
          },
          required: ["kind", "description", "amount"],
          additionalProperties: false,
        },
        { effort: "low", maxTokens: 2000 }
      );
      if (!(out.amount > 0)) throw new Error("Couldn't find an amount in that.");
      if (out.kind === "bill") {
        const due = out.due || out.date || today();
        const bill = { id: uid(), title: out.description, amount: out.amount, due, paid: false, recur: out.recurrence || null };
        setFin((f) => ({ ...f, bills: [...f.bills, bill] }));
        mirror("/finance/bills", { method: "POST", body: billToApi(bill) });
        setSmartMsg({ ok: true, text: `Added ${out.recurrence ? out.recurrence + " " : ""}bill: ${out.description} — ${fmt(out.amount)} due ${fmtStamp(due)}` });
      } else if (out.kind === "income") {
        const date = out.date || today();
        const inc = { id: uid(), source: out.description, amount: out.amount, date };
        setFin((f) => ({ ...f, incomes: [inc, ...f.incomes] }));
        mirror("/finance/incomes", { method: "POST", body: incToApi(inc) });
        setSmartMsg({ ok: true, text: `Added income: ${out.description} — ${fmt(out.amount)} (${fmtStamp(date)})` });
      } else {
        const date = out.date || today();
        const exp = { id: uid(), desc: out.description, amount: out.amount, cat: out.category || "Other", date };
        setFin((f) => ({ ...f, expenses: [exp, ...f.expenses] }));
        mirror("/finance/expenses", { method: "POST", body: expToApi(exp) });
        setSmartMsg({ ok: true, text: `Added expense: ${out.description} — ${fmt(out.amount)} (${out.category || "Other"}, ${fmtStamp(date)})` });
      }
      setSmartQ("");
    } catch (e) {
      setSmartMsg({ ok: false, text: e.message });
    } finally {
      setSmartBusy(false);
    }
  };

  return (
    <>
      {/* summary tiles */}
      <div className="tiles">
        <div className="tile"><div className="k" style={{ color: "var(--stamp)" }}>◎ Spent today</div><div className="n">{fmt(spentToday)}</div><div className="d">{fin.expenses.filter((e) => e.date === today()).length} expense(s)</div></div>
        <div className="tile"><div className="k" style={{ color: "var(--moss)" }}>◈ Spent this month</div><div className="n">{fmt(outMonth)}</div><div className="d">{fmt(spentMonth)} expenses · {fmt(paidMonth)} bills</div></div>
        <div className="tile"><div className="k" style={{ color: "var(--gold)" }}>⧗ Pending payments</div><div className="n">{fmt(pending)}</div><div className="d">{overdue.length > 0 ? <b style={{ color: "var(--stamp)" }}>{overdue.length} overdue!</b> : `${fin.bills.filter((b) => !b.paid).length} open bill(s)`}{recurringMonthly > 0 && <> · ≈{fmt(Math.round(recurringMonthly))}/mo recurring</>}</div></div>
        <div className="tile"><div className="k" style={{ color: "var(--blue)" }}>▲ Income this month</div><div className="n">{fmt(incomeMonth)}</div><div className="d">{fin.incomes.filter((i) => i.date.startsWith(thisMonth)).length} entr{fin.incomes.filter((i) => i.date.startsWith(thisMonth)).length === 1 ? "y" : "ies"}</div></div>
        <div className="tile"><div className="k" style={{ color: savedMonth >= 0 ? "var(--moss)" : "var(--stamp)" }}>✦ Saved this month</div><div className="n">{fmt(savedMonth)}</div><div className="d">{savingsRate !== null ? <b style={{ color: savedMonth >= 0 ? "var(--moss)" : "var(--stamp)" }}>{savingsRate}% savings rate</b> : "log income to see your rate"}</div></div>
        <div className="tile"><div className="k" style={{ color: "var(--violet)" }}>✓ Paid this month</div><div className="n">{fmt(paidMonth)}</div><div className="d">
          <select className="cursel" value={fin.currency || "USD"} aria-label="Display currency"
            title="Display currency — USD by default"
            onChange={(e) => setFin((f) => ({ ...f, currency: e.target.value, currencyChosen: true }))}>
            {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.sym.trim()}</option>)}
          </select>
        </div></div>
      </div>

      {/* ✦ natural-language quick entry */}
      <div className="smartbar">
        <span className="av-spark" aria-hidden="true">✦</span>
        <input value={smartQ} onChange={(e) => setSmartQ(e.target.value)}
          placeholder={aiReady
            ? `Type it like you'd say it — "coffee 4.50 yesterday", "salary 3200", "netflix 15.99 monthly due 1st"`
            : "✦ Smart add is off — set up an AI model in Settings"}
          disabled={!aiReady}
          aria-label="Smart add expense, bill or income"
          onKeyDown={(e) => e.key === "Enter" && smartAdd()} />
        <button className="btn sm" onClick={smartAdd} disabled={smartBusy || !smartQ.trim() || !aiReady}>
          {smartBusy ? "Parsing…" : "Add"}
        </button>
      </div>
      {smartMsg && <div className={`smartmsg ${smartMsg.ok ? "ok" : "err"}`}>{smartMsg.ok ? "✓" : "⚠"} {smartMsg.text}</div>}

      {/* Board | Analytics tabs + export */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="doctabs" role="tablist" aria-label="Finance view" style={{ display: "inline-flex" }}>
          <button className={tab === "board" ? "on" : ""} role="tab" aria-selected={tab === "board"}
            onClick={() => setTab("board")}>▥ Board</button>
          <button className={tab === "payments" ? "on" : ""} role="tab" aria-selected={tab === "payments"}
            onClick={() => setTab("payments")}>⧗ Bills & Budgets{overdue.length > 0 && <span className="tabbadge">{overdue.length}</span>}</button>
          <button className={tab === "analytics" ? "on" : ""} role="tab" aria-selected={tab === "analytics"}
            onClick={() => setTab("analytics")}>◔ Analytics</button>
        </div>
        <button className="btn ghost sm" onClick={exportCSV} title="Download every expense, bill and income as a spreadsheet-ready CSV">⬇ CSV</button>
      </div>

      {tab === "analytics" && <FinanceAnalytics fin={fin} fmt={fmt} spentByCat={spentByCat} savingsRate={savingsRate} recurringMonthly={recurringMonthly} />}

      {tab === "payments" && (<>
      {/* pending payments kanban */}
      <div className="card">
        <h3>Pending payments {overdue.length > 0 && <span className="age">{overdue.length} OVERDUE</span>}</h3>
        <div className="fform">
          <input placeholder="Bill — e.g. credit card, rent, Netflix…" value={bTitle}
            onChange={(e) => setBTitle(e.target.value)} aria-label="Bill name"
            onKeyDown={(e) => e.key === "Enter" && addBill()} />
          <input type="number" min="0" step="0.01" placeholder={`Amount (${cur})`} value={bAmount}
            onChange={(e) => setBAmount(e.target.value)} aria-label="Bill amount"
            onKeyDown={(e) => e.key === "Enter" && addBill()} />
          <input type="date" value={bDue} onChange={(e) => setBDue(e.target.value)} aria-label="Due date" />
          <select value={bRecur} onChange={(e) => setBRecur(e.target.value)} aria-label="Recurrence"
            title="Recurring bills re-schedule themselves when you mark them paid">
            {RECUR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn" onClick={addBill} disabled={!bTitle.trim() || !parseAmount(bAmount) || !bDue}>+ Add bill</button>
        </div>
        <div className="kanban" style={{ marginTop: 12 }}>
          {COLS.map((c) => {
            const cards = fin.bills
              .filter((b) => colOf(b) === c.key)
              .sort((a, b) => a.due.localeCompare(b.due));
            return (
              <div key={c.key} className={`kcol ${overCol === c.key && dragId ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(c.key); }}
                onDragLeave={() => setOverCol((o) => (o === c.key ? null : o))}
                onDrop={(e) => { e.preventDefault(); dropOn(c.key); }}>
                <div className="kcol-head">
                  <span className="kdot" style={{ background: c.color }} aria-hidden="true" />
                  <span className="ktitle">{c.title}</span>
                  <span className="kcount mono">{cards.length}</span>
                </div>
                {cards.length === 0 && <div className="kempty">{c.key === "paid" ? "Drag a bill here when you pay it" : "Nothing here"}</div>}
                {cards.map((b) => {
                  const od = !b.paid && daysAgo(b.due) > 0;
                  const dleft = -daysAgo(b.due);
                  if (editBill?.id === b.id) return (
                    <div key={b.id} className="kcard editcard">
                      <input value={editBill.title} aria-label="Bill name"
                        onChange={(e) => setEditBill({ ...editBill, title: e.target.value })} />
                      <div className="editrow">
                        <input type="number" min="0" step="0.01" value={editBill.amount} aria-label="Amount"
                          onChange={(e) => setEditBill({ ...editBill, amount: e.target.value })} />
                        <input type="date" value={editBill.due} aria-label="Due date"
                          onChange={(e) => setEditBill({ ...editBill, due: e.target.value })} />
                        <select value={editBill.recur || ""} aria-label="Recurrence"
                          onChange={(e) => setEditBill({ ...editBill, recur: e.target.value })}>
                          {RECUR_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                      <div className="editrow">
                        <button className="kbtn" onClick={saveBillEdit}>✓ Save</button>
                        <button className="kbtn kdel" onClick={() => setEditBill(null)}>Cancel</button>
                      </div>
                    </div>
                  );
                  return (
                    <div key={b.id} className={`kcard ${dragId === b.id ? "dragging" : ""}`}
                      draggable
                      onDragStart={() => setDragId(b.id)}
                      onDragEnd={() => { setDragId(null); setOverCol(null); }}>
                      <div className="kcard-top">
                        <span className="kcard-title" style={{ textDecoration: b.paid ? "line-through" : "none", opacity: b.paid ? 0.6 : 1 }}>
                          {b.title}{b.recur && <span className="recurtag mono" title={`Repeats ${b.recur} — reschedules itself when paid`}>↻ {b.recur}</span>}
                        </span>
                        <span className="kamount mono">{fmt(b.amount)}</span>
                      </div>
                      <div className="kcard-foot">
                        <span className="kdate mono" style={{ marginLeft: 0, color: od ? "var(--stamp)" : undefined }}>
                          {b.paid
                            ? `paid ${fmtStamp(b.paidOn || b.due)}`
                            : od
                              ? `OVERDUE ${daysAgo(b.due)}d — was due ${fmtStamp(b.due)}`
                              : `due ${fmtStamp(b.due)}${dleft <= 7 ? ` · ${dleft}d left` : ""}`}
                        </span>
                        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          {!b.paid
                            ? <button className="kbtn" title="Mark as paid" onClick={() => setPaid(b.id, true)}>✓ Paid</button>
                            : <button className="kbtn" title="Move back to pending" onClick={() => setPaid(b.id, false)}>↩</button>}
                          <button className="kbtn" title="Edit bill" aria-label={`Edit ${b.title}`}
                            onClick={() => setEditBill({ id: b.id, title: b.title, amount: b.amount, due: b.due, recur: b.recur || "" })}>✎</button>
                          <button className={`kbtn kdel ${armBill === b.id ? "armed" : ""}`}
                            title={armBill === b.id ? "Click again to delete this bill" : "Delete bill"} aria-label={`Delete ${b.title}`}
                            onClick={() => delBill(b.id)}>{armBill === b.id ? "Sure?" : "✕"}</button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* payment methods — the user's own cards & options */}
      <div className="card">
        <h3>💳 Payment methods <span className="age">{monthLabel.toUpperCase()}</span></h3>
        <div className="fform">
          <input placeholder="Name it how you know it — “Chase Sapphire”, “Amex Gold ···· 1005”…" value={pmName}
            onChange={(e) => setPmName(e.target.value)} aria-label="Payment method name"
            onKeyDown={(e) => e.key === "Enter" && addMethod()} />
          <select value={pmKind} onChange={(e) => setPmKind(e.target.value)} aria-label="Payment method type">
            {PAY_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="btn sm" onClick={addMethod} disabled={!pmName.trim()}>+ Add</button>
        </div>
        {(() => {
          const monthExp = fin.expenses.filter((e) => (e.date || "").startsWith(month));
          const spentBy = (id) => monthExp.filter((e) => e.pay === id).reduce((a, e) => a + e.amount, 0);
          const max = Math.max(1, ...methods.map((m) => spentBy(m.id)));
          return methods.map((m) => (
            <div key={m.id} className="fcatrow">
              <span className="fcat mono" title={methodKind(m.id)}>{(PAY_KINDS.find(([k]) => k === m.kind)?.[1] || "").split(" ")[0].toUpperCase()}</span>
              <span className="fdesc" style={{ minWidth: 130 }}>{m.name}</span>
              <div className="fbar"><div className="fbar-fill" style={{ width: `${(spentBy(m.id) / max) * 100}%` }} /></div>
              <span className="mono famt">{fmt(spentBy(m.id))}</span>
              <button className={`kbtn kdel ${pmArm === m.id ? "armed" : ""}`}
                title={pmArm === m.id ? "Click again to remove — past expenses keep their history" : "Remove this payment method"}
                aria-label={`Remove ${m.name}`}
                onClick={() => delMethod(m.id)}>{pmArm === m.id ? "Sure?" : "✕"}</button>
            </div>
          ));
        })()}
        <div className="m" style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 8 }}>
          Pick a method when logging an expense — the bars show where this month's spending landed.
        </div>
      </div>

      {/* budgets + savings goals — all forward planning lives on this tab */}
      <FinanceBudgets budgets={fin.budgets} spentByCat={spentByCat} spentMonth={spentMonth} fmt={fmt}
        categories={CATEGORIES}
        onChange={changeBudgets} />
      <FinanceGoals goals={fin.goals} fmt={fmt}
        onChange={changeGoals} />
      </>)}

      {tab === "board" && (<>
      {/* daily expenses + category breakdown */}
      <div className="charts" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <div className="card">
          <h3 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Daily expenses
            <span className="mnav">
              <button onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
              <span className="mono">{monthLabel}</span>
              <button onClick={() => shiftMonth(1)} disabled={month >= thisMonth} aria-label="Next month">›</button>
            </span>
          </h3>
          <div className="fform">
            <input placeholder="What did you spend on?" value={desc}
              onChange={(e) => setDesc(e.target.value)} aria-label="Expense description"
              onKeyDown={(e) => e.key === "Enter" && addExpense()} />
            <input type="number" min="0" step="0.01" placeholder={`Amount (${cur})`} value={amount}
              onChange={(e) => setAmount(e.target.value)} aria-label="Expense amount"
              onKeyDown={(e) => e.key === "Enter" && addExpense()} />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={pay || methods[0]?.id || ""} onChange={(e) => setPay(e.target.value)}
              aria-label="Paid with" title="Which card or payment option you used — manage them in Bills & Budgets">
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn" onClick={addExpense} disabled={!desc.trim() || !parseAmount(amount)}>+ Add</button>
          </div>
          {byDay.length === 0 && <div className="empty" style={{ marginTop: 12 }}>No expenses in {monthLabel}.</div>}
          {byDay.map(([d, list]) => (
            <div key={d} className="fday">
              <div className="fday-head">
                <span className="mono">{d === today() ? "TODAY" : fmtStamp(d)}</span>
                <span className="mono fday-total">{fmt(list.reduce((a, e) => a + e.amount, 0))}</span>
              </div>
              {list.map((e) => editExp?.id === e.id ? (
                <div key={e.id} className="fexp editexp">
                  <input value={editExp.desc} aria-label="Description" style={{ flex: 1 }}
                    onChange={(ev) => setEditExp({ ...editExp, desc: ev.target.value })} />
                  <input type="number" min="0" step="0.01" value={editExp.amount} aria-label="Amount" style={{ width: 90 }}
                    onChange={(ev) => setEditExp({ ...editExp, amount: ev.target.value })} />
                  <select value={editExp.cat} aria-label="Category"
                    onChange={(ev) => setEditExp({ ...editExp, cat: ev.target.value })}>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <select value={editExp.pay || ""} aria-label="Paid with"
                    onChange={(ev) => setEditExp({ ...editExp, pay: ev.target.value || undefined })}>
                    <option value="">— no method —</option>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <input type="date" value={editExp.date} aria-label="Date"
                    onChange={(ev) => setEditExp({ ...editExp, date: ev.target.value })} />
                  <button className="kbtn" onClick={saveExpEdit}>✓</button>
                  <button className="kbtn kdel" onClick={() => setEditExp(null)}>✕</button>
                </div>
              ) : (
                <div key={e.id} className="fexp">
                  <span className="fcat mono">{e.cat}</span>
                  <span className="fdesc">{e.desc}</span>
                  {e.pay && methodName(e.pay) && (
                    <span className="paychip mono" title={`Paid with ${methodName(e.pay)}${methodKind(e.pay) ? ` (${methodKind(e.pay)})` : ""}`}>
                      {methodName(e.pay)}
                    </span>
                  )}
                  <span className="mono famt">{fmt(e.amount)}</span>
                  <button className="kbtn" title="Edit expense" aria-label={`Edit ${e.desc}`}
                    onClick={() => setEditExp({ id: e.id, desc: e.desc, amount: e.amount, cat: e.cat, date: e.date, pay: e.pay })}>✎</button>
                  <button className="kbtn kdel" title="Delete expense" aria-label={`Delete ${e.desc}`}
                    onClick={() => delExpense(e.id)}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div>
          <div className="card">
            <h3>Where it goes <span className="age">{monthLabel.toUpperCase()}</span></h3>
            {catTotals.length === 0 && <div className="empty" style={{ padding: 18 }}>Category breakdown appears once you log expenses.</div>}
            {catTotals.map(([c, v]) => (
              <div key={c} className="fcatrow">
                <span className="fcat mono">{c}</span>
                <div className="fbar"><div className="fbar-fill" style={{ width: `${(v / catMax) * 100}%` }} /></div>
                <span className="mono famt">{fmt(v)}</span>
              </div>
            ))}
            {catTotals.length > 0 && (
              <div className="fcatrow" style={{ borderTop: `1px solid var(--line)`, paddingTop: 8, marginTop: 4 }}>
                <span className="fcat mono" style={{ fontWeight: 600 }}>TOTAL</span>
                <div style={{ flex: 1 }} />
                <span className="mono famt" style={{ fontWeight: 600 }}>{fmt(monthSpendShown)}</span>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Income <span className="age">{monthLabel.toUpperCase()}</span></h3>
            <div className="fform">
              <input placeholder="Source — salary, freelance…" value={incSource} style={{ minWidth: 120 }}
                onChange={(e) => setIncSource(e.target.value)} aria-label="Income source"
                onKeyDown={(e) => e.key === "Enter" && addIncome()} />
              <input type="number" min="0" step="0.01" placeholder={cur} value={incAmount} style={{ width: 100 }}
                onChange={(e) => setIncAmount(e.target.value)} aria-label="Income amount"
                onKeyDown={(e) => e.key === "Enter" && addIncome()} />
              <button className="btn sm" onClick={addIncome} disabled={!incSource.trim() || !parseAmount(incAmount)}>+ Add</button>
            </div>
            {incomesShown.length === 0 && <div className="m" style={{ color: "var(--ink-soft)", marginTop: 10 }}>No income logged in {monthLabel} — add salary or freelance payments to track your savings rate.</div>}
            {incomesShown.map((i) => (
              <div key={i.id} className="fexp">
                <span className="fcat mono" style={{ background: "var(--moss-soft)", color: "var(--moss)" }}>{fmtStamp(i.date).slice(0, 6)}</span>
                <span className="fdesc">{i.source}</span>
                <span className="mono famt" style={{ color: "var(--moss)" }}>+{fmt(i.amount)}</span>
                <button className="kbtn kdel" title="Delete income" aria-label={`Delete ${i.source}`}
                  onClick={() => delIncome(i.id)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      </>)}
    </>
  );
}

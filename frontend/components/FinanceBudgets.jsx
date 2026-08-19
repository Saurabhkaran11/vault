"use client";

import React, { useState } from "react";

/* Monthly budgets: an overall cap plus per-category caps, each with a live
 * progress bar against this month's spending. Bars go moss → gold (80%) →
 * red (over). Caps are stored in fin.budgets = {overall, byCat}. */

const barColor = (pct) => (pct >= 100 ? "var(--stamp)" : pct >= 80 ? "var(--gold)" : "var(--moss)");

function BudgetRow({ label, cap, spent, fmt, onCap }) {
  const [draft, setDraft] = useState(cap ?? "");
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : null;
  const commit = () => {
    const v = parseFloat(draft);
    onCap(Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
  };
  return (
    <div className="brow">
      <span className="fcat mono">{label}</span>
      <div className="fbar" title={cap ? `${fmt(spent)} of ${fmt(cap)}` : "No cap set"}>
        <div className="fbar-fill" style={{ width: `${cap ? Math.min(100, (spent / cap) * 100) : 0}%`, background: cap ? barColor(pct) : "var(--line)" }} />
      </div>
      <span className="mono bstat" style={{ color: pct === null ? "var(--ink-soft)" : barColor(pct) }}>
        {cap ? `${fmt(spent)} / ${fmt(cap)} · ${pct}%` : spent > 0 ? fmt(spent) : "—"}
      </span>
      <input className="bcap" type="number" min="0" step="1" placeholder="cap"
        value={draft} aria-label={`Monthly budget for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
    </div>
  );
}

export default function FinanceBudgets({ budgets, spentByCat, spentMonth, fmt, categories, onChange }) {
  const [open, setOpen] = useState(true);
  const capped = categories.filter((c) => budgets.byCat[c] > 0);
  const overCount = capped.filter((c) => spentByCat[c] > budgets.byCat[c]).length
    + (budgets.overall > 0 && spentMonth > budgets.overall ? 1 : 0);

  return (
    <div className="card" style={overCount ? { borderColor: "var(--stamp)" } : undefined}>
      <button className="resurface-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden="true" style={{ marginRight: 8 }}>{open ? "▾" : "▸"}</span>
        <span className="rh-title">Budgets — this month</span>
        <span className="age">
          {overCount > 0 ? `${overCount} OVER BUDGET` : capped.length || budgets.overall ? "ON TRACK" : "SET YOUR CAPS"}
        </span>
      </button>
      {open && (
        <>
          <BudgetRow label="OVERALL" cap={budgets.overall} spent={spentMonth} fmt={fmt}
            onCap={(v) => onChange({ ...budgets, overall: v })} />
          {categories.map((c) => (
            <BudgetRow key={c} label={c} cap={budgets.byCat[c]} spent={spentByCat[c] || 0} fmt={fmt}
              onCap={(v) => onChange({ ...budgets, byCat: { ...budgets.byCat, [c]: v || undefined } })} />
          ))}
          <div className="m" style={{ color: "var(--ink-soft)", marginTop: 8, fontSize: 12 }}>
            Type a cap and press Enter — bars turn gold at 80% and red when over. Clear a cap to stop tracking it.
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import React, { useState } from "react";

/* Monthly budgets: an overall cap plus per-category caps, each with a live
 * progress bar against this month's spending. Bars go moss → gold (80%) →
 * red (over). Caps are stored in fin.budgets = {overall, byCat}. */

const barColor = (pct) => (pct >= 100 ? "var(--stamp)" : pct >= 80 ? "var(--gold)" : "var(--moss)");

function BudgetRow({ label, cap, spent, fmt, onCap, maxCap }) {
  const [draft, setDraft] = useState(cap ?? "");
  const [clamped, setClamped] = useState(false);
  const pct = cap > 0 ? Math.round((spent / cap) * 100) : null;
  const commit = () => {
    let v = parseFloat(draft);
    if (!Number.isFinite(v) || v <= 0) { onCap(null); setClamped(false); return; }
    /* a category cap can never exceed what's left of the overall budget —
       clamp it and show the user the number we actually kept */
    if (maxCap != null && v > maxCap) { v = maxCap; setDraft(String(maxCap)); setClamped(true); }
    else setClamped(false);
    onCap(Math.round(v * 100) / 100);
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
      <input className="bcap" type="number" min="0" step="1"
        placeholder={maxCap != null ? `≤ ${Math.floor(maxCap)}` : "cap"}
        title={maxCap != null ? `Up to ${fmt(maxCap)} is still available inside your budget` : undefined}
        value={draft} aria-label={`Budget cap for ${label}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
      {clamped && <span className="bclamp mono">capped at {fmt(maxCap)} — that&rsquo;s all that&rsquo;s left of your budget</span>}
    </div>
  );
}

const PERIODS = [["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]];
const SEG_COLORS = ["var(--moss)", "var(--azure)", "var(--gold)", "var(--violet)", "var(--blue)", "#5B8DC9", "#7BA05B"];

export default function FinanceBudgets({ budgets, spentByCat, spentMonth, fmt, categories, onChange, period = "monthly", periodWord = "this month", onPeriod }) {
  const [open, setOpen] = useState(true);
  const capped = categories.filter((c) => budgets.byCat[c] > 0);
  const overCount = capped.filter((c) => spentByCat[c] > budgets.byCat[c]).length
    + (budgets.overall > 0 && spentMonth > budgets.overall ? 1 : 0);
  /* totals across the per-category rows, shown at the bottom */
  const capTotal = capped.reduce((a, c) => a + budgets.byCat[c], 0);

  return (
    <div className="card" style={overCount ? { borderColor: "var(--stamp)" } : undefined}>
      <button className="resurface-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden="true" style={{ marginRight: 8 }}>{open ? "▾" : "▸"}</span>
        <span className="rh-title">Budgets — {periodWord}</span>
        <span className="age">
          {overCount > 0 ? `${overCount} OVER BUDGET` : capped.length || budgets.overall ? "ON TRACK" : "SET YOUR CAPS"}
        </span>
      </button>
      {open && (
        <>
          <div className="bperiod">
            <span className="bperiod-label">Budget per</span>
            <div className="doctabs" role="tablist" aria-label="Budget period" style={{ display: "inline-flex" }}>
              {PERIODS.map(([k, label]) => (
                <button key={k} className={period === k ? "on" : ""} role="tab" aria-selected={period === k}
                  onClick={() => onPeriod?.(k)}>{label}</button>
              ))}
            </div>
          </div>

          {/* one number that matters: your total cap for the period */}
          <div className="bhero">
            <div className="bhero-top">
              <span className="bhero-label">Your budget — the most you want to spend {periodWord}</span>
              <span className="mono bstat" style={{ color: budgets.overall > 0 ? barColor(Math.round((spentMonth / budgets.overall) * 100)) : "var(--ink-soft)" }}>
                {budgets.overall > 0
                  ? `${fmt(spentMonth)} spent · ${spentMonth <= budgets.overall ? `${fmt(budgets.overall - spentMonth)} left` : `${fmt(spentMonth - budgets.overall)} over`}`
                  : "not set"}
              </span>
            </div>
            {/* keyed by period so the input's draft resets when the period
                (and therefore the underlying cap) switches */}
            <BudgetRow key={`overall-${period}`} label="BUDGET" cap={budgets.overall} spent={spentMonth} fmt={fmt}
              onCap={(v) => onChange({ ...budgets, overall: v })} />
          </div>

          {/* optional sub-limits inside that budget */}
          <div className="bsub-head">Category limits <span className="bsub-note">
            optional — smaller caps inside your budget{budgets.overall > 0 && capTotal < budgets.overall && <> · <b>{fmt(budgets.overall - capTotal)}</b> left to allocate</>}
          </span></div>
          {budgets.overall > 0 && (
            /* one stacked bar: each category cap is a colored slice of the
               overall budget; the grey tail is what's still free to allocate */
            <div className="balloc">
              <div className="balloc-bar" title={`${fmt(capTotal)} of your ${fmt(budgets.overall)} budget is allocated to categories`}>
                {capped.map((c, i) => (
                  <div key={c} className="balloc-seg" title={`${c}: ${fmt(budgets.byCat[c])} (${Math.round((budgets.byCat[c] / budgets.overall) * 100)}% of budget)`}
                    style={{ width: `${Math.min(100, (budgets.byCat[c] / budgets.overall) * 100)}%`, background: SEG_COLORS[i % SEG_COLORS.length] }} />
                ))}
              </div>
              <span className="balloc-line mono">
                {capTotal <= budgets.overall
                  ? <><b>{fmt(budgets.overall - capTotal)}</b> of {fmt(budgets.overall)} still free to allocate</>
                  : <b style={{ color: "var(--stamp)" }}>{fmt(capTotal - budgets.overall)} over your budget — lower some caps</b>}
              </span>
            </div>
          )}
          {categories.map((c) => (
            <BudgetRow key={`${period}-${c}`} label={c} cap={budgets.byCat[c]} spent={spentByCat[c] || 0} fmt={fmt}
              maxCap={budgets.overall > 0 ? Math.max(0, Math.round((budgets.overall - (capTotal - (budgets.byCat[c] || 0))) * 100) / 100) : null}
              onCap={(v) => onChange({ ...budgets, byCat: { ...budgets.byCat, [c]: v || undefined } })} />
          ))}
          {capped.length > 0 && budgets.overall > 0 && (
            <div className="btotal">
              <span className="btotal-line">
                Your category limits add up to <b>{fmt(capTotal)}</b> — {capTotal > budgets.overall
                  ? <b style={{ color: "var(--stamp)" }}>more than your {fmt(budgets.overall)} budget; lower some so they fit</b>
                  : <>which fits inside your {fmt(budgets.overall)} budget</>}.
              </span>
            </div>
          )}
          <div className="m" style={{ color: "var(--ink-soft)", marginTop: 8, fontSize: 12 }}>
            Type a cap and press Enter — bars turn gold at 80% and red when over. Clear a cap to stop tracking it.
          </div>
        </>
      )}
    </div>
  );
}

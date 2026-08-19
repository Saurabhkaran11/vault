"use client";

import React from "react";

/* First-run onboarding — the opening five minutes, designed.
 *
 * · Brand-new browser (no vault data at all): a welcome dialog offers
 *   "explore with sample data" or "start clean". The choice is theirs —
 *   sample content is labeled, never silently dropped on them.
 * · A getting-started checklist lives on the dashboard until dismissed,
 *   with real progress computed from real data — no fake checkmarks.
 * · Browsers that already hold Vault data are grandfathered: they never
 *   see any of this. Stored in vault.onboard.v1. */

const KEY = "vault.onboard.v1";

export function getOB() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
export function setOB(patch) {
  const next = { ...(getOB() || {}), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/* Decide status on load, BEFORE the stores seed themselves. */
export function initOnboarding() {
  const existing = getOB();
  if (existing) return existing;
  const returning = !!localStorage.getItem("vault.items.v1");
  if (returning) return setOB({ grandfathered: true, dismissed: true });
  return null; // genuinely new — App shows the welcome
}

/* "Start clean": every store gets an empty-but-seeded shell so nothing
 * reseeds sample content on the next load. */
export function startClean() {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  localStorage.setItem("vault.items.v1", JSON.stringify([]));
  localStorage.setItem("vault.todos.v1", JSON.stringify({ version: 2, tasks: [] }));
  localStorage.setItem("vault.finance.v1", JSON.stringify({ version: 2, seeded: true, currency: "USD", currencyChosen: false, expenses: [], bills: [], incomes: [], budgets: { overall: 0, byCat: {} }, goals: [] }));
  localStorage.setItem("vault.boards.v1", JSON.stringify({ version: 1, seeded: true, boards: [] }));
  setOB({ choice: "clean", startedAt: iso, dismissed: false });
}

export function WelcomeModal({ onChoose }) {
  return (
    <div className="pal-overlay" role="dialog" aria-label="Welcome to Vault">
      <div className="pal welcome">
        <div className="welcome-body">
          <div className="welcome-mark display">Vault</div>
          <p className="welcome-sub">
            Notes, videos, reading, documents, to-dos, boards and money — everything you're
            working on, in one place. Your data stays in this browser.
          </p>
          <div className="welcome-actions">
            <button className="btn welcome-primary" onClick={() => onChoose("sample")}
              title="Look around a furnished vault — delete the samples whenever you like">
              👀 Explore with sample data
            </button>
            <button className="btn ghost welcome-secondary" onClick={() => onChoose("clean")}
              title="Every section starts empty, ready for your own things">
              ✨ Start clean
            </button>
          </div>
          <p className="welcome-fine">
            Sample mode is clearly labeled and everything in it can be deleted.
            Press <span className="kbd">?</span> anytime for keyboard shortcuts.
          </p>
        </div>
      </div>
    </div>
  );
}

/* Checklist steps — each `done` is computed from real state by the caller. */
export function ChecklistCard({ steps, sampleMode, onDismiss, onGo }) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <div className="card obcard">
      <div className="wstrip-head">
        <h3 style={{ margin: 0 }}>Getting started</h3>
        <span className="cardsub mono">{done}/{steps.length} done</span>
      </div>
      <div className="tl-bar obbar"><div className="tl-bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="oblist">
        {steps.map((s) => (
          <button key={s.id} className={`obstep ${s.done ? "done" : ""}`}
            onClick={() => !s.done && onGo(s)} title={s.done ? "Done ✓" : s.hint}>
            <span className="obtick" aria-hidden="true">{s.done ? "✓" : "○"}</span>
            <span className="obtext">{s.label}</span>
            {s.key && !s.done && <span className="kbd">{s.key}</span>}
          </button>
        ))}
      </div>
      {sampleMode && (
        <div className="m obsample">
          You're exploring with sample content — it's all deletable, and an export (E) backs up
          anything you want to keep before experimenting.
        </div>
      )}
      <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={onDismiss}>
        Got it — hide this
      </button>
    </div>
  );
}

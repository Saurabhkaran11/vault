"use client";

import React, { useState } from "react";
import { uid } from "@/lib/id";

/* Savings goals: name + target, with contributions added over time.
 * Stored in fin.goals = [{id, name, target, saved}]. */


export default function FinanceGoals({ goals, fmt, onChange }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [addTo, setAddTo] = useState(null);   // goal id with the contribution input open
  const [contrib, setContrib] = useState("");
  const [arm, setArm] = useState(null);       // goal id awaiting click-again delete confirm
  React.useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(null), 3000);
    return () => clearTimeout(t);
  }, [arm]);

  const add = () => {
    const t = parseFloat(target);
    if (!name.trim() || !(t > 0)) return;
    onChange([...goals, { id: uid(), name: name.trim(), target: Math.round(t * 100) / 100, saved: 0 }]);
    setName(""); setTarget("");
  };
  const contribute = (g) => {
    const v = parseFloat(contrib);
    if (Number.isFinite(v) && v !== 0) {
      onChange(goals.map((x) => (x.id === g.id ? { ...x, saved: Math.max(0, Math.round((x.saved + v) * 100) / 100) } : x)));
    }
    setAddTo(null); setContrib("");
  };
  const remove = (g) => {
    if (arm !== g.id) { setArm(g.id); return; }   // click again to confirm (no window.confirm — blocked in embedded browsers)
    onChange(goals.filter((x) => x.id !== g.id));
    setArm(null);
  };

  return (
    <div className="card">
      <h3>Savings goals</h3>
      <details className="howfold">
        <summary>ⓘ How goals work</summary>
        <div className="fin-how">Saving for something? Name it, say how much it costs, then press <b>＋ Add money</b> each time you put some aside. The bar fills as you get closer.</div>
      </details>
      <div className="fform">
        <input placeholder="What are you saving for? — e.g. MacBook, a trip…" value={name}
          onChange={(e) => setName(e.target.value)} aria-label="Goal name"
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <input type="number" min="0" step="1" placeholder="How much it costs" value={target} style={{ width: 150 }}
          onChange={(e) => setTarget(e.target.value)} aria-label="Goal target"
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="btn sm" onClick={add} disabled={!name.trim() || !(parseFloat(target) > 0)}>+ Add goal</button>
      </div>
      {goals.length === 0 && (
        <div className="m" style={{ color: "var(--ink-soft)", marginTop: 10 }}>
          Nothing yet — try &ldquo;MacBook&rdquo; with a cost of 2,000.
        </div>
      )}
      {goals.map((g) => {
        const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
        const done = g.saved >= g.target;
        const left = Math.max(0, Math.round((g.target - g.saved) * 100) / 100);
        return (
          <div key={g.id} className="grow">
            <div className="grow-head">
              <span className="fdesc" style={{ fontWeight: 600 }}>{done ? "🎉 " : ""}{g.name}</span>
              <span className="mono famt" style={{ color: done ? "var(--moss)" : undefined }}>
                {done ? `saved — ${fmt(g.target)} reached` : `${fmt(g.saved)} saved · ${fmt(left)} to go · ${pct}%`}
              </span>
              {addTo === g.id ? (
                <span style={{ display: "flex", gap: 4 }}>
                  <input type="number" step="0.01" placeholder="+ amount" value={contrib} autoFocus
                    className="bcap" style={{ width: 90 }} aria-label={`Add to ${g.name}`}
                    onChange={(e) => setContrib(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") contribute(g); if (e.key === "Escape") { setAddTo(null); setContrib(""); } }} />
                  <button className="kbtn" onClick={() => contribute(g)}>✓</button>
                </span>
              ) : (
                <button className="kbtn" onClick={() => { setAddTo(g.id); setContrib(""); }}
                  title="Log money you put aside (negative to take some back)">＋ Add money</button>
              )}
              <button className={`kbtn kdel ${arm === g.id ? "armed" : ""}`}
                title={arm === g.id ? "Click again to delete this goal" : "Delete goal"} aria-label={`Delete ${g.name}`}
                onClick={() => remove(g)}>{arm === g.id ? "Sure?" : "✕"}</button>
            </div>
            <div className="fbar" style={{ marginTop: 6 }}>
              <div className="fbar-fill" style={{ width: `${pct}%`, background: done ? "var(--moss)" : "var(--gold)" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

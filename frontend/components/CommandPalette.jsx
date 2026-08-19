"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, fmtStamp } from "@/lib/seed";

/* Command palette — Ctrl+K (or Cmd+K) from anywhere.
   Runs COMMANDS (go-to a view, actions) and searches titles, notes and
   tags across ALL sections. ↑/↓ to move, Enter to run/open, Esc to close. */
export default function CommandPalette({ items, actions = [], open, onClose, onGo }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  /* dialog-standard Escape: works no matter where focus is, so the open
   * state can never diverge from what's on screen (stuck-open palette
   * silently disables every single-key shortcut) */
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cmdHits = actions
      .filter((a) => !needle || (`${a.label} ${a.group || ""} ${a.keywords || ""}`).toLowerCase().includes(needle))
      .map((a) => ({ kind: "cmd", action: a }));
    const tagHits = !needle ? [] :
      [...new Set(items.flatMap((i) => i.tags))]
        .filter((t) => t.includes(needle))
        .map((t) => ({ kind: "tag", tag: t }));
    const itemHits = items
      .filter((i) => !needle || (i.title + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map((i) => ({ kind: "item", item: i }));
    return [...cmdHits, ...tagHits, ...itemHits];
  }, [q, items, actions]);

  useEffect(() => setSel(0), [results.length]);

  if (!open) return null;

  const go = (r) => {
    if (r.kind === "cmd") r.action.run();
    else onGo(r);
    onClose();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[sel]) go(results[sel]);
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Command palette">
      <div className="pal" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Type a command or search — notes, videos, books, docs, #tags…" aria-label="Command or search" />
        <div className="results">
          {results.length === 0 && <div className="none">No matches — try a shorter word</div>}
          {results.map((r, i) => {
            if (r.kind === "cmd") return (
              <div key={`c-${r.action.label}`} className={`res ${i === sel ? "sel" : ""}`}
                onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                <span className="sec" style={{ color: "var(--moss)" }}>{r.action.group || "COMMAND"}</span>
                <span className="rt">{r.action.label}</span>
                {r.action.hint && <span className="rd"><span className="kbd">{r.action.hint}</span></span>}
              </div>
            );
            if (r.kind === "tag") return (
              <div key={`t-${r.tag}`} className={`res ${i === sel ? "sel" : ""}`}
                onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                <span className="sec" style={{ color: "var(--violet)" }}>PROJECT</span>
                <span className="rt">#{r.tag}</span>
                <span className="rd">{`${items.filter((x) => x.tags.includes(r.tag)).length} items`}</span>
              </div>
            );
            return (
              <div key={r.item.id} className={`res ${i === sel ? "sel" : ""}`}
                onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                <span className="sec" style={{ color: SECTIONS[r.item.type].color }}>{SECTIONS[r.item.type].label}</span>
                <span className="rt">{r.item.title}</span>
                <span className="rd">{fmtStamp(r.item.date)}</span>
              </div>
            );
          })}
        </div>
        <div className="tips">
          <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
          <span><span className="kbd">↵</span> run</span>
          <span><span className="kbd">Esc</span> close</span>
          <span style={{ marginLeft: "auto" }}><span className="kbd">?</span> all shortcuts</span>
        </div>
      </div>
    </div>
  );
}

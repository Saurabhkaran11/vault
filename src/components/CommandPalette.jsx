import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, fmtStamp } from "../data/seed.js";

/* P0: global search — Ctrl+K (or Cmd+K) from anywhere.
   Searches titles, notes, and tags across ALL sections.
   ↑/↓ to move, Enter to open, Esc to close. */
export default function CommandPalette({ items, open, onClose, onGo }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const tagHits = !needle ? [] :
      [...new Set(items.flatMap((i) => i.tags))]
        .filter((t) => t.includes(needle))
        .map((t) => ({ kind: "tag", tag: t }));
    const itemHits = items
      .filter((i) => !needle || (i.title + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12)
      .map((i) => ({ kind: "item", item: i }));
    return [...tagHits, ...itemHits];
  }, [q, items]);

  useEffect(() => setSel(0), [results.length]);

  if (!open) return null;

  const go = (r) => {
    onGo(r);
    onClose();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && results[sel]) go(results[sel]);
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Search everything">
      <div className="pal" onClick={(e) => e.stopPropagation()}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Search everything — notes, videos, books, docs, #tags…" aria-label="Search" />
        <div className="results">
          {results.length === 0 && <div className="none">No matches — try a shorter word</div>}
          {results.map((r, i) => r.kind === "tag" ? (
            <div key={`t-${r.tag}`} className={`res ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
              <span className="sec" style={{ color: "var(--violet)" }}>PROJECT</span>
              <span className="rt">#{r.tag}</span>
              <span className="rd">{`${items.filter((x) => x.tags.includes(r.tag)).length} items`}</span>
            </div>
          ) : (
            <div key={r.item.id} className={`res ${i === sel ? "sel" : ""}`}
              onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
              <span className="sec" style={{ color: SECTIONS[r.item.type].color }}>{SECTIONS[r.item.type].label}</span>
              <span className="rt">{r.item.title}</span>
              <span className="rd">{fmtStamp(r.item.date)}</span>
            </div>
          ))}
        </div>
        <div className="tips">
          <span>↑↓ move</span><span>Enter open</span><span>Esc close</span>
        </div>
      </div>
    </div>
  );
}

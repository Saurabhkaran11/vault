"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, fmtStamp } from "@/lib/seed";
import { semanticSearch } from "@/lib/embed";

/* Command palette — Ctrl+K (or Cmd+K) from anywhere.
   Runs COMMANDS (go-to a view, actions) and searches titles, notes and
   tags across ALL sections. ↑/↓ to move, Enter to run/open, Esc to close. */
export default function CommandPalette({ items, actions = [], open, onClose, onGo, inline = false }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open || inline) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open, inline]);

  /* dialog-standard Escape: works no matter where focus is, so the open
   * state can never diverge from what's on screen (stuck-open palette
   * silently disables every single-key shortcut) */
  useEffect(() => {
    if (!open || inline) return;
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, inline, onClose]);

  /* Calm ordering: an empty palette shows just your latest items — not a wall
     of commands. Typing puts YOUR CONTENT first, tags next, and at most four
     matching actions last. */
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      return [...items]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6)
        .map((i) => ({ kind: "item", item: i, group: "Recent" }));
    }
    const itemHits = items
      .filter((i) => (i.title + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(needle))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((i) => ({ kind: "item", item: i, group: "In your vault" }));
    const tagHits = [...new Set(items.flatMap((i) => i.tags))]
      .filter((t) => t.includes(needle))
      .slice(0, 3)
      .map((t) => ({ kind: "tag", tag: t, group: "Tags" }));
    const cmdHits = actions
      .filter((a) => (`${a.label} ${a.group || ""} ${a.keywords || ""}`).toLowerCase().includes(needle))
      .slice(0, 4)
      .map((a) => ({ kind: "cmd", action: a, group: "Actions" }));
    return [...itemHits, ...tagHits, ...cmdHits];
  }, [q, items, actions]);

  /* Semantic hits arrive async (local embeddings via Ollama) and only when an
     index exists — an empty result with a .reason means "no index / no
     Ollama", and the palette stays quiet about it by design. */
  const [semantic, setSemantic] = useState([]);
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 3) { setSemantic([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const hits = await semanticSearch(needle, items, 6);
        if (live) setSemantic(hits.reason ? [] : hits.map(({ item }) => ({ kind: "item", item, group: "Related by meaning" })));
      } catch { if (live) setSemantic([]); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [q, items]);

  const rows = useMemo(() => {
    if (!q.trim() || !semantic.length) return results;
    const seen = new Set(results.filter((r) => r.kind === "item").map((r) => r.item.id));
    return [...results, ...semantic.filter((s) => !seen.has(s.item.id))];
  }, [results, semantic, q]);

  useEffect(() => setSel(0), [rows.length]);

  if (!open && !inline) return null;

  const go = (r) => {
    if (r.kind === "cmd") r.action.run();
    else onGo(r);
    onClose();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && rows[sel]) go(rows[sel]);
    if (e.key === "Escape") onClose();
  };

  const body = (
    <>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Search your vault…" aria-label="Search" />
        <div className="results">
          {!q.trim() && rows.length > 0 && (
            <div className="res-hint">Your latest items — or start typing to search everything you&rsquo;ve saved.</div>
          )}
          {rows.length === 0 && (
            <div className="none">{q.trim() ? <>Nothing matches &ldquo;{q.trim()}&rdquo; — try a shorter word.</> : "Your vault is empty — press C to capture your first item."}</div>
          )}
          {rows.map((r, i) => {
            const header = r.group && (i === 0 || rows[i - 1].group !== r.group)
              ? <div className="res-h mono" key={`h-${r.group}`}>{r.group}</div> : null;
            if (r.kind === "cmd") return (
              <React.Fragment key={`c-${r.action.label}`}>
                {header}
                <div className={`res ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                  <span className="sec" style={{ color: "var(--moss)" }}>{r.action.group || "ACTION"}</span>
                  <span className="rt">{r.action.label}</span>
                  {r.action.hint && <span className="rd"><span className="kbd">{r.action.hint}</span></span>}
                </div>
              </React.Fragment>
            );
            if (r.kind === "tag") return (
              <React.Fragment key={`t-${r.tag}`}>
                {header}
                <div className={`res ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                  <span className="sec" style={{ color: "var(--violet)" }}>TAG</span>
                  <span className="rt">#{r.tag}</span>
                  <span className="rd">{`${items.filter((x) => x.tags.includes(r.tag)).length} items`}</span>
                </div>
              </React.Fragment>
            );
            return (
              <React.Fragment key={r.item.id}>
                {header}
                <div className={`res ${i === sel ? "sel" : ""}`}
                  onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
                  <span className="sec" style={{ color: SECTIONS[r.item.type].color }}>{SECTIONS[r.item.type].label}</span>
                  <span className="rt">{r.item.title}</span>
                  <span className="rd">{fmtStamp(r.item.date)}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        {!inline && (
          <div className="tips">
            <span><span className="kbd">↑</span><span className="kbd">↓</span> move</span>
            <span><span className="kbd">↵</span> run</span>
            <span><span className="kbd">Esc</span> close</span>
            <span style={{ marginLeft: "auto" }}><span className="kbd">?</span> all shortcuts</span>
          </div>
        )}
    </>
  );

  /* plain conditional frames — never an inline wrapper component, which
     would remount (and drop focus) on every keystroke */
  if (inline) return <div className="pal searchpage">{body}</div>;
  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Command palette">
      <div className="pal" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}

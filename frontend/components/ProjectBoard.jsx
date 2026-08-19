"use client";

import React, { useState } from "react";
import { SECTIONS, STATUSES, fmtStamp } from "@/lib/seed";
import { Ic } from "./Icons";

/* Project kanban: every vault item as a card in Inbox / In progress / Done
   columns. Drag a card to a column to change its status. Filter by project
   tag to see one project's progress at a glance. */

const COL_STYLE = {
  "Inbox": { color: "var(--stamp)", soft: "var(--stamp-soft)" },
  "In progress": { color: "var(--gold)", soft: "var(--gold-soft)" },
  "Done": { color: "var(--moss)", soft: "var(--moss-soft)" },
};

export default function ProjectBoard({ items, onUpdate, onGoto, onTag }) {
  const [tagSel, setTagSel] = useState("All");
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [hideDone, setHideDone] = useState(false);
  const shownCols = hideDone ? STATUSES.filter((s) => s !== "Done") : STATUSES;

  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  const pool = items.filter((i) => tagSel === "All" || i.tags.includes(tagSel));
  const done = pool.filter((i) => i.status === "Done").length;
  const pct = pool.length ? Math.round((done / pool.length) * 100) : 0;

  const dropOn = (status) => {
    const it = items.find((i) => i.id === dragId);
    if (it && it.status !== status) onUpdate({ ...it, status });
    setDragId(null);
    setOverCol(null);
  };

  return (
    <>
      <div className="tagband" role="tablist" aria-label="Filter board by project">
        <button className={`fchip ${tagSel === "All" ? "on" : ""}`} role="tab"
          aria-selected={tagSel === "All"} onClick={() => setTagSel("All")}>
          All items · {items.length}
        </button>
        {allTags.map((t) => (
          <button key={t} className={`fchip ${tagSel === t ? "on" : ""}`} role="tab"
            aria-selected={tagSel === t} onClick={() => setTagSel(t)}>
            #{t} · {items.filter((i) => i.tags.includes(t)).length}
          </button>
        ))}
      </div>

      <div className="boardmeta">
        <span className="mono">{pool.length} item{pool.length === 1 ? "" : "s"} · {done} done · {pct}%</span>
        <div className="tl-bar" style={{ width: 120 }}><div className="tl-bar-fill" style={{ width: `${pct}%` }} /></div>
        <button className="kbtn" onClick={() => setHideDone((h) => !h)}
          title="Focus on what's left">{hideDone ? "Show Done" : "Hide Done"}</button>
      </div>

      <div className="kanban" style={hideDone ? { gridTemplateColumns: "repeat(2,1fr)" } : undefined}>
        {shownCols.map((st) => {
          const cards = pool.filter((i) => i.status === st);
          const cs = COL_STYLE[st];
          return (
            <div key={st} className={`kcol ${overCol === st && dragId ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setOverCol(st); }}
              onDragLeave={() => setOverCol((o) => (o === st ? null : o))}
              onDrop={(e) => { e.preventDefault(); dropOn(st); }}>
              <div className="kcol-head">
                <span className="kdot" style={{ background: cs.color }} aria-hidden="true" />
                <span className="ktitle">{st}</span>
                <span className="kcount mono">{cards.length}</span>
              </div>
              {cards.length === 0 && <div className="kempty">Drop cards here</div>}
              {cards.map((it) => {
                const s = SECTIONS[it.type];
                return (
                  <div key={it.id} className={`kcard ${dragId === it.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDragId(it.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}>
                    <div className="kcard-top">
                      <span className="linkic" style={{ background: s.soft, color: s.color }} aria-hidden="true"><Ic name={s.ic} /></span>
                      <span className="kcard-title" role="button" tabIndex={0}
                        title="Open this item in its section"
                        onClick={() => onGoto(it)}
                        onKeyDown={(e) => e.key === "Enter" && onGoto(it)}>
                        {it.alias || it.title}
                      </span>
                    </div>
                    {it.type === "book" && (it.progress || 0) > 0 && (
                      <div className="readbar" style={{ marginTop: 6 }}><div className="readbar-fill" style={{ width: `${it.progress}%` }} /></div>
                    )}
                    <div className="kcard-foot">
                      {it.tags.slice(0, 2).map((t) => (
                        <button key={t} className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginTop: 0 }}
                          onClick={() => onTag(t)}>#{t}</button>
                      ))}
                      <span className="kdate mono">{fmtStamp(it.date)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

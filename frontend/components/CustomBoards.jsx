"use client";

import React, { useEffect, useRef, useState } from "react";
import { mirror } from "@/lib/api";

/* Custom kanban boards — make a board for anything: a feature, a sprint,
 * this week's chores. Custom columns, cards with inline editing, drag &
 * drop between columns. Versioned storage (vault.boards.v1), seeded once.
 *
 * Rendered inside the Projects view: the first tab is the automatic
 * "Vault items" board (passed in as itemsBoard); every other tab is a
 * user-created board. */

const uid = () => Math.random().toString(36).slice(2, 9);
const KEY = "vault.boards.v1";

const seedBoards = () => ([{
  id: "sb1",
  name: "Feature: Vault backend",
  seq: 4,
  sprints: [{ id: "sp1", name: "Sprint 1", ended: null }],
  current: "sp1",
  cols: [
    { id: "c1", title: "Backlog", cards: [{ id: "k1", num: 1, sprint: "sp1", text: "Design the API schema" }, { id: "k2", num: 2, sprint: "sp1", text: "Pick hosting for Postgres" }] },
    { id: "c2", title: "In progress", cards: [{ id: "k3", num: 3, sprint: "sp1", text: "Define data models (items, todos, finance)" }] },
    { id: "c3", title: "Done", cards: [{ id: "k4", num: 4, sprint: "sp1", hours: 3, text: "Choose stack — FastAPI + Postgres" }] },
  ],
}]);

/* Jira-style card keys: board initials + a per-board number that never
 * changes once assigned. Columns whose title reads like "done" count as
 * completed for sprint roll-over and hours tracking. */
const boardPrefix = (name) =>
  (name || "").split(/\s+/).map((w) => w[0]).join("").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "BRD";

/* label colors: stable hash → curated palette (red stays reserved for
 * destructive/overdue states, so it's deliberately not in this set) */
const LABEL_COLORS = [
  ["var(--moss-soft)", "var(--moss)"], ["var(--azure-soft)", "var(--azure)"],
  ["var(--gold-soft)", "var(--gold)"], ["var(--violet-soft)", "var(--violet)"],
  ["var(--blue-soft)", "var(--blue)"],
];
const labelColor = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
};
const parseLabels = (raw) =>
  [...new Set(raw.split(",").map((x) => x.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))];
const DONE_RE = /done|complete|shipped|finished/i;

/* Migration: older saves get card numbers backfilled and a default
 * "Sprint 1" that adopts every existing card. */
const ensureKeys = (boards) => boards.map((b) => {
  let seq = b.seq || 0;
  let cols = (b.cols || []).map((c) => ({ ...c, cards: c.cards.map((k) => (k.num ? k : { ...k, num: ++seq })) }));
  const sprints = b.sprints?.length ? b.sprints : [{ id: "sp1", name: "Sprint 1", ended: null }];
  const current = b.current && sprints.some((s) => s.id === b.current) ? b.current : sprints[sprints.length - 1].id;
  const fallback = sprints[0].id;
  cols = cols.map((c) => ({ ...c, cards: c.cards.map((k) => (k.sprint ? k : { ...k, sprint: fallback })) }));
  return { ...b, seq, cols, sprints, current };
});

export default function CustomBoards({ itemsBoard }) {
  const [store, setStore] = useState({ version: 1, seeded: true, boards: seedBoards() });
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState("items");   // "items" | board id

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setStore({ version: 1, seeded: true, ...saved, boards: ensureKeys(saved.boards || []) });
      }
    } catch (e) { console.error(e); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { console.error(e); }
  }, [store, hydrated]);

  /* ---------- backend mirror (boards-sync skill). Boards are deeply nested,
   * so sync is whole-board snapshots: after any change, debounce ~800ms and
   * PUT every board to its idempotent snapshot endpoint. Deletion is the one
   * thing a snapshot can't express — diff the previous board ids (ref) and
   * mirror a DELETE for each id that vanished. mirror() is fire-and-forget
   * and a no-op while backend sync is off, so local behavior is unchanged. */
  const mirrorTimer = useRef(null);
  const prevBoardIds = useRef(null);
  useEffect(() => {
    if (!hydrated) return;
    const ids = store.boards.map((b) => b.id);
    if (prevBoardIds.current) {
      prevBoardIds.current
        .filter((id) => !ids.includes(id))
        .forEach((id) => mirror(`/boards/${id}`, { method: "DELETE" }));
    }
    prevBoardIds.current = ids;
    mirrorTimer.current = setTimeout(() => {
      store.boards.forEach((b) => mirror(`/boards/${b.id}/snapshot`, { method: "PUT", body: b }));
    }, 800);
    return () => clearTimeout(mirrorTimer.current);
  }, [store, hydrated]);

  const boards = store.boards;
  const setBoards = (fn) => setStore((s) => ({ ...s, boards: typeof fn === "function" ? fn(s.boards) : fn }));
  const board = boards.find((b) => b.id === active);

  /* ---------- board CRUD
   * No window.prompt/confirm here: native dialogs are blocked in embedded
   * browsers and webviews, which silently kills the feature. Naming is an
   * inline input; deletes use a click-again-to-confirm arm state. */
  const [naming, setNaming] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => { if (naming) nameRef.current?.focus(); }, [naming]);
  const createBoard = (raw) => {
    const name = (raw || "").trim();
    if (!name) { setNaming(false); return; }
    const sp = { id: uid(), name: "Sprint 1", ended: null };
    const b = {
      id: uid(), name, seq: 0, sprints: [sp], current: sp.id,
      cols: [{ id: uid(), title: "To do", cards: [] }, { id: uid(), title: "Doing", cards: [] }, { id: uid(), title: "Done", cards: [] }],
    };
    setBoards((bs) => [...bs, b]);
    setActive(b.id);
    setNaming(false);
  };
  const renameBoard = (id, name) => setBoards((bs) => bs.map((b) => (b.id === id ? { ...b, name } : b)));

  const [arm, setArm] = useState(null);          // "board:<id>" | "col:<id>" awaiting second click
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(null), 3000);
    return () => clearTimeout(t);
  }, [arm]);
  const deleteBoard = (b) => {
    if (arm !== `board:${b.id}`) { setArm(`board:${b.id}`); return; }
    setBoards((bs) => bs.filter((x) => x.id !== b.id));
    setActive("items");
    setArm(null);
  };

  /* ---------- column + card ops (always on the active board) */
  const patchBoard = (fn) => setBoards((bs) => bs.map((b) => (b.id === active ? fn(b) : b)));
  const addCol = () => patchBoard((b) => ({ ...b, cols: [...b.cols, { id: uid(), title: "New column", cards: [] }] }));
  const renameCol = (cid, title) => patchBoard((b) => ({ ...b, cols: b.cols.map((c) => (c.id === cid ? { ...c, title } : c)) }));
  const deleteCol = (col) => {
    if (col.cards.length && arm !== `col:${col.id}`) { setArm(`col:${col.id}`); return; }
    patchBoard((b) => ({ ...b, cols: b.cols.filter((c) => c.id !== col.id) }));
    setArm(null);
  };
  const addCard = (cid, text) => {
    if (!text.trim()) return;
    patchBoard((b) => {
      const seq = (b.seq || 0) + 1;
      return { ...b, seq, cols: b.cols.map((c) => (c.id === cid ? { ...c, cards: [...c.cards, { id: uid(), num: seq, sprint: b.current, text: text.trim() }] } : c)) };
    });
  };

  /* ---------- sprints */
  const setSprint = (id) => patchBoard((b) => ({ ...b, current: id }));
  /* the column a sprint-moved task lands in: "Backlog"/"To do" if the board
   * has one, otherwise the first column */
  const backlogColId = (b) => (b.cols.find((c) => /backlog|to.?do/i.test(c.title)) || b.cols[0])?.id;
  /* moving a task to another sprint always drops it back into the backlog —
   * a task entering a new sprint starts as not-started work */
  const moveCardSprint = (fromCol, cardId, sprintId) => {
    const blId = backlogColId(board);
    patchBoard((b) => {
      let moved = null;
      let cols = b.cols.map((c) => (c.id === fromCol
        ? { ...c, cards: c.cards.filter((k) => { if (k.id === cardId) { moved = k; return false; } return true; }) }
        : c));
      if (!moved) return b;
      if (moved.sprint === sprintId) return b;
      cols = cols.map((c) => (c.id === blId ? { ...c, cards: [...c.cards, { ...moved, sprint: sprintId }] } : c));
      return { ...b, cols };
    });
    setDetail((d) => (d && d.cardId === cardId ? { ...d, colId: blId } : d));
  };
  const newSprint = () => patchBoard((b) => {
    const sp = { id: uid(), name: `Sprint ${b.sprints.length + 1}`, ended: null };
    return { ...b, sprints: [...b.sprints, sp], current: sp.id };
  });
  /* Complete sprint, Jira-style: done cards stay behind in the closed
   * sprint; everything unfinished rolls into the next one (created on
   * demand), which becomes the active sprint. */
  const completeSprint = () => {
    if (arm !== "sprint:done") { setArm("sprint:done"); return; }
    patchBoard((b) => {
      const cur = b.current;
      const idx = b.sprints.findIndex((s) => s.id === cur);
      const d = new Date();
      const endedOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      let sprints = b.sprints.map((s) => (s.id === cur ? { ...s, ended: endedOn } : s));
      let next = sprints[idx + 1];
      if (!next) { next = { id: uid(), name: `Sprint ${sprints.length + 1}`, ended: null }; sprints = [...sprints, next]; }
      /* unfinished work rolls into the next sprint AND back to the backlog
       * column — a fresh sprint starts with everything as not-started */
      const blId = backlogColId(b);
      const rolled = [];
      let cols = b.cols.map((c) => {
        if (DONE_RE.test(c.title) || c.id === blId) return c;
        const keep = [];
        c.cards.forEach((k) => (k.sprint === cur ? rolled.push(k) : keep.push(k)));
        return { ...c, cards: keep };
      });
      cols = cols.map((c) => (c.id === blId
        ? { ...c, cards: [...c.cards.map((k) => (k.sprint === cur ? { ...k, sprint: next.id } : k)), ...rolled.map((k) => ({ ...k, sprint: next.id }))] }
        : c));
      return { ...b, sprints, cols, current: next.id };
    });
    setArm(null);
  };
  /* Per-sprint CSV download — key, title, status, hours, description. */
  const exportSprint = () => {
    const sp = board.sprints.find((s) => s.id === board.current);
    const prefix = boardPrefix(board.name);
    const rows = [["Key", "Title", "Status", "Sprint", "Labels", "Hours", "Description"]];
    board.cols.forEach((c) => c.cards.filter((k) => k.sprint === board.current).forEach((k) =>
      rows.push([`${prefix}-${k.num}`, k.text, c.title, sp.name, (k.labels || []).join("; "), k.hours ?? "", k.desc || ""])));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${board.name} ${sp.name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  /* move a card to another column from inside the detail view (Jira-style status change) */
  const moveCardCol = (fromCol, cardId, toCol) => {
    if (fromCol === toCol) return;
    patchBoard((b) => {
      let moved = null;
      let cols = b.cols.map((c) => (c.id === fromCol
        ? { ...c, cards: c.cards.filter((k) => { if (k.id === cardId) { moved = k; return false; } return true; }) }
        : c));
      if (!moved) return b;
      cols = cols.map((c) => (c.id === toCol ? { ...c, cards: [...c.cards, moved] } : c));
      return { ...b, cols };
    });
    setDetail((d) => (d && d.cardId === cardId ? { ...d, colId: toCol } : d));
  };
  const patchCard = (cid, kid, patch) =>
    patchBoard((b) => ({ ...b, cols: b.cols.map((c) => (c.id === cid ? { ...c, cards: c.cards.map((k) => (k.id === kid ? { ...k, ...patch } : k)) } : c)) }));

  /* ---------- card detail (in-depth description, read & edit views) */
  const [detail, setDetail] = useState(null);      // {colId, cardId}
  const [cdMode, setCdMode] = useState("edit");
  useEffect(() => {
    if (!detail) return;
    const onKey = (e) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [detail]);
  const deleteCard = (cid, kid) =>
    patchBoard((b) => ({ ...b, cols: b.cols.map((c) => (c.id === cid ? { ...c, cards: c.cards.filter((k) => k.id !== kid) } : c)) }));

  /* ---------- drag & drop */
  const drag = useRef(null);   // {fromCol, cardId}
  const [dragging, setDragging] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const moveTo = (destCol, beforeId) => {
    const src = drag.current;
    if (!src) return;
    patchBoard((b) => {
      let moved = null;
      let cols = b.cols.map((c) => (c.id === src.fromCol
        ? { ...c, cards: c.cards.filter((k) => { if (k.id === src.cardId) { moved = k; return false; } return true; }) }
        : c));
      if (!moved) return b;
      cols = cols.map((c) => {
        if (c.id !== destCol) return c;
        const cards = [...c.cards];
        const i = beforeId ? cards.findIndex((k) => k.id === beforeId) : -1;
        if (i >= 0) cards.splice(i, 0, moved); else cards.push(moved);
        return { ...c, cards };
      });
      return { ...b, cols };
    });
    drag.current = null; setDragging(null); setOverCol(null);
  };

  return (
    <>
      {/* board tabs */}
      <div className="btabs">
        <div className="doctabs" role="tablist" aria-label="Boards">
          <button className={active === "items" ? "on" : ""} role="tab" aria-selected={active === "items"}
            onClick={() => setActive("items")} title="Automatic board of every vault item by status">▦ Vault items</button>
          {boards.map((b) => (
            <button key={b.id} className={active === b.id ? "on" : ""} role="tab" aria-selected={active === b.id}
              onClick={() => setActive(b.id)}>{b.name.length > 22 ? b.name.slice(0, 20) + "…" : b.name}</button>
          ))}
        </div>
        {naming ? (
          <input ref={nameRef} className="tadd bname-input" placeholder="Board name — a feature, a sprint…  (Enter to create, Esc to cancel)"
            aria-label="New board name"
            onKeyDown={(e) => {
              if (e.key === "Enter") createBoard(e.target.value);
              if (e.key === "Escape") setNaming(false);
            }}
            onBlur={(e) => createBoard(e.target.value)} />
        ) : (
          <button className="btn ghost sm" onClick={() => setNaming(true)} title="Create a custom kanban — any columns, any cards">＋ New board</button>
        )}
      </div>

      {active === "items" && itemsBoard}

      {board && (() => {
        const cur = board.current;
        const curSprint = board.sprints.find((s) => s.id === cur);
        const inSprint = (c) => c.cards.filter((k) => k.sprint === cur);
        const sprintCards = board.cols.flatMap((c) => inSprint(c).map((k) => ({ ...k, done: DONE_RE.test(c.title) })));
        const doneCount = sprintCards.filter((k) => k.done).length;
        const hoursLogged = sprintCards.reduce((a, k) => a + (+k.hours || 0), 0);
        return (
        <>
          <div className="bboard-head">
            <input className="bboard-name display" value={board.name} aria-label="Board name"
              onChange={(e) => renameBoard(board.id, e.target.value)} />
            <button className="kbtn" onClick={addCol}>＋ Column</button>
            <button className={`kbtn kdel ${arm === `board:${board.id}` ? "armed" : ""}`} onClick={() => deleteBoard(board)}
              title={arm === `board:${board.id}` ? "Click again to permanently delete this board" : "Delete this board"}>
              {arm === `board:${board.id}` ? "Sure? Click again" : "Delete board"}
            </button>
          </div>

          <div className="sprintbar">
            <select className="status sprint-sel" style={{ marginTop: 0 }} value={cur} aria-label="Sprint"
              onChange={(e) => setSprint(e.target.value)}>
              {board.sprints.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.ended ? ` · closed ${s.ended}` : ""}</option>
              ))}
            </select>
            <span className="mono sprint-meta">
              {sprintCards.length} task{sprintCards.length === 1 ? "" : "s"} · {doneCount} done{hoursLogged > 0 ? ` · ${hoursLogged}h logged` : ""}
            </span>
            <button className="kbtn" onClick={newSprint} title="Start a fresh sprint on this board">＋ New sprint</button>
            {!curSprint?.ended && (
              <button className={`kbtn ${arm === "sprint:done" ? "kdel armed" : ""}`} onClick={completeSprint}
                title={arm === "sprint:done" ? `${sprintCards.length - doneCount} unfinished task(s) will move to the next sprint` : "Close this sprint — unfinished tasks roll into the next one"}>
                {arm === "sprint:done" ? `Sure? ${sprintCards.length - doneCount} roll over` : "✓ Complete sprint"}
              </button>
            )}
            <button className="kbtn" onClick={exportSprint} title="Download this sprint as CSV — key, title, status, hours, description">⬇ Export CSV</button>
          </div>

          <div className="kanban" style={{ gridTemplateColumns: `repeat(${Math.max(1, board.cols.length)}, 1fr)` }}>
            {board.cols.map((col) => (
              <div key={col.id} className={`kcol ${overCol === col.id && dragging ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
                onDragLeave={() => setOverCol((o) => (o === col.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); moveTo(col.id, null); }}>
                <div className="kcol-head">
                  <input className="kcol-name" value={col.title} aria-label="Column name"
                    onChange={(e) => renameCol(col.id, e.target.value)} />
                  <span className="kcount mono">{inSprint(col).length}</span>
                  <button className={`kbtn kdel ${arm === `col:${col.id}` ? "armed" : ""}`}
                    title={arm === `col:${col.id}` ? `Click again to delete “${col.title}” and its ${col.cards.length} card(s)` : "Delete column"}
                    aria-label={`Delete column ${col.title}`}
                    onClick={() => deleteCol(col)}>{arm === `col:${col.id}` ? "Sure?" : "✕"}</button>
                </div>
                {inSprint(col).map((k) => (
                  <div key={k.id} className={`kcard bcard ${dragging === k.id ? "dragging" : ""}`}
                    role="button" tabIndex={0} draggable
                    title="Open this task — details, description, status"
                    onClick={() => { setDetail({ colId: col.id, cardId: k.id }); setCdMode(k.desc ? "read" : "edit"); }}
                    onKeyDown={(e) => e.key === "Enter" && (setDetail({ colId: col.id, cardId: k.id }), setCdMode(k.desc ? "read" : "edit"))}
                    onDragStart={() => { drag.current = { fromCol: col.id, cardId: k.id }; setDragging(k.id); }}
                    onDragEnd={() => { drag.current = null; setDragging(null); setOverCol(null); }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverCol(col.id); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); moveTo(col.id, k.id); }}>
                    <span className="bcard-title">{k.text || "Untitled task"}</span>
                    {(k.labels || []).length > 0 && (
                      <span className="bcard-labels">
                        {k.labels.slice(0, 3).map((l) => {
                          const [bg, fg] = labelColor(l);
                          return <span key={l} className="blabel mono" style={{ background: bg, color: fg }}>{l}</span>;
                        })}
                        {k.labels.length > 3 && <span className="blabel mono">+{k.labels.length - 3}</span>}
                      </span>
                    )}
                    <div className="bcard-foot">
                      <span className="bkey mono">{boardPrefix(board.name)}-{k.num}</span>
                      {k.desc && <span className="bcount" title="Has a description">≡</span>}
                      {DONE_RE.test(col.title) && (
                        <span className="hrs mono" onClick={(e) => e.stopPropagation()} title="How many hours this task took">
                          ⏱<input type="number" min="0" step="0.5" value={k.hours ?? ""} placeholder="–" aria-label="Hours to complete"
                            onChange={(e) => patchCard(col.id, k.id, { hours: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} />h
                        </span>
                      )}
                      <button className="kbtn kdel" style={{ marginLeft: "auto" }} title="Delete card" aria-label="Delete card"
                        onClick={(e) => { e.stopPropagation(); deleteCard(col.id, k.id); }}>✕</button>
                    </div>
                  </div>
                ))}
                <input className="tadd bcard-add" placeholder="+ Add a card…" aria-label={`Add card to ${col.title}`}
                  onKeyDown={(e) => { if (e.key === "Enter") { addCard(col.id, e.target.value); e.target.value = ""; } }} />
              </div>
            ))}
          </div>
          <div className="m" style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 8 }}>
            Click a task to open it — title, description, status and sprint live inside · drag cards between columns ·
            log ⏱ hours on finished tasks · ✓ Complete sprint rolls unfinished work into the next one.
          </div>
        </>
        );
      })()}

      {/* card detail: in-depth description with Read / Edit views */}
      {detail && board && (() => {
        const col = board.cols.find((c) => c.id === detail.colId);
        const card = col?.cards.find((k) => k.id === detail.cardId);
        if (!card) return null;
        return (
          <div className="pal-overlay" onClick={() => setDetail(null)} role="dialog" aria-label="Task details">
            <div className="pal carddetail" onClick={(e) => e.stopPropagation()}>
              <div className="cd-head">
                <span className="bkey mono cd-key">{boardPrefix(board.name)}-{card.num}</span>
                <div className="doctabs" role="tablist" aria-label="Card view">
                  <button className={cdMode === "read" ? "on" : ""} role="tab" aria-selected={cdMode === "read"}
                    onClick={() => setCdMode("read")}>👁 Read</button>
                  <button className={cdMode === "edit" ? "on" : ""} role="tab" aria-selected={cdMode === "edit"}
                    onClick={() => setCdMode("edit")}>✎ Edit</button>
                </div>
                <select className="status cd-status" style={{ marginTop: 0, marginLeft: "auto" }} value={col.id}
                  aria-label="Status — move to column" title="Move this task to another column"
                  onChange={(e) => moveCardCol(col.id, card.id, e.target.value)}>
                  {board.cols.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
                <button className="kbtn" onClick={() => setDetail(null)} title="Close (Esc)">✕</button>
              </div>
              {cdMode === "edit" ? (
                <div className="cd-body">
                  <textarea className="cd-title" value={card.text} rows={2} aria-label="Card title"
                    placeholder="Card title"
                    onChange={(e) => patchCard(col.id, card.id, { text: e.target.value })} />
                  <div className="cd-row">
                    <label className="cd-field">
                      <span className="cd-lbl mono">SPRINT</span>
                      <select className="status" style={{ marginTop: 0 }} value={card.sprint} aria-label="Sprint"
                        title="Move this task to another sprint — it lands in the backlog there"
                        onChange={(e) => moveCardSprint(col.id, card.id, e.target.value)}>
                        {board.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}{s.ended ? " · closed" : ""}</option>)}
                      </select>
                    </label>
                    <label className="cd-field">
                      <span className="cd-lbl mono">⏱ HOURS TO COMPLETE</span>
                      <input className="status cd-hours" type="number" min="0" step="0.5" value={card.hours ?? ""}
                        placeholder="e.g. 3.5" aria-label="Hours to complete"
                        onChange={(e) => patchCard(col.id, card.id, { hours: e.target.value === "" ? undefined : Math.max(0, +e.target.value) })} />
                    </label>
                    <label className="cd-field" style={{ flex: 1, minWidth: 180 }}>
                      <span className="cd-lbl mono"># LABELS</span>
                      <input className="status" key={card.id} defaultValue={(card.labels || []).join(", ")}
                        placeholder="your own tags — design, urgent, v2…" aria-label="Labels (comma separated)"
                        onBlur={(e) => patchCard(col.id, card.id, { labels: parseLabels(e.target.value) })}
                        onKeyDown={(e) => e.key === "Enter" && patchCard(col.id, card.id, { labels: parseLabels(e.target.value) })} />
                    </label>
                  </div>
                  <textarea className="cd-desc" value={card.desc || ""} rows={10} aria-label="In-depth description"
                    placeholder={"Write the full story of this task…\n\nContext, acceptance criteria, links, decisions — everything the card title can't hold."}
                    onChange={(e) => patchCard(col.id, card.id, { desc: e.target.value })} />
                </div>
              ) : (
                <div className="cd-body">
                  <h3 className="cd-rtitle display">{card.text || "Untitled card"}</h3>
                  <div className="cd-rmeta mono">
                    {board.sprints.find((s) => s.id === card.sprint)?.name || "No sprint"}
                    {card.hours != null && ` · ⏱ ${card.hours}h to complete`}
                  </div>
                  {(card.labels || []).length > 0 && (
                    <div className="bcard-labels">
                      {card.labels.map((l) => {
                        const [bg, fg] = labelColor(l);
                        return <span key={l} className="blabel mono" style={{ background: bg, color: fg }}>{l}</span>;
                      })}
                    </div>
                  )}
                  <div className="cd-rdesc">
                    {card.desc
                      ? card.desc
                      : <span style={{ color: "var(--ink-soft)" }}>No details yet — switch to ✎ Edit to write the in-depth description.</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}

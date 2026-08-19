import React, { useEffect, useRef, useState } from "react";

/* Notion-style blocks: text, to-do, bullet, table, and PAGE (a nested
   sub-page with its own blocks — pages can contain pages, recursively).
   To-dos, bullets and text can be indented (‹ ›) for nested outlines. */

const uid = () => Math.random().toString(36).slice(2, 9);

export const emptyBlock = (kind) => {
  if (kind === "table") return { id: uid(), kind, rows: [["", ""], ["", ""]] };
  if (kind === "todo") return { id: uid(), kind, text: "", done: false, indent: 0 };
  if (kind === "page") return { id: uid(), kind, title: "", blocks: [] };
  if (kind === "heading") return { id: uid(), kind, text: "" };
  return { id: uid(), kind, text: "", indent: 0 };
};

const SLASH_OPTIONS = [
  ["todo", "☑ To-do"], ["bullet", "• Bullet"], ["heading", "H Heading"],
  ["table", "▦ Table"], ["page", "❐ Sub-page"],
];

function PageBlock({ b, onPatch }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bpage">
      <div className="bpage-head">
        <button className="bpage-toggle" onClick={() => setOpen((o) => !o)}
          aria-expanded={open} aria-label={open ? "Collapse page" : "Expand page"}>
          {open ? "▾" : "▸"}
        </button>
        <span className="bpage-ic" aria-hidden="true">❐</span>
        <input className="bpage-title" value={b.title} placeholder="Page title…"
          onChange={(e) => onPatch({ title: e.target.value })} />
        {(b.blocks || []).length > 0 && <span className="bcount">{(b.blocks || []).length}</span>}
        <button className="bpage-addsub" title="Add subpage inside" aria-label="Add subpage inside"
          onClick={() => { setOpen(true); onPatch({ blocks: [...(b.blocks || []), emptyBlock("page")] }); }}>＋</button>
      </div>
      {open && (
        <div className="bpage-body">
          <NoteBlocks blocks={b.blocks || []} onChange={(blocks) => onPatch({ blocks })} />
        </div>
      )}
    </div>
  );
}

export default function NoteBlocks({ blocks = [], onChange }) {
  const [dragId, setDragId] = useState(null);
  const [focusNew, setFocusNew] = useState(null);
  const refs = useRef({});
  const set = (next) => onChange(next);
  const upd = (id, patch) => set(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const del = (id) => set(blocks.filter((b) => b.id !== id));
  const add = (kind) => {
    const nb = emptyBlock(kind);
    set([...blocks, nb]);
    setFocusNew(nb.id);
  };
  const indent = (b, delta) =>
    upd(b.id, { indent: Math.max(0, Math.min(4, (b.indent || 0) + delta)) });

  /* THE FIX: insert a new block immediately AFTER the current one —
     this is what makes writing under a heading (or anywhere) natural. */
  const insertAfter = (id, kind) => {
    const i = blocks.findIndex((b) => b.id === id);
    if (i < 0) return add(kind);
    const src = blocks[i];
    const nb = { ...emptyBlock(kind), indent: src.indent || 0 };
    const next = [...blocks];
    next.splice(i + 1, 0, nb);
    set(next);
    setFocusNew(nb.id);
  };

  /* Backspace on an empty block removes it and returns focus above */
  const deleteAndFocusPrev = (b) => {
    const i = blocks.findIndex((x) => x.id === b.id);
    const prev = blocks[i - 1];
    del(b.id);
    if (prev) setFocusNew(prev.id);
  };

  /* focus the newly created block once it exists in the DOM */
  useEffect(() => {
    if (focusNew && refs.current[focusNew]) {
      refs.current[focusNew].focus();
      setFocusNew(null);
    }
  }, [blocks, focusNew]);

  const bindRef = (id) => (el) => { if (el) refs.current[id] = el; };

  const indentable = (k) => k === "todo" || k === "bullet" || k === "text";

  /* Enter = continue below (same kind for lists); Tab = nest; Shift+Tab = un-nest.
     e.keyCode === 13 catches mobile keyboards that don't report key === "Enter". */
  const keyFlow = (b) => (e) => {
    const isEnter = e.key === "Enter" || e.keyCode === 13;
    if (e.key === "Tab" && indentable(b.kind)) {
      e.preventDefault();
      indent(b, e.shiftKey ? -1 : 1);
      return;
    }
    if (isEnter) {
      if (b.kind === "text" && e.shiftKey) return; // Shift+Enter = newline inside text
      e.preventDefault();
      if ((b.kind === "todo" || b.kind === "bullet") && !(b.text || "").trim()) {
        if ((b.indent || 0) > 0) { indent(b, -1); return; } // nested empty → un-nest first
        upd(b.id, { kind: "text", text: "" }); // top-level empty → exit the list
        setFocusNew(b.id);
        return;
      }
      // headings continue into text; bullets/todos continue as themselves
      insertAfter(b.id, b.kind === "heading" || b.kind === "text" ? "text" : b.kind);
    }
    if (e.key === "Backspace" && !(b.text || "").trim() && blocks.length > 1) {
      e.preventDefault();
      deleteAndFocusPrev(b);
    }
  };

  /* drag-to-reorder (handle-initiated, drop on any block) */
  const dropOn = (targetId) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const from = blocks.findIndex((b) => b.id === dragId);
    const to = blocks.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set(next);
    setDragId(null);
  };

  /* slash conversion: turn a text block into another kind */
  const convert = (b, kind) => {
    if (kind === "table") upd(b.id, { kind, rows: [["", ""], ["", ""]], text: undefined });
    else if (kind === "page") upd(b.id, { kind, title: "", blocks: [], text: undefined });
    else if (kind === "todo") upd(b.id, { kind, text: "", done: false });
    else upd(b.id, { kind, text: "" });
  };

  /* markdown shortcuts: "- " → bullet, "[] " → to-do, "# " → heading */
  const onTextChange = (b, v) => {
    if (v === "- " || v === "* ") return upd(b.id, { kind: "bullet", text: "" });
    if (v === "[] " || v === "[ ] ") return upd(b.id, { kind: "todo", text: "", done: false });
    if (v === "# ") return upd(b.id, { kind: "heading", text: "" });
    upd(b.id, { text: v });
  };

  const tableUpd = (b, r, c, v) => {
    const rows = b.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row));
    upd(b.id, { rows });
  };
  const addRow = (b) => upd(b.id, { rows: [...b.rows, b.rows[0].map(() => "")] });
  const delRow = (b) => b.rows.length > 1 && upd(b.id, { rows: b.rows.slice(0, -1) });
  const addCol = (b) => upd(b.id, { rows: b.rows.map((r) => [...r, ""]) });
  const delCol = (b) => b.rows[0].length > 1 && upd(b.id, { rows: b.rows.map((r) => r.slice(0, -1)) });


  return (
    <div className="blocks">
      {blocks.map((b) => (
        <div key={b.id} className={`block ${dragId === b.id ? "dragging" : ""}`}
          style={{ marginLeft: (b.indent || 0) * 20 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOn(b.id)}>
          <span className="bhandle" draggable title="Drag to reorder" aria-label="Drag to reorder"
            onDragStart={() => setDragId(b.id)} onDragEnd={() => setDragId(null)}>⋮⋮</span>
          {b.kind === "text" && (
            <div style={{ position: "relative" }}>
              <textarea className="btext" rows={2} value={b.text} ref={bindRef(b.id)}
                placeholder="Write anything… (Enter = new block, Shift+Enter = new line, / for menu, “- ”, “[] ”, “# ”)"
                onChange={(e) => onTextChange(b, e.target.value)}
                onKeyDown={keyFlow(b)} aria-label="Text block" />
              {b.text === "/" && (
                <div className="slashmenu" role="menu">
                  {SLASH_OPTIONS.map(([k, label]) => (
                    <button key={k} type="button" onClick={() => convert(b, k)}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {b.kind === "heading" && (
            <input className="bhead" value={b.text} placeholder="Heading… (Enter to write below it)" aria-label="Heading"
              ref={bindRef(b.id)} onKeyDown={keyFlow(b)}
              onChange={(e) => upd(b.id, { text: e.target.value })} />
          )}
          {b.kind === "todo" && (
            <div className="btodo">
              <input type="checkbox" checked={b.done} aria-label="Done"
                onChange={(e) => upd(b.id, { done: e.target.checked })} />
              <input className="bline" value={b.text} placeholder="To-do… (Enter = next, Tab = sub-task)" aria-label="To-do text"
                ref={bindRef(b.id)} onKeyDown={keyFlow(b)}
                style={{ textDecoration: b.done ? "line-through" : "none", opacity: b.done ? 0.55 : 1 }}
                onChange={(e) => upd(b.id, { text: e.target.value })} />
            </div>
          )}
          {b.kind === "bullet" && (
            <div className="bbullet">
              <span aria-hidden="true">{(b.indent || 0) % 2 ? "◦" : "•"}</span>
              <input className="bline" value={b.text} placeholder="Bullet point… (Enter = next, Tab = sub-bullet)" aria-label="Bullet text"
                ref={bindRef(b.id)} onKeyDown={keyFlow(b)}
                onChange={(e) => upd(b.id, { text: e.target.value })} />
            </div>
          )}
          {b.kind === "table" && (
            <div>
              <table className="btable"><tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => (
                    <td key={ci}>
                      <input value={cell} placeholder={ri === 0 ? "Header" : ""} aria-label={`Cell ${ri + 1},${ci + 1}`}
                        onChange={(e) => tableUpd(b, ri, ci, e.target.value)} />
                    </td>
                  ))}</tr>
                ))}
              </tbody></table>
              <div className="btable-actions">
                <button type="button" onClick={() => addRow(b)}>+ row</button>
                <button type="button" onClick={() => delRow(b)} disabled={b.rows.length <= 1}>− row</button>
                <button type="button" onClick={() => addCol(b)}>+ column</button>
                <button type="button" onClick={() => delCol(b)} disabled={b.rows[0].length <= 1}>− column</button>
              </div>
            </div>
          )}
          {b.kind === "page" && (
            <PageBlock b={b} onPatch={(patch) => upd(b.id, patch)} />
          )}
          <div className="bctrl">
            <button className="binsert" title="Add a block right below (same type for lists)" aria-label="Add block below"
              onClick={() => insertAfter(b.id, b.kind === "todo" || b.kind === "bullet" ? b.kind : "text")}>＋</button>
            {indentable(b.kind) && (
              <>
                <button title="Outdent" aria-label="Outdent" onClick={() => indent(b, -1)}
                  disabled={!(b.indent || 0)}>‹</button>
                <button title="Indent (nest under the block above)" aria-label="Indent"
                  onClick={() => indent(b, 1)} disabled={(b.indent || 0) >= 4}>›</button>
              </>
            )}
            <button className="bdel" title="Delete block" aria-label="Delete block"
              onClick={() => del(b.id)}>✕</button>
          </div>
        </div>
      ))}
      <div className="baddbar">
        <button type="button" onClick={() => add("text")}>+ Text</button>
        <button type="button" onClick={() => add("heading")}>+ Heading</button>
        <button type="button" onClick={() => add("todo")}>+ To-do</button>
        <button type="button" onClick={() => add("bullet")}>+ Bullet</button>
        <button type="button" onClick={() => add("table")}>+ Table</button>
        <button type="button" onClick={() => add("page")}>+ Page</button>
      </div>
    </div>
  );
}

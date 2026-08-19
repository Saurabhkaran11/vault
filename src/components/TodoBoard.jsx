import React, { useEffect, useRef, useState } from "react";

/* Standalone To-do tool: multiple lists, each collapsible, with
   drag-and-drop to reorder to-dos and move them between lists.
   Persists on its own localStorage key (vault.todos.v1). */

const uid = () => Math.random().toString(36).slice(2, 9);

const seedLists = [
  { id: "l1", title: "Today", collapsed: false, todos: [
    { id: "t1", text: "Watch FastAPI course — section 3", done: false },
    { id: "t2", text: "Push Vault to GitHub", done: false },
  ]},
  { id: "l2", title: "This week", collapsed: false, todos: [
    { id: "t3", text: "Finish DDIA chapter 5", done: false },
    { id: "t4", text: "Write portfolio README v2", done: true },
  ]},
  { id: "l3", title: "Someday", collapsed: true, todos: [
    { id: "t5", text: "Migrate file storage to IndexedDB", done: false },
  ]},
];

export default function TodoBoard() {
  const [lists, setLists] = useState(() => {
    try {
      const raw = localStorage.getItem("vault.todos.v1");
      if (raw) return JSON.parse(raw);
    } catch (e) { console.error(e); }
    return seedLists;
  });
  useEffect(() => {
    try { localStorage.setItem("vault.todos.v1", JSON.stringify(lists)); }
    catch (e) { console.error(e); }
  }, [lists]);

  const drag = useRef(null); // { listId, todoId }
  const [dragging, setDragging] = useState(null);
  const [overList, setOverList] = useState(null);

  const patchList = (id, p) => setLists((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const addList = () => setLists((ls) => [...ls, { id: uid(), title: "New list", collapsed: false, todos: [] }]);
  const delList = (id) => setLists((ls) => ls.filter((l) => l.id !== id));
  const addTodo = (listId, text) => {
    if (!text.trim()) return;
    setLists((ls) => ls.map((l) => (l.id === listId
      ? { ...l, todos: [...l.todos, { id: uid(), text: text.trim(), done: false }] } : l)));
  };
  const patchTodo = (listId, tid, p) =>
    setLists((ls) => ls.map((l) => (l.id === listId
      ? { ...l, todos: l.todos.map((t) => (t.id === tid ? { ...t, ...p } : t)) } : l)));
  const delTodo = (listId, tid) =>
    setLists((ls) => ls.map((l) => (l.id === listId
      ? { ...l, todos: l.todos.filter((t) => t.id !== tid) } : l)));

  /* move the dragged to-do into destList, before beforeTid (or to the end) */
  const moveTo = (destListId, beforeTid) => {
    const src = drag.current;
    if (!src) return;
    setLists((ls) => {
      let moved = null;
      let next = ls.map((l) => (l.id === src.listId
        ? { ...l, todos: l.todos.filter((t) => { if (t.id === src.todoId) { moved = t; return false; } return true; }) }
        : l));
      if (!moved) return ls;
      return next.map((l) => {
        if (l.id !== destListId) return l;
        const todos = [...l.todos];
        const i = beforeTid ? todos.findIndex((t) => t.id === beforeTid) : -1;
        if (i >= 0) todos.splice(i, 0, moved); else todos.push(moved);
        return { ...l, todos };
      });
    });
    drag.current = null;
    setDragging(null);
    setOverList(null);
  };

  return (
    <div className="todoboard">
      {lists.map((l) => {
        const done = l.todos.filter((t) => t.done).length;
        return (
          <div key={l.id} className={`tlist ${overList === l.id && dragging ? "over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOverList(l.id); }}
            onDragLeave={() => setOverList((o) => (o === l.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); moveTo(l.id, null); }}>
            <div className="tlist-head">
              <button className="tl-toggle" onClick={() => patchList(l.id, { collapsed: !l.collapsed })}
                aria-expanded={!l.collapsed} aria-label={l.collapsed ? "Expand list" : "Collapse list"}>
                {l.collapsed ? "▸" : "▾"}
              </button>
              <input className="tl-title" value={l.title} aria-label="List title"
                onChange={(e) => patchList(l.id, { title: e.target.value })} />
              <span className="tl-count mono">{done}/{l.todos.length}</span>
              {l.todos.length > 0 && (
                <div className="tl-bar"><div className="tl-bar-fill"
                  style={{ width: `${l.todos.length ? (done / l.todos.length) * 100 : 0}%` }} /></div>
              )}
              <button className="tl-del" title="Delete list" aria-label={`Delete list ${l.title}`}
                onClick={() => (l.todos.length === 0 || window.confirm(`Delete “${l.title}” and its ${l.todos.length} to-dos?`)) && delList(l.id)}>✕</button>
            </div>

            {!l.collapsed && (
              <div className="tlist-body">
                {l.todos.map((t) => (
                  <div key={t.id} className={`trow ${dragging === t.id ? "dragging" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverList(l.id); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); moveTo(l.id, t.id); }}>
                    <span className="bhandle tr-handle" draggable title="Drag to move — within or between lists"
                      onDragStart={() => { drag.current = { listId: l.id, todoId: t.id }; setDragging(t.id); }}
                      onDragEnd={() => { drag.current = null; setDragging(null); setOverList(null); }}>⋮⋮</span>
                    <input type="checkbox" checked={t.done} aria-label="Done"
                      onChange={(e) => patchTodo(l.id, t.id, { done: e.target.checked })} />
                    <input className="tr-text" value={t.text} aria-label="To-do text"
                      style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.55 : 1 }}
                      onChange={(e) => patchTodo(l.id, t.id, { text: e.target.value })} />
                    <button className="tr-del" title="Delete to-do" aria-label="Delete to-do"
                      onClick={() => delTodo(l.id, t.id)}>✕</button>
                  </div>
                ))}
                <input className="tadd" placeholder="+ Add a to-do and press Enter…" aria-label="Add a to-do"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { addTodo(l.id, e.target.value); e.target.value = ""; }
                  }} />
              </div>
            )}
          </div>
        );
      })}
      <button className="btn ghost" onClick={addList} style={{ alignSelf: "flex-start" }}>+ New list</button>
    </div>
  );
}

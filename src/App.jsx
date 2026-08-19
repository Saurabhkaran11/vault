import React, { useEffect, useRef, useState } from "react";
import { SECTIONS, fmtStamp, today } from "./data/seed.js";
import { useStore } from "./hooks/useStore.js";
import { WeeklyBars, Donut, Resurface } from "./components/Charts.jsx";
import GraphView from "./components/GraphView.jsx";
import ItemRow from "./components/ItemRow.jsx";
import AddForm from "./components/AddForm.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import NoteBlocks from "./components/NoteBlocks.jsx";
import TodoBoard from "./components/TodoBoard.jsx";
import { TEMPLATES, templateStats, instantiateTemplate } from "./data/templates.js";

/* Full-page note/document view — open any note as its own page,
   Notion-style: big editable title, meta line, and the block editor. */
function NotePage({ it, onBack, onUpdate, onTag }) {
  const s = SECTIONS[it.type];
  return (
    <div className="notepage">
      <button className="btn ghost sm" onClick={onBack}>← Back to {s.label}</button>
      <input className="np-title" value={it.title} aria-label="Title"
        onChange={(e) => onUpdate({ ...it, title: e.target.value })} placeholder="Untitled" />
      <div className="np-meta">
        <span className="pill" style={{ background: s.soft, color: s.color, marginTop: 0 }}>{s.icon} {s.label}</span>
        {it.tags.map((t) => (
          <button key={t} className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginTop: 0 }}
            onClick={() => onTag(t)}>#{t}</button>
        ))}
        <span className="stamp" style={{ transform: "none" }}>Added · {fmtStamp(it.date)}</span>
      </div>
      <input className="np-sub" value={it.meta} aria-label="Description"
        onChange={(e) => onUpdate({ ...it, meta: e.target.value })}
        placeholder="Short description / why it matters…" />
      <NoteBlocks blocks={it.blocks || []} onChange={(blocks) => onUpdate({ ...it, blocks })} />
    </div>
  );
}

export default function App() {
  const { items, add, update, remove, exportJson, importJson } = useStore();
  const [view, setView] = useState("dash");   // dash | graph | note | video | book | doc | tag
  const [tag, setTag] = useState(null);
  const [open, setOpen] = useState(() => window.innerWidth > 860);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [palette, setPalette] = useState(false);
  const [dq, setDq] = useState("");            // dashboard search
  const [menuOpen, setMenuOpen] = useState(false); // profile/settings dropdown
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem("vault.profile")) || { name: "You" }; }
    catch { return { name: "You" }; }
  });
  const importRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("vault.profile", JSON.stringify(profile)); } catch (e) { console.error(e); }
  }, [profile]);

  /* close the dropdown on any outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  /* dark mode (research: top-requested PKM feature) */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", profile.theme === "dark" ? "dark" : "light");
  }, [profile.theme]);

  /* autosave indicator */
  const [saveState, setSaveState] = useState("Saved ✓");
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaveState("Saving…");
    const t = setTimeout(() => setSaveState("Saved ✓"), 700);
    return () => clearTimeout(t);
  }, [items]);

  /* undo for deletes (research: forgiveness beats confirmation) */
  const [undoItem, setUndoItem] = useState(null);
  const undoTimer = useRef(null);
  const removeWithUndo = (id) => {
    const it = items.find((x) => x.id === id);
    remove(id);
    setUndoItem(it);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoItem(null), 6000);
  };

  /* every edit stamps an `edited` date for "edited Xd ago" labels */
  const updateStamped = (it) => update({ ...it, edited: today() });

  /* Ctrl+K / Cmd+K anywhere opens global search */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  const [focusId, setFocusId] = useState(null);
  const [pageId, setPageId] = useState(null);          // full-page note view
  const [notesLayout, setNotesLayout] = useState("list"); // list | grid
  const [showTemplates, setShowTemplates] = useState(false);
  const [docFilter, setDocFilter] = useState("All"); // All | PDF | Word | Sheet | Image
  const pageItem = items.find((i) => i.id === pageId);

  const useTemplate = (t) => {
    const id = Date.now();
    add({
      id, type: "note", title: t.title, meta: t.desc, tags: [],
      status: "Inbox", blocks: instantiateTemplate(t), date: today(),
    });
    setShowTemplates(false);
    setPageId(id); // open the fresh note as a full page, ready to fill in
  };

  const docCategory = (it) => {
    if (!it.file) return "Other";
    const ext = (it.file.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") return "PDF";
    if (/^docx?$|^txt$|^md$/.test(ext)) return "Word";
    if (/^xlsx?$|^csv$/.test(ext)) return "Sheet";
    if (/^png$|^jpe?g$|^webp$|^gif$/.test(ext)) return "Image";
    return "Other";
  };
  const openTag = (t) => { setTag(t); setView("tag"); setAdding(false); setQ(""); setPageId(null); };
  const openSection = (k) => { setView(k); setTag(null); setAdding(false); setQ(""); setPageId(null); };
  /* jump to a specific item in its own section, scroll to it and flash it */
  const goto = (it) => {
    openSection(it.type);
    setFocusId(it.id);
    setTimeout(() => setFocusId(null), 2200);
  };

  const thisWeek = (type) => {
    const cut = new Date(); cut.setDate(cut.getDate() - 7);
    return items.filter((i) => (type ? i.type === type : true) && new Date(i.date) >= cut).length;
  };

  const visible = items
    .filter((i) => {
      if (view === "tag") return i.tags.includes(tag);
      if (view in SECTIONS) return i.type === view;
      return true;
    })
    .filter((i) => !(view === "doc" && docFilter !== "All") || docCategory(i) === docFilter)
    .filter((i) => !q || (i.title + " " + (i.alias || "") + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.date.localeCompare(a.date));

  const nav = [
    { k: "dash", label: "Dashboard", icon: "◈" },
    { k: "todos", label: "To-dos", icon: "☑" },
    { k: "graph", label: "Graph", icon: "❉" },
    { k: "note", label: "Notes", icon: "✎" },
    { k: "video", label: "YouTube", icon: "▶" },
    { k: "book", label: "Library", icon: "▤" },
    { k: "doc", label: "Documents", icon: "❏" },
  ];

  const onImport = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    importJson(f, (err, n) => {
      if (err) alert("Import failed — that file isn't a valid Vault backup.");
      else alert(`Imported ${n} items.`);
    });
    e.target.value = "";
  };

  return (
    <div className="vault">
      <CommandPalette items={items} open={palette} onClose={() => setPalette(false)}
        onGo={(r) => (r.kind === "tag" ? openTag(r.tag) : openSection(r.item.type))} />

      <nav className={`side ${open ? "open" : "rail"}`}>
        <div className="top">
          <button className="burger" onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}>{open ? "‹" : "›"}</button>
          {open && <h1>Vault</h1>}
        </div>

        {nav.map((n) => (
          <button key={n.k} className={`navbtn ${view === n.k ? "on" : ""}`}
            title={open ? undefined : n.label}
            onClick={() => (n.k === "dash" || n.k === "graph" || n.k === "todos")
              ? (setView(n.k), setTag(null), setAdding(false), setPageId(null))
              : openSection(n.k)}>
            <span className="ic" aria-hidden="true">{n.icon}</span>
            {open && <>{n.label}{n.k in SECTIONS && <span className="cnt">{items.filter((i) => i.type === n.k).length}</span>}</>}
          </button>
        ))}

        <button className="navbtn" onClick={() => setPalette(true)} title="Search everything (Ctrl+K)">
          <span className="ic" aria-hidden="true">⌕</span>
          {open && <>Search<span className="cnt">⌘K</span></>}
        </button>

        {open && allTags.length > 0 && <div className="grp">PROJECTS · TAGS</div>}
        {open && allTags.map((t) => (
          <button key={t} className={`navbtn ${view === "tag" && tag === t ? "on" : ""}`} onClick={() => openTag(t)}>
            <span className="ic" aria-hidden="true">#</span>{t}
            <span className="cnt">{items.filter((i) => i.tags.includes(t)).length}</span>
          </button>
        ))}

        {open && (
          <div className="foot">
            Data lives in this browser (localStorage).
            <div style={{ marginTop: 6 }}>
              <button onClick={exportJson}>⬇ Export backup</button>
              <button onClick={() => importRef.current?.click()}>⬆ Import</button>
              <input ref={importRef} type="file" accept="application/json" hidden onChange={onImport} />
            </div>
          </div>
        )}
      </nav>

      <main className="main">
        <div className="topbar">
          <span className={`savestate ${saveState.startsWith("Saving") ? "busy" : ""}`}>{saveState}</span>
          <div style={{ flex: 1 }} />
          <button className="avatar" onClick={(e) => { e.stopPropagation(); setMenuOpen((m) => !m); }}
            aria-haspopup="menu" aria-expanded={menuOpen} title="Profile & settings">
            {(profile.name || "You").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </button>
          {menuOpen && (
            <div className="menu" onClick={(e) => e.stopPropagation()} role="menu">
              <div className="menu-sec">PROFILE</div>
              <input className="menu-input" value={profile.name} aria-label="Your name"
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                placeholder="Your name" />
              <div className="menu-sec">SETTINGS</div>
              <button className="menu-item" onClick={() => setProfile({ ...profile, theme: profile.theme === "dark" ? "light" : "dark" })}>
                {profile.theme === "dark" ? "☀ Light mode" : "◐ Dark mode"}
              </button>
              <button className="menu-item" onClick={() => { exportJson(); setMenuOpen(false); }}>⬇ Export backup (JSON)</button>
              <button className="menu-item" onClick={() => { importRef.current?.click(); }}>⬆ Import backup</button>
              <button className="menu-item danger" onClick={() => {
                if (window.confirm("Delete ALL items? Export a backup first if unsure.")) {
                  importJson(new Blob(["[]"], { type: "application/json" }), () => {});
                  setMenuOpen(false);
                }
              }}>✕ Clear all data</button>
              <div className="menu-foot">Vault v1 · data stays in this browser</div>
            </div>
          )}
        </div>
        {undoItem && (
          <div className="toast" role="status">
            Deleted “{(undoItem.alias || undoItem.title).slice(0, 40)}”
            <button onClick={() => { add(undoItem); setUndoItem(null); }}>Undo</button>
          </div>
        )}
        {view === "dash" && (
          <>
            <div className="crumb">Overview · {fmtStamp(today())}</div>
            <h2 className="display">Your collection, at a glance</h2>
            <p className="sub">Every item is stamped the day it arrives. Press <span className="kbd">Ctrl</span>+<span className="kbd">K</span> to search everything.</p>

            <div className="bar">
              <input placeholder="Search your whole vault — notes, videos, books, docs, #tags…"
                value={dq} onChange={(e) => setDq(e.target.value)} aria-label="Search vault" />
              {dq && <button className="btn ghost" onClick={() => setDq("")}>Clear</button>}
            </div>
            {dq && (
              <div className="card">
                <h3>Results for “{dq}”</h3>
                {items
                  .filter((i) => (i.title + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(dq.toLowerCase()))
                  .slice(0, 8)
                  .map((it) => {
                    const s = SECTIONS[it.type];
                    return (
                      <div key={it.id} className="row" style={{ padding: "10px 12px", cursor: "pointer" }}
                        onClick={() => { openSection(it.type); setDq(""); }} role="button" tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && (openSection(it.type), setDq(""))}>
                        <div className="icbox" style={{ width: 30, height: 30, fontSize: 13, background: s.soft, color: s.color }} aria-hidden="true">{s.icon}</div>
                        <div className="body">
                          <div className="t" style={{ fontSize: 14 }}>{it.title}</div>
                          <div className="m">{s.label} · {it.tags.map((t) => `#${t}`).join(" ") || "no tags"}</div>
                        </div>
                        <div className="stamp">Added · {fmtStamp(it.date)}</div>
                      </div>
                    );
                  })}
                {items.filter((i) => (i.title + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(dq.toLowerCase())).length === 0 && (
                  <div className="empty">No matches for “{dq}”.</div>
                )}
              </div>
            )}

            <div className="tiles">
              {Object.entries(SECTIONS).map(([k, s]) => (
                <div key={k} className="tile" onClick={() => openSection(k)} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && openSection(k)}>
                  <div className="k" style={{ color: s.color }}>{s.icon} {s.label}</div>
                  <div className="n">{items.filter((i) => i.type === k).length}</div>
                  <div className="d"><b>+{thisWeek(k)}</b> this week</div>
                </div>
              ))}
            </div>

            <Resurface items={items} onOpen={goto} />

            {items.some((i) => i.type === "book" && (i.progress || 0) > 0 && (i.progress || 0) < 100) && (
              <div className="card" style={{ borderColor: "var(--gold)" }}>
                <h3>Continue reading</h3>
                {items
                  .filter((i) => i.type === "book" && (i.progress || 0) > 0 && (i.progress || 0) < 100)
                  .sort((a, b) => (b.progress || 0) - (a.progress || 0))
                  .map((b) => (
                    <div key={b.id} className="row" style={{ padding: "10px 12px", cursor: "pointer" }}
                      onClick={() => goto(b)} role="button" tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && goto(b)}>
                      <div className="icbox" style={{ width: 30, height: 30, fontSize: 13, background: "var(--gold-soft)", color: "var(--gold)" }} aria-hidden="true">▤</div>
                      <div className="body">
                        <div className="t" style={{ fontSize: 14 }}>{b.title}</div>
                        <div className="readbar"><div className="readbar-fill" style={{ width: `${b.progress || 0}%` }} /></div>
                      </div>
                      <span className="readpct mono" style={{ flexShrink: 0 }}>{b.progress || 0}%</span>
                    </div>
                  ))}
              </div>
            )}

            <div className="charts">
              <div className="card"><h3>Items added per week</h3><WeeklyBars items={items} /></div>
              <div className="card"><h3>Where things live</h3><Donut items={items} /></div>
            </div>

            {allTags.length > 0 && (
              <div className="card">
                <h3>Projects</h3>
                <div className="tagband" style={{ marginBottom: 0 }}>
                  {allTags.map((t) => (
                    <button key={t} className="tagchip" onClick={() => openTag(t)}>
                      #{t} · {items.filter((i) => i.tags.includes(t)).length}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {view === "todos" && (
          <>
            <div className="crumb">Tasks</div>
            <h2 className="display">To-dos</h2>
            <p className="sub">Collapsible lists — drag the ⋮⋮ handle to reorder a to-do, or drop it onto another list to move it there.</p>
            <TodoBoard />
          </>
        )}

        {view === "graph" && (
          <>
            <div className="crumb">Connections</div>
            <h2 className="display">Graph</h2>
            <p className="sub">Purple hubs are your project tags; small dots are resources. Hover to trace a project, click a hub to open it.</p>
            <GraphView items={items} onOpenTag={openTag} onOpenSection={openSection} />
          </>
        )}

        {(view in SECTIONS || view === "tag") && pageItem && (
          <NotePage it={pageItem} onBack={() => setPageId(null)} onUpdate={updateStamped} onTag={openTag} />
        )}

        {(view in SECTIONS || view === "tag") && !pageItem && (
          <>
            <div className="crumb">{view === "tag" ? "Project" : "Section"}</div>
            <h2 className="display">{view === "tag" ? `#${tag}` : SECTIONS[view].label}</h2>
            <p className="sub">
              {view === "tag"
                ? `Everything linked to “${tag}” across notes, videos, PDFs and documents.`
                : view === "video"
                  ? "Saved videos — press “Watch here” to play without leaving Vault."
                  : view === "book"
                    ? "Your reading hub — track progress on each book/PDF and link the notes, videos and docs that belong with it."
                    : "Click any #tag to jump to that project. Click item text to edit."}
            </p>

            {view === "tag" && (
              <div className="tagband">
                {Object.entries(SECTIONS).map(([k, s]) => {
                  const n = items.filter((i) => i.tags.includes(tag) && i.type === k).length;
                  return n ? <span key={k} className="pill" style={{ background: s.soft, color: s.color, marginTop: 0 }}>{s.icon} {n} {s.label.toLowerCase()}</span> : null;
                })}
              </div>
            )}

            {view === "doc" && (() => {
              const files = items.filter((i) => i.type === "doc" && i.file);
              const bytes = files.reduce((a, b) => a + b.file.size, 0);
              return (
                <div className="doclib-head">
                  <span className="doclib-meta mono">{files.length} file{files.length === 1 ? "" : "s"} · {bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`} used</span>
                  <div className="doctabs" role="tablist" aria-label="Filter by file type">
                    {["All", "PDF", "Word", "Sheet", "Image"].map((f) => (
                      <button key={f} className={docFilter === f ? "on" : ""} role="tab"
                        aria-selected={docFilter === f} onClick={() => setDocFilter(f)}>{f}</button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="bar">
              <input placeholder="Filter this view… (Ctrl+K searches everything)" value={q}
                onChange={(e) => setQ(e.target.value)} aria-label="Filter items" />
              {view === "note" && (
                <button className="btn ghost" onClick={() => setShowTemplates((v) => !v)}>
                  {showTemplates ? "Close templates" : "▦ Templates"}
                </button>
              )}
              {(view === "note" || view === "doc") && (
                <div className="layouttoggle" role="group" aria-label="Layout">
                  <button className={notesLayout === "list" ? "on" : ""} title="List view"
                    onClick={() => setNotesLayout("list")}>☰</button>
                  <button className={notesLayout === "grid" ? "on" : ""} title="Grid view"
                    onClick={() => setNotesLayout("grid")}>▦</button>
                </div>
              )}
              <button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? "Close" : "+ Add item"}</button>
            </div>

            {view === "note" && showTemplates && (
              <div className="tplwrap">
                <div className="tpl-title display">Templates</div>
                <div className="tpl-sub">Start a new page from a structured starter</div>
                <div className="tplgrid">
                  {TEMPLATES.map((t) => {
                    const st = templateStats(t);
                    return (
                      <div key={t.title} className="tplcard">
                        <div className="tpl-cat mono">{t.cat}</div>
                        <div className="tpl-name display">{t.title}</div>
                        <div className="tpl-desc">{t.desc}</div>
                        <div className="tpl-meta mono">{st.blocks} blocks · {st.tasks} task{st.tasks === 1 ? "" : "s"}</div>
                        <button className="tpl-use" onClick={() => useTemplate(t)}>＋ Use template</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {adding && (
              <AddForm section={view} existingTags={allTags}
                onAdd={(it) => add(view === "tag" ? { ...it, tags: [...new Set([...it.tags, tag])] } : it)}
                onClose={() => setAdding(false)} />
            )}

            {(view === "note" || view === "doc") && notesLayout === "grid" ? (
              visible.length ? (
                <div className="notegrid">
                  {visible.map((it) => {
                    const first = (it.blocks || []).find((b) => b.text && b.text.trim());
                    const nT = (it.blocks || []).filter((b) => b.kind === "todo").length;
                    const nD = (it.blocks || []).filter((b) => b.kind === "todo" && b.done).length;
                    return (
                      <div key={it.id} className={`notecard ${focusId === it.id ? "flash" : ""}`} role="button" tabIndex={0}
                        onClick={() => setPageId(it.id)}
                        onKeyDown={(e) => e.key === "Enter" && setPageId(it.id)}>
                        <div className="nc-title">
                          {it.pinned && <span style={{ color: "var(--gold)" }} aria-label="Pinned">★ </span>}
                          {it.title}
                        </div>
                        {first && <div className="nc-preview">{first.text.slice(0, 140)}{first.text.length > 140 ? "…" : ""}</div>}
                        {!first && <div className="nc-preview" style={{ fontStyle: "italic" }}>{it.meta}</div>}
                        <div className="nc-foot">
                          {it.tags.slice(0, 3).map((t) => (
                            <span key={t} className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginTop: 0 }}>#{t}</span>
                          ))}
                          {nT > 0 && <span className="bcount">☑ {nD}/{nT}</span>}
                          <span className="nc-date mono">{fmtStamp(it.date)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="empty">Nothing here yet. Tap <b>+ Add item</b> to create your first {SECTIONS[view].label.toLowerCase().replace(/s$/, "")}.</div>
            ) : visible.length
              ? visible.map((it) => <ItemRow key={it.id} it={it} onTag={openTag} onUpdate={updateStamped} onRemove={removeWithUndo}
                  allItems={items} onGoto={goto} focus={focusId === it.id} onOpen={() => setPageId(it.id)} />)
              : <div className="empty">Nothing here yet. Tap <b>+ Add item</b>, paste a link for instant capture, or drop a file straight into the form.</div>}
          </>
        )}
      </main>
    </div>
  );
}

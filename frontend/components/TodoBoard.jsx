"use client";

import React, { useEffect, useMemo, useState } from "react";
import { today, daysAgo, fmtStamp } from "@/lib/seed";
import { WeekView, MonthView, YearView, startOfWeek } from "./TodoCalendar";
import { MiniBars, weekSeries, weekLabels } from "./Charts";
import { importICSFile, getCalendarEvents } from "@/lib/ics";

/* To-dos, redesigned for simplicity: ONE quick-add bar, and the app sorts
 * everything into smart sections — Overdue, Today, Upcoming, Someday — by
 * due date and priority. No lists to manage, no dragging required.
 *
 * Storage is versioned (schema v2, flat tasks). v1 multi-list data migrates
 * automatically: list names become labels, "Today"/"This week" become dates. */

const uid = () => Math.random().toString(36).slice(2, 9);
const KEY = "vault.todos.v1";

const dRel = (days) => { const t = new Date(); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };

const seedTasks = () => ([
  { id: "t1", text: "Watch FastAPI course — section 3", done: false, due: dRel(0), high: true, created: dRel(0) },
  { id: "t2", text: "Push Vault to GitHub", done: false, due: dRel(0), high: false, created: dRel(0) },
  { id: "t3", text: "Finish DDIA chapter 5", done: false, due: dRel(2), high: false, created: dRel(-1) },
  { id: "t6", text: "Renew domain (overdue sample)", done: false, due: dRel(-2), high: true, created: dRel(-6) },
  { id: "t5", text: "Migrate file storage to IndexedDB", done: false, due: null, high: false, label: "Someday", created: dRel(-3) },
  { id: "t4", text: "Write portfolio README v2", done: true, doneAt: dRel(0), due: dRel(0), high: false, created: dRel(-2) },
]);

/* v1 → v2 migration: flatten lists into tasks; list names inform dates/labels */
function migrate(saved) {
  if (saved && saved.version === 2 && Array.isArray(saved.tasks)) return saved;
  if (Array.isArray(saved)) {
    const tasks = [];
    for (const list of saved) {
      const t = (list.title || "").toLowerCase();
      const due = /today/.test(t) ? dRel(0) : /week/.test(t) ? dRel(3) : null;
      const label = /today|week|someday/.test(t) ? undefined : (list.title || undefined);
      for (const td of list.todos || []) {
        tasks.push({ id: td.id || uid(), text: td.text, done: !!td.done, doneAt: td.done ? dRel(0) : undefined, due, high: false, label, created: dRel(0) });
      }
    }
    return { version: 2, tasks };
  }
  return { version: 2, tasks: seedTasks() };
}

const DUE_CHIPS = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["nextweek", "Next week"],
  ["none", "Someday"],
];
const chipToDate = (chip) => (chip === "today" ? dRel(0) : chip === "tomorrow" ? dRel(1) : chip === "nextweek" ? dRel(7) : null);

const dueLabel = (due) => {
  if (!due) return "";
  const diff = -daysAgo(due);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 0) return `${-diff}d overdue`;
  if (diff <= 7) return new Date(due + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
  return fmtStamp(due).slice(0, 6);
};

export default function TodoBoard() {
  const [store, setStore] = useState({ version: 2, tasks: seedTasks() });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setStore(migrate(JSON.parse(raw)));
    } catch (e) { console.error(e); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { console.error(e); }
  }, [store, hydrated]);

  const tasks = store.tasks;
  const setTasks = (fn) => setStore((s) => ({ ...s, tasks: typeof fn === "function" ? fn(s.tasks) : fn }));

  /* ---------- quick add */
  const [text, setText] = useState("");
  const [dueChip, setDueChip] = useState("today");
  const [customDue, setCustomDue] = useState("");
  const [high, setHigh] = useState(false);
  const add = () => {
    if (!text.trim()) return;
    const due = customDue || chipToDate(dueChip);
    setTasks((ts) => [{ id: uid(), text: text.trim(), done: false, due, high, created: today() }, ...ts]);
    setText(""); setHigh(false);
  };

  /* ---------- task ops */
  const patch = (id, p) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const del = (id) => setTasks((ts) => ts.filter((t) => t.id !== id));
  const toggle = (t) => patch(t.id, { done: !t.done, doneAt: !t.done ? today() : undefined });
  const clearDone = () => setTasks((ts) => ts.filter((t) => !t.done));

  const [resched, setResched] = useState(null); // task id with the date editor open

  /* ---------- smart sections */
  const sections = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    const bySort = (a, b) => (b.high ? 1 : 0) - (a.high ? 1 : 0) || (a.due || "9999").localeCompare(b.due || "9999") || (a.created || "").localeCompare(b.created || "");
    const t0 = today();
    return [
      { key: "overdue", title: "Overdue", color: "var(--stamp)", tasks: open.filter((t) => t.due && t.due < t0).sort(bySort) },
      { key: "today", title: "Today", color: "var(--moss)", tasks: open.filter((t) => t.due === t0).sort(bySort) },
      { key: "upcoming", title: "Upcoming", color: "var(--gold)", tasks: open.filter((t) => t.due && t.due > t0).sort(bySort) },
      { key: "someday", title: "Someday", color: "var(--blue)", tasks: open.filter((t) => !t.due).sort(bySort) },
    ];
  }, [tasks]);

  const doneTasks = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const [showDone, setShowDone] = useState(false);

  const todayTotal = tasks.filter((t) => t.due === today()).length;
  const todayDone = tasks.filter((t) => t.due === today() && t.done).length;

  /* time views: List (smart sections) · Day · Week · Month calendar · Year */
  const [mode, setMode] = useState("list");
  const [anchor, setAnchor] = useState(today());
  const [calEvents, setCalEvents] = useState([]);
  const [calMsg, setCalMsg] = useState(null);
  const icsRef = React.useRef(null);
  useEffect(() => { setCalEvents(getCalendarEvents()); }, []);
  const dueOnDay = tasks.filter((t) => !t.done && t.due === anchor).sort((a, b) => (b.high ? 1 : 0) - (a.high ? 1 : 0));
  const doneOnDay = tasks.filter((t) => t.done && (t.doneAt === anchor || t.due === anchor));

  const shiftAnchor = (delta) => {
    const a = new Date(anchor + "T00:00:00");
    if (mode === "day") a.setDate(a.getDate() + delta);
    else if (mode === "week") a.setDate(a.getDate() + 7 * delta);
    else if (mode === "month") a.setMonth(a.getMonth() + delta);
    else a.setFullYear(a.getFullYear() + delta);
    setAnchor(a.toISOString().slice(0, 10));
  };
  const anchorLabel =
    mode === "day" ? (anchor === today() ? "Today" : fmtStamp(anchor))
    : mode === "week" ? `Week of ${fmtStamp(startOfWeek(anchor).toISOString().slice(0, 10))}`
    : mode === "month" ? new Date(anchor + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : anchor.slice(0, 4);
  const openDay = (d) => { setAnchor(d); setMode("day"); };

  const Row = ({ t, showDue = true }) => (
    <div className={`trow ${t.done ? "tdone" : ""}`}>
      <input type="checkbox" checked={t.done} aria-label="Done" onChange={() => toggle(t)} />
      <button className={`tflag ${t.high ? "on" : ""}`} title={t.high ? "High priority — click to unset" : "Mark high priority"}
        aria-pressed={t.high} onClick={() => patch(t.id, { high: !t.high })}>⚑</button>
      <input className="tr-text" value={t.text} aria-label="To-do text"
        style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.55 : 1 }}
        onChange={(e) => patch(t.id, { text: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Backspace" && !t.text) { e.preventDefault(); del(t.id); } }} />
      {t.label && <span className="tlabel mono">{t.label}</span>}
      {showDue && !t.done && (
        <button className={`tduechip mono ${t.due && t.due < today() ? "late" : ""}`}
          title="Change the due date"
          onClick={() => setResched(resched === t.id ? null : t.id)}>
          {t.due ? dueLabel(t.due) : "no date"}
        </button>
      )}
      <button className="tr-del" title="Delete to-do" aria-label="Delete to-do" onClick={() => del(t.id)}>✕</button>
    </div>
  );

  const Resched = ({ t }) => (
    <div className="tresched">
      {DUE_CHIPS.map(([k, l]) => (
        <button key={k} className="qtag" onClick={() => { patch(t.id, { due: chipToDate(k) }); setResched(null); }}>{l}</button>
      ))}
      <input type="date" aria-label="Pick a due date"
        onChange={(e) => { if (e.target.value) { patch(t.id, { due: e.target.value }); setResched(null); } }} />
    </div>
  );

  return (
    <div className="todosimple">
      {/* quick add — the only input you need */}
      <div className="tquick">
        <input className="tquick-input" placeholder="Add a to-do and press Enter — that's it"
          value={text} aria-label="Add a to-do"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className={`tflag big ${high ? "on" : ""}`} title="High priority" aria-pressed={high}
          onClick={() => setHigh((h) => !h)}>⚑</button>
        <button className="btn sm" onClick={add} disabled={!text.trim()}>Add</button>
      </div>
      <div className="tquick-chips">
        <span className="mono" style={{ fontSize: 10, letterSpacing: 1, color: "var(--ink-soft)" }}>DUE</span>
        {DUE_CHIPS.map(([k, l]) => (
          <button key={k} className={`qtag ${dueChip === k && !customDue ? "on" : ""}`}
            onClick={() => { setDueChip(k); setCustomDue(""); }}>{l}</button>
        ))}
        <input type="date" value={customDue} aria-label="Custom due date"
          onChange={(e) => setCustomDue(e.target.value)} />
        {todayTotal > 0 && (
          <span className="tprog">
            <span className="mono">{todayDone}/{todayTotal} today</span>
            <span className="tl-bar"><span className="tl-bar-fill" style={{ width: `${(todayDone / todayTotal) * 100}%` }} /></span>
          </span>
        )}
      </div>

      {/* time views + navigation */}
      <div className="tmodebar">
        <div className="doctabs" role="tablist" aria-label="To-do views">
          {[["list", "☰ List"], ["day", "Day"], ["week", "Week"], ["month", "▦ Month"], ["year", "Year"]].map(([m, l]) => (
            <button key={m} className={mode === m ? "on" : ""} role="tab" aria-selected={mode === m}
              onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        {mode !== "list" && (
          <span className="tnav">
            <button onClick={() => shiftAnchor(-1)} aria-label="Previous" title="Previous">‹</button>
            <span className="mono tnav-label">{anchorLabel}</span>
            <button onClick={() => shiftAnchor(1)} aria-label="Next" title="Next">›</button>
            <button className="kbtn" onClick={() => setAnchor(today())} title="Jump to today">Today</button>
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {calEvents.length > 0 && (
            <span className="cardsub mono" title="Events from calendars you've imported">
              📅 {calEvents.length} event{calEvents.length === 1 ? "" : "s"} linked
            </span>
          )}
          <button className="kbtn" onClick={() => icsRef.current?.click()}
            title="Import your Google / Apple / Outlook calendar — export it as .ics there, drop it here; events appear beside your to-dos">
            📅 Import calendar
          </button>
          <input ref={icsRef} type="file" accept=".ics,text/calendar" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importICSFile(f, (r) => { setCalEvents(getCalendarEvents()); setCalMsg(`Imported ${r.added} events from “${r.cal}”`); setTimeout(() => setCalMsg(null), 4000); });
              e.target.value = "";
            }} />
        </span>
      </div>
      {calMsg && <div className="m" style={{ color: "var(--moss)", fontSize: 12, marginBottom: 8 }}>✓ {calMsg} — they show in Day, Week and Month views.</div>}

      {mode === "day" ? (
        <>
          <div className="tsec">
            <div className="tsec-head">
              <span className="kdot" style={{ background: "var(--moss)" }} aria-hidden="true" />
              <span className="tsec-title">Due {anchor === today() ? "today" : fmtStamp(anchor)}</span>
              <span className="kcount mono">{dueOnDay.length}</span>
            </div>
            {dueOnDay.length === 0 && <div className="m" style={{ color: "var(--ink-soft)", padding: "4px 2px 8px" }}>Nothing due on {fmtStamp(anchor)} — use ‹ › to browse days.</div>}
            {dueOnDay.map((t) => (
              <React.Fragment key={t.id}>
                <Row t={t} />
                {resched === t.id && <Resched t={t} />}
              </React.Fragment>
            ))}
          </div>
          {calEvents.filter((e) => e.date === anchor).length > 0 && (
            <div className="tsec">
              <div className="tsec-head">
                <span className="kdot" style={{ background: "var(--azure)" }} aria-hidden="true" />
                <span className="tsec-title">From your calendars</span>
                <span className="kcount mono">{calEvents.filter((e) => e.date === anchor).length}</span>
              </div>
              {calEvents.filter((e) => e.date === anchor).sort((a, b) => (a.time || "").localeCompare(b.time || "")).map((e) => (
                <div key={e.id} className="calev">
                  <span className="calev-time mono">{e.time || "all day"}</span>
                  <span className="calev-title">{e.summary}</span>
                  <span className="calev-cal mono">{e.cal}</span>
                </div>
              ))}
            </div>
          )}
          {doneOnDay.length > 0 && (
            <div className="tsec tdonesec">
              <div className="tsec-head">
                <span className="kdot" style={{ background: "var(--ink-soft)" }} aria-hidden="true" />
                <span className="tsec-title" style={{ color: "var(--ink-soft)" }}>Completed that day</span>
                <span className="kcount mono">{doneOnDay.length}</span>
              </div>
              {doneOnDay.map((t) => <Row key={t.id} t={t} showDue={false} />)}
            </div>
          )}
        </>
      ) : mode === "week" ? (
        <WeekView tasks={tasks} anchor={anchor} onPickDay={openDay} events={calEvents} />
      ) : mode === "month" ? (
        <MonthView tasks={tasks} anchor={anchor} onPickDay={openDay} events={calEvents} />
      ) : mode === "year" ? (
        <YearView tasks={tasks} anchor={anchor} onPickMonth={(m) => { setAnchor(m); setMode("month"); }} />
      ) : (
        <>
      {sections.map((s) => s.tasks.length > 0 && (
        <div key={s.key} className="tsec">
          <div className="tsec-head">
            <span className="kdot" style={{ background: s.color }} aria-hidden="true" />
            <span className="tsec-title">{s.title}</span>
            <span className="kcount mono">{s.tasks.length}</span>
          </div>
          {s.tasks.map((t) => (
            <React.Fragment key={t.id}>
              <Row t={t} />
              {resched === t.id && <Resched t={t} />}
            </React.Fragment>
          ))}
        </div>
      ))}

      {sections.every((s) => s.tasks.length === 0) && (
        <div className="empty">All clear 🎉 — add a to-do above, or enjoy the quiet.</div>
      )}
        </>
      )}

      {mode === "list" && doneTasks.length > 0 && (
        <div className="tsec tdonesec">
          <div className="tsec-head">
            <button className="tl-toggle" onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}>{showDone ? "▾" : "▸"}</button>
            <span className="tsec-title" style={{ color: "var(--ink-soft)" }}>Done</span>
            <span className="kcount mono">{doneTasks.length}</span>
            <button className="kbtn kdel" style={{ marginLeft: "auto" }} onClick={clearDone}
              title="Remove all completed to-dos">Clear all</button>
          </div>
          {showDone && doneTasks.map((t) => <Row key={t.id} t={t} showDue={false} />)}
        </div>
      )}

      {mode === "list" && (
        <details className="seclc">
          <summary className="seclc-head">
            <span>📈 Your pace</span>
            <span className="cardsub mono">to-dos finished per week · last 8 weeks</span>
          </summary>
          <MiniBars height={120} labels={weekLabels(8)} color="var(--moss)"
            values={weekSeries(tasks.filter((t) => t.done && t.doneAt).map((t) => t.doneAt))} />
        </details>
      )}
    </div>
  );
}

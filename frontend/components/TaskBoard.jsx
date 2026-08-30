"use client";

import React, { useEffect, useMemo, useState } from "react";
import { today, daysAgo, fmtStamp } from "@/lib/seed";
import { WeekView, MonthView, YearView, startOfWeek } from "./TaskCalendar";
import { MiniBars, weekSeries, weekLabels } from "./Charts";
import { importICSFile, getCalendarEvents } from "@/lib/ics";
import { mirror, api, backendOn, hasVerifiedIdentity } from "@/lib/api";
import { uid } from "@/lib/id";
import { safeSet } from "@/lib/safeStorage";
import { useCrossTab } from "@/lib/crosstab";

/* To-dos, redesigned for simplicity: ONE quick-add bar, and the app sorts
 * everything into smart sections — Overdue, Today, Upcoming, Someday — by
 * due date and priority. No lists to manage, no dragging required.
 *
 * Storage is versioned (schema v2, flat tasks). v1 multi-list data migrates
 * automatically: list names become labels, "Today"/"This week" become dates. */

const KEY = "vault.todos.v1";

/* Local task → backend TaskIn payload (POST /todos is an idempotent upsert).
 * Dates are already ISO YYYY-MM-DD strings — pass through, undefined→null. */
const toApi = (t) => ({
  id: t.id, text: t.text, done: t.done,
  done_at: t.doneAt ?? null, due: t.due ?? null,
  high: t.high, label: t.label ?? null, created_on: t.created,
  /* see useStore's toApi: the server refuses older stamps, so a replayed
   * offline write can't clobber a newer edit from another device */
  updated_at: t.ts || 0,
});

const dRel = (days) => { const t = new Date(); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };

/* Next occurrence of a recurring task, from its current due date. */
const advanceDue = (due, recur) => {
  const d = new Date((due || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  if (recur === "daily") d.setDate(d.getDate() + 1);
  else if (recur === "weekly") d.setDate(d.getDate() + 7);
  else if (recur === "monthly") d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
};
const nextRecur = (r) => (r === "daily" ? "weekly" : r === "weekly" ? "monthly" : r === "monthly" ? null : "daily");

/* Sample tasks exercise every task feature — priorities, labels, a recurring
 * task, subtasks — and spread finished work over days, weeks, months and
 * years so the dashboard's momentum chart shows real hills and valleys in
 * every range, not a flat line with one spike. */
const DONE_RECENT = [
  "Write portfolio README v2", "Fix CSP header on the frontend", "Reply to launch feedback",
  "Clean the content inbox", "Update dependencies", "Review budget categories",
  "Archive stale notes", "Set up error alerts", "Refactor sync queue",
  "Draft privacy policy outline", "Test statement import", "Tune RAG chunking",
];
const DONE_OLDER = [
  "Ship calendar two-way sync", "Add recurring tasks", "Build subtask checklists",
  "Merge content sections", "Redesign the dashboard", "Wire NVIDIA NIM models",
  "Set up S3 uploads", "Add account export", "Write the test suite",
  "Deploy the backend", "Model the database", "Sketch the first prototype",
];
/* the full first-run store, exported so sample mode can seed it eagerly —
 * otherwise the dashboard reads empty todos until this view first mounts.
 * sample:true marks every seed row so "Remove sample data" can strip demo
 * content without touching anything the user made. */
export const seedTodoStore = () => ({ version: 2, tasks: seedTasks().map((t) => ({ ...t, sample: true })) });
const seedTasks = () => ([
  /* open — feeds Needs-you-now and the agenda buckets */
  { id: uid(), text: "Watch FastAPI course — section 3", done: false, due: dRel(0), high: true, created: dRel(-1) },
  { id: uid(), text: "Push Vault to GitHub", done: false, due: dRel(0), high: false, created: dRel(0) },
  { id: uid(), text: "Finish DDIA chapter 5", done: false, due: dRel(2), high: false, created: dRel(-1) },
  { id: uid(), text: "Renew domain (overdue sample)", done: false, due: dRel(-2), high: true, created: dRel(-6) },
  { id: uid(), text: "Migrate file storage to IndexedDB", done: false, due: null, high: false, label: "Someday", created: dRel(-3) },
  /* feature showcases: a recurring task and one broken into subtasks */
  { id: uid(), text: "Weekly review — plan the week ahead", done: false, due: dRel(1), high: false, recur: "weekly", created: dRel(-13) },
  { id: uid(), text: "Prepare the launch demo", done: false, due: dRel(3), high: true, created: dRel(-2),
    subs: [
      { id: uid(), text: "Write the 60-second script", done: true },
      { id: uid(), text: "Record the screen capture", done: true },
      { id: uid(), text: "Cut and caption the clip", done: false },
    ] },
  /* a fortnight of finished work with an uneven daily rhythm */
  ...[[0, 2], [1, 1], [2, 3], [3, 0], [4, 1], [5, 2], [6, 0], [7, 1], [8, 3], [9, 0], [10, 2], [11, 1], [12, 0], [13, 1]]
    .flatMap(([ago, n], di) => Array.from({ length: n }, (_, i) => ({
      id: uid(), text: DONE_RECENT[(di * 2 + i) % DONE_RECENT.length], done: true,
      doneAt: dRel(-ago), due: dRel(-ago), high: (ago + i) % 5 === 0, created: dRel(-ago - 2),
    }))),
  /* earlier weeks, months and years so Weekly/Monthly/Yearly ranges move too */
  ...[-17, -20, -25, -32, -39, -46, -60, -85, -110, -150, -210, -280, -370, -430, -540].map((d, i) => ({
    id: uid(), text: DONE_OLDER[i % DONE_OLDER.length], done: true,
    doneAt: dRel(d), due: dRel(d), high: false, created: dRel(d - 3),
  })),
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

export default function TaskBoard() {
  const [store, setStore] = useState(seedTodoStore);
  const [hydrated, setHydrated] = useState(false);
  useCrossTab(KEY, (v) => setStore(migrate(v)));
  const [undo, setUndo] = useState(null);       // { label, restore } for 6s after a delete
  const undoTimer = React.useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setStore(migrate(JSON.parse(raw)));
    } catch (e) { console.error(e); }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { safeSet(KEY, JSON.stringify(store)); }
    catch (e) { console.error(e); }
  }, [store, hydrated]);

  const tasks = store.tasks;
  const setTasks = (fn) => setStore((s) => ({ ...s, tasks: typeof fn === "function" ? fn(s.tasks) : fn }));

  /* ---------- quick add */
  const [text, setText] = useState("");
  const [dueChip, setDueChip] = useState("today");
  const [customDue, setCustomDue] = useState("");
  const [high, setHigh] = useState(false);
  const [recur, setRecur] = useState(null);       // null | daily | weekly | monthly
  const add = () => {
    if (!text.trim()) return;
    const due = customDue || chipToDate(dueChip);
    const task = { id: uid(), text: text.trim(), done: false, due, high, recur: recur || undefined, created: today(), ts: Date.now() };
    setTasks((ts) => [task, ...ts]);
    mirror("/todos", { method: "POST", body: toApi(task) });
    setText(""); setHigh(false); setRecur(null);
  };

  /* ---------- task ops — every mutation also mirrors to the backend when
   * sync is on (mirror() is a no-op otherwise). Mirrors live at the call
   * sites, never inside setTasks: updater functions must stay pure. */
  const patch = (id, p) => {
    const stamped = { ...p, ts: Date.now() };
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...stamped } : t)));
    const cur = tasks.find((t) => t.id === id);
    if (cur) mirror("/todos", { method: "POST", body: toApi({ ...cur, ...stamped }) });
  };
  /* delete with a 6-second undo — a one-tap ✕ must never silently destroy
   * work (items got this from day one; tasks deserve the same) */
  const del = (id) => {
    const t = tasks.find((x) => x.id === id);
    setTasks((ts) => ts.filter((x) => x.id !== id));
    mirror("/todos/" + id, { method: "DELETE" });
    if (!t) return;
    clearTimeout(undoTimer.current);
    setUndo({
      label: `Deleted “${(t.text || "task").slice(0, 40)}”`,
      restore: () => {
        setTasks((ts) => [t, ...ts]);
        mirror("/todos", { method: "POST", body: toApi(t) });
      },
    });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };
  const toggle = (t) => {
    const nowDone = !t.done;
    patch(t.id, { done: nowDone, doneAt: nowDone ? today() : undefined });
    // Completing a recurring task spawns its next occurrence.
    if (nowDone && t.recur && t.due) {
      const next = { id: uid(), text: t.text, done: false, due: advanceDue(t.due, t.recur),
                     high: t.high, recur: t.recur, label: t.label, created: today(), ts: Date.now() };
      setTasks((ts) => [next, ...ts]);
      mirror("/todos", { method: "POST", body: toApi(next) });
    }
  };
  const clearDone = () => {
    for (const t of tasks) if (t.done) mirror("/todos/" + t.id, { method: "DELETE" });
    setTasks((ts) => ts.filter((t) => !t.done));
  };

  const [resched, setResched] = useState(null); // task id with the date editor open
  const [subOpen, setSubOpen] = useState(null); // task id with its subtask checklist open
  const [subDraft, setSubDraft] = useState(""); // new-subtask text (one panel open at a time)

  /* Subtasks (checklist) — stored on the task; frontend-only for now (backup
     covers them). patch() mirrors the parent; the backend just ignores subs. */
  const addSub = (t) => {
    const text = subDraft.trim();
    if (!text) return;
    patch(t.id, { subs: [...(t.subs || []), { id: uid(), text, done: false }] });
    setSubDraft("");
  };
  const toggleSub = (t, sid) => patch(t.id, { subs: (t.subs || []).map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) });
  const delSub = (t, sid) => patch(t.id, { subs: (t.subs || []).filter((s) => s.id !== sid) });

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
  const [gCal, setGCal] = useState(false);        // a Google Calendar is connected
  const [pushMsg, setPushMsg] = useState(null);
  const icsRef = React.useRef(null);
  const pushTimer = React.useRef(null);
  /* Calendar events shown on the grid come from two places: imported .ics
     files (local) and a connected Google Calendar (backend). Both are mapped
     to the same {date, summary, cal, time} shape the views already render. */
  useEffect(() => {
    setCalEvents(getCalendarEvents());
    if (!backendOn() || !hasVerifiedIdentity()) return;
    (async () => {
      try {
        const s = await api("/calendar/status");
        if (s.connected_accounts > 0) setGCal(true);
        const g = await api("/calendar/events");
        const mapped = (g || []).filter((e) => e.starts_at).map((e) => {
          const d = new Date(e.starts_at);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return {
            id: `g-${e.id}`, date, summary: e.title || "(no title)", cal: "Google",
            time: e.all_day ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            source: "google",
          };
        });
        if (mapped.length) setCalEvents((prev) => [...prev, ...mapped]);
      } catch { /* not connected / offline — the .ics events still show */ }
    })();
  }, []);

  /* Two-way: once a Google Calendar is connected, mirror to-dos to it. Debounced
     so ticking done, editing, or rescheduling pushes the change (create/update/
     delete the matching event) without a call per keystroke. */
  const pushPayload = () => ({ tasks: tasks.map((t) => ({ id: t.id, text: t.text, due: t.due, done: t.done })) });
  useEffect(() => {
    if (!gCal) return;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      api("/calendar/push-todos", { method: "POST", body: pushPayload() }).catch(() => {});
    }, 1500);
    return () => clearTimeout(pushTimer.current);
  }, [tasks, gCal]);

  const pushToGoogle = async () => {
    setPushMsg("Pushing to Google…");
    try {
      const r = await api("/calendar/push-todos", { method: "POST", body: pushPayload() });
      setPushMsg(`Pushed ${r.pushed} to Google Calendar · removed ${r.removed}.`);
      setGCal(true);
    } catch (e) {
      setPushMsg(e?.status === 403
        ? "Reconnect Google to allow calendar writes (Settings → Connected apps)."
        : e?.status === 400 ? "Connect Google Calendar first (Settings → Connected apps)."
        : "Couldn't push to Google — try again.");
    }
    setTimeout(() => setPushMsg(null), 6000);
  };

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

  const Row = ({ t, showDue = true }) => {
    const subs = t.subs || [];
    const subDone = subs.filter((s) => s.done).length;
    return (
    <div className="titem">
      <div className={`trow ${t.done ? "tdone" : ""}`}>
      <input type="checkbox" checked={t.done} aria-label="Done" onChange={() => toggle(t)} />
      <button className={`tflag ${t.high ? "on" : ""}`} title={t.high ? "High priority — click to unset" : "Mark high priority"}
        aria-pressed={t.high} onClick={() => patch(t.id, { high: !t.high })}>⚑</button>
      <input className="tr-text" value={t.text} aria-label="Task text"
        style={{ textDecoration: t.done ? "line-through" : "none", opacity: t.done ? 0.55 : 1 }}
        onChange={(e) => patch(t.id, { text: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Backspace" && !t.text) { e.preventDefault(); del(t.id); } }} />
      {t.label && <span className="tlabel mono">{t.label}</span>}
      {t.recur && <span className="tlabel mono" title={`Repeats ${t.recur}`}>↻ {t.recur}</span>}
      <button className={`tsub-toggle mono ${subOpen === t.id ? "on" : ""}`} title="Subtasks"
        onClick={() => { setSubOpen(subOpen === t.id ? null : t.id); setSubDraft(""); }}>
        ☑ {subs.length ? `${subDone}/${subs.length}` : "+"}
      </button>
      {showDue && !t.done && (
        <button className={`tduechip mono ${t.due && t.due < today() ? "late" : ""}`}
          title="Change the due date"
          onClick={() => setResched(resched === t.id ? null : t.id)}>
          {t.due ? dueLabel(t.due) : "no date"}
        </button>
      )}
      <button className="tr-del" title="Delete task" aria-label="Delete task" onClick={() => del(t.id)}>✕</button>
      </div>
      {subOpen === t.id && (
        <div className="tsubs">
          {subs.map((s) => (
            <div key={s.id} className="tsub">
              <input type="checkbox" checked={s.done} aria-label="Subtask done" onChange={() => toggleSub(t, s.id)} />
              <span style={{ textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.55 : 1 }}>{s.text}</span>
              <button className="tr-del" title="Delete subtask" aria-label="Delete subtask" onClick={() => delSub(t, s.id)}>✕</button>
            </div>
          ))}
          <input className="tsub-input" value={subDraft} placeholder="Add a subtask…  (Enter)" aria-label="Add subtask"
            onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSub(t)} />
        </div>
      )}
    </div>
    );
  };

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
      {undo && (
        <div className="toast" role="status">
          {undo.label}{" "}
          <button className="av-link" onClick={() => { clearTimeout(undoTimer.current); undo.restore(); setUndo(null); }}>Undo</button>
        </div>
      )}
      {/* quick add — the only input you need */}
      <div className="tquick">
        <input className="tquick-input" placeholder="Add a task, press Enter"
          value={text} aria-label="Add a task"
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
        <button className={`qtag ${recur ? "on" : ""}`} title="Repeat this task — completing it creates the next one"
          onClick={() => setRecur(nextRecur)}>↻ {recur || "once"}</button>
        {todayTotal > 0 && (
          <span className="tprog">
            <span className="mono">{todayDone}/{todayTotal} today</span>
            <span className="tl-bar"><span className="tl-bar-fill" style={{ width: `${(todayDone / todayTotal) * 100}%` }} /></span>
          </span>
        )}
      </div>

      {/* time views + navigation */}
      <div className="tmodebar featbar">
        <div className="doctabs" role="tablist" aria-label="Task views">
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
          {gCal && (
            <button className="kbtn" onClick={pushToGoogle}
              title="Push your dated to-dos to Google Calendar — completing or deleting one updates it there too">
              ↑ Push to Google
            </button>
          )}
          <input ref={icsRef} type="file" accept=".ics,text/calendar" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importICSFile(f, (r) => { setCalEvents(getCalendarEvents()); setCalMsg(`Imported ${r.added} events from “${r.cal}”`); setTimeout(() => setCalMsg(null), 4000); });
              e.target.value = "";
            }} />
        </span>
      </div>
      {calMsg && <div className="m" style={{ color: "var(--moss)", fontSize: 12, marginBottom: 8 }}>✓ {calMsg} — they show in Day, Week and Month views.</div>}
      {pushMsg && <div className="m" style={{ color: "var(--moss)", fontSize: 12, marginBottom: 8 }}>{pushMsg}</div>}

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
      <div className="scrolllist scrolllist-tall tsecgrid">
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
      </div>

      {sections.every((s) => s.tasks.length === 0) && (
        <div className="empty">All clear 🎉 — add a task above, or enjoy the quiet.</div>
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
              title="Remove all completed tasks">Clear all</button>
          </div>
          {showDone && doneTasks.map((t) => <Row key={t.id} t={t} showDue={false} />)}
        </div>
      )}

      {mode === "list" && (
        <details className="seclc">
          <summary className="seclc-head">
            <span>📈 Your pace</span>
            <span className="cardsub mono">tasks finished per week · last 8 weeks</span>
          </summary>
          <MiniBars height={120} labels={weekLabels(8)} color="var(--moss)"
            values={weekSeries(tasks.filter((t) => t.done && t.doneAt).map((t) => t.doneAt))} />
        </details>
      )}
    </div>
  );
}

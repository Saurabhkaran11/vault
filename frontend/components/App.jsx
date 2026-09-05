"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, fmtStamp, daysAgo, today, fmtK } from "@/lib/seed";
import { useStore } from "@/hooks/useStore";
import { Donut, rangeSeries, TinyBars, SparkArea, VaultGrowth, TaskRhythm, CaptureSources, Zoom, AskGoDialog } from "./Charts";
import { YourCharts, ChartExplorer, newChartCfg, upsertChart, deleteChart } from "./ChartLab";
import GraphView from "./GraphView";
import ItemRow, { TagAdder } from "./ItemRow";
import { Ic } from "./Icons";
import QuickCapture from "./QuickCapture";
import { initOnboarding, setOB, startClean, removeSampleData, WelcomeModal, ChecklistCard } from "./Onboarding";
import { KEY_ACTIONS, NAV_ACTIONS, DEFAULT_KEYS, getKeymap, setKeymap, resetKeymap, validateKey } from "@/lib/keymap";
import { ACCENTS, DEFAULT_ACCENT, applyAccent, BG_TINTS, DEFAULT_BG, CHART_COLORS, DEFAULT_CHART, applyThemeExtras } from "@/lib/accents";
import Intro from "./Intro";
import { installGlobalHandlers } from "@/lib/monitor";
import { getCustomTags, addCustomTag, removeCustomTag, normalizeTag } from "@/lib/tags";
import { REPORTS, downloadReport, openReport } from "@/lib/report";
import { downloadICS } from "@/lib/ics";
import { detectCloud, cloudTitle } from "@/lib/cloud";
import AddForm from "./AddForm";
import CommandPalette from "./CommandPalette";
import ShortcutsHelp from "./ShortcutsHelp";
import NoteBlocks from "./NoteBlocks";
import TaskBoard, { seedTodoStore } from "./TaskBoard";
import ProjectBoard from "./ProjectBoard";
import CustomBoards from "./CustomBoards";
import FinanceBoard, { seedFinance } from "./FinanceBoard";
import LocalModels, { QuickAISetup } from "./LocalModels";
import SearchIndexCard from "./SearchIndexCard";
import AskVault from "./AskVault";
import { emptyBlock } from "./NoteBlocks";
import { inspectBackup, applyBackup, downloadBackup } from "@/lib/backup";
import { idbAvailable, putFile, dataUrlToBlob } from "@/lib/fileStore";
import { uid } from "@/lib/id";
import { AI_MODELS, OSS_PRESETS, OSS_MODEL_SUGGESTIONS, presetById, getAIConfig, setAIConfig, askText, askJSON } from "@/lib/ai";
import { useAiReady } from "@/hooks/useAiReady";
import CalendarConnect from "./CalendarConnect";
import GoogleDrivePicker from "./GoogleDrivePicker";
import { getBackend, setBackend, backendHealthy, fullSync, flushQueue, pendingMirrors, pullAll, applyPulled, hydrateIfEmpty, hasVerifiedIdentity, api } from "@/lib/api";
import { storeFile } from "@/lib/files";
import AccountSection from "./AccountSection";
import { safeSet, storageUsage, STORAGE_FULL_EVENT, STORAGE_WARN_BYTES, formatBytes } from "@/lib/safeStorage";

/* flatten a note's blocks to plain text (for AI prompts + similarity) */
const flatText = (b) => {
  if (!b) return "";
  const parts = [b.text || "", b.title || ""];
  if (b.kind === "table" && b.rows) parts.push(b.rows.flat().join(" | "));
  if (b.kind === "page" && b.blocks) parts.push(b.blocks.map(flatText).join("\n"));
  return parts.filter(Boolean).join("\n");
};
const noteToText = (it) =>
  `${it.title}\n${it.meta || ""}\n${(it.blocks || []).map(flatText).join("\n")}`.slice(0, 6000);

/* Cross-feature insights for the dashboard: one compact card per feature,
 * each answering a single question ("how far along am I?"). Reads the other
 * features' stores directly — same seams the backend will replace later. */
const CUR_SYM = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", CAD: "C$", AUD: "A$" };
function buildInsights(items, tasks, fin, t0) {
  // reading (library)
  const books = items.filter((i) => i.type === "book");
  const reading = books.filter((b) => (b.progress || 0) > 0 && (b.progress || 0) < 100);
  const avgProg = reading.length ? Math.round(reading.reduce((a, b) => a + b.progress, 0) / reading.length) : 0;
  // watching (youtube)
  const vids = items.filter((i) => i.type === "video");
  const vidsDone = vids.filter((v) => v.status === "Done").length;
  // to-dos
  const doneWeek = tasks.filter((t) => t.done && t.doneAt && daysAgo(t.doneAt) <= 7).length;
  const openTasks = tasks.filter((t) => !t.done).length;
  // money — the overall cap applies per the user's chosen budget period
  const ym = t0.slice(0, 7);
  const monthExp = (fin.expenses || []).filter((e) => (e.date || "").startsWith(ym));
  const spent = monthExp.reduce((a, e) => a + (+e.amount || 0), 0);
  const budget = +(fin.budgets?.overall) || 0;
  const budgetPeriod = fin.budgets?.period || "monthly";
  const budgetWord = { weekly: "this week", monthly: "this month", yearly: "this year" }[budgetPeriod];
  const budgetSpent = budgetPeriod === "weekly"
    ? (fin.expenses || []).filter((e) => e.date && daysAgo(e.date) < 7 && daysAgo(e.date) >= 0).reduce((a, e) => a + (+e.amount || 0), 0)
    : budgetPeriod === "yearly"
      ? (fin.expenses || []).filter((e) => (e.date || "").startsWith(t0.slice(0, 4))).reduce((a, e) => a + (+e.amount || 0), 0)
      : spent;
  const sym = CUR_SYM[fin.currency] || "$";
  const byCat = {};
  monthExp.forEach((e) => { const c = e.cat || "Other"; byCat[c] = (byCat[c] || 0) + (+e.amount || 0); });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cat, amt]) => ({ cat, amt }));
  // saves this week vs last week (for the weekly chart caption)
  const savedNow = items.filter((i) => daysAgo(i.date) <= 7).length;
  const savedPrev = items.filter((i) => { const d = daysAgo(i.date); return d > 7 && d <= 14; }).length;
  // boards (cards in a Done-ish column vs all cards)
  let boards = [];
  try { boards = (JSON.parse(localStorage.getItem("vault.boards.v1") || "{}").boards) || []; } catch {}
  const cols = boards.flatMap((b) => b.cols || []);
  const cardsTotal = cols.reduce((a, c) => a + c.cards.length, 0);
  const cardsDone = cols.filter((c) => /done|complete|shipped|finished/i.test(c.title)).reduce((a, c) => a + c.cards.length, 0);
  // 7-day activity strip + streak (saves, tasks done, expenses logged)
  const days = [...Array(7)].map((_, k) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - k));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const n = items.filter((i) => i.date === iso).length
      + tasks.filter((t) => t.done && t.doneAt === iso).length
      + (fin.expenses || []).filter((e) => e.date === iso).length;
    return { iso, n, wd: "SMTWTFS"[d.getDay()] };
  });
  let streak = 0;
  for (let k = days.length - 1; k >= 0 && days[k].n > 0; k--) streak++;
  return {
    reading: { count: reading.length, total: books.length, pct: avgProg },
    watching: { done: vidsDone, total: vids.length, pct: vids.length ? Math.round((vidsDone / vids.length) * 100) : 0 },
    todos: { doneWeek, open: openTasks, pct: (doneWeek + openTasks) ? Math.round((doneWeek / (doneWeek + openTasks)) * 100) : 0 },
    money: { spent, budget, sym, topCats, budgetWord, budgetSpent, pct: budget ? Math.round((budgetSpent / budget) * 100) : 0 },
    trend: { savedNow, savedPrev },
    usage: {
      todoDates: tasks.filter((t) => t.done && t.doneAt).map((t) => t.doneAt),
      expenseDates: (fin.expenses || []).map((e) => e.date),
    },
    boards: { done: cardsDone, total: cardsTotal, count: boards.length, pct: cardsTotal ? Math.round((cardsDone / cardsTotal) * 100) : 0 },
    days, streak,
  };
}
import { TEMPLATES, templateStats, instantiateTemplate } from "@/lib/templates";

/* Reading fonts the user can pick in Settings — applied to the Read view */
export const READ_FONTS = [
  { id: "sans",  name: "Sans",  stack: "'Public Sans', system-ui, sans-serif" },
  { id: "serif", name: "Serif", stack: "'Iowan Old Style', 'Palatino Linotype', Georgia, serif" },
  { id: "mono",  name: "Mono",  stack: "'IBM Plex Mono', ui-monospace, monospace" },
];

/* Clean read-only rendering of note blocks — the "Read" view. */
function ReadBlocks({ blocks }) {
  if (!blocks.length) return <p style={{ color: "var(--ink-soft)" }}>Nothing written yet — switch to ✎ Edit to start.</p>;
  return (
    <div className="readblocks">
      {blocks.map((b) => {
        const ml = { marginLeft: (b.indent || 0) * 20 };
        if (b.kind === "heading") return b.text?.trim() ? <h3 key={b.id} className="display">{b.text}</h3> : null;
        if (b.kind === "todo") return (
          <div key={b.id} className="rb-todo" style={ml}>
            <span aria-hidden="true">{b.done ? "☑" : "☐"}</span>
            <span style={b.done ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>{b.text}</span>
          </div>
        );
        if (b.kind === "bullet") return b.text?.trim() ? <div key={b.id} className="rb-bullet" style={ml}>• {b.text}</div> : null;
        if (b.kind === "table") return (
          <table key={b.id} className="btable rb-table"><tbody>
            {b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ padding: "6px 9px" }}>{c}</td>)}</tr>)}
          </tbody></table>
        );
        if (b.kind === "image") return b.src ? <img key={b.id} className="bimg" src={b.src} alt={b.name || "Embedded image"} /> : null;
        if (b.kind === "page") return (
          <div key={b.id} className="rb-page">
            <div className="rb-pagetitle">❐ {b.title || "Untitled page"}</div>
            <ReadBlocks blocks={b.blocks || []} />
          </div>
        );
        return b.text?.trim() ? <p key={b.id} style={ml}>{b.text}</p> : null;
      })}
    </div>
  );
}

/* Full-page note/document view — open any note as its own page,
   Notion-style: big editable title, meta line, and the block editor. */
function NotePage({ it, onBack, onUpdate, onTag, folders = [], allItems = [], onGoto }) {
  const s = SECTIONS[it.type];
  const aiReady = useAiReady();
  const [aiBusy, setAiBusy] = useState(null);   // "summary" | "todos" | "continue"
  const [aiErr, setAiErr] = useState(null);
  const [dateEdit, setDateEdit] = useState(false);
  const [pageMode, setPageMode] = useState("edit"); // edit | read
  const [gdocMsg, setGdocMsg] = useState(null);     // Google Doc write-back status
  const pushToGoogleDoc = async () => {
    setGdocMsg("Updating Google Doc…");
    try {
      await api("/google/drive/write-doc", { method: "POST", body: { file_id: it.gfile, text: noteToText(it) } });
      setGdocMsg("✓ Saved to Google Docs");
    } catch (e) {
      setGdocMsg(e?.status === 403 ? "Reconnect Google to allow Docs editing (Settings → Connected apps)." : "Couldn't update the Google Doc — try again.");
    }
    setTimeout(() => setGdocMsg(null), 5000);
  };

  /* related items — local similarity (shared tags + title word overlap), no API needed */
  const related = allItems
    .filter((x) => x.id !== it.id)
    .map((x) => {
      const shared = x.tags.filter((t) => it.tags.includes(t)).length;
      const myWords = new Set((it.title.toLowerCase().match(/[a-z0-9]{4,}/g) || []));
      const overlap = (x.title.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((w) => myWords.has(w)).length;
      return { x, score: shared * 3 + overlap };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const runAI = async (kind) => {
    if (aiBusy) return;
    setAiBusy(kind); setAiErr(null);
    try {
      if (kind === "summary") {
        const text = await askText(
          `Summarize this note in 2-4 tight sentences a future reader will thank you for:\n\n${noteToText(it)}`,
          { system: "You write crisp summaries. No preamble, no 'this note is about' — just the substance." }
        );
        const h = { ...emptyBlock("heading"), text: "Summary" };
        const t = { ...emptyBlock("text"), text: text.trim() };
        onUpdate({ ...it, blocks: [h, t, ...(it.blocks || [])] });
      } else if (kind === "todos") {
        const out = await askJSON(
          `Extract every concrete action item / commitment / task from this note. Return only real actions someone must do — no headings, no observations:\n\n${noteToText(it)}`,
          {
            type: "object",
            properties: { items: { type: "array", items: { type: "string" } } },
            required: ["items"],
            additionalProperties: false,
          },
          { effort: "low" }
        );
        if (!out.items.length) { setAiErr({ message: "No action items found in this note." }); return; }
        const todos = out.items.map((text) => ({ ...emptyBlock("todo"), text }));
        const h = { ...emptyBlock("heading"), text: "Action items" };
        onUpdate({ ...it, blocks: [...(it.blocks || []), h, ...todos] });
      } else if (kind === "continue") {
        const text = await askText(
          `Continue writing this note — add the next paragraph or points that naturally follow. Match the note's tone and format. Return only the new content:\n\n${noteToText(it)}`
        );
        const t = { ...emptyBlock("text"), text: text.trim() };
        onUpdate({ ...it, blocks: [...(it.blocks || []), t] });
      }
    } catch (e) {
      setAiErr(e);
    } finally {
      setAiBusy(null);
    }
  };
  const [newFolder, setNewFolder] = useState(false);
  const pickFolder = (v) => {
    if (v === "__new") { setNewFolder(true); return; }   // inline input, not window.prompt (blocked in embedded browsers)
    onUpdate({ ...it, folder: v || undefined });
  };
  const saveNewFolder = (raw) => {
    const name = (raw || "").trim();
    if (name) onUpdate({ ...it, folder: name });
    setNewFolder(false);
  };
  return (
    <div className="notepage">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn ghost sm" onClick={onBack}>← Back to {s.label} (Esc)</button>
        <div className="doctabs" role="tablist" aria-label="Page mode" style={{ marginLeft: "auto" }}>
          <button className={pageMode === "read" ? "on" : ""} role="tab" aria-selected={pageMode === "read"}
            onClick={() => setPageMode("read")} title="Clean reading view">👁 Read</button>
          <button className={pageMode === "edit" ? "on" : ""} role="tab" aria-selected={pageMode === "edit"}
            onClick={() => setPageMode("edit")} title="Full editor">✎ Edit</button>
        </div>
      </div>
      {pageMode === "read" ? (
        <h1 className="np-title" style={{ border: "none" }}>{it.title || "Untitled"}</h1>
      ) : (
      <input className="np-title" value={it.title} aria-label="Title"
        onChange={(e) => onUpdate({ ...it, title: e.target.value })} placeholder="Untitled" />
      )}
      <div className="np-meta">
        <span className="pill" style={{ background: s.soft, color: s.color, marginTop: 0 }}><Ic name={s.ic} /> {s.label}</span>
        {pageMode === "edit" && it.type === "note" && (
          <select className="status" style={{ marginTop: 0 }} value={it.folder || ""} aria-label="Folder"
            onChange={(e) => pickFolder(e.target.value)} title="Move this note to a folder">
            <option value="">No folder</option>
            {folders.map((f) => <option key={f} value={f}>▸ {f}</option>)}
            <option value="__new">＋ New folder…</option>
          </select>
        )}
        {pageMode === "edit" && newFolder && (
          <input className="status folder-new" autoFocus placeholder="Folder name… (Enter)" aria-label="New folder name"
            style={{ marginTop: 0 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveNewFolder(e.target.value);
              if (e.key === "Escape") setNewFolder(false);
            }}
            onBlur={(e) => saveNewFolder(e.target.value)} />
        )}
        {it.tags.map((t) => (
          <span key={t} className="pillwrap">
            <button className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginTop: 0, marginRight: 0 }}
              onClick={() => onTag(t)}>#{t}</button>
            {pageMode === "edit" && (
              <button className="pillx" title={`Remove #${t}`} aria-label={`Remove tag ${t}`}
                onClick={() => onUpdate({ ...it, tags: it.tags.filter((x) => x !== t) })}>✕</button>
            )}
          </span>
        ))}
        {pageMode === "edit" && <TagAdder it={it} onUpdate={onUpdate} allItems={allItems} />}
        {pageMode === "read" ? (
          <span className="stamp" style={{ transform: "none" }}>Added · {fmtStamp(it.date)}</span>
        ) : dateEdit ? (
          <input type="date" className="stampedit" autoFocus value={it.date} aria-label="Move this item to another day"
            onChange={(e) => e.target.value && onUpdate({ ...it, date: e.target.value })}
            onBlur={() => setDateEdit(false)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setDateEdit(false)} />
        ) : (
          <button type="button" className="stamp stampbtn" style={{ transform: "none" }}
            onClick={() => setDateEdit(true)}
            title="Wrong day? Click to move this item to another date">
            Added · {fmtStamp(it.date)}
          </button>
        )}
      </div>
      {pageMode === "read" ? (
        it.meta ? <p className="np-sub" style={{ border: "none" }}>{it.meta}</p> : null
      ) : (
      <input className="np-sub" value={it.meta} aria-label="Description"
        onChange={(e) => onUpdate({ ...it, meta: e.target.value })}
        placeholder="Short description / why it matters…" />
      )}

      {pageMode === "edit" && (
      <div className="aibar">
        <span className="aibar-label mono" title={aiReady ? "AI actions for this note" : "Set up an AI model in Settings to enable"}>✦ AI</span>
        <button className="aibtn" disabled={!aiReady || !!aiBusy} onClick={() => runAI("summary")}
          title={aiReady ? "Add a 2-4 sentence summary to the top of this note" : "Set up an AI model in Settings"}>
          {aiBusy === "summary" ? "Summarizing…" : "Summarize"}
        </button>
        <button className="aibtn" disabled={!aiReady || !!aiBusy} onClick={() => runAI("todos")}
          title={aiReady ? "Pull every action item into a checklist" : "Set up an AI model in Settings"}>
          {aiBusy === "todos" ? "Extracting…" : "☑ Action items"}
        </button>
        <button className="aibtn" disabled={!aiReady || !!aiBusy} onClick={() => runAI("continue")}
          title={aiReady ? "Let AI write the next block" : "Set up an AI model in Settings"}>
          {aiBusy === "continue" ? "Writing…" : "Continue writing"}
        </button>
        {it.cloud === "gdoc" && it.gfile && (
          <button className="aibtn" onClick={pushToGoogleDoc}
            title="Write your edits back to the original Google Doc">↑ Update Google Doc</button>
        )}
        {aiErr && <span className="aierr">⚠ {aiErr.message}</span>}
        {gdocMsg && <span className="aierr" style={{ color: "var(--moss)" }}>{gdocMsg}</span>}
      </div>
      )}

      {pageMode === "read"
        ? <ReadBlocks blocks={it.blocks || []} />
        : <NoteBlocks blocks={it.blocks || []} onChange={(blocks) => onUpdate({ ...it, blocks })} />}

      {related.length > 0 && onGoto && (
        <div className="relpanel">
          <div className="rel-title mono">RELATED IN YOUR VAULT</div>
          {related.map(({ x }) => {
            const rs = SECTIONS[x.type];
            return (
              <button key={x.id} className="av-src" onClick={() => onGoto(x)} title={`Open in ${rs.label}`}>
                <Ic name={rs.ic} size={12} /> {(x.alias || x.title).slice(0, 60)}
                <span className="mono" style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--ink-soft)" }}>
                  {x.tags.filter((t) => it.tags.includes(t)).map((t) => `#${t}`).join(" ")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Settings → "☁ BACKEND SYNC": the only UI over lib/api.js. All state is
 * local to this section (it mounts only inside the Settings dialog).
 * localStorage stays the working copy; enabling sync write-through-mirrors
 * every mutation and the first enable pushes the whole vault via fullSync(). */
function SyncSection() {
  /* Production sync is automatic: signed in, backed by the deployed API, it
     just runs. This panel is only a HONEST STATUS plus two rescue actions —
     no backend URL, no internal user id, no retry-queue counters. Those were
     developer tooling on a user-facing screen, which read as the app leaking
     its own plumbing.

     "Sync now" re-pushes this browser's vault; "Restore" pulls the account's
     vault down and replaces this browser (the new-device / cleared-data
     case). Both are rare, both are safe to repeat. */
  const [health, setHealth] = useState(null);      // null=checking, bool=result
  const [pending, setPending] = useState(pendingMirrors);
  const [busy, setBusy] = useState(null);          // "push" | "pull" | null
  const [armPull, setArmPull] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      backendHealthy().then((ok) => { if (live) setHealth(ok); });
      setPending(pendingMirrors());
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, []);

  const syncNow = async () => {
    setBusy("push"); setMsg(null);
    try {
      await fullSync();
      setPending(pendingMirrors());
      setMsg({ ok: true, text: "Your vault is up to date." });
    } catch {
      setMsg({ ok: false, text: "Couldn't reach the server. Your changes are saved here and will sync when you're back online." });
    }
    setBusy(null);
  };

  const restore = async () => {
    if (!armPull) { setArmPull(true); setTimeout(() => setArmPull(false), 4000); return; }
    setArmPull(false); setBusy("pull"); setMsg(null);
    try {
      const c = applyPulled(await pullAll());
      setMsg({ ok: true, text: `Restored ${c.items} items, ${c.tasks} to-dos and ${c.boards} boards. Reloading…` });
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setMsg({ ok: false, text: "Couldn't restore right now — nothing on this device was changed." });
      setBusy(null);
    }
  };

  const status = health === null
    ? { dot: "sync-dot checking", text: "Checking…" }
    : !health
      ? { dot: "sync-dot off", text: "Offline — saved on this device" }
      : pending > 0
        ? { dot: "sync-dot pending", text: `Syncing ${pending} change${pending === 1 ? "" : "s"}…` }
        : { dot: "sync-dot ok", text: "All changes synced" };

  return (
    <div className="set-sec">
      <div className="menu-sec">Sync</div>
      <div className="conn-row">
        <span><span className={status.dot} aria-hidden="true" /> {status.text}</span>
        <button className="btn ghost sm" disabled={busy !== null} onClick={syncNow}>
          {busy === "push" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <button className={`menu-item ${armPull ? "danger" : ""}`} disabled={busy !== null} onClick={restore}>
        {busy === "pull" ? "Restoring…"
          : armPull ? "Tap again — this replaces what's on this device"
          : "Restore from another device"}
      </button>
      {msg && (msg.ok
        ? <div style={{ padding: "6px 8px 0" }}><span className="keystate mono">{msg.text}</span></div>
        : <div className="kmerr">{msg.text}</div>)}
      <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
        Your vault saves here first, so it works offline, and syncs to your
        account automatically. Restore pulls everything down on a new device.
      </div>
    </div>
  );
}

/* The four saved-item kinds share one list UI; the "Content" section unifies
   them behind one nav item, with a type switcher and an "all" view. */
const CONTENT_TYPES = Object.keys(SECTIONS);   // note, video, book, doc
const isContentView = (v) => v === "all" || CONTENT_TYPES.includes(v);

export default function App() {
  const { items: allItems, add, update, remove, exportJson, importJson, hydrated } = useStore();
  const aiReady = useAiReady();   // browser key OR a provider configured on the backend
  /* Apple Notes-style trash: deleting sets a `deleted` stamp instead of
     removing. Everything below works on live items only.
     Memoized: effects depend on `items`, and a fresh array identity every
     render turns those effects into an infinite setState→render cycle. */
  const items = useMemo(() => allItems.filter((i) => !i.deleted), [allItems]);
  const trashed = useMemo(() => allItems.filter((i) => i.deleted), [allItems]);

  /* New device, or a browser whose data was cleared: sync is on and the
     server has the vault, but this browser has nothing. Pull it down once,
     then reload so every store re-reads localStorage at mount. Guarded on
     an empty local store, so it can never overwrite real local work. */
  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    hydrateIfEmpty()
      .then((res) => { if (live && res) window.location.reload(); })
      .catch(() => {});   // offline or backend down — stay local-only, as designed
    return () => { live = false; };
  }, [hydrated]);

  /* one-time move of legacy base64 file bodies out of localStorage into
     IndexedDB — frees most of the ~5 MB budget and lifts the per-file cap.
     Idempotent: it only ever sees items that still carry `data`. */
  const migratedFiles = useRef(false);
  useEffect(() => {
    if (!hydrated || migratedFiles.current) return;
    migratedFiles.current = true;
    (async () => {
      if (!(await idbAvailable())) return;   // private window — leave legacy shape
      for (const it of allItems) {
        if (!it.file?.data) continue;
        try {
          const fid = uid();
          await putFile(fid, dataUrlToBlob(it.file.data));
          const { data: _dropped, ...meta } = it.file;
          update({ ...it, file: { ...meta, fid } });
        } catch {} // a failed move keeps the working base64 copy — retry next load
      }
    })();
  }, [hydrated]);

  /* drain the offline-mirror retry queue: on load, and whenever the network
     comes back. Without this the durable queue is write-only — edits made
     offline would never reach the server. flushQueue no-ops when sync is off. */
  useEffect(() => {
    const drain = () => { flushQueue().catch(() => {}); };
    drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
  }, []);

  /* ask the browser not to evict this origin's storage — everything the user
     owns lives here, and e.g. Safari deletes script-writable storage after
     7 days without a visit unless persistence is granted */
  useEffect(() => {
    if (!hydrated) return;
    try { navigator.storage?.persist?.().catch(() => {}); } catch {}
  }, [hydrated]);

  /* offline shell: the service worker caches static assets and the last-good
     page so an installed PWA still opens with no network (data is already
     local). Production only — it would fight HMR in dev. */
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    try { navigator.serviceWorker?.register("/sw.js").catch(() => {}); } catch {}
  }, []);

  /* purge items that have sat in the trash for more than 30 days */
  useEffect(() => {
    if (!hydrated) return;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    allItems.forEach((i) => {
      if (i.deleted && new Date(i.deleted + "T00:00:00") < cutoff) remove(i.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);
  const [view, setView] = useState("dash");   // dash | graph | note | video | book | doc | tag
  const [tag, setTag] = useState(null);
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [palette, setPalette] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // profile/settings dropdown
  const [settingsOpen, setSettingsOpen] = useState(false); // full settings dialog
  const [keyEdit, setKeyEdit] = useState(false);   // replacing the (never-displayed) AI key
  useEffect(() => {
    if (!settingsOpen) return;
    /* bubble phase, so the key input's own Esc (cancel edit) can stopPropagation first */
    const onKey = (e) => { if (e.key === "Escape") { setSettingsOpen(false); setKeyEdit(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);
  const [profile, setProfile] = useState({ name: "You" });
  const [profileLoaded, setProfileLoaded] = useState(false);
  const importRef = useRef(null);

  /* SSR-safe sidebar default: render open, then collapse on narrow screens.
     Also follows live resizes (window dragged to a phone-sized width, monitor
     switch) — but only on breakpoint crossings, so a manual toggle sticks. */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    setOpen(!mq.matches);
    const onChange = (e) => setOpen(!e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* production safety: report async errors, watch the storage quota */
  const [storageWarn, setStorageWarn] = useState(null);   // null | "near" | "full"
  useEffect(() => {
    installGlobalHandlers();
    const onFull = () => setStorageWarn("full");
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    if (storageUsage() > STORAGE_WARN_BYTES) setStorageWarn("near");
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, []);
  /* QA hook: ?crashtest renders the error boundary on demand */
  if (typeof window !== "undefined" && window.location.search.includes("crashtest")) {
    throw new Error("Crash test — intentional (drop ?crashtest from the URL to recover)");
  }

  /* load the saved profile after mount (avoids hydration mismatch) */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("vault.profile");
      if (raw) setProfile(JSON.parse(raw) || { name: "You" });
    } catch (e) { console.error(e); }
    setProfileLoaded(true);
  }, []);

  useEffect(() => {
    if (!profileLoaded) return;
    try { safeSet("vault.profile", JSON.stringify(profile)); } catch (e) { console.error(e); }
  }, [profile, profileLoaded]);

  /* ---- per-feature reports ---- */
  const [reportsOpen, setReportsOpen] = useState(false);
  useEffect(() => {
    if (!reportsOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setReportsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reportsOpen]);

  /* ---- standalone custom tags (created in the Tags section) ---- */
  const [customTags, setCustomTags] = useState([]);
  useEffect(() => { setCustomTags(getCustomTags()); }, []);

  /* ---- customizable single-key shortcuts ---- */
  const [keymap, setKm] = useState(DEFAULT_KEYS);
  useEffect(() => { setKm(getKeymap()); }, []);
  const [keyListen, setKeyListen] = useState(null);   // action id waiting for a keypress
  const [keyErr, setKeyErr] = useState(null);
  const [armFresh, setArmFresh] = useState(false);    // "Start fresh" needs a second click
  /* Chart Lab: {cfg, isNew} while the explorer is open; rev re-reads saved charts */
  const [explore, setExplore] = useState(null);
  /* ask-before-navigating for chart-like dashboard cards (rings, sparks) */
  const [askNav, setAskNav] = useState(null);   // null | {label, title, fn}
  const [chartsRev, setChartsRev] = useState(0);
  useEffect(() => {
    if (!keyListen) return;
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { setKeyListen(null); setKeyErr(null); return; }
      const err = validateKey(e.key, keyListen, keymap);
      if (err) { setKeyErr(err); return; }
      setKm(setKeymap({ [keyListen]: e.key.toLowerCase() }));
      setKeyListen(null); setKeyErr(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keyListen, keymap]);

  /* ---- first-run onboarding (returning browsers are grandfathered) ---- */
  const [ob, setObState] = useState(undefined);   // undefined = not decided yet
  useEffect(() => { setObState(initOnboarding()); }, []);
  /* Whole vault, not just items — see lib/backup.js for why that distinction
     cost four of five stores. */
  const [restore, setRestore] = useState(null);   // inspected file awaiting confirmation
  /* Short status line for backup/restore. Replaces alert(), which is blocked
     outright in embedded browsers — the export "not working" was partly this:
     it had run, and said nothing. */
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  /* ---- universal quick capture + notification bell ---- */
  const [capOpen, setCapOpen] = useState(false);
  const [capSeed, setCapSeed] = useState("");

  /* capture-from-anywhere: the PWA share target, bookmarklet and iOS
     Shortcut all arrive as /?vcap_url=…&vcap_title=…&vcap_text=… — open
     Quick Capture pre-filled (URL alone routes best), then clean the URL */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const u = (q.get("vcap_url") || "").trim();
    const tx = (q.get("vcap_text") || "").trim();
    const ti = (q.get("vcap_title") || "").trim();
    if (!(u || tx || ti)) return;
    /* Android share sheets often put the URL in `text` */
    const urlInText = !u && /^https?:\/\/\S+$/.test(tx) ? tx : "";
    setCapSeed(u || urlInText || tx || ti);
    setCapOpen(true);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);
  const [capBump, setCapBump] = useState(0);      // remounts To-dos/Finance so captures show instantly
  const [bellOpen, setBellOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [notifPerm, setNotifPerm] = useState("default");

  /* close the dropdowns on any outside click */
  useEffect(() => {
    if (!menuOpen && !bellOpen) return;
    const close = () => { setMenuOpen(false); setBellOpen(false); };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen, bellOpen]);

  const computeAlerts = () => {
    const out = [];
    const t0 = today();
    try {
      const tasks = (JSON.parse(localStorage.getItem("vault.todos.v1") || "{}").tasks) || [];
      const od = tasks.filter((t) => !t.done && t.due && t.due < t0);
      const dt = tasks.filter((t) => !t.done && t.due === t0);
      if (od.length) out.push({ id: "od", text: `⏰ ${od.length} to-do${od.length === 1 ? " is" : "s are"} overdue`, view: "todos", warn: true });
      if (dt.length) out.push({ id: "dt", text: `☑ ${dt.length} to-do${dt.length === 1 ? "" : "s"} due today`, view: "todos" });
    } catch {}
    try {
      const fin = JSON.parse(localStorage.getItem("vault.finance.v1") || "{}");
      const ob = (fin.bills || []).filter((b) => !b.paid && b.due < t0);
      const soon = (fin.bills || []).filter((b) => !b.paid && b.due >= t0 && daysAgo(b.due) >= -7);
      if (ob.length) out.push({ id: "ob", text: `💳 ${ob.length} bill${ob.length === 1 ? " is" : "s are"} overdue`, view: "finance", warn: true });
      if (soon.length) out.push({ id: "sb", text: `💳 ${soon.length} bill${soon.length === 1 ? "" : "s"} due within 7 days`, view: "finance" });
      const ym = t0.slice(0, 7);
      const spent = (fin.expenses || []).filter((e) => (e.date || "").startsWith(ym)).reduce((a, e) => a + (+e.amount || 0), 0);
      const cap = +(fin.budgets?.overall) || 0;
      if (cap && spent > cap) out.push({ id: "bu", text: `⚠ You're over this month's budget`, view: "finance", warn: true });
    } catch {}
    return out;
  };

  useEffect(() => {
    if (!hydrated) return;
    const refresh = () => setAlerts(computeAlerts());
    refresh();
    const iv = setInterval(refresh, 60000);
    return () => clearInterval(iv);
  }, [hydrated, capBump, view]);

  /* desktop alerts: opt-in, then a once-a-day summary when something's due */
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setNotifPerm(Notification.permission);
    if (!hydrated || Notification.permission !== "granted") return;
    const t0 = today();
    if (localStorage.getItem("vault.notify.last") === t0) return;
    const a = computeAlerts();
    if (!a.length) return;
    try {
      new Notification("Vault — needs your attention", { body: a.map((x) => x.text).join("\n"), tag: "vault-daily" });
      localStorage.setItem("vault.notify.last", t0);
    } catch {}
  }, [hydrated]);

  /* dark mode (top-requested PKM feature) + user-selected accent colour */
  useEffect(() => {
    const theme = profile.theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    applyAccent(profile.accent || DEFAULT_ACCENT, theme);
    applyThemeExtras(profile.bgTint || DEFAULT_BG, profile.chartColor || DEFAULT_CHART, profile.accent || DEFAULT_ACCENT, theme);
    document.documentElement.style.setProperty("--readfont", (READ_FONTS.find((f) => f.id === profile.readFont) || READ_FONTS[0]).stack);
  }, [profile.theme, profile.accent, profile.bgTint, profile.chartColor, profile.readFont]);

  /* autosave indicator */
  const [saveState, setSaveState] = useState("Saved ✓");
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setSaveState("Saving…");
    const t = setTimeout(() => setSaveState("Saved ✓"), 700);
    return () => clearTimeout(t);
  }, [items]);

  /* undo for deletes (forgiveness beats confirmation) */
  const [undoItem, setUndoItem] = useState(null);
  const undoTimer = useRef(null);
  const removeWithUndo = (id) => {
    const it = items.find((x) => x.id === id);
    update({ ...it, deleted: today() }); // soft delete → Recently deleted
    setUndoItem(it);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoItem(null), 6000);
  };

  /* every edit stamps an `edited` date for "edited Xd ago" labels */
  const updateStamped = (it) => update({ ...it, edited: today() });

  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  const [focusId, setFocusId] = useState(null);
  const [pageId, setPageId] = useState(null);          // full-page note view
  const [notesLayout, setNotesLayout] = useState("list"); // list | grid
  const [expandedId, setExpandedId] = useState(null);     // compact list: which row is open
  const clistRef = useRef(null);
  const [driveOpen, setDriveOpen] = useState(false);      // Google Drive import picker
  const [showTemplates, setShowTemplates] = useState(false);
  const [docFilter, setDocFilter] = useState("All"); // All | PDF | Word | Sheet | Image
  const [helpOpen, setHelpOpen] = useState(false);     // "?" shortcuts sheet
  const [chord, setChord] = useState(false);           // "G then …" pending indicator
  const [askOpen, setAskOpen] = useState(false);       // ✦ Ask your Vault
  const [aiCfg, setAiCfg] = useState({ model: "claude-opus-5" });
  useEffect(() => { setAiCfg(getAIConfig()); }, []);
  const updateAI = (patch) => setAiCfg(setAIConfig(patch));

  /* ✦ digest (dashboard) — scoped to the Daily/Weekly/Monthly/Yearly tab */
  const [digest, setDigest] = useState(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const genDigest = async () => {
    if (digestBusy) return;
    setDigestBusy(true); setDigest(null);
    const dWord = { day: "day", week: "week", month: "month", year: "year" }[range] || "week";
    const dAdj = { day: "daily", week: "weekly", month: "monthly", year: "yearly" }[range] || "weekly";
    const dDays = { day: 1, week: 7, month: 31, year: 365 }[range] || 7;
    const recent = items.filter((i) => daysAgo(i.date) <= dDays);
    const stale = items.filter((i) => !i.deleted).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
    const stats =
      `Saved this ${dWord} (${recent.length}): ${recent.slice(0, 40).map((i) => `${SECTIONS[i.type].label} — ${i.title}`).join("; ") || "nothing"}.\n` +
      `Oldest saved items: ${stale.map((i) => `${i.title} (${daysAgo(i.date)} days)`).join("; ") || "none"}.\n` +
      `Projects: ${[...new Set(items.flatMap((i) => i.tags))].join(", ") || "none"}.`;
    try {
      setDigest(await askText(
        `Here is the current state of my personal knowledge vault:\n\n${stats}\n\nWrite my ${dAdj} digest.`,
        { system: `You write a short ${dAdj} digest for a personal knowledge hub. At most 3 short paragraphs: what happened this ${dWord}; what's gathering dust and what to finish; one concrete suggestion for the next ${dWord}. Plain text, direct and encouraging, no headings or bullet lists.` }
      ));
    } catch (e) {
      setDigest(`⚠ ${e.message}`);
    } finally {
      setDigestBusy(false);
    }
  };
  const [sortBy, setSortBy] = useState("added");       // added | edited | title
  const [dateFilter, setDateFilter] = useState("");    // show only items added on this day

  /* click-again-to-confirm for destructive actions — window.confirm is
   * silently blocked in embedded browsers/webviews, so we never rely on it */
  const [armDel, setArmDel] = useState(null);
  useEffect(() => {
    if (!armDel) return;
    const t = setTimeout(() => setArmDel(null), 3000);
    return () => clearTimeout(t);
  }, [armDel]);

  /* dashboard: one friendly "today" pulse instead of a wall of numbers */
  const [pulse, setPulse] = useState(null);
  useEffect(() => {
    if (view !== "dash") return;
    try {
      const tasks = (JSON.parse(localStorage.getItem("vault.todos.v1") || "{}").tasks) || [];
      const fin = JSON.parse(localStorage.getItem("vault.finance.v1") || "{}");
      const t0 = today();
      setPulse({
        savedWeek: items.filter((i) => daysAgo(i.date) <= 7).length,
        dueToday: tasks.filter((t) => !t.done && t.due === t0).length,
        doneToday: tasks.filter((t) => t.done && (t.doneAt === t0 || t.due === t0)).length,
        overdueTasks: tasks.filter((t) => !t.done && t.due && t.due < t0).length,
        pendingBills: (fin.bills || []).filter((b) => !b.paid).length,
        overdueBills: (fin.bills || []).filter((b) => !b.paid && daysAgo(b.due) > 0).length,
        pendingBillsTotal: (fin.bills || []).filter((b) => !b.paid).reduce((a, b) => a + (+b.amount || 0), 0),
        doneDates: tasks.filter((t) => t.done && t.doneAt).map((t) => t.doneAt),
        expensesRaw: (fin.expenses || []).map((e) => ({ date: e.date, amt: +e.amount || 0, cat: e.cat || "Other" })),
        importedCount: (fin.expenses || []).filter((e) => e.pay).length,
        ins: buildInsights(items, tasks, fin, t0),
      });
    } catch { setPulse(null); }
  }, [view, items, ob]); // ob: re-read the stores right after sample-mode seeds them

  /* instant drop-to-save for Documents */
  const quickFileRef = useRef(null);
  const [quickDragOver, setQuickDragOver] = useState(false);
  const [quickFileErr, setQuickFileErr] = useState("");
  const quickSaveFile = async (list) => {
    const f = list && list[0];
    if (!f) return;
    setQuickFileErr("");
    /* Mint the id first: the storage key is derived from it, so it has to
       exist before the bytes move. */
    const id = Date.now();
    try {
      const stored = await storeFile(id, f);
      add({
        id, type: "doc", title: f.name.replace(/\.[^.]+$/, ""),
        meta: stored.s3_key ? "Saved via quick drop" : "Saved via quick drop — this browser only",
        tags: [], status: "Inbox", file: stored, date: today(),
      });
      if (stored.localOnlyReason) {
        setQuickFileErr(`Saved here only — ${stored.localOnlyReason}`);
        setTimeout(() => setQuickFileErr(""), 6000);
      }
    } catch (err) {
      setQuickFileErr(err?.message || `Could not save “${f.name}”.`);
      setTimeout(() => setQuickFileErr(""), 8000);
    }
  };
  const [folderSel, setFolderSel] = useState("All");   // Notes folder filter
  /* folders are derived from the notes that use them (Apple Notes-style) */
  const folders = [...new Set(items.filter((i) => i.type === "note" && i.folder).map((i) => i.folder))].sort();
  const effFolder = folders.includes(folderSel) ? folderSel : "All";
  const filterRef = useRef(null);                      // "/" focuses the current filter box
  const pageItem = items.find((i) => i.id === pageId);

  /* ---------- global keyboard shortcuts ----------
     Linear/Gmail-style: G-chords navigate, single keys act.
     Single-key shortcuts are suspended while typing in any field. */
  const kb = useRef({});
  kb.current = { view, tag, adding, palette, helpOpen, menuOpen, pageId, showTemplates, profile, keymap, keyListen };
  useEffect(() => {
    let gUntil = 0; // G-chord window (2s)
    const typing = (el) =>
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

    const onKey = (e) => {
      const s = kb.current;
      const k = e.key;

      /* ⌘K / Ctrl+K — command palette, works everywhere (even while typing) */
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }

      /* Esc — close the topmost layer (palette & help handle themselves) */
      if (k === "Escape" && !s.palette && !s.helpOpen) {
        if (s.menuOpen) { setMenuOpen(false); return; }
        if (s.adding) { setAdding(false); return; }
        if (s.showTemplates) { setShowTemplates(false); return; }
        if (s.pageId) { setPageId(null); return; }
        if (typing(document.activeElement)) document.activeElement.blur();
        return;
      }

      /* everything below is suspended while typing or while an overlay is open */
      if (typing(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (s.palette || s.helpOpen) return;

      /* ? — shortcuts sheet */
      if (k === "?") { e.preventDefault(); setHelpOpen(true); return; }

      /* G-chord navigation — letters are user-rebindable */
      const now = Date.now();
      if (k.toLowerCase() === "g") { gUntil = now + 2000; setChord(true); setTimeout(() => setChord(false), 2000); return; }
      if (now < gUntil) {
        const kmNav = s.keymap || DEFAULT_KEYS;
        const hit = NAV_ACTIONS.find((a) => (kmNav[a.id] || a.def) === k.toLowerCase());
        if (hit) {
          e.preventDefault();
          gUntil = 0; setChord(false);
          if (hit.view === "dash" || hit.view === "graph" || hit.view === "todos" || hit.view === "board" || hit.view === "finance" || hit.view === "tags") {
            setView(hit.view); setTag(null); setAdding(false); setPageId(null);
          } else openSection(hit.view);
          return;
        }
        gUntil = 0; setChord(false);
      }

      /* single-key actions — user-rebindable (Settings → Preferences) */
      if (s.keyListen) return;                 // a rebind capture is in progress
      const km = s.keymap || DEFAULT_KEYS;
      const kl = k.toLowerCase();
      if (kl === km.capture) { e.preventDefault(); setCapOpen(true); return; }
      if (kl === km.newItem) {
        e.preventDefault();
        if (!(s.view in SECTIONS) && s.view !== "tag" && s.view !== "all") openSection("note");
        setPageId(null);
        setAdding(true);
        return;
      }
      if (kl === km.search) { e.preventDefault(); if (filterRef.current) filterRef.current.focus(); else setPalette(true); return; }
      if (kl === km.theme) { e.preventDefault(); setProfile((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" })); return; }
      if (kl === km.sidebar) { e.preventDefault(); setOpen((o) => !o); return; }
      if (kl === km.backup) { e.preventDefault(); downloadBackup(); setToast("Backup downloaded — keep it somewhere safe."); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* commands offered inside the ⌘K palette */
  const navKeyFor = (view) => (keymap[NAV_ACTIONS.find((a) => a.view === view)?.id] || "?").toUpperCase();
  const paletteActions = [
    { group: "GO TO", label: "Dashboard", hint: `G ${navKeyFor("dash")}`, keywords: "home overview", run: () => { setView("dash"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Project board", hint: `G ${navKeyFor("board")}`, keywords: "kanban status progress projects", run: () => { setView("board"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Finance", hint: `G ${navKeyFor("finance")}`, keywords: "money expenses bills payments credit card", run: () => { setView("finance"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Tasks", hint: `G ${navKeyFor("todos")}`, keywords: "tasks board", run: () => { setView("todos"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Graph", hint: `G ${navKeyFor("graph")}`, keywords: "connections map", run: () => { setView("graph"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Content — all saved items", hint: `G ${navKeyFor("all")}`, keywords: "everything notes videos library documents collection", run: () => { setView("all"); setTag(null); setAdding(false); setPageId(null); setQ(""); } },
    { group: "GO TO", label: "Notes", hint: `G ${navKeyFor("note")}`, keywords: "section", run: () => openSection("note") },
    { group: "GO TO", label: "YouTube", hint: `G ${navKeyFor("video")}`, keywords: "videos section", run: () => openSection("video") },
    { group: "GO TO", label: "Library", hint: `G ${navKeyFor("book")}`, keywords: "books pdfs reading section", run: () => openSection("book") },
    { group: "GO TO", label: "Documents", hint: `G ${navKeyFor("doc")}`, keywords: "files section", run: () => openSection("doc") },
    { group: "GO TO", label: "Tags", hint: `G ${navKeyFor("tags")}`, keywords: "projects tags labels", run: () => { setView("tags"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "GO TO", label: "Recently deleted", keywords: "trash bin restore deleted", run: () => { setView("trash"); setTag(null); setAdding(false); setPageId(null); } },
    { group: "ACTION", label: "✦ Ask your Vault (AI)", keywords: "ai ask question claude rag search answers", run: () => setAskOpen(true) },
    { group: "ACTION", label: "✦ Generate digest (AI)", keywords: "ai digest review day week month year summary", run: () => { setView("dash"); setTag(null); setAdding(false); setPageId(null); genDigest(); } },
    { group: "ACTION", label: "New item", hint: "N", keywords: "add create capture", run: () => { if (!(view in SECTIONS) && view !== "tag" && view !== "all") openSection("note"); setPageId(null); setAdding(true); } },
    { group: "ACTION", label: "Toggle dark / light theme", hint: "T", keywords: "mode appearance", run: () => setProfile((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" })) },
    { group: "ACTION", label: "Toggle sidebar", hint: "B", keywords: "collapse expand menu", run: () => setOpen((o) => !o) },
    { group: "ACTION", label: "📊 Generate reports", keywords: "report pdf print summary stats export feature", run: () => setReportsOpen(true) },
    { group: "ACTION", label: "Import backup", keywords: "restore upload data", run: () => importRef.current?.click() },
    { group: "ACTION", label: "Keyboard shortcuts", hint: "?", keywords: "help keys cheatsheet", run: () => setHelpOpen(true) },
  ];

  const useTemplate = (t) => {
    const id = Date.now();
    add({
      id, type: "note", title: t.title, meta: t.desc, tags: [],
      status: "Inbox", blocks: instantiateTemplate(t), date: today(),
    });
    setShowTemplates(false);
    setPageId(id); // open the fresh note as a full page, ready to fill in
  };

  /* A "document" is one of three things: an uploaded file, a cloud link
   * (Google Doc, Drive…), or a written/generated text doc with neither.
   * Categorise all three so every doc is reachable by a filter and the
   * storage meter isn't blind to two-thirds of them. */
  const docCategory = (it) => {
    if (it.cloud || (it.url && !it.file)) return "Links";
    if (!it.file) return "Text";
    const ext = (it.file.name.split(".").pop() || "").toLowerCase();
    if (ext === "pdf") return "PDF";
    if (/^docx?$|^txt$|^md$/.test(ext)) return "Word";
    if (/^xlsx?$|^csv$/.test(ext)) return "Sheet";
    if (/^png$|^jpe?g$|^webp$|^gif$|^svg$/.test(ext)) return "Image";
    return "Other";
  };
  const DOC_CATS = ["PDF", "Word", "Sheet", "Image", "Links", "Text", "Other"];
  const openTag = (t) => { setTag(t); setView("tag"); setAdding(false); setQ(""); setDateFilter(""); setPageId(null); };
  const openSection = (k) => { setView(k); setTag(null); setAdding(false); setQ(""); setDateFilter(""); setPageId(null); };
  const goView = (v) => { setView(v); setTag(null); setAdding(false); setPageId(null); };

  /* Dashboard time range — the Daily/Weekly/Monthly/Yearly tab. Drives the
     activity chart's buckets and the "this period" rollup; "Needs you now"
     ignores it because it's always about right now. */
  const range = profile.range || "week";
  const RANGES = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"], ["year", "Yearly"]];
  const RANGE_WORD = { day: "today", week: "this week", month: "this month", year: "this year" };
  const inRange = (iso) => {
    if (!iso) return false;
    const d = new Date(iso + "T00:00:00"), n = new Date();
    if (range === "day") return iso === today();
    if (range === "week") return daysAgo(iso) < 7;
    if (range === "month") return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
    return d.getFullYear() === n.getFullYear();
  };
  /* jump to a specific item in its own section, scroll to it and flash it */
  const goto = (it) => {
    openSection(it.type);
    setFocusId(it.id);
    setTimeout(() => setFocusId(null), 2200);
  };


  const visible = items
    .filter((i) => {
      if (view === "tag") return i.tags.includes(tag);
      if (view === "all") return CONTENT_TYPES.includes(i.type);
      if (view in SECTIONS) return i.type === view;
      return true;
    })
    .filter((i) => !(view === "doc" && docFilter !== "All") || docCategory(i) === docFilter)
    .filter((i) => !(view === "note" && effFolder !== "All") || i.folder === effFolder)
    .filter((i) => !dateFilter || i.date === dateFilter)
    .filter((i) => !q || (i.title + " " + (i.alias || "") + " " + i.meta + " " + i.tags.join(" ")).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) =>
      (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      (sortBy === "title"
        ? (a.alias || a.title).localeCompare(b.alias || b.title)
        : sortBy === "edited"
          ? (b.edited || b.date).localeCompare(a.edited || a.date)
          : b.date.localeCompare(a.date)));

  // Order follows the go-to-market design: Dashboard, then Ask (injected in the
  // sidebar render), then Content, Tasks, Boards, Finance, Tags, and Graph last.
  const nav = [
    { k: "dash", label: "Dashboard", ic: "home" },
    // Notes, YouTube, Library and Documents are the same thing — saved items —
    // so they live behind one "Content" section with a type switcher inside.
    { k: "all", label: "Content", ic: "content" },
    { k: "todos", label: "Tasks", ic: "todos" },
    { k: "board", label: "Boards", ic: "board" },
    { k: "finance", label: "Finance", ic: "finance" },
    { k: "tags", label: "Tags", ic: "tag" },
    // Graph is an explore-it view, not a daily destination — keep it last.
    { k: "graph", label: "Graph", ic: "graph" },
  ].map((n) => ({ ...n, hint: `G then ${navKeyFor(n.k)}` }));

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
    <div className={`vault ${(profile?.design || "glass") === "glass"
      ? (profile?.glass === false ? "" : profile?.glass === "vivid" ? "glass vivid" : "glass")
      : `design-${profile.design}`}`}>
      {storageWarn && (
        <div className={`storage-warn ${storageWarn}`} role="alert">
          {storageWarn === "full"
            ? <>⚠ <b>Storage is full — your last change couldn&rsquo;t be saved.</b> Export a backup or turn on Backend sync (Settings), then remove some large files.</>
            : <>Local storage is getting full ({formatBytes(storageUsage())} of ~5 MB). Turn on Backend sync or export a backup soon.</>}
          <button className="kbtn" onClick={() => setStorageWarn(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      <CommandPalette items={items} actions={paletteActions} open={palette} onClose={() => setPalette(false)}
        onGo={(r) => (r.kind === "tag" ? openTag(r.tag) : openSection(r.item.type))} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} keymap={keymap} />

      <QuickCapture open={capOpen} seed={capSeed}
        onClose={() => { setCapOpen(false); setCapSeed(""); }}
        onAddItem={(it) => add(it)}
        onSaved={() => { setCapBump((b) => b + 1); setAlerts(computeAlerts()); }} />

      {reportsOpen && (
        <div className="pal-overlay" onClick={() => setReportsOpen(false)} role="dialog" aria-label="Generate reports">
          <div className="pal reportsdlg" onClick={(e) => e.stopPropagation()}>
            <div className="cd-head">
              <h3 className="display" style={{ margin: 0, fontSize: 18 }}>📊 Reports</h3>
              <span className="cardsub mono" style={{ marginLeft: 10 }}>open to read & print (PDF) · download to keep</span>
              <button className="kbtn" style={{ marginLeft: "auto" }} title="Close (Esc)" onClick={() => setReportsOpen(false)}>✕</button>
            </div>
            <div className="cd-body">
              {REPORTS.map((r) => (
                <div key={r.id} className={`reportrow ${r.id === "all" ? "reportrow-all" : ""}`}>
                  <span className="reportname">{r.label}</span>
                  <button className="kbtn" onClick={() => openReport(r.id, range)} title="Open in a new tab — read it, or print to PDF">👁 Open</button>
                  <button className="kbtn" onClick={() => downloadReport(r.id, range)} title="Download as a self-contained HTML file">⬇ Download</button>
                </div>
              ))}
              <div className="menu-foot" style={{ border: "none" }}>
                Reports are snapshots of this browser's data. For spreadsheets, Finance and Sprints also export CSV in place.
              </div>
            </div>
          </div>
        </div>
      )}

      <AskGoDialog ask={askNav} onClose={() => setAskNav(null)} />

      {explore && (
        <ChartExplorer cfg={explore.cfg} isNew={explore.isNew} sym={pulse?.ins?.money?.sym || "$"}
          onClose={() => setExplore(null)}
          onSave={(cfg) => { upsertChart(cfg); setChartsRev((r) => r + 1); }}
          onDelete={(id) => { deleteChart(id); setChartsRev((r) => r + 1); setExplore(null); }} />
      )}

      {hydrated && ob === null && (
        <WelcomeModal onChoose={(c) => {
          /* a real user gesture — the best moment to ask the browser to
             protect this origin's storage from eviction */
          try { navigator.storage?.persist?.().catch(() => {}); } catch {}
          if (c === "clean") { startClean(); window.location.reload(); return; }
          /* seed the lazily-hydrated stores NOW — the dashboard reads them
             from localStorage, and without this it shows zeros until the
             Tasks and Finance views have each been visited once */
          try {
            if (!localStorage.getItem("vault.todos.v1")) safeSet("vault.todos.v1", JSON.stringify(seedTodoStore()));
            if (!localStorage.getItem("vault.finance.v1")) safeSet("vault.finance.v1", JSON.stringify(seedFinance));
          } catch { /* quota — the views still self-seed on first visit */ }
          setObState(setOB({ choice: "sample", startedAt: today(), dismissed: false }));
        }} />
      )}

      {settingsOpen && (
        <div className="pal-overlay" onClick={() => { setSettingsOpen(false); setKeyEdit(false); }} role="dialog" aria-label="Settings">
          <div className="pal settingsdlg" onClick={(e) => e.stopPropagation()}>
            <div className="cd-head">
              <h3 className="display" style={{ margin: 0, fontSize: 18 }}>⚙ Settings</h3>
              <button className="kbtn" style={{ marginLeft: "auto" }} title="Close (Esc)"
                onClick={() => { setSettingsOpen(false); setKeyEdit(false); }}>✕</button>
            </div>
            <div className="cd-body">
              <details className="setfold"><summary className="setfold-head"><span>🗄 Your data</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                <button className="menu-item" onClick={() => { downloadBackup(); setToast("Backup downloaded — keep it somewhere safe."); }}>
                  ⬇ Back up this vault (.json)
                  <span className="menukey">{(keymap.backup || "e").toUpperCase()}</span>
                </button>
                {ob?.choice === "sample" && !ob?.sampleRemoved && (
                  <button className="menu-item"
                    title="Removes the demo notes, tasks, expenses and board — everything you created stays"
                    onClick={() => { removeSampleData(); window.location.reload(); }}>
                    Remove sample data
                    <span className="menukey">keeps what you made</span>
                  </button>
                )}
                <button className="menu-item danger"
                  onClick={() => { if (!armFresh) { setArmFresh(true); return; } startClean(); window.location.reload(); }}
                  onBlur={() => setArmFresh(false)}
                  style={armFresh ? { color: "var(--stamp)", fontWeight: 700 } : undefined}>
                  {armFresh ? "Click again to erase everything in this browser" : "Start fresh"}
                  {!armFresh && <span className="menukey">erase this browser&rsquo;s vault</span>}
                </button>
                <button className="menu-item" onClick={() => importRef.current?.click()}>⬆ Import backup</button>
                <button className="menu-item" onClick={() => downloadICS()}
                  title="Due to-dos and bills as calendar events — import into Google/Apple/Outlook and get reminded there">
                  📅 Export due dates to calendar (.ics)
                </button>
                <button className="menu-item" onClick={() => { setReportsOpen(true); setSettingsOpen(false); }}
                  title="A formatted, printable report for any feature — or the whole vault">
                  📊 Generate reports…
                </button>
              </div>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>👤 Account & profile</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <AccountSection />

              <div className="set-sec">
                <div className="menu-sec">Display name</div>
                <input className="menu-input" value={profile.name} aria-label="Display name"
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  placeholder="What should we call you?" />
                <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
                  Shown in your dashboard greeting. Your sign-in email lives under Account.
                </div>
              </div>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>🎨 Appearance</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                {/* explicit Light | Dark control (the keyboard shortcut still toggles) */}
                <div className="conn-row">
                  <span>Theme</span>
                  <span className="cardsub mono">shortcut: {keymap.theme.toUpperCase()}</span>
                </div>
                <div className="doctabs" role="tablist" aria-label="Theme" style={{ display: "inline-flex", marginBottom: 10 }}>
                  <button className={profile.theme !== "dark" ? "on" : ""} role="tab" aria-selected={profile.theme !== "dark"}
                    onClick={() => setProfile({ ...profile, theme: "light" })}>☀ Light</button>
                  <button className={profile.theme === "dark" ? "on" : ""} role="tab" aria-selected={profile.theme === "dark"}
                    onClick={() => setProfile({ ...profile, theme: "dark" })}>◐ Dark</button>
                </div>

                {/* design language — each restyles every card, bar and button */}
                <div className="conn-row">
                  <span>Design style</span>
                  <span className="cardsub mono">{({ glass: "Glassmorphism", skeuo: "Classic Skeuomorphism", neu: "Neumorphism", minimal: "Minimalism", clay: "Claymorphism" })[profile.design || "glass"]}</span>
                </div>
                <div className="design-pick" role="group" aria-label="Design style">
                  {[
                    ["glass", "❄ Glassmorphism", "Frosted, translucent cards over a soft ambient wash"],
                    ["skeuo", "📜 Classic Skeuomorphism", "Beveled, tactile surfaces with real-world depth"],
                    ["neu", "🫧 Neumorphism", "Soft shapes extruded from the background itself"],
                    ["minimal", "▭ Minimalism", "Flat and quiet — thin borders, zero shadows"],
                    ["clay", "🏺 Claymorphism", "Puffy, rounded 3D clay with playful depth"],
                  ].map(([id, label, hint]) => {
                    const on = (profile.design || "glass") === id;
                    return (
                      <button key={id} type="button" className={"menu-item design-opt" + (on ? " on" : "")}
                        aria-pressed={on} title={hint}
                        onClick={() => setProfile({ ...profile, design: id })}>
                        {label}{on ? <span className="menukey">✓</span> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="accent-pick">
                  <div className="accent-lead">
                    <span>Accent colour</span>
                    <span className="cardsub mono">{(ACCENTS.find((a) => a.id === (profile.accent || DEFAULT_ACCENT)) || ACCENTS[0]).name}</span>
                  </div>
                  <div className="accent-swatches" role="group" aria-label="Accent colour">
                    {ACCENTS.map((ac) => {
                      const on = (profile.accent || DEFAULT_ACCENT) === ac.id;
                      return (
                        <button key={ac.id} type="button"
                          className={"accent-sw" + (on ? " on" : "")}
                          style={{ background: ac.light.a }}
                          aria-pressed={on} aria-label={ac.name} title={ac.name}
                          onClick={() => setProfile({ ...profile, accent: ac.id })} />
                      );
                    })}
                  </div>
                  {(profile.design || "glass") === "glass" && (
                    <button className="menu-item" aria-pressed={profile.glass !== false}
                      title="Frosted card surfaces over a soft ambient wash — subtle, vivid, or off"
                      onClick={() => setProfile({ ...profile, glass: profile.glass === false ? true : profile.glass === "vivid" ? false : "vivid" })}>
                      ❄ Glass intensity
                      <span className="menukey">{profile.glass === false ? "off" : profile.glass === "vivid" ? "vivid" : "subtle"}</span>
                    </button>
                  )}

                  <div className="conn-row" style={{ marginTop: 10 }}>
                    <span>Background</span>
                    <span className="cardsub mono">{(BG_TINTS.find((t) => t.id === (profile.bgTint || DEFAULT_BG)) || BG_TINTS[0]).name}</span>
                  </div>
                  <div className="accent-swatches" role="group" aria-label="Background tint">
                    {BG_TINTS.map((t) => {
                      const on = (profile.bgTint || DEFAULT_BG) === t.id;
                      return (
                        <button key={t.id} type="button" className={"accent-sw" + (on ? " on" : "")}
                          style={{ background: t.bg, border: "1px solid var(--line)" }}
                          aria-pressed={on} aria-label={t.name} title={t.name}
                          onClick={() => setProfile({ ...profile, bgTint: t.id })} />
                      );
                    })}
                  </div>

                  <div className="conn-row" style={{ marginTop: 10 }}>
                    <span>Chart colour</span>
                    <span className="cardsub mono">{(CHART_COLORS.find((c) => c.id === (profile.chartColor || DEFAULT_CHART)) || CHART_COLORS[0]).name}</span>
                  </div>
                  <div className="accent-swatches" role="group" aria-label="Chart colour">
                    {CHART_COLORS.map((c) => {
                      const on = (profile.chartColor || DEFAULT_CHART) === c.id;
                      const acc = ACCENTS.find((a) => a.id === (profile.accent || DEFAULT_ACCENT)) || ACCENTS[0];
                      return (
                        <button key={c.id} type="button" className={"accent-sw" + (on ? " on" : "")}
                          style={{ background: c.hex || acc.light.a }}
                          aria-pressed={on} aria-label={c.name} title={c.name}
                          onClick={() => setProfile({ ...profile, chartColor: c.id })}>
                          {c.id === "accent" ? <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>A</span> : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="conn-row" style={{ marginTop: 10 }}>
                    <span>Reading font</span>
                    <span className="cardsub mono">{(READ_FONTS.find((f) => f.id === profile.readFont) || READ_FONTS[0]).name}</span>
                  </div>
                  <div className="accent-swatches" role="group" aria-label="Reading font">
                    {READ_FONTS.map((f) => {
                      const on = (profile.readFont || "sans") === f.id;
                      return (
                        <button key={f.id} type="button" className={"font-sw" + (on ? " on" : "")}
                          style={{ fontFamily: f.stack }} aria-pressed={on}
                          title={`${f.name} — how the Read view renders your notes`}
                          onClick={() => setProfile({ ...profile, readFont: f.id })}>Aa</button>
                      );
                    })}
                  </div>
                </div>

              </div>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>📥 Capture from anywhere</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
                <div className="capkit">
                  <div className="capkit-row">
                    <span className="capkit-label"><b>Bookmarklet</b> — drag this to your bookmarks bar; click it on any page to capture it:</span>
                    <span dangerouslySetInnerHTML={{ __html:
                      `<a class="kbtn capkit-bm" href="javascript:(function(){location.href='${typeof window !== "undefined" ? window.location.origin : ""}/?vcap_url='+encodeURIComponent(location.href)+'&vcap_title='+encodeURIComponent(document.title)+'&vcap_text='+encodeURIComponent(String(getSelection()))})()">📥 Save to Vault</a>` }} />
                  </div>
                  <div className="capkit-row">
                    <span className="capkit-label"><b>Android</b> — install Vault (browser menu → &ldquo;Add to Home screen&rdquo;) and it appears in the share sheet of every app.</span>
                  </div>
                  <div className="capkit-row">
                    <span className="capkit-label"><b>iPhone</b> — Shortcuts app → ＋ → &ldquo;Receive input from Share Sheet&rdquo; → add &ldquo;Open URLs&rdquo; with:</span>
                    <button className="kbtn" onClick={(e) => {
                      const tpl = `${window.location.origin}/?vcap_url=[Shortcut Input]`;
                      navigator.clipboard?.writeText(tpl);
                      e.currentTarget.textContent = "✓ Copied";
                    }}>Copy capture URL</button>
                  </div>
                </div>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>⌨ Shortcuts</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                <button className="menu-item" onClick={() => { setHelpOpen(true); setSettingsOpen(false); }}>
                  ⌨ Keyboard shortcuts <span className="menukey kbd">?</span>
                </button>

                <details className="kmfold">
                  <summary className="kmfold-head">
                    <span>⌨ Customize shortcuts</span>
                    <span className="cardsub mono">{KEY_ACTIONS.length + NAV_ACTIONS.length} bindings ▾</span>
                  </summary>
                <div className="menu-sec" style={{ marginTop: 8 }}>ACTIONS</div>
                {KEY_ACTIONS.map((a) => (
                  <div key={a.id} className="kmrow">
                    <span className="kmlabel">{a.label}</span>
                    {keyListen === a.id ? (
                      <span className="kmlisten mono">press a key… (Esc cancels)</span>
                    ) : (
                      <span className="kbd">{keymap[a.id] === "/" ? "/" : keymap[a.id].toUpperCase()}</span>
                    )}
                    <button className="kbtn" onClick={() => { setKeyListen(keyListen === a.id ? null : a.id); setKeyErr(null); }}>
                      {keyListen === a.id ? "Cancel" : "Change"}
                    </button>
                  </div>
                ))}
                <div className="menu-sec" style={{ marginTop: 10 }}>🧭 NAVIGATION — PRESS G, THEN…</div>
                {NAV_ACTIONS.map((a) => (
                  <div key={a.id} className="kmrow">
                    <span className="kmlabel">{a.label}</span>
                    {keyListen === a.id ? (
                      <span className="kmlisten mono">press a key… (Esc cancels)</span>
                    ) : (
                      <span className="shorts-keys"><span className="kbd">G</span><span className="thn">then</span><span className="kbd">{(keymap[a.id] || a.def).toUpperCase()}</span></span>
                    )}
                    <button className="kbtn" onClick={() => { setKeyListen(keyListen === a.id ? null : a.id); setKeyErr(null); }}>
                      {keyListen === a.id ? "Cancel" : "Change"}
                    </button>
                  </div>
                ))}
                {keyErr && <div className="kmerr">{keyErr}</div>}
                <button className="btn ghost sm" style={{ marginTop: 8 }}
                  onClick={() => { setKm(resetKeymap()); setKeyListen(null); setKeyErr(null); }}>
                  Reset all shortcuts to defaults
                </button>
                </details>
              </div>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>✦ AI models</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                {/* the no-key path comes first: one click finds a local server
                   (or downloads a small model) and AI just turns on */}
                <QuickAISetup onConfigured={(cfg) => { updateAI(cfg); setKeyEdit(false); }} />
              </div>

              {/* everything below is optional detail — each topic folds away */}
              <details className="subfold">
                <summary className="subfold-head"><span>🛠 Manual setup — Claude or hosted providers</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                <select className="menu-input" value={aiCfg.provider || "anthropic"} aria-label="AI provider"
                  onChange={(e) => { updateAI({ provider: e.target.value }); setKeyEdit(false); }}>
                  <option value="anthropic">Claude</option>
                  <option value="oss">Open model — Gemma, Mistral, Llama, or bring your own</option>
                </select>

                {(aiCfg.provider || "anthropic") === "anthropic" ? (
                  <>
                    {aiCfg.apiKey && !keyEdit ? (
                      <div className="keyrow">
                        {/* the stored key is never rendered — not even masked into an input */}
                        <span className="keystate mono">API key saved ✓</span>
                        <button className="kbtn" onClick={() => setKeyEdit(true)} title="Paste a different key">Replace</button>
                        <button className="kbtn kdel" onClick={() => { updateAI({ apiKey: undefined }); setKeyEdit(false); }}
                          title="Remove the key from this browser">Remove</button>
                      </div>
                    ) : (
                      <input className="menu-input" type="password" autoComplete="off" defaultValue=""
                        style={{ marginTop: 6 }} aria-label="Claude API key"
                        placeholder={aiCfg.apiKey ? "Paste a new key, press Enter (Esc to keep current)" : "Your Claude API key — press Enter to save"}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = e.target.value.trim();
                            if (v) { updateAI({ apiKey: v }); e.target.value = ""; setKeyEdit(false); }
                          }
                          if (e.key === "Escape") { e.stopPropagation(); e.target.value = ""; setKeyEdit(false); }
                        }} />
                    )}
                    <select className="menu-input" value={aiCfg.model} aria-label="AI model"
                      style={{ marginTop: 6 }}
                      onChange={(e) => updateAI({ model: e.target.value })}>
                      {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <select className="menu-input" style={{ marginTop: 6 }} aria-label="Open-source preset"
                      value={OSS_PRESETS.find((p) => p.url === aiCfg.ossBaseUrl)?.id || "custom"}
                      onChange={(e) => {
                        const p = OSS_PRESETS.find((x) => x.id === e.target.value);
                        /* Carry the preset's first model across too. Leaving the
                           previous provider's model name behind is the most
                           common way this ends in a confusing 404. */
                        if (p) updateAI({ ossBaseUrl: p.url, ossModel: p.models?.[0] || aiCfg.ossModel });
                      }}>
                      {OSS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                      <option value="custom">Custom server…</option>
                    </select>
                    <input className="menu-input" style={{ marginTop: 6 }} aria-label="Server URL"
                      value={aiCfg.ossBaseUrl || ""} placeholder="Server URL, e.g. http://localhost:11434/v1"
                      onChange={(e) => updateAI({ ossBaseUrl: e.target.value.trim() })} />
                    <input className="menu-input" style={{ marginTop: 6 }} list="oss-models" aria-label="Model name"
                      value={aiCfg.ossModel || ""} placeholder="Model name, e.g. llama3.3 or qwen2.5:14b"
                      onChange={(e) => updateAI({ ossModel: e.target.value.trim() })} />
                    <datalist id="oss-models">
                      {(presetById(OSS_PRESETS.find((p) => p.url === aiCfg.ossBaseUrl)?.id)?.models
                        || OSS_MODEL_SUGGESTIONS).map((m) => <option key={m} value={m} />)}
                    </datalist>
                    {(() => {
                      const p = OSS_PRESETS.find((x) => x.url === aiCfg.ossBaseUrl);
                      if (!p) return null;
                      return (
                        <div className="menu-foot" style={{ border: "none", marginTop: 6, paddingTop: 0 }}>
                          {p.note && <>{p.note} </>}
                          {p.keyUrl && (
                            <>Get a key: <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a></>
                          )}
                          {!p.needsKey && <>No key needed — leave the field below empty.</>}
                        </div>
                      );
                    })()}
                    {aiCfg.ossKey && !keyEdit ? (
                      <div className="keyrow">
                        <span className="keystate mono">API key saved ✓</span>
                        <button className="kbtn" onClick={() => setKeyEdit(true)} title="Paste a different key">Replace</button>
                        <button className="kbtn kdel" onClick={() => { updateAI({ ossKey: undefined }); setKeyEdit(false); }}
                          title="Remove the key from this browser">Remove</button>
                      </div>
                    ) : (
                      <input className="menu-input" type="password" autoComplete="off" defaultValue=""
                        style={{ marginTop: 6 }} aria-label="Open-source provider API key"
                        placeholder={aiCfg.ossKey ? "Paste new key, press Enter (Esc to keep current)" : "API key — only for hosted providers, Enter to save (local models: leave empty)"}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = e.target.value.trim();
                            if (v) { updateAI({ ossKey: v }); e.target.value = ""; setKeyEdit(false); }
                          }
                          if (e.key === "Escape") { e.stopPropagation(); e.target.value = ""; setKeyEdit(false); }
                        }} />
                    )}
                  </>
                )}
                <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
                  {(aiCfg.provider || "anthropic") === "anthropic"
                    ? "Your key is kept only in this browser and never shown again once saved."
                    : "Pick a hosted model and paste its key, or point at a local model (Ollama, LM Studio) with no key at all."}
                </div>
              </div>
              </details>

              <details className="subfold">
                <summary className="subfold-head"><span>💾 Local models · Ollama</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
                <LocalModels />
              </details>

              <details className="subfold">
                <summary className="subfold-head"><span>🔎 Semantic search index</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
                <SearchIndexCard items={items} />
              </details>
              </details>

              <details className="setfold"><summary className="setfold-head"><span>🔗 Connected apps & sync</span><span className="setfold-caret" aria-hidden="true">▾</span></summary>
              <div className="set-sec">
                <div className="conn-row">
                  <span>☁ Cloud files linked</span>
                  <span className="mono">{items.filter((i) => i.cloud).length}</span>
                </div>
                <div className="conn-row">
                  <span>📅 Calendar events imported</span>
                  <span className="mono">{(() => { try { return (JSON.parse(localStorage.getItem("vault.calendar.v1") || "{}").events || []).length; } catch { return 0; } })()}</span>
                </div>

                <CalendarConnect />

                <button className="menu-item" onClick={() => { setSettingsOpen(false); openSection("doc"); }}>
                  ＋ Link a Google Doc / Sheet / Drive / Excel file <span className="menukey">→ Documents</span>
                </button>
                <button className="menu-item" onClick={() => { setSettingsOpen(false); setView("todos"); setTag(null); setAdding(false); setPageId(null); }}>
                  ＋ Import Google / Apple calendar (.ics) <span className="menukey">→ Tasks</span>
                </button>
                <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
                  Google Calendar connects above for live sync. Docs, Sheets and Drive are linked — paste a link in Documents; they open in their own app.
                </div>
              </div>

              <SyncSection />
              </details>

            </div>
          </div>
        </div>
      )}
      <AskVault items={items} open={askOpen} onClose={() => setAskOpen(false)}
        onGoto={goto} onOpenSettings={() => setSettingsOpen(true)} />
      <GoogleDrivePicker open={driveOpen} onClose={() => setDriveOpen(false)} onImport={(it) => add(it)} />
      {chord && <div className="chordhint mono" role="status">G — then {NAV_ACTIONS.map((a) => (keymap[a.id] || a.def).toUpperCase()).join(" ")}</div>}

      <nav className={`side ${open ? "open" : "rail"}`}
        onClick={(e) => {
          /* on phones the open drawer squeezes the page — picking a
             destination should tuck it away again */
          if (e.target.closest?.(".navbtn") && window.matchMedia("(max-width: 860px)").matches) setOpen(false);
        }}>
        <div className="top">
          <button className="burger" onClick={() => setOpen((o) => !o)}
            title={open ? "Collapse sidebar" : "Expand sidebar"}
            aria-label={open ? "Collapse sidebar" : "Expand sidebar"}><Ic name="menu" size={19} /></button>
          {open && <h1>Vault</h1>}
        </div>

        {nav.flatMap((n, idx) => {
          const btn = (
            <button key={n.k} className={`navbtn ${(n.k === "all" ? isContentView(view) : view === n.k) ? "on" : ""}`}
              title={open ? n.hint : `${n.label} (${n.hint})`}
              onClick={() => n.k in SECTIONS
                ? openSection(n.k)
                : (setView(n.k), setTag(null), setAdding(false), setPageId(null))}>
              <span className="ic" aria-hidden="true"><Ic name={n.ic} size={19} /></span>
              {open && <>{n.label}{n.k in SECTIONS && <span className="cnt">{items.filter((i) => i.type === n.k).length}</span>}</>}
            </button>
          );
          if (idx !== 0) return [btn];
          /* Ask sits right after Dashboard — it's the hero feature in the
             go-to-market design, so it gets prime placement, not buried below. */
          return [btn, (
            <button key="ask" className={`navbtn askbtn ${view === "ask" ? "on" : ""}`}
              onClick={() => { setView("ask"); setTag(null); setAdding(false); setPageId(null); }}
              title="Ask your Vault — AI answers with citations from your saved items">
              <span className="ic" aria-hidden="true"><Ic name="ai" size={19} /></span>
              {open && <>Ask AI</>}
            </button>
          )];
        })}

        <button className={`navbtn ${view === "searchpg" ? "on" : ""}`}
          onClick={() => { setView("searchpg"); setTag(null); setAdding(false); setPageId(null); }}
          title="Search everything (Ctrl+K opens the quick version)">
          <span className="ic" aria-hidden="true"><Ic name="search" size={19} /></span>
          {open && <>Search<span className="cnt">⌘K</span></>}
        </button>

        {trashed.length > 0 && (
          <button className={`navbtn ${view === "trash" ? "on" : ""}`}
            title={open ? undefined : "Recently deleted"}
            onClick={() => { setView("trash"); setTag(null); setAdding(false); setPageId(null); }}>
            <span className="ic" aria-hidden="true"><Ic name="trash" size={19} /></span>
            {open && <>Recently deleted<span className="cnt">{trashed.length}</span></>}
          </button>
        )}

        {open && (
          <div className="foot">
            <div className="trust-chips">
              <span className="trust-chip"><span className="tc-dot ok" aria-hidden="true" />Local-first · your data</span>
              <span className="trust-chip"><span className="tc-dot accent" aria-hidden="true" />{aiReady ? "AI on your key" : "Bring your own AI"}</span>
            </div>
            Data lives in this browser ({formatBytes(storageUsage())} used).
            <div className="foot-legal">
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
            </div>
            <div style={{ marginTop: 6 }}>
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
          <button className="bellbtn" onClick={(e) => { e.stopPropagation(); setBellOpen((b) => !b); setMenuOpen(false); setAlerts(computeAlerts()); }}
            aria-haspopup="menu" aria-expanded={bellOpen} aria-label={`Notifications — ${alerts.length} alert${alerts.length === 1 ? "" : "s"}`}
            title="Notifications & reminders">
            <Ic name="bell" size={18} />
            {alerts.length > 0 && <span className="bellbadge mono">{alerts.length}</span>}
          </button>
          {bellOpen && (
            <div className="menu bellmenu" onClick={(e) => e.stopPropagation()} role="menu">
              <div className="menu-sec">🔔 NEEDS ATTENTION</div>
              {alerts.length === 0 && (
                <div className="menu-foot" style={{ border: "none", marginTop: 0 }}>All clear — nothing due right now. 🎉</div>
              )}
              {alerts.map((a) => (
                <button key={a.id} className="menu-item" style={a.warn ? { color: "var(--stamp)" } : undefined}
                  onClick={() => { setView(a.view); setTag(null); setAdding(false); setPageId(null); setBellOpen(false); }}>
                  {a.text}
                </button>
              ))}
              <div className="menu-sec">STAY UPDATED</div>
              <button className="menu-item" onClick={() => { downloadICS(); setBellOpen(false); }}
                title="Download your due dates as a calendar file — import it into Google/Apple/Outlook Calendar and get reminders there">
                📅 Send due dates to my calendar (.ics)
              </button>
              {typeof Notification !== "undefined" && notifPerm !== "granted" && (
                <button className="menu-item" onClick={() => Notification.requestPermission().then((p) => setNotifPerm(p))}
                  title="Vault will show a desktop summary once a day when something needs attention">
                  🖥 Enable desktop alerts
                </button>
              )}
              {notifPerm === "granted" && (
                <div className="menu-foot" style={{ border: "none", marginTop: 0 }}>
                  Desktop alerts on — you'll get a summary when things come due.
                </div>
              )}
            </div>
          )}
          <button className="avatar" onClick={(e) => { e.stopPropagation(); setMenuOpen((m) => !m); setBellOpen(false); }}
            aria-haspopup="menu" aria-expanded={menuOpen} title="Profile & settings">
            {(profile.name || "You").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </button>
          {menuOpen && (
            <div className="menu" onClick={(e) => e.stopPropagation()} role="menu">
              {/* account header — the shape a signed-in account takes at launch */}
              <div className="menu-account">
                <span className="menu-avatar" aria-hidden="true">
                  {(profile.name || "You").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                </span>
                <span className="menu-who">
                  <b>{profile.name?.trim() || "Your account"}</b>
                  <small>Manage account in Settings</small>
                </span>
              </div>
              <button className="menu-item" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>
                ⚙ Settings
              </button>
              <button className="menu-item" onClick={() => { setHelpOpen(true); setMenuOpen(false); }}>
                ⌨ Keyboard shortcuts <span className="menukey kbd">?</span>
              </button>
              <div className="menu-foot">{hasVerifiedIdentity() ? "Vault · saved on this device and synced to your account" : "Vault · saved in this browser only"}</div>
            </div>
          )}
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}

        {restore && (
          <div className="pal-overlay" onClick={() => setRestore(null)} role="dialog" aria-label="Restore backup">
            <div className="pal restoredlg" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 4px" }}>Restore this backup?</h3>
              <p className="sub" style={{ margin: "0 0 14px" }}>
                {restore.exportedAt
                  ? `Saved ${fmtStamp(restore.exportedAt.slice(0, 10))}.`
                  : "An older export, which held items only."}
                {" "}This replaces everything currently in this browser.
              </p>
              <table className="av-table">
                <thead><tr><th>Contents</th><th style={{ textAlign: "right" }}>In the file</th></tr></thead>
                <tbody>
                  <tr><td>Items — notes, videos, library, documents</td><td style={{ textAlign: "right" }}>{restore.counts.items}</td></tr>
                  <tr><td>Tasks</td><td style={{ textAlign: "right" }}>{restore.counts.todos}</td></tr>
                  <tr><td>Finance records</td><td style={{ textAlign: "right" }}>{restore.counts.finance}</td></tr>
                  <tr><td>Boards</td><td style={{ textAlign: "right" }}>{restore.counts.boards} ({restore.counts.cards} cards)</td></tr>
                </tbody>
              </table>
              {restore.legacy && (
                <div className="av-note av-warn" style={{ marginTop: 10 }}>
                  This is an older backup, from before to-dos, finance and boards were
                  included. Restoring it brings your items back and leaves everything
                  else in this browser untouched.
                </div>
              )}
              <div className="restore-actions">
                <button className="btn ghost sm" onClick={() => setRestore(null)}>Cancel</button>
                <button className="btn sm" onClick={async () => {
                  const c = await applyBackup(restore);
                  setRestore(null);
                  setToast(`Restored ${c.items} items, ${c.todos} to-dos, ${c.finance} finance records, ${c.boards} boards — reloading…`);
                  setTimeout(() => window.location.reload(), 1400);
                }}>Replace my vault</button>
              </div>
            </div>
          </div>
        )}

        {undoItem && (
          <div className="toast" role="status">
            Moved “{(undoItem.alias || undoItem.title).slice(0, 40)}” to Recently deleted
            <button onClick={() => { update(undoItem); setUndoItem(null); }}>Undo</button>
          </div>
        )}
        {view === "ask" && (
          <AskVault inline items={items} open onClose={() => {}} onGoto={goto}
            onOpenSettings={() => setSettingsOpen(true)} />
        )}

        {view === "searchpg" && (
          <>
            <div className="crumb">Search · everything you&rsquo;ve saved</div>
            <h2 className="display">Search your vault</h2>
            <CommandPalette inline items={items} actions={paletteActions} open
              onClose={() => {}} onGo={(r) => (r.kind === "tag" ? openTag(r.tag) : goto(r.item))} />
          </>
        )}

        {view === "dash" && (
          <>
            {/* the landing moment: greeting in a glass hero slab, then a
                sticky glass toolbar carrying search + ranges + the numbers */}
            <div className="hero-band">
              <div className="crumb">Overview · {fmtStamp(today())}</div>
              <h2 className="display">
                {profile.name && profile.name.trim() && profile.name.trim() !== "You"
                  ? `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${profile.name.trim().split(/\s+/)[0]}`
                  : "Your collection, at a glance"}
              </h2>
              <Intro id="dash">Search everything with <span className="kbd">Ctrl</span>+<span className="kbd">K</span> — here&rsquo;s just what matters today.</Intro>
            </div>

            <div className="glass-bar">
              <button className="dash-search" onClick={() => setPalette(true)}>
                <span className="ds-ic" aria-hidden="true"><Ic name="search" size={16} /></span>
                <span className="ds-ph">Search or ask your vault…</span>
                <span className="ds-kbd kbd">Ctrl K</span>
              </button>
              {pulse?.ins && (
                <>
                  <div className="doctabs" role="tablist" aria-label="Time range">
                    {RANGES.map(([k, label]) => (
                      <button key={k} className={range === k ? "on" : ""} role="tab" aria-selected={range === k}
                        onClick={() => setProfile((p) => ({ ...p, range: k }))}>{label}</button>
                    ))}
                  </div>
                  {(() => {
                    const done = pulse.doneDates.filter(inRange).length;
                    const saved = items.filter((i) => inRange(i.date)).length;
                    const spent = pulse.expensesRaw.filter((e) => inRange(e.date)).reduce((a, e) => a + e.amt, 0);
                    const sym = pulse.ins.money.sym;
                    return (
                      <span className="rangeroll mono">
                        {RANGE_WORD[range]}: <b>{fmtK(done)}</b> finished · <b>{fmtK(saved)}</b> saved · <b>{sym}{Math.round(spent).toLocaleString()}</b> spent
                      </span>
                    );
                  })()}
                </>
              )}
            </div>

            {ob && !ob.dismissed && ob.choice && (() => {
              let boardsOwn = false;
              try { boardsOwn = (JSON.parse(localStorage.getItem("vault.boards.v1") || "{}").boards || []).some((b) => !b.seeded); } catch {}
              const steps = [
                { id: "cap", label: "Save your first item — a link, a thought, a document", hint: "Content → ＋ New", done: items.some((i) => +i.id > 1e12), go: () => openSection("all") },
                { id: "name", label: "Make it yours — add your name", hint: "Settings → Profile", done: !!profile.name?.trim() && profile.name.trim() !== "You", go: () => setSettingsOpen(true) },
                { id: "board", label: "Plan something — create your own board", hint: "Boards → ＋ New board", done: boardsOwn, go: () => { setView("board"); setTag(null); setAdding(false); setPageId(null); } },
                { id: "ai", label: "Optional: connect AI — Claude or an open-source model", hint: "Settings → AI assistant", done: aiReady, go: () => setSettingsOpen(true) },
              ];
              return (
                <ChecklistCard steps={steps} sampleMode={ob.choice === "sample"}
                  onDismiss={() => setObState(setOB({ dismissed: true }))}
                  onGo={(s) => s.go()} />
              );
            })()}

            {pulse?.ins && (() => {
              /* Go-to-market layout: mono section labels on the canvas, needs
                 cards in a row, rings + the momentum sparkline in one progress
                 grid, then the two breakdown charts side by side. */
              const ins = pulse.ins;
              const sym = ins.money.sym;
              const cardsOpen = Math.max(0, ins.boards.total - ins.boards.done);
              const needs = [
                pulse.overdueTasks && { k: "od", label: "Overdue tasks", n: pulse.overdueTasks, sub: "Open tasks →", tone: "red", go: () => goView("todos") },
                pulse.dueToday && { k: "dt", label: "Due today", n: pulse.dueToday, sub: "Open tasks →", tone: "amber", go: () => goView("todos") },
                pulse.pendingBills && { k: "bill", label: "Unpaid bills", sub: pulse.overdueBills ? `${pulse.overdueBills} overdue · Finance →` : "Open Finance →", n: `${sym}${Math.round(pulse.pendingBillsTotal).toLocaleString()}`, tone: pulse.overdueBills ? "red" : "amber", go: () => goView("finance") },
                cardsOpen && { k: "cards", label: "Cards in progress", n: cardsOpen, sub: "Open Boards →", tone: "neutral", go: () => goView("board") },
              ].filter(Boolean);
              /* one aggregate Reading ring, not one per book — a vault with
                 200 in-progress books still gets a single calm card */
              const readingBooks = items.filter((i) => i.type === "book" && (i.progress || 0) > 0 && (i.progress || 0) < 100);
              const readAvg = readingBooks.length ? Math.round(readingBooks.reduce((x, y) => x + (y.progress || 0), 0) / readingBooks.length) : 0;
              /* the whole progress row follows the Daily/Weekly/Monthly/Yearly
                 tab; only inherently-monthly budget keeps its own caption */
              const doneInRange = pulse.doneDates.filter(inRange).length;
              const taskPct = doneInRange + ins.todos.open > 0 ? Math.round((doneInRange / (doneInRange + ins.todos.open)) * 100) : 0;
              const rings = [
                { k: "todo", feat: "Tasks", label: `Tasks ${RANGE_WORD[range]}`, val: `${fmtK(doneInRange)} done · ${fmtK(ins.todos.open)} open`, pct: taskPct, color: "var(--moss)", go: () => goView("todos") },
                ins.boards.total > 0 && { k: "sprint", feat: "Boards", label: "Sprint", val: `${fmtK(ins.boards.done)}/${fmtK(ins.boards.total)} done`, pct: ins.boards.pct, color: "var(--azure)", go: () => goView("board") },
                readingBooks.length > 0 && {
                  k: "read", feat: "Content",
                  label: readingBooks.length === 1 ? `Reading · ${readingBooks[0].alias || readingBooks[0].title}` : `Reading · ${fmtK(readingBooks.length)} books`,
                  val: readingBooks.length === 1 ? `${readingBooks[0].progress || 0}%` : `${readAvg}% avg`,
                  pct: readAvg, color: "var(--gold)",
                  go: () => (readingBooks.length === 1 ? goto(readingBooks[0]) : openSection("book")),
                },
                ins.money.budget > 0 && { k: "budget", feat: "Finance", label: `Budget · ${ins.money.budgetWord}`, val: `${sym}${Math.round(ins.money.budgetSpent).toLocaleString()} / ${sym}${Math.round(ins.money.budget).toLocaleString()}`, pct: Math.min(100, ins.money.pct), color: ins.money.pct > 100 ? "var(--stamp)" : "var(--gold)", go: () => goView("finance") },
              ].filter(Boolean);
              /* momentum sparkline + small range-aware charts; every card is a
                 door into its section, and the flex grid packs with no gaps */
              const { values: sv, tips: st } = rangeSeries(pulse.doneDates, range);
              const hasSpark = sv.some((n) => n > 0);
              const span = { day: "last 14 days", week: "last 8 weeks", month: "last 12 months", year: "last 5 years" }[range];
              const half = Math.floor(sv.length / 2);
              /* equal-size windows — with odd bucket counts the middle bucket
                 is left out so the comparison stays honest */
              const a = sv.slice(0, half).reduce((x, y) => x + y, 0);
              const b = sv.slice(sv.length - half).reduce((x, y) => x + y, 0);
              /* no earlier-half baseline → a % reads as a stuck "+100%";
                 the honest number is the span total */
              const deltaTxt = a === 0 ? `${fmtK(a + b)} total` : `${b >= a ? "+" : ""}${Math.round(((b - a) / a) * 100)}%`;
              const deltaDown = a > 0 && b < a;
              const exp = pulse.expensesRaw || [];
              const spend = rangeSeries(exp.map((e) => e.date), range, exp.map((e) => e.amt));
              const spentNow = exp.filter((e) => inRange(e.date)).reduce((x, e) => x + e.amt, 0);
              /* "Where money goes" follows the range tab like everything else */
              const catMap = {};
              exp.filter((e) => inRange(e.date)).forEach((e) => { catMap[e.cat] = (catMap[e.cat] || 0) + e.amt; });
              const topCats = Object.entries(catMap).map(([cat, amt]) => ({ cat, amt })).sort((x, y) => y.amt - x.amt).slice(0, 5);
              return (
                <>
                  {/* digest lives at the TOP and follows the range tab */}
                  <div className="card digestcard" style={{ borderColor: "var(--violet)" }}>
                    <h3>✦ {({ day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" })[range] || "Weekly"} digest
                      <button className="aibtn" style={{ marginLeft: 10 }} disabled={digestBusy || !aiReady}
                        title={aiReady ? `Your AI reviews your ${RANGE_WORD[range]}: what you saved, what's rotting, what to do next` : "Set up an AI model in Settings to enable"}
                        onClick={genDigest}>{digestBusy ? "Writing…" : digest ? "Regenerate" : "Generate"}</button>
                    </h3>
                    {digest
                      ? <div className="digest">{digest}</div>
                      : <div className="m" style={{ color: "var(--ink-soft)" }}>
                          {aiReady
                            ? `One click and your AI reviews ${RANGE_WORD[range]} — what you saved, what's going stale, and what to finish next. Switch the Daily/Weekly/Monthly/Yearly tab to change the window.`
                            : "AI is off — connect Claude or an open-source model in Settings to unlock the digest, Ask AI, summaries and more."}
                        </div>}
                  </div>

                  <div className="sec-label mono"><span className="sl-dot" aria-hidden="true" /> Needs you now</div>
                  {needs.length ? (
                    <div className="needs-grid">
                      {needs.map((r) => (
                        <button key={r.k} className={`needcard tone-${r.tone}`} onClick={r.go} title={`Open — ${r.label}`}>
                          <span className={`need-tag mono ${r.tone}`}>{r.label}</span>
                          <span className="need-big">{typeof r.n === "number" ? fmtK(r.n) : r.n}</span>
                          <span className="need-meta">{r.sub}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="allclear">✓ You're all caught up — nothing pending.</div>
                  )}

                  <div className="sec-label mono">Your progress · {RANGE_WORD[range]}</div>
                  <div className="prog-grid">
                    {rings.map((r) => {
                      const pct = Math.max(0, Math.min(100, Math.round(r.pct)));
                      return (
                        <button key={r.k} className="ringcard" title={`Powered by ${r.feat} — click to open`}
                          onClick={() => setAskNav({ label: r.feat, title: r.label, fn: r.go })}>
                          <div className="progring" style={{ background: `conic-gradient(${r.color} ${pct}%, var(--line) 0)` }}>
                            <span className="progring-hole mono">{pct}%</span>
                          </div>
                          <div className="progring-meta">
                            <span className="progring-label">{r.label}</span>
                            <b className="mono">{r.val}</b>
                          </div>
                        </button>
                      );
                    })}
                    {hasSpark && (
                      <button className="ringcard spark-card" title="Powered by Tasks — click to open"
                        onClick={() => setAskNav({ label: "Tasks", title: "Tasks finished", fn: () => goView("todos") })}>
                        <div className="spark-body">
                          <div className="spark-head">
                            <span className="progring-label">Tasks finished</span>
                            <b className={`mono spark-delta ${deltaDown ? "down" : ""}`}>{deltaTxt}</b>
                          </div>
                          <SparkArea values={sv} labels={st} color="var(--moss)" soft="var(--moss-soft)"
                            fmt={(v) => `${fmtK(v)} done`} label={`Tasks finished, ${span}`} />
                          <span className="spark-span mono">{span}</span>
                        </div>
                      </button>
                    )}
                    {spend.values.some((v) => v > 0) && (
                      <button className="ringcard spark-card" title="Powered by Finance — click to open"
                        onClick={() => setAskNav({ label: "Finance", title: "Spending", fn: () => goView("finance") })}>
                        <div className="spark-body">
                          <div className="spark-head">
                            <span className="progring-label">Spending</span>
                            <b className="mono">{sym}{Math.round(spentNow).toLocaleString()} {RANGE_WORD[range]}</b>
                          </div>
                          <TinyBars values={spend.values} labels={spend.tips} color="var(--gold)"
                            fmt={(v) => `${sym}${Math.round(v).toLocaleString()}`} label={`Spending, ${span}`} />
                          <span className="spark-span mono">{span}</span>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* the chart area begins here — Add chart sits top-right above it */}
                  <div className="sec-label mono charts-head">
                    Insights · {RANGE_WORD[range]}
                    <button className="kbtn yc-add" onClick={() => setExplore({ cfg: { ...newChartCfg(), range }, isNew: true })}
                      title="Build your own chart from any feature's data — it lands at the bottom of the charts">＋ Add chart</button>
                  </div>
                  <div className="charts-duo">
                    <div className="card"><h3>Where things live</h3><Zoom title="Where things live" sub={`Share of items saved ${RANGE_WORD[range]}.`}
                      go={{ label: "Content", fn: () => goView("all") }}
                      note={<><b>How to read:</b> each slice is one section; the number in the middle is everything saved {RANGE_WORD[range]}. It follows the Daily/Weekly/Monthly/Yearly tab above.</>}><Donut items={items.filter((i) => inRange(i.date))} /></Zoom></div>
                    <div className="card">
                      {/* no amount up here — the TOTAL block below is the one number */}
                      <div className="wstrip-head">
                        <h3 style={{ margin: 0 }}>Where money goes</h3>
                        <span className="cardsub mono">{RANGE_WORD[range]}</span>
                      </div>
                      {topCats.length ? (
                        <Zoom title="Where money goes" sub={`Biggest spending categories · ${RANGE_WORD[range]}.`}
                          go={{ label: "Finance", fn: () => goView("finance") }}
                          note={<><b>How to read:</b> your biggest spending categories for this range, largest first — the % is each one&rsquo;s share of the total below.</>}>
                          <div className="catbars catbars-fill">
                            {topCats.map((c) => {
                              const catMax = topCats[0].amt || 1;
                              const share = spentNow > 0 ? Math.round((c.amt / spentNow) * 100) : 0;
                              return (
                                <div key={c.cat} className="catbar" data-tip={`${c.cat} · ${sym}${c.amt.toFixed(2)} ${RANGE_WORD[range]} (${share}% of spend)`}>
                                  <span className="cb-name">{c.cat}</span>
                                  <span className="cb-track"><span className="cb-fill" style={{ width: `${Math.max(4, (c.amt / catMax) * 100)}%` }} /></span>
                                  <span className="cb-amt mono">{sym}{Math.round(c.amt).toLocaleString()}</span>
                                  <span className="cb-share mono">{share}%</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="wtotal">
                            <span className="etc-label mono">TOTAL</span>
                            <span className="wtotal-amt">{sym}{Math.round(spentNow).toLocaleString()}</span>
                          </div>
                        </Zoom>
                      ) : (
                        <div className="m" style={{ color: "var(--ink-soft)" }}>No expenses logged {RANGE_WORD[range]} — add one in Finance.</div>
                      )}
                    </div>
                  </div>

                  {/* second insight row: the collection compounding + the daily habit */}
                  <div className="charts-row2">
                    <div className="card">
                      <h3>Your vault, compounding</h3>
                      <div className="m" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Everything you&rsquo;ve saved, accumulating by type · {({ day: "last 14 days", week: "last 10 weeks", month: "last 6 months", year: "last 12 months" })[range]}.</div>
                      <Zoom title="Your vault, compounding" sub={`Everything saved, accumulating by type · ${{ day: "last 14 days", week: "last 10 weeks", month: "last 6 months", year: "last 12 months" }[range]}.`}
                        go={{ label: "Content", fn: () => goView("all") }}
                        note={<><b>How to read:</b> each coloured band is one type — notes, videos, library, documents — stacked so the top edge is your whole vault. Hover a band for its count in any bucket; the window follows the Daily/Weekly/Monthly/Yearly tab.</>}><VaultGrowth items={items} range={range} /></Zoom>
                    </div>
                    <div className="card">
                      <h3>Task rhythm</h3>
                      <div className="m" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Tasks finished · {({ day: "last 14 days", week: "last 10 weeks", month: "last 6 months, by week", year: "last 12 months, by week" })[range]} — streaks glow.</div>
                      <Zoom title="Task rhythm" sub={`Tasks finished per day · ${{ day: "last 14 days", week: "last 10 weeks", month: "last 6 months", year: "last 12 months" }[range]} — streaks glow.`}
                        go={{ label: "Tasks", fn: () => goView("todos") }}
                        note={<><b>How to read:</b> one bar per day (per week on the Monthly and Yearly tabs), taller = more tasks finished; the window follows the range tab above. Consecutive active days glow as a streak — protect it.</>}><TaskRhythm doneDates={pulse?.doneDates || []} range={range} /></Zoom>
                    </div>
                    <div className="card">
                      <h3>How things arrive</h3>
                      <div className="m" style={{ color: "var(--ink-soft)", marginBottom: 8 }}>Your capture mix {RANGE_WORD[range]} — typed, pasted, dropped, imported.</div>
                      <Zoom title="How things arrive" sub={`Your capture mix ${RANGE_WORD[range]} — typed, pasted, dropped, imported.`}
                        go={{ label: "Content", fn: () => goView("all") }}
                        note={<><b>How to read:</b> each bar counts how items entered Vault {RANGE_WORD[range]} — it follows the range tab above. Lots of &ldquo;pasted&rdquo; means you collect from elsewhere; &ldquo;typed&rdquo; means original notes.</>}><CaptureSources items={items.filter((i) => inRange(i.date))} importedCount={pulse?.importedCount || 0} /></Zoom>
                    </div>
                  </div>

                </>
              );
            })()}

            <div className="tiles">
              {Object.entries(SECTIONS).map(([k, s]) => {
                const nAll = items.filter((i) => i.type === k).length;
                const nNew = items.filter((i) => i.type === k && inRange(i.date)).length;
                return (
                  <div key={k} className="tile" onClick={() => openSection(k)} role="button" tabIndex={0}
                    data-tip={`Open ${s.label} — ${fmtK(nAll)} saved · ${fmtK(nNew)} added ${RANGE_WORD[range]}`}
                    onKeyDown={(e) => e.key === "Enter" && openSection(k)}>
                    <div className="k" style={{ color: s.color }}><Ic name={s.ic} size={22} /> {s.label}</div>
                    <div className="n">{fmtK(nAll)}</div>
                    <div className="d"><b>+{fmtK(nNew)}</b> {RANGE_WORD[range]}</div>
                  </div>
                );
              })}
            </div>

            {/* the user's own charts close out the dashboard — below the
                Notes / YouTube / Library / Documents cards */}
            <YourCharts rev={chartsRev} sym={pulse?.ins?.money?.sym || "$"}
              onExplore={(cfg) => setExplore({ cfg, isNew: false })} />

          </>
        )}

        {view === "board" && (
          <>
            <div className="crumb">Boards</div>
            <h2 className="display">Boards</h2>
            <Intro id="boards">Jira-style kanbans for anything — a feature, a sprint, this week — with any columns you like. Want an automatic board of everything you&rsquo;ve saved, by status? Add the Vault items board from the tab bar.</Intro>
            <CustomBoards itemsBoard={<ProjectBoard items={items} onUpdate={updateStamped} onGoto={goto} onTag={openTag} />} />
          </>
        )}

        {view === "finance" && (
          <>
            <div className="crumb">Money</div>
            <h2 className="display">Finance</h2>
            <Intro id="finance">Track daily expenses and keep every pending payment — credit card, rent, subscriptions — on the board until it&rsquo;s paid.</Intro>
            <FinanceBoard key={`fb-${capBump}`} range={range} onRange={(r) => setProfile({ ...profile, range: r })} />
          </>
        )}

        {view === "todos" && (
          <>
            <div className="crumb">Tasks</div>
            <h2 className="display">Tasks</h2>
            <Intro id="tasks">One box, zero setup — type a task and it sorts itself into Overdue, Today, Upcoming or Someday. ⚑ marks priority; click a date chip to reschedule.</Intro>
            <TaskBoard key={`tb-${capBump}`} />
          </>
        )}

        {view === "graph" && (
          /* no page header here — the graph owns the whole page, with its
             controls floating over the canvas like the dashboard glass bar */
          <GraphView items={items} onOpenTag={openTag} onOpenSection={openSection} />
        )}

        {view === "tags" && (
          <>
            <div className="crumb">Projects</div>
            <h2 className="display">Tags</h2>
            <Intro id="tags">Every project tag in your vault, with what it links together — click one to open the project.</Intro>

            <div className="bar featbar">
              <input placeholder="＋ Create a tag — e.g. “side-project” (Enter)" aria-label="Create a tag"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const t = normalizeTag(e.target.value);
                  if (!t) return;
                  setCustomTags(addCustomTag(t));
                  e.target.value = "";
                }} />
            </div>

            {(() => {
              const every = [...new Set([...allTags, ...customTags])];
              if (every.length === 0)
                return <div className="empty">No tags yet — create one above, or add #tags when saving items.</div>;
              return (
                <div className="taggrid">
                  {every
                    .sort((a, b) => items.filter((i) => i.tags.includes(b)).length - items.filter((i) => i.tags.includes(a)).length)
                    .map((t) => {
                      const tagged = items.filter((i) => i.tags.includes(t));
                      const unusedCustom = tagged.length === 0 && customTags.includes(t);
                      return (
                        <button key={t} className={`tagcard ${unusedCustom ? "tagcard-new" : ""}`} onClick={() => openTag(t)}>
                          <div className="tg-name display">#{t}</div>
                          <div className="tg-count mono">
                            {unusedCustom ? "new — nothing tagged yet" : `${tagged.length} item${tagged.length === 1 ? "" : "s"}`}
                          </div>
                          <div className="tg-secs">
                            {unusedCustom
                              ? <span className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginTop: 0 }}>use it via ＋ tag or #{t.slice(0, 12)} in Quick add</span>
                              : Object.entries(SECTIONS).map(([k, s]) => {
                                  const n = tagged.filter((i) => i.type === k).length;
                                  return n ? <span key={k} className="pill" style={{ background: s.soft, color: s.color, marginTop: 0 }}><Ic name={s.ic} /> {n}</span> : null;
                                })}
                          </div>
                          {unusedCustom && (
                            <span className="tg-del" role="button" tabIndex={0} title="Remove this unused tag"
                              aria-label={`Remove tag ${t}`}
                              onClick={(e) => { e.stopPropagation(); setCustomTags(removeCustomTag(t)); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setCustomTags(removeCustomTag(t)); } }}>✕</span>
                          )}
                        </button>
                      );
                    })}
                </div>
              );
            })()}
          </>
        )}

        {view === "trash" && (
          <>
            <div className="crumb">Trash</div>
            <h2 className="display">Recently deleted</h2>
            <Intro id="trash">Deleted items stay here for 30 days, then they&rsquo;re removed forever — just like Apple Notes.</Intro>
            {trashed.length > 0 && (
              <div className="bar">
                <div style={{ flex: 1 }} />
                <button className="btn ghost" style={armDel === "emptytrash" ? { borderColor: "var(--stamp)", color: "var(--stamp)" } : undefined}
                  onClick={() => {
                    if (armDel !== "emptytrash") { setArmDel("emptytrash"); return; }
                    trashed.forEach((t) => remove(t.id));
                    setArmDel(null);
                  }}>
                  {armDel === "emptytrash" ? `⚠ Delete ${trashed.length} forever? Click again` : "✕ Empty trash"}
                </button>
              </div>
            )}
            {trashed.length === 0
              ? <div className="empty">Nothing in the trash. Deleted items land here and stay recoverable for 30 days.</div>
              : [...trashed].sort((a, b) => b.deleted.localeCompare(a.deleted)).map((it) => {
                  const s = SECTIONS[it.type];
                  const left = Math.max(0, 30 - daysAgo(it.deleted));
                  return (
                    <div key={it.id} className="row">
                      <div className="icbox" style={{ background: s.soft, color: s.color }} aria-hidden="true"><Ic name={s.ic} /></div>
                      <div className="body">
                        <div className="t"><span className="ttext">{it.alias || it.title}</span></div>
                        <div className="m">{s.label} · deleted {fmtStamp(it.deleted)} · <b style={{ color: left <= 5 ? "var(--stamp)" : "inherit" }}>{left} day{left === 1 ? "" : "s"} left</b></div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className="btn sm" onClick={() => update({ ...it, deleted: undefined })}>↩ Restore</button>
                          <button className="btn ghost sm" style={armDel === `trash:${it.id}` ? { borderColor: "var(--stamp)", color: "var(--stamp)" } : undefined}
                            onClick={() => {
                              if (armDel !== `trash:${it.id}`) { setArmDel(`trash:${it.id}`); return; }
                              remove(it.id);
                              setArmDel(null);
                            }}>
                            {armDel === `trash:${it.id}` ? "⚠ Click again" : "✕ Delete forever"}
                          </button>
                        </div>
                      </div>
                      <div className="stamp">Added · {fmtStamp(it.date)}</div>
                    </div>
                  );
                })}
          </>
        )}

        {(isContentView(view) || view === "tag") && pageItem && (
          <NotePage it={pageItem} onBack={() => setPageId(null)} onUpdate={updateStamped} onTag={openTag} folders={folders}
            allItems={items} onGoto={goto} />
        )}

        {(isContentView(view) || view === "tag") && !pageItem && (
          <>
            <div className="crumb">{view === "tag" ? "Project" : view === "all" ? "Collection" : "Section"}</div>
            <h2 className="display">{view === "tag" ? `#${tag}` : view === "all" ? "Content" : SECTIONS[view].label}</h2>
            <Intro id={view === "tag" ? "tag" : `sec-${view}`}>
              {view === "tag"
                ? `Everything linked to “${tag}” across notes, videos, PDFs and documents.`
                : view === "all"
                  ? "Everything you've saved — notes, videos, reading and documents, in one place. Filter by type below."
                  : view === "video"
                    ? "Saved videos — press “Watch here” to play without leaving Vault."
                    : view === "book"
                      ? "Your reading hub — track progress on each book/PDF and link the notes, videos and docs that belong with it."
                      : "Click any #tag to jump to that project. Click item text to edit."}
            </Intro>

            {/* Type switcher — the four saved-item kinds, unified. "All" shows
                everything mixed; each type shows its own view and extras. */}
            {isContentView(view) && (
              <div className="doctabs ctype-tabs featbar" role="tablist" aria-label="Content type">
                <button className={view === "all" ? "on" : ""} role="tab" aria-selected={view === "all"}
                  onClick={() => { setView("all"); setTag(null); setAdding(false); setPageId(null); setQ(""); }}>
                  All · {items.filter((i) => CONTENT_TYPES.includes(i.type)).length}
                </button>
                {CONTENT_TYPES.map((t) => (
                  <button key={t} className={view === t ? "on" : ""} role="tab" aria-selected={view === t}
                    onClick={() => openSection(t)}>
                    {SECTIONS[t].label} · {items.filter((i) => i.type === t).length}
                  </button>
                ))}
              </div>
            )}

            {view === "tag" && (
              <div className="tagband">
                {Object.entries(SECTIONS).map(([k, s]) => {
                  const n = items.filter((i) => i.tags.includes(tag) && i.type === k).length;
                  return n ? <span key={k} className="pill" style={{ background: s.soft, color: s.color, marginTop: 0 }}><Ic name={s.ic} /> {n} {s.label.toLowerCase()}</span> : null;
                })}
              </div>
            )}

            {view === "doc" && (() => {
              const docs = items.filter((i) => i.type === "doc");
              const files = docs.filter((i) => i.file);
              const bytes = files.reduce((a, b) => a + (b.file?.size || 0), 0);
              const size = bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
              const counts = {};
              docs.forEach((d) => { const c = docCategory(d); counts[c] = (counts[c] || 0) + 1; });
              // Show the document types as a stable set so the section always
              // reads as "PDF · Word · Sheet · Image · Links · Text", each with
              // its count (0 included) — the types don't appear and vanish as
              // documents come and go. "Other" only shows if something lands there.
              const tabs = ["All", ...DOC_CATS.filter((c) => c !== "Other"),
                            ...(counts["Other"] ? ["Other"] : [])];
              return (
                <div className="doclib-head">
                  <span className="doclib-meta mono">
                    {docs.length} document{docs.length === 1 ? "" : "s"}
                    {bytes > 0 && ` · ${size} in ${files.length} file${files.length === 1 ? "" : "s"}`}
                  </span>
                  <div className="doctabs" role="tablist" aria-label="Filter documents">
                    {tabs.map((f) => (
                      <button key={f} className={docFilter === f ? "on" : ""} role="tab"
                        aria-selected={docFilter === f} onClick={() => setDocFilter(f)}>
                        {f}{f !== "All" ? ` · ${counts[f] || 0}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {view === "doc" && (
              <div className="cloudbar">
                <input placeholder="🔗 Paste a Google Doc / Sheet / Drive / Excel / OneDrive / Dropbox / Notion link to attach it…"
                  aria-label="Link a cloud file"
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const v = e.target.value.trim();
                    const cloud = detectCloud(v);
                    if (!cloud) return;
                    add({
                      id: Date.now(), type: "doc", title: cloudTitle(v, cloud),
                      meta: `${cloud.label} — opens in a new tab`, url: v, cloud: cloud.kind,
                      status: "Inbox", tags: [], date: today(),
                    });
                    e.target.value = "";
                  }} />
                <span className="cardsub mono">lives in its app · linked here</span>
              </div>
            )}

            {view === "doc" && hasVerifiedIdentity() && (
              <button className="btn ghost" style={{ marginBottom: 12 }} onClick={() => setDriveOpen(true)}>
                ⬇ Import from Google Drive <span className="menukey">Docs · Sheets · PDFs</span>
              </button>
            )}

            {view === "doc" && (
              <div className={`quickdrop ${quickDragOver ? "over" : ""}`} role="button" tabIndex={0}
                onClick={() => quickFileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && quickFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setQuickDragOver(true); }}
                onDragLeave={() => setQuickDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setQuickDragOver(false); quickSaveFile(e.dataTransfer.files); }}
                aria-label="Drop a file to save it instantly">
                ⬆ <b>Drop any file here to save it instantly</b> — no form, stamped today
                <input ref={quickFileRef} type="file" hidden
                  accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.csv,.json,.log,.epub,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp3,.m4a,.wav,.mp4,.webm"
                  onChange={(e) => { quickSaveFile(e.target.files); e.target.value = ""; }} />
              </div>
            )}
            {view === "doc" && quickFileErr && (
              <div className="kmerr" role="status">{quickFileErr}</div>
            )}

            {view === "note" && folders.length > 0 && (
              <div className="tagband" role="tablist" aria-label="Folders">
                <button className={`fchip ${effFolder === "All" ? "on" : ""}`} role="tab"
                  aria-selected={effFolder === "All"} onClick={() => setFolderSel("All")}>
                  All notes · {items.filter((i) => i.type === "note").length}
                </button>
                {folders.map((f) => (
                  <button key={f} className={`fchip ${effFolder === f ? "on" : ""}`} role="tab"
                    aria-selected={effFolder === f} onClick={() => setFolderSel(f)}>
                    ▸ {f} · {items.filter((i) => i.type === "note" && i.folder === f).length}
                  </button>
                ))}
              </div>
            )}

            <div className="bar">
              <input ref={filterRef} placeholder="Filter this view…  ( / — Ctrl+K searches everything)" value={q}
                onChange={(e) => setQ(e.target.value)} aria-label="Filter items" />
              <select className="sortsel" value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort items" title="Sort — pinned items always stay on top">
                <option value="added">Newest added</option>
                <option value="edited">Recently edited</option>
                <option value="title">Title A–Z</option>
              </select>
              <span className="datefilter" title="Show only items added on a specific day">
                <input type="date" value={dateFilter} aria-label="Filter by date added"
                  onChange={(e) => setDateFilter(e.target.value)} />
                {dateFilter && <button onClick={() => setDateFilter("")} aria-label="Clear date filter" title="Clear date filter">✕</button>}
              </span>
              {view === "note" && (
                <button className="btn ghost" onClick={() => setShowTemplates((v) => !v)}>
                  {showTemplates ? "Close templates" : "▦ Templates"}
                </button>
              )}
              {view === "note" && profile.density !== "compact" && (
                <div className="layouttoggle" role="group" aria-label="Layout">
                  <button className={notesLayout === "list" ? "on" : ""} title="List view"
                    onClick={() => setNotesLayout("list")}>☰</button>
                  <button className={notesLayout === "grid" ? "on" : ""} title="Grid view"
                    onClick={() => setNotesLayout("grid")}>▦</button>
                </div>
              )}
              <button className="btn ghost" title={profile.density === "compact" ? "Switch to comfortable cards" : "Switch to a compact, scannable list"}
                onClick={() => setProfile((p) => ({ ...p, density: p.density === "compact" ? "cards" : "compact" }))}>
                {profile.density === "compact" ? "▦ Cards" : "☰ Compact"}
              </button>
              <button className="btn" title="New item (N)" onClick={() => setAdding((a) => !a)}>{adding ? "Close (Esc)" : "+ Add item"}</button>
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
              <AddForm section={view === "all" || view === "tag" ? "note" : view} existingTags={[...new Set([...allTags, ...customTags])]}
                onAdd={(it) => add(view === "tag" ? { ...it, tags: [...new Set([...it.tags, tag])] } : it)}
                onClose={() => setAdding(false)} />
            )}

            {/* Compact list — a dense, scannable row per item, click (or Enter)
                to expand its full card in place. ↑/↓ move between rows, "/"
                focuses the filter. Fast to scan and act on a big vault. */}
            {profile.density === "compact" ? (
              visible.length ? (
                <div className="clist" ref={clistRef} role="list"
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    const rows = [...(clistRef.current?.querySelectorAll(".crow") || [])];
                    const cur = rows.indexOf(document.activeElement);
                    e.preventDefault();
                    const next = e.key === "ArrowDown" ? (rows[cur + 1] || rows[0]) : (rows[cur - 1] || rows[rows.length - 1]);
                    next?.focus();
                  }}>
                  {visible.map((it) => {
                    const s = SECTIONS[it.type] || {};
                    const open = expandedId === it.id;
                    return (
                      <div key={it.id} className="citem">
                        <div className={`crow ${open ? "open" : ""} ${focusId === it.id ? "flash" : ""}`}
                          role="button" tabIndex={0} aria-expanded={open}
                          onClick={() => setExpandedId((id) => (id === it.id ? null : it.id))}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId((id) => (id === it.id ? null : it.id)); } }}
                          title={it.alias || it.title}>
                          <span className="crow-ic" style={{ color: s.color }} aria-hidden="true">{s.icon}</span>
                          <span className="crow-title">{it.pinned && <span style={{ color: "var(--gold)" }}>★ </span>}{it.alias || it.title || "(untitled)"}</span>
                          <span className="crow-tags mono">{(it.tags || []).slice(0, 2).map((t) => `#${t}`).join(" ")}</span>
                          <span className="crow-date mono">{fmtStamp(it.date)}</span>
                          <span className="crow-acts">
                            <button title={it.pinned ? "Unpin" : "Pin"} onClick={(e) => { e.stopPropagation(); updateStamped({ ...it, pinned: !it.pinned }); }}>★</button>
                            <button title="Delete" onClick={(e) => { e.stopPropagation(); removeWithUndo(it.id); }}>✕</button>
                            <span className="crow-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
                          </span>
                        </div>
                        {open && (
                          <div className="crow-detail">
                            <ItemRow it={it} onTag={openTag} onUpdate={updateStamped} onRemove={removeWithUndo}
                              allItems={items} onGoto={goto} focus={false} onOpen={() => setPageId(it.id)} folders={folders} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : <div className="empty">{dateFilter || q || (view === "doc" && docFilter !== "All")
                    ? <>{dateFilter ? <>Nothing added on <b>{fmtStamp(dateFilter)}</b></> : (view === "doc" && docFilter !== "All") ? <>No <b>{docFilter}</b> documents yet</> : "Nothing matching your filter"} — <button className="av-link" onClick={() => { setDateFilter(""); setQ(""); setDocFilter("All"); }}>clear filters</button>.</>
                    : <>Nothing here yet. Tap <b>+ Add item</b> to save your first.</>}</div>
            ) : view === "note" && notesLayout === "grid" ? (
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
              ) : <div className="empty">{dateFilter || q
                    ? <>Nothing {dateFilter ? <>added on <b>{fmtStamp(dateFilter)}</b></> : "matching your filter"} here — <button className="av-link" onClick={() => { setDateFilter(""); setQ(""); }}>clear filters</button>.</>
                    : <>Nothing here yet. Tap <b>+ Add item</b> to create your first {SECTIONS[view].label.toLowerCase().replace(/s$/, "")}.</>}</div>
            ) : visible.length
              ? <div className="scrolllist scrolllist-tall">{visible.map((it) => <ItemRow key={it.id} it={it} onTag={openTag} onUpdate={updateStamped} onRemove={removeWithUndo}
                  allItems={items} onGoto={goto} focus={focusId === it.id} onOpen={() => setPageId(it.id)} folders={folders} />)}</div>
              : <div className="empty">{dateFilter || q || (view === "doc" && docFilter !== "All")
                  ? <>{dateFilter ? <>Nothing added on <b>{fmtStamp(dateFilter)}</b></> : (view === "doc" && docFilter !== "All") ? <>No <b>{docFilter}</b> documents yet</> : "Nothing matching your filter"} — <button className="av-link" onClick={() => { setDateFilter(""); setQ(""); setDocFilter("All"); }}>clear filters</button>.</>
                  : <>Nothing here yet. Tap <b>+ Add item</b>, paste a link for instant capture, or drop a file straight into the form.</>}</div>}

          </>
        )}
      </main>
    </div>
  );
}

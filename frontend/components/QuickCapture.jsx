"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { today } from "@/lib/seed";
import { detectCloud, cloudTitle } from "@/lib/cloud";
import { mirror, toCents } from "@/lib/api";
import { uid } from "@/lib/id";
import { useSpeechInput } from "@/lib/voice";

/* Universal quick capture — one box that accepts anything and routes it:
 *   · YouTube link                → YouTube item
 *   · any other URL              → link note
 *   · "coffee $4.50"             → Finance expense (category guessed)
 *   · "call the bank tomorrow ⚑" → To-do (due date + priority parsed)
 *   · anything else              → Note
 * The routing decision is previewed live and can be overridden before
 * saving. Heuristics only — works with AI off. */

const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parseTodo(text) {
  let t = text, high = false, due = null;
  if (/[⚑!]/.test(t)) { high = true; t = t.replace(/[⚑!]+/g, "").trim(); }
  const now = new Date();
  const mIso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const mTom = t.match(/\btomorrow\b/i);
  const mTod = t.match(/\btoday\b|\btonight\b/i);
  const mWk = t.match(/\bnext week\b/i);
  const mWd = t.match(new RegExp(`\\b(?:on |next |by )?(${WD.join("|")})\\b`, "i"));
  if (mIso) { due = mIso[1]; t = t.replace(mIso[0], ""); }
  else if (mTom) { const d = new Date(now); d.setDate(d.getDate() + 1); due = iso(d); t = t.replace(mTom[0], ""); }
  else if (mTod) { due = iso(now); t = t.replace(mTod[0], ""); }
  else if (mWk) { const d = new Date(now); d.setDate(d.getDate() + 7); due = iso(d); t = t.replace(mWk[0], ""); }
  else if (mWd) {
    const target = WD.indexOf(mWd[1].toLowerCase());
    const d = new Date(now);
    const delta = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + delta); due = iso(d); t = t.replace(mWd[0], "");
  }
  return { due, text: t.replace(/\s{2,}/g, " ").replace(/[,;]\s*$/, "").trim() || text.trim(), high };
}

/* #hashtags anywhere in the text become custom tags on the saved item */
export function pullTags(s) {
  const tags = [...s.matchAll(/(^|\s)#([a-z0-9][\w-]*)/gi)].map((m) => m[2].toLowerCase());
  const text = s.replace(/(^|\s)#[a-z0-9][\w-]*/gi, " ").replace(/\s{2,}/g, " ").trim();
  return { tags: [...new Set(tags)], text };
}

export function route(raw) {
  const { tags, text } = pullTags(raw.trim());
  const s = text;
  if (!s && !tags.length) return null;
  if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/i.test(s)) return { kind: "video", url: s, tags };
  const cloud = detectCloud(s);
  if (cloud && /^https?:\/\/\S+$/i.test(s)) return { kind: "clouddoc", url: s, cloud, tags };
  if (/^https?:\/\/\S+$/i.test(s)) return { kind: "link", url: s, tags };
  const money = s.match(/(?:[$€£₹]\s?(\d+(?:[.,]\d{1,2})?))|(?:\b(\d+(?:[.,]\d{1,2})?)\s?(?:usd|dollars|bucks)\b)/i);
  if (money && s.length < 90) {
    const amount = parseFloat((money[1] || money[2]).replace(",", "."));
    const desc = s.replace(money[0], "").replace(/\s{2,}/g, " ").replace(/\b(?:for|on|at)\b\s*$/i, "").trim() || "Expense";
    const cat = /coffee|lunch|dinner|breakfast|grocer|food|restaurant|snack|pizza/i.test(s) ? "Food"
      : /uber|taxi|metro|bus|train|fuel|gas|flight|parking/i.test(s) ? "Transport"
        : /gym|pharmac|doctor|medic|dentist/i.test(s) ? "Health"
          : /movie|game|netflix|concert|fun|bar\b/i.test(s) ? "Fun"
            : /shirt|shoe|amazon|clothes|headphone/i.test(s) ? "Shopping" : "Other";
    return { kind: "expense", amount, desc, cat, tags };
  }
  const td = parseTodo(s);
  if (td.due || td.high || /^(call|email|text|buy|pay|book|send|fix|finish|review|schedule|remind me to|clean|submit|renew|cancel|pick up)\b/i.test(s))
    return { kind: "todo", ...td, tags };
  return { kind: "note", tags };
}

const KINDS = {
  video: { label: "YouTube", hint: "saved to your YouTube section" },
  clouddoc: { label: "Cloud file", hint: "linked in Documents — opens in its app" },
  link: { label: "Link note", hint: "saved to Notes with the link attached" },
  expense: { label: "Expense", hint: "logged in Finance for this month" },
  todo: { label: "To-do", hint: "added to your to-do list" },
  note: { label: "Note", hint: "saved to Notes" },
};

export default function QuickCapture({ open, onClose, onAddItem, onSaved, seed = "" }) {
  const [text, setText] = useState("");
  const [override, setOverride] = useState(null);
  const [flash, setFlash] = useState(null);
  const inputRef = useRef(null);
  /* a share-target / bookmarklet capture arrives pre-filled via `seed` —
     the routing preview runs on it immediately, Enter confirms */
  useEffect(() => { if (open) { setText(seed || ""); setOverride(null); setFlash(null); setTimeout(() => inputRef.current?.focus(), 30); } }, [open, seed]);

  /* dictation appends (not replaces) so voice composes with typed text,
     and the normal setText path keeps the routing preview live */
  const voice = useSpeechInput({
    onText: (t) => {
      setText((prev) => (prev ? prev + " " : "") + t);
      setOverride(null);
      inputRef.current?.focus();
    },
  });

  /* Escape closes from anywhere in the dialog (not just the input) */
  useEffect(() => {
    if (!open) return;
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  const auto = useMemo(() => route(text), [text]);
  const decision = override && text.trim() ? { ...(route(text) || {}), ...reRoute(text, override), kind: override } : auto;

  function reRoute(s, kind) {
    if (kind === "todo") return parseTodo(s);
    if (kind === "expense") {
      const r = route(s);
      if (r?.kind === "expense") return r;
      const m = s.match(/(\d+(?:[.,]\d{1,2})?)/);
      return { amount: m ? parseFloat(m[1].replace(",", ".")) : 0, desc: s.replace(m?.[0] || "", "").trim() || "Expense", cat: "Other" };
    }
    return {};
  }

  const save = async () => {
    const s = text.trim();
    if (!s || !decision) return;
    const k = decision.kind;
    const tags = decision.tags || [];
    const plain = pullTags(s).text || s;
    if (k === "video" || k === "link" || k === "note" || k === "clouddoc") {
      let title = plain, meta = "Captured via quick add";
      if (k === "clouddoc") {
        title = cloudTitle(decision.url, decision.cloud);
        meta = `${decision.cloud.label} — opens in a new tab`;
      } else if (k === "video" || k === "link") {
        title = decision.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70);
        try {
          const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(decision.url)}`);
          const data = await res.json();
          if (data?.title) { title = data.title; meta = data.author_name || meta; }
        } catch { /* offline or unsupported — keep URL-derived title */ }
      }
      onAddItem({
        id: Date.now(), type: k === "video" ? "video" : k === "clouddoc" ? "doc" : "note",
        title: k === "note" ? (plain.length > 70 ? plain.slice(0, 67) + "…" : plain) : title,
        meta: k === "note" ? "Captured via quick add" : meta,
        url: decision.url || undefined, status: "Inbox", tags, date: today(),
        cloud: decision.cloud?.kind || undefined,
        blocks: k === "note" && plain.length > 70 ? [{ id: "p" + Date.now(), kind: "text", text: plain, indent: 0 }] : undefined,
      });
    } else if (k === "todo") {
      try {
        const st = JSON.parse(localStorage.getItem("vault.todos.v1") || "{}");
        const tasks = Array.isArray(st.tasks) ? st.tasks : [];
        const task = { id: uid(), text: decision.text || s, done: false, due: decision.due || today(), high: !!decision.high, label: (decision.tags || [])[0], created: today() };
        tasks.unshift(task);
        localStorage.setItem("vault.todos.v1", JSON.stringify({ version: 2, ...st, tasks }));
        /* write-through mirror (fire-and-forget; POST /todos upserts by id) */
        mirror("/todos", { method: "POST", body: { id: task.id, text: task.text, done: false, done_at: null, due: task.due, high: task.high, label: task.label ?? null, created_on: task.created } });
      } catch { return; }
    } else if (k === "expense") {
      try {
        const st = JSON.parse(localStorage.getItem("vault.finance.v1") || "{}");
        const expenses = Array.isArray(st.expenses) ? st.expenses : [];
        const exp = { id: uid(), desc: decision.desc, amount: decision.amount, cat: decision.cat, date: today() };
        expenses.unshift(exp);
        localStorage.setItem("vault.finance.v1", JSON.stringify({ ...st, expenses }));
        /* write-through mirror (fire-and-forget; POST /finance/expenses upserts by id) */
        mirror("/finance/expenses", { method: "POST", body: { id: exp.id, desc: exp.desc, amount_cents: toCents(exp.amount), cat: exp.cat, pay_method_id: null, spent_on: exp.date } });
      } catch { return; }
    }
    onSaved?.(k);
    setFlash(k);
    setText(""); setOverride(null);
    setTimeout(() => setFlash(null), 1600);
  };

  if (!open) return null;
  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Quick capture">
      <div className="pal qcap" onClick={(e) => e.stopPropagation()}>
        <div className="qcap-row">
          <input ref={inputRef} className="qcap-input" value={text} aria-label="Capture anything"
            placeholder="Type or paste anything — a link, “coffee $4.50”, “call the bank tomorrow ⚑”, a thought…"
            onChange={(e) => { setText(e.target.value); setOverride(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onClose();
            }} />
          {voice.supported && (
            <button className="kbtn qcap-mic" aria-label={voice.listening ? "Stop listening" : "Dictate"}
              aria-pressed={voice.listening} title={voice.listening ? "Listening — click to stop" : "Dictate instead of typing"}
              onClick={voice.listening ? voice.stop : voice.start}>
              {voice.listening ? "●" : "🎙"}
            </button>
          )}
        </div>
        {voice.listening && voice.interim && (
          <div className="m" style={{ padding: "0 4px", color: "var(--ink-soft)" }}>…{voice.interim}</div>
        )}
        {voice.error && (
          <div className="m" style={{ padding: "0 4px", color: "var(--stamp)" }}>{voice.error}</div>
        )}
        <div className="qcap-foot">
          {text.trim() && decision ? (
            <>
              <span className="qcap-as mono">SAVE AS</span>
              {Object.entries(KINDS).map(([k, v]) => (
                <button key={k} className={`fchip ${decision.kind === k ? "on" : ""}`}
                  onClick={() => setOverride(k)}>{v.label}</button>
              ))}
              <span className="qcap-hint">
                {decision.kind === "todo" && decision.due ? `due ${decision.due}${decision.high ? " · ⚑ priority" : ""}`
                  : decision.kind === "expense" ? `${decision.desc} · $${decision.amount} · ${decision.cat}`
                    : decision.kind === "clouddoc" ? `${decision.cloud.label} → Documents`
                      : KINDS[decision.kind].hint}
                {decision.tags?.length ? ` · ${decision.tags.map((t) => `#${t}`).join(" ")}` : ""} · Enter ↵
              </span>
            </>
          ) : flash ? (
            <span className="qcap-saved">✓ Saved as {KINDS[flash].label} — capture another, or Esc to close</span>
          ) : (
            <span className="qcap-hint">Vault figures out where it goes — you can override before saving. Esc closes.</span>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import { SECTIONS, fmtStamp } from "@/lib/seed";
import { askAnywhere, aiEnabled, serverAIStatus } from "@/lib/ai";
import { SCOPES, FORMATS, buildPrompt, canUseServerSearch, retrieveFromServer } from "@/lib/ask";
import { Ic } from "./Icons";

/* "Ask your Vault" — retrieval, then a cited answer in the shape you asked for.
 *
 * Retrieval takes the better of two paths. With sync on it uses the backend's
 * pgvector search, which understands meaning rather than shared words and —
 * crucially — includes text extracted from uploaded PDFs and Word files.
 * Those bytes were never in the browser, so local search cannot see inside a
 * document at all; it can only ever match its filename.
 *
 * With sync off it falls back to term-overlap scoring over localStorage, so
 * the feature still works offline. The UI says which path answered, because
 * "nothing found" means different things in each.
 *
 * Answers must cite [n] against the numbered sources, and the chips jump to
 * the item — an answer you cannot check is not much of an answer. */

const blockText = (b) => {
  if (!b) return "";
  const parts = [b.text || "", b.title || ""];
  if (b.kind === "table" && b.rows) parts.push(b.rows.flat().join(" | "));
  if (b.kind === "page" && b.blocks) parts.push(b.blocks.map(blockText).join("\n"));
  return parts.filter(Boolean).join("\n");
};

const itemChunk = (it) => {
  const body = (it.blocks || []).map(blockText).filter(Boolean).join("\n");
  return `${it.title}\n${it.meta || ""}\nTags: ${it.tags.join(", ")}\n${body}`.slice(0, 4000);
};

const tokenize = (s) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) || []);

function retrieve(items, question, maxChunks = 8, budget = 9000) {
  const qTerms = [...new Set(tokenize(question))];
  const scored = items.map((it) => {
    const title = tokenize(it.title + " " + it.tags.join(" "));
    const body = tokenize(itemChunk(it));
    let score = 0;
    for (const t of qTerms) {
      score += 3 * title.filter((w) => w === t || w.startsWith(t)).length;
      score += body.filter((w) => w === t).length;
    }
    return { it, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  const picked = [];
  let used = 0;
  for (const { it } of scored) {
    const chunk = itemChunk(it);
    if (used + chunk.length > budget) continue;
    picked.push(it);
    used += chunk.length;
    if (picked.length >= maxChunks) break;
  }
  /* fall back to most recent items so the model always has something */
  if (!picked.length) picked.push(...items.slice(0, 4));
  return picked;
}

export default function AskVault({ items, open, onClose, onGoto, onOpenSettings }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [format, setFormat] = useState("prose");
  const [serverSearch, setServerSearch] = useState(false);
  const [answeredBy, setAnsweredBy] = useState(null);
  const [serverAI, setServerAI] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  /* Probe once per open: when the server can answer, the browser needs no key
     of its own, and asking for one would be actively misleading. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    serverAIStatus()
      .then((st) => { if (live) setServerAI(!!st.server_completion); })
      .catch(() => {});
    return () => { live = false; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const ask = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setError(null); setAnswer(null);

    /* Server retrieval when it is available, because only it can see inside
       uploaded documents. Falling back to local search on failure keeps the
       feature usable when the backend is asleep or unreachable, which on a
       free host is a normal Tuesday rather than an incident. */
    let picked = [];
    let usedServer = false;
    if (canUseServerSearch()) {
      try {
        const hits = await retrieveFromServer(question, { scope });
        picked = hits.map((h) => {
          const local = items.find((i) => String(i.id) === String(h.client_id));
          return {
            id: local?.id ?? `srv-${h.item_id}`,
            title: h.title, type: h.type, chunk: h.chunk,
            alias: local?.alias, date: local?.date, local: !!local,
          };
        });
        usedServer = true;
      } catch {
        usedServer = false;   // fall through to local
      }
    }
    if (!usedServer) {
      const types = SCOPES.find((sc) => sc.id === scope)?.types || [];
      const pool = types.length ? items.filter((i) => types.includes(i.type)) : items;
      picked = retrieve(pool, question).map((it) => ({
        id: it.id, title: it.title, type: it.type, alias: it.alias, date: it.date,
        chunk: itemChunk(it), local: true,
      }));
    }
    setServerSearch(usedServer);
    setSources(picked);

    if (!picked.length) {
      setBusy(false);
      setError(new Error(
        usedServer
          ? "Nothing in your vault matches that."
          : "Nothing matches — and offline search only reads titles and notes, not the inside of uploaded files. Turn on Backend sync to search document contents."
      ));
      return;
    }

    try {
      const { system, user } = buildPrompt(question, picked, format);
      const { text, via } = await askAnywhere(user, { system, maxTokens: 16000 });
      setAnswer(text);
      setAnsweredBy(via);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  /* render [n] citations as clickable chips */
  const renderAnswer = (text) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/^\[(\d+)\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const src = sources[+m[1] - 1];
      if (!src) return <span key={i}>{part}</span>;
      if (!src.local) return <span key={i} className="cite cite-flat" title={src.title}>{m[1]}</span>;
      return (
        <button key={i} className="cite" title={`Open: ${src.title}`}
          onClick={() => { onGoto(src); onClose(); }}>{m[1]}</button>
      );
    });

  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Ask your Vault">
      <div className="pal askvault" onClick={(e) => e.stopPropagation()}>
        <div className="av-head">
          <span className="av-spark" aria-hidden="true">✦</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Ask your vault anything — “what did that FastAPI video say about DB sessions?”"
            aria-label="Question"
            onKeyDown={(e) => e.key === "Enter" && ask()} />
          <button className="btn sm" onClick={ask} disabled={busy || !q.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>

        <div className="av-controls">
          <label className="av-ctl">
            <span>Search</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="What to search">
              {SCOPES.map((sc) => <option key={sc.id} value={sc.id}>{sc.label}</option>)}
            </select>
          </label>
          <label className="av-ctl">
            <span>Answer as</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Answer format">
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <span className="av-mode" title={canUseServerSearch()
            ? "Searches meaning across your vault, including text inside uploaded documents."
            : "Offline search matches words in titles and notes only — it cannot read inside uploaded files."}>
            {canUseServerSearch() ? "◈ deep search" : "○ offline search"}
          </span>
        </div>

        <div className="av-body">
          {!aiEnabled() && !serverAI && (
            <div className="av-note">
              🔑 AI is off — <button className="av-link" onClick={() => { onClose(); onOpenSettings(); }}>add your Anthropic API key in Settings</button> to ask questions.
              Your key stays in this browser only.
            </div>
          )}
          {busy && <div className="av-note">Searching your vault…</div>}
          {error && <div className="av-note av-err">⚠ {error.message}</div>}
          {answer && (
            <>
              <div className="av-answer">{renderAnswer(answer)}</div>
              <div className="av-sources">
                {/* Keyed by position, not item id: one item legitimately
                    returns several chunks — that is what document extraction
                    produces — and sharing an id made React drop rows. */}
                {sources.map((s, i) => (
                  <button key={`${s.id}-${i}`} className="av-src" disabled={!s.local}
                    onClick={() => { if (s.local) { onGoto(s); onClose(); } }}
                    title={s.local ? `Open in ${SECTIONS[s.type]?.label || s.type}`
                                   : "Stored on the server — not in this browser"}>
                    <span className="mono">[{i + 1}]</span>{" "}
                    <Ic name={SECTIONS[s.type]?.ic || "doc"} size={12} /> {(s.alias || s.title).slice(0, 46)}
                  </button>
                ))}
              </div>
            </>
          )}
          {!answer && !busy && !error && (aiEnabled() || serverAI) && (
            <div className="av-note">
              {canUseServerSearch()
                ? "Answers come only from what you've saved — including the text inside uploaded PDFs and Word files — with citations you can click."
                : "Answers come only from what you've saved. Offline search reads titles and notes; turn on Backend sync to also search inside uploaded documents."}
            </div>
          )}
        </div>
        <div className="tips">
          <span><span className="kbd">↵</span> ask</span>
          <span><span className="kbd">Esc</span> close</span>
          <span style={{ marginLeft: "auto" }}>✦ answers cite your saved items</span>
        </div>
      </div>
    </div>
  );
}

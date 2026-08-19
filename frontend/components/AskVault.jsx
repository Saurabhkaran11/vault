"use client";

import React, { useEffect, useRef, useState } from "react";
import { SECTIONS, fmtStamp } from "@/lib/seed";
import { askText, aiEnabled } from "@/lib/ai";
import { Ic } from "./Icons";

/* "Ask your Vault" — RAG-lite, fully client-side.
 * Retrieval: every item becomes a text chunk (title, meta, tags, all block
 * text, recursively). Chunks are scored against the question by term overlap;
 * the top matches are sent to Claude as numbered sources, and the answer must
 * cite them as [n]. Citations render as chips that jump to the source item.
 * (The backend phase upgrades retrieval to embeddings; this UI stays.) */

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
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
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
    const picked = retrieve(items, question);
    setSources(picked);
    const sourceBlock = picked
      .map((it, i) => `[${i + 1}] (${SECTIONS[it.type].label}, added ${fmtStamp(it.date)})\n${itemChunk(it)}`)
      .join("\n\n---\n\n");
    try {
      const text = await askText(
        `Here are the user's saved items:\n\n${sourceBlock}\n\nQuestion: ${question}`,
        {
          system:
            "You answer questions about the user's personal knowledge vault using ONLY the numbered sources provided. " +
            "Cite sources inline as [1], [2] etc. after each claim. If the sources don't contain the answer, say so plainly and suggest what to save. " +
            "Keep answers short and direct — a few sentences unless the question demands more.",
          maxTokens: 16000,
        }
      );
      setAnswer(text);
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

        <div className="av-body">
          {!aiEnabled() && (
            <div className="av-note">
              🔑 AI is off — <button className="av-link" onClick={() => { onClose(); onOpenSettings(); }}>add your Anthropic API key in Settings</button> to ask questions.
              Your key stays in this browser only.
            </div>
          )}
          {busy && <div className="av-note">Reading {sources.length} relevant item{sources.length === 1 ? "" : "s"} from your vault…</div>}
          {error && <div className="av-note av-err">⚠ {error.message}</div>}
          {answer && (
            <>
              <div className="av-answer">{renderAnswer(answer)}</div>
              <div className="av-sources">
                {sources.map((s, i) => (
                  <button key={s.id} className="av-src" onClick={() => { onGoto(s); onClose(); }}
                    title={`Open in ${SECTIONS[s.type].label}`}>
                    <span className="mono">[{i + 1}]</span> <Ic name={SECTIONS[s.type].ic} size={12} /> {(s.alias || s.title).slice(0, 46)}
                  </button>
                ))}
              </div>
            </>
          )}
          {!answer && !busy && !error && aiEnabled() && (
            <div className="av-note">Answers come only from what you've saved — notes, videos, books, docs — with citations you can click.</div>
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

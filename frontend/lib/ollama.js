"use client";

import { getAIConfig } from "./ai";

/* Native Ollama API client — the endpoints the OpenAI-compat route doesn't
 * cover: version, tags (installed models), pull (streaming download), delete.
 *
 * Every function here returns human-ready error messages, because whatever
 * goes wrong ("Ollama isn't running") is something the user fixes, not us.
 * ollamaUp() never throws at all — reachability is a state, not an error.
 */

/* The chat config stores the OpenAI-compat URL (…/v1). Native endpoints live
 * at the server root, so strip a trailing /v1 — but only when the configured
 * server is actually Ollama (its port, or its preset); pointing native calls
 * at LM Studio or a hosted provider would just 404 confusingly. */
export function ollamaRoot() {
  const c = getAIConfig();
  if (c.provider === "oss" && c.ossBaseUrl && (c.ossBaseUrl.includes("11434") || c.ossPreset === "ollama")) {
    return c.ossBaseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
  }
  return "http://localhost:11434";
}

/* Starter models for the empty state. Byte sizes are approximate download
 * sizes, shown so nobody starts a 2 GB pull thinking it's a small file. */
export const CURATED = [
  { name: "llama3.2:3b", why: "fast general chat", bytes: 2_000_000_000 },
  { name: "qwen2.5:3b", why: "strong small all-rounder", bytes: 1_900_000_000 },
  { name: "smollm2:135m", why: "tiny test model", bytes: 270_000_000 },
  { name: "nomic-embed-text", why: "semantic search embeddings", bytes: 274_000_000 },
];

/* Decimal units (1 GB = 1e9), matching how Ollama's site lists model sizes. */
export const humanSize = (n) =>
  !n ? "" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;

/* Embedding models can't chat — offering one as the chat model is a trap.
 * Name is the practical signal; family catches BERT-based ones named oddly. */
export function isEmbedModel(m) {
  const name = (typeof m === "string" ? m : m?.name || "").toLowerCase();
  const family = (typeof m === "string" ? "" : m?.family || "").toLowerCase();
  return name.includes("embed") || name.includes("minilm") || family.includes("bert");
}

/** Reachability probe. Resolves {up, version} — never throws, never hangs. */
export async function ollamaUp() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const res = await fetch(`${ollamaRoot()}/api/version`, { signal: ctl.signal });
    if (!res.ok) return { up: false };
    const data = await res.json().catch(() => ({}));
    return { up: true, version: data.version || "" };
  } catch {
    return { up: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Installed models. Throws a human message if Ollama can't answer. */
export async function listModels() {
  let res;
  try {
    res = await fetch(`${ollamaRoot()}/api/tags`);
  } catch {
    throw new Error("Couldn't reach Ollama — start it with OLLAMA_ORIGINS='*' ollama serve");
  }
  if (!res.ok) throw new Error("Ollama couldn't list models — try refreshing.");
  const data = await res.json().catch(() => ({}));
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size || 0,
    family: m.details?.family || "",
    paramSize: m.details?.parameter_size || "",
    modifiedAt: m.modified_at || "",
  }));
}

function cancelError() {
  const err = new Error("Pull canceled.");
  err.canceled = true;
  return err;
}

/* Registry errors arrive as raw manifest-speak; translate the common ones.
 * The .human flag tells the stream loop below "already a message for people,
 * rethrow as-is" — everything unflagged there is a network failure. */
function pullError(name, raw) {
  const t = (raw || "").toLowerCase();
  let msg;
  if (t.includes("not found") || t.includes("does not exist") || t.includes("unknown"))
    msg = `"${name}" isn't in the Ollama library — check the spelling (e.g. llama3.2:3b) at ollama.com/library.`;
  else if (t.includes("space") || t.includes("disk"))
    msg = "Not enough disk space for this model — free some up and try again.";
  else msg = `Pull failed${raw ? `: ${String(raw).slice(0, 120)}` : " — try again."}`;
  const err = new Error(msg);
  err.human = true;
  return err;
}

/**
 * Download a model, streaming progress. Ollama answers with NDJSON chunks
 * like {status, digest, total, completed}; the last one is {status:"success"}.
 * onProgress gets {status, completed, total, pct} per chunk (pct null while
 * the total is unknown — manifest/verify phases). Abort via `signal`; that
 * rejects with an error carrying .canceled=true so the UI can stay quiet.
 * Ollama keeps completed layers, so a re-pull resumes where it stopped.
 */
export async function pullModel(name, onProgress, signal) {
  let res;
  try {
    res = await fetch(`${ollamaRoot()}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, stream: true }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw cancelError();
    throw new Error("Couldn't reach Ollama — start it with OLLAMA_ORIGINS='*' ollama serve");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    let msg = t;
    try { msg = JSON.parse(t).error || t; } catch { /* plain-text body */ }
    throw pullError(name, msg || `HTTP ${res.status}`);
  }
  if (!res.body) throw new Error("This browser can't stream the download — update it and try again.");

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let succeeded = false;

  const handleLine = (line) => {
    if (!line.trim()) return;
    let chunk;
    try { chunk = JSON.parse(line); } catch { return; }
    if (chunk.error) throw pullError(name, chunk.error);
    if (chunk.status === "success") succeeded = true;
    const total = chunk.total || 0;
    const completed = chunk.completed || 0;
    onProgress?.({
      status: chunk.status || "",
      completed,
      total,
      pct: total ? Math.min(100, Math.round((completed / total) * 100)) : null,
    });
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop(); // last piece may be a partial line — keep for next read
      for (const line of lines) handleLine(line);
    }
    handleLine(buf);
  } catch (e) {
    if (e?.name === "AbortError" || signal?.aborted) throw cancelError();
    if (e?.human) throw e;
    throw new Error("Lost the connection to Ollama mid-pull — pulling again resumes where it stopped.");
  }
  if (!succeeded) throw pullError(name, "the download ended early — try again.");
}

/** Remove an installed model from disk. */
export async function deleteModel(name) {
  let res;
  try {
    res = await fetch(`${ollamaRoot()}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
    });
  } catch {
    throw new Error("Couldn't reach Ollama — start it with OLLAMA_ORIGINS='*' ollama serve");
  }
  if (res.status === 404) throw new Error(`"${name}" is already gone — refreshing the list.`);
  if (!res.ok) throw new Error(`Couldn't delete "${name}" — try again.`);
}

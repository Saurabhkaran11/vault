"use client";

import { AIError, getAIConfig } from "./ai";

/* Local semantic index — embeddings computed by Ollama ON THIS MACHINE,
 * vectors stored in IndexedDB. Nothing leaves the computer.
 *
 * Chat (lib/ai.js) and embeddings are deliberately separate concerns: chat
 * may be Claude or any hosted model, but embedding a user's whole vault
 * through a paid API would be slow, costly and a privacy surprise — so the
 * index always talks to a local Ollama, whichever chat provider is set.
 *
 * Vectors live in IndexedDB, not localStorage: ~100 items × 768 floats
 * already brushes the ~5 MB localStorage quota that safeStorage guards.
 *
 * Failure contract: read paths (indexStatus / semanticSearch / relatedTo)
 * never throw — they return an empty result carrying a human-readable
 * `.reason`, so callers can quietly fall back to keyword search. Write
 * paths (embedTexts / buildIndex) throw AIError with a human message,
 * because they run behind a button whose owner shows errors.
 */

const DB_NAME = "vault-embeds";
const DB_VERSION = 1;
const STORE = "vec";
const BATCH = 16;
const MAX_CHARS = 1500;

export const DEFAULT_EMBED_MODEL = "nomic-embed-text";

export function embedModel() {
  return getAIConfig().embedModel || DEFAULT_EMBED_MODEL;
}

/* Native Ollama endpoints (/api/embed, /api/tags, …) live at the server
 * root, one level above the OpenAI-compat /v1 the chat config stores. Only
 * trust the configured URL when it plausibly IS an Ollama (port 11434 or
 * the ollama preset) — an LM Studio or hosted URL has no /api/embed. */
export function ollamaRoot() {
  const cfg = getAIConfig();
  const url = (cfg.ossBaseUrl || "").trim();
  const isOllama = cfg.provider === "oss" && url &&
    (url.includes("11434") || cfg.ossPreset === "ollama");
  if (isOllama) return url.replace(/\/+$/, "").replace(/\/v1$/, "");
  return "http://localhost:11434";
}

/* ------------------------------------------------------------ embedding */

/** texts → float vectors, batched. Throws AIError with a next-step message. */
export async function embedTexts(texts, { timeoutMs } = {}) {
  const root = ollamaRoot();
  const model = embedModel();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    /* No default timeout: the FIRST embed call may load the model into
     * memory, which legitimately takes many seconds. Probes pass their own. */
    const ctrl = timeoutMs ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(`${root}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: batch }),
        signal: ctrl?.signal,
      });
    } catch {
      throw new AIError("net", "Couldn't reach Ollama — start it with OLLAMA_ORIGINS='*' ollama serve");
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404 || /not found/i.test(body))
        throw new AIError("missing_model", `Pull ${model} in Settings → Local models`);
      throw new AIError("api", `Embedding failed (${res.status}) — check Ollama in Settings → Local models.`);
    }
    let data;
    try { data = await res.json(); } catch {
      throw new AIError("api", "Ollama returned a non-JSON response — try again.");
    }
    const vecs = data.embeddings;
    if (!Array.isArray(vecs) || vecs.length !== batch.length)
      throw new AIError("api", `${model} returned no embeddings — is it an embedding model?`);
    out.push(...vecs);
  }
  return out;
}

/** Cheap health probe for UI: is Ollama up, and is the embed model pulled?
 * Uses /api/tags (a listing — never triggers a slow model load) with a short
 * timeout, so a Settings card can render its hint without hanging. */
export async function probeEmbed({ timeoutMs = 3500 } = {}) {
  const root = ollamaRoot();
  const model = embedModel();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${root}/api/tags`, { signal: ctrl.signal });
  } catch {
    return { ok: false, hint: "Ollama isn't running — start it with OLLAMA_ORIGINS='*' ollama serve" };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, hint: `Ollama answered ${res.status} — check the server URL in Settings.` };
  let data;
  try { data = await res.json(); } catch {
    return { ok: false, hint: "That server doesn't look like Ollama — check the URL in Settings." };
  }
  /* "nomic-embed-text" should match the installed "nomic-embed-text:latest" */
  const base = (n) => (n || "").split(":")[0];
  const names = (data.models || []).map((m) => m.name || m.model);
  if (!names.some((n) => n === model || base(n) === base(model)))
    return { ok: false, hint: `Pull ${model} in Settings → Local models` };
  return { ok: true };
}

/* ------------------------------------------------------------ item text */

/* Item shape (lib/seed.js): { id, title, alias?, meta, tags, blocks?, … }.
 * Blocks carry the note body: text kinds, table rows, nested sub-pages. */
const blocksText = (blocks) => {
  const out = [];
  for (const b of blocks || []) {
    if (b.text) out.push(b.text);
    if (b.kind === "table" && Array.isArray(b.rows)) out.push(b.rows.flat().join(" "));
    if (b.kind === "page") {
      if (b.title) out.push(b.title);
      out.push(blocksText(b.blocks));
    }
  }
  return out.filter(Boolean).join("\n");
};

/** What gets embedded for an item: title + summary + note text, capped so
 * one giant note can't blow the model's context or the request size. */
export function itemText(it) {
  return [it.title, it.alias, it.meta, blocksText(it.blocks)]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_CHARS);
}

/* djb2 — collisions are harmless here (worst case: one stale vector). The
 * model name is folded in so switching embed models marks everything stale
 * instead of mixing vectors from incompatible spaces. */
function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}
const itemHash = (text) => `${embedModel()}:${text.length.toString(36)}:${hashText(text)}`;

/* ------------------------------------------------------- IndexedDB (raw) */

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("unsupported"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("open failed"));
    req.onblocked = () => reject(new Error("blocked"));
  });
}

/* Open→use→close per operation: at vault scale (hundreds of rows) this is
 * instant, and a held-open connection would block future version upgrades. */
async function dbAll() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function dbWrite(puts, deletes) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const r of puts || []) st.put(r);
      for (const id of deletes || []) st.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    });
  } finally {
    db.close();
  }
}

const DB_UNAVAILABLE =
  "This browser blocks local databases (common in private windows) — the semantic index can't be stored.";

/* --------------------------------------------------------------- index */

/** Embed new/changed items, drop vectors for deleted ones.
 * onProgress({done,total}) counts items EMBEDDED this run (unchanged items
 * are skipped via the stored hash). Returns {indexed, skipped}; if the
 * vector store itself is unavailable, returns {…, reason} instead of
 * throwing. Network/model failures throw AIError for the button to show. */
export async function buildIndex(items, onProgress) {
  let existing;
  try { existing = await dbAll(); } catch {
    return { indexed: 0, skipped: 0, reason: DB_UNAVAILABLE };
  }
  const byId = new Map(existing.map((r) => [r.id, r]));
  const want = items.map((it) => {
    const text = itemText(it);
    return { it, text, hash: itemHash(text) };
  });
  const todo = want.filter((w) => byId.get(w.it.id)?.hash !== w.hash);
  const keep = new Set(items.map((i) => i.id));
  const orphans = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);

  const total = todo.length;
  let done = 0;
  onProgress?.({ done, total });
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embedTexts(batch.map((b) => b.text));
    try {
      await dbWrite(
        batch.map((b, j) => ({ id: b.it.id, hash: b.hash, vec: vecs[j] })),
        i === 0 ? orphans : []
      );
    } catch {
      throw new AIError("db", DB_UNAVAILABLE);
    }
    done += batch.length;
    onProgress?.({ done, total });
  }
  if (total === 0 && orphans.length) {
    try { await dbWrite([], orphans); } catch { /* stale orphans are harmless */ }
  }
  return { indexed: total, skipped: items.length - total };
}

/** Where the index stands, without embedding anything (no network).
 * indexed = items whose stored vector matches their current text;
 * stale   = new or changed items a rebuild would embed. */
export async function indexStatus(items) {
  const total = items.length;
  let existing;
  try { existing = await dbAll(); } catch {
    return { indexed: 0, total, stale: total, reason: DB_UNAVAILABLE };
  }
  const byId = new Map(existing.map((r) => [r.id, r]));
  let indexed = 0;
  for (const it of items) {
    const r = byId.get(it.id);
    if (r && r.hash === itemHash(itemText(it))) indexed++;
  }
  return { indexed, total, stale: total - indexed };
}

/* --------------------------------------------------------------- search */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/* Empty-but-explained result: an array (so callers can map/spread it
 * blindly) carrying a human-readable `.reason` for callers that care. */
const emptyResult = (reason) => Object.assign([], { reason });

/** Meaning-based search over the stored vectors. Returns [{item, score}]
 * sorted best-first, joined against the items passed in (vectors whose item
 * is gone are skipped). Never throws — an empty array with `.reason` means
 * the caller should quietly fall back to keyword search. */
export async function semanticSearch(query, items, k = 8) {
  const q = (query || "").trim();
  if (!q) return emptyResult("Empty query.");
  let stored;
  try { stored = await dbAll(); } catch { return emptyResult(DB_UNAVAILABLE); }
  if (!stored.length) return emptyResult("Nothing indexed yet — build the search index in Settings.");
  let qvec;
  try { [qvec] = await embedTexts([q]); } catch (e) {
    return emptyResult(e?.message || "Couldn't embed the query.");
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  return stored
    .map((r) => ({ item: byId.get(r.id), score: cosine(qvec, r.vec) }))
    .filter((r) => r.item)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Nearest neighbours of one item, for a "Related" section. Prefers the
 * item's STORED vector (no network at all); only embeds its text when the
 * item was never indexed. Same no-throw contract as semanticSearch. */
export async function relatedTo(item, items, k = 4) {
  if (!item) return emptyResult("No item given.");
  let stored;
  try { stored = await dbAll(); } catch { return emptyResult(DB_UNAVAILABLE); }
  const others = stored.filter((r) => r.id !== item.id);
  if (!others.length) return emptyResult("Nothing indexed yet — build the search index in Settings.");
  let vec = stored.find((r) => r.id === item.id)?.vec;
  if (!vec) {
    try { [vec] = await embedTexts([itemText(item)]); } catch (e) {
      return emptyResult(e?.message || "Couldn't embed this item.");
    }
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  return others
    .map((r) => ({ item: byId.get(r.id), score: cosine(vec, r.vec) }))
    .filter((r) => r.item && r.item.id !== item.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

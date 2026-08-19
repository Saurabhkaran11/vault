"use client";

/* Backend sync foundation (vault.backend.v1).
 *
 * Model for this phase: localStorage stays the instant, offline-capable
 * working copy; every mutation is MIRRORED to the FastAPI backend when
 * sync is enabled in Settings. Failed mirrors land in a durable retry
 * queue and flush when the backend is reachable again — mutations are
 * never lost and never block the UI.
 *
 * The auth phase upgrades userId to a Clerk session; nothing else here
 * changes. See .claude/skills/backend-integration/SKILL.md.
 */

const KEY = "vault.backend.v1";
const QKEY = "vault.backend.queue.v1";

export function getBackend() {
  try {
    return { url: "http://localhost:8000", enabled: false, userId: "demo", ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { url: "http://localhost:8000", enabled: false, userId: "demo" };
  }
}

export function setBackend(patch) {
  const next = { ...getBackend(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export const backendOn = () => {
  const b = getBackend();
  return !!(b.enabled && b.url);
};

export async function api(path, { method = "GET", body } = {}) {
  const b = getBackend();
  const res = await fetch(`${b.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-User-Id": b.userId || "demo" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`API ${res.status} on ${method} ${path}`);
    err.status = res.status;   // an HTTP response ≠ a network failure — see flushQueue
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

/* mirror(): fire-and-forget write-through. UI never waits, failures queue. */
export async function mirror(path, opts = {}) {
  if (!backendOn()) return false;
  try {
    await api(path, opts);
    return true;
  } catch {
    enqueueRetry(path, opts);
    return false;
  }
}

/* PUT mirrors carry whole-state snapshots (boards), so only the NEWEST one
 * per path matters — a superseded snapshot must never be replayed, or a
 * stale one can resurrect ids the newer state already replaced. */
const coalesce = (q) =>
  q.filter((job, i) =>
    (job.opts?.method || "GET") !== "PUT" ||
    !q.some((later, j) => j > i && later.path === job.path && (later.opts?.method || "GET") === "PUT"));

function enqueueRetry(path, opts) {
  try {
    const q = JSON.parse(localStorage.getItem(QKEY) || "[]");
    q.push({ path, opts, t: Date.now() });
    localStorage.setItem(QKEY, JSON.stringify(coalesce(q).slice(-500)));   // bounded
  } catch {}
}

export function pendingMirrors() {
  try { return JSON.parse(localStorage.getItem(QKEY) || "[]").length; } catch { return 0; }
}

/* Flush the retry queue in order. Mirror bodies are deterministic, so a job
 * the backend REJECTS (any HTTP status) would fail identically on every
 * replay — drop it, warn, and keep going; the working copy is still local
 * and "Sync everything again" can rebuild the server. Only network errors
 * (backend unreachable) stop the flush and keep the queue intact. */
export async function flushQueue() {
  if (!backendOn()) return { flushed: 0, left: pendingMirrors() };
  let q;
  try { q = coalesce(JSON.parse(localStorage.getItem(QKEY) || "[]")); } catch { q = []; }
  let flushed = 0;
  while (q.length) {
    const job = q[0];
    try {
      await api(job.path, job.opts);
      q.shift();
      flushed++;
    } catch (e) {
      if (e && e.status) {
        console.warn(`Vault sync: backend rejected queued ${job.opts?.method || "GET"} ${job.path} (${e.status}) — dropping it; local copy unaffected.`);
        q.shift();
        continue;
      }
      break;   // network failure — backend unreachable, retry later
    }
  }
  localStorage.setItem(QKEY, JSON.stringify(q));
  return { flushed, left: q.length };
}

export async function backendHealthy() {
  try { const r = await api("/health"); return !!r?.ok; } catch { return false; }
}

/* Full first-time sync: push the whole local vault via /sync/import,
 * then trigger RAG indexing. Idempotency is the caller's concern —
 * Settings gates this behind a "synced" flag. */
export async function fullSync() {
  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const snapshot = {
    items: read("vault.items.v1", []),
    todos: read("vault.todos.v1", {}),
    finance: read("vault.finance.v1", {}),
    boards: read("vault.boards.v1", {}),
    tags: read("vault.tags.v1", {}),
  };
  const res = await api("/sync/import", { method: "POST", body: snapshot });
  await api("/ai/reindex", { method: "POST" }).catch(() => {});
  setBackend({ syncedAt: new Date().toISOString() });
  return res;
}

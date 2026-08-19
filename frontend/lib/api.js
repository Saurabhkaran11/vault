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

/* Money crosses this API as INTEGER CENTS. The local working copy still
 * holds dollars (that is what the UI edits and displays), so every mapper
 * converts at the boundary and rounds exactly once, here — never mid-sum. */
export const toCents = (v) => Math.round((Number(v) || 0) * 100);
export const fromCents = (c) => (Number(c) || 0) / 100;

/* ---------------------------------------------------------------- IDENTITY
 *
 * Two ways to say who you are, matching the backend's two AUTH_MODEs:
 *
 *   Bearer token  — the real one. The backend verifies it against the
 *                   provider's JWKS and takes `sub` as the user id.
 *   X-User-Id     — the dev seam. Unverifiable, so the backend refuses to
 *                   run this way on a public origin.
 *
 * lib/api.js is not a React component, so it cannot call Clerk's useAuth()
 * hook itself. <AuthBridge> (components/AuthBridge.jsx) hands the getter
 * down once on mount; until something does, we fall back to the header and
 * the app behaves exactly as it did before auth existed. That fallback is
 * what keeps local development working with no Clerk keys at all.
 */
let tokenGetter = null;

export function setTokenGetter(fn) {
  tokenGetter = fn;
}

export function hasVerifiedIdentity() {
  return typeof tokenGetter === "function";
}

async function authHeaders() {
  if (tokenGetter) {
    try {
      const token = await tokenGetter();
      if (token) return { Authorization: `Bearer ${token}` };
    } catch {
      /* Signed out, or the token refresh failed. Fall through to the dev
         header rather than firing an un-authenticated request that the
         backend would reject anyway. */
    }
  }
  return { "X-User-Id": getBackend().userId || "demo" };
}

export async function api(path, { method = "GET", body } = {}) {
  const b = getBackend();
  const res = await fetch(`${b.url.replace(/\/$/, "")}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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

/* ---------------------------------------------------------------- READ PATH
 *
 * Until now sync only went one way: the browser pushed, and nothing ever
 * came back. That made the backend a write-only mirror — a second device
 * showed an empty vault even though every row was sitting in Postgres.
 *
 * pullAll() reverses it, translating the API's shapes back into the exact
 * localStorage shapes the stores expect: server `client_id` becomes the
 * item id, `*_cents` become dollars, board columns/cards nest the way
 * CustomBoards reads them.
 */
export async function pullAll() {
  const [items, tasks, boards, expenses, bills, incomes, payMethods, goals, summary, tagDir] = await Promise.all([
    api("/items?include_deleted=true"),   // the trash is part of the vault
    api("/todos"),
    api("/boards"),
    api("/finance/expenses"),
    api("/finance/bills"),
    api("/finance/incomes"),
    api("/finance/pay-methods"),
    api("/finance/goals"),
    api("/finance/summary"),
    api("/tags"),
  ]);

  const budgets = { overall: null, byCat: {} };
  for (const [scope, cents] of Object.entries(summary?.budgets_cents || {})) {
    if (scope === "overall") budgets.overall = fromCents(cents);
    else budgets.byCat[scope] = fromCents(cents);
  }

  return {
    items: items.map((i) => {
      /* client_id is the frontend's own id; numeric ids were Date.now(), so
         restore them as numbers or ordering and `+i.id > 1e12` checks break. */
      const cid = i.client_id ?? String(i.id);
      const out = {
        id: /^\d+$/.test(cid) ? Number(cid) : cid,
        type: i.type, title: i.title, meta: i.meta, url: i.url ?? undefined,
        cloud: i.cloud ?? undefined, status: i.status, tags: i.tags || [],
        folder: i.folder ?? undefined, alias: i.alias ?? undefined,
        pinned: !!i.pinned, progress: i.progress ?? undefined,
        blocks: i.blocks ?? undefined, links: i.links ?? undefined,
        date: i.added_on,
      };
      if (i.deleted_on) out.deleted = i.deleted_on;
      /* File BYTES never left the browser (metadata-only until the S3
         phase), so a pulled document knows its name and size but cannot be
         opened. Flag it so the UI can say so instead of showing a broken
         viewer. */
      if (i.file_meta) out.file = { ...i.file_meta, bodyMissing: true };
      return out;
    }),
    todos: {
      version: 2,
      tasks: tasks.map((t) => ({
        id: t.id, text: t.text, done: !!t.done, doneAt: t.done_at ?? undefined,
        due: t.due ?? undefined, high: !!t.high, label: t.label ?? undefined,
        created: t.created_on,
      })),
    },
    finance: {
      version: 2, seeded: true,
      expenses: expenses.map((e) => ({ id: e.id, desc: e.desc, amount: fromCents(e.amount_cents), cat: e.cat, pay: e.pay_method_id ?? undefined, date: e.spent_on })),
      bills: bills.map((b) => ({ id: b.id, title: b.title, amount: fromCents(b.amount_cents), due: b.due, paid: !!b.paid, paidOn: b.paid_on ?? undefined, recur: b.recur ?? null })),
      incomes: incomes.map((i) => ({ id: i.id, source: i.source, amount: fromCents(i.amount_cents), date: i.received_on })),
      payMethods: payMethods.map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
      goals: goals.map((g) => ({ id: g.id, name: g.name, target: fromCents(g.target_cents), saved: fromCents(g.saved_cents) })),
      budgets,
    },
    boards: {
      boards: boards.map((b) => ({
        id: b.id, name: b.name, seq: b.seq, current: b.current_sprint,
        sprints: (b.sprints || []).map((s) => ({ id: s.id, name: s.name, ended: s.ended_on ?? null })),
        cols: (b.columns || []).map((c) => ({
          id: c.id, title: c.title,
          cards: (c.cards || []).map((k) => ({
            id: k.id, num: k.num, text: k.text, desc: k.desc ?? undefined,
            hours: k.hours ?? undefined, labels: k.labels || [], sprint: k.sprint_id ?? undefined,
          })),
        })),
      })),
    },
    /* /tags returns a directory keyed by tag name; the user-created ones
       carry `custom: true`, in use or not. */
    tags: { custom: Object.entries(tagDir || {}).filter(([, v]) => v?.custom).map(([t]) => t) },
  };
}

/* Overwrite the local working copy with the server's state. This is a
 * deliberate, destructive restore — the caller confirms first. Returns
 * what landed so the UI can report it. */
export function applyPulled(data) {
  localStorage.setItem("vault.items.v1", JSON.stringify(data.items));
  localStorage.setItem("vault.todos.v1", JSON.stringify(data.todos));
  localStorage.setItem("vault.finance.v1", JSON.stringify(data.finance));
  localStorage.setItem("vault.boards.v1", JSON.stringify(data.boards));
  localStorage.setItem("vault.tags.v1", JSON.stringify(data.tags));
  setBackend({ pulledAt: new Date().toISOString() });
  return {
    items: data.items.length,
    tasks: data.todos.tasks.length,
    finance: data.finance.expenses.length + data.finance.bills.length + data.finance.incomes.length,
    boards: data.boards.boards.length,
  };
}

/* The new-device case: sync is on, the server has data, and this browser
 * has none. There is nothing local to lose, so hydrating is safe without
 * asking — it is what the user expects when they sign in somewhere new.
 * Any browser that already holds data is left alone and must restore
 * explicitly from Settings. */
export async function hydrateIfEmpty() {
  if (!backendOn()) return null;
  const localEmpty = (() => {
    try {
      const items = JSON.parse(localStorage.getItem("vault.items.v1") || "null");
      return !Array.isArray(items) || items.length === 0;
    } catch { return false; }
  })();
  if (!localEmpty) return null;
  const data = await pullAll();
  if (!data.items.length && !data.todos.tasks.length && !data.boards.boards.length) return null;
  return applyPulled(data);
}

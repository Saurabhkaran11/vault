"use client";

/* Whole-vault backup and restore.
 *
 * The previous version exported the items array alone. Everything else — every
 * to-do, the entire finance history, every kanban board and sprint, custom
 * tags — was silently absent, and the file looked perfectly valid. Restoring
 * it returned your notes and quietly discarded the rest. A backup that loses
 * four of five stores without saying so is worse than none, because it is
 * trusted.
 *
 * The file is a versioned envelope rather than a bare array, so a restore can
 * tell what it is holding, report what it is about to write, and refuse
 * anything it does not understand. Old array-shaped exports are still
 * accepted — people have them on disk — and are treated as items-only.
 */

import { getFile, putFile, blobToDataUrl, dataUrlToBlob } from "./fileStore";

export const BACKUP_VERSION = 3;   // v3: adds `files` — IndexedDB bodies by fid

/* Stores that are the user's DATA. Deliberately excluded: vault.backend.v1
 * (server URL and identity — machine-specific, and restoring it onto another
 * device would point them at the wrong account), vault.ai.v1 (holds an API
 * key; a backup file is not a place for credentials), and the retry queue,
 * which is transient by definition. vault.onboard.v1 and vault.notify.last
 * are per-browser state — where you are in the welcome checklist, when you
 * were last nudged — and restoring them onto another machine would be noise,
 * not data. */
export const BACKED_UP_STORES = [
  { key: "vault.items.v1", label: "items", fallback: [] },
  { key: "vault.todos.v1", label: "to-dos", fallback: {} },
  { key: "vault.finance.v1", label: "finance", fallback: {} },
  { key: "vault.boards.v1", label: "boards", fallback: {} },
  { key: "vault.tags.v1", label: "tags", fallback: {} },
  { key: "vault.calendar.v1", label: "calendar", fallback: {} },
  { key: "vault.keys.v1", label: "shortcuts", fallback: {} },
  { key: "vault.profile", label: "profile", fallback: {} },
];

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

/** Rough count of user-visible records, for honest "this holds N things" copy. */
export function countRecords(stores) {
  const items = stores["vault.items.v1"];
  const todos = stores["vault.todos.v1"];
  const fin = stores["vault.finance.v1"];
  const boards = stores["vault.boards.v1"];
  return {
    items: Array.isArray(items) ? items.length : 0,
    todos: Array.isArray(todos?.tasks) ? todos.tasks.length : 0,
    finance:
      (fin?.expenses?.length || 0) + (fin?.bills?.length || 0) +
      (fin?.incomes?.length || 0) + (fin?.goals?.length || 0),
    boards: Array.isArray(boards?.boards) ? boards.boards.length : 0,
    cards: (boards?.boards || []).reduce(
      (n, b) => n + (b.cols || []).reduce((m, c) => m + (c.cards?.length || 0), 0), 0),
  };
}

export async function buildBackup() {
  const stores = {};
  for (const s of BACKED_UP_STORES) stores[s.key] = read(s.key, s.fallback);

  /* File bodies live in IndexedDB (item.file.fid) — a backup that skipped
   * them would restore documents as names with nothing behind them. They
   * ride along base64-encoded, keyed by fid, so the export stays one file. */
  const files = {};
  const items = Array.isArray(stores["vault.items.v1"]) ? stores["vault.items.v1"] : [];
  for (const it of items) {
    const fid = it?.file?.fid;
    if (!fid || files[fid]) continue;
    try {
      const blob = await getFile(fid);
      if (blob) files[fid] = { type: blob.type, b64: await blobToDataUrl(blob) };
    } catch {} // an unreachable body is exported as details-only, same as sync
  }

  return {
    format: "vault-backup",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: countRecords(stores),
    stores,
    files,
  };
}

export async function downloadBackup() {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);      // Firefox ignores a click on a detached node
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return backup.counts;
}

/**
 * Read a backup file and describe it — WITHOUT writing anything.
 *
 * Restoring replaces the whole vault, so the user is shown what the file
 * holds and confirms before any of it lands. "Import" that overwrites on
 * click is how people lose data to a mis-clicked filename.
 */
export function inspectBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch {
        return reject(new Error("That is not a JSON file."));
      }

      // Pre-v2 exports were a bare items array.
      if (Array.isArray(data)) {
        const stores = { "vault.items.v1": data };
        return resolve({
          legacy: true,
          exportedAt: null,
          stores,
          counts: countRecords(stores),
        });
      }

      if (data?.format !== "vault-backup" || !data.stores) {
        return reject(new Error("That does not look like a Vault backup."));
      }
      if (data.version > BACKUP_VERSION) {
        return reject(new Error(
          `That backup was made by a newer version of Vault (v${data.version}). Update, then try again.`));
      }
      resolve({
        legacy: false,
        exportedAt: data.exportedAt || null,
        stores: data.stores,
        files: data.files || null,   // v3+: IndexedDB file bodies, keyed by fid
        counts: data.counts || countRecords(data.stores),
      });
    };
    reader.readAsText(file);
  });
}

/** Write an inspected backup into localStorage (+ file bodies into
 * IndexedDB). Caller has already confirmed. */
export async function applyBackup(inspected) {
  for (const s of BACKED_UP_STORES) {
    const value = inspected.stores[s.key];
    if (value === undefined) continue;   // absent in a legacy file — leave alone
    localStorage.setItem(s.key, JSON.stringify(value));
  }
  if (inspected.files) {
    for (const [fid, f] of Object.entries(inspected.files)) {
      try { await putFile(fid, dataUrlToBlob(f.b64)); } catch {}
    }
  }
  return inspected.counts;
}

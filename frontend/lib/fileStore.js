"use client";

/* File bodies in IndexedDB.
 *
 * localStorage gives the whole vault ~5 MB and forced file bodies to live as
 * base64 inside the items store — two documents and the vault was full.
 * IndexedDB stores real Blobs against the origin's quota (gigabytes), so the
 * item keeps only metadata plus a `fid` pointing here.
 *
 * Everything degrades: if IndexedDB is unavailable (some private windows),
 * callers fall back to the old small-base64 path. Bodies still ride along in
 * backups — lib/backup.js base64-encodes them into the export and restores
 * them here, so a backup file remains one self-contained document.
 */

const DB = "vault-files";
const STORE = "files";

let _db = null;
function openDb() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB unavailable"));
  });
  _db.catch(() => { _db = null; }); // allow a retry after a transient failure
  return _db;
}

const tx = (db, mode, run) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("aborted"));
  });

export async function idbAvailable() {
  try { await openDb(); return true; } catch { return false; }
}

/** Store a Blob under fid (overwrites). */
export async function putFile(fid, blob) {
  const db = await openDb();
  await tx(db, "readwrite", (s) => s.put(blob, fid));
}

/** The Blob for fid, or null. */
export async function getFile(fid) {
  const db = await openDb();
  const out = await tx(db, "readonly", (s) => s.get(fid));
  return out || null;
}

export async function deleteFile(fid) {
  try {
    const db = await openDb();
    await tx(db, "readwrite", (s) => s.delete(fid));
  } catch {} // deleting a body that isn't there is not an error
}

export async function listFids() {
  try {
    const db = await openDb();
    return (await tx(db, "readonly", (s) => s.getAllKeys())) || [];
  } catch { return []; }
}

/* ---- base64 bridges, for backups and the one-time migration ---- */

export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = (head.match(/^data:([^;]+)/) || [])[1] || "application/octet-stream";
  if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

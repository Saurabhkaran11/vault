"use client";

/* File bodies — browser ⇄ S3, brokered by the API.
 *
 * Until now uploaded bytes were read with FileReader and stored as a base64
 * data URL inside localStorage. That works offline and needs no server, but
 * it caps a whole vault at the browser's ~5–10 MB budget and means a document
 * only exists in the browser that saved it: restore on a second device and
 * you get a name and a size with nothing behind them.
 *
 * With S3 configured the bytes go straight from the browser to the bucket
 * using a presigned POST. They never pass through the API — which keeps large
 * uploads off the app servers, sidesteps the 5 MB request cap, and means a
 * slow upload can't occupy a worker. The item then stores an `s3_key` instead
 * of `data`.
 *
 * Both shapes coexist deliberately. Files saved before S3 was turned on keep
 * their `data` and keep working, so enabling storage is not a migration.
 */

import { api, backendOn } from "./api";

/* /files/status is stable for the life of a page load, and every upload and
 * every preview would otherwise ask again. */
let _enabled = null;

export function resetFileStorageCache() {
  _enabled = null;
}

export async function fileStorageEnabled() {
  if (!backendOn()) return false;
  if (_enabled !== null) return _enabled;
  try {
    const r = await api("/files/status");
    _enabled = !!r?.enabled;
  } catch {
    _enabled = false;   // unreachable backend → behave as local-only
  }
  return _enabled;
}

/* The local-only path: bytes become a data URL living in localStorage. */
export const LOCAL_MAX_BYTES = 2 * 1024 * 1024;

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error(`Could not read “${file.name}”`));
    r.readAsDataURL(file);
  });
}

/**
 * Store a File and return the `file` object to hang on the item.
 *
 * Returns `{ name, type, size, s3_key }` when it went to the bucket, or
 * `{ name, type, size, data }` when it stayed in this browser. The caller
 * doesn't need to care which — everything downstream reads whichever is set.
 */
export async function storeFile(clientId, file) {
  if (await fileStorageEnabled()) {
    try {
      return await uploadToBucket(clientId, file);
    } catch (err) {
      /* A failed upload must not lose the user's file. Fall back to the
       * browser if it fits, and say so — silently keeping it local would
       * leave them believing it had synced. */
      if (file.size <= LOCAL_MAX_BYTES) {
        return {
          name: file.name, type: file.type, size: file.size,
          data: await readAsDataUrl(file),
          localOnlyReason: err?.message || "Upload failed",
        };
      }
      throw err;
    }
  }

  if (file.size > LOCAL_MAX_BYTES) {
    const mb = (file.size / 1048576).toFixed(1);
    throw new Error(
      `“${file.name}” is ${mb} MB — the browser-only limit is 2 MB. ` +
      `Turn on file storage in Settings to keep files this large, or save a link to it instead.`
    );
  }
  return { name: file.name, type: file.type, size: file.size, data: await readAsDataUrl(file) };
}

async function uploadToBucket(clientId, file) {
  const signed = await api("/files/upload-url", {
    method: "POST",
    body: {
      client_id: String(clientId),
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      size: file.size || 0,   // the account storage quota is checked server-side
    },
  });

  if (signed.max_bytes && file.size > signed.max_bytes) {
    const mb = (signed.max_bytes / 1048576).toFixed(0);
    throw new Error(`“${file.name}” is larger than the ${mb} MB upload limit.`);
  }

  /* S3 presigned POST is strict about ordering: every policy field first,
   * the file LAST, or the upload is rejected. */
  const form = new FormData();
  Object.entries(signed.fields || {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);

  const res = await fetch(signed.url, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Upload rejected by storage (${res.status})`);
  }
  return { name: file.name, type: file.type, size: file.size, s3_key: signed.key };
}

/**
 * A URL the browser can actually render or download.
 *
 * Local files already are one. Bucket files need a short-lived signed link,
 * which the API only issues after checking the key belongs to the caller.
 * Returns null when the bytes are genuinely not reachable — a document
 * restored from a device that had storage switched off.
 */
export async function resolveFileUrl(file) {
  if (!file) return null;
  if (file.data) return file.data;
  if (file.s3_key) {
    const r = await api(`/files/download-url?key=${encodeURIComponent(file.s3_key)}`);
    return r?.url || null;
  }
  return null;
}

/** True when we know the name but can't reach the bytes from here. */
export const fileBodyMissing = (file) => !!file && !file.data && !file.s3_key;

/** Human file size. Small files must not read "0 KB" — a 71-byte note is
 *  not zero, and showing zero makes a working file look broken. */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

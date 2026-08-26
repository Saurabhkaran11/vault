"use client";

/* localStorage writes fail silently-by-exception when the ~5 MB quota fills —
 * the classic way a local-first app quietly loses a user's work. Every store
 * writes through safeSet, which turns a quota failure into a visible event
 * the app surfaces as a warning banner. */

export const STORAGE_FULL_EVENT = "vault:storage-full";

/** Write-through with quota detection. Returns false when the write failed. */
export function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    const quota = e && (e.name === "QuotaExceededError" || e.code === 22);
    console.warn("[vault] storage write failed", key, e);
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_FULL_EVENT, { detail: { key, quota } }));
    } catch { /* very old browsers */ }
    return false;
  }
}

/** Bytes currently used by vault data (UTF-16 approximation, like quotas). */
export function storageUsage() {
  try {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("vault.")) continue;
      bytes += (k.length + (localStorage.getItem(k) || "").length) * 2;
    }
    return bytes;
  } catch { return 0; }
}

/** ~5 MB is the common browser cap; warn while there is still room to act. */
export const STORAGE_WARN_BYTES = 4 * 1024 * 1024;

export const formatBytes = (n) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

"use client";

/* Standalone custom tags (vault.tags.v1): tags the user creates in the Tags
 * section before any item carries them. They show in the tag directory and
 * every tag picker; once an item adopts one it behaves like any other tag.
 * A custom tag can be removed while unused — after that, the tag lives on
 * the items themselves. */

const KEY = "vault.tags.v1";

export const normalizeTag = (raw) =>
  (raw || "").trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "").slice(0, 40);

export function getCustomTags() {
  try { return (JSON.parse(localStorage.getItem(KEY) || "{}").custom) || []; } catch { return []; }
}

export function addCustomTag(raw) {
  const t = normalizeTag(raw);
  if (!t) return getCustomTags();
  const next = [...new Set([...getCustomTags(), t])];
  localStorage.setItem(KEY, JSON.stringify({ version: 1, custom: next }));
  return next;
}

export function removeCustomTag(t) {
  const next = getCustomTags().filter((x) => x !== t);
  localStorage.setItem(KEY, JSON.stringify({ version: 1, custom: next }));
  return next;
}

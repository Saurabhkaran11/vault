"use client";

/* User-customizable single-key shortcuts (vault.keys.v1).
 * G-chords (navigation) and Ctrl+K stay fixed — they mirror section names
 * and platform convention. Everything here is rebindable in Settings. */

const KEY = "vault.keys.v1";

export const KEY_ACTIONS = [
  { id: "capture", label: "Quick capture", def: "c" },
  { id: "newItem", label: "New item (in current section)", def: "n" },
  { id: "search", label: "Focus the filter / search box", def: "/" },
  { id: "theme", label: "Toggle dark / light theme", def: "t" },
  { id: "sidebar", label: "Toggle the sidebar", def: "b" },
];

/* navigation chords: G, then one of these (own namespace — a nav key may
 * equal a single-key action because the G prefix disambiguates) */
export const NAV_ACTIONS = [
  { id: "navDash", label: "Dashboard", def: "d", view: "dash" },
  { id: "navBoard", label: "Projects", def: "p", view: "board" },
  { id: "navFinance", label: "Finance", def: "f", view: "finance" },
  { id: "navTodos", label: "Tasks", def: "t", view: "todos" },
  { id: "navGraph", label: "Graph", def: "r", view: "graph" },
  { id: "navContent", label: "Content (all saved items)", def: "c", view: "all" },
  { id: "navNotes", label: "· Notes", def: "n", view: "note" },
  { id: "navVideo", label: "· YouTube", def: "y", view: "video" },
  { id: "navBook", label: "· Library", def: "l", view: "book" },
  { id: "navDoc", label: "· Documents", def: "o", view: "doc" },
  { id: "navTags", label: "Tags", def: "a", view: "tags" },
];

export const DEFAULT_KEYS = Object.fromEntries(
  [...KEY_ACTIONS, ...NAV_ACTIONS].map((a) => [a.id, a.def])
);

/* keys with fixed meanings that a rebind may not steal */
export const RESERVED_KEYS = ["g", "?", "escape", "enter", "tab", " "];

const groupOf = (actionId) => (KEY_ACTIONS.some((a) => a.id === actionId) ? KEY_ACTIONS : NAV_ACTIONS);

export function getKeymap() {
  try { return { ...DEFAULT_KEYS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULT_KEYS }; }
}

export function setKeymap(patch) {
  const next = { ...getKeymap(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function resetKeymap() {
  localStorage.removeItem(KEY);
  return { ...DEFAULT_KEYS };
}

/* validate a candidate key for an action → error string or null.
 * Conflicts are checked within the action's own group: single keys clash
 * with single keys, nav keys with nav keys. */
export function validateKey(k, actionId, keymap) {
  const kl = k.toLowerCase();
  if (kl.length !== 1 || !/[a-z0-9;'\[\],.\/\\`=-]/.test(kl))
    return "Use a single letter, number or punctuation key.";
  if (RESERVED_KEYS.includes(kl))
    return `“${kl === " " ? "Space" : kl.toUpperCase()}” is reserved.`;
  const clash = groupOf(actionId).find((a) => a.id !== actionId && keymap[a.id] === kl);
  if (clash) return `Already used by “${clash.label}”.`;
  return null;
}

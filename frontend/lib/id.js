"use client";

/* The one place row ids are minted.
 *
 * These ids travel to the backend as the primary key for the row, and keys
 * there are unique across ALL accounts. The old generator —
 * `Math.random().toString(36).slice(2, 9)` — had roughly 78 billion values,
 * which sounds like plenty and is not: by the birthday bound, a vault-wide
 * total of 100k rows carries a ~6% chance of a collision and 1M rows makes
 * one virtually certain.
 *
 * A collision is not a security hole — the API refuses any id already owned
 * by another account (409) rather than handing over the row — but it is a
 * silent sync failure for whoever lost the race. UUIDv4's 122 bits of
 * entropy make that impossible in practice, which is the whole reason
 * offline-first systems mint UUIDs client-side.
 *
 * crypto.randomUUID needs a secure context (https, or localhost). The
 * fallback keeps the same 122-bit shape using getRandomValues, and only the
 * last resort — an ancient browser with neither — degrades to Math.random.
 */
export function uid() {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;   // version 4
    b[8] = (b[8] & 0x3f) | 0x80;   // variant 10
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export default uid;

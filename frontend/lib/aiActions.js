"use client";

/* CSS to merge into globals.css: none — this module renders no UI. */

import { askJSON } from "./ai";

/* Small, single-purpose AI actions. Each one sends a tightly-worded prompt,
 * then repairs whatever comes back — models (especially small local ones)
 * return capitalized tags, '#' prefixes, near-miss category names and
 * wrong-length arrays, so every output is normalized before a caller sees it.
 * Transport errors (no key, server down) propagate as AIError so the UI can
 * show its usual friendly message; malformed-but-successful output never throws.
 */

/* "machine learning" / "#ML" / "Machine_Learning" → "machine-learning" */
const kebab = (raw) =>
  String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/^#+/, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Suggest 3-5 tags for an item, preferring the vault's existing vocabulary
 * so one topic doesn't splinter into five spellings.
 * @param {{title?: string, meta?: string, url?: string, tags?: string[]}} item
 * @param {string[]} existingTags  every tag already used in the vault
 * @returns {Promise<string[]>} clean lowercase-kebab tags, ≤5, never ones the item already has
 */
export async function aiSuggestTags(item, existingTags = []) {
  const have = (item?.tags || []).map(kebab).filter(Boolean);
  const out = await askJSON(
    `Item to tag: "${item?.title || ""}"${item?.meta ? ` — ${item.meta}` : ""}${item?.url ? ` (${item.url})` : ""}.\n` +
      `Existing tags in this vault: ${existingTags.join(", ") || "none yet"}.\n` +
      `Tags already on this item (never repeat these): ${have.join(", ") || "none"}.\n` +
      `Suggest 3-5 topic tags, each a short lowercase-kebab-case word or phrase. ` +
      `STRONGLY prefer reusing the existing vault tags when they fit; invent a new tag only when nothing existing applies.`,
    {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
      required: ["tags"],
      additionalProperties: false,
    },
    { effort: "low", maxTokens: 2000 }
  );
  const seen = new Set(have); // dedupe against the item AND within the batch
  const clean = [];
  for (const t of Array.isArray(out?.tags) ? out.tags : []) {
    const k = kebab(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    clean.push(k);
    if (clean.length === 5) break;
  }
  return clean;
}

/* keep the repair prompt (and the reply we must parse) bounded — beyond this
 * many rows the tail just gets the fallback category */
const CAT_MAX_ROWS = 300;

/**
 * Repair pass for statement-import rows that came through without a usable
 * category: ask the model to pick one per row from the given enum.
 * @param {{name?: string, amount?: number, date?: string}[]} rows
 * @param {string[]} categories  the allowed category names, e.g. ["Food", …, "Other"]
 * @returns {Promise<string[]>} one category per input row, aligned by index,
 *   every entry guaranteed to be a member of `categories`
 */
export async function aiCategorize(rows = [], categories = []) {
  const fallback = categories.includes("Other") ? "Other" : categories[0] || "Other";
  if (!rows.length || !categories.length) return rows.map(() => fallback);

  const head = rows.slice(0, CAT_MAX_ROWS);
  const list = head
    .map((r, i) => `${i}. ${r?.name || "Transaction"} — ${r?.amount ?? "?"} on ${r?.date || "?"}`)
    .join("\n");
  const out = await askJSON(
    `Categorize these transactions. Reply with a "categories" array of exactly ${head.length} strings, ` +
      `one per numbered transaction in order, each EXACTLY one of: ${categories.join(", ")}.\n\n${list}`,
    {
      type: "object",
      properties: {
        categories: { type: "array", items: { type: "string", enum: categories } },
      },
      required: ["categories"],
      additionalProperties: false,
    },
    { effort: "low", maxTokens: 6000 }
  );

  /* schema enforcement is best-effort on OSS/server paths, so re-validate:
   * case-insensitive match back to the canonical name, fallback otherwise,
   * and force the array to the caller's length however long the reply was */
  const canon = new Map(categories.map((c) => [String(c).trim().toLowerCase(), c]));
  const raw = Array.isArray(out?.categories) ? out.categories : [];
  return rows.map((_, i) =>
    i < head.length ? canon.get(String(raw[i] ?? "").trim().toLowerCase()) || fallback : fallback
  );
}

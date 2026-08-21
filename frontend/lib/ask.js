"use client";

/* Retrieval and answer shaping for "Ask your Vault".
 *
 * Two retrieval paths, deliberately:
 *
 *   SERVER (sync on) — pgvector over embeddings, including text extracted
 *   from uploaded PDFs and Word files. This is the only path that can answer
 *   questions about a document's CONTENTS, because those bytes were never in
 *   the browser. It also understands meaning rather than shared words.
 *
 *   LOCAL (sync off) — term-overlap scoring over whatever localStorage holds.
 *   Keyword matching, and blind to uploaded documents, but it keeps the
 *   feature working offline, which is the whole premise of the app.
 *
 * The UI picks automatically and says which one answered, because "I couldn't
 * find that" means something very different in each case.
 */

import { api, backendOn } from "./api";

/* ---------------------------------------------------------------- scopes */

export const SCOPES = [
  { id: "all", label: "Everything", types: [], hint: "notes, videos, books and documents" },
  { id: "doc", label: "Documents", types: ["doc"], hint: "only uploaded and linked files" },
  { id: "note", label: "Notes", types: ["note"], hint: "only your written notes" },
  { id: "book", label: "Library", types: ["book"], hint: "only saved reading" },
  { id: "video", label: "YouTube", types: ["video"], hint: "only saved videos" },
  /* These two are not item kinds — they filter on the embedding's source_type,
     because to-dos and cards live in their own tables. */
  { id: "task", label: "To-dos", types: ["task"], hint: "only your to-do list" },
  { id: "card", label: "Boards", types: ["card"], hint: "only kanban cards" },
];

/* --------------------------------------------------------------- formats */

export const FORMATS = [
  {
    id: "prose",
    label: "Paragraph",
    instruction: "Answer in flowing prose — two or three short paragraphs at most.",
  },
  {
    id: "bullets",
    label: "Bullet points",
    instruction:
      "Answer as a bulleted list. One idea per bullet, each on a single line beginning with '- '. " +
      "No preamble before the list and no summary after it.",
  },
  {
    id: "brief",
    label: "Short answer",
    instruction:
      "Answer in at most two sentences. Lead with the answer itself — no restating the question, " +
      "no hedging, no closing summary.",
  },
  {
    id: "notes",
    label: "Study notes",
    instruction:
      "Answer as structured notes: short '## ' headings with '- ' bullets beneath each. " +
      "Group related points together rather than following the order of the sources.",
  },
  {
    id: "steps",
    label: "Step by step",
    instruction:
      "Answer as a numbered sequence of concrete steps, in the order they should be done. " +
      "One action per step.",
  },
];

export const formatById = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

/* ------------------------------------------------------------- retrieval */

/**
 * Ask the backend which parts of the vault are relevant.
 * Returns server sources, each already carrying the matched text.
 */
export async function retrieveFromServer(question, { scope = "all", itemIds = [], k = 8 } = {}) {
  const types = SCOPES.find((s) => s.id === scope)?.types || [];
  const res = await api("/ai/ask", {
    method: "POST",
    body: { question, k, types, item_ids: itemIds },
  });
  return res?.sources || [];
}

export const canUseServerSearch = () => backendOn();

/**
 * Build the prompt sent to the model.
 *
 * Kept here rather than taking the backend's assembled `prompt`, because the
 * requested format has to be part of it and format is a UI concern. The
 * citation contract is the important half: every claim carries a [n] the
 * reader can click back to, which is what stops an answer being an
 * unfalsifiable summary.
 */
export function buildPrompt(question, sources, formatId) {
  const numbered = sources
    .map((s, i) => `[${i + 1}] (${s.type}) ${s.title}\n${s.chunk}`)
    .join("\n\n---\n\n");

  return {
    system:
      "You answer questions about the user's personal vault using ONLY the numbered sources given. " +
      "Cite inline as [1], [2] immediately after each claim they support. " +
      "If the sources do not contain the answer, say exactly that and name what is missing — " +
      "never fill the gap from general knowledge. " +
      formatById(formatId).instruction,
    user: `SOURCES:\n\n${numbered}\n\nQUESTION: ${question}`,
  };
}

/* ------------------------------------------------------------- catalogue
 *
 * "List all my documents" is not a similarity question, and running it
 * through retrieval gives a confidently wrong answer: the search returns the
 * top k chunks by relevance — 8 by default — so with 200 documents the model
 * is handed 8, lists those, and presents them as the complete set. No choice
 * of model fixes that, because the rest was never retrieved.
 *
 * Enumeration is a database query. Answering it directly is complete, exact,
 * instant, and free — and it can show fields like tags that a prose answer
 * routinely drops.
 */

const LISTING_VERB = /\b(list|show|give|provide|display|enumerate|what)\b/i;
const LISTING_SCOPE = /\b(all|every|each|my)\b/i;
const LISTING_NOUN = /\b(doc|docs|document|documents|file|files|note|notes|video|videos|book|books|item|items|bookmark|bookmarks)\b/i;

/** Does this read as "give me the list", rather than a question about content? */
export function isListingQuestion(q) {
  const s = (q || "").trim();
  if (!s) return false;
  // "what does my resume say about X" is about content, not a list.
  if (/\b(say|says|mention|explain|why|how|when|summar|compare|difference)\b/i.test(s)) return false;
  return LISTING_VERB.test(s) && LISTING_SCOPE.test(s) && LISTING_NOUN.test(s);
}

/** The complete, scoped list — no model, no ranking, no truncation. */
export function catalogue(items, scope = "all") {
  const types = SCOPES.find((s) => s.id === scope)?.types || [];
  /* Listing is served from the items store, which has no to-dos or cards —
     those sections own their own data. Returning an empty table would read as
     "you have none", so the caller is told to look elsewhere instead. */
  if (types.some((t) => t === "task" || t === "card")) return null;
  return items
    .filter((i) => !i.deleted && (!types.length || types.includes(i.type)))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map((i) => ({
      id: i.id,
      title: i.alias || i.title || "(untitled)",
      type: i.type,
      tags: i.tags || [],
      date: i.date,
      local: true,
    }));
}

/* --------------------------------------------------------------- finance
 *
 * Money questions were unanswerable for a reason that no prompt or model
 * could fix: finance rows are not in the RAG index at all. It holds notes,
 * videos, books and documents — so "where did I overspend?" retrieved
 * whatever prose was least unrelated and answered from that.
 *
 * They are also the wrong shape for retrieval even in principle. "Where did I
 * overspend" is arithmetic over every expense against every budget: a
 * complete, exact calculation, not a similarity match. Asking a language
 * model to total 200 rows invites quiet arithmetic errors in the one place
 * users can least afford them.
 *
 * So the numbers are computed here and handed to the model as facts. It does
 * what it is actually good at — ordering, explaining, advising — on top of
 * arithmetic that is already correct.
 */

const FINANCE_RE = /\b(spend|spent|spending|overspend|overspent|budget|budgets|expense|expenses|money|cost|costs|afford|finance|financial|bill|bills|income|savings?|save|cash)\b/i;

export const isFinanceQuestion = (q) => FINANCE_RE.test(q || "");

const money = (cents) => (cents / 100);

/**
 * Per-category spend against budget for a month, plus the totals that decide
 * what to deal with first. Reads the same local store the Finance section
 * renders, so the two can never disagree.
 */
export function financeAnalysis(month) {
  let fin = {};
  try { fin = JSON.parse(localStorage.getItem("vault.finance.v1") || "{}"); } catch { fin = {}; }

  const ym = month || new Date().toISOString().slice(0, 7);
  const inMonth = (d) => String(d || "").startsWith(ym);

  const expenses = (fin.expenses || []).filter((e) => inMonth(e.date));
  const incomes = (fin.incomes || []).filter((i) => inMonth(i.date));
  const budgets = fin.budgets || { overall: null, byCat: {} };

  const spentByCat = {};
  for (const e of expenses) {
    const c = e.cat || "Other";
    spentByCat[c] = (spentByCat[c] || 0) + Math.round((+e.amount || 0) * 100);
  }

  const rows = Object.entries(spentByCat).map(([cat, spentCents]) => {
    const capCents = budgets.byCat?.[cat] ? Math.round(budgets.byCat[cat] * 100) : null;
    const diff = capCents === null ? null : spentCents - capCents;
    return {
      category: cat,
      spent: money(spentCents),
      budget: capCents === null ? null : money(capCents),
      difference: diff === null ? null : money(diff),
      pctUsed: capCents ? Math.round((spentCents / capCents) * 100) : null,
      status: capCents === null ? "no budget set" : diff > 0 ? "over" : "within",
    };
  });

  /* Worst overspend first — that is the thing to deal with. Categories with
     no budget sort last: not a problem, just unmeasured. */
  rows.sort((a, b) => {
    const av = a.difference ?? -Infinity, bv = b.difference ?? -Infinity;
    return bv - av;
  });

  const totalSpent = Object.values(spentByCat).reduce((a, b) => a + b, 0);
  const totalIncome = incomes.reduce((a, i) => a + Math.round((+i.amount || 0) * 100), 0);
  const overallCap = budgets.overall ? Math.round(budgets.overall * 100) : null;
  const unpaidBills = (fin.bills || []).filter((b) => !b.paid);

  return {
    month: ym,
    rows,
    totals: {
      spent: money(totalSpent),
      income: money(totalIncome),
      budget: overallCap === null ? null : money(overallCap),
      difference: overallCap === null ? null : money(totalSpent - overallCap),
      unpaidBills: unpaidBills.length,
      unpaidTotal: money(unpaidBills.reduce((a, b) => a + Math.round((+b.amount || 0) * 100), 0)),
    },
    overspent: rows.filter((r) => r.status === "over"),
    unbudgeted: rows.filter((r) => r.status === "no budget set"),
  };
}

/** Computed facts for the model — so advice sits on correct arithmetic. */
export function financeFacts(a) {
  const line = (r) =>
    `${r.category}: spent ${r.spent.toFixed(2)}` +
    (r.budget === null ? ", no budget set" :
      `, budget ${r.budget.toFixed(2)}, ${r.difference > 0 ? "OVER by " : "under by "}${Math.abs(r.difference).toFixed(2)} (${r.pctUsed}% used)`);

  return [
    `Month: ${a.month}`,
    `Total spent: ${a.totals.spent.toFixed(2)}`,
    `Total income: ${a.totals.income.toFixed(2)}`,
    a.totals.budget === null ? "No overall budget set."
      : `Overall budget ${a.totals.budget.toFixed(2)} — ${a.totals.difference > 0 ? "OVER" : "under"} by ${Math.abs(a.totals.difference).toFixed(2)}`,
    `Unpaid bills: ${a.totals.unpaidBills} totalling ${a.totals.unpaidTotal.toFixed(2)}`,
    "",
    "Per category:",
    ...a.rows.map(line),
  ].join("\n");
}

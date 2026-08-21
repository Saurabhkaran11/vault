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

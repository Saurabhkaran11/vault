import { describe, it, expect, vi, beforeEach } from "vitest";

// ask.js imports the API client at module scope; the pure functions under
// test never call it, so a light stub keeps the suite offline and isolated.
vi.mock("@/lib/api", () => ({ api: vi.fn(), backendOn: () => false }));

import {
  SCOPES, FORMATS, formatById, buildPrompt, isListingQuestion,
  catalogue, isFinanceQuestion, financeAnalysis, financeFacts,
} from "./ask";

describe("isListingQuestion", () => {
  it("recognises enumeration requests", () => {
    expect(isListingQuestion("list all my documents")).toBe(true);
    expect(isListingQuestion("show me every note")).toBe(true);
    expect(isListingQuestion("what are all my videos")).toBe(true);
  });

  it("rejects content questions that merely mention a noun", () => {
    expect(isListingQuestion("what does my resume say about React")).toBe(false);
    expect(isListingQuestion("summarise my notes on auth")).toBe(false);
    expect(isListingQuestion("why did I save this video")).toBe(false);
  });

  it("rejects empty/blank input", () => {
    expect(isListingQuestion("")).toBe(false);
    expect(isListingQuestion("   ")).toBe(false);
    expect(isListingQuestion(null)).toBe(false);
  });
});

describe("catalogue", () => {
  const items = [
    { id: 1, title: "Note A", type: "note", tags: ["x"], date: "2026-01-01" },
    { id: 2, title: "Doc B", type: "doc", tags: [], date: "2026-03-01" },
    { id: 3, alias: "Aliased", title: "Doc C", type: "doc", tags: [], date: "2026-02-01" },
    { id: 4, title: "Deleted", type: "doc", tags: [], date: "2026-09-01", deleted: true },
  ];

  it("returns every non-deleted item for scope 'all', newest first", () => {
    const rows = catalogue(items, "all");
    expect(rows.map((r) => r.id)).toEqual([2, 3, 1]); // deleted excluded, date desc
  });

  it("filters by scope type", () => {
    const rows = catalogue(items, "doc");
    expect(rows.every((r) => r.type === "doc")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("prefers alias over title", () => {
    const row = catalogue(items, "doc").find((r) => r.id === 3);
    expect(row.title).toBe("Aliased");
  });

  it("returns null for scopes served by other tables (task/card)", () => {
    expect(catalogue(items, "task")).toBeNull();
    expect(catalogue(items, "card")).toBeNull();
  });
});

describe("isFinanceQuestion", () => {
  it("matches money vocabulary", () => {
    expect(isFinanceQuestion("where did I overspend?")).toBe(true);
    expect(isFinanceQuestion("what is my budget for food")).toBe(true);
    expect(isFinanceQuestion("how much did I save")).toBe(true);
  });
  it("does not match unrelated questions", () => {
    expect(isFinanceQuestion("what did I learn about React")).toBe(false);
  });
});

describe("financeAnalysis + financeFacts", () => {
  beforeEach(() => {
    localStorage.setItem("vault.finance.v1", JSON.stringify({
      expenses: [
        { amount: 300, cat: "Food", date: "2026-08-05" },
        { amount: 250, cat: "Food", date: "2026-08-20" },
        { amount: 100, cat: "Travel", date: "2026-08-10" },
        { amount: 999, cat: "Food", date: "2026-07-01" }, // different month, excluded
      ],
      incomes: [{ amount: 2000, date: "2026-08-01" }],
      bills: [{ amount: 80, paid: false }, { amount: 40, paid: true }],
      budgets: { overall: 500, byCat: { Food: 400 } },
    }));
  });

  it("computes per-month, per-category spend against budget", () => {
    const a = financeAnalysis("2026-08");
    expect(a.month).toBe("2026-08");
    expect(a.totals.spent).toBe(650);          // 300+250+100, July excluded
    expect(a.totals.income).toBe(2000);
    expect(a.totals.difference).toBe(150);     // 650 - 500 overall budget => over by 150

    const food = a.rows.find((r) => r.category === "Food");
    expect(food.spent).toBe(550);
    expect(food.budget).toBe(400);
    expect(food.difference).toBe(150);         // over by 150
    expect(food.status).toBe("over");

    const travel = a.rows.find((r) => r.category === "Travel");
    expect(travel.status).toBe("no budget set");
  });

  it("sorts worst overspend first and reports unpaid bills", () => {
    const a = financeAnalysis("2026-08");
    expect(a.rows[0].category).toBe("Food");   // biggest positive difference
    expect(a.overspent.map((r) => r.category)).toContain("Food");
    expect(a.totals.unpaidBills).toBe(1);
    expect(a.totals.unpaidTotal).toBe(80);
  });

  it("renders facts as a stable text block for the model", () => {
    const facts = financeFacts(financeAnalysis("2026-08"));
    expect(facts).toContain("Total spent: 650.00");
    expect(facts).toContain("Food: spent 550.00");
    expect(facts).toContain("OVER by 150.00");
  });

  it("includes all-time category totals so cross-period questions work", () => {
    const facts = financeFacts(financeAnalysis("2026-08"));
    expect(facts).toContain("All-time spending");
    // Food all-time = 300 + 250 (Aug) + 999 (Jul) = 1549
    expect(facts).toContain("Food: 1549.00");
  });

  it("handles an empty finance store without throwing", () => {
    localStorage.clear();
    const a = financeAnalysis("2026-08");
    expect(a.totals.spent).toBe(0);
    expect(a.rows).toHaveLength(0);
  });
});

describe("prompt scaffolding", () => {
  it("formatById falls back to the first format for unknown ids", () => {
    expect(formatById("nope")).toBe(FORMATS[0]);
    expect(formatById("bullets").id).toBe("bullets");
  });

  it("buildPrompt numbers sources and demands citation-only answers", () => {
    const { system, user } = buildPrompt(
      "What is X?",
      [{ type: "note", title: "T1", chunk: "chunk one" }, { type: "doc", title: "T2", chunk: "chunk two" }],
      "brief",
    );
    expect(user).toContain("[1] (note) T1");
    expect(user).toContain("[2] (doc) T2");
    expect(user).toContain("QUESTION: What is X?");
    expect(system).toMatch(/ONLY the numbered sources/i);
  });

  it("every scope has an id and label", () => {
    for (const s of SCOPES) {
      expect(s.id).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });
});

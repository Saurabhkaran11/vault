import { describe, it, expect, beforeEach } from "vitest";
import {
  BACKUP_VERSION, BACKED_UP_STORES, buildBackup, inspectBackup,
  applyBackup, countRecords,
} from "./backup";

/* A File-like wrapper so inspectBackup's FileReader has something to read. */
const asFile = (obj) =>
  new File([typeof obj === "string" ? obj : JSON.stringify(obj)], "backup.json", { type: "application/json" });

const seedStores = () => {
  localStorage.setItem("vault.items.v1", JSON.stringify([{ id: 1 }, { id: 2 }]));
  localStorage.setItem("vault.todos.v1", JSON.stringify({ tasks: [{ id: "t1" }] }));
  localStorage.setItem("vault.finance.v1", JSON.stringify({ expenses: [{}, {}], bills: [{}], incomes: [], goals: [] }));
  localStorage.setItem("vault.boards.v1", JSON.stringify({
    boards: [{ id: "b1", cols: [{ cards: [{}, {}] }, { cards: [{}] }] }],
  }));
  // A store that must NOT be backed up.
  localStorage.setItem("vault.ai.v1", JSON.stringify({ key: "secret-api-key" }));
};

describe("buildBackup", () => {
  beforeEach(seedStores);

  it("captures every data store, not just items", () => {
    const b = buildBackup();
    expect(b.format).toBe("vault-backup");
    expect(b.version).toBe(BACKUP_VERSION);
    for (const s of BACKED_UP_STORES) expect(b.stores).toHaveProperty(s.key);
  });

  it("never includes the AI key store", () => {
    const b = buildBackup();
    expect(b.stores).not.toHaveProperty("vault.ai.v1");
    expect(JSON.stringify(b)).not.toContain("secret-api-key");
  });

  it("counts records across stores", () => {
    const c = buildBackup().counts;
    expect(c).toMatchObject({ items: 2, todos: 1, finance: 3, boards: 1, cards: 3 });
  });
});

describe("countRecords", () => {
  it("is defensive about missing/oddly-shaped stores", () => {
    const c = countRecords({});
    expect(c).toMatchObject({ items: 0, todos: 0, finance: 0, boards: 0, cards: 0 });
  });
});

describe("inspectBackup", () => {
  it("reads a v2 envelope without writing anything", async () => {
    seedStores();
    const backup = buildBackup();
    localStorage.clear();
    const result = await inspectBackup(asFile(backup));
    expect(result.legacy).toBe(false);
    expect(result.counts.items).toBe(2);
    // inspect must not mutate storage
    expect(localStorage.getItem("vault.items.v1")).toBeNull();
  });

  it("treats a bare array as a legacy items-only export", async () => {
    const result = await inspectBackup(asFile([{ id: 1 }, { id: 2 }, { id: 3 }]));
    expect(result.legacy).toBe(true);
    expect(result.stores["vault.items.v1"]).toHaveLength(3);
    expect(result.counts.items).toBe(3);
  });

  it("rejects non-JSON", async () => {
    await expect(inspectBackup(asFile("not json at all {"))).rejects.toThrow(/not a JSON/i);
  });

  it("rejects a JSON file that is not a vault backup", async () => {
    await expect(inspectBackup(asFile({ hello: "world" }))).rejects.toThrow(/not look like a Vault backup/i);
  });

  it("refuses a backup from a newer version", async () => {
    await expect(inspectBackup(asFile({ format: "vault-backup", version: BACKUP_VERSION + 1, stores: {} })))
      .rejects.toThrow(/newer version/i);
  });
});

describe("applyBackup", () => {
  it("round-trips: build -> clear -> inspect -> apply restores the data", async () => {
    seedStores();
    const backup = buildBackup();
    localStorage.clear();
    const inspected = await inspectBackup(asFile(backup));
    applyBackup(inspected);
    expect(JSON.parse(localStorage.getItem("vault.items.v1"))).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("vault.boards.v1")).boards).toHaveLength(1);
  });

  it("leaves stores absent from a legacy file untouched", async () => {
    localStorage.setItem("vault.boards.v1", JSON.stringify({ boards: [{ id: "keep" }] }));
    const inspected = await inspectBackup(asFile([{ id: 1 }]));
    applyBackup(inspected);
    expect(JSON.parse(localStorage.getItem("vault.items.v1"))).toHaveLength(1);
    // boards were not in the legacy file, so they must survive
    expect(JSON.parse(localStorage.getItem("vault.boards.v1")).boards[0].id).toBe("keep");
  });
});

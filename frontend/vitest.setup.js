import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/* jsdom disables Storage under an opaque origin and doesn't reliably expose a
 * global `localStorage` in this vitest/jsdom combo, so install a tiny
 * in-memory implementation the vault modules can read and write. */
if (typeof globalThis.localStorage === "undefined") {
  class MemoryStorage {
    #m = new Map();
    get length() { return this.#m.size; }
    key(i) { return Array.from(this.#m.keys())[i] ?? null; }
    getItem(k) { return this.#m.has(String(k)) ? this.#m.get(String(k)) : null; }
    setItem(k, v) { this.#m.set(String(k), String(v)); }
    removeItem(k) { this.#m.delete(String(k)); }
    clear() { this.#m.clear(); }
  }
  const store = new MemoryStorage();
  globalThis.localStorage = store;
  if (typeof window !== "undefined") window.localStorage = store;
}

/* Each test starts clean: unmount rendered trees and wipe storage so no test
 * leaks state into the next one. */
afterEach(() => {
  cleanup();
  localStorage.clear();
});

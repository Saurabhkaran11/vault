import { describe, it, expect } from "vitest";
import { uid } from "./id";

describe("uid", () => {
  it("returns a non-empty string", () => {
    expect(typeof uid()).toBe("string");
    expect(uid().length).toBeGreaterThan(0);
  });

  it("is collision-free across many calls", () => {
    const seen = new Set();
    for (let i = 0; i < 10000; i++) seen.add(uid());
    expect(seen.size).toBe(10000);
  });
});

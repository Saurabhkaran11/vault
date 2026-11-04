import { describe, it, expect } from "vitest";

// ai.js imports the Anthropic SDK and the API client at module scope; neither
// touches the network on import, and the config helpers under test only use
// localStorage, so a light API stub is all that's needed.
import { vi } from "vitest";
vi.mock("@/lib/api", () => ({ api: vi.fn(), backendOn: () => false }));

import {
  AI_MODELS, OSS_PRESETS, presetById, getAIConfig, setAIConfig, aiEnabled, stripReasoning, askText,
} from "./ai";

describe("stripReasoning", () => {
  it("removes a <think> reasoning block, keeps the answer", () => {
    expect(stripReasoning("<think>let me work it out step by step</think>You spent $42 on Food.")).toBe("You spent $42 on Food.");
  });
  it("removes <thinking> blocks too", () => {
    expect(stripReasoning("<thinking>hmm</thinking>\n\nThe answer.")).toBe("The answer.");
  });
  it("leaves a clean answer untouched", () => {
    expect(stripReasoning("You spent $42 on Food.")).toBe("You spent $42 on Food.");
  });
});

describe("provider presets", () => {
  it("every OSS preset is well-formed", () => {
    for (const p of OSS_PRESETS) {
      expect(p.id, "id").toBeTruthy();
      expect(p.label, `label for ${p.id}`).toBeTruthy();
      expect(p.url, `url for ${p.id}`).toMatch(/^https?:\/\//);
      expect(Array.isArray(p.models) && p.models.length, `models for ${p.id}`).toBeTruthy();
      // A hosted provider needs a key and should say where to get one.
      if (p.needsKey) expect(p.keyUrl, `keyUrl for ${p.id}`).toMatch(/^https?:\/\//);
    }
  });

  it("preset ids are unique", () => {
    const ids = OSS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the open models the user asked for (gemma via ollama, mistral)", () => {
    expect(presetById("ollama").models.some((m) => /gemma/i.test(m))).toBe(true);
    expect(presetById("mistral")).toBeTruthy();
  });

  it("presetById returns undefined for an unknown id", () => {
    expect(presetById("does-not-exist")).toBeUndefined();
  });

  it("lists Claude models with a recommended default", () => {
    expect(AI_MODELS[0].id).toBe("claude-opus-5");
  });
});

describe("AI config", () => {
  it("defaults to Anthropic + Opus when nothing is stored", () => {
    expect(getAIConfig()).toMatchObject({ provider: "anthropic", model: "claude-opus-5" });
  });

  it("setAIConfig merges, persists settings and keeps keys in memory only", () => {
    setAIConfig({ apiKey: "sk-test" });
    setAIConfig({ model: "claude-sonnet-5" });
    const c = getAIConfig();
    expect(c.apiKey).toBe("sk-test");    // earlier patch survives
    expect(c.model).toBe("claude-sonnet-5");
    expect(localStorage.getItem("vault.ai.v1")).toContain("claude-sonnet-5");
    expect(localStorage.getItem("vault.ai.v1")).not.toContain("sk-test");
    setAIConfig({ apiKey: undefined });
  });

  it("removes a key an older version saved to localStorage", () => {
    localStorage.setItem("vault.ai.v1", JSON.stringify({ apiKey: "sk-old", model: "claude-sonnet-5" }));
    expect(getAIConfig().apiKey).toBeUndefined();
    expect(localStorage.getItem("vault.ai.v1")).not.toContain("sk-old");
  });

  it("refuses to send a key to a URL that is not a built-in provider", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    setAIConfig({ provider: "oss", ossBaseUrl: "https://evil.example/v1", ossModel: "m", ossKey: "sk-x" });
    await expect(askText("hi")).rejects.toMatchObject({ code: "no_key" });
    expect(f).not.toHaveBeenCalled();
    setAIConfig({ ossKey: undefined });
    vi.unstubAllGlobals();
  });

  it("aiEnabled requires a key for Anthropic and url+model for a custom server", () => {
    expect(aiEnabled()).toBe(false);
    setAIConfig({ provider: "anthropic", apiKey: "sk-x" });
    expect(aiEnabled()).toBe(true);
    setAIConfig({ apiKey: undefined });

    setAIConfig({ provider: "oss", apiKey: "", ossBaseUrl: "", ossModel: "" });
    expect(aiEnabled()).toBe(false);
    setAIConfig({ ossBaseUrl: "http://localhost:11434/v1", ossModel: "gemma2:9b" });
    expect(aiEnabled()).toBe(true);
  });
});

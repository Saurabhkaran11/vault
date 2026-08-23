import { describe, it, expect } from "vitest";

// ai.js imports the Anthropic SDK and the API client at module scope; neither
// touches the network on import, and the config helpers under test only use
// localStorage, so a light API stub is all that's needed.
import { vi } from "vitest";
vi.mock("@/lib/api", () => ({ api: vi.fn(), backendOn: () => false }));

import {
  AI_MODELS, OSS_PRESETS, presetById, getAIConfig, setAIConfig, aiEnabled, stripReasoning,
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

  it("setAIConfig merges and persists", () => {
    setAIConfig({ apiKey: "sk-test" });
    setAIConfig({ model: "claude-sonnet-5" });
    const c = getAIConfig();
    expect(c.apiKey).toBe("sk-test");    // earlier patch survives
    expect(c.model).toBe("claude-sonnet-5");
  });

  it("aiEnabled requires a key for Anthropic and url+model for a custom server", () => {
    expect(aiEnabled()).toBe(false);
    setAIConfig({ provider: "anthropic", apiKey: "sk-x" });
    expect(aiEnabled()).toBe(true);

    setAIConfig({ provider: "oss", apiKey: "", ossBaseUrl: "", ossModel: "" });
    expect(aiEnabled()).toBe(false);
    setAIConfig({ ossBaseUrl: "http://localhost:11434/v1", ossModel: "gemma2:9b" });
    expect(aiEnabled()).toBe(true);
  });
});

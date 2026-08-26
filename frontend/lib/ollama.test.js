import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ollama.js reads the AI config for root derivation; ai.js needs its API stub.
vi.mock("@/lib/api", () => ({ api: vi.fn(), backendOn: () => false }));

import { setAIConfig } from "./ai";
import {
  ollamaRoot, ollamaUp, pullModel, CURATED, humanSize, isEmbedModel,
} from "./ollama";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("ollamaRoot", () => {
  it("defaults to localhost when nothing points at Ollama", () => {
    expect(ollamaRoot()).toBe("http://localhost:11434");
  });

  it("ignores a non-Ollama OSS server (LM Studio)", () => {
    setAIConfig({ provider: "oss", ossBaseUrl: "http://localhost:1234/v1" });
    expect(ollamaRoot()).toBe("http://localhost:11434");
  });

  it("strips /v1 from a configured Ollama URL (port signal)", () => {
    setAIConfig({ provider: "oss", ossBaseUrl: "http://192.168.1.7:11434/v1" });
    expect(ollamaRoot()).toBe("http://192.168.1.7:11434");
  });

  it("strips /v1 when the preset says ollama, whatever the port", () => {
    setAIConfig({ provider: "oss", ossPreset: "ollama", ossBaseUrl: "http://myhost:8080/v1/" });
    expect(ollamaRoot()).toBe("http://myhost:8080");
  });

  it("ignores the OSS url when the provider is anthropic", () => {
    setAIConfig({ provider: "anthropic", ossBaseUrl: "http://elsewhere:11434/v1" });
    expect(ollamaRoot()).toBe("http://localhost:11434");
  });
});

describe("ollamaUp", () => {
  it("never throws when the server is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(ollamaUp()).resolves.toEqual({ up: false });
  });

  it("reports the version when reachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.23.0" }), { status: 200 })
    ));
    await expect(ollamaUp()).resolves.toEqual({ up: true, version: "0.23.0" });
  });
});

/* NDJSON chunks the way Ollama streams them, split awkwardly across network
 * reads on purpose — the parser must reassemble partial lines. */
function ndjsonResponse(lines, sliceAt = 7) {
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < text.length; i += sliceAt)
        controller.enqueue(enc.encode(text.slice(i, i + sliceAt)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("pullModel", () => {
  it("reports progress per chunk and resolves on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonResponse([
      { status: "pulling manifest" },
      { status: "pulling abc123", total: 1000, completed: 250 },
      { status: "pulling abc123", total: 1000, completed: 1000 },
      { status: "success" },
    ])));
    const seen = [];
    await pullModel("smollm2:135m", (p) => seen.push(p));
    expect(seen[0]).toMatchObject({ status: "pulling manifest", pct: null });
    expect(seen[1]).toMatchObject({ completed: 250, total: 1000, pct: 25 });
    expect(seen.at(-1)).toMatchObject({ status: "success" });
  });

  it("turns a registry miss into a human message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonResponse([
      { error: "pull model manifest: file does not exist" },
    ])));
    await expect(pullModel("no-such-model")).rejects.toThrow(/isn't in the Ollama library/);
  });

  it("rejects with .canceled=true when aborted before the request lands", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, { signal }) =>
      new Promise((_res, rej) => {
        const abort = () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort);
      })
    ));
    const ctl = new AbortController();
    const p = pullModel("llama3.2:3b", null, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toMatchObject({ canceled: true });
  });

  it("treats a stream that ends without success as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ndjsonResponse([
      { status: "pulling manifest" },
    ])));
    await expect(pullModel("llama3.2:3b")).rejects.toThrow(/Pull failed/);
  });
});

describe("model metadata helpers", () => {
  it("formats sizes in decimal GB/MB like Ollama's site", () => {
    expect(humanSize(2_000_000_000)).toBe("2.0 GB");
    expect(humanSize(274_000_000)).toBe("274 MB");
    expect(humanSize(0)).toBe("");
  });

  it("flags embedding models by name or family", () => {
    expect(isEmbedModel("nomic-embed-text:latest")).toBe(true);
    expect(isEmbedModel({ name: "all-minilm", family: "" })).toBe(true);
    expect(isEmbedModel({ name: "oddly-named", family: "nomic-bert" })).toBe(true);
    expect(isEmbedModel("llama3.2:3b")).toBe(false);
  });

  it("curated list stays short and well-formed", () => {
    expect(CURATED.length).toBeLessThanOrEqual(6);
    for (const c of CURATED) {
      expect(c.name).toBeTruthy();
      expect(c.why).toBeTruthy();
      expect(c.bytes).toBeGreaterThan(0);
    }
  });
});

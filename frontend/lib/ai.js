"use client";

import Anthropic from "@anthropic-ai/sdk";
import { api, backendOn } from "./api";

/* AI service layer — the single seam between Vault's UI and Claude.
 *
 * Frontend-first (BYO key) mode: the user pastes their Anthropic API key in
 * Settings; it lives only in this browser's localStorage and calls go straight
 * from the browser to the Claude API (the SDK's dangerouslyAllowBrowser mode —
 * acceptable for a personal, local-first app; NEVER ship this pattern in a
 * multi-user product). When the backend lands, only this file changes: the
 * helpers below become fetch("/api/ai/...") calls and the key moves server-side.
 */

const KEY = "vault.ai.v1";

export const AI_MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (recommended)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
];

/* Everything that is not Anthropic goes through one route: the OpenAI
 * chat-completions shape, which almost every provider now speaks — including
 * ones that are not remotely open source. That is why this seam is worth
 * having: adding OpenAI, Mistral or Gemini is a row in this table, not a new
 * client library, and "Custom server" already covers anything unlisted.
 *
 * `keyUrl` is where you actually get the key. Hunting for that page is the
 * slowest part of setting one of these up.
 * `models` are sensible starting points, not a complete catalogue — the field
 * stays free text because these lists go stale within weeks. */
export const OSS_PRESETS = [
  {
    id: "ollama", label: "Ollama · local, free", url: "http://localhost:11434/v1", needsKey: false,
    models: ["llama3.3", "qwen2.5:14b", "gemma2:9b", "deepseek-r1:14b", "mistral"],
    note: "Runs on your machine — nothing leaves it. Needs OLLAMA_ORIGINS='*' ollama serve for browser access.",
  },
  {
    id: "lmstudio", label: "LM Studio · local, free", url: "http://localhost:1234/v1", needsKey: false,
    models: ["local-model"],
    note: "Start the local server from LM Studio's Developer tab.",
  },
  {
    id: "openai", label: "OpenAI", url: "https://api.openai.com/v1", needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  {
    id: "gemini", label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    note: "Google's OpenAI-compatible endpoint. Has a free tier.",
  },
  {
    id: "mistral", label: "Mistral", url: "https://api.mistral.ai/v1", needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    models: ["mistral-large-latest", "mistral-small-latest", "open-mistral-nemo"],
  },
  {
    id: "deepseek", label: "DeepSeek", url: "https://api.deepseek.com/v1", needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "groq", label: "Groq · very fast", url: "https://api.groq.com/openai/v1", needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    note: "Open-weight models on custom silicon. Free tier available.",
  },
  {
    id: "together", label: "Together AI", url: "https://api.together.xyz/v1", needsKey: true,
    keyUrl: "https://api.together.xyz/settings/api-keys",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  {
    id: "openrouter", label: "OpenRouter · many models, one key", url: "https://openrouter.ai/api/v1", needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    models: ["anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001", "meta-llama/llama-3.3-70b-instruct"],
    note: "A single key that reaches most providers — useful for trying several.",
  },
];

export const presetById = (id) => OSS_PRESETS.find((p) => p.id === id);

/* Fallback list for "Custom server", where we cannot know what is available. */
export const OSS_MODEL_SUGGESTIONS = [
  "llama3.3", "qwen2.5:14b", "mistral-small-latest", "deepseek-chat", "gpt-4o-mini",
];

export function getAIConfig() {
  try {
    return { provider: "anthropic", model: "claude-opus-5", ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { provider: "anthropic", model: "claude-opus-5" };
  }
}

export function setAIConfig(patch) {
  const next = { ...getAIConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function aiEnabled() {
  const c = getAIConfig();
  return c.provider === "oss" ? !!(c.ossBaseUrl && c.ossModel) : !!c.apiKey;
}

function client() {
  const { apiKey } = getAIConfig();
  if (!apiKey) throw new AIError("no_key", "Set up an AI model in Settings to enable AI features.");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function friendly(err) {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new AIError("auth", "That API key was rejected — check it in Settings.");
  if (err instanceof Anthropic.RateLimitError)
    return new AIError("rate", "Rate limited by the API — wait a moment and try again.");
  if (err instanceof Anthropic.APIConnectionError)
    return new AIError("net", "Couldn't reach the Claude API — check your connection.");
  if (err instanceof Anthropic.APIError)
    return new AIError("api", `Claude API error (${err.status}): ${err.message}`);
  return new AIError("unknown", err?.message || "Something went wrong.");
}

/* Open-source path: plain fetch against any OpenAI-compatible endpoint.
 * JSON-schema requests become an instruction (few OSS servers support
 * structured outputs); askJSON parses defensively below. */
async function completeOSS({ system, prompt, maxTokens = 16000, outputFormat }) {
  const { ossBaseUrl, ossModel, ossKey } = getAIConfig();
  if (!ossBaseUrl || !ossModel)
    throw new AIError("no_key", "Set your open-source model's server URL and model name in Settings.");
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  let p = prompt;
  if (outputFormat?.schema)
    p += `\n\nRespond with ONLY valid JSON matching this schema — no markdown fences, no commentary:\n${JSON.stringify(outputFormat.schema)}`;
  messages.push({ role: "user", content: p });

  let res;
  try {
    res = await fetch(`${ossBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ossKey ? { Authorization: `Bearer ${ossKey}` } : {}) },
      body: JSON.stringify({ model: ossModel, max_tokens: maxTokens, messages }),
    });
  } catch {
    throw new AIError("net", "Couldn't reach the model server — is it running, and does it allow browser requests? (For local Ollama: OLLAMA_ORIGINS='*' ollama serve)");
  }
  if (res.status === 401 || res.status === 403) throw new AIError("auth", "The model server rejected the key — check it in Settings.");
  if (res.status === 404) throw new AIError("api", "Model or endpoint not found — check the server URL and model name in Settings.");
  if (res.status === 429) throw new AIError("rate", "Rate limited by the model server — wait a moment and try again.");
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new AIError("api", `Model server error (${res.status})${t ? `: ${t.slice(0, 140)}` : ""}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new AIError("api", "The model server returned a non-JSON response."); }
  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); // reasoning models (DeepSeek-R1 family)
  if (!text) throw new AIError("empty", "The model returned an empty response — try again.");
  return text;
}

/* Reasoning models (Nemotron, DeepSeek-R1, some local models) emit their
 * chain-of-thought — often wrapped in <think>…</think> — ahead of the answer.
 * Users want the answer, not the monologue, so strip it from every response.
 * Belt-and-braces with the "detailed thinking off" system directive below. */
export function stripReasoning(text) {
  if (!text) return text;
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/^\s*(?:thought|thinking|reasoning)\s*:[\s\S]*?\n\s*\n/i, "")
    .trim();
}

/* Core call. Server-side fallbacks are on by default so a safety-classifier
 * decline re-runs on Anthropic's recommended fallback model instead of failing. */
async function complete(opts) {
  const text = getAIConfig().provider === "oss" ? await completeOSS(opts) : await completeAnthropic(opts);
  return stripReasoning(text);
}

async function completeAnthropic({ system, prompt, maxTokens = 16000, effort, outputFormat }) {
  const { model } = getAIConfig();
  try {
    const req = {
      model,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    };
    if (system) req.system = system;
    const oc = {};
    if (effort) oc.effort = effort;
    if (outputFormat) oc.format = outputFormat;
    if (Object.keys(oc).length) req.output_config = oc;

    const response = await client().beta.messages.create(req);

    if (response.stop_reason === "refusal") {
      throw new AIError("refusal", "Claude declined this request" + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."));
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) throw new AIError("empty", "The model returned an empty response — try again.");
    return text;
  } catch (err) {
    throw friendly(err);
  }
}

/** Free-text answer. Prefers the server (no browser key, and reaches
 * CORS-blocked providers like NVIDIA); falls back to a browser key. */
export async function askText(prompt, opts = {}) {
  const status = await serverAIStatus();
  if (status.server_completion) {
    return completeViaServer({ system: opts.system, messages: [{ role: "user", content: prompt }], maxTokens: opts.maxTokens || 4000 });
  }
  return complete({ prompt, ...opts });
}

/** Structured answer, constrained to a JSON schema and parsed. Same
 * server-first routing; the server can't enforce a schema, so we ask for
 * JSON in the prompt and rely on the tolerant parse below. */
export async function askJSON(prompt, schema, opts = {}) {
  const status = await serverAIStatus();
  let text;
  if (status.server_completion) {
    const system = [opts.system, "Respond with ONLY valid JSON — no prose, no code fences — matching this JSON schema: " + JSON.stringify(schema)]
      .filter(Boolean).join(" ");
    text = await completeViaServer({ system, messages: [{ role: "user", content: prompt }], maxTokens: opts.maxTokens || 4000 });
  } else {
    text = await complete({ prompt, ...opts, outputFormat: { type: "json_schema", schema } });
  }
  try { return JSON.parse(text); } catch {}
  // open models often wrap JSON in ``` fences or add prose — dig it out
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const bare = text.match(/[\[{][\s\S]*[\]}]/);
  for (const cand of [fenced?.[1], bare?.[0]]) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch {}
  }
  throw new AIError("parse", "The model's response wasn't valid JSON — try again (larger open models are more reliable at this).");
}


/* ------------------------------------------------------- server-side route
 *
 * When the backend has a provider configured it answers, and the browser
 * needs no key at all. Two reasons this matters beyond convenience:
 *
 *   · Some providers cannot be called from a browser however valid the key.
 *     NVIDIA NIM sends no `access-control-allow-origin`, so the request is
 *     blocked before it is sent. Server to server has no such restriction,
 *     which makes every OpenAI-compatible provider reachable — including a
 *     model you host yourself with no third party involved at all.
 *   · A browser-held key sits in localStorage on every device the user signs
 *     in from. A server-held one does not.
 */
let _serverAI = null;

export function resetServerAICache() { _serverAI = null; }

export async function serverAIStatus() {
  if (!backendOn()) return { server_completion: false };
  if (_serverAI) return _serverAI;
  try {
    _serverAI = await api("/ai/status");
  } catch {
    _serverAI = { server_completion: false };
  }
  return _serverAI;
}

async function completeViaServer({ system, messages, maxTokens }) {
  // "detailed thinking off" is Nemotron's switch to skip its reasoning trace;
  // the plain-English lines steer every other model the same way. Harmless to
  // providers that ignore them, and stripReasoning cleans up anything left.
  const guard = "detailed thinking off\n\n" +
    "Output only the final answer to the user. Do not show your reasoning, analysis, or chain-of-thought, and do not describe what you are doing — just give the answer.";
  const payload = [{ role: "system", content: system ? `${system}\n\n${guard}` : guard }];
  payload.push(...messages);
  const res = await api("/ai/complete", {
    method: "POST",
    body: { messages: payload, max_tokens: maxTokens },
  });
  return stripReasoning(res?.text || "");
}

/**
 * Ask whichever route is available, preferring the server.
 * Returns { text, via } so the UI can be honest about what answered.
 */
export async function askAnywhere(prompt, { system, maxTokens = 4000 } = {}) {
  const status = await serverAIStatus();
  if (status.server_completion) {
    return {
      text: await completeViaServer({ system, messages: [{ role: "user", content: prompt }], maxTokens }),
      via: status.model || "server",
    };
  }
  return { text: await askText(prompt, { system, maxTokens }), via: "browser" };
}

/** True when an answer can be produced by EITHER route. */
export async function answersPossible() {
  if (aiEnabled()) return true;
  return (await serverAIStatus()).server_completion === true;
}

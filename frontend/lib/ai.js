"use client";

import Anthropic from "@anthropic-ai/sdk";

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

/* Open-source route: anything that speaks the OpenAI chat-completions API —
 * local (Ollama, LM Studio) or hosted (Groq, Together, OpenRouter). */
export const OSS_PRESETS = [
  { id: "ollama", label: "Ollama · local", url: "http://localhost:11434/v1", needsKey: false },
  { id: "lmstudio", label: "LM Studio · local", url: "http://localhost:1234/v1", needsKey: false },
  { id: "groq", label: "Groq · hosted", url: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "together", label: "Together AI · hosted", url: "https://api.together.xyz/v1", needsKey: true },
  { id: "openrouter", label: "OpenRouter · hosted", url: "https://openrouter.ai/api/v1", needsKey: true },
];
export const OSS_MODEL_SUGGESTIONS = [
  "llama3.3", "llama-3.3-70b-versatile", "qwen2.5:14b", "mistral-small",
  "deepseek-r1:14b", "gemma2:9b", "meta-llama/Llama-3.3-70B-Instruct-Turbo",
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
  if (!apiKey) throw new AIError("no_key", "Add your Anthropic API key in Settings (avatar menu) to enable AI features.");
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

/* Core call. Server-side fallbacks are on by default so a safety-classifier
 * decline re-runs on Anthropic's recommended fallback model instead of failing. */
async function complete(opts) {
  if (getAIConfig().provider === "oss") return completeOSS(opts);
  return completeAnthropic(opts);
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

/** Free-text answer. */
export function askText(prompt, opts = {}) {
  return complete({ prompt, ...opts });
}

/** Structured answer, constrained to a JSON schema and parsed. */
export async function askJSON(prompt, schema, opts = {}) {
  const text = await complete({
    prompt,
    ...opts,
    outputFormat: { type: "json_schema", schema },
  });
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

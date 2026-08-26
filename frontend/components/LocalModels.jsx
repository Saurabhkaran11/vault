"use client";

/* CSS to merge into globals.css:

.lm-head{display:flex; align-items:center; gap:8px; padding:2px 8px 6px; font-size:12px; color:var(--ink)}
.lm-dot{width:8px; height:8px; border-radius:50%; background:var(--line); flex-shrink:0}
.lm-dot.on{background:var(--moss)}
.lm-ver{font-size:11px; color:var(--ink-soft)}
.lm-pull{display:flex; gap:6px; align-items:center; padding:4px 8px}
.lm-pull .menu-input{flex:1; width:auto}
.lm-chips{display:flex; flex-wrap:wrap; gap:6px; padding:4px 8px 2px}
.lm-chip{font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:.3px; padding:4px 10px; border-radius:99px; background:var(--field); color:var(--moss); border:1px solid var(--line); cursor:pointer}
.lm-chip:hover{border-color:var(--moss); background:var(--moss-soft)}
.lm-chip .lm-size{color:var(--ink-soft); margin-left:5px}
.lm-progrow{display:flex; align-items:center; gap:8px; padding:8px}
.lm-progrow .mono{font-size:11px; color:var(--ink-soft); white-space:nowrap}
.lm-prog{flex:1; height:4px; border-radius:2px; background:var(--line); overflow:hidden; min-width:60px}
.lm-prog i{display:block; height:100%; background:var(--moss); border-radius:2px; transition:width .2s}
.lm-prog.busy i{width:30%; animation:lm-slide 1.2s ease-in-out infinite}
@keyframes lm-slide{0%{margin-left:-30%}100%{margin-left:100%}}

*/

import { useEffect, useRef, useState } from "react";
import { setAIConfig } from "@/lib/ai";
import {
  ollamaRoot, ollamaUp, listModels, pullModel, deleteModel,
  CURATED, humanSize, isEmbedModel,
} from "@/lib/ollama";

/* Settings → local model manager. Lives in the AI section, under the model
 * picker: see what's installed, pull new models with live progress, delete,
 * and wire a fresh model into chat or search with one click.
 *
 * No polling — Ollama status is checked on mount, after every action, and on
 * the ↻ button. When Ollama is down this renders a two-line hint and nothing
 * else: the rest of Settings must not care.
 */
export default function LocalModels() {
  const [status, setStatus] = useState(null);  // null = checking · {up, version}
  const [models, setModels] = useState([]);
  const [err, setErr] = useState("");
  const [pullName, setPullName] = useState("");
  const [prog, setProg] = useState(null);      // {name, status, completed, total, pct}
  const [armed, setArmed] = useState("");      // model name awaiting the confirming click
  const [justPulled, setJustPulled] = useState("");
  const [used, setUsed] = useState("");        // confirmation after "Use for …"
  const abortRef = useRef(null);

  async function refresh() {
    setErr("");
    const s = await ollamaUp();
    setStatus(s);
    if (!s.up) { setModels([]); return; }
    try { setModels(await listModels()); } catch (e) { setErr(e.message); }
  }

  useEffect(() => {
    refresh();
    // closing Settings mid-download must not leave a pull running unattended
    return () => abortRef.current?.abort();
  }, []);

  async function startPull(name) {
    const n = name.trim();
    if (!n || prog) return;
    setErr(""); setJustPulled(""); setUsed("");
    const ctl = new AbortController();
    abortRef.current = ctl;
    setProg({ name: n, status: "starting…", completed: 0, total: 0, pct: null });
    let failed = "";
    try {
      await pullModel(n, (p) => setProg({ name: n, ...p }), ctl.signal);
      setPullName("");
    } catch (e) {
      if (!e?.canceled) failed = e.message || "Pull failed — try again.";
    } finally {
      setProg(null);
      abortRef.current = null;
    }
    await refresh(); // refresh clears err, so report the failure after it
    if (failed) setErr(failed);
    else if (!ctl.signal.aborted) setJustPulled(n);
  }

  /* Same two-click confirm as account deletion: first click arms, second
   * deletes, focus leaving disarms. No native confirm() — blocked in webviews. */
  async function removeModel(name) {
    if (armed !== name) { setArmed(name); return; }
    setArmed(""); setUsed("");
    let failed = "";
    try { await deleteModel(name); } catch (e) { failed = e.message; }
    await refresh(); // refresh clears err, so report the failure after it
    if (failed) setErr(failed);
  }

  /* Point the chat provider at this server's OpenAI-compat route. ollamaRoot()
   * is localhost:11434 unless the user already configured Ollama elsewhere —
   * then the model they just pulled TO that server should be used FROM it. */
  function useForChat(name) {
    setAIConfig({ provider: "oss", ossPreset: "ollama", ossBaseUrl: `${ollamaRoot()}/v1`, ossModel: name });
    setJustPulled(""); setUsed(`Chat now uses ${name}.`);
  }

  function useForSearch(name) {
    setAIConfig({ embedModel: name });
    setJustPulled(""); setUsed(`Semantic search now uses ${name}.`);
  }

  const curatedLeft = CURATED.filter(
    (c) => !models.some((m) => m.name === c.name || m.name === `${c.name}:latest`)
  );

  return (
    <div className="set-sec">
      <div className="menu-sec">Local models · Ollama</div>

      <div className="lm-head">
        <span className={status?.up ? "lm-dot on" : "lm-dot"} aria-hidden="true" />
        {status === null ? (
          <span className="lm-ver">Checking…</span>
        ) : status.up ? (
          <span className="lm-ver">Running{status.version ? ` · v${status.version}` : ""}</span>
        ) : (
          <span className="lm-ver">Not reachable</span>
        )}
        <button className="kbtn" style={{ marginLeft: "auto" }} onClick={refresh}
          title="Check again" aria-label="Refresh local models">↻</button>
      </div>

      {status && !status.up && (
        <div className="menu-foot" style={{ border: "none", marginTop: 0, paddingTop: 0 }}>
          Start it with <span className="mono">{"OLLAMA_ORIGINS='*' ollama serve"}</span>.
          Don&apos;t have it? <span className="mono">brew install ollama</span>
        </div>
      )}

      {status?.up && (
        <>
          {models.length === 0 ? (
            <div className="conn-row"><span>No models installed yet — pull one below.</span></div>
          ) : (
            models.map((m) => (
              <div className="conn-row" key={m.name}>
                <span className="mono" title={[m.family, m.paramSize].filter(Boolean).join(" · ")}>
                  {m.name}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono">{humanSize(m.size)}</span>
                  <button
                    className={armed === m.name ? "kbtn kdel armed" : "kbtn kdel"}
                    onClick={() => removeModel(m.name)}
                    onBlur={() => setArmed("")}
                    title={armed === m.name ? "This removes the model from disk" : `Delete ${m.name}`}>
                    {armed === m.name ? "Click again to delete" : "Delete"}
                  </button>
                </span>
              </div>
            ))
          )}

          {prog ? (
            <div className="lm-progrow">
              <span className="mono">{prog.name}</span>
              <div className={prog.total ? "lm-prog" : "lm-prog busy"}>
                <i style={prog.total ? { width: `${prog.pct}%` } : undefined} />
              </div>
              <span className="mono">
                {prog.total
                  ? `${prog.pct}% · ${humanSize(prog.completed)} / ${humanSize(prog.total)}`
                  : prog.status || "starting…"}
              </span>
              <button className="kbtn kdel" onClick={() => abortRef.current?.abort()}
                title="Cancel download" aria-label="Cancel download">✕</button>
            </div>
          ) : (
            <>
              <div className="lm-pull">
                <input className="menu-input" value={pullName} aria-label="Model to pull"
                  placeholder="Pull any model, e.g. llama3.2:3b"
                  onChange={(e) => setPullName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") startPull(pullName); }} />
                <button className="kbtn" onClick={() => startPull(pullName)}
                  disabled={!pullName.trim()}>Pull</button>
              </div>
              {curatedLeft.length > 0 && (
                <div className="lm-chips">
                  {curatedLeft.map((c) => (
                    <button key={c.name} className="lm-chip" title={c.why}
                      onClick={() => startPull(c.name)}>
                      {c.name}<span className="lm-size">{humanSize(c.bytes)}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {justPulled && (
            <div className="conn-row">
              <span>✓ {justPulled} installed</span>
              {isEmbedModel(justPulled) ? (
                <button className="kbtn" onClick={() => useForSearch(justPulled)}>Use for search</button>
              ) : (
                <button className="kbtn" onClick={() => useForChat(justPulled)}>Use for chat</button>
              )}
            </div>
          )}
          {used && (
            <div className="menu-foot" style={{ border: "none", marginTop: 2, paddingTop: 0 }}>
              ✓ {used}
            </div>
          )}
        </>
      )}

      {err && <div className="kmerr" role="status">{err}</div>}
    </div>
  );
}

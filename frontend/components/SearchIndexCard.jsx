"use client";

/* CSS to merge into globals.css:
.semidx-bar{height:4px; background:var(--line); border-radius:3px; overflow:hidden; margin:6px 8px 2px}
.semidx-fill{height:100%; background:var(--moss); border-radius:3px; transition:width .2s ease}
*/

import React, { useEffect, useMemo, useState } from "react";
import { buildIndex, indexStatus, probeEmbed, embedModel } from "@/lib/embed";

/* Settings → "SEMANTIC SEARCH INDEX": the only UI over lib/embed.js.
 * Mirrors SyncSection's shape (App.jsx): honest status line, one action,
 * short foot note. The probe uses Ollama's model listing with a short
 * timeout, so an absent Ollama shows a hint in ~3s instead of hanging. */
export default function SearchIndexCard({ items = [] }) {
  /* trash-safe even if a caller passes allItems — deleted items would
   * otherwise be embedded and surface in search results */
  const live = useMemo(() => items.filter((i) => !i.deleted), [items]);

  const [probe, setProbe] = useState(null);    // null=checking · {ok, hint}
  const [status, setStatus] = useState(null);  // {indexed, total, stale, reason?}
  const [prog, setProg] = useState(null);      // {done, total} while building
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);        // {ok, text}

  const recheck = () => {
    setProbe(null);
    probeEmbed().then(setProbe);
  };

  useEffect(() => {
    let alive = true;
    probeEmbed().then((p) => { if (alive) setProbe(p); });
    return () => { alive = false; };
  }, []);

  /* hash-compare only, no network — cheap enough to rerun as items change */
  useEffect(() => {
    let alive = true;
    indexStatus(live).then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [live]);

  const build = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await buildIndex(live, setProg);
      if (res.reason) setMsg({ ok: false, text: res.reason });
      else setMsg({
        ok: true,
        text: res.indexed === 0
          ? "Already up to date — nothing changed."
          : `Indexed ${res.indexed} item${res.indexed === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} unchanged` : ""}.`,
      });
      setStatus(await indexStatus(live));
    } catch (e) {
      setMsg({ ok: false, text: e?.message || "Indexing failed — try again." });
    }
    setProg(null);
    setBusy(false);
  };

  const ready = probe?.ok === true;
  const fresh = status && !status.reason && status.stale === 0 && status.total > 0;

  const dot = probe === null || !status ? "sync-dot checking"
    : !ready ? "sync-dot off"
    : status.stale > 0 ? "sync-dot pending"
    : "sync-dot ok";

  const statusText = !status ? "Checking…"
    : status.total === 0 ? "Nothing to index yet — save a few items first."
    : `${status.indexed} of ${status.total} items indexed${status.stale > 0 ? ` · ${status.stale} changed` : " · up to date"}`;

  const label = prog
    ? `Indexing… ${prog.done}/${prog.total}`
    : status?.indexed > 0 ? "Update index" : "Build index";

  return (
    <div className="set-sec">
      <div className="menu-sec">🔎 SEMANTIC SEARCH INDEX</div>
      <div className="conn-row">
        <span><span className={dot} aria-hidden="true" /> {statusText}</span>
        <button className="btn ghost sm" disabled={busy || !ready || !status || status.total === 0}
          onClick={build}
          title={!ready ? probe?.hint || "Checking Ollama…"
            : fresh ? "Re-checks every item; unchanged ones are skipped"
            : "Embeds new and changed items on this machine"}>
          {label}
        </button>
      </div>

      {prog && prog.total > 0 && (
        <div className="semidx-bar" role="progressbar" aria-valuemin={0}
          aria-valuemax={prog.total} aria-valuenow={prog.done} aria-label="Indexing progress">
          <div className="semidx-fill" style={{ width: `${Math.round((prog.done / prog.total) * 100)}%` }} />
        </div>
      )}

      {probe && !probe.ok && (
        <div className="kmerr">
          {probe.hint}{" "}
          <button className="kbtn" style={{ marginLeft: 6 }} onClick={recheck}>Check again</button>
        </div>
      )}

      {msg && (msg.ok
        ? <div style={{ padding: "6px 8px 0" }}><span className="keystate mono">{msg.text}</span></div>
        : <div className="kmerr">{msg.text}</div>)}

      <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
        Built on this machine by Ollama ({embedModel()}) — nothing leaves your computer.
        Semantic matches are used automatically in Search and each item&rsquo;s Related section.
      </div>
    </div>
  );
}

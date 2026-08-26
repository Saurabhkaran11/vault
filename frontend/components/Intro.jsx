"use client";

import { useEffect, useState } from "react";

/* One-time section intros. They earn their two lines exactly once — after
 * that they're chrome stealing space from the user's own content. Each intro
 * shows until the user hides it (per section, persisted); a tiny ⓘ brings it
 * back on demand. */
const KEY = "vault.intros.v1";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = (m) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ } };

export default function Intro({ id, children }) {
  const [state, setState] = useState("loading");   // loading | shown | hidden

  useEffect(() => { setState(read()[id] ? "hidden" : "shown"); }, [id]);

  if (state === "loading") return null;

  if (state === "hidden") {
    return (
      <button className="intro-peek" onClick={() => { const m = read(); delete m[id]; write(m); setState("shown"); }}
        title="Show what this section does" aria-label="About this section">ⓘ about this section</button>
    );
  }
  return (
    <p className="sub intro-sub">
      {children}
      <button className="intro-hide" onClick={() => { write({ ...read(), [id]: true }); setState("hidden"); }}
        title="Hide this intro — the ⓘ brings it back">✕ hide</button>
    </p>
  );
}

"use client";

import { useEffect, useState } from "react";
import { reportError } from "@/lib/monitor";

/* Route-level error boundary: an unexpected render crash shows this instead
 * of a white screen. The first message is the one that matters — the user's
 * data lives in localStorage and a render error cannot touch it. */
export default function Error({ error, retry }) {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => { reportError(error, { boundary: "app/error" }); }, [error]);

  /* the ?crashtest drill would re-crash on every retry if the param survives —
   * recovery controls must leave a URL that can actually recover */
  const clearCrashParam = () => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.has("crashtest")) {
        u.searchParams.delete("crashtest");
        window.history.replaceState(null, "", u);
      }
    } catch {}
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg, #EFF3F8)", color: "var(--ink, #16283C)", padding: 24,
      fontFamily: "'Public Sans', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">🛟</div>
        <h1 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 26, fontWeight: 650, margin: "0 0 10px" }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft, #54677C)", margin: "0 0 18px" }}>
          Your data is safe — everything you&rsquo;ve saved lives in this browser and wasn&rsquo;t touched.
          Try again, and if it keeps happening, reload the page.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16 }}>
          <button onClick={() => { clearCrashParam(); retry(); }} style={{
            background: "var(--moss, #1F5FA8)", color: "#fff", border: "none", borderRadius: 9,
            padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>Try again</button>
          <button onClick={() => { clearCrashParam(); window.location.reload(); }} style={{
            background: "none", color: "var(--moss, #1F5FA8)", border: "1px solid var(--moss, #1F5FA8)",
            borderRadius: 9, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>Reload Vault</button>
        </div>
        <button onClick={() => setShowDetail((s) => !s)} style={{
          background: "none", border: "none", color: "var(--ink-soft, #54677C)", fontSize: 12,
          cursor: "pointer", textDecoration: "underline", fontFamily: "inherit",
        }}>
          {showDetail ? "Hide" : "Show"} technical details
        </button>
        {showDetail && (
          <pre style={{
            textAlign: "left", fontSize: 11, lineHeight: 1.5, background: "rgba(0,0,0,.06)",
            borderRadius: 8, padding: 12, marginTop: 10, overflowX: "auto", whiteSpace: "pre-wrap",
          }}>{String(error?.message || error)}{error?.digest ? `\ndigest: ${error.digest}` : ""}</pre>
        )}
      </div>
    </div>
  );
}

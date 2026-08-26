"use client";

import { reportError } from "@/lib/monitor";
import { useEffect } from "react";

/* Last-resort boundary: replaces the root layout when even that crashes.
 * Must render its own <html>/<body> and carries no global styles. */
export default function GlobalError({ error, retry }) {
  useEffect(() => { reportError(error, { boundary: "global-error" }); }, [error]);
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#EFF3F8", color: "#16283C", fontFamily: "system-ui, sans-serif", padding: 24,
      }}>
        <title>Vault — something went wrong</title>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 10px" }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "#54677C", margin: "0 0 18px" }}>
            Your data is safe in this browser. Reloading usually fixes this.
          </p>
          <button onClick={() => (retry ? retry() : window.location.reload())} style={{
            background: "#1F5FA8", color: "#fff", border: "none", borderRadius: 9,
            padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          }}>Reload Vault</button>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useEffect, useState } from "react";
import { api, backendOn, hasVerifiedIdentity } from "@/lib/api";

/* Connect a Google Calendar for live sync (bug-list #4, Phase 1). The button
 * asks the backend for a consent URL and sends the browser to Google; the
 * callback returns here with ?calendar=connected. Connecting needs a signed-in
 * account (the flow is scoped to the user) and the Google client configured on
 * the server — until then the control explains what's missing rather than
 * failing silently. Docs/Sheets/Drive are link-based (paste a link in
 * Documents), not OAuth, so they don't appear here. */
export default function CalendarConnect() {
  const [status, setStatus] = useState(null);   // {google_configured, connected_accounts}
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = async () => {
    try {
      const s = await api("/calendar/status");
      setStatus(s);
      setAccounts(s.connected_accounts > 0 ? await api("/calendar/accounts") : []);
    } catch {
      setStatus(null);
    }
    setLoaded(true);
  };

  useEffect(() => {
    if (backendOn() && hasVerifiedIdentity()) refresh();
    else setLoaded(true);
  }, []);

  const connect = async () => {
    setErr(""); setBusy(true);
    try {
      const { url } = await api("/calendar/google/authorize");
      window.location.href = url;   // off to Google's consent screen
    } catch (e) {
      setErr(e?.status === 503
        ? "Google Calendar sync isn't set up on the server yet."
        : "Couldn't start the connection — try again in a moment.");
      setBusy(false);
    }
  };

  const disconnect = async (id) => {
    setBusy(true);
    try { await api(`/calendar/accounts/${id}`, { method: "DELETE" }); await refresh(); }
    catch { setErr("Couldn't disconnect — try again."); }
    setBusy(false);
  };

  if (!backendOn() || !hasVerifiedIdentity()) {
    return <div className="menu-foot" style={{ border: "none", marginTop: 2, paddingTop: 0 }}>
      Sign in to connect your Google Calendar for live sync.
    </div>;
  }
  if (!loaded) return <div className="conn-row"><span>Checking calendar…</span></div>;

  return (
    <>
      {accounts.map((a) => (
        <div key={a.id} className="conn-row">
          <span>📆 {a.external_email || "Google Calendar"}</span>
          <button className="av-link" onClick={() => disconnect(a.id)} disabled={busy}>Disconnect</button>
        </div>
      ))}
      {status && status.google_configured === false ? (
        <div className="menu-foot" style={{ border: "none", marginTop: 2, paddingTop: 0 }}>
          Google Calendar sync isn't enabled on the server yet.
        </div>
      ) : (
        <button className="menu-item" onClick={connect} disabled={busy}>
          {busy ? "Opening Google…" : "＋ Connect Google Calendar"} <span className="menukey">live sync</span>
        </button>
      )}
      {err && <div className="kmerr" role="status" style={{ marginTop: 6 }}>{err}</div>}
    </>
  );
}

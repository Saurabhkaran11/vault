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
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const refresh = async () => {
    try {
      const s = await api("/calendar/status");
      setStatus(s);
      if (s.connected_accounts > 0) {
        setAccounts(await api("/calendar/accounts"));
        setEvents(await api("/calendar/events"));
      } else {
        setAccounts([]); setEvents([]);
      }
    } catch {
      setStatus(null);
    }
    setLoaded(true);
  };

  const sync = async () => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await api("/calendar/sync", { method: "POST" });
      setMsg(`Synced ${r.synced} event${r.synced === 1 ? "" : "s"}.`);
      await refresh();
    } catch {
      setErr("Couldn't sync right now — try again.");
    }
    setBusy(false);
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

      {accounts.length > 0 && (
        <>
          <button className="menu-item" onClick={sync} disabled={busy}>
            {busy ? "Syncing…" : "↻ Sync now"} <span className="menukey">{events.length} event{events.length === 1 ? "" : "s"}</span>
          </button>
          {events.slice(0, 5).map((e) => (
            <div key={e.id} className="conn-row" style={{ fontSize: 13 }}>
              <span>{e.title}</span>
              <span className="mono" style={{ color: "var(--ink-soft)" }}>
                {e.starts_at ? new Date(e.starts_at).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : ""}
              </span>
            </div>
          ))}
        </>
      )}

      {accounts.length === 0 && (status && status.google_configured === false ? (
        <div className="menu-foot" style={{ border: "none", marginTop: 2, paddingTop: 0 }}>
          Google Calendar sync isn't enabled on the server yet.
        </div>
      ) : (
        <button className="menu-item" onClick={connect} disabled={busy}>
          {busy ? "Opening Google…" : "＋ Connect Google Calendar"} <span className="menukey">live sync</span>
        </button>
      ))}
      {msg && <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0, color: "var(--moss)" }}>{msg}</div>}
      {err && <div className="kmerr" role="status" style={{ marginTop: 6 }}>{err}</div>}
    </>
  );
}

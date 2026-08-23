"use client";

import { useState } from "react";
import { SignOutButton, useUser, useClerk } from "@clerk/nextjs";
import { authEnabled } from "@/lib/authConfig";
import { api } from "@/lib/api";
import { BACKED_UP_STORES } from "@/lib/backup";

/* Settings → account identity.
 *
 * Two things this must NOT do, both reported as bugs:
 *  · leak infrastructure — the backend URL, the internal user id, retry-queue
 *    internals. Those are for developers, and printing an API endpoint on a
 *    user's settings screen is an information leak, not a feature.
 *  · display the email in the clear. It is masked by default and revealed on
 *    request, the way a mature account screen treats it — enough to answer
 *    "whose account is this" without putting it on show.
 *
 * Clerk hooks only throw when CALLED outside a ClerkProvider, so the
 * signed-in half is a separate component rendered only when auth is on.
 */
export default function AccountSection() {
  if (!authEnabled()) return <LocalOnlyAccount />;
  return <SignedInAccount />;
}

/* s•••h@gmail.com — recognisable as yours, not readable over your shoulder. */
function maskEmail(email) {
  if (!email || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  const head = name.length <= 2 ? name[0] : name.slice(0, 1) + "•••" + name.slice(-1);
  return `${head}@${domain}`;
}

function LocalOnlyAccount() {
  return (
    <div className="set-sec">
      <div className="menu-sec">Account</div>
      <div className="conn-row">
        <span>Signed out — this browser only</span>
      </div>
      <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
        Everything is saved in this browser. Sign in to keep your vault across
        devices.
      </div>
    </div>
  );
}

function SignedInAccount() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [showEmail, setShowEmail] = useState(false);
  const [busy, setBusy] = useState("");        // "export" | "delete" while a call is in flight
  const [armed, setArmed] = useState(false);   // delete needs a second, deliberate click
  const [err, setErr] = useState("");

  const email = user?.primaryEmailAddress?.emailAddress || "";
  const name = user?.fullName || user?.firstName || "";

  /* Download everything the server holds for this account as one JSON file.
     The backend does the gathering; we just save the response. */
  async function exportData() {
    setErr(""); setBusy("export");
    try {
      const data = await api("/account/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault-account-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr("Couldn't download your data — check your connection and try again.");
    } finally {
      setBusy("");
    }
  }

  /* Permanent erasure. Two clicks (native confirm() is blocked in webviews),
     then wipe this browser's copy too and sign out — nothing should linger
     locally after the account is gone. */
  async function deleteAccount() {
    setErr("");
    if (!armed) { setArmed(true); return; }
    setBusy("delete");
    try {
      await api("/account", { method: "DELETE" });
      for (const s of BACKED_UP_STORES) localStorage.removeItem(s.key);
      await signOut();
    } catch {
      setErr("Couldn't delete your account — nothing was changed. Try again.");
      setBusy(""); setArmed(false);
    }
  }

  return (
    <div className="set-sec">
      <div className="menu-sec">Account</div>

      {!isLoaded ? (
        <div className="conn-row"><span>Loading your account…</span></div>
      ) : (
        <>
          <div className="acct-card">
            <div className="acct-avatar" aria-hidden="true">
              {(name || email || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div className="acct-id">
              <div className="acct-name">{name || "Signed in"}</div>
              {email && (
                <button type="button" className="acct-email"
                  onClick={() => setShowEmail((v) => !v)}
                  title={showEmail ? "Hide email" : "Show email"}>
                  {showEmail ? email : maskEmail(email)}
                  <span className="acct-reveal">{showEmail ? "hide" : "show"}</span>
                </button>
              )}
            </div>
          </div>
          <SignOutButton>
            <button className="menu-item">Sign out</button>
          </SignOutButton>

          <div className="menu-sec" style={{ marginTop: 14 }}>Your data</div>
          <button className="menu-item" onClick={exportData} disabled={busy === "export"}>
            {busy === "export" ? "Preparing…" : "Download my data"}
            <span className="menukey">everything we store</span>
          </button>
          <button className="menu-item danger" onClick={deleteAccount}
            disabled={busy === "delete"}
            onBlur={() => setArmed(false)}
            style={armed ? { color: "var(--stamp)", fontWeight: 700 } : undefined}>
            {busy === "delete" ? "Deleting…" : armed ? "Click again to permanently delete everything" : "Delete account"}
            {!armed && <span className="menukey">erase account &amp; data</span>}
          </button>
          {armed && (
            <div className="menu-foot" style={{ border: "none", marginTop: 2, paddingTop: 0 }}>
              This removes your account and all its data from the server and this
              browser. It cannot be undone.
            </div>
          )}
          {err && <div className="kmerr" role="status" style={{ marginTop: 6 }}>{err}</div>}
        </>
      )}
    </div>
  );
}

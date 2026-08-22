"use client";

import { useState } from "react";
import { SignOutButton, useUser } from "@clerk/nextjs";
import { authEnabled } from "@/lib/authConfig";

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
  const [showEmail, setShowEmail] = useState(false);

  const email = user?.primaryEmailAddress?.emailAddress || "";
  const name = user?.fullName || user?.firstName || "";

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
        </>
      )}
    </div>
  );
}

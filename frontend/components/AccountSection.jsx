"use client";

import { SignOutButton, useUser } from "@clerk/nextjs";
import { authEnabled } from "@/lib/authConfig";

/* Settings → "🔐 ACCOUNT".
 *
 * Two entirely different things to say depending on whether an identity
 * provider is configured, and being honest about the difference matters:
 * without one, "your data is in this browser" is the whole security model,
 * and the user should know that rather than assume an account protects it.
 *
 * Importing Clerk here is safe with no keys — its hooks only throw when
 * *called* outside a ClerkProvider, which is why the signed-in half is a
 * separate component that is never rendered unless authEnabled().
 */
export default function AccountSection() {
  if (!authEnabled()) return <LocalOnlyAccount />;
  return <SignedInAccount />;
}

function LocalOnlyAccount() {
  return (
    <div className="set-sec">
      <div className="menu-sec">🔐 ACCOUNT</div>
      <div className="conn-row">
        <span>○ No sign-in configured</span>
        <span className="mono">local only</span>
      </div>
      <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
        Vault is running without accounts: everything lives in this browser, and
        anything you sync is identified only by the User ID under Backend sync —
        which anyone could type. Add a Clerk publishable key to turn on real
        sign-in; see docs/auth.md.
      </div>
    </div>
  );
}

function SignedInAccount() {
  const { user, isLoaded } = useUser();

  return (
    <div className="set-sec">
      <div className="menu-sec">🔐 ACCOUNT</div>
      <div className="conn-row">
        <span>{isLoaded && user ? "● Signed in" : "◌ Checking session…"}</span>
        <span className="mono">{user?.primaryEmailAddress?.emailAddress || user?.username || ""}</span>
      </div>
      <div className="conn-row">
        <span>Every request carries a verified token</span>
        <span className="mono">JWT</span>
      </div>
      <SignOutButton>
        <button className="menu-item">⏻ Sign out</button>
      </SignOutButton>
      <div className="menu-foot" style={{ border: "none", marginTop: 4, paddingTop: 0 }}>
        Your vault is tied to this account. The backend verifies every request
        against your identity provider, so the User ID under Backend sync no
        longer applies.
      </div>
    </div>
  );
}

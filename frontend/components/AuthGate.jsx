"use client";

import { Show } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import AuthBridge from "./AuthBridge";

/* Auth is an OPTION, not a gate.
 *
 * Vault's promise is local-first: anyone can open the app and use it with
 * their data in this browser — no account, no sign-up wall. Signing in
 * exists for one reason, syncing your vault across devices, and it's
 * offered where that reason lives: Settings → Account.
 *
 * So this component never blocks. It renders the app for everyone and, when
 * a Clerk session exists, mounts <AuthBridge> so the sync layer gets its
 * token getter before any child can fire a request.
 *
 * Rendered only inside <ClerkProvider> (app/layout.js), so <Show> always
 * has its context. Public pages (/privacy, /terms) skip even that wrapper —
 * they must work for OAuth verification reviewers with zero app context.
 */
const PUBLIC_PATHS = ["/privacy", "/terms"];

export default function AuthGate({ children }) {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) return children;
  return (
    <>
      <Show when="signed-in">
        <AuthBridge />
      </Show>
      {children}
    </>
  );
}

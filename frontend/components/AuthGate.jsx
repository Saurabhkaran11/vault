"use client";

import { Show, SignIn } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import AuthBridge from "./AuthBridge";

/* Pages anyone may read signed-out. Google's OAuth verification reviewers
 * (and any privacy-conscious visitor) must reach these without an account. */
const PUBLIC_PATHS = ["/privacy", "/terms"];

/* What a signed-out visitor sees once Clerk is configured.
 *
 * Deliberately a full-page sign-in rather than a redirect: Vault holds one
 * person's private vault, so there is no useful signed-out view to show —
 * and a redirect would flash the app shell first.
 *
 * Rendered only inside <ClerkProvider> (app/layout.js), so these components
 * always have their context.
 *
 * Uses <Show when="signed-in|signed-out">: Clerk Core 3 removed the older
 * <SignedIn>/<SignedOut> components, and they now throw at render rather
 * than fail at import — which a build with real keys catches immediately.
 */
export default function AuthGate({ children }) {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) return children;
  return (
    <>
      <Show when="signed-in">
        {/* Registers Clerk's token getter with the sync layer before any
            child can fire a request. */}
        <AuthBridge />
        {children}
      </Show>

      <Show when="signed-out">
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 28,
          background: "var(--bg, #EFF3F8)", padding: 24,
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 40,
              fontWeight: 650, color: "var(--ink, #16283C)", letterSpacing: "-0.01em",
            }}>
              Vault
            </div>
            <p style={{
              margin: "8px 0 0", maxWidth: 420, color: "var(--muted, #5A6B80)",
              fontSize: 15, lineHeight: 1.5,
            }}>
              Notes, videos, reading, documents, to-dos, boards and money —
              everything you&rsquo;re working on, in one place.
            </p>
          </div>
          <SignIn routing="hash" />
        </div>
      </Show>
    </>
  );
}

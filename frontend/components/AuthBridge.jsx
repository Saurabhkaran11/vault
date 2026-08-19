"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setTokenGetter } from "@/lib/api";

/* Hands Clerk's token getter to lib/api.js.
 *
 * The sync layer is plain module code — it cannot call a React hook — so
 * this component is the one place the two meet. It renders nothing.
 *
 * getToken() returns the current session JWT and refreshes it as needed, so
 * we register the function rather than a token value; a token captured once
 * would expire mid-session and start failing requests.
 *
 * Rendered only when Clerk is configured (see app/layout.js), because
 * useAuth() throws outside a ClerkProvider.
 */
export default function AuthBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) {
      setTokenGetter(null);
      return;
    }
    setTokenGetter(() => getToken());
    return () => setTokenGetter(null);
  }, [getToken, isSignedIn]);

  return null;
}

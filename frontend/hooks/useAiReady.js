"use client";

import { useEffect, useState } from "react";
import { aiEnabled, serverAIStatus } from "@/lib/ai";

/* True when AI can answer by EITHER route — a browser key the user pasted, or
 * a provider configured on the backend. UI gates should use this, not
 * aiEnabled() alone, or server-configured AI looks "off" and every button
 * wrongly demands a key. Re-checks the server on mount and caches per session. */
export function useAiReady() {
  const [server, setServer] = useState(false);
  useEffect(() => {
    let live = true;
    serverAIStatus().then((s) => { if (live) setServer(!!s.server_completion); });
    return () => { live = false; };
  }, []);
  return aiEnabled() || server;
}

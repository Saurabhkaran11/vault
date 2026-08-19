"use client";

import { useEffect, useState } from "react";
import App from "@/components/App";

/* Vault is fully client-state (localStorage) and full of date-derived text
 * (stamps, "due today", week charts). Server-rendering that content invites
 * hydration mismatches — e.g. HTML prerendered before midnight, hydrated
 * after. Rendering the app only after mount removes that entire bug class;
 * the shell paints instantly and data was never on the server anyway. */
export default function HomePage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div aria-busy="true" style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "#EFF3F8", color: "#16283C", fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 650,
      }}>
        Vault
      </div>
    );
  }
  return <App />;
}

"use client";

import { useEffect, useRef } from "react";

/* Two open tabs used to clobber each other: each holds its store in React
 * state and writes the WHOLE store on every mutation, so whichever tab
 * saved last silently erased the other's work.
 *
 * The `storage` event fires in every OTHER same-origin tab when a key
 * changes — adopting the new value there makes all tabs converge on the
 * latest write instead of fighting. (The writing tab never receives its own
 * event, so there is no loop; re-persisting an identical value is a no-op.)
 */
export function useCrossTab(key, onExternal) {
  const cb = useRef(onExternal);
  cb.current = onExternal;
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== key || e.newValue == null) return;
      try { cb.current(JSON.parse(e.newValue)); } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
}

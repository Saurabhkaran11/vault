"use client";

import { useEffect, useState } from "react";
import { seed } from "@/lib/seed";

const KEY = "vault.items.v1";

/**
 * localStorage-persisted item store, hydration-safe for Next.js.
 *
 * SSR and the first client render both use `seed`, so the server-rendered
 * HTML matches the client's first paint (no hydration mismatch). Real saved
 * data is loaded from localStorage in an effect right after mount, and we
 * only start writing back once that load has happened — otherwise the initial
 * `seed` render would clobber the user's saved items.
 *
 * This is the single seam the backend will replace later: swap the two
 * effects for API reads/writes and the rest of the app is unchanged.
 */
export function useStore() {
  const [items, setItems] = useState(seed);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch (e) {
      console.error("Could not read saved data:", e);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {
      console.error("Could not save data:", e);
    }
  }, [items, hydrated]);

  const add = (it) => setItems((xs) => [it, ...xs]);
  const update = (it) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
  const remove = (id) => setItems((xs) => xs.filter((x) => x.id !== id));

  /* one-click JSON backup — your data insurance */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = (file, onDone) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error("Backup must be a JSON array");
        setItems(data);
        onDone?.(null, data.length);
      } catch (e) {
        onDone?.(e);
      }
    };
    reader.readAsText(file);
  };

  return { items, add, update, remove, exportJson, importJson, hydrated };
}

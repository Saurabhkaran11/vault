import { useEffect, useState } from "react";
import { seed } from "../data/seed.js";

const KEY = "vault.items.v1";

/** localStorage-persisted item store. Seeds sample data on first run. */
export function useStore() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.error("Could not read saved data:", e);
    }
    return seed;
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {
      console.error("Could not save data:", e);
    }
  }, [items]);

  const add = (it) => setItems((xs) => [it, ...xs]);
  const update = (it) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
  const remove = (id) => setItems((xs) => xs.filter((x) => x.id !== id));

  /* P0: one-click JSON backup — your data insurance */
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

  return { items, add, update, remove, exportJson, importJson };
}

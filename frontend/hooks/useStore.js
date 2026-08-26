"use client";

import { useEffect, useState } from "react";
import { seed } from "@/lib/seed";
import { mirror } from "@/lib/api";
import { safeSet } from "@/lib/safeStorage";

const KEY = "vault.items.v1";

/* Frontend item → backend upsert body (see .claude/skills/items-sync).
 * client_id = String(id), date→added_on, deleted→deleted_on, file→file_meta
 * WITHOUT the base64 bytes (those stay local until the S3 phase).
 * deleted_on is always carried (null when not trashed) so trash/restore
 * mirror through the same idempotent upsert; undefined keys are dropped. */
const toApi = (it) => {
  const body = {
    client_id: String(it.id),
    type: it.type,
    title: it.title,
    meta: it.meta,
    url: it.url,
    cloud: it.cloud,
    status: it.status,
    tags: it.tags,
    folder: it.folder,
    alias: it.alias,
    pinned: it.pinned,
    progress: it.progress,
    blocks: it.blocks,
    links: it.links,
    /* s3_key must travel with the metadata: /files/download-url refuses to
     * sign a key it can't find on one of the caller's own items, so an
     * un-mirrored key would make the file unopenable everywhere. The base64
     * `data` deliberately never leaves the browser. */
    file_meta: it.file
      ? {
          name: it.file.name, type: it.file.type, size: it.file.size,
          ...(it.file.s3_key ? { s3_key: it.file.s3_key } : {}),
        }
      : undefined,
    added_on: it.date,
    deleted_on: it.deleted ?? null,
  };
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
  return body;
};

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
      safeSet(KEY, JSON.stringify(items));
    } catch (e) {
      console.error("Could not save data:", e);
    }
  }, [items, hydrated]);

  /* Local mutation first (instant UI), then a fire-and-forget mirror to the
   * backend. mirror() no-ops when sync is off and queues failures for retry,
   * so these calls never block or throw into the UI path. Soft-delete and
   * restore arrive here as update(it) with `deleted` set/cleared — toApi's
   * deleted_on carries that state through the same upsert. */
  const add = (it) => {
    setItems((xs) => [it, ...xs]);
    mirror("/items/upsert", { method: "POST", body: toApi(it) });
  };
  const update = (it) => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)));
    mirror("/items/upsert", { method: "POST", body: toApi(it) });
  };
  const remove = (id) => {
    /* Purge the stored body too, or deleting an item leaks an orphaned
     * object that nothing references and nobody is paying attention to.
     * Read the key before dropping the item — afterwards it is gone. */
    const key = items.find((x) => x.id === id)?.file?.s3_key;
    setItems((xs) => xs.filter((x) => x.id !== id));
    mirror(`/items/by-client/${encodeURIComponent(String(id))}`, { method: "DELETE" });
    if (key) mirror(`/files?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  };

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

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { today } from "@/lib/seed";
import { emptyBlock } from "./NoteBlocks";

/* Browse/search the user's Google Drive and import a file's text as a vault
 * doc. The backend fetches the content; we build the item here (client id,
 * localStorage, mirror) so it stays local-first and gets indexed for search. */
const KIND_LABEL = { gdoc: "Google Doc", gsheet: "Google Sheet", gslides: "Google Slides", gdrive: "Drive file" };

export default function GoogleDrivePicker({ open, onClose, onImport }) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(null);
  const [err, setErr] = useState("");

  const search = async (query) => {
    setErr(""); setLoading(true);
    try {
      setFiles(await api(`/google/drive/files${query ? `?q=${encodeURIComponent(query)}` : ""}`));
    } catch (e) {
      setErr(
        e?.status === 400 ? "Connect your Google account first — Settings → Connected apps."
        : e?.status === 403 ? "Drive access isn't granted — reconnect Google and allow Drive."
        : e?.status === 401 ? "Google session expired — reconnect in Settings."
        : "Couldn't reach Google Drive — try again."
      );
      setFiles([]);
    }
    setLoading(false);
  };

  useEffect(() => { if (open) { setQ(""); search(""); } }, [open]);

  if (!open) return null;

  const doImport = async (f) => {
    setImporting(f.id); setErr("");
    try {
      const r = await api("/google/drive/import", { method: "POST", body: { file_id: f.id } });
      onImport({
        id: Date.now(), type: "doc", title: r.title || f.name,
        url: r.web_view_link || null, cloud: r.cloud_kind || "gdrive",
        meta: `${KIND_LABEL[r.cloud_kind] || "Drive file"} — imported from Google`,
        status: "Inbox", tags: [], date: today(),
        blocks: r.text ? [{ ...emptyBlock("text"), text: r.text }] : undefined,
      });
      onClose();
    } catch {
      setErr("Couldn't import that file — try again.");
      setImporting(null);
    }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, width: "min(560px,100%)", maxHeight: "80vh", overflow: "auto", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Import from Google Drive</h3>
          <button className="kbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="bar" style={{ marginBottom: 12 }}>
          <input placeholder="Search your Drive…  (Enter)" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search(q)}
            aria-label="Search Google Drive" />
          <button className="btn" onClick={() => search(q)} disabled={loading}>{loading ? "…" : "Search"}</button>
        </div>
        {err && <div className="kmerr" role="status" style={{ marginBottom: 10 }}>{err}</div>}
        {!err && loading && <div className="m" style={{ color: "var(--ink-soft)" }}>Loading your Drive…</div>}
        {!err && !loading && files.length === 0 && <div className="m" style={{ color: "var(--ink-soft)" }}>No files found.</div>}
        {files.map((f) => (
          <div key={f.id} className="conn-row">
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 10 }}>{f.name}</span>
            <button className="btn sm" onClick={() => doImport(f)} disabled={!!importing}>
              {importing === f.id ? "Importing…" : "Import"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

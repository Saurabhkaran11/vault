import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, STATUSES, fmtStamp, daysAgo, ytId } from "../data/seed.js";
import NoteBlocks from "./NoteBlocks.jsx";

/* file type badge (Tessera document-library pattern) */
const fileKind = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return ["PDF", "pdf"];
  if (/^docx?$|^txt$|^md$/.test(ext)) return ["DOC", "doc"];
  if (/^xlsx?$|^csv$/.test(ext)) return ["XLS", "doc"];
  if (/^png$|^jpe?g$|^webp$|^gif$/.test(ext)) return ["IMG", "doc"];
  if (ext === "epub") return ["EPUB", "doc"];
  return ["FILE", "doc"];
};

/* dataURL → Blob URL (blob: renders far more reliably than data: for PDFs) */
const toBlobUrl = (file) => {
  const [head, b64] = file.data.split(",");
  const mime = (head.match(/data:([^;]+)/) || [])[1] || file.type || "application/octet-stream";
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([u8], { type: mime }));
};

/* In-app preview: PDFs in an embedded viewer, images inline, text decoded. */
function FilePreview({ file }) {
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  useEffect(() => {
    const isText = /\.(txt|md|csv)$/i.test(file.name) || /text|markdown|csv/.test(file.type);
    if (isText) {
      try { setText(atob(file.data.split(",")[1])); } catch { setText("Could not decode this file."); }
      return;
    }
    const u = toBlobUrl(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (text !== null) return <pre className="fpreview ftext">{text.slice(0, 20000)}</pre>;
  if (!url) return null;
  if (/^image\//.test(file.type)) return <img className="fpreview" src={url} alt={file.name} />;
  if (/pdf/.test(file.type) || /\.pdf$/i.test(file.name)) {
    return (
      <object className="fpreview fpdf" data={url} type="application/pdf" aria-label={`Preview of ${file.name}`}>
        <div className="empty" style={{ padding: 18 }}>
          Your browser can't display PDFs inline here — <a href={url} target="_blank" rel="noreferrer">open it in a new tab</a> or use the download button.
        </div>
      </object>
    );
  }
  return (
    <div className="empty" style={{ padding: 18 }}>
      No inline preview for this file type — <a href={url} target="_blank" rel="noreferrer">open it</a> or download it above.
    </div>
  );
}

/* Linked resources under a Library item: attach any notes, videos or
   documents to a book/PDF, and jump straight to them in their section. */
function LinkPanel({ it, all, onUpdate, onGoto }) {
  const [sel, setSel] = useState("");
  const linked = (it.links || []).map((id) => all.find((x) => x.id === id)).filter(Boolean);
  const candidates = all.filter(
    (x) => x.id !== it.id && x.type !== "book" && !(it.links || []).includes(x.id)
  );
  return (
    <div className="linkpanel">
      {linked.length === 0 && (
        <div className="m" style={{ marginBottom: 6 }}>
          Nothing linked yet — attach the notes, videos and documents that belong with this reading.
        </div>
      )}
      {linked.map((l) => {
        const s = SECTIONS[l.type];
        return (
          <div key={l.id} className="linkrow">
            <span className="linkic" style={{ background: s.soft, color: s.color }} aria-hidden="true">{s.icon}</span>
            <span className="linktitle">{l.title}</span>
            <button className="linkgo" onClick={() => onGoto(l)}
              title={`Open this in the ${s.label} section`}>Open in {s.label} →</button>
            <button className="linkdel" title="Unlink" aria-label={`Unlink ${l.title}`}
              onClick={() => onUpdate({ ...it, links: (it.links || []).filter((id) => id !== l.id) })}>✕</button>
          </div>
        );
      })}
      <div className="linkadd">
        <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Choose a resource to link">
          <option value="">+ Link a note, video or document…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{SECTIONS[c.type].label}: {c.title}</option>
          ))}
        </select>
        <button className="btn sm" disabled={!sel}
          onClick={() => { onUpdate({ ...it, links: [...(it.links || []), Number(sel)] }); setSel(""); }}>
          Link
        </button>
      </div>
    </div>
  );
}

export default function ItemRow({ it, onTag, onUpdate, onRemove, allItems = [], onGoto, focus, onOpen }) {
  const s = SECTIONS[it.type];
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.meta);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [aliasEdit, setAliasEdit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const rowRef = useRef(null);
  const badge = it.file ? fileKind(it.file.name) : null;

  const domain = (() => { try { return it.url ? new URL(it.url).hostname : null; } catch { return null; } })();
  const displayTitle = it.alias || it.title;
  const vsize = it.vsize || "md"; // video size preset: sm | md | lg | full
  const wordCount = (it.blocks || [])
    .flatMap((b) => [b.text || "", ...(b.kind === "table" ? b.rows.flat() : [])])
    .join(" ").trim().split(/\s+/).filter(Boolean).length;
  const firstText = (it.blocks || []).find((b) => b.text && b.text.trim());
  const editedDays = it.edited ? daysAgo(it.edited) : null;

  /* when navigated to from a link, scroll into view and flash */
  useEffect(() => {
    if (focus && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focus]);
  const vid = it.type === "video" ? ytId(it.url) : null;
  const hasBlocks = it.type === "note" || it.type === "doc";
  const nBlocks = (it.blocks || []).length;
  const nTodos = (it.blocks || []).filter((b) => b.kind === "todo").length;
  const nDone = (it.blocks || []).filter((b) => b.kind === "todo" && b.done).length;

  return (
    <div className={`row ${focus ? "flash" : ""}`} ref={rowRef}>
      <div className="icbox" style={{ background: s.soft, color: s.color }} aria-hidden="true">{s.icon}</div>
      <div className="body">
        <div className="t">
          {badge && <span className={`typebadge ${badge[1]}`}>{badge[0]}</span>}
          {domain && (
            <img className="fav" alt="" width="16" height="16" loading="lazy"
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
              onError={(e) => { e.target.style.display = "none"; }} />
          )}
          <span className="ttext">
            {it.url && !vid
              ? <a href={it.url} target="_blank" rel="noreferrer">{displayTitle} ↗</a>
              : displayTitle}
          </span>
          {onUpdate && (
            <button className={`pinbtn ${it.pinned ? "on" : ""}`}
              title={it.pinned ? "Unpin" : "Pin to top"} aria-pressed={!!it.pinned}
              onClick={() => onUpdate({ ...it, pinned: !it.pinned })}>★</button>
          )}
          {onRemove && (
            <button className="del" title="Delete item"
              onClick={() => onRemove(it.id)}>✕</button>
          )}
        </div>
        {it.alias && (
          <div className="origtitle" title={it.title}>{it.title}{domain ? ` · ${domain}` : ""}</div>
        )}
        {!it.alias && domain && <div className="origtitle">{domain}</div>}

        {/* Notion-style click-to-edit body */}
        <div className="m" onClick={() => !editing && onUpdate && setEditing(true)}
          title={onUpdate ? "Click to edit" : undefined} style={{ cursor: onUpdate ? "text" : "default" }}>
          {editing ? (
            <textarea autoFocus value={draft} rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { setEditing(false); onUpdate({ ...it, meta: draft }); }} />
          ) : it.meta}
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
          <span className="pill" style={{ background: s.soft, color: s.color }}>{s.label}</span>
          {it.tags.map((t) => (
            <button key={t} className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)" }}
              onClick={() => onTag(t)} title={`Open the “${t}” project — all linked resources`}>#{t}</button>
          ))}
          {onUpdate && (
            <select className="status" value={it.status} aria-label="Status"
              onChange={(e) => onUpdate({ ...it, status: e.target.value })}>
              {STATUSES.map((st) => <option key={st}>{st}</option>)}
            </select>
          )}
          {vid && (
            <button className="btn sm" style={{ marginTop: 8, marginLeft: 4, background: playing ? "var(--ink-soft)" : "var(--stamp)" }}
              onClick={() => setPlaying((p) => !p)}>{playing ? "Close player" : "▶ Watch here"}</button>
          )}
          {it.type === "note" || it.type === "doc" ? null : null}
          {hasBlocks && onUpdate && (
            <>
              <button className="bexpand" onClick={() => setShowBlocks((v) => !v)}
                aria-expanded={showBlocks}>
                <span aria-hidden="true">{showBlocks ? "▾" : "▸"}</span> {it.type === "doc" ? "Open editor" : "Blocks"}
                {nBlocks > 0 && <span className="bcount">{nTodos ? `${nDone}/${nTodos} done · ` : ""}{nBlocks}</span>}
              </button>
              {onOpen && (
                <button className="bexpand" onClick={onOpen}
                  title="Open this as a full page">⤢ Open page</button>
              )}
            </>
          )}
          {it.file && (
            <>
              <a className="filechip" href={it.file.data} download={it.file.name}
                title={`Download ${it.file.name}`}>
                ⬇ {it.file.name} <span className="bcount">{Math.round(it.file.size / 1024)} KB</span>
              </a>
              <button className="bexpand" onClick={() => setShowPreview((v) => !v)}
                aria-expanded={showPreview} title="Read this file without leaving Vault">
                👁 {showPreview ? "Close preview" : "Preview"}
              </button>
            </>
          )}
        </div>

        {showPreview && it.file && <FilePreview file={it.file} />}

        {/* Library: reading progress + short title + linked resources */}
        {it.type === "book" && onUpdate && (
          <>
            <div className="readrow">
              <span className="readlabel">Progress</span>
              <input type="range" min="0" max="100" step="1" value={it.progress || 0}
                aria-label="Reading progress"
                onChange={(e) => onUpdate({ ...it, progress: +e.target.value, status: +e.target.value >= 100 ? "Done" : +e.target.value > 0 ? "In progress" : it.status })} />
              <span className="readpct mono">{it.progress || 0}%</span>
              <button className="bexpand" style={{ marginTop: 0 }} onClick={() => setAliasEdit((v) => !v)}
                title="Give this item a short display title">✎ Short title</button>
              <button className="bexpand" style={{ marginTop: 0 }} onClick={() => setShowLinks((v) => !v)}
                aria-expanded={showLinks}>
                <span aria-hidden="true">{showLinks ? "▾" : "▸"}</span> Linked resources
                {(it.links || []).length > 0 && <span className="bcount">{(it.links || []).length}</span>}
              </button>
            </div>
            {aliasEdit && (
              <input className="aliasinput" defaultValue={it.alias || ""} autoFocus
                placeholder="Short display title — e.g. “DDIA book” (blank to reset)"
                onBlur={(e) => { setAliasEdit(false); onUpdate({ ...it, alias: e.target.value.trim() || undefined }); }}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
            )}
            {showLinks && (
              <LinkPanel it={it} all={allItems} onUpdate={onUpdate} onGoto={onGoto} />
            )}
          </>
        )}

        {/* collapsed preview of block content (research: note previews) */}
        {hasBlocks && !showBlocks && (it.blocks || []).length > 0 && (
          <div className="bpreview">
            {firstText ? `${firstText.text.slice(0, 90)}${firstText.text.length > 90 ? "…" : ""}` : "Structured content"}
            <span className="bcount"> · {wordCount} words{editedDays !== null ? ` · edited ${editedDays === 0 ? "today" : `${editedDays}d ago`}` : ""}</span>
          </div>
        )}

        {hasBlocks && showBlocks && onUpdate && (
          <NoteBlocks blocks={it.blocks || []}
            onChange={(blocks) => onUpdate({ ...it, blocks })} />
        )}

        {playing && vid && (
          <>
            <div className="vsizes" role="group" aria-label="Player size">
              {[["sm", "S"], ["md", "M"], ["lg", "L"], ["full", "⛶ Full"]].map(([k, label]) => (
                <button key={k} className={vsize === k ? "on" : ""}
                  onClick={() => onUpdate && onUpdate({ ...it, vsize: k })}
                  aria-pressed={vsize === k} title={{ sm: "Small (426px)", md: "Medium (640px)", lg: "Large (854px)", full: "Full width" }[k]}>
                  {label}
                </button>
              ))}
            </div>
            <div className={`player ${vsize}`}>
              <iframe src={`https://www.youtube.com/embed/${vid}`} title={it.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            </div>
          </>
        )}
      </div>
      <div className="stamp">Added · {fmtStamp(it.date)}</div>
    </div>
  );
}

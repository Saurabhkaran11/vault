"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, STATUSES, fmtStamp, daysAgo, ytId } from "@/lib/seed";
import { detectCloud } from "@/lib/cloud";
import NoteBlocks from "./NoteBlocks";
import { Ic } from "./Icons";
import { resolveFileUrl, fileBodyMissing, formatSize } from "@/lib/files";
import { relatedTo } from "@/lib/embed";
import { extractTextFromImage } from "@/lib/ocr";

/* Inline tag adder: type any custom tag (Enter) or pick an existing one. */
export function TagAdder({ it, onUpdate, allItems = [] }) {
  const [open, setOpen] = useState(false);
  const [txt, setTxt] = useState("");
  let custom = [];
  try { custom = (JSON.parse(localStorage.getItem("vault.tags.v1") || "{}").custom) || []; } catch {}
  const existing = [...new Set([...allItems.flatMap((x) => x.tags), ...custom])].filter((t) => !it.tags.includes(t));
  const commit = () => {
    const t = txt.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
    if (t && !it.tags.includes(t)) onUpdate({ ...it, tags: [...it.tags, t] });
    setTxt(""); setOpen(false);
  };
  if (!open) return (
    <button type="button" className="pill addtag" onClick={() => setOpen(true)}
      title="Add a tag — type your own or pick an existing one">＋ tag</button>
  );
  return (
    <span className="tagaddwrap">
      <input autoFocus list={`tags-${it.id}`} value={txt} placeholder="type a tag…"
        aria-label="Add tag"
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setTxt(""); setOpen(false); } }}
        onBlur={commit} />
      <datalist id={`tags-${it.id}`}>{existing.map((t) => <option key={t} value={t} />)}</datalist>
    </span>
  );
}

/* file type badge (document-library pattern) */
const fileKind = (name) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return ["PDF", "pdf"];
  if (/^docx?$|^rtf$|^odt$|^txt$|^md$|^json$|^log$/.test(ext)) return ["DOC", "doc"];
  if (/^xlsx?$|^csv$|^ods$/.test(ext)) return ["XLS", "doc"];
  if (/^pptx?$|^key$|^odp$/.test(ext)) return ["PPT", "doc"];
  if (/^png$|^jpe?g$|^webp$|^gif$|^svg$/.test(ext)) return ["IMG", "doc"];
  if (/^mp3$|^m4a$|^wav$|^ogg$/.test(ext)) return ["AUDIO", "doc"];
  if (/^mp4$|^webm$|^mov$/.test(ext)) return ["VIDEO", "doc"];
  if (ext === "epub") return ["EPUB", "doc"];
  return ["FILE", "doc"];
};

/* dataURL → Blob URL (blob: renders far more reliably than data: for PDFs) */
const toBlobUrl = (file) => {
  const comma = file.data.indexOf(",");
  const head = file.data.slice(0, comma), body = file.data.slice(comma + 1);
  const mime = (head.match(/data:([^;]+)/) || [])[1] || file.type || "application/octet-stream";
  /* uploads are always base64, but tolerate percent-encoded data URIs too —
     a text body goes straight into the Blob, which handles UTF-8 itself */
  if (!/;base64/i.test(head)) {
    return URL.createObjectURL(new Blob([decodeURIComponent(body)], { type: mime }));
  }
  const bin = atob(body);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([u8], { type: mime }));
};

/* Download works from either shape. A local body is already a URL; a bucket
 * body needs a signed one, which can only be fetched on demand — presigned
 * links expire, so resolving them up-front for every row would hand out a
 * page full of dead links. Hence a button that resolves at click time. */
function FileDownload({ file, className = "btn sm", children }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (file.data) {
    return (
      <a className={className} style={{ textDecoration: "none" }} href={file.data} download={file.name}>
        {children}
      </a>
    );
  }
  if (!file.s3_key && !file.fid) return null;   // nothing to download — caller explains why

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const url = await resolveFileUrl(file);
      if (!url) throw new Error("no longer in storage");
      if (file.fid) {
        /* IndexedDB body: a blob URL has no server headers, so drive the
           download with an explicit anchor to keep the filename */
        const a = document.createElement("a");
        a.href = url; a.download = file.name || "file";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return;
      }
      /* The signed URL already carries a Content-Disposition, so a plain
         navigation downloads it with the right filename. */
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr(e?.message || "unavailable");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={className} onClick={go} disabled={busy}
      title={err ? `Couldn't fetch this file — ${err}` : undefined}>
      {busy ? "Preparing…" : err ? "⚠ Unavailable" : children}
    </button>
  );
}

/* What can a browser actually show? Everything else gets an honest,
 * helpful card instead of a dead end. */
const previewKind = (file) => {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (/^(txt|md|csv|json|log)$/.test(ext) || /text|markdown|csv|json/.test(file.type)) return "text";
  if (/^(png|jpe?g|webp|gif|svg)$/.test(ext) || /^image\//.test(file.type)) return "image";
  if (ext === "pdf" || /pdf/.test(file.type)) return "pdf";
  if (/^(mp3|m4a|wav|ogg)$/.test(ext) || /^audio\//.test(file.type)) return "audio";
  if (/^(mp4|webm|mov)$/.test(ext) || /^video\//.test(file.type)) return "video";
  if (/^(docx?|odt|pages|rtf)$/.test(ext)) return "word";
  if (/^(xlsx?|numbers|ods)$/.test(ext)) return "sheet";
  if (/^(pptx?|key|odp)$/.test(ext)) return "slides";
  if (ext === "epub") return "ebook";
  return "other";
};
const APP_FOR = { word: "Word / Google Docs / Pages", sheet: "Excel / Google Sheets / Numbers", slides: "PowerPoint / Slides / Keynote", ebook: "Apple Books / Calibre / your e-reader" };

/* In-app preview: PDFs, images, text, audio and video render inline in a
 * RESIZABLE viewer (drag the bottom-right corner) with a ⛶ fullscreen mode.
 * Office/ebook formats can't be rendered by any browser without conversion,
 * so they get a clear card: download + how to make it viewable. */
function FilePreview({ file }) {
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [full, setFull] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const kind = previewKind(file);

  /* Four shapes reach this component:
   *   · `data`   — a legacy local base64 body, available immediately
   *   · `fid`    — a Blob in IndexedDB (the normal local shape now)
   *   · `s3_key` — in the bucket; needs a short-lived signed URL first
   *   · none     — the body only ever lived in another browser
   * The async branches are why this isn't just toBlobUrl(). */
  useEffect(() => {
    let alive = true;
    let objectUrl = null;
    setLoadErr(null); setUrl(null); setText(null);

    (async () => {
      if (file.data) {
        if (kind === "text") {
          try { setText(atob(file.data.split(",")[1])); }
          catch { setText("Could not decode this file."); }
          return;
        }
        objectUrl = toBlobUrl(file);
        if (alive) setUrl(objectUrl); else URL.revokeObjectURL(objectUrl);
        return;
      }

      if (file.fid) {
        const blobUrl = await resolveFileUrl(file);
        if (!alive) { if (blobUrl) URL.revokeObjectURL(blobUrl); return; }
        if (!blobUrl) { setLoadErr("This file's body is missing from this browser."); return; }
        if (kind === "text") {
          try {
            const res = await fetch(blobUrl);
            const body = await res.text();
            if (alive) setText(body);
          } catch { if (alive) setText("Could not decode this file."); }
          URL.revokeObjectURL(blobUrl);
          return;
        }
        objectUrl = blobUrl;
        setUrl(blobUrl);
        return;
      }

      if (file.s3_key) {
        try {
          const signed = await resolveFileUrl(file);
          if (!alive) return;
          if (!signed) { setLoadErr("This file is no longer in storage."); return; }
          if (kind === "text") {
            const res = await fetch(signed);
            if (!res.ok) throw new Error(`status ${res.status}`);
            const body = await res.text();
            if (alive) setText(body);
            return;
          }
          setUrl(signed);
        } catch (e) {
          if (alive) setLoadErr(`Couldn't load this file — ${e?.message || "storage is unreachable"}.`);
        }
        return;
      }

      if (alive) setLoadErr(null);   // body-missing case, handled below
    })();

    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file, kind]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setFull(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full]);

  /* Body unreachable: name and size synced, bytes did not. Say exactly that
     rather than rendering an empty viewer. */
  if (fileBodyMissing(file)) {
    return (
      <div className="fnopreview">
        <div className="fnp-head">☁ <b>{file.name}</b> was saved on another device.</div>
        <div className="fnp-tip">
          Only its details synced — the file itself stayed in the browser that saved it.
          Turn on file storage (Settings → Backend sync) and re-upload it to keep future
          files available everywhere.
        </div>
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="fnopreview">
        <div className="fnp-head">⚠ <b>{file.name}</b></div>
        <div className="fnp-tip">{loadErr}</div>
      </div>
    );
  }

  const inner = (fullMode) => {
    if (kind === "text") return <pre className={fullMode ? "ftext ftext-full" : "ftext"}>{(text || "").slice(0, 40000)}</pre>;
    if (!url) return null;
    if (kind === "image") return <img src={url} alt={file.name} style={{ maxWidth: "100%", maxHeight: "100%", display: "block", margin: "0 auto", objectFit: "contain" }} />;
    if (kind === "pdf") return (
      <object data={url} type="application/pdf" aria-label={`Preview of ${file.name}`} style={{ width: "100%", height: "100%", display: "block" }}>
        <div className="empty" style={{ padding: 18 }}>
          This browser can't embed PDFs — <a href={url} target="_blank" rel="noreferrer">open in a new tab</a> or download above.
        </div>
      </object>
    );
    if (kind === "audio") return <audio controls src={url} style={{ width: "100%", padding: 14 }} aria-label={`Play ${file.name}`} />;
    if (kind === "video") return <video controls src={url} style={{ width: "100%", maxHeight: "100%", display: "block" }} aria-label={`Play ${file.name}`} />;
    return null;
  };

  /* office / ebook / unknown → honest guidance, no dead ends */
  if (["word", "sheet", "slides", "ebook", "other"].includes(kind)) {
    const ext = (file.name.split(".").pop() || "file").toUpperCase();
    return (
      <div className="fnopreview">
        <div className="fnp-head">📄 <b>.{ext.toLowerCase()}</b> files can't be shown inside a browser — that's a browser limit, not a lost file.</div>
        <div className="fnp-actions">
          <FileDownload file={file}>⬇ Download &amp; open in {APP_FOR[kind] || "its app"}</FileDownload>
        </div>
        <div className="fnp-tip">
          Tips: export it as <b>PDF</b> to read it right here · or keep it in Google Docs/Sheets and paste the link in the bar above — then it's one click away.
          {kind !== "other" && " Your file is stored safely either way."}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fviewbar">
        <span className="cardsub mono">{kind.toUpperCase()} · drag the corner to resize</span>
        {(kind === "pdf" || kind === "image" || kind === "video") && (
          <button className="kbtn" onClick={() => setFull(true)} title="Read it full-screen (Esc closes)">⛶ Full screen</button>
        )}
      </div>
      <div className={`fpreview fwrap fwrap-${kind}`}>{inner(false)}</div>
      {full && (
        <div className="theater-overlay" role="dialog" aria-label={`${file.name} — full screen`}
          onClick={() => setFull(false)}>
          <div className="theater" onClick={(e) => e.stopPropagation()}>
            <div className="theater-bar">
              <span className="theater-title">{file.name}</span>
              <button className="theater-close" onClick={() => setFull(false)}>✕ Close (Esc)</button>
            </div>
            <div className="theater-doc">{inner(true)}</div>
          </div>
        </div>
      )}
    </>
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
            <span className="linkic" style={{ background: s.soft, color: s.color }} aria-hidden="true"><Ic name={s.ic} /></span>
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

export default function ItemRow({ it, onTag, onUpdate, onRemove, allItems = [], onGoto, focus, onOpen, folders = [] }) {
  const [newFolder, setNewFolder] = useState(false);
  const pickFolder = (v) => {
    if (v === "__new") { setNewFolder(true); return; }   // inline input, not window.prompt (blocked in embedded browsers)
    onUpdate({ ...it, folder: v || undefined });
  };
  const saveNewFolder = (raw) => {
    const name = (raw || "").trim();
    if (name) onUpdate({ ...it, folder: name });
    setNewFolder(false);
  };
  const s = SECTIONS[it.type];
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(it.meta);
  const [showBlocks, setShowBlocks] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [aliasEdit, setAliasEdit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [dateEdit, setDateEdit] = useState(false);
  const [rel, setRel] = useState(null);          // null | [{item}] | {empty:true}
  const [relBusy, setRelBusy] = useState(false);
  const [ocrPct, setOcrPct] = useState(null);    // null | 0..1 while reading
  const [ocrErr, setOcrErr] = useState("");
  const rowRef = useRef(null);
  const badge = it.file ? fileKind(it.file.name) : null;

  const domain = (() => { try { return it.url ? new URL(it.url).hostname : null; } catch { return null; } })();
  const displayTitle = it.alias || it.title;
  const vsize = it.vsize === "full" ? "lg" : (it.vsize || "md"); // sm | md | lg ("full" is legacy → lg)
  const [theater, setTheater] = useState(false); // ⛶ full = theater overlay

  /* Esc closes the theater overlay */
  useEffect(() => {
    if (!theater) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setTheater(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [theater]);
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
  /* What kind of thing is this row?
   * · note                      → block editor is the content
   * · doc + file                → a FILE: view/download, never note tools
   * · doc + cloud/url           → lives in its own app: open there
   * · doc, no file, no url      → a WRITTEN document: the editor IS it */
  const cloud = it.type === "doc" && it.url ? detectCloud(it.url) : null;
  const isFileDoc = it.type === "doc" && (!!it.file || !!cloud || !!it.url);
  const hasBlocks = it.type === "note" || (it.type === "doc" && !isFileDoc);
  const nBlocks = (it.blocks || []).length;
  const nTodos = (it.blocks || []).filter((b) => b.kind === "todo").length;
  const nDone = (it.blocks || []).filter((b) => b.kind === "todo" && b.done).length;

  return (
    <div className={`row ${focus ? "flash" : ""}`} ref={rowRef}>
      <div className="icbox" style={{ background: s.soft, color: s.color }} data-tip={s.label}><Ic name={s.ic} /></div>
      <div className="body">
        <div className="t">
          {it.cloud && detectCloud(it.url || "") && (
            <span className="typebadge cloud" title={`${detectCloud(it.url).label} — stored in its own app, linked here`}>
              ☁ {detectCloud(it.url).badge}
            </span>
          )}
          {badge && <span className={`typebadge ${badge[1]}`}>{badge[0]}</span>}
          {domain && (
            <img className="fav" alt="" width="16" height="16" loading="lazy"
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
              onError={(e) => { e.target.style.display = "none"; }} />
          )}
          <span className="ttext">
            {it.url && !vid
              ? <a href={it.url} target="_blank" rel="noreferrer">{displayTitle} ↗</a>
              : it.type === "doc" && it.file
                ? <a role="button" tabIndex={0} style={{ cursor: "pointer" }} title="View this document"
                    onClick={() => setShowPreview((v) => !v)}
                    onKeyDown={(e) => e.key === "Enter" && setShowPreview((v) => !v)}>{displayTitle}</a>
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
            <span key={t} className="pillwrap">
              <button className="pill" style={{ background: "var(--violet-soft)", color: "var(--violet)", marginRight: 0 }}
                onClick={() => onTag(t)} title={`Open the “${t}” project — all linked resources`}>#{t}</button>
              {onUpdate && (
                <button className="pillx" title={`Remove #${t} from this item`} aria-label={`Remove tag ${t}`}
                  onClick={() => onUpdate({ ...it, tags: it.tags.filter((x) => x !== t) })}>✕</button>
              )}
            </span>
          ))}
          {onUpdate && <TagAdder it={it} onUpdate={onUpdate} allItems={allItems} />}
          {onGoto && allItems.length > 3 && (
            <button className="bexpand" style={{ marginTop: 0 }} disabled={relBusy}
              title="Items about the same thing — local semantic search, nothing leaves this machine"
              onClick={async () => {
                if (rel) { setRel(null); return; }
                setRelBusy(true);
                try { const r = await relatedTo(it, allItems, 4); setRel(r.length ? r : { empty: true }); }
                catch { setRel({ empty: true }); }
                finally { setRelBusy(false); }
              }}>≈ {relBusy ? "Finding…" : "Related"}</button>
          )}
          {/* Documents are personal files to edit freely — no workflow status there */}
          {onUpdate && it.type !== "doc" && (
            <select className="status" value={it.status} aria-label="Status"
              onChange={(e) => onUpdate({ ...it, status: e.target.value })}>
              {STATUSES.map((st) => <option key={st}>{st}</option>)}
            </select>
          )}
          {it.type === "note" && onUpdate && (
            <select className="status" value={it.folder || ""} aria-label="Folder"
              onChange={(e) => pickFolder(e.target.value)} title="Move this note to a folder">
              <option value="">No folder</option>
              {folders.map((f) => <option key={f} value={f}>▸ {f}</option>)}
              <option value="__new">＋ New folder…</option>
            </select>
          )}
          {it.type === "note" && onUpdate && newFolder && (
            <input className="status folder-new" autoFocus placeholder="Folder name… (Enter)" aria-label="New folder name"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNewFolder(e.target.value);
                if (e.key === "Escape") setNewFolder(false);
              }}
              onBlur={(e) => saveNewFolder(e.target.value)} />
          )}
          {vid && (
            <button className="btn sm" style={{ marginTop: 8, marginLeft: 4, background: playing ? "var(--ink-soft)" : "var(--stamp)" }}
              onClick={() => setPlaying((p) => !p)}>{playing ? "Close player" : "▶ Watch here"}</button>
          )}
          {it.type === "note" || it.type === "doc" ? null : null}
          {/* FILE documents: one obvious primary action — view it (like ▶ Watch here on videos) */}
          {it.type === "doc" && it.file && (
            <button className="btn sm" style={{ marginTop: 8, background: showPreview ? "var(--ink-soft)" : "var(--blue)" }}
              onClick={() => setShowPreview((v) => !v)}
              title="Read this file right here, without leaving Vault">
              {showPreview ? "Close viewer" : "👁 View document"}
            </button>
          )}
          {/* image files: pull the text out with local OCR so it becomes
              searchable — the description field is where search looks */}
          {it.type === "doc" && it.file && (it.file.data || it.file.fid) && !fileBodyMissing(it.file) &&
            previewKind(it.file) === "image" && onUpdate && (
            <button className="btn sm" style={{ marginTop: 8, marginLeft: 4, background: "var(--violet)" }}
              disabled={ocrPct != null}
              title="Read the text in this image (runs on this machine; first use downloads ~15MB)"
              onClick={async () => {
                setOcrErr(""); setOcrPct(0);
                try {
                  const src = it.file.data || (await resolveFileUrl(it.file));
                  if (!src) throw new Error("This file's body isn't available in this browser.");
                  const text = await extractTextFromImage(src, setOcrPct);
                  if (!text) setOcrErr("No readable text in this image.");
                  else onUpdate({ ...it, meta: [it.meta, text.slice(0, 600)].filter(Boolean).join(" — ") });
                } catch (e) { setOcrErr(e.message); }
                finally { setOcrPct(null); }
              }}>
              {ocrPct != null ? `Reading… ${Math.round(ocrPct * 100)}%` : "⌕ Extract text"}
            </button>
          )}
          {ocrErr && <span className="m" style={{ color: "var(--stamp)" }}>{ocrErr}</span>}
          {it.type === "doc" && !it.file && cloud && (
            <a className="btn sm" style={{ marginTop: 8, background: "var(--blue)", textDecoration: "none" }}
              href={it.url} target="_blank" rel="noreferrer"
              title={`Opens in ${cloud.label} — it lives there, Vault keeps the link`}>
              ↗ Open in {cloud.label}
            </a>
          )}
          {hasBlocks && onUpdate && (
            <>
              <button className="bexpand" onClick={() => setShowBlocks((v) => !v)}
                aria-expanded={showBlocks}>
                <span aria-hidden="true">{showBlocks ? "▾" : "▸"}</span> {it.type === "doc" ? "✎ Write" : "Blocks"}
                {nBlocks > 0 && <span className="bcount">{nTodos ? `${nDone}/${nTodos} done · ` : ""}{nBlocks}</span>}
              </button>
              {onOpen && (
                <button className="bexpand" onClick={onOpen}
                  title="Open this as a full page">⤢ Open page</button>
              )}
            </>
          )}
          {it.file && (fileBodyMissing(it.file) ? (
            <span className="filechip" title="Saved on another device — only the details synced">
              ☁ {it.file.name} <span className="bcount">details only</span>
            </span>
          ) : (
            <FileDownload file={it.file} className="filechip">
              ⬇ {it.file.name} <span className="bcount">{formatSize(it.file.size)}</span>
            </FileDownload>
          ))}
        </div>

        {rel && (Array.isArray(rel) ? (
          <div className="relrow">
            <span className="mono relhead">RELATED</span>
            {rel.map(({ item }) => (
              <button key={item.id} className="filechip" onClick={() => onGoto && onGoto(item)}
                title={`Open “${item.title}”`}>≈ {item.alias || item.title}</button>
            ))}
          </div>
        ) : (
          <div className="m" style={{ marginTop: 4, color: "var(--ink-soft)" }}>
            No related items yet — build the search index in Settings → Semantic search.
          </div>
        ))}

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

        {/* collapsed preview of block content */}
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

        {playing && vid && !theater && (
          <>
            <div className="vsizes" role="group" aria-label="Player size">
              {[["sm", "S"], ["md", "M"], ["lg", "L"]].map(([k, label]) => (
                <button key={k} className={vsize === k ? "on" : ""}
                  onClick={() => onUpdate && onUpdate({ ...it, vsize: k })}
                  aria-pressed={vsize === k} title={{ sm: "Small (426px)", md: "Medium (640px)", lg: "Large — fills the row" }[k]}>
                  {label}
                </button>
              ))}
              <button onClick={() => setTheater(true)} title="Theater mode — large player over the page (Esc to close)">⛶ Full</button>
            </div>
            <div className={`player ${vsize}`}>
              <iframe src={`https://www.youtube.com/embed/${vid}`} title={it.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            </div>
          </>
        )}

        {playing && vid && theater && (
          <div className="theater-overlay" onClick={() => setTheater(false)} role="dialog" aria-label={`Theater mode: ${it.title}`}>
            <div className="theater" onClick={(e) => e.stopPropagation()}>
              <div className="theater-bar">
                <span className="theater-title">{displayTitle}</span>
                <button className="theater-close" onClick={() => setTheater(false)} title="Close theater (Esc)">✕ Close</button>
              </div>
              <div className="player" style={{ maxWidth: "100%", marginTop: 0 }}>
                <iframe src={`https://www.youtube.com/embed/${vid}?autoplay=1`} title={it.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen />
              </div>
            </div>
          </div>
        )}
      </div>
      {onUpdate && dateEdit ? (
        <input type="date" className="stampedit" autoFocus value={it.date} aria-label="Move this item to another day"
          onChange={(e) => e.target.value && onUpdate({ ...it, date: e.target.value })}
          onBlur={() => setDateEdit(false)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setDateEdit(false)} />
      ) : (
        <button type="button" className={`stamp stampbtn ${onUpdate ? "" : "static"}`}
          onClick={onUpdate ? () => setDateEdit(true) : undefined}
          title={onUpdate ? "Wrong day? Click to move this item to another date" : undefined}>
          Added · {fmtStamp(it.date)}
        </button>
      )}
    </div>
  );
}

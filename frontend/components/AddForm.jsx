"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, GENERIC_TAGS, today, ytId } from "@/lib/seed";
import { askJSON, aiEnabled } from "@/lib/ai";
import { storeFile, fileStorageEnabled, formatSize } from "@/lib/files";

/* Paste-a-link smart capture via the free noembed.com oEmbed proxy. */
async function fetchTitle(url) {
  const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
  const data = await res.json();
  if (data && data.title) return { title: data.title, author: data.author_name || "" };
  throw new Error("no title");
}

const FILE_ICONS = { pdf: "▨", doc: "❏", docx: "❏", txt: "≡", md: "≡", epub: "▤", csv: "▦", png: "▣", jpg: "▣", jpeg: "▣", webp: "▣" };
const fileIcon = (name) => FILE_ICONS[(name.split(".").pop() || "").toLowerCase()] || "❏";

/* Token/chip tag input (Notion multi-select / GitHub labels pattern):
   type + Enter/comma creates a tag; autocomplete suggests existing tags;
   a "Create new tag" row appears for anything new; Backspace removes. */
function TagInput({ tags, setTags, existing }) {
  const [txt, setTxt] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const commit = (raw) => {
    const t = raw.trim().toLowerCase().replace(/^#/, "");
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTxt("");
  };
  const q = txt.trim().toLowerCase().replace(/^#/, "");
  const sugg = existing.filter((t) => !tags.includes(t) && (!q || t.includes(q))).slice(0, 6);
  const isNew = q && !existing.includes(q) && !tags.includes(q);

  return (
    <div className="taginput" onClick={() => inputRef.current?.focus()}>
      {tags.map((t) => (
        <span key={t} className="tchip">#{t}
          <button type="button" aria-label={`Remove tag ${t}`}
            onClick={(e) => { e.stopPropagation(); setTags(tags.filter((x) => x !== t)); }}>✕</button>
        </span>
      ))}
      <input ref={inputRef} value={txt} role="combobox" aria-expanded={open} aria-label="Add tags"
        placeholder={tags.length ? "Add another tag…" : "Type any custom tag and press Enter…"}
        onChange={(e) => { setTxt(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(txt); }
          if (e.key === "Backspace" && !txt && tags.length) setTags(tags.slice(0, -1));
          if (e.key === "Escape") setOpen(false);
        }} />
      {open && (sugg.length > 0 || isNew) && (
        <div className="tagdrop" role="listbox">
          {sugg.map((t) => (
            <button type="button" key={t} onMouseDown={(e) => { e.preventDefault(); commit(t); }}>#{t}</button>
          ))}
          {isNew && (
            <button type="button" className="tagnew"
              onMouseDown={(e) => { e.preventDefault(); commit(q); }}>＋ Create new tag “{q}”</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AddForm({ section, existingTags = [], onAdd, onClose }) {
  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState([]);
  const [type, setType] = useState(section in SECTIONS ? section : "note");
  const [hint, setHint] = useState("");
  const [hintOk, setHintOk] = useState(false);
  const [err, setErr] = useState("");
  const [file, setFile] = useState(null);
  const [fileErr, setFileErr] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  /* The storage key is built from the item's id, so the id has to exist
     before the upload — not at save time. Minted once per open form, and
     reused on submit so the key and the item always agree. Kept numeric
     because "was this created by the user" checks read `+id > 1e12`. */
  const draftId = useRef(Date.now());
  /* Only used to label the size cap honestly — the actual decision lives in
     storeFile(), so a stale value here can never route bytes wrongly. */
  const [storageOn, setStorageOn] = useState(false);
  useEffect(() => { let live = true; fileStorageEnabled().then((on) => live && setStorageOn(on)); return () => { live = false; }; }, []);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);
  /* You arrived from a section, so the SHAPE of what you're adding is already
     known. Show only that shape's primary input; everything else — section,
     tags, folder — lives behind "More options". This is item 2: a note asked
     for a Link, a Section, a Status and a Folder before you could write a word. */
  const [more, setMore] = useState(false);

  const NEEDS = {
    note:  { link: false, file: false },   // just write
    video: { link: true,  file: false },   // paste the URL
    book:  { link: true,  file: true  },   // a title, plus a file or link
    doc:   { link: true,  file: true  },   // upload, or link
  };
  const needs = NEEDS[type] || NEEDS.note;

  const selected = useMemo(() => new Set(tags), [tags]);
  const suggestions = useMemo(() => {
    const own = existingTags.filter((t) => !GENERIC_TAGS.includes(t));
    return [...own, ...GENERIC_TAGS.filter((t) => !own.includes(t))];
  }, [existingTags]);
  const toggleTag = (t) =>
    setTags(selected.has(t) ? tags.filter((x) => x !== t) : [...tags, t]);

  /* ✦ AI tag suggestions — reuses your existing tag vocabulary first */
  const [suggBusy, setSuggBusy] = useState(false);
  const [suggErr, setSuggErr] = useState("");
  const suggestTags = async () => {
    if (suggBusy) return;
    if (!title.trim() && !meta.trim() && !url.trim()) { setSuggErr("Give it a title or link first, so AI has something to tag."); return; }
    setSuggBusy(true); setSuggErr("");
    try {
      const out = await askJSON(
        `Item to tag: "${title}"${meta ? ` — ${meta}` : ""}${url ? ` (${url})` : ""}.\n` +
        `Existing tags in this vault: ${existingTags.join(", ") || "none yet"}.\n` +
        `Suggest 1-3 project tags. STRONGLY prefer reusing existing tags when they fit; only invent a new short lowercase tag when nothing existing applies.`,
        {
          type: "object",
          properties: { tags: { type: "array", items: { type: "string" } } },
          required: ["tags"],
          additionalProperties: false,
        },
        { effort: "low", maxTokens: 2000 }
      );
      const clean = out.tags
        .map((t) => t.toLowerCase().trim().replace(/^#/, "").replace(/\s+/g, "-"))
        .filter(Boolean).slice(0, 3);
      if (!clean.length) { setSuggErr("No suggestions came back — tag it by hand."); return; }
      setTags((prev) => [...new Set([...prev, ...clean])]);
    } catch (e) {
      setSuggErr(e.message);
    } finally {
      setSuggBusy(false);
    }
  };

  /* Visible drop zone + click-to-browse (never drag-only).
   *
   * storeFile() decides where the bytes go: the bucket when file storage is
   * configured (bigger cap, and the file follows you to other devices), the
   * browser otherwise. The form only cares that it gets something back to
   * attach to the item. */
  const handleFiles = async (list) => {
    const f = list && list[0];
    if (!f) return;
    setFileErr("");
    setFileBusy(true);
    try {
      const stored = await storeFile(draftId.current, f);
      setFile(stored);
      if (stored.localOnlyReason) {
        setFileErr(`Saved in this browser only — ${stored.localOnlyReason}. It won't appear on your other devices.`);
      }
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
      if (/pdf|epub/i.test(f.name.split(".").pop()) && type === "note") setType("book");
      else if (type === "note" && !/image/.test(f.type)) setType("doc");
    } catch (err) {
      setFileErr(err?.message || `Could not save “${f.name}”.`);
    } finally {
      setFileBusy(false);
    }
  };

  const onUrl = async (value) => {
    setUrl(value);
    const v = value.trim();
    if (!v.startsWith("http")) return;
    if (ytId(v)) setType("video");
    if (title.trim()) return;
    setHint("Fetching title…"); setHintOk(false);
    try {
      const { title: t, author } = await fetchTitle(v);
      setTitle(t);
      if (author && !meta.trim()) setMeta(author);
      setHint(`Auto-filled from link${author ? ` · ${author}` : ""}`); setHintOk(true);
    } catch {
      setHint("Couldn't auto-fetch a title — type one in"); setHintOk(false);
    }
  };

  const save = (blank = false) => {
    if (!title.trim() && !blank) { setErr("Enter a title first"); return; }
    onAdd({
      id: draftId.current, type: blank ? "doc" : type,
      title: title.trim() || "Untitled document",
      meta: meta.trim() || (blank ? "Blank document — open the editor to start writing" : "—"),
      url: url.trim() || undefined, status: "Inbox",
      tags,
      file: file || undefined,
      blocks: blank ? [{ id: "p" + Date.now(), kind: "text", text: "", indent: 0 }] : undefined,
      date: today(),
    });
    onClose();
  };

  return (
    <div className="form addform2">
      {/* Primary input, chosen by what you're adding. */}
      {needs.link && (
        <>
          <input className="full addf-primary" autoFocus={type === "video"}
            placeholder={type === "video" ? "Paste a YouTube link…" : "Paste a link — we'll fill in the title"}
            value={url} onChange={(e) => onUrl(e.target.value)} aria-label="Link" />
          {hint && <div className={`hint ${hintOk ? "ok" : ""}`}>{hint}</div>}
        </>
      )}

      {needs.file && (
        <>
          {(type === "doc" || type === "book") && needs.link && <div className="addf-or">or</div>}
          <div className={`dropzone full ${dragOver ? "over" : ""}`} role="button" tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            aria-label="Upload a file: drag it here or press Enter to browse">
            <div className="dz-main">
              {fileBusy ? "⏳ Saving file…" : <>⬆ <b>Drag a file here</b> or click to browse</>}
            </div>
            <div className="dz-types">
              <span>PDF</span><span>DOC</span><span>EPUB</span><span>CSV</span><span>TXT</span><span>IMG</span>
              <span className="dz-cap">{storageOn ? "· up to 25 MB" : "· max 2 MB in this browser"}</span>
            </div>
            <input ref={fileRef} type="file" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
              accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.csv,.json,.log,.epub,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.svg,.mp3,.m4a,.wav,.mp4,.webm" />
          </div>
        </>
      )}
      {file && (
        <div className="fileprev full">
          <span className="fico" aria-hidden="true">{fileIcon(file.name)}</span>
          <span className="fname">{file.name}</span>
          <span className="fsize">{formatSize(file.size)}</span>
          <button type="button" aria-label="Remove attached file" onClick={() => setFile(null)}>✕</button>
        </div>
      )}
      {fileErr && <div className="hint full" style={{ color: "var(--stamp)" }}>{fileErr}</div>}

      {/* Title: primary for a note, secondary (auto-filled) for the rest. */}
      <input className="full addf-primary" autoFocus={type === "note"}
        placeholder={type === "note" ? "Title" : "Title (auto-filled from the link or file)"}
        value={title}
        onChange={(e) => { setTitle(e.target.value); setErr(""); }} aria-label="Title" />
      {err && <div className="hint" style={{ color: "var(--stamp)" }}>{err}</div>}

      <input className="full" placeholder={type === "note" ? "Start writing, or add a one-line summary…" : "Short note / why it matters"}
        value={meta} onChange={(e) => setMeta(e.target.value)} aria-label="Note" />

      {/* Everything optional lives here, closed by default. */}
      <button type="button" className="addf-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        {more ? "Fewer options" : "More options"}
        <span aria-hidden="true">{more ? " ▴" : " ▾"}</span>
        {!more && (tags.length > 0 || SECTIONS[type]) && (
          <span className="addf-more-hint">{SECTIONS[type].label}{tags.length ? ` · ${tags.length} tag${tags.length === 1 ? "" : "s"}` : ""}</span>
        )}
      </button>

      {more && (
        <div className="addf-advanced full">
          <label className="addf-field">
            <span>Section</span>
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Section">
              {Object.entries(SECTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>

          <div className="addf-field">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Tags
              <button type="button" className="aibtn" disabled={suggBusy || !aiEnabled()} onClick={suggestTags}
                title={aiEnabled() ? "Suggest tags from what you've written" : "Choose an AI model in Settings to enable"}>
                {suggBusy ? "Suggesting…" : "✦ Suggest"}
              </button>
              {suggErr && <span className="aierr">⚠ {suggErr}</span>}
            </span>
            <TagInput tags={tags} setTags={setTags} existing={suggestions} />
            <div className="quicktags" style={{ marginTop: 8 }}>
              {suggestions.slice(0, 10).map((t) => (
                <button key={t} type="button"
                  className={`qtag ${selected.has(t) ? "on" : ""}`}
                  onClick={() => toggleTag(t)}
                  aria-pressed={selected.has(t)}>#{t}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        {type === "note" && (
          <button className="btn ghost" onClick={() => save(true)}
            title="Creates an empty page with a block editor">
            ✎ Blank page
          </button>
        )}
        <button className="btn" onClick={() => save(false)}>
          {type === "note" ? "Create note" : type === "video" ? "Save video" : type === "book" ? "Add to library" : "Add"}
        </button>
      </div>
    </div>
  );
}

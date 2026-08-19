"use client";

/* Cloud-file link detection: lets users attach their Google Docs, Sheets,
 * Slides, Drive files, OneDrive/Excel, Dropbox and Notion pages as first-
 * class Documents. Frontend-first: we store the link + kind and deep-link
 * out; two-way OAuth sync (live previews, search inside files) arrives
 * with the backend. */

const KINDS = [
  { kind: "gdoc",    label: "Google Doc",    badge: "DOC",   re: /docs\.google\.com\/document/i },
  { kind: "gsheet",  label: "Google Sheet",  badge: "SHEET", re: /docs\.google\.com\/spreadsheets/i },
  { kind: "gslides", label: "Google Slides", badge: "SLIDES", re: /docs\.google\.com\/presentation/i },
  { kind: "gform",   label: "Google Form",   badge: "FORM",  re: /docs\.google\.com\/forms/i },
  { kind: "gdrive",  label: "Google Drive",  badge: "DRIVE", re: /drive\.google\.com/i },
  { kind: "excel",   label: "Excel Online",  badge: "XLS",   re: /(onedrive\.live\.com|1drv\.ms|sharepoint\.com).*\.xlsx|office\.com.*excel|excel\.office/i },
  { kind: "onedrive", label: "OneDrive",     badge: "DRIVE", re: /onedrive\.live\.com|1drv\.ms|sharepoint\.com/i },
  { kind: "dropbox", label: "Dropbox",       badge: "FILE",  re: /dropbox\.com/i },
  { kind: "notion",  label: "Notion page",   badge: "PAGE",  re: /notion\.so|notion\.site/i },
];

export function detectCloud(url) {
  if (!/^https?:\/\//i.test(url || "")) return null;
  for (const k of KINDS) if (k.re.test(url)) return { kind: k.kind, label: k.label, badge: k.badge };
  return null;
}

/* A readable default title from a cloud URL (until the user renames it). */
export function cloudTitle(url, cloud) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(seg[seg.length - 1] || "")
      .replace(/[-_+]/g, " ").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
    if (last && !/^(edit|view|d|u|s|folders?|file)$/i.test(last) && last.length > 2 && !/^[a-zA-Z0-9]{15,}$/.test(last))
      return last.slice(0, 70);
  } catch {}
  return cloud ? `${cloud.label} (untitled)` : url.slice(0, 70);
}

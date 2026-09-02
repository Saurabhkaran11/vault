"use client";

/* Per-feature report generator. Each report is a self-contained HTML file
 * (inline styles, no dependencies) built from the live stores — open it,
 * print it to PDF, or keep it as a snapshot. The backend later swaps these
 * client builders for server-rendered PDFs without touching the UI. */

const CUR = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥", CAD: "C$", AUD: "A$" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const daysAgo = (iso) => Math.floor((new Date(today()) - new Date(iso)) / 86400000);

/* reports follow the app-wide Daily/Weekly/Monthly/Yearly toggle */
const RANGE_DAYS = { day: 1, week: 7, month: 31, year: 365 };
const RANGE_WORD = { day: "today", week: "this week", month: "this month", year: "this year" };
let RANGE = "week";
const rDays = () => RANGE_DAYS[RANGE] || 7;
const rWord = () => RANGE_WORD[RANGE] || "this week";
const inRange = (iso) => !!iso && daysAgo(iso) >= 0 && daysAgo(iso) <= rDays();

const stat = (label, value, note = "") =>
  `<div class="stat"><div class="v">${esc(value)}</div><div class="k">${esc(label)}</div>${note ? `<div class="n">${esc(note)}</div>` : ""}</div>`;
const table = (heads, rows) =>
  `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const section = (title, body) => `<h2>${esc(title)}</h2>${body}`;

function itemsOf(type) {
  return read("vault.items.v1", []).filter((i) => !i.deleted && (!type || i.type === type));
}

function notesReport() {
  const notes = itemsOf("note");
  const week = notes.filter((n) => inRange(n.date)).length;
  const folders = {};
  notes.forEach((n) => { const f = n.folder || "No folder"; folders[f] = (folders[f] || 0) + 1; });
  const tags = {};
  notes.forEach((n) => n.tags.forEach((t) => { tags[t] = (tags[t] || 0) + 1; }));
  return {
    title: "Notes", stats: [stat("Total notes", notes.length), stat(`Added ${rWord()}`, week), stat("Pinned", notes.filter((n) => n.pinned).length), stat("Folders", Object.keys(folders).filter((f) => f !== "No folder").length)],
    body: section("By folder", table(["Folder", "Notes"], Object.entries(folders).sort((a, b) => b[1] - a[1]).map(([f, n]) => [f, n])))
      + section("Top tags", table(["Tag", "Notes"], Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, n]) => [`#${t}`, n])))
      + section("Recent notes", table(["Title", "Added", "Tags"], notes.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((n) => [n.title, n.date, n.tags.map((t) => `#${t}`).join(" ") || "—"]))),
  };
}

function videosReport() {
  const vids = itemsOf("video");
  const done = vids.filter((v) => v.status === "Done").length;
  return {
    title: "YouTube", stats: [stat("Saved videos", vids.length), stat(`Saved ${rWord()}`, vids.filter((v) => inRange(v.date)).length), stat("Watched", done), stat("In the queue", vids.length - done)],
    body: section("Queue", table(["Video", "Status", "Saved", "Tags"], vids.sort((a, b) => b.date.localeCompare(a.date)).map((v) => [v.alias || v.title, v.status, v.date, v.tags.map((t) => `#${t}`).join(" ") || "—"]))),
  };
}

function libraryReport() {
  const books = itemsOf("book");
  const reading = books.filter((b) => (b.progress || 0) > 0 && (b.progress || 0) < 100);
  const avg = reading.length ? Math.round(reading.reduce((a, b) => a + b.progress, 0) / reading.length) : 0;
  return {
    title: "Library", stats: [stat("Books & PDFs", books.length), stat("In progress", reading.length), stat("Average progress", `${avg}%`), stat("Finished", books.filter((b) => (b.progress || 0) >= 100).length)],
    body: section("Reading list", table(["Title", "Progress", "Status", "Linked resources"], books.map((b) => [b.alias || b.title, `${b.progress || 0}%`, b.status, (b.links || []).length]))),
  };
}

function docsReport() {
  const docs = itemsOf("doc");
  const files = docs.filter((d) => d.file);
  const cloud = docs.filter((d) => d.cloud);
  const written = docs.filter((d) => !d.file && !d.url);
  const bytes = files.reduce((a, d) => a + (d.file.size || 0), 0);
  return {
    title: "Documents", stats: [stat("Total", docs.length), stat(`Added ${rWord()}`, docs.filter((d) => inRange(d.date)).length), stat("Uploaded files", files.length, `${Math.round(bytes / 1024)} KB stored`), stat("Cloud links", cloud.length)],
    body: section("All documents", table(["Name", "Kind", "Added"], docs.map((d) => [d.title, d.file ? (d.file.name.split(".").pop() || "file").toUpperCase() : d.cloud ? "Cloud link" : "Written", d.date]))),
  };
}

function todosReport() {
  const tasks = read("vault.todos.v1", {}).tasks || [];
  const t0 = today();
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < t0);
  const doneRange = tasks.filter((t) => t.done && t.doneAt && inRange(t.doneAt));
  const hoursRange = tasks.flatMap((t) => t.hlog || []).filter((e) => inRange(e.d)).reduce((a, e) => a + (+e.h || 0), 0);
  const rate = tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : 0;
  return {
    title: "To-dos", stats: [stat("Open", open.length, `${overdue.length} overdue`), stat(`Done ${rWord()}`, doneRange.length), stat(`Hours ${rWord()}`, hoursRange ? `${Math.round(hoursRange * 4) / 4}h` : "—"), stat("Completion rate", `${rate}%`, "all time")],
    body: section("Overdue", overdue.length ? table(["Task", "Was due"], overdue.map((t) => [t.text, t.due])) : "<p>Nothing overdue. 🎉</p>")
      + section("Due in the next 7 days", table(["Task", "Due", "Priority"], open.filter((t) => t.due && t.due >= t0 && daysAgo(t.due) >= -7).sort((a, b) => a.due.localeCompare(b.due)).map((t) => [t.text, t.due, t.high ? "⚑ high" : "—"])))
      + section("Recently completed", table(["Task", "Done on"], tasks.filter((t) => t.done && t.doneAt).sort((a, b) => b.doneAt.localeCompare(a.doneAt)).slice(0, 10).map((t) => [t.text, t.doneAt]))),
  };
}

function boardsReport() {
  const boards = read("vault.boards.v1", {}).boards || [];
  const body = boards.map((b) => {
    const sprints = b.sprints || [];
    const cards = b.cols.flatMap((c) => c.cards.map((k) => ({ ...k, col: c.title })));
    const bySprint = sprints.map((s) => {
      const sc = cards.filter((k) => k.sprint === s.id);
      const done = sc.filter((k) => /done|complete|shipped|finished/i.test(k.col)).length;
      const hours = sc.reduce((a, k) => a + (+k.hours || 0), 0);
      return [s.name + (s.ended ? ` (closed ${s.ended})` : " (active)"), sc.length, done, hours ? `${hours}h` : "—"];
    });
    return section(`Board: ${b.name}`,
      table(["Sprint", "Tasks", "Done", "Hours logged"], bySprint)
      + table(["Column", "Tasks"], b.cols.map((c) => [c.title, c.cards.length])));
  }).join("");
  const total = boards.reduce((a, b) => a + b.cols.reduce((x, c) => x + c.cards.length, 0), 0);
  return {
    title: "Boards & Sprints", stats: [stat("Boards", boards.length), stat("Total tasks", total), stat("Sprints", boards.reduce((a, b) => a + (b.sprints || []).length, 0))],
    body: body || "<p>No custom boards yet.</p>",
  };
}

function financeReport() {
  const fin = read("vault.finance.v1", {});
  const sym = CUR[fin.currency] || "$";
  const f = (n) => `${sym}${(+n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const exp = (fin.expenses || []).filter((e) => inRange(e.date));
  const spent = exp.reduce((a, e) => a + e.amount, 0);
  const byCat = {}; exp.forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
  const methods = fin.payMethods || [];
  const byPay = {}; exp.forEach((e) => { const m = methods.find((x) => x.id === e.pay)?.name || "—"; byPay[m] = (byPay[m] || 0) + e.amount; });
  const income = (fin.incomes || []).filter((i) => inRange(i.date)).reduce((a, i) => a + i.amount, 0);
  const pending = (fin.bills || []).filter((b) => !b.paid);
  const budget = +(fin.budgets?.overall) || 0;
  return {
    title: "Finance", stats: [
      stat(`Spent ${rWord()}`, f(spent), budget && RANGE === "month" ? `${Math.round((spent / budget) * 100)}% of ${f(budget)} budget` : ""),
      stat(`Income ${rWord()}`, f(income)),
      stat("Savings rate", income > 0 ? `${Math.round(((income - spent) / income) * 100)}%` : "—"),
      stat("Bills pending", pending.length, f(pending.reduce((a, b) => a + b.amount, 0))),
    ],
    body: section("Spending by category", table(["Category", "Amount"], Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, f(v)])))
      + section("Spending by payment method", table(["Method", "Amount"], Object.entries(byPay).sort((a, b) => b[1] - a[1]).map(([m, v]) => [m, f(v)])))
      + section("Pending bills", table(["Bill", "Amount", "Due", "Recurring"], pending.sort((a, b) => a.due.localeCompare(b.due)).map((b) => [b.title, f(b.amount), b.due, b.recur || "one-time"])))
      + section("Budgets", table(["Scope", "Cap", "Spent"], [["Overall", budget ? f(budget) : "—", f(spent)], ...Object.entries(fin.budgets?.byCat || {}).map(([c, cap]) => [c, f(cap), f(byCat[c] || 0)])]))
      + section("Savings goals", table(["Goal", "Saved", "Target"], (fin.goals || []).map((g) => [g.name, f(g.saved), f(g.target)]))),
  };
}

const BUILDERS = { note: notesReport, video: videosReport, book: libraryReport, doc: docsReport, todos: todosReport, boards: boardsReport, finance: financeReport };

export const REPORTS = [
  { id: "all", label: "Everything — full vault report" },
  { id: "note", label: "Notes" },
  { id: "video", label: "YouTube" },
  { id: "book", label: "Library" },
  { id: "doc", label: "Documents" },
  { id: "todos", label: "To-dos" },
  { id: "boards", label: "Boards & Sprints" },
  { id: "finance", label: "Finance" },
];

const SHELL_CSS = `
  body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#16283C;margin:0;background:#fff}
  .page{max-width:820px;margin:0 auto;padding:40px 28px}
  header{border-bottom:3px solid #1F5FA8;padding-bottom:14px;margin-bottom:24px}
  .brand{font-size:13px;letter-spacing:2px;color:#1F5FA8;font-weight:700;text-transform:uppercase}
  h1{font-size:30px;margin:6px 0 2px} .when{color:#54677C;font-size:13px}
  h2{font-size:17px;margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid #D7E0EA}
  .stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:18px}
  .stat{flex:1;min-width:150px;border:1px solid #D7E0EA;border-radius:10px;padding:12px 14px}
  .stat .v{font-size:24px;font-weight:700} .stat .k{font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#54677C;margin-top:2px}
  .stat .n{font-size:11px;color:#1F5FA8;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 4px}
  th{text-align:left;font-size:10.5px;letter-spacing:1px;text-transform:uppercase;color:#54677C;border-bottom:2px solid #D7E0EA;padding:6px 8px}
  td{border-bottom:1px solid #EDF1F6;padding:7px 8px;vertical-align:top}
  footer{margin-top:34px;padding-top:12px;border-top:1px solid #D7E0EA;font-size:11px;color:#54677C}
  p{font-size:13.5px}
  @media print{.page{padding:0} .stat{break-inside:avoid} table{break-inside:auto}}
`;

export function buildReportHTML(id, range = "week") {
  RANGE = RANGE_DAYS[range] ? range : "week";
  const parts = id === "all"
    ? Object.values(BUILDERS).map((b) => b())
    : [BUILDERS[id]()];
  const titleText = id === "all" ? "Full Vault report" : `${parts[0].title} report`;
  const inner = parts.map((p) => `
    ${id === "all" ? `<h1 style="font-size:22px;margin-top:36px">${esc(p.title)}</h1>` : ""}
    <div class="stats">${p.stats.join("")}</div>
    ${p.body}`).join("<hr style='border:none;margin:8px 0'>");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Vault — ${esc(titleText)}</title><style>${SHELL_CSS}</style></head>
<body><div class="page">
  <header><div class="brand">Vault</div><h1>${esc(titleText)}</h1><div class="when">Generated ${today()} · window: ${rWord()} · data lives in your browser</div></header>
  ${inner}
  <footer>Generated by Vault · print this page to save it as a PDF (Ctrl/Cmd+P)</footer>
</div></body></html>`;
  return { html, filename: `vault-report-${id}-${today()}.html` };
}

export function downloadReport(id, range) {
  const { html, filename } = buildReportHTML(id, range);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function openReport(id, range) {
  const { html } = buildReportHTML(id, range);
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

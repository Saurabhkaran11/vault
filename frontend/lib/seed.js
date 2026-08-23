export const SECTIONS = {
  note:  { label: "Notes",     color: "var(--moss)",  soft: "var(--moss-soft)",  icon: "✎", ic: "note" },
  video: { label: "YouTube",   color: "var(--azure)", soft: "var(--azure-soft)", icon: "▶", ic: "video" },
  book:  { label: "Library",   color: "var(--gold)",  soft: "var(--gold-soft)",  icon: "▤", ic: "book" },
  doc:   { label: "Documents", color: "var(--blue)",  soft: "var(--blue-soft)",  icon: "❏", ic: "doc" },
};

export const STATUSES = ["Inbox", "In progress", "Done"];

/* Generic starter tags offered as one-tap chips in the add form.
   Users can always type fully custom tags as well. */
export const GENERIC_TAGS = [
  "learning", "project", "work", "ideas", "coding", "career",
  "business", "finance", "health", "reading", "reference", "inspiration",
];

export const fmtStamp = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/* Compact count formatting so dashboards stay legible at B2B scale — a team
 * vault holds thousands of tasks and documents, and "12,438" as "12.4k" reads
 * at a glance while small counts keep their exact value. */
export const fmtK = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 10000) return v.toLocaleString();
  if (Math.abs(v) < 1e6) return `${(v / 1e3).toFixed(v % 1e3 === 0 ? 0 : 1)}k`;
  return `${(v / 1e6).toFixed(1)}M`;
};

export const daysAgo = (iso) =>
  Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);

export const ytId = (url) => {
  const m = (url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
};

export const today = () => new Date().toISOString().slice(0, 10);

/* First-run sample data — delete items freely, or wipe via Export → edit → Import.
   The samples deliberately exercise every feature: folders, pinned items,
   aliases, every block kind (heading, image, sub-page, table…), reading
   progress, linked resources, and one item in Recently Deleted. */
const SAMPLE_IMG =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='120'><rect width='420' height='120' rx='10' fill='#E3EBE2'/><text x='22' y='50' font-family='monospace' font-size='17' fill='#3E5C48'>request → router → service → repo</text><text x='22' y='84' font-family='monospace' font-size='12' fill='#5B6657'>FastAPI flow — sample image block</text></svg>`
  );

export const seed = [
  { id: 1, type: "note",  title: "FastAPI project — architecture notes", meta: "Routers → services → repos. Pydantic v2 models everywhere; OAuth2 password flow first, JWT later.", tags: ["fastapi"], status: "In progress", date: "2026-07-30", folder: "Engineering", pinned: true,
    blocks: [
      { id: "b0", kind: "heading", text: "Build checklist" },
      { id: "b1", kind: "todo", text: "Scaffold project with routers/services/repos layout", done: true },
      { id: "b2", kind: "todo", text: "Add OAuth2 password flow", done: false },
      { id: "b3", kind: "todo", text: "Write tests for the auth dependency", done: false },
      { id: "b7", kind: "heading", text: "Principles" },
      { id: "b4", kind: "bullet", text: "Use Pydantic v2 models for request AND response schemas" },
      { id: "b5", kind: "bullet", text: "Keep DB session as a yielded dependency" },
      { id: "b8", kind: "image", src: SAMPLE_IMG, name: "request-flow.svg" },
      { id: "b6", kind: "table", rows: [["Endpoint", "Method", "Auth"], ["/users", "POST", "public"], ["/token", "POST", "public"], ["/items", "GET", "bearer"]] },
      { id: "b9", kind: "page", title: "Deployment checklist (sub-page)", blocks: [
        { id: "b9a", kind: "todo", text: "Dockerfile + compose", done: false },
        { id: "b9b", kind: "todo", text: "Health check endpoint", done: false },
      ] },
    ] },
  { id: 2, type: "video", title: "FastAPI full course (beginner → deploy)", url: "https://www.youtube.com/watch?v=0sOvCWFmrtA", meta: "freeCodeCamp · watched up to 2:40:00", tags: ["fastapi"], status: "In progress", date: "2026-08-01" },
  { id: 3, type: "video", title: "FastAPI + PostgreSQL in 20 minutes", url: "https://www.youtube.com/watch?v=398DuQbQJq0", meta: "DB session dependency pattern", tags: ["fastapi"], status: "Inbox", date: "2026-08-05" },
  { id: 4, type: "book",  title: "FastAPI docs — Advanced User Guide (PDF export)", meta: "Chapters: dependencies, middleware, background tasks", tags: ["fastapi"], status: "Inbox", date: "2026-08-07", progress: 10, links: [1, 2, 5] },
  { id: 5, type: "doc",   title: "FastAPI project README (generated)", meta: "Setup, env vars, run commands — draft v1", tags: ["fastapi", "github"], status: "Done", date: "2026-08-10" },
  { id: 6, type: "note",  title: "SaaS pricing — value metric ideas", meta: "3 tiers, anchor on usage not seats.", tags: ["business"], status: "Inbox", date: "2026-06-29", folder: "Ideas" },
  { id: 7, type: "video", title: "System design interview — full course", url: "https://www.youtube.com/watch?v=F2FmTdLtb_4", meta: "Watch sections 2–4", tags: ["engineering"], status: "Inbox", date: "2026-07-04" },
  { id: 8, type: "book",  title: "Designing Data-Intensive Applications", meta: "PDF · reread ch. 5 on replication", tags: ["engineering"], status: "In progress", date: "2026-07-27", progress: 42, links: [7], alias: "DDIA" },
  { id: 9, type: "doc",   title: "Portfolio README rewrite", meta: "Draft v2 · needs screenshots", tags: ["github"], status: "In progress", date: "2026-08-02" },
  { id: 10, type: "note", title: "Reading queue rule: 2-in, 1-out", meta: "Add two items → finish one before the next add.", tags: ["productivity"], status: "Done", date: "2026-08-11", folder: "Habits" },
  /* sample for the Recently Deleted feature — restore or purge it freely */
  { id: 11, type: "doc",  title: "Old cover letter (draft)", meta: "Superseded draft — lives in Recently Deleted as a demo; restore or delete forever.", tags: [], status: "Inbox", date: "2026-08-10", deleted: today() },
];

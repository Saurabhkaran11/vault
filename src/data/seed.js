export const SECTIONS = {
  note:  { label: "Notes",     color: "var(--moss)",  soft: "var(--moss-soft)",  icon: "✎" },
  video: { label: "YouTube",   color: "var(--stamp)", soft: "var(--stamp-soft)", icon: "▶" },
  book:  { label: "Library",   color: "var(--gold)",  soft: "var(--gold-soft)",  icon: "▤" },
  doc:   { label: "Documents", color: "var(--blue)",  soft: "var(--blue-soft)",  icon: "❏" },
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

export const daysAgo = (iso) =>
  Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);

export const ytId = (url) => {
  const m = (url || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
};

export const today = () => new Date().toISOString().slice(0, 10);

/* First-run sample data — delete items freely, or wipe via Export → edit → Import */
export const seed = [
  { id: 1, type: "note",  title: "FastAPI project — architecture notes", meta: "Routers → services → repos. Pydantic v2 models everywhere; OAuth2 password flow first, JWT later.", tags: ["fastapi"], status: "In progress", date: "2026-07-30",
    blocks: [
      { id: "b1", kind: "todo", text: "Scaffold project with routers/services/repos layout", done: true },
      { id: "b2", kind: "todo", text: "Add OAuth2 password flow", done: false },
      { id: "b3", kind: "todo", text: "Write tests for the auth dependency", done: false },
      { id: "b4", kind: "bullet", text: "Use Pydantic v2 models for request AND response schemas" },
      { id: "b5", kind: "bullet", text: "Keep DB session as a yielded dependency" },
      { id: "b6", kind: "table", rows: [["Endpoint", "Method", "Auth"], ["/users", "POST", "public"], ["/token", "POST", "public"], ["/items", "GET", "bearer"]] },
    ] },
  { id: 2, type: "video", title: "FastAPI full course (beginner → deploy)", url: "https://www.youtube.com/watch?v=0sOvCWFmrtA", meta: "freeCodeCamp · watched up to 2:40:00", tags: ["fastapi"], status: "In progress", date: "2026-08-01" },
  { id: 3, type: "video", title: "FastAPI + PostgreSQL in 20 minutes", url: "https://www.youtube.com/watch?v=398DuQbQJq0", meta: "DB session dependency pattern", tags: ["fastapi"], status: "Inbox", date: "2026-08-05" },
  { id: 4, type: "book",  title: "FastAPI docs — Advanced User Guide (PDF export)", meta: "Chapters: dependencies, middleware, background tasks", tags: ["fastapi"], status: "Inbox", date: "2026-08-07", progress: 10, links: [1, 2, 5] },
  { id: 5, type: "doc",   title: "FastAPI project README (generated)", meta: "Setup, env vars, run commands — draft v1", tags: ["fastapi", "github"], status: "Done", date: "2026-08-10" },
  { id: 6, type: "note",  title: "SaaS pricing — value metric ideas", meta: "3 tiers, anchor on usage not seats.", tags: ["business"], status: "Inbox", date: "2026-06-29" },
  { id: 7, type: "video", title: "System design interview — full course", url: "https://www.youtube.com/watch?v=F2FmTdLtb_4", meta: "Watch sections 2–4", tags: ["engineering"], status: "Inbox", date: "2026-07-04" },
  { id: 8, type: "book",  title: "Designing Data-Intensive Applications", meta: "PDF · reread ch. 5 on replication", tags: ["engineering"], status: "In progress", date: "2026-07-27", progress: 42, links: [7] },
  { id: 9, type: "doc",   title: "Portfolio README rewrite", meta: "Draft v2 · needs screenshots", tags: ["github"], status: "In progress", date: "2026-08-02" },
  { id: 10, type: "note", title: "Reading queue rule: 2-in, 1-out", meta: "Add two items → finish one before the next add.", tags: ["productivity"], status: "Done", date: "2026-08-11" },
];

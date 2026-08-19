/* Note templates — structured starters, matching the Tessera gallery. */

const uid = () => Math.random().toString(36).slice(2, 9);

export const TEMPLATES = [
  { cat: "RECURRING", title: "Meeting notes", desc: "Attendees, agenda, decisions and action items.",
    blocks: [
      { kind: "heading", text: "Attendees" }, { kind: "bullet", text: "" },
      { kind: "heading", text: "Agenda" }, { kind: "bullet", text: "" },
      { kind: "heading", text: "Decisions" }, { kind: "text", text: "" },
      { kind: "heading", text: "Action items" }, { kind: "todo", text: "", done: false },
    ] },
  { cat: "PRODUCT", title: "Feature spec", desc: "Problem, proposal, scope and open questions.",
    blocks: [
      { kind: "heading", text: "Problem" }, { kind: "text", text: "" },
      { kind: "heading", text: "Proposal" }, { kind: "text", text: "" },
      { kind: "heading", text: "Scope" }, { kind: "heading", text: "Open questions" },
    ] },
  { cat: "RESEARCH", title: "Research interview", desc: "Participant, questions, quotes and takeaways.",
    blocks: [
      { kind: "heading", text: "Participant" }, { kind: "text", text: "" },
      { kind: "heading", text: "Questions" }, { kind: "bullet", text: "" },
      { kind: "heading", text: "Quotes & takeaways" }, { kind: "todo", text: "Send follow-up", done: false },
    ] },
  { cat: "PERSONAL", title: "Weekly journal", desc: "Wins, blockers and focus for next week.",
    blocks: [
      { kind: "heading", text: "Wins" }, { kind: "bullet", text: "" },
      { kind: "heading", text: "Blockers" }, { kind: "bullet", text: "" },
      { kind: "heading", text: "Focus for next week" }, { kind: "todo", text: "", done: false },
    ] },
  { cat: "PERSONAL", title: "Reading notes", desc: "Source, summary and highlighted passages.",
    blocks: [
      { kind: "heading", text: "Source" }, { kind: "text", text: "" },
      { kind: "heading", text: "Summary" }, { kind: "text", text: "" },
      { kind: "heading", text: "Highlighted passages" },
    ] },
  { cat: "PRODUCT", title: "Project brief", desc: "Goal, scope, milestones and risks.",
    blocks: [
      { kind: "heading", text: "Goal" }, { kind: "text", text: "" },
      { kind: "heading", text: "Milestones" }, { kind: "todo", text: "Milestone 1", done: false },
      { kind: "todo", text: "Milestone 2", done: false }, { kind: "heading", text: "Risks" },
    ] },
  { cat: "RECURRING", title: "Task list", desc: "A plain checklist with a done section.",
    blocks: [
      { kind: "todo", text: "", done: false }, { kind: "todo", text: "", done: false },
      { kind: "todo", text: "", done: false }, { kind: "heading", text: "Done" },
      { kind: "text", text: "Drag finished items below this heading." },
    ] },
];

export const templateStats = (t) => ({
  blocks: t.blocks.length,
  tasks: t.blocks.filter((b) => b.kind === "todo").length,
});

export const instantiateTemplate = (t) =>
  t.blocks.map((b) => ({ id: uid(), indent: 0, ...b }));

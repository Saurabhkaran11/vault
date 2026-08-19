"use client";

/* Calendar export: open to-dos with due dates + unpaid bills become an
 * .ics file the user can import (or drag) into Google/Apple/Outlook
 * Calendar — their calendar then does the reminding. When the backend
 * lands this becomes a subscribable feed URL instead of a download. */

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const dstamp = (isoDate) => isoDate.replace(/-/g, "");

export function buildICS() {
  let tasks = [], bills = [];
  try { tasks = (JSON.parse(localStorage.getItem("vault.todos.v1") || "{}").tasks || []).filter((t) => !t.done && t.due); } catch {}
  try { bills = (JSON.parse(localStorage.getItem("vault.finance.v1") || "{}").bills || []).filter((b) => !b.paid && b.due); } catch {}

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Vault//Personal Hub//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Vault — due dates",
  ];
  const push = (uidSeed, date, summary, desc) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uidSeed}@vault.local`,
      `DTSTAMP:${dstamp(new Date().toISOString().slice(0, 10))}T000000Z`,
      `DTSTART;VALUE=DATE:${dstamp(date)}`,
      `SUMMARY:${esc(summary)}`,
      ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
      "BEGIN:VALARM",
      "TRIGGER:-PT9H",             // alert the morning of the due date
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(summary)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  };
  tasks.forEach((t) => push(`todo-${t.id}`, t.due, `${t.high ? "⚑ " : "☑ "}${t.text}`, "Vault to-do"));
  bills.forEach((b) => push(`bill-${b.id}`, b.due, `💳 ${b.title} — ${b.amount}`, "Vault bill due"));
  return { text: lines.join("\r\n") + "\r\n", count: tasks.length + bills.length };
}

/* ---- import the other direction: Google/Apple/Outlook → Vault ----
 * The user exports/downloads an .ics from their calendar (or uses a saved
 * one) and drops it here; events show up alongside to-dos. URL-subscribe
 * needs the backend proxy (calendar servers don't send CORS headers). */
export function parseICS(text) {
  const lines = text.split(/\r?\n/);
  // unfold: continuation lines start with a space/tab
  const flat = [];
  for (const l of lines) {
    if ((l.startsWith(" ") || l.startsWith("\t")) && flat.length) flat[flat.length - 1] += l.slice(1);
    else flat.push(l);
  }
  const events = [];
  let cur = null;
  let calName = "";
  for (const l of flat) {
    if (l.startsWith("X-WR-CALNAME:")) calName = l.slice(13).trim();
    if (l === "BEGIN:VEVENT") { cur = {}; continue; }
    if (l === "END:VEVENT") {
      if (cur?.date && cur?.summary) events.push(cur);
      cur = null; continue;
    }
    if (!cur) continue;
    if (l.startsWith("SUMMARY")) cur.summary = l.slice(l.indexOf(":") + 1).replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/g, " ").trim();
    if (l.startsWith("DTSTART")) {
      const v = l.slice(l.indexOf(":") + 1).trim();
      const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
      if (m) {
        cur.date = `${m[1]}-${m[2]}-${m[3]}`;
        if (m[4]) cur.time = `${m[4]}:${m[5]}`;
      }
    }
    if (l.startsWith("UID")) cur.uid = l.slice(l.indexOf(":") + 1).trim().slice(0, 80);
  }
  return { events, calName };
}

export function importICSFile(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const { events, calName } = parseICS(String(reader.result || ""));
    const cal = calName || file.name.replace(/\.ics$/i, "");
    let store;
    try { store = JSON.parse(localStorage.getItem("vault.calendar.v1") || "{}"); } catch { store = {}; }
    const existing = Array.isArray(store.events) ? store.events : [];
    const keep = existing.filter((e) => e.cal !== cal);   // re-import replaces that calendar
    const merged = [...keep, ...events.map((e, i) => ({ id: e.uid || `${cal}-${i}`, summary: e.summary, date: e.date, time: e.time, cal }))];
    localStorage.setItem("vault.calendar.v1", JSON.stringify({ version: 1, events: merged, importedAt: new Date().toISOString().slice(0, 10) }));
    cb?.({ added: events.length, cal, total: merged.length });
  };
  reader.readAsText(file);
}

export function getCalendarEvents() {
  try { return (JSON.parse(localStorage.getItem("vault.calendar.v1") || "{}").events) || []; } catch { return []; }
}

export function downloadICS() {
  const { text, count } = buildICS();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  a.download = "vault-due-dates.ics";
  a.click();
  URL.revokeObjectURL(a.href);
  return count;
}

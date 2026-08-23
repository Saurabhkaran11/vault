"use client";

import React from "react";
import { today } from "@/lib/seed";

/* Calendar views for To-dos: Week (7 columns), Month (a real calendar grid)
 * and Year (12 mini-months). Pure presentation — tasks in, day clicks out. */

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const d = (iso) => new Date(iso + "T00:00:00");
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const startOfWeek = (anchorIso) => {
  const a = d(anchorIso);
  const day = (a.getDay() + 6) % 7; // Monday = 0
  a.setDate(a.getDate() - day);
  return a;
};

const tasksOn = (tasks, dayIso) => tasks.filter((t) => t.due === dayIso);

function TaskChip({ t, onClick }) {
  const late = !t.done && t.due < today();
  return (
    <button className={`tcal-chip ${t.done ? "done" : late ? "late" : t.high ? "high" : ""}`}
      title={`${t.text}${t.done ? " — done" : late ? " — overdue" : ""} (open this day)`}
      onClick={onClick}>
      {t.high && !t.done ? "⚑ " : ""}{t.text.length > 18 ? t.text.slice(0, 16) + "…" : t.text || "…"}
    </button>
  );
}

function EventChip({ e }) {
  return (
    <span className="tchip calchip" title={`${e.summary} · from your “${e.cal}” calendar${e.time ? ` · ${e.time}` : ""}`}>
      📅 {e.summary.length > 16 ? e.summary.slice(0, 14) + "…" : e.summary}
    </span>
  );
}
const eventsOn = (events, dayIso) => (events || []).filter((e) => e.date === dayIso);

export function WeekView({ tasks, anchor, onPickDay, events = [] }) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
  return (
    <div className="tweek">
      {days.map((day) => {
        const dayIso = iso(day);
        const list = tasksOn(tasks, dayIso).sort((a, b) => (b.high ? 1 : 0) - (a.high ? 1 : 0));
        const evs = eventsOn(events, dayIso);
        const isToday = dayIso === today();
        return (
          <div key={dayIso} className={`tweek-col ${isToday ? "istoday" : ""}`}>
            <button className="tweek-head" onClick={() => onPickDay(dayIso)} title="Open this day">
              <span className="mono dow">{DOW[(day.getDay() + 6) % 7]}</span>
              <span className={`daynum ${isToday ? "on" : ""}`}>{day.getDate()}</span>
            </button>
            {list.length === 0 && evs.length === 0 && <div className="tweek-empty">—</div>}
            {evs.map((e) => <EventChip key={e.id} e={e} />)}
            {list.map((t) => <TaskChip key={t.id} t={t} onClick={() => onPickDay(dayIso)} />)}
          </div>
        );
      })}
    </div>
  );
}

export function MonthView({ tasks, anchor, onPickDay, events = [] }) {
  const a = d(anchor);
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const start = startOfWeek(iso(first));
  const cells = [];
  for (let i = 0; i < 42; i++) { const x = new Date(start); x.setDate(start.getDate() + i); cells.push(x); }
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = cells.slice(w * 7, w * 7 + 7);
    if (w > 0 && week.every((x) => x.getMonth() !== a.getMonth())) break; // trim trailing weeks
    weeks.push(week);
  }
  return (
    <div className="tmonth">
      <div className="tmonth-dow">{DOW.map((x) => <span key={x} className="mono">{x}</span>)}</div>
      {weeks.map((week, wi) => (
        <div key={wi} className="tmonth-row">
          {week.map((day) => {
            const dayIso = iso(day);
            const inMonth = day.getMonth() === a.getMonth();
            const list = tasksOn(tasks, dayIso).sort((x, y) => (x.done ? 1 : 0) - (y.done ? 1 : 0) || (y.high ? 1 : 0) - (x.high ? 1 : 0));
            const isToday = dayIso === today();
            return (
              <div key={dayIso} className={`tcal-cell ${inMonth ? "" : "outside"} ${isToday ? "istoday" : ""}`}
                role="button" tabIndex={0} onClick={() => onPickDay(dayIso)}
                onKeyDown={(e) => e.key === "Enter" && onPickDay(dayIso)}
                title={`Open ${dayIso}`}>
                <span className={`daynum ${isToday ? "on" : ""}`}>{day.getDate()}</span>
                {eventsOn(events, dayIso).slice(0, 1).map((e) => <EventChip key={e.id} e={e} />)}
                {list.slice(0, 2).map((t) => <TaskChip key={t.id} t={t} onClick={() => onPickDay(dayIso)} />)}
                {(list.length > 2 || eventsOn(events, dayIso).length > 1) && (
                  <span className="tcal-more mono">+{Math.max(0, list.length - 2) + Math.max(0, eventsOn(events, dayIso).length - 1)} more</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function YearView({ tasks, anchor, onPickMonth }) {
  const year = d(anchor).getFullYear();
  return (
    <div className="tyear">
      {MONTHS.map((name, m) => {
        const key = `${year}-${String(m + 1).padStart(2, "0")}`;
        const due = tasks.filter((t) => t.due && t.due.startsWith(key));
        const open = due.filter((t) => !t.done).length;
        const done = due.filter((t) => t.done).length;
        const isNow = key === today().slice(0, 7);
        return (
          <button key={key} className={`tyear-card ${isNow ? "istoday" : ""}`}
            onClick={() => onPickMonth(`${key}-15`)} title={`Open ${name} ${year}`}>
            <span className="tyear-name display">{name}</span>
            <span className="tyear-count mono">
              {due.length === 0 ? "—" : <>{open > 0 && <b>{open} open</b>}{open > 0 && done > 0 && " · "}{done > 0 && `${done} done`}</>}
            </span>
            <span className="tyear-dots">
              {due.slice(0, 12).map((t, i) => (
                <span key={i} className="dot" style={{ background: t.done ? "var(--line)" : t.due < today() ? "var(--stamp)" : "var(--moss)" }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

"use client";

import React, { useMemo } from "react";
import { SECTIONS, daysAgo, fmtK } from "@/lib/seed";

export function WeeklyBars({ items }) {
  const weeks = useMemo(() => {
    const now = new Date();
    const b = Array.from({ length: 8 }, (_, i) => {
      const end = new Date(now); end.setDate(now.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      return { start, end, count: 0, label: `${start.getDate()}/${start.getMonth() + 1}` };
    }).reverse();
    items.forEach((it) => {
      const d = new Date(it.date + "T00:00:00");
      b.forEach((w) => { if (d >= w.start && d <= w.end) w.count++; });
    });
    return b;
  }, [items]);

  const max = Math.max(1, ...weeks.map((w) => w.count));
  const W = 440, H = 150, pad = 24, bw = (W - pad * 2) / weeks.length - 12;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Items added per week">
      {weeks.map((w, i) => {
        const h = (w.count / max) * (H - 50);
        const x = pad + i * ((W - pad * 2) / weeks.length) + 6;
        return (
          <g key={i}>
            <rect x={x} y={H - 30 - h} width={bw} height={Math.max(h, 2)} rx="4"
              fill={i === weeks.length - 1 ? "var(--azure)" : "var(--moss)"} opacity={w.count ? 1 : 0.25} />
            <text x={x + bw / 2} y={H - 34 - h} textAnchor="middle" fontSize="11" fontFamily="IBM Plex Mono" fill="var(--ink)">{w.count || ""}</text>
            <text x={x + bw / 2} y={H - 12} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">{w.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---- weekly bucket helpers shared by every feature's line chart ---- */
export function weekSeries(dates, weeks = 8, weights = null) {
  const counts = Array(weeks).fill(0);
  dates.forEach((d, i) => {
    if (!d) return;
    const w = Math.floor(daysAgo(d) / 7);
    if (w >= 0 && w < weeks) counts[weeks - 1 - w] += weights ? (weights[i] || 0) : 1;
  });
  return counts;
}
export function weekLabels(weeks = 8) {
  const now = new Date();
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (weeks - 1 - i) * 7 - 6);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  });
}
/* Fuller per-bucket time wording for hover tooltips ("Week of 17 Aug"). */
function weekTips(weeks = 8) {
  const now = new Date();
  return Array.from({ length: weeks }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - (weeks - 1 - i) * 7 - 6);
    return `Week of ${d.getDate()} ${MON[d.getMonth()]}`;
  });
}

/* Bucket a list of ISO dates by the dashboard's selected range, returning
 * {values, labels} ready for MiniBars. Day → last 14 days, week → last 8
 * weeks, month → last 12 months, year → last 5 years. */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function rangeSeries(dates, range = "week", weights = null) {
  const now = new Date();
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const w = (i) => (weights ? (weights[i] || 0) : 1);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (range === "day") {
    const buckets = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now); d.setDate(now.getDate() - (13 - i));
      return { iso: isoOf(d), label: `${d.getDate()}/${d.getMonth() + 1}`, tip: `${DAYS[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`, count: 0 };
    });
    const map = Object.fromEntries(buckets.map((b) => [b.iso, b]));
    dates.forEach((dt, i) => { if (map[dt]) map[dt].count += w(i); });
    return { values: buckets.map((b) => b.count), labels: buckets.map((b) => b.label), tips: buckets.map((b) => b.tip) };
  }
  if (range === "month") {
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return { y: d.getFullYear(), m: d.getMonth(), label: MON[d.getMonth()], tip: `${MON[d.getMonth()]} ${d.getFullYear()}`, count: 0 };
    });
    dates.forEach((dt, i) => {
      const d = new Date(dt + "T00:00:00");
      const k = buckets.findIndex((b) => b.y === d.getFullYear() && b.m === d.getMonth());
      if (k >= 0) buckets[k].count += w(i);
    });
    return { values: buckets.map((b) => b.count), labels: buckets.map((b) => b.label), tips: buckets.map((b) => b.tip) };
  }
  if (range === "year") {
    const buckets = Array.from({ length: 5 }, (_, i) => ({ y: now.getFullYear() - (4 - i), count: 0 }));
    dates.forEach((dt, i) => {
      const y = new Date(dt + "T00:00:00").getFullYear();
      const k = buckets.findIndex((b) => b.y === y);
      if (k >= 0) buckets[k].count += w(i);
    });
    return { values: buckets.map((b) => b.count), labels: buckets.map((b) => String(b.y)), tips: buckets.map((b) => String(b.y)) };
  }
  return { values: weekSeries(dates, 8, weights), labels: weekLabels(8), tips: weekTips(8) };
}

/* Shared cursor-following tooltip for the small dashboard charts. Native SVG
 * <title> waits a second and looks like an afterthought; this one is instant,
 * styled, and tracks the pointer inside the chart's own box. */
function useChartTip() {
  const [tip, setTip] = React.useState(null);
  const ref = React.useRef(null);
  const show = (e, text) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text });
  };
  const hide = () => setTip(null);
  return { ref, tip, show, hide };
}
const ChartTip = ({ tip }) => tip ? (
  <div className="chart-tip mono" style={{ left: tip.x, top: tip.y }} role="status">{tip.text}</div>
) : null;

/* Compact interactive bars for small dashboard cards: instant hover tooltip
 * per bar, no axis chrome — the card supplies the caption. */
export function TinyBars({ values, labels, color = "var(--moss)", fmt = (v) => v, label = "Chart" }) {
  const { ref, tip, show, hide } = useChartTip();
  const max = Math.max(1, ...values);
  const n = values.length || 1;
  const bw = 260 / n;
  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="tinybars" viewBox="0 0 260 70" preserveAspectRatio="none" role="img" aria-label={label}>
        {values.map((v, i) => (
          <g key={i}>
            {/* full-height invisible strip so the whole column is hoverable,
                not just the bar's painted pixels */}
            <rect x={i * bw} y="0" width={bw} height="70" fill="transparent"
              onMouseMove={(e) => show(e, `${labels?.[i] ?? ""} · ${fmt(v)}`)} />
            <rect x={i * bw + 1.5} y={68 - Math.max((v / max) * 56, 2)} width={Math.max(bw - 3, 2)}
              height={Math.max((v / max) * 56, 2)} rx="2" fill={color} opacity={v ? 1 : 0.22}
              style={{ pointerEvents: "none" }} />
          </g>
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* Area sparkline with the same instant tooltip — bucket-wide hover strips,
 * and the hovered point lights up. */
export function SparkArea({ values, labels, color = "var(--moss)", soft = "var(--moss-soft)", fmt = (v) => v, label = "Trend" }) {
  const { ref, tip, show, hide } = useChartTip();
  const [hot, setHot] = React.useState(null);
  const max = Math.max(...values, 1);
  const n = values.length || 1;
  const px = (i) => (i / Math.max(n - 1, 1)) * 260;
  const py = (v) => 62 - (v / max) * 52;
  const pts = values.map((v, i) => `${px(i)},${py(v)}`);
  const bw = 260 / n;
  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={() => { hide(); setHot(null); }}>
      <svg className="sparkline" viewBox="0 0 260 70" preserveAspectRatio="none" role="img" aria-label={label}>
        <path d={`M0,70 L${pts.join(" L")} L260,70 Z`} fill={soft} />
        <path d={`M${pts.join(" L")}`} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={px(n - 1)} cy={py(values[n - 1])} r="3.4" fill={color} />
        {hot != null && <circle cx={px(hot)} cy={py(values[hot])} r="4.2" fill={color} stroke="var(--panel)" strokeWidth="2" />}
        {values.map((v, i) => (
          <rect key={i} x={px(i) - bw / 2} y="0" width={bw} height="70" fill="transparent"
            onMouseMove={(e) => { setHot(i); show(e, `${labels?.[i] ?? ""} · ${fmt(v)}`); }} />
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* Compact weekly bar chart — one series, aggregated per week, so it stays
 * readable no matter how many raw events land in a day. */
export function MiniBars({ values, labels, color = "var(--moss)", height = 110 }) {
  const max = Math.max(1, ...values);
  const W = 560, H = height, pad = 8;
  const bw = (W - pad * 2) / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Weekly activity bars">
      {values.map((v, i) => {
        const h = (v / max) * (H - 40);
        const x = pad + i * bw + 4;
        return (
          <g key={i}>
            <rect x={x} y={H - 22 - h} width={bw - 8} height={Math.max(h, 2)} rx="4" fill={color} opacity={v ? 1 : 0.22}>
              <title>{`Week of ${labels[i]}: ${v}`}</title>
            </rect>
            {v > 0 && <text x={x + (bw - 8) / 2} y={H - 27 - h} textAnchor="middle" fontSize="10" fontFamily="IBM Plex Mono" fill="var(--ink)">{v}</text>}
            <text x={x + (bw - 8) / 2} y={H - 8} textAnchor="middle" fontSize="9" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Donut({ items }) {
  const { ref, tip, show, hide } = useChartTip();
  const totals = Object.keys(SECTIONS).map((k) => ({ k, n: items.filter((i) => i.type === k).length }));
  const total = Math.max(1, items.length);
  let acc = 0; const R = 44, C = 2 * Math.PI * R;
  return (
    <div className="chart-wrap donut-wrap" ref={ref} onMouseLeave={hide} style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg className="donut-svg" viewBox="0 0 120 120" role="img" aria-label="Share of items by section">
        {totals.map(({ k, n }) => {
          const frac = n / total, off = acc; acc += frac;
          return n === 0 ? null : (
            <circle key={k} className="dseg" cx="60" cy="60" r={R} fill="none" stroke={SECTIONS[k].color} strokeWidth="16"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-off * C} transform="rotate(-90 60 60)"
              onMouseMove={(e) => show(e, `${SECTIONS[k].label} · ${fmtK(n)} item${n === 1 ? "" : "s"} (${Math.round(frac * 100)}%)`)} />
          );
        })}
        <text x="60" y="57" textAnchor="middle" fontFamily="Fraunces" fontSize={items.length >= 10000 ? 19 : 24} fontWeight="650" fill="var(--ink)">{fmtK(items.length)}</text>
        <text x="60" y="73" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="8.5" letterSpacing="1.5" fill="var(--ink-soft)">ITEMS</text>
      </svg>
      <div style={{ fontSize: 13, lineHeight: 2, flex: 1 }}>
        {totals.map(({ k, n }) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}
            data-tip={`${SECTIONS[k].label}: ${fmtK(n)} of ${fmtK(items.length)} items (${Math.round((n / total) * 100)}%)`}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: SECTIONS[k].color }} />
            <span style={{ color: "var(--ink-soft)" }}>{SECTIONS[k].label}</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 12 }}>{fmtK(n)}</span>
          </div>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

/* Resurface — the cure for saved-but-forgotten.
   Collapsible; the header shows the count and worst age even when closed. */
export function Resurface({ items, onOpen }) {
  const [open, setOpen] = React.useState(true);
  const stale = items
    .filter((i) => i.status === "Inbox")
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  if (!stale.length) return null;
  const worst = daysAgo(stale[0].date);
  return (
    <div className="card" style={{ borderColor: "var(--stamp)" }}>
      <button className="resurface-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden="true" style={{ marginRight: 8 }}>{open ? "▾" : "▸"}</span>
        <span className="rh-title">Resurface — oldest untouched saves</span>
        <span className="age">{stale.length} ITEM{stale.length === 1 ? "" : "S"} · OLDEST {worst}D</span>
      </button>
      {open && stale.map((it) => {
        const s = SECTIONS[it.type];
        const age = daysAgo(it.date);
        return (
          <div key={it.id} className="row" style={{ padding: "10px 12px", cursor: "pointer" }}
            onClick={() => onOpen(it)} role="button" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen(it)}>
            <div className="icbox" style={{ width: 30, height: 30, fontSize: 13, background: s.soft, color: s.color }} aria-hidden="true"><span className="fic">{s.icon}</span></div>
            <div className="body">
              <div className="t" style={{ fontSize: 14 }}>{it.title}</div>
              <div className="m">Saved <b style={{ color: "var(--stamp)" }}>{age} day{age === 1 ? "" : "s"} ago</b> — still in Inbox</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

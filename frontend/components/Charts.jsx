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
      <div className="donut-legend">
        {totals.map(({ k, n }) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 9 }}
            data-tip={`${SECTIONS[k].label}: ${fmtK(n)} of ${fmtK(items.length)} items (${Math.round((n / total) * 100)}%)`}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: SECTIONS[k].color, flexShrink: 0 }} />
            <span style={{ color: "var(--ink-soft)" }}>{SECTIONS[k].label}</span>
            <span className="mono" style={{ marginLeft: "auto" }}>{fmtK(n)}</span>
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

/* ---------- Budget burn: cumulative month-to-date spend vs the even-pace
 * line to the monthly budget. The one glance that answers "am I ahead of
 * my money or behind it" — above the dashes means spending ahead of pace. */
export function BudgetBurn({ expenses, budget, fmt }) {
  const { ref, tip, show, hide } = useChartTip();
  const { pts, poly, todayIdx, spentNow, daysInMonth } = useMemo(() => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = now.getDate();
    const perDay = Array.from({ length: day }, () => 0);
    expenses.forEach((e) => {
      if (!e.date?.startsWith(ym)) return;
      const d = Number(e.date.slice(8, 10));
      if (d >= 1 && d <= day) perDay[d - 1] += +e.amount || 0;
    });
    let run = 0;
    const cum = perDay.map((v) => (run += v));
    return { pts: cum, poly: null, todayIdx: day - 1, spentNow: run, daysInMonth: dim };
  }, [expenses]);

  const W = 560, H = 210, pad = 44;
  const max = Math.max(budget, spentNow) * 1.08;
  const X = (d) => pad + (d / (daysInMonth - 1)) * (W - pad - 12);
  const Y = (v) => H - 26 - (v / max) * (H - 54);
  const line = pts.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const monthName = new Date().toLocaleDateString(undefined, { month: "short" });

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="burn-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cumulative spend against budget pace">
        <line x1={pad} y1={H - 26} x2={W - 8} y2={H - 26} stroke="var(--line)" />
        {[0.33, 0.66, 1].map((f) => (
          <g key={f}>
            <line x1={pad} y1={Y(budget * f)} x2={W - 8} y2={Y(budget * f)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={2} y={Y(budget * f) + 3} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{fmt(Math.round(budget * f))}</text>
          </g>
        ))}
        <line x1={X(0)} y1={Y(0)} x2={X(daysInMonth - 1)} y2={Y(budget)}
          stroke="var(--stamp)" strokeWidth="2.5" strokeDasharray="7 6" opacity="0.85" />
        {pts.length > 1 && (
          <polygon points={`${X(0)},${Y(0)} ${line} ${X(todayIdx)},${Y(0)}`} fill="var(--moss)" opacity="0.12" />
        )}
        <polyline points={line} fill="none" stroke="var(--moss)" strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx={X(todayIdx)} cy={Y(spentNow)} r="5.5" fill="var(--moss)" />
        {pts.map((v, i) => (
          <rect key={i} x={X(i) - (W - pad) / pts.length / 2} y="0" width={(W - pad) / Math.max(pts.length, 1)} height={H}
            fill="transparent"
            onMouseMove={(e) => show(e, `${monthName} ${i + 1} · ${fmt(Math.round(v))} so far · pace ${fmt(Math.round((budget / daysInMonth) * (i + 1)))}`)} />
        ))}
        <text x={pad} y={H - 9} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{monthName} 1</text>
        <text x={W - 56} y={H - 9} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{monthName} {daysInMonth}</text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* ---------- Top merchants: where the money actually goes, ranked. Fed by
 * expense descriptions (statement imports make these merchant names). */
export function TopMerchants({ expenses, fmt }) {
  const rows = useMemo(() => {
    const by = new Map();
    expenses.forEach((e) => {
      if (daysAgo(e.date) > 90) return;
      const key = (e.desc || "—").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 28);
      const cur = by.get(key) || { total: 0, n: 0 };
      cur.total += +e.amount || 0; cur.n += 1;
      by.set(key, cur);
    });
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [expenses]);

  if (!rows.length) return <div className="m" style={{ color: "var(--ink-soft)" }}>No expenses in the last 90 days yet.</div>;
  const max = rows[0][1].total;
  const COLORS = ["var(--moss)", "var(--gold)", "var(--azure)", "var(--violet)", "var(--blue)"];
  return (
    <div className="merchants">
      {rows.map(([name, r], i) => (
        <div key={name} className="merchant-row" data-tip={`${name}: ${fmt(Math.round(r.total))} across ${r.n} transaction${r.n === 1 ? "" : "s"} (90 days)`}>
          <span className="merchant-name mono">{name}</span>
          <span className="merchant-bar"><i style={{ width: `${Math.max((r.total / max) * 100, 3)}%`, background: COLORS[i] }} /></span>
          <b className="mono">{fmt(Math.round(r.total))}</b>
          <span className="merchant-n mono">· {r.n}×</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Vault growth: the collection compounding — cumulative items by
 * type, monthly, since the vault began (capped at 12 months of x-axis). */
export function VaultGrowth({ items }) {
  const { ref, tip, show, hide } = useChartTip();
  const TYPES = ["note", "video", "book", "doc"];
  const { months, layers, totals } = useMemo(() => {
    const now = new Date();
    const n = 6;
    const months = Array.from({ length: n }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
      return { ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short" }) };
    });
    const layers = TYPES.map((t) => months.map(({ ym }) =>
      items.filter((it) => it.type === t && it.date && it.date.slice(0, 7) <= ym).length));
    const totals = months.map((_, i) => layers.reduce((a, l) => a + l[i], 0));
    return { months, layers, totals };
  }, [items]);

  const W = 560, H = 210, pad = 40;
  const max = Math.max(...totals, 4) * 1.12;
  const X = (i) => pad + (i / (months.length - 1)) * (W - pad - 14);
  const Y = (v) => H - 26 - (v / max) * (H - 56);
  let base = months.map(() => 0);
  const polys = layers.map((l, li) => {
    const top = l.map((v, i) => base[i] + v);
    const up = top.map((v, i) => `${X(i)},${Y(v)}`).join(" ");
    const down = base.map((v, i) => `${X(i)},${Y(v)}`).reverse().join(" ");
    base = top;
    return { points: `${up} ${down}`, type: TYPES[li] };
  });

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="growth-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Items saved over time by type">
        <line x1={pad} y1={H - 26} x2={W - 8} y2={H - 26} stroke="var(--line)" />
        {polys.map((p, i) => (
          <polygon key={p.type} points={p.points} fill={SECTIONS[p.type].color} opacity={0.9 - i * 0.07} />
        ))}
        {months.map((m, i) => (
          <rect key={m.ym} x={X(i) - (W - pad) / months.length / 2} y="0" width={(W - pad) / months.length} height={H}
            fill="transparent"
            onMouseMove={(e) => show(e, `${m.label}: ${fmtK(totals[i])} item${totals[i] === 1 ? "" : "s"} total`)} />
        ))}
        {months.map((m, i) => (
          <text key={m.ym} x={X(i) - 10} y={H - 9} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{m.label}</text>
        ))}
        <text x={W - 90} y={Y(totals[months.length - 1]) - 10} fontFamily="Public Sans" fontSize="13" fontWeight="600" fill="var(--ink)">
          {fmtK(totals[months.length - 1])} items
        </text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* ---------- Task rhythm: done-per-day for ten weeks with the live streak.
 * Streaks are the cheapest daily-return mechanic there is — and gaps stay
 * honest, which is what makes the streak worth protecting. */
export function TaskRhythm({ doneDates }) {
  const { ref, tip, show, hide } = useChartTip();
  const { counts, streak } = useMemo(() => {
    const days = 70;
    const now = new Date();
    const counts = Array.from({ length: days }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i));
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { iso, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), n: doneDates.filter((x) => x === iso).length };
    });
    let streak = 0;
    for (let i = days - 1; i >= 0; i--) {
      if (counts[i].n > 0) streak++;
      else if (i === days - 1) continue;   // today can still be zero without breaking it
      else break;
    }
    return { counts, streak };
  }, [doneDates]);

  const W = 560, H = 170, pad = 8;
  const max = Math.max(...counts.map((c) => c.n), 3);
  const bw = (W - pad * 2) / counts.length;
  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="rhythm-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tasks finished per day">
        <line x1={pad} y1={H - 24} x2={W - pad} y2={H - 24} stroke="var(--line)" />
        {counts.map((c, i) => {
          const h = (c.n / max) * (H - 62);
          const inStreak = streak > 0 && i >= counts.length - streak;
          return (
            <rect key={c.iso} x={pad + i * bw + 0.8} y={H - 24 - Math.max(h, 2.5)} width={bw - 1.6} height={Math.max(h, 2.5)} rx="1.5"
              fill={inStreak ? "var(--stamp)" : "var(--moss)"} opacity={c.n ? 1 : 0.16}
              onMouseMove={(e) => show(e, `${c.label} · ${c.n} done`)} />
          );
        })}
        {streak > 1 && (
          <text x={W - 122} y={20} fontFamily="IBM Plex Mono" fontSize="12.5" fontWeight="600" fill="var(--stamp)">{streak}-day streak 🔥</text>
        )}
        <text x={pad} y={H - 8} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">10 weeks ago</text>
        <text x={W - 46} y={H - 8} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">today</text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* ---------- Money flow: income → categories → merchants for this month,
 * as a Sankey. Ribbon width is dollars — one picture of the whole month. */
export function MoneyFlow({ incomes, expenses, fmt }) {
  const { ref, tip, show, hide } = useChartTip();
  const model = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    const exp = expenses.filter((e) => e.date?.startsWith(ym));
    const inc = incomes.filter((i) => i.date?.startsWith(ym));
    if (!exp.length) return null;

    const catTotals = {};
    exp.forEach((e) => { catTotals[e.cat || "Other"] = (catTotals[e.cat || "Other"] || 0) + (+e.amount || 0); });
    const cats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const spendTotal = cats.reduce((a, [, v]) => a + v, 0);

    let sources = inc.map((i) => [i.source || "Income", +i.amount || 0]);
    const merged = {};
    sources.forEach(([n, v]) => { merged[n] = (merged[n] || 0) + v; });
    sources = Object.entries(merged).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!sources.length) sources = [["This month's spending", spendTotal]];

    /* income above spending doesn't vanish — it flows to an explicit Saved
       node, which keeps the picture honest AND is the happiest ribbon here */
    const srcSum = sources.reduce((a, [, v]) => a + v, 0);
    if (srcSum > spendTotal * 1.02) cats.push(["Saved", srcSum - spendTotal]);

    const merchTotals = {};
    exp.forEach((e) => {
      const k = (e.desc || "—").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 20);
      merchTotals[k] = merchTotals[k] || { v: 0, cat: e.cat || "Other" };
      merchTotals[k].v += +e.amount || 0;
    });
    const merchants = Object.entries(merchTotals).sort((a, b) => b[1].v - a[1].v).slice(0, 4);
    return { sources, cats, merchants, spendTotal };
  }, [incomes, expenses]);

  if (!model) return <div className="m" style={{ color: "var(--ink-soft)" }}>No expenses this month yet — the flow draws itself as you spend.</div>;
  const { sources, cats, merchants, spendTotal } = model;

  const W = 560, H = 260, w = 13, x0 = 8, x1 = 235, x2 = 470;
  const CAT_COLORS = ["var(--moss)", "var(--gold)", "var(--violet)", "var(--azure)", "var(--blue)"];
  const srcTotal = sources.reduce((a, [, v]) => a + v, 0);
  const scaleH = (H - 70) / Math.max(srcTotal, spendTotal, 1);
  const ribbon = (xa, ya, ha, xb, yb, hb) => {
    const mx = (xa + xb) / 2;
    return `M${xa},${ya} C${mx},${ya} ${mx},${yb} ${xb},${yb} L${xb},${yb + hb} C${mx},${yb + hb} ${mx},${ya + ha} ${xa},${ya + ha} Z`;
  };

  let y = 28;
  const S = sources.map(([n, v]) => { const o = { n, v, h: v * scaleH, y }; y += v * scaleH + 26; return o; });
  y = 20;
  const M = cats.map(([n, v], i) => { const o = { n, v, h: v * scaleH, y, c: n === "Saved" ? "#1F7A4D" : CAT_COLORS[i % CAT_COLORS.length] }; y += v * scaleH + 16; return o; });
  y = 26;
  const R = merchants.map(([n, m]) => { const o = { n, v: m.v, cat: m.cat, h: m.v * scaleH, y }; y += m.v * scaleH + 22; return o; });

  const paths = [];
  const catOff = M.map(() => 0);
  S.forEach((s) => {
    let sy = s.y;
    M.forEach((m, mi) => {
      const share = (s.v / srcTotal) * m.h;   // this source's slice of the category
      if (share < 0.8) return;
      paths.push({ d: ribbon(x0 + w, sy, share, x1, m.y + catOff[mi], share), fill: m.c, op: 0.28,
        tip: `${s.n} → ${m.n} · ${fmt(Math.round((share / scaleH)))}` });
      sy += share; catOff[mi] += share;
    });
  });
  const merchOff = M.map(() => 0);
  R.forEach((r) => {
    const mi = M.findIndex((m) => m.n === r.cat);
    if (mi < 0) return;
    paths.push({ d: ribbon(x1 + w, M[mi].y + merchOff[mi], r.h, x2, r.y, r.h), fill: M[mi].c, op: 0.20,
      tip: `${M[mi].n} → ${r.n} · ${fmt(Math.round(r.v))}` });
    merchOff[mi] += r.h;
  });

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="flow-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Money flow from income to categories to merchants">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} opacity={p.op}
            onMouseMove={(e) => show(e, p.tip)} />
        ))}
        {S.map((s) => (
          <g key={s.n}>
            <rect x={x0} y={s.y} width={w} height={Math.max(s.h, 3)} rx="3.5" fill="var(--moss)" />
            <text x={x0} y={s.y - 6} fontFamily="IBM Plex Mono" fontSize="10.5" fontWeight="600" fill="var(--ink)">{s.n.slice(0, 18)} · {fmt(Math.round(s.v))}</text>
          </g>
        ))}
        {M.map((m) => (
          <g key={m.n}>
            <rect x={x1} y={m.y} width={w} height={Math.max(m.h, 3)} rx="3.5" fill={m.c} />
            <text x={x1 + 19} y={m.y + m.h / 2 + 3.5} fontFamily="IBM Plex Mono" fontSize="10.5" fill="var(--ink)">{m.n}</text>
          </g>
        ))}
        {R.map((r) => (
          <g key={r.n}>
            <rect x={x2} y={r.y} width={w} height={Math.max(r.h, 3)} rx="3.5" fill="var(--ink-soft)" opacity="0.55" />
            <text x={x2 + 18} y={r.y + r.h / 2 + 3.5} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{r.n.slice(0, 12)}</text>
          </g>
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* ---------- Category shifts: this month vs last, per category — the
 * headline version of the trend charts. Red grows, green shrinks. */
export function CategoryShifts({ expenses, fmt }) {
  const rows = useMemo(() => {
    const now = new Date();
    const thisYm = now.toISOString().slice(0, 7);
    const lastD = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYm = `${lastD.getFullYear()}-${String(lastD.getMonth() + 1).padStart(2, "0")}`;
    const by = {};
    expenses.forEach((e) => {
      const c = e.cat || "Other";
      by[c] = by[c] || { cur: 0, prev: 0, weeks: Array(8).fill(0) };
      if (e.date?.startsWith(thisYm)) by[c].cur += +e.amount || 0;
      if (e.date?.startsWith(lastYm)) by[c].prev += +e.amount || 0;
      const w = Math.floor(daysAgo(e.date) / 7);
      if (w >= 0 && w < 8) by[c].weeks[7 - w] += +e.amount || 0;
    });
    return Object.entries(by)
      .filter(([, v]) => v.cur > 0 || v.prev > 0)
      .sort((a, b) => b[1].cur - a[1].cur)
      .slice(0, 6)
      .map(([cat, v]) => {
        const pct = v.prev > 0 ? Math.round(((v.cur - v.prev) / v.prev) * 100) : (v.cur > 0 ? null : 0);
        return { cat, ...v, pct };
      });
  }, [expenses]);

  if (!rows.length) return <div className="m" style={{ color: "var(--ink-soft)" }}>Two months of expenses make this light up.</div>;
  return (
    <div className="shifts">
      {rows.map((r) => {
        const up = r.pct !== null && r.pct > 3, down = r.pct !== null && r.pct < -3;
        const max = Math.max(...r.weeks, 1);
        const pts = r.weeks.map((v, i) => `${i * 34},${26 - (v / max) * 22}`).join(" ");
        return (
          <div key={r.cat} className="shift-row"
            data-tip={`${r.cat}: ${fmt(Math.round(r.cur))} this month vs ${fmt(Math.round(r.prev))} last month`}>
            <span className="shift-name">{r.cat}</span>
            <svg className="shift-spark" viewBox="0 0 238 30" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={pts} fill="none" strokeWidth="2.5" strokeLinejoin="round"
                stroke={up ? "var(--stamp)" : down ? "#1F7A4D" : "var(--ink-soft)"} />
            </svg>
            <b className="mono shift-amt">{fmt(Math.round(r.cur))}</b>
            <span className={`shift-chip mono ${up ? "up" : down ? "down" : ""}`}>
              {r.pct === null ? "new" : `${r.pct > 0 ? "+" : ""}${r.pct}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

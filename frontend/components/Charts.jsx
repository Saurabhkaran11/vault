"use client";

import React, { useMemo } from "react";
import { createPortal } from "react-dom";
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
export function TinyBars({ values, labels, color = "var(--chart)", fmt = (v) => v, label = "Chart" }) {
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
export function SparkArea({ values, labels, color = "var(--chart)", soft = "var(--moss-soft)", fmt = (v) => v, label = "Trend" }) {
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
          <polygon points={`${X(0)},${Y(0)} ${line} ${X(todayIdx)},${Y(0)}`} fill="var(--chart)" opacity="0.12" />
        )}
        <polyline points={line} fill="none" stroke="var(--chart)" strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx={X(todayIdx)} cy={Y(spentNow)} r="5.5" fill="var(--chart)" />
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
  const [sel, setSel] = React.useState(null);   // click a row → the habit card
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
  const habit = sel !== null && rows[sel] ? rows[sel] : null;
  return (
    <div className="merchants">
      {rows.map(([name, r], i) => (
        <button key={name} type="button" className={`merchant-row ${sel === i ? "on" : ""}`}
          data-tip={`${name}: ${fmt(Math.round(r.total))} across ${r.n} transaction${r.n === 1 ? "" : "s"} (90 days) — click for the habit math`}
          onClick={() => setSel(sel === i ? null : i)}>
          <span className="merchant-name mono">{name}</span>
          <span className="merchant-bar"><i style={{ width: `${Math.max((r.total / max) * 100, 3)}%`, background: COLORS[i] }} /></span>
          <b className="mono">{fmt(Math.round(r.total))}</b>
          <span className="merchant-n mono">· {r.n}×</span>
        </button>
      ))}
      {habit && (() => {
        /* the price of a habit: 90 days of this merchant, annualized */
        const [name, r] = habit;
        const perMonth = r.total / 3;
        return (
          <div className="habit-card">
            <div className="habit-name">{name} · {r.n} visit{r.n === 1 ? "" : "s"} · {fmt(Math.round((r.total / r.n) * 100) / 100)} avg</div>
            <div className="habit-mo">{fmt(Math.round(perMonth))}/mo</div>
            <div className="habit-yr">→ {fmt(Math.round(perMonth * 12))} a year</div>
            <div className="habit-sub">Kept up for a year, this habit costs a holiday. Or funds one — your call.</div>
          </div>
        );
      })()}
    </div>
  );
}

/* ---------- Vault growth: the collection compounding — cumulative items by
 * type, monthly, since the vault began (capped at 12 months of x-axis). */
export function VaultGrowth({ items, range = "month" }) {
  const { ref, tip, show, hide } = useChartTip();
  const TYPES = ["note", "video", "book", "doc"];
  /* buckets follow the dashboard's Daily/Weekly/Monthly/Yearly tab */
  const { months, layers, totals } = useMemo(() => {
    const now = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let buckets;
    if (range === "day") {
      buckets = Array.from({ length: 14 }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (13 - i));
        return { end: iso(d), label: d.toLocaleDateString(undefined, { day: "numeric" }) };
      });
    } else if (range === "week") {
      buckets = Array.from({ length: 10 }, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (9 - i) * 7);
        return { end: iso(d), label: `${d.getDate()}/${d.getMonth() + 1}` };
      });
    } else {
      const n = range === "year" ? 12 : 6;
      buckets = Array.from({ length: n }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i) + 1, 0);
        return { end: iso(d), label: d.toLocaleDateString(undefined, { month: "short" }) };
      });
    }
    const layers = TYPES.map((t) => buckets.map(({ end }) =>
      items.filter((it) => it.type === t && it.date && it.date <= end).length));
    const totals = buckets.map((_, i) => layers.reduce((a, l) => a + l[i], 0));
    return { months: buckets, layers, totals };
  }, [items, range]);

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

  /* which month a pointer x lands on, in a CSS-stretched viewBox svg */
  const monthAt = (e) => {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
    const vx = (e.nativeEvent.offsetX / (svg.clientWidth || W)) * W;
    return Math.max(0, Math.min(months.length - 1, Math.round((vx - pad) / ((W - pad - 14) / (months.length - 1)))));
  };
  const last = months.length - 1;

  return (
    <>
      <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
        <svg className="growth-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Items saved over time by type">
          <line x1={pad} y1={H - 26} x2={W - 8} y2={H - 26} stroke="var(--line)" />
          {polys.map((p, li) => (
            <polygon key={p.type} points={p.points} fill={SECTIONS[p.type].color} opacity={0.9 - li * 0.07}
              onMouseMove={(e) => { const i = monthAt(e); show(e, `${SECTIONS[p.type].label} · by ${months[i].label}: ${fmtK(layers[li][i])} of ${fmtK(totals[i])}`); }} />
          ))}
          {months.map((m, i) => (
            <text key={m.end} x={X(i) - 10} y={H - 9} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)"
              style={{ pointerEvents: "none" }}>{m.label}</text>
          ))}
          <text x={W - 90} y={Y(totals[last]) - 10} fontFamily="Public Sans" fontSize="13" fontWeight="600" fill="var(--ink)"
            style={{ pointerEvents: "none" }}>
            {fmtK(totals[last])} items
          </text>
        </svg>
        <ChartTip tip={tip} />
      </div>
      {/* every layer ("pyramid") named, with its live count */}
      <div className="growth-legend">
        {TYPES.map((t, li) => (
          <span key={t} className="gl-item" title={`${SECTIONS[t].label} — ${layers[li][last]} saved so far`}>
            <i style={{ background: SECTIONS[t].color }} />
            {SECTIONS[t].label} <b className="mono">{layers[li][last]}</b>
          </span>
        ))}
      </div>
    </>
  );
}

/* ---------- Task rhythm: done-per-day for ten weeks with the live streak.
 * Streaks are the cheapest daily-return mechanic there is — and gaps stay
 * honest, which is what makes the streak worth protecting. */
export function TaskRhythm({ doneDates, range = "week" }) {
  const { ref, tip, show, hide } = useChartTip();
  const { counts, streak, weekly, windowLabel } = useMemo(() => {
    /* window follows the dashboard's range tab; long windows bucket by week
       so bars stay visible (364 one-day bars would be sub-pixel) */
    const days = { day: 14, week: 70, month: 182, year: 364 }[range] || 70;
    const now = new Date();
    const daily = Array.from({ length: days }, (_, i) => {
      const d = new Date(now); d.setDate(d.getDate() - (days - 1 - i));
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { iso, label: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), n: doneDates.filter((x) => x === iso).length };
    });
    let streak = 0;
    for (let i = days - 1; i >= 0; i--) {
      if (daily[i].n > 0) streak++;
      else if (i === days - 1) continue;   // today can still be zero without breaking it
      else break;
    }
    const weekly = days > 100;
    let counts = daily;
    if (weekly) {
      counts = [];
      for (let s = 0; s < days; s += 7) {
        const grp = daily.slice(s, s + 7);
        counts.push({ iso: grp[0].iso, label: `week of ${grp[0].label}`, n: grp.reduce((a, c) => a + c.n, 0) });
      }
    }
    const windowLabel = { day: "14 days ago", week: "10 weeks ago", month: "6 months ago", year: "a year ago" }[range] || "10 weeks ago";
    return { counts, streak, weekly, windowLabel };
  }, [doneDates, range]);

  const W = 560, H = 170, pad = 8;
  const max = Math.max(...counts.map((c) => c.n), 3);
  const bw = (W - pad * 2) / counts.length;
  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="rhythm-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tasks finished per day">
        <line x1={pad} y1={H - 24} x2={W - pad} y2={H - 24} stroke="var(--line)" />
        {counts.map((c, i) => {
          const h = (c.n / max) * (H - 62);
          const inStreak = !weekly && streak > 0 && i >= counts.length - streak;
          return (
            <rect key={c.iso} x={pad + i * bw + 0.8} y={H - 24 - Math.max(h, 2.5)} width={Math.max(bw - 1.6, 1)} height={Math.max(h, 2.5)} rx="1.5"
              fill={inStreak ? "var(--stamp)" : "var(--chart)"} opacity={c.n ? 1 : 0.16}
              onMouseMove={(e) => show(e, `${c.label} · ${c.n} done`)} />
          );
        })}
        {streak > 1 && (
          <text x={W - 122} y={20} fontFamily="IBM Plex Mono" fontSize="12.5" fontWeight="600" fill="var(--stamp)">{streak}-day streak 🔥</text>
        )}
        <text x={pad} y={H - 8} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{windowLabel}</text>
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
  /* render at the card's REAL width — a stretched viewBox distorts text and
     pushes the right-column labels out of the card */
  const [w, setW] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") { setW(el?.clientWidth || 560); return; }
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

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
  const { sources, cats, merchants } = model;

  const W = Math.max(320, w || 560);
  const narrow = W < 640;
  const H = narrow ? 330 : 380;
  const nodeW = 16;
  const MIN_H = 12;                                   // every node stays visibly thick
  const rightLabelW = narrow ? 118 : 190;
  const midLabelW = narrow ? 96 : 150;
  const x0 = 4, x1 = Math.round((W - rightLabelW) * 0.46), x2 = W - rightLabelW - nodeW - 6;
  const CAT_COLORS = ["var(--moss)", "var(--gold)", "var(--violet)", "var(--azure)", "var(--blue)"];
  const srcTotal = sources.reduce((a, [, v]) => a + v, 0);
  const scaleH = (H - 96) / Math.max(srcTotal, model.spendTotal, 1);
  const ribbon = (xa, ya, ha, xb, yb, hb) => {
    const mx = (xa + xb) / 2;
    return `M${xa},${ya} C${mx},${ya} ${mx},${yb} ${xb},${yb} L${xb},${yb + hb} C${mx},${yb + hb} ${mx},${ya + ha} ${xa},${ya + ha} Z`;
  };
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

  /* columns: proportional height with a floor, stacked then vertically centered.
     If floors + gaps blow the budget, the proportional part shrinks to fit so
     nothing ever draws past the svg. */
  const layoutCol = (entries, gap, topPad) => {
    const avail = H - 20 - topPad;
    const nodes = entries.map((e) => ({ ...e, h: Math.max(e.v * scaleH, MIN_H) }));
    const gaps = gap * Math.max(nodes.length - 1, 0);
    let total = nodes.reduce((a, n) => a + n.h, 0) + gaps;
    if (total > avail) {
      const flex = nodes.reduce((a, n) => a + Math.max(n.h - MIN_H, 0), 0);
      if (flex > 0) {
        const k = Math.max(1 - (total - avail) / flex, 0);
        nodes.forEach((n) => { n.h = MIN_H + Math.max(n.h - MIN_H, 0) * k; });
        total = nodes.reduce((a, n) => a + n.h, 0) + gaps;
      }
    }
    let y = topPad + Math.max((avail - total) / 2, 0);
    nodes.forEach((n) => { n.y = y; y += n.h + gap; });
    return nodes;
  };
  const S = layoutCol(sources.map(([n, v]) => ({ n, v })), 34, 48);
  const M = layoutCol(cats.map(([n, v], i) => ({ n, v, c: n === "Saved" ? "#1F7A4D" : CAT_COLORS[i % CAT_COLORS.length] })), 14, 34);
  const R = layoutCol(merchants.map(([n, m]) => ({ n, v: m.v, cat: m.cat })), 20, 34);

  /* ribbons: thickness proportional WITHIN each node's drawn height, so a
     floored node still shows its flows without overlap */
  const paths = [];
  const srcOff = S.map(() => 0), catInOff = M.map(() => 0), catOutOff = M.map(() => 0), merOff = R.map(() => 0);
  S.forEach((s, si) => {
    M.forEach((m, mi) => {
      const share = (s.v / srcTotal) * m.v;           // dollars of m funded by s
      if (share < 0.5) return;
      const ha = (share / s.v) * s.h, hb = (share / m.v) * m.h;
      paths.push({ d: ribbon(x0 + nodeW, s.y + srcOff[si], ha, x1, m.y + catInOff[mi], hb), fill: m.c, op: 0.30,
        tip: `${s.n} → ${m.n} · ${fmt(Math.round(share))}` });
      srcOff[si] += ha; catInOff[mi] += hb;
    });
  });
  R.forEach((r, ri) => {
    const mi = M.findIndex((m) => m.n === r.cat);
    if (mi < 0) return;
    const ha = (r.v / M[mi].v) * M[mi].h, hb = r.h;
    paths.push({ d: ribbon(x1 + nodeW, M[mi].y + catOutOff[mi], ha, x2, r.y + merOff[ri], hb), fill: M[mi].c, op: 0.22,
      tip: `${M[mi].n} → ${r.n} · ${fmt(Math.round(r.v))}` });
    catOutOff[mi] += ha; merOff[ri] += hb;
  });

  return (
    <div className="chart-wrap flow-wrap" ref={ref} onMouseLeave={hide}>
      {w > 0 && (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Money flow from income to categories to merchants" style={{ display: "block" }}>
        <text x={x0} y={16} fontFamily="IBM Plex Mono" fontSize="9.5" letterSpacing="1.5" fill="var(--ink-soft)">INCOME</text>
        <text x={x1} y={16} fontFamily="IBM Plex Mono" fontSize="9.5" letterSpacing="1.5" fill="var(--ink-soft)">CATEGORIES</text>
        <text x={x2} y={16} fontFamily="IBM Plex Mono" fontSize="9.5" letterSpacing="1.5" fill="var(--ink-soft)">WHERE IT LANDS</text>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} opacity={p.op}
            onMouseMove={(e) => show(e, p.tip)} />
        ))}
        {S.map((s) => (
          <g key={s.n}>
            <rect x={x0} y={s.y} width={nodeW} height={s.h} rx="4" fill="var(--chart)" />
            <text x={x0} y={s.y - 7} fontFamily="IBM Plex Mono" fontSize="11.5" fontWeight="600" fill="var(--ink)">
              {clip(s.n, narrow ? 12 : 22)} · {fmt(Math.round(s.v))}
            </text>
          </g>
        ))}
        {M.map((m) => (
          <g key={m.n}>
            <rect x={x1} y={m.y} width={nodeW} height={m.h} rx="4" fill={m.c} />
            <text x={x1 + nodeW + 8} y={m.y + m.h / 2 + 4} fontFamily="IBM Plex Mono" fontSize="11" fontWeight="600" fill="var(--ink)">
              {clip(m.n, narrow ? 7 : 10)} <tspan fill="var(--ink-soft)" fontWeight="400">· {fmt(Math.round(m.v))}</tspan>
            </text>
          </g>
        ))}
        {R.map((r) => (
          <g key={r.n}>
            <rect x={x2} y={r.y} width={nodeW} height={r.h} rx="4" fill="var(--ink-soft)" opacity="0.6" />
            <text x={x2 + nodeW + 7} y={r.y + r.h / 2 + 4} fontFamily="IBM Plex Mono" fontSize="10.5" fill="var(--ink)">
              {clip(r.n, narrow ? 10 : 16)}
            </text>
          </g>
        ))}
      </svg>
      )}
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

/* ---------- Capture sources: how things actually enter the vault. If voice
 * or the clipper ever lags, this is where the friction shows. */
export function CaptureSources({ items, importedCount }) {
  const rows = useMemo(() => {
    let typed = 0, links = 0, cloud = 0, files = 0;
    items.forEach((it) => {
      if (it.cloud) cloud++;
      else if (it.file) files++;
      else if (it.url) links++;
      else typed++;
    });
    const r = [
      ["Typed", typed, "var(--moss)"],
      ["Pasted links", links, "var(--azure)"],
      ["Files dropped", files, "var(--blue)"],
      ["Cloud imports", cloud, "var(--violet)"],
      ["Statement rows", importedCount, "var(--gold)"],
    ].filter(([, v]) => v > 0);
    const total = r.reduce((a, [, v]) => a + v, 0) || 1;
    return r.map(([n, v, c]) => [n, v, Math.round((v / total) * 100), c]);
  }, [items, importedCount]);

  return (
    <div className="srcrows">
      {rows.map(([n, v, pct, c]) => (
        <div key={n} className="srcrow" data-tip={`${n}: ${fmtK(v)} record${v === 1 ? "" : "s"} (${pct}%)`}>
          <span className="srcname">{n}</span>
          <span className="srcbar"><i style={{ width: `${Math.max(pct, 3)}%`, background: c }} /></span>
          <span className="mono srcpct">{pct}%</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Income vs spend: paired monthly bars with the kept-money gap
 * shaded green — savings made visible instead of implied. */
export function IncomeVsSpend({ incomes, expenses, fmt }) {
  const { ref, tip, show, hide } = useChartTip();
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (4 - i), 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const inc = incomes.filter((x) => x.date?.startsWith(ym)).reduce((a, x) => a + (+x.amount || 0), 0);
      const sp = expenses.filter((x) => x.date?.startsWith(ym)).reduce((a, x) => a + (+x.amount || 0), 0);
      return { label: d.toLocaleDateString(undefined, { month: "short" }), inc, sp };
    });
  }, [incomes, expenses]);

  const max = Math.max(...months.map((m) => Math.max(m.inc, m.sp)), 1) * 1.1;
  const W = 560, H = 210, pad = 14, gw = (W - pad * 2) / 5;
  const Y = (v) => H - 30 - (v / max) * (H - 60);
  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={hide}>
      <svg className="ivs-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Income vs spending by month">
        <line x1={pad} y1={H - 30} x2={W - pad} y2={H - 30} stroke="var(--line)" />
        {months.map((m, i) => {
          const x = pad + i * gw + gw * 0.14, bw = gw * 0.3;
          return (
            <g key={m.label} onMouseMove={(e) => show(e, `${m.label}: ${fmt(Math.round(m.inc))} in · ${fmt(Math.round(m.sp))} out · kept ${fmt(Math.round(m.inc - m.sp))}`)}>
              <rect x={pad + i * gw} y="0" width={gw} height={H} fill="transparent" />
              <rect x={x} y={Y(m.inc)} width={bw} height={Math.max(H - 30 - Y(m.inc), 2)} rx="4" fill="var(--moss)" style={{ pointerEvents: "none" }} />
              <rect x={x + bw + 5} y={Y(m.sp)} width={bw} height={Math.max(H - 30 - Y(m.sp), 2)} rx="4" fill="var(--gold)" style={{ pointerEvents: "none" }} />
              {m.inc > m.sp && (
                <rect x={x + bw + 5} y={Y(m.inc)} width={bw} height={Y(m.sp) - Y(m.inc)} rx="4" fill="#1F7A4D" opacity="0.22" style={{ pointerEvents: "none" }} />
              )}
              <text x={pad + i * gw + gw / 2 - 12} y={H - 11} fontFamily="IBM Plex Mono" fontSize="10" fill="var(--ink-soft)" style={{ pointerEvents: "none" }}>{m.label}</text>
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

/* ---------- Savings waterfall: this month as a staircase — income at the
 * left, categories stepping down, what you kept at the right. */
export function SavingsWaterfall({ incomes, expenses, fmt }) {
  const model = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    const income = incomes.filter((x) => x.date?.startsWith(ym)).reduce((a, x) => a + (+x.amount || 0), 0);
    const byCat = {};
    expenses.filter((x) => x.date?.startsWith(ym)).forEach((e) => {
      byCat[e.cat || "Other"] = (byCat[e.cat || "Other"] || 0) + (+e.amount || 0);
    });
    let cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    if (cats.length > 4) cats = [...cats.slice(0, 3), ["Other", cats.slice(3).reduce((a, [, v]) => a + v, 0)]];
    const spend = cats.reduce((a, [, v]) => a + v, 0);
    if (!income || !spend) return null;
    return { income, cats, saved: income - spend };
  }, [incomes, expenses]);

  if (!model) return <div className="m" style={{ color: "var(--ink-soft)" }}>Log income and expenses this month and the staircase appears.</div>;
  const { income, cats, saved } = model;
  const steps = [["Income", income, "var(--moss)", "start"],
    ...cats.map(([n, v], i) => [n, -v, ["var(--gold)", "var(--violet)", "var(--azure)", "var(--blue)"][i % 4], "drop"]),
    ["Kept", Math.max(saved, 0), saved >= 0 ? "#1F7A4D" : "var(--stamp)", "end"]];
  const W = 560, H = 220, n = steps.length, gw = (W - 20) / n;
  const scale = (H - 66) / income;
  let run = 0;
  return (
    <div className="chart-wrap">
      <svg className="wf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Income minus categories equals savings">
        {steps.map(([name, v, color, kind], i) => {
          const x = 10 + i * gw;
          let top, h;
          if (kind === "start") { run = v; h = v * scale; top = H - 40 - h; }
          else if (kind === "end") { h = Math.abs(v) * scale; top = H - 40 - h; }
          else { h = Math.abs(v) * scale; top = H - 40 - run * scale; run += v; }
          return (
            <g key={name} data-tip={name}>
              <rect x={x} y={top} width={gw - 14} height={Math.max(h, 2)} rx="4" fill={color} opacity={kind === "drop" ? 0.9 : 1} />
              <text x={x} y={top - 7} fontFamily="IBM Plex Mono" fontSize="10" fontWeight="600" fill="var(--ink)">
                {kind === "drop" ? "−" : ""}{fmt(Math.round(Math.abs(v)))}
              </text>
              <text x={x} y={H - 22} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{String(name).slice(0, 9)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ---------- Weekend premium: weekday vs weekend average daily spend.
 * One ratio, instantly felt. */
export function WeekendPremium({ expenses, fmt }) {
  const m = useMemo(() => {
    let wd = 0, we = 0, wdDays = 0, weDays = 0;
    const seen = new Set();
    expenses.forEach((e) => {
      if (!e.date || daysAgo(e.date) > 56) return;
      const day = new Date(e.date + "T00:00:00").getDay();
      const isWe = day === 0 || day === 6;
      if (isWe) we += +e.amount || 0; else wd += +e.amount || 0;
      if (!seen.has(e.date)) { seen.add(e.date); isWe ? weDays++ : wdDays++; }
    });
    if (!wdDays || !weDays) return null;
    const a = wd / Math.max(wdDays, 1), b = we / Math.max(weDays, 1);
    return { a, b, ratio: (b / Math.max(a, 0.01)).toFixed(1) };
  }, [expenses]);

  if (!m) return <div className="m" style={{ color: "var(--ink-soft)" }}>A few weeks of expenses make this comparison meaningful.</div>;
  const max = Math.max(m.a, m.b);
  return (
    <div className="wkprem">
      <div className="wkrow" data-tip={`Weekday days average ${fmt(Math.round(m.a))} of spending`}>
        <span className="wkl">weekday avg</span>
        <span className="wkbar"><i style={{ width: `${(m.a / max) * 100}%`, background: "var(--moss)" }} /></span>
        <b className="mono">{fmt(Math.round(m.a))}/day</b>
      </div>
      <div className="wkrow" data-tip={`Weekend days average ${fmt(Math.round(m.b))} of spending`}>
        <span className="wkl">weekend avg</span>
        <span className="wkbar"><i style={{ width: `${(m.b / max) * 100}%`, background: m.b > m.a ? "var(--stamp)" : "#1F7A4D" }} /></span>
        <b className="mono" style={{ color: m.b > m.a ? "var(--stamp)" : "#1F7A4D" }}>{fmt(Math.round(m.b))}/day</b>
      </div>
      <div className="m" style={{ color: "var(--ink-soft)" }}>
        {m.b > m.a ? `Weekends cost ${m.ratio}× a weekday — worth knowing before Saturday.` : `Your weekends are cheaper than weekdays (${m.ratio}×) — rare.`}
      </div>
    </div>
  );
}

/* ---------- Budget bullets: every capped category as a bullet bar — the
 * black tick is the cap, red overflow is the overrun. */
export function BudgetBullets({ byCat, spentByCat, fmt }) {
  const rows = Object.entries(byCat || {})
    .filter(([, cap]) => +cap > 0)
    .map(([cat, cap]) => ({ cat, cap: +cap, spent: spentByCat[cat] || 0 }))
    .sort((a, b) => b.spent / b.cap - a.spent / a.cap);
  if (!rows.length) return <div className="m" style={{ color: "var(--ink-soft)" }}>Cap a category above and its bullet appears here.</div>;
  const maxCap = Math.max(...rows.map((r) => Math.max(r.cap, r.spent)));
  return (
    <div className="bullets">
      {rows.map((r) => {
        const capPct = (r.cap / maxCap) * 100;
        const spentPct = (Math.min(r.spent, r.cap) / maxCap) * 100;
        const overPct = r.spent > r.cap ? ((r.spent - r.cap) / maxCap) * 100 : 0;
        return (
          <div key={r.cat} className="bullet-row" data-tip={`${r.cat}: ${fmt(Math.round(r.spent))} of ${fmt(r.cap)} (${Math.round((r.spent / r.cap) * 100)}%)`}>
            <span className="bullet-name">{r.cat}</span>
            <span className="bullet-track">
              <i className="bullet-cap" style={{ width: `${capPct}%` }} />
              <i className="bullet-fill" style={{ width: `${spentPct}%`, background: r.spent > r.cap ? "var(--stamp)" : "var(--moss)" }} />
              {overPct > 0 && <i className="bullet-over" style={{ left: `${capPct}%`, width: `${overPct}%` }} />}
              <i className="bullet-tick" style={{ left: `${capPct}%` }} />
            </span>
            <span className="mono bullet-amt">{fmt(Math.round(r.spent))} / {fmt(r.cap)}</span>
          </div>
        );
      })}
    </div>
  );
}


/* ---------- Zoom: click ANY chart to maximize it.
 * Wrap a chart once and it gains an expand affordance + a full-screen
 * popup that re-renders the same chart at reading size (the zoom dialog's
 * CSS raises every chart class's height; width-responsive charts and the
 * measured ones fill it naturally). */
export function Zoom({ title, sub, children, large, note, go }) {
  const [open, setOpen] = React.useState(false);
  const [ask, setAsk] = React.useState(false);
  React.useEffect(() => {
    if (!open && !ask) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); setAsk(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, ask]);
  return (
    <>
      <div className={go ? "zoomable zoom-linked" : "zoomable"}
        onClick={go ? () => setAsk(true) : undefined}
        role={go ? "button" : undefined} tabIndex={go ? 0 : undefined}
        onKeyDown={go ? (e) => { if (e.key === "Enter") setAsk(true); } : undefined}
        title={go ? `Powered by ${go.label} — click to open that section` : undefined}>
        <button type="button" className="zoom-btn" aria-label={`Maximize ${title}`}
          title="Maximize — see this chart in depth"
          onClick={(e) => { e.stopPropagation(); setOpen(true); }}>⤢</button>
        {children}
        {note && <div className="chart-note">{note}</div>}
      </div>
      {ask && go && createPortal(
        <div className="pal-overlay centered" onClick={() => setAsk(false)} role="dialog" aria-label={`Open ${go.label}?`}>
          <div className="pal askgo" onClick={(e) => e.stopPropagation()}>
            <h3 className="askgo-title">Open {go.label}?</h3>
            <p className="m askgo-sub">&ldquo;{title}&rdquo; is powered by the {go.label} feature — you can jump there for the full picture, or stay right here.</p>
            <div className="askgo-foot">
              <button className="btn ghost sm" onClick={() => setAsk(false)}>Stay here</button>
              <button className="btn sm" onClick={() => { setAsk(false); go.fn(); }}>Open {go.label} →</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {open && createPortal(
        /* portal to <body>: a glass card's backdrop-filter makes it the
           containing block for position:fixed, which would trap the overlay
           inside the card instead of covering the screen */
        <div className="pal-overlay" onClick={() => setOpen(false)} role="dialog" aria-label={`${title} — maximized`}>
          <div className="pal zoomdlg" onClick={(e) => e.stopPropagation()}>
            <div className="zoom-head">
              <div>
                <h3 style={{ margin: 0 }}>{title}</h3>
                {sub && <div className="m" style={{ color: "var(--ink-soft)", marginTop: 2 }}>{sub}</div>}
              </div>
              <button className="kbtn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <div className="zoom-body">
              {large || children}
              {note && <div className="chart-note">{note}</div>}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

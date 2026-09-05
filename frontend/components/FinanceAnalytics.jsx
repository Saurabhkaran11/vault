"use client";

import React, { useEffect, useMemo, useState } from "react";
import { today } from "@/lib/seed";
import { askText } from "@/lib/ai";
import { TopMerchants, MoneyFlow, CategoryShifts, IncomeVsSpend, SavingsWaterfall, WeekendPremium, Zoom } from "./Charts";
import { useAiReady } from "@/hooks/useAiReady";

/* Finance analytics: spending reports over daily / weekly / monthly / yearly
   periods, rendered as the chart type the user picks — bar, line, area, or
   donut (share by category). Pure SVG, consistent with the dashboard charts. */

const PERIODS = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

const CHARTS = [
  ["bar", "▮ Bar"],
  ["line", "∿ Line"],
  ["area", "◢ Area"],
  ["donut", "◔ Donut"],
];

/* colors cycled across categories in the donut + legend */
const CAT_COLORS = ["var(--moss)", "var(--azure)", "var(--gold)", "var(--blue)", "var(--violet)", "var(--ink-soft)", "#5B8DC9"];

const iso = (d) => d.toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* aggregate expenses into time buckets for the chosen period */
function makeBuckets(expenses, period) {
  const now = new Date(today() + "T00:00:00");
  const buckets = [];
  const push = (label, from, to) => buckets.push({ label, from, to, total: 0 });

  if (period === "daily") {
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      push(`${d.getDate()}/${d.getMonth() + 1}`, iso(d), iso(d));
    }
  } else if (period === "weekly") {
    for (let i = 7; i >= 0; i--) {
      const end = new Date(now); end.setDate(now.getDate() - i * 7);
      const start = new Date(end); start.setDate(end.getDate() - 6);
      push(`${start.getDate()}/${start.getMonth() + 1}`, iso(start), iso(end));
    }
  } else if (period === "monthly") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      push(`${MONTHS[d.getMonth()]}${d.getMonth() === 0 ? ` '${String(d.getFullYear()).slice(2)}` : ""}`, iso(d), iso(end));
    }
  } else { // yearly — every year that has data, ending this year
    const years = [...new Set([...expenses.map((e) => +e.date.slice(0, 4)), now.getFullYear()])].sort();
    years.forEach((y) => push(String(y), `${y}-01-01`, `${y}-12-31`));
  }

  expenses.forEach((e) => {
    const b = buckets.find((x) => e.date >= x.from && e.date <= x.to);
    if (b) b.total += e.amount;
  });
  return buckets;
}

function TimeChart({ buckets, type, fmt }) {
  const W = 720, H = 240, padX = 34, padT = 26, padB = 34;
  const n = buckets.length;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const innerW = W - padX * 2, innerH = H - padT - padB;
  const x = (i) => padX + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v) => padT + innerH - (v / max) * innerH;
  const labelEvery = n > 10 ? 2 : 1;

  const pts = buckets.map((b, i) => `${x(i)},${y(b.total)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Spending over time">
      {/* baseline + max gridline */}
      <line x1={padX} y1={padT + innerH} x2={W - padX} y2={padT + innerH} stroke="var(--line)" strokeWidth="1" />
      <line x1={padX} y1={padT} x2={W - padX} y2={padT} stroke="var(--line)" strokeWidth="1" strokeDasharray="4 5" />
      {/* max label sits INSIDE the plot — the left gutter can't fit wide money
          values ("$1,620.34" was clipping to "…20.34" on Yearly) */}
      <text x={padX + 2} y={padT - 6} textAnchor="start" fontSize="9.5" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">{fmt(max)}</text>

      {type === "bar" && buckets.map((b, i) => {
        const bw = Math.min(44, (innerW / n) * 0.62);
        return (
          <g key={i}>
            <rect x={x(i) - bw / 2} y={y(b.total)} width={bw} height={Math.max(padT + innerH - y(b.total), b.total ? 2 : 1)} rx="4"
              fill={i === n - 1 ? "var(--stamp)" : "var(--moss)"} opacity={b.total ? 1 : 0.22} />
            {b.total > 0 && <text x={x(i)} y={y(b.total) - 5} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono" fill="var(--ink)">{fmt(b.total)}</text>}
          </g>
        );
      })}

      {type === "area" && (
        <polygon points={`${x(0)},${padT + innerH} ${pts} ${x(n - 1)},${padT + innerH}`}
          fill="var(--moss)" opacity="0.18" />
      )}
      {(type === "line" || type === "area") && (
        <>
          <polyline points={pts} fill="none" stroke="var(--moss)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {buckets.map((b, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(b.total)} r={b.total ? 4 : 2.5} fill={i === n - 1 ? "var(--stamp)" : "var(--moss)"} stroke="var(--panel)" strokeWidth="1.5" />
              {b.total > 0 && <text x={x(i)} y={y(b.total) - 9} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono" fill="var(--ink)">{fmt(b.total)}</text>}
            </g>
          ))}
        </>
      )}

      {buckets.map((b, i) => (
        i % labelEvery === 0
          ? <text key={`l${i}`} x={x(i)} y={H - 10} textAnchor="middle" fontSize="9.5" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">{b.label}</text>
          : null
      ))}
    </svg>
  );
}

function CategoryDonut({ slices, total, fmt }) {
  let acc = 0;
  const R = 54, C = 2 * Math.PI * R;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
      <svg viewBox="0 0 150 150" width="170" role="img" aria-label="Spending share by category">
        {slices.map(([cat, v], i) => {
          const frac = v / Math.max(1, total), off = acc; acc += frac;
          return (
            <circle key={cat} cx="75" cy="75" r={R} fill="none" stroke={CAT_COLORS[i % CAT_COLORS.length]} strokeWidth="20"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-off * C} transform="rotate(-90 75 75)" />
          );
        })}
        <text x="75" y="72" textAnchor="middle" fontFamily="Fraunces" fontSize="20" fontWeight="650" fill="var(--ink)">{fmt(total)}</text>
        <text x="75" y="90" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="8.5" letterSpacing="1.5" fill="var(--ink-soft)">TOTAL</text>
      </svg>
      <div style={{ fontSize: 13, lineHeight: 2.1, flex: 1, minWidth: 220 }}>
        {slices.map(([cat, v], i) => (
          <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: "var(--ink-soft)" }}>{cat}</span>
            <span className="mono" style={{ marginLeft: "auto", fontSize: 12 }}>{fmt(v)} · {Math.round((v / Math.max(1, total)) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FinanceAnalytics({ fin, fmt, spentByCat = {}, savingsRate = null, recurringMonthly = 0, range: globalRange, onRange }) {
  const expenses = fin.expenses;
  const budgets = fin.budgets || { overall: null, byCat: {} };
  /* follows the app-wide range toggle, and pushes changes back to it */
  const G2P = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
  const P2G = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
  const [period, setPeriod] = useState(G2P[globalRange] || "daily");
  useEffect(() => { if (globalRange && G2P[globalRange] !== period) setPeriod(G2P[globalRange]); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [globalRange]);
  const [chart, setChart] = useState("bar");

  /* ✦ AI monthly review */
  const aiReady = useAiReady();
  const [review, setReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const genReview = async () => {
    if (reviewBusy) return;
    setReviewBusy(true); setReview(null);
    const m = today().slice(0, 7);
    const spent = expenses.filter((e) => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0);
    const income = (fin.incomes || []).filter((i) => i.date.startsWith(m)).reduce((a, i) => a + i.amount, 0);
    const paidBills = (fin.bills || []).filter((b) => b.paid && (b.paidOn || "").startsWith(m));
    const pendingBills = (fin.bills || []).filter((b) => !b.paid);
    const catLines = Object.entries(spentByCat).map(([c, v]) => {
      const cap = budgets.byCat?.[c];
      return `${c}: ${fmt(v)}${cap ? ` (budget ${fmt(cap)}${v > cap ? " — OVER" : ""})` : ""}`;
    }).join("; ");
    const stats =
      `Month: ${m}. Income: ${fmt(income)}. Expenses: ${fmt(spent)}. Bills paid: ${paidBills.length} totaling ${fmt(paidBills.reduce((a, b) => a + b.amount, 0))}. ` +
      `Pending bills: ${pendingBills.map((b) => `${b.title} ${fmt(b.amount)} due ${b.due}`).join("; ") || "none"}. ` +
      `Recurring commitments ≈ ${fmt(Math.round(recurringMonthly))}/month. ` +
      `Overall budget: ${budgets.overall ? fmt(budgets.overall) : "not set"}. By category: ${catLines || "no expenses"}. ` +
      `Savings rate: ${savingsRate !== null ? savingsRate + "%" : "unknown (no income logged)"}. ` +
      `Goals: ${(fin.goals || []).map((g) => `${g.name} ${fmt(g.saved)}/${fmt(g.target)}`).join("; ") || "none"}.`;
    try {
      setReview(await askText(
        `Here are my finances for this month:\n\n${stats}\n\nWrite my monthly money review.`,
        { system: "You are a pragmatic personal-finance coach. Write at most 3 short paragraphs: where the money went this month (name the biggest categories and any budget overruns); the pending/recurring picture and savings rate; one specific, doable change for next month. Plain text, direct, no headings, no generic advice." }
      ));
    } catch (e) {
      setReview(`⚠ ${e.message}`);
    } finally {
      setReviewBusy(false);
    }
  };

  const buckets = useMemo(() => makeBuckets(expenses, period), [expenses, period]);
  const rangeFrom = buckets[0]?.from;
  const inRange = useMemo(() => expenses.filter((e) => rangeFrom && e.date >= rangeFrom), [expenses, rangeFrom]);

  const total = inRange.reduce((a, e) => a + e.amount, 0);
  const active = buckets.filter((b) => b.total > 0).length;
  const avg = active ? total / active : 0;
  const top = buckets.reduce((m, b) => (b.total > m.total ? b : m), { total: 0, label: "—" });

  const slices = useMemo(() => {
    const map = {};
    inRange.forEach((e) => { map[e.cat] = (map[e.cat] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [inRange]);

  const periodName = PERIODS.find((p) => p.key === period)?.label;
  /* the human name of the window the buckets cover — every insight chart
     below scopes itself to this same window via `rangeFrom` */
  const winLabel = { daily: "Last 14 days", weekly: "Last 8 weeks", monthly: "Last 12 months", yearly: "All years" }[period];
  const unit5 = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" }[period];

  /* local insights: this month vs the average of the previous 3 months */
  const insights = useMemo(() => {
    const now = new Date(today() + "T00:00:00");
    const monthKey = (d) => d.toISOString().slice(0, 7);
    const thisM = monthKey(now);
    const prev = [1, 2, 3].map((i) => monthKey(new Date(now.getFullYear(), now.getMonth() - i, 15)));
    const sum = (fil) => expenses.filter(fil).reduce((a, e) => a + e.amount, 0);
    const out = [];
    const totalNow = sum((e) => e.date.startsWith(thisM));
    const totalPrevAvg = prev.reduce((a, m) => a + sum((e) => e.date.startsWith(m)), 0) / 3;
    if (totalPrevAvg > 0 && totalNow > 0) {
      const d = Math.round(((totalNow - totalPrevAvg) / totalPrevAvg) * 100);
      if (Math.abs(d) >= 15) out.push(`Overall spending is ${Math.abs(d)}% ${d > 0 ? "above" : "below"} your 3-month average.`);
    }
    const cats = [...new Set(expenses.map((e) => e.cat))];
    for (const c of cats) {
      const nowC = sum((e) => e.cat === c && e.date.startsWith(thisM));
      const avgC = prev.reduce((a, m) => a + sum((e) => e.cat === c && e.date.startsWith(m)), 0) / 3;
      if (avgC > 0 && nowC > avgC * 1.3 && nowC - avgC > 1) {
        out.push(`${c} is ${Math.round(((nowC - avgC) / avgC) * 100)}% above its 3-month average (${fmt(nowC)} vs ~${fmt(avgC)}).`);
      }
    }
    /* budget overruns */
    for (const [c, cap] of Object.entries(budgets.byCat || {})) {
      const nowC = spentByCat[c] || 0;
      if (cap > 0 && nowC > cap) out.push(`${c} is over its ${fmt(cap)} budget — ${fmt(nowC)} so far this month.`);
    }
    if (budgets.overall > 0 && totalNow > budgets.overall)
      out.push(`Overall spending (${fmt(totalNow)}) has passed your ${fmt(budgets.overall)} monthly budget.`);
    if (savingsRate !== null && savingsRate < 0)
      out.push(`You've spent more than you earned this month (savings rate ${savingsRate}%).`);
    return out.slice(0, 5);
  }, [expenses, fmt, budgets, spentByCat, savingsRate]);

  /* analyst view — the ratios an accountant would reach for first */
  const kpis = useMemo(() => {
    const now = new Date(today() + "T00:00:00");
    const thisM = today().slice(0, 7);
    const lastM = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);
    const sumE = (fil) => expenses.filter(fil).reduce((a, e) => a + e.amount, 0);
    const spentNow = sumE((e) => e.date.startsWith(thisM));
    const spentLast = sumE((e) => e.date.startsWith(lastM));
    const income = (fin.incomes || []).filter((i) => i.date.startsWith(thisM)).reduce((a, i) => a + i.amount, 0);
    const paidBills = (fin.bills || []).filter((b) => b.paid && (b.paidOn || "").startsWith(thisM)).reduce((a, b) => a + b.amount, 0);
    const outflow = spentNow + paidBills;
    const cashflow = income - outflow;
    const daysIn = now.getDate();
    const daysTotal = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const burn = daysIn > 0 ? outflow / daysIn : 0;
    const projected = burn * daysTotal;
    const mom = spentLast > 0 ? Math.round(((spentNow - spentLast) / spentLast) * 100) : null;
    const fixedRatio = income > 0 ? Math.round((recurringMonthly / income) * 100) : null;
    const catNow = Object.entries(spentByCat).sort((a, b) => b[1] - a[1])[0];
    const topShare = catNow && spentNow > 0 ? Math.round((catNow[1] / spentNow) * 100) : null;
    const biggest = expenses.filter((e) => e.date.startsWith(thisM)).sort((a, b) => b.amount - a.amount)[0];
    return [
      { k: "Cash flow", v: fmt(cashflow), tone: cashflow >= 0 ? "ok" : "bad", d: cashflow >= 0 ? "money in beat money out this month" : "spending outpaced income this month" },
      { k: "Daily burn", v: fmt(Math.round(burn)), d: `avg going out per day · on pace for ${fmt(Math.round(projected))} by month-end` },
      mom !== null && { k: "Vs last month", v: `${mom >= 0 ? "+" : ""}${mom}%`, tone: mom > 15 ? "bad" : mom < -5 ? "ok" : "", d: `expenses ${fmt(spentNow)} now vs ${fmt(spentLast)} last month` },
      fixedRatio !== null && { k: "Fixed costs", v: `${fixedRatio}%`, tone: fixedRatio > 50 ? "bad" : "", d: "of income committed to recurring bills — analysts like this under 50%" },
      topShare !== null && { k: "Concentration", v: `${topShare}%`, d: `of this month's spend is ${catNow[0]} — a high share means one lever to pull` },
      biggest && { k: "Biggest expense", v: fmt(biggest.amount), d: `${biggest.desc} (${biggest.cat}, ${biggest.date.slice(8)}/${biggest.date.slice(5, 7)})` },
    ].filter(Boolean);
  }, [expenses, fin, fmt, spentByCat, recurringMonthly]);

  return (
    <>
    {/* the range + chart-type controls float just under the Finance featbar,
       so switching Daily/Weekly/Monthly/Yearly never needs a scroll back up */}
    <div className="featbar fanal-sticky">
      <div className="doctabs" role="tablist" aria-label="Report period" style={{ display: "inline-flex" }}>
        {PERIODS.map((p) => (
          <button key={p.key} className={period === p.key ? "on" : ""} role="tab"
            aria-selected={period === p.key} onClick={() => { setPeriod(p.key); onRange?.(P2G[p.key]); }}>{p.label}</button>
        ))}
      </div>
      <div className="charttabs" role="group" aria-label="Chart type">
        {CHARTS.map(([k, label]) => (
          <button key={k} className={chart === k ? "on" : ""}
            aria-pressed={chart === k} onClick={() => setChart(k)}
            title={k === "donut" ? "Share of spending by category" : `${label.slice(2)} chart over time`}>
            {label}
          </button>
        ))}
      </div>
    </div>
    <div className="card">
      <div className="fanal-stats">
        <span><b>{fmt(total)}</b> total in this {periodName.toLowerCase()} range</span>
        <span><b>{fmt(avg)}</b> avg per active {period === "daily" ? "day" : period === "weekly" ? "week" : period === "monthly" ? "month" : "year"}</span>
        <span>peak <b>{fmt(top.total)}</b>{top.total > 0 ? ` (${top.label})` : ""}</span>
      </div>

      <div className="kpi-grid">
        {kpis.map((x) => (
          <div key={x.k} className={`kpi ${x.tone || ""}`}>
            <span className="kpi-k mono">{x.k}</span>
            <span className="kpi-v">{x.v}</span>
            <span className="kpi-d">{x.d}</span>
          </div>
        ))}
      </div>

      {insights.length > 0 && (
        <div className="finsights">
          {insights.map((s, i) => <div key={i} className="finsight">◆ {s}</div>)}
        </div>
      )}

      <div className="fanal-review">
        <button className="aibtn" disabled={reviewBusy || !aiReady} onClick={genReview}
          title={aiReady ? "AI reviews this month's numbers and suggests one change" : "Set up an AI model in Settings"}>
          {reviewBusy ? "Reviewing…" : review ? "✦ Regenerate monthly review" : "✦ AI monthly review"}
        </button>
        {review && <div className="digest" style={{ marginTop: 10 }}>{review}</div>}
      </div>

      {expenses.length === 0 ? (
        <div className="empty">No expenses logged yet — add some on the Board tab and your reports light up here.</div>
      ) : chart === "donut" ? (
        slices.length
          ? <Zoom title="Spending breakdown" sub="Share of spending by category in the chosen range."
              note={<><b>How to read:</b> each slice is one category&rsquo;s share of spending in the chosen range; the centre shows the total. Bigger slice = bigger share of your money.</>}>
              <CategoryDonut slices={slices} total={total} fmt={fmt} />
            </Zoom>
          : <div className="empty">Nothing in this range yet — switch to a longer period.</div>
      ) : (
        <Zoom title="Spending over time" sub="Spending bucketed across the chosen range."
          note={<><b>How to read:</b> spending over time in the chosen range — hover any point for the exact amount. Switch Bar, Line or Area above; the shape is the same story drawn differently.</>}>
          <TimeChart buckets={buckets} type={chart} fmt={fmt} />
        </Zoom>
      )}


    </div>

    {/* every insight chart gets its OWN card — one mega-card buried them all */}
    {expenses.length > 0 && (
      <div className="fanal-grid">
        <div className="card fanal-card">
          <h3>Category shifts</h3>
          <div className="m fanal-sub">{winLabel} vs the period before — red grows, green shrinks.</div>
          <Zoom title="Category shifts" sub={`${winLabel} vs the period before — red grows, green shrinks.`}
            note={<><b>How to read:</b> each row is a spending category with its 8-week trend. The chip compares the chosen range to the equal window before it — <b>red</b> means it grew, <b>green</b> means it shrank, &ldquo;new&rdquo; had no spend before.</>}><CategoryShifts expenses={fin.expenses} fmt={fmt} from={rangeFrom} /></Zoom>
        </div>
        <div className="card fanal-card">
          <h3>Income vs spend</h3>
          <div className="m fanal-sub">Last 5 {unit5} — the green haze is what you kept.</div>
          <Zoom title="Income vs spend" sub={`Last 5 ${unit5} — the green haze is what you kept.`}
            note={<><b>How to read:</b> two bars per {unit5.slice(0, -1)} — income beside spending. When the income bar is taller, the gap between them is money you kept.</>}><IncomeVsSpend incomes={fin.incomes} expenses={fin.expenses} fmt={fmt} period={period} /></Zoom>
        </div>
        <div className="card fanal-card">
          <h3>Savings waterfall</h3>
          <div className="m fanal-sub">{winLabel}: income stepping down to what you kept.</div>
          <Zoom title="Savings waterfall" sub={`${winLabel}: income stepping down to what you kept.`}
            note={<><b>How to read:</b> start at the income bar on the left; every step down is one category&rsquo;s spending. The final bar is what survived the range — your savings.</>}><SavingsWaterfall incomes={fin.incomes} expenses={fin.expenses} fmt={fmt} from={rangeFrom} /></Zoom>
        </div>
        <div className="card fanal-card">
          <h3>Weekend premium</h3>
          <div className="m fanal-sub">Average daily spend, weekday vs weekend · {winLabel.toLowerCase()}.</div>
          <Zoom title="Weekend premium" sub={`Average daily spend, weekday vs weekend · ${winLabel.toLowerCase()}.`}
            note={<><b>How to read:</b> the two bars are your average spend on a weekday vs a weekend day. The multiplier says how much pricier your weekends run — most people&rsquo;s are 1.5–2×.</>}><WeekendPremium expenses={fin.expenses} fmt={fmt} from={rangeFrom} /></Zoom>
        </div>
        <div className="card fanal-card fanal-wide">
          <h3>Money flow</h3>
          <div className="m fanal-sub">{winLabel}: income → categories → where it lands. Hover any ribbon.</div>
          <Zoom title="Money flow" sub={`${winLabel}: income → categories → where it lands.`}
            note={<><b>How to read:</b> money flows left to right — income sources → spending categories → the merchants where it landed. Ribbon thickness is the amount; hover any ribbon for the exact figure. The green ribbon is money you kept.</>}><MoneyFlow incomes={fin.incomes} expenses={fin.expenses} fmt={fmt} from={rangeFrom} /></Zoom>
        </div>
        <div className="card fanal-card fanal-wide">
          <h3>Top merchants</h3>
          <div className="m fanal-sub">{winLabel} — click a merchant for its habit math.</div>
          <Zoom title="Top merchants" sub={`${winLabel} — click a merchant for its habit math.`}
            note={<><b>How to read:</b> your biggest destinations for money in the chosen range, largest first; the ×&nbsp;count is visits. Click a bar to see the habit math — per-visit and per-month cost.</>}><TopMerchants expenses={expenses} fmt={fmt} from={rangeFrom} /></Zoom>
        </div>
      </div>
    )}
    </>
  );
}

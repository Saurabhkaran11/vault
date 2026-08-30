"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SECTIONS, daysAgo, fmtK } from "@/lib/seed";
import { rangeSeries, Zoom } from "./Charts";
import { safeSet } from "@/lib/safeStorage";
import { uid } from "@/lib/id";

/* Chart Lab — SignalFx-style user charts.
 *
 * Any feature's data can become a chart the user defines: pick a source,
 * a shape, a range, an optional filter — and every chart opens into a
 * full-screen explorer where those choices are LIVE controls, with the
 * numbers table underneath. Configs are plain objects in vault.charts.v1,
 * so they back up, sync and cross-tab like everything else. */

const KEY = "vault.charts.v1";

export const loadCharts = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
export const upsertChart = (cfg) => {
  const all = loadCharts();
  const i = all.findIndex((c) => c.id === cfg.id);
  if (i >= 0) all[i] = cfg; else all.push(cfg);
  try { safeSet(KEY, JSON.stringify(all)); } catch {}
};
export const deleteChart = (id) => {
  try { safeSet(KEY, JSON.stringify(loadCharts().filter((c) => c.id !== id))); } catch {}
};

export const SOURCES = {
  items:    { label: "Items saved",  money: false, catKey: "type", catLabel: "Section" },
  tasks:    { label: "Tasks done",   money: false },
  expenses: { label: "Spending",     money: true,  catKey: "cat",  catLabel: "Category" },
  income:   { label: "Income",       money: true },
  bills:    { label: "Bills paid",   money: true },
};
const TYPES = [["bars", "▮ Bars"], ["area", "◺ Area"], ["donut", "◔ Donut"]];
const RANGES = [["day", "14 days"], ["week", "8 weeks"], ["month", "12 months"], ["year", "5 years"]];

export const newChartCfg = () => ({ id: uid(), title: "", source: "expenses", type: "bars", range: "month", filter: "" });
export const PRESET_TASKS = () => ({ ...newChartCfg(), title: "Tasks finished", source: "tasks", type: "area", range: "week" });
export const PRESET_SPEND = () => ({ ...newChartCfg(), title: "Spending", source: "expenses", type: "bars", range: "week" });

/* read every store fresh — charts must reflect reality, not a snapshot */
export function readStores() {
  const j = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; } catch { return fb; } };
  const fin = j("vault.finance.v1", {});
  return {
    items: (j("vault.items.v1", []) || []).filter((i) => !i.deleted),
    tasks: (j("vault.todos.v1", {}).tasks || []).filter((t) => t.done && t.doneAt),
    expenses: fin.expenses || [],
    income: fin.incomes || [],
    bills: (fin.bills || []).filter((b) => b.paid && b.paidOn),
  };
}

/* config → plotted data. Money sources sum amounts; the rest count. */
export function chartData(cfg, stores) {
  const src = SOURCES[cfg.source] || SOURCES.expenses;
  let rows = stores[cfg.source] || [];
  if (cfg.filter && src.catKey) rows = rows.filter((r) => (r[src.catKey] || "Other") === cfg.filter);
  const dateOf = (r) => r.doneAt || r.paidOn || r.date;
  const dates = rows.map(dateOf);
  const weights = src.money ? rows.map((r) => +r.amount || 0) : null;
  const series = rangeSeries(dates, cfg.range, weights);
  const total = series.values.reduce((a, v) => a + v, 0);

  let slices = null;
  if (src.catKey) {
    const windowDays = { day: 14, week: 56, month: 365, year: 1830 }[cfg.range] || 56;
    const by = {};
    (stores[cfg.source] || []).forEach((r) => {
      if (daysAgo(dateOf(r)) > windowDays) return;
      const k = r[src.catKey] || "Other";
      by[k] = (by[k] || 0) + (src.money ? (+r.amount || 0) : 1);
    });
    slices = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }
  return { ...series, total, slices, money: src.money, catKey: src.catKey, catLabel: src.catLabel };
}

const fmtVal = (v, money, sym = "$") => (money ? `${sym}${Math.round(v).toLocaleString()}` : fmtK(v));

const PALETTE = ["var(--chart)", "var(--gold)", "var(--violet)", "var(--azure)", "var(--blue)", "var(--stamp)"];

/* measured-width plot — same lesson as MoneyFlow: never stretch a viewBox */
function useWidth(ref, fallback = 560) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") { setW(el?.clientWidth || fallback); return; }
    const ro = new ResizeObserver((es) => setW(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

export function LabPlot({ cfg, data, height = 150, big = false, sym = "$" }) {
  const ref = React.useRef(null);
  const w = useWidth(ref);
  const [tip, setTip] = useState(null);
  const W = Math.max(240, w || 560), H = height;
  const { values, labels, tips, money, slices } = data;

  let body = null;
  if (cfg.type === "donut" && slices?.length) {
    const total = slices.reduce((a, [, v]) => a + v, 0) || 1;
    const R = H / 2 - 8, cx = R + 10, cy = H / 2;
    let acc = 0;
    const C = 2 * Math.PI * (R * 0.72);
    body = (
      <svg width={W} height={H} style={{ display: "block" }} role="img" aria-label={cfg.title || "Breakdown"}>
        {slices.map(([k, v], i) => {
          const frac = v / total, off = acc; acc += frac;
          return (
            <circle key={k} cx={cx} cy={cy} r={R * 0.72} fill="none" stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={big ? 26 : 18} strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-off * C}
              transform={`rotate(-90 ${cx} ${cy})`}
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: `${k} · ${fmtVal(v, money, sym)} (${Math.round(frac * 100)}%)` })} />
          );
        })}
        <text x={cx} y={cy + 5} textAnchor="middle" fontFamily="Fraunces" fontSize={big ? 22 : 16} fontWeight="650" fill="var(--ink)">
          {fmtVal(total, money, sym)}
        </text>
        {slices.map(([k, v], i) => (
          <g key={k}>
            <rect x={cx + R + 24} y={12 + i * (big ? 26 : 20)} width="11" height="11" rx="3" fill={PALETTE[i % PALETTE.length]} />
            <text x={cx + R + 42} y={22 + i * (big ? 26 : 20)} fontFamily="Public Sans" fontSize={big ? 14 : 12} fill="var(--ink)">
              {k.length > 16 ? k.slice(0, 15) + "…" : k}
            </text>
            <text x={W - 8} y={22 + i * (big ? 26 : 20)} textAnchor="end" fontFamily="IBM Plex Mono" fontSize={big ? 12.5 : 11} fill="var(--ink-soft)">
              {fmtVal(v, money, sym)}
            </text>
          </g>
        ))}
      </svg>
    );
  } else {
    const max = Math.max(...values, 1);
    const n = values.length || 1;
    const pad = big ? 44 : 8;
    const plotW = W - pad - 8, bw = plotW / n;
    const Y = (v) => H - 26 - (v / max) * (H - 44);
    const gridVals = big ? [0.5, 1] : [];
    const labelEvery = Math.ceil(n / (big ? 10 : 5));
    body = (
      <svg width={W} height={H} style={{ display: "block" }} role="img" aria-label={cfg.title || "Chart"}>
        <line x1={pad} y1={H - 26} x2={W - 8} y2={H - 26} stroke="var(--line)" />
        {gridVals.map((f) => (
          <g key={f}>
            <line x1={pad} y1={Y(max * f)} x2={W - 8} y2={Y(max * f)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={2} y={Y(max * f) + 3} fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)">{fmtVal(max * f, money, sym)}</text>
          </g>
        ))}
        {cfg.type === "area" && (
          <>
            <polygon points={`${pad},${Y(0)} ${values.map((v, i) => `${pad + i * bw + bw / 2},${Y(v)}`).join(" ")} ${pad + (n - 1) * bw + bw / 2},${Y(0)}`}
              fill="var(--chart)" opacity="0.14" />
            <polyline points={values.map((v, i) => `${pad + i * bw + bw / 2},${Y(v)}`).join(" ")}
              fill="none" stroke="var(--chart)" strokeWidth={big ? 3.5 : 2.5} strokeLinejoin="round" />
          </>
        )}
        {values.map((v, i) => (
          <g key={i}>
            <rect x={pad + i * bw} y="0" width={bw} height={H} fill="transparent"
              onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: `${tips?.[i] ?? labels[i]} · ${fmtVal(v, money, sym)}` })} />
            {cfg.type !== "area" && (
              <rect x={pad + i * bw + 1.5} y={Y(v)} width={Math.max(bw - 3, 2)} height={Math.max(H - 26 - Y(v), 2)}
                rx="2.5" fill="var(--chart)" opacity={v ? 1 : 0.18} style={{ pointerEvents: "none" }} />
            )}
            {i % labelEvery === 0 && (
              <text x={pad + i * bw + bw / 2} y={H - 9} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)"
                style={{ pointerEvents: "none" }}>{labels[i]}</text>
            )}
          </g>
        ))}
      </svg>
    );
  }

  return (
    <div className="chart-wrap" ref={ref} onMouseLeave={() => setTip(null)}>
      {w > 0 && body}
      {tip && <div className="chart-tip mono" style={{ left: tip.x, top: tip.y }} role="status">{tip.text}</div>}
    </div>
  );
}

/* ---------- the dashboard section: the user's own charts */
export function YourCharts({ rev, onExplore, onNew, sym = "$" }) {
  const [stores, setStores] = useState(null);
  useEffect(() => { setStores(readStores()); }, [rev]);
  const charts = useMemo(() => (stores ? loadCharts() : []), [stores, rev]);
  if (!stores) return null;

  return (
    <>
      <div className="sec-label mono yc-head">
        Your charts
        <button className="kbtn yc-add" onClick={onNew} title="Build a chart from any feature's data">＋ Add chart</button>
      </div>
      {charts.length === 0 ? (
        <button className="card yc-empty" onClick={onNew}>
          <b>＋ Build your own chart</b>
          <span>Any feature, any range — spending by month, tasks by week, items by section. Click any chart to explore and customize it.</span>
        </button>
      ) : (
        <div className="yc-grid">
          {charts.map((cfg) => {
            const data = chartData(cfg, stores);
            return (
              <button key={cfg.id} className="card yc-card" onClick={() => onExplore(cfg)}
                title="Open — explore and customize this chart">
                <span className="yc-title">
                  {cfg.title || SOURCES[cfg.source].label}
                  <span className="yc-open" aria-hidden="true">⤢</span>
                </span>
                <span className="yc-sub mono">{SOURCES[cfg.source].label} · {RANGES.find(([k]) => k === cfg.range)?.[1]}{cfg.filter ? ` · ${cfg.filter}` : ""}</span>
                <LabPlot cfg={cfg} data={data} height={130} sym={sym} />
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- full-screen explorer: every config choice is a live control */
export function ChartExplorer({ cfg: initial, isNew, onSave, onDelete, onClose, sym = "$" }) {
  const [cfg, setCfg] = useState(initial);
  const [stores] = useState(readStores);
  const data = useMemo(() => chartData(cfg, stores), [cfg, stores]);
  const src = SOURCES[cfg.source];
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  useEffect(() => {
    /* when the maximized chart view is open, Escape should close only it —
       our capture listener registered first, so check the DOM, not the event */
    const onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".zoomdlg")) onClose(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const catOptions = useMemo(() => {
    if (!src.catKey) return [];
    return [...new Set((stores[cfg.source] || []).map((r) => r[src.catKey] || "Other"))].sort();
  }, [cfg.source, src.catKey, stores]);

  const avg = data.values.length ? data.total / Math.max(data.values.filter((v) => v > 0).length, 1) : 0;
  const peakIdx = data.values.indexOf(Math.max(...data.values));

  return createPortal(
    /* portal + centered: pops in the middle of the screen, and no glass
       ancestor's backdrop-filter can trap the fixed overlay */
    <div className="pal-overlay centered" onClick={onClose} role="dialog" aria-label="Chart explorer">
      <div className="pal explorer" onClick={(e) => e.stopPropagation()}>
        <div className="exp-head">
          <input className="exp-title" value={cfg.title} placeholder={src.label}
            aria-label="Chart title" onChange={(e) => set({ title: e.target.value })} />
          <button className="kbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="exp-controls">
          <label className="exp-ctl">
            <span className="mono">SOURCE</span>
            <select value={cfg.source} onChange={(e) => set({ source: e.target.value, filter: "" })} aria-label="Data source">
              {Object.entries(SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          <span className="exp-ctl">
            <span className="mono">SHAPE</span>
            <span className="doctabs">
              {TYPES.filter(([k]) => k !== "donut" || src.catKey).map(([k, label]) => (
                <button key={k} className={cfg.type === k ? "on" : ""} onClick={() => set({ type: k })}>{label}</button>
              ))}
            </span>
          </span>
          <span className="exp-ctl">
            <span className="mono">RANGE</span>
            <span className="doctabs">
              {RANGES.map(([k, label]) => (
                <button key={k} className={cfg.range === k ? "on" : ""} onClick={() => set({ range: k })}>{label}</button>
              ))}
            </span>
          </span>
          {src.catKey && (
            <label className="exp-ctl">
              <span className="mono">{src.catLabel.toUpperCase()}</span>
              <select value={cfg.filter} onChange={(e) => set({ filter: e.target.value })} aria-label={src.catLabel}>
                <option value="">All</option>
                {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="exp-stats mono">
          <span><b>{fmtVal(data.total, data.money, sym)}</b> total</span>
          <span><b>{fmtVal(avg, data.money, sym)}</b> avg per active bucket</span>
          {peakIdx >= 0 && data.values[peakIdx] > 0 && (
            <span>peak <b>{fmtVal(data.values[peakIdx], data.money, sym)}</b> · {data.tips?.[peakIdx] ?? data.labels[peakIdx]}</span>
          )}
        </div>

        <Zoom title={cfg.title || src.label}
          sub={`${src.label} · maximized view`}
          large={<LabPlot cfg={cfg} data={data} height={440} big sym={sym} />}>
          <LabPlot cfg={cfg} data={data} height={300} big sym={sym} />
        </Zoom>

        {cfg.type !== "donut" && (
          <div className="exp-table">
            {data.values.map((v, i) => (
              <div key={i} className="exp-row" style={{ opacity: v ? 1 : 0.45 }}>
                <span className="mono">{data.tips?.[i] ?? data.labels[i]}</span>
                <span className="exp-bar"><i style={{ width: `${(v / Math.max(...data.values, 1)) * 100}%` }} /></span>
                <b className="mono">{fmtVal(v, data.money, sym)}</b>
              </div>
            ))}
          </div>
        )}

        <div className="exp-foot">
          {!isNew && <button className="kbtn kdel" onClick={() => onDelete(cfg.id)}>Delete chart</button>}
          <span style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={onClose}>Cancel</button>
          <button className="btn sm" onClick={() => onSave(cfg)}>{isNew ? "Add to my charts" : "Save changes"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

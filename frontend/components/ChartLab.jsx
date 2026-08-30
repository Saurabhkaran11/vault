"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SECTIONS, daysAgo, fmtK } from "@/lib/seed";
import { rangeSeries, HowTo } from "./Charts";
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

/* Every feature is a source, and every source declares its DIMENSIONS —
 * the axes a user can filter on or nest by. `get` turns a row into a
 * human-readable group name. Dateless sources (board cards carry no
 * timestamps) chart as breakdowns instead of time series. */
export const SOURCES = {
  items: {
    label: "Items saved", money: false,
    dims: {
      type: { label: "Section", get: (r) => SECTIONS[r.type]?.label || r.type || "Other" },
      tag:  { label: "Tag", get: (r) => (r.tags?.[0] ? `#${r.tags[0]}` : "untagged") },
    },
  },
  tasks:    { label: "Tasks done", money: false, dims: {} },
  expenses: {
    label: "Spending", money: true,
    dims: {
      cat:      { label: "Category", get: (r) => r.cat || "Other" },
      merchant: { label: "Merchant", get: (r) => (r.desc || "—").trim().replace(/\s+/g, " ").toUpperCase().slice(0, 18) },
      pay:      { label: "Entry", get: (r) => (r.pay ? "Imported" : "Manual") },
    },
  },
  income: {
    label: "Income", money: true,
    dims: { source: { label: "Source", get: (r) => r.source || "Income" } },
  },
  bills: {
    label: "Bills paid", money: true,
    dims: { name: { label: "Bill", get: (r) => r.name || "Bill" } },
  },
  cards: {
    label: "Board cards", money: false, dateless: true,
    dims: {
      col:   { label: "Column", get: (r) => r.col || "Column" },
      board: { label: "Board", get: (r) => r.board || "Board" },
    },
  },
};
const primaryDimKey = (src) => Object.keys(src.dims || {})[0] || null;
const TYPES = [["bars", "▮ Bars"], ["area", "◺ Area"], ["donut", "◔ Donut"]];
const RANGES = [["day", "14 days"], ["week", "8 weeks"], ["month", "12 months"], ["year", "5 years"]];

export const newChartCfg = () => ({ id: uid(), title: "", source: "expenses", type: "bars", range: "month", filter: "", filterDim: "", nest: "" });
export const PRESET_TASKS = () => ({ ...newChartCfg(), title: "Tasks finished", source: "tasks", type: "area", range: "week" });
export const PRESET_SPEND = () => ({ ...newChartCfg(), title: "Spending", source: "expenses", type: "bars", range: "week" });

/* read every store fresh — charts must reflect reality, not a snapshot */
export function readStores() {
  const j = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; } catch { return fb; } };
  const fin = j("vault.finance.v1", {});
  const boards = j("vault.boards.v1", {}).boards || [];
  return {
    items: (j("vault.items.v1", []) || []).filter((i) => !i.deleted),
    tasks: (j("vault.todos.v1", {}).tasks || []).filter((t) => t.done && t.doneAt),
    expenses: fin.expenses || [],
    income: fin.incomes || [],
    bills: (fin.bills || []).filter((b) => b.paid && b.paidOn),
    cards: boards.flatMap((b) => (b.cols || []).flatMap((c) =>
      (c.cards || []).map((k) => ({ ...k, col: c.title || "Column", board: b.name || "Board" })))),
  };
}

/* config → plotted data. Money sources sum amounts; the rest count.
 * filterDim narrows rows on any dimension; nest splits every bucket by a
 * second dimension (stacked bars / multi-line / nested donut). */
export function chartData(cfg, stores) {
  const src = SOURCES[cfg.source] || SOURCES.expenses;
  const dims = src.dims || {};
  const pKey = primaryDimKey(src);
  let rows = stores[cfg.source] || [];

  /* filter on the chosen dimension (defaults to the primary one). Old saved
     charts stored raw values ("note"), new ones store display values
     ("Notes") — match either so nothing silently breaks. */
  const fKey = dims[cfg.filterDim] ? cfg.filterDim : pKey;
  const fDim = fKey ? dims[fKey] : null;
  if (cfg.filter && fDim) rows = rows.filter((r) => fDim.get(r) === cfg.filter || String(r[fKey] ?? "") === cfg.filter);

  const dateOf = (r) => r.doneAt || r.paidOn || r.date;
  const wOf = (r) => (src.money ? (+r.amount || 0) : 1);
  const nDim = cfg.nest && dims[cfg.nest] ? dims[cfg.nest] : null;

  /* dateless sources (board cards): no time axis — always a breakdown */
  if (src.dateless) {
    const sliceDim = nDim || (pKey ? dims[pKey] : null);
    const by = {};
    rows.forEach((r) => { const k = sliceDim ? sliceDim.get(r) : "All"; by[k] = (by[k] || 0) + wOf(r); });
    const slices = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const total = rows.reduce((a, r) => a + wOf(r), 0);
    return { values: [], labels: [], tips: [], total, slices, money: src.money, dateless: true, catLabel: sliceDim?.label };
  }

  const series = rangeSeries(rows.map(dateOf), cfg.range, src.money ? rows.map((r) => +r.amount || 0) : null);
  const total = series.values.reduce((a, v) => a + v, 0);

  /* nested dimension → one series per group (top 4 + Other) */
  let nested = null;
  if (nDim) {
    const groups = {};
    rows.forEach((r) => { const k = nDim.get(r) || "Other"; (groups[k] = groups[k] || []).push(r); });
    let keys = Object.entries(groups)
      .map(([k, rs]) => [k, rs.reduce((a, r) => a + wOf(r), 0)])
      .sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (keys.length > 5) {
      groups.Other = [...(groups.Other || []), ...keys.slice(4).filter((k) => k !== "Other").flatMap((k) => groups[k])];
      keys = [...keys.slice(0, 4).filter((k) => k !== "Other"), "Other"];
    }
    const matrix = keys.map((k) => rangeSeries(groups[k].map(dateOf), cfg.range,
      src.money ? groups[k].map((r) => +r.amount || 0) : null).values);
    nested = { keys, matrix, label: nDim.label };
  }

  /* donut slices honour the filter AND the nest choice (nest wins) */
  let slices = null;
  const sliceDim = nDim || (pKey ? dims[pKey] : null);
  if (sliceDim) {
    const windowDays = { day: 14, week: 56, month: 365, year: 1830 }[cfg.range] || 56;
    const by = {};
    rows.forEach((r) => {
      if (daysAgo(dateOf(r)) > windowDays) return;
      const k = sliceDim.get(r) || "Other";
      by[k] = (by[k] || 0) + wOf(r);
    });
    slices = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }
  return { ...series, total, slices, nested, money: src.money, catLabel: fDim?.label };
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
  const { values, labels, tips, money, slices, nested } = data;

  let body = null;
  const wantDonut = cfg.type === "donut" || data.dateless;
  if (wantDonut && !slices?.length) {
    body = (
      <div className="m" style={{ color: "var(--ink-soft)", padding: "34px 10px" }}>
        Nothing to plot yet — add some data in this feature and the chart draws itself.
      </div>
    );
  } else if (wantDonut && slices?.length) {
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
        {cfg.type === "area" && !nested && (
          <>
            <polygon points={`${pad},${Y(0)} ${values.map((v, i) => `${pad + i * bw + bw / 2},${Y(v)}`).join(" ")} ${pad + (n - 1) * bw + bw / 2},${Y(0)}`}
              fill="var(--chart)" opacity="0.14" />
            <polyline points={values.map((v, i) => `${pad + i * bw + bw / 2},${Y(v)}`).join(" ")}
              fill="none" stroke="var(--chart)" strokeWidth={big ? 3.5 : 2.5} strokeLinejoin="round" />
          </>
        )}
        {/* nested area = one line per group */}
        {cfg.type === "area" && nested && nested.keys.map((k, ki) => (
          <polyline key={k} points={nested.matrix[ki].map((v, i) => `${pad + i * bw + bw / 2},${Y(v)}`).join(" ")}
            fill="none" stroke={PALETTE[ki % PALETTE.length]} strokeWidth={big ? 3 : 2.2} strokeLinejoin="round" />
        ))}
        {values.map((v, i) => {
          const breakdown = nested
            ? " · " + nested.keys.map((k, ki) => nested.matrix[ki][i] ? `${k} ${fmtVal(nested.matrix[ki][i], money, sym)}` : null)
                .filter(Boolean).slice(0, 3).join(" · ")
            : "";
          return (
            <g key={i}>
              <rect x={pad + i * bw} y="0" width={bw} height={H} fill="transparent"
                onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: `${tips?.[i] ?? labels[i]} · ${fmtVal(v, money, sym)}${breakdown}` })} />
              {cfg.type !== "area" && !nested && (
                <rect x={pad + i * bw + 1.5} y={Y(v)} width={Math.max(bw - 3, 2)} height={Math.max(H - 26 - Y(v), 2)}
                  rx="2.5" fill="var(--chart)" opacity={v ? 1 : 0.18} style={{ pointerEvents: "none" }} />
              )}
              {/* nested bars = stacked segments, bottom-up in group order */}
              {cfg.type !== "area" && nested && (() => {
                let acc = 0;
                return nested.keys.map((k, ki) => {
                  const sv = nested.matrix[ki][i];
                  if (!sv) return null;
                  const y0 = acc; acc += sv;
                  const yTop = Y(acc), yBot = Y(y0);
                  return (
                    <rect key={k} x={pad + i * bw + 1.5} y={yTop} width={Math.max(bw - 3, 2)}
                      height={Math.max(yBot - yTop, 1)} rx="1.5" fill={PALETTE[ki % PALETTE.length]}
                      onMouseMove={(e) => { e.stopPropagation(); setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: `${tips?.[i] ?? labels[i]} · ${k} · ${fmtVal(sv, money, sym)} of ${fmtVal(v, money, sym)}` }); }} />
                  );
                });
              })()}
              {i % labelEvery === 0 && (
                <text x={pad + i * bw + bw / 2} y={H - 9} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="9.5" fill="var(--ink-soft)"
                  style={{ pointerEvents: "none" }}>{labels[i]}</text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <div className="chart-wrap labplot-wrap" ref={ref} onMouseLeave={() => setTip(null)}>
      {w > 0 && body}
      {nested && cfg.type !== "donut" && (
        <div className="lab-legend">
          {nested.keys.map((k, ki) => (
            <span key={k} className="ll-chip"><i style={{ background: PALETTE[ki % PALETTE.length] }} />{k}</span>
          ))}
        </div>
      )}
      {tip && <div className="chart-tip mono" style={{ left: tip.x, top: tip.y }} role="status">{tip.text}</div>}
    </div>
  );
}

/* ---------- the dashboard section: the user's own charts */
export function YourCharts({ rev, onExplore, sym = "$" }) {
  const [stores, setStores] = useState(null);
  useEffect(() => { setStores(readStores()); }, [rev]);
  const charts = useMemo(() => (stores ? loadCharts() : []), [stores, rev]);
  if (!stores) return null;
  /* one Add-chart entry point lives in the Insights header up top — with no
     charts yet this section simply stays out of the way */
  if (charts.length === 0) return null;

  return (
    <>
      <div className="sec-label mono yc-head">Your charts</div>
      {(
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
                <span className="yc-sub mono">{SOURCES[cfg.source].label}{SOURCES[cfg.source].dateless ? "" : ` · ${RANGES.find(([k]) => k === cfg.range)?.[1]}`}{cfg.filter ? ` · ${cfg.filter}` : ""}{cfg.nest && SOURCES[cfg.source].dims?.[cfg.nest] ? ` · by ${SOURCES[cfg.source].dims[cfg.nest].label.toLowerCase()}` : ""}</span>
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
  /* charts open as a clean VIEW; the builder controls only appear on ✎ Edit.
     A brand-new chart starts in edit (there is nothing to view yet). */
  const [editing, setEditing] = useState(!!isNew);
  const [fresh, setFresh] = useState(!!isNew);
  const [saved, setSaved] = useState(initial);
  const [stores] = useState(readStores);
  const data = useMemo(() => chartData(cfg, stores), [cfg, stores]);
  const src = SOURCES[cfg.source];
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const cancelEdit = () => {
    if (fresh) { onClose(); return; }
    setCfg(saved); setEditing(false);
  };
  const saveEdit = () => {
    onSave(cfg); setSaved(cfg); setFresh(false); setEditing(false);
  };

  const editingRef = React.useRef(null);
  editingRef.current = { editing, cancelEdit };
  useEffect(() => {
    /* Escape unwinds one layer: edit mode falls back to view, view closes */
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const cur = editingRef.current;
      if (cur.editing) { e.stopPropagation(); cur.cancelEdit(); } else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const dims = src.dims || {};
  const dimKeys = Object.keys(dims);
  const fKey = dims[cfg.filterDim] ? cfg.filterDim : dimKeys[0];
  const catOptions = useMemo(() => {
    const d = fKey ? dims[fKey] : null;
    if (!d) return [];
    return [...new Set((stores[cfg.source] || []).map((r) => d.get(r)))].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.source, fKey, stores]);

  const avg = data.values.length ? data.total / Math.max(data.values.filter((v) => v > 0).length, 1) : 0;
  const peakIdx = data.values.indexOf(Math.max(...data.values));

  return createPortal(
    /* portal + centered: pops in the middle of the screen, and no glass
       ancestor's backdrop-filter can trap the fixed overlay */
    <div className="pal-overlay centered" onClick={onClose} role="dialog" aria-label="Chart explorer">
      <div className="pal explorer" onClick={(e) => e.stopPropagation()}>
        <div className="exp-head">
          {editing ? (
            <input className="exp-title" value={cfg.title} placeholder={src.label}
              aria-label="Chart title" onChange={(e) => set({ title: e.target.value })} />
          ) : (
            <div className="exp-vhead">
              <h3 className="exp-vtitle">{cfg.title || src.label}</h3>
              <div className="exp-vsub m">{src.label}{src.dateless ? "" : ` · ${RANGES.find(([k]) => k === cfg.range)?.[1]}`}{cfg.filter ? ` · ${cfg.filter}` : ""}{cfg.nest && dims[cfg.nest] ? ` · split by ${dims[cfg.nest].label.toLowerCase()}` : ""}</div>
            </div>
          )}
          {!editing && (
            <button className="kbtn" onClick={() => setEditing(true)}
              title="Change this chart's source, shape, range or filter">✎ Edit</button>
          )}
          <button className="kbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {editing && (
        <div className="exp-controls">
          <label className="exp-ctl">
            <span className="mono">SOURCE</span>
            <select value={cfg.source}
              onChange={(e) => {
                const v = e.target.value;
                set({ source: v, filter: "", filterDim: "", nest: "", ...(SOURCES[v].dateless ? { type: "donut" } : {}) });
              }} aria-label="Data source">
              {Object.entries(SOURCES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          <span className="exp-ctl">
            <span className="mono">SHAPE</span>
            <span className="doctabs">
              {TYPES.filter(([k]) => (src.dateless ? k === "donut" : k !== "donut" || dimKeys.length)).map(([k, label]) => (
                <button key={k} className={cfg.type === k ? "on" : ""} onClick={() => set({ type: k })}>{label}</button>
              ))}
            </span>
          </span>
          {!src.dateless && (
          <span className="exp-ctl">
            <span className="mono">RANGE</span>
            <span className="doctabs">
              {RANGES.map(([k, label]) => (
                <button key={k} className={cfg.range === k ? "on" : ""} onClick={() => set({ range: k })}>{label}</button>
              ))}
            </span>
          </span>
          )}
          {dimKeys.length > 0 && (
            <label className="exp-ctl">
              <span className="mono">FILTER BY</span>
              <span className="exp-duo">
                {dimKeys.length > 1 && (
                  <select value={fKey} aria-label="Filter dimension"
                    onChange={(e) => set({ filterDim: e.target.value, filter: "" })}>
                    {dimKeys.map((k) => <option key={k} value={k}>{dims[k].label}</option>)}
                  </select>
                )}
                <select value={cfg.filter} onChange={(e) => set({ filter: e.target.value })} aria-label={dims[fKey]?.label || "Filter"}>
                  <option value="">All</option>
                  {catOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </span>
            </label>
          )}
          {dimKeys.length > 0 && (
            <label className="exp-ctl">
              <span className="mono">NEST BY</span>
              <select value={cfg.nest || ""} onChange={(e) => set({ nest: e.target.value })}
                aria-label="Nest by dimension" title="Split every bucket by a second dimension — stacked bars, one line per group, or donut slices">
                <option value="">None</option>
                {dimKeys.map((k) => <option key={k} value={k}>{dims[k].label}</option>)}
              </select>
            </label>
          )}
        </div>
        )}

        <div className="exp-stats mono">
          <span><b>{fmtVal(data.total, data.money, sym)}</b> total</span>
          {data.dateless
            ? <span><b>{data.slices?.length || 0}</b> groups by {data.catLabel?.toLowerCase() || "group"}</span>
            : <span><b>{fmtVal(avg, data.money, sym)}</b> avg per active bucket</span>}
          {peakIdx >= 0 && data.values[peakIdx] > 0 && (
            <span>peak <b>{fmtVal(data.values[peakIdx], data.money, sym)}</b> · {data.tips?.[peakIdx] ?? data.labels[peakIdx]}</span>
          )}
        </div>

        <LabPlot cfg={cfg} data={data} height={editing ? 280 : 420} big sym={sym} />

        {!editing && (
          <HowTo note={<><b>How to read:</b> {src.dateless
            ? `${src.label.toLowerCase()} broken down by ${data.catLabel?.toLowerCase() || "group"} — hover any slice for the exact count.`
            : `${src.label.toLowerCase()} bucketed over your chosen range — hover any ${cfg.type === "donut" ? "slice" : "bar or point"} for the exact value${cfg.nest ? "; colours split each bucket by " + (dims[cfg.nest]?.label || "").toLowerCase() : ""}.`} Hit ✎ Edit to change the source, shape, range, filter or nesting.</>} />
        )}

        {editing && cfg.type !== "donut" && (
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

        {editing && (
        <div className="exp-foot">
          {!fresh && <button className="kbtn kdel" onClick={() => onDelete(cfg.id)}>Delete chart</button>}
          <span style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={cancelEdit}>Cancel</button>
          <button className="btn sm" onClick={saveEdit}>{fresh ? "Add to my charts" : "Save changes"}</button>
        </div>
        )}
      </div>
    </div>,
    document.body
  );
}

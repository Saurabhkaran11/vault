"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "@/lib/seed";

/* Explorer: GraphAware-Hume-style progressive exploration.
 * The canvas starts SMALL — one seed and its neighbourhood — and grows only
 * where you ask: expand a node to pull in its connections, hide what you
 * don't care about. Property-graph aesthetics: typed icon nodes, directed
 * labelled edges ("tagged", "links"), and an inspector panel that shows the
 * selected node's properties with actions. A "+N" badge counts the
 * connections a node hasn't revealed yet. */

const W = 1200, BASE_H = 680;

/* viewBox height follows the card's real aspect so the canvas fills the page */
function useAspectH(svgRef) {
  const [vbH, setVbH] = useState(BASE_H);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      if (r.width > 80 && r.height > 80) setVbH(Math.max(430, Math.min(1500, Math.round((W * r.height) / r.width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return vbH;
}
const K_MIN = 0.4, K_MAX = 5;
const DAMP = 0.85, AFLOOR = 0.02, ADECAY = 0.994;

function buildModel(items) {
  const pool = items.filter((i) => !i.deleted);
  const ids = new Set(pool.map((i) => i.id));
  const nodes = {};                       // key -> {key, kind, it?|tag?, count?}
  const adj = {};                         // key -> Set(neighbor keys)
  const edges = [];                       // {a, b, label}  (a → b)
  const touch = (a, b) => { (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); };

  pool.forEach((it) => { nodes[`i${it.id}`] = { key: `i${it.id}`, kind: "item", it }; });
  const counts = {};
  pool.forEach((it) => it.tags?.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  Object.entries(counts).forEach(([t, count]) => { nodes[`t${t}`] = { key: `t${t}`, kind: "tag", tag: t, count }; });

  const seen = new Set();
  pool.forEach((it) => (it.links || []).forEach((id2) => {
    if (!ids.has(id2)) return;
    const k = it.id < id2 ? `${it.id}|${id2}` : `${id2}|${it.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: `i${it.id}`, b: `i${id2}`, label: "links" });
    touch(`i${it.id}`, `i${id2}`);
  }));
  pool.forEach((it) => it.tags?.forEach((t) => { edges.push({ a: `i${it.id}`, b: `t${t}`, label: "tagged" }); touch(`i${it.id}`, `t${t}`); }));

  /* the seed: the best-connected node — exploring starts somewhere alive */
  let seed = null, best = -1;
  Object.keys(nodes).forEach((k) => { const d = adj[k]?.size || 0; if (d > best) { best = d; seed = k; } });
  return { nodes, adj, edges, seed };
}

export default function GraphExplorer({ items, onOpenTag, onOpenSection }) {
  const model = useMemo(() => buildModel(items), [items]);
  const seedSet = () => {
    const s = new Set();
    if (model.seed) { s.add(model.seed); (model.adj[model.seed] || []).forEach((n) => s.add(n)); }
    return s;
  };
  const [visible, setVisible] = useState(seedSet);
  const [selected, setSelected] = useState(null);
  const [addText, setAddText] = useState("");
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [, tick] = useState(0);
  const svgRef = useRef(null);
  const H = useAspectH(svgRef);
  const hRef = useRef(H); hRef.current = H;
  const panRef = useRef(null);
  const suppressClickRef = useRef(null);
  const simRef = useRef({ pos: {}, alpha: 1, drag: null });
  const viewRef = useRef(view); viewRef.current = view;

  /* the model changed (data edits) — re-seed if the canvas emptied */
  useEffect(() => {
    setVisible((v) => {
      const kept = new Set([...v].filter((k) => model.nodes[k]));
      return kept.size ? kept : seedSet();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const shown = useMemo(() => [...visible].map((k) => model.nodes[k]).filter(Boolean), [visible, model]);
  const shownEdges = useMemo(() => model.edges.filter((e) => visible.has(e.a) && visible.has(e.b)), [visible, model]);
  const hiddenNeighbors = (key) => [...(model.adj[key] || [])].filter((n) => !visible.has(n)).length;

  /* place newcomers in a ring around whichever visible neighbor they have */
  useEffect(() => {
    const pos = simRef.current.pos;
    const fresh = shown.filter((n) => !pos[n.key]);
    fresh.forEach((n, i) => {
      const anchor = [...(model.adj[n.key] || [])].find((k) => pos[k]);
      const base = anchor ? pos[anchor] : { x: W / 2, y: H / 2 };
      const ang = (i / Math.max(fresh.length, 1)) * Math.PI * 2 + 0.7;
      pos[n.key] = { x: base.x + Math.cos(ang) * 140, y: base.y + Math.sin(ang) * 110, vx: 0, vy: 0 };
    });
    Object.keys(pos).forEach((k) => { if (!visible.has(k)) delete pos[k]; });
    simRef.current.alpha = 1;
  }, [shown, visible, model]);

  /* relax sim — springs on edges, repulsion, weak centering */
  const edgesRef = useRef(shownEdges); edgesRef.current = shownEdges;
  useEffect(() => {
    let raf, frame = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      const sim = simRef.current, pos = sim.pos;
      frame++;
      if (sim.alpha <= AFLOOR * 1.5 && frame % 2) return;
      const a = sim.alpha;
      const keys = Object.keys(pos);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const p = pos[keys[i]], q = pos[keys[j]];
          let dx = p.x - q.x, dy = p.y - q.y;
          let d2 = dx * dx + dy * dy || 1;
          if (d2 > 122500) continue;                 // cutoff: > 350px
          const d = Math.sqrt(d2);
          const f = Math.min(8, 3200 / d2) * a;
          dx /= d; dy /= d;
          p.vx += dx * f; p.vy += dy * f;
          q.vx -= dx * f; q.vy -= dy * f;
        }
      }
      edgesRef.current.forEach((e) => {
        const p = pos[e.a], q = pos[e.b];
        if (!p || !q) return;
        const rest = e.label === "links" ? 130 : 150;
        let dx = q.x - p.x, dy = q.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - rest) * 0.05 * a;
        dx /= d; dy /= d;
        p.vx += dx * f; p.vy += dy * f;
        q.vx -= dx * f; q.vy -= dy * f;
      });
      const HH = hRef.current;
      keys.forEach((k) => {
        const p = pos[k];
        if (sim.drag && sim.drag.key === k) { p.vx = 0; p.vy = 0; return; }
        p.vx += (W / 2 - p.x) * 0.008 * a;
        p.vy += (HH / 2 - p.y) * 0.008 * a;
        p.x += (p.vx *= DAMP);
        p.y += (p.vy *= DAMP);
        p.x = Math.max(-W * 0.25, Math.min(W * 1.25, p.x));
        p.y = Math.max(-HH * 0.25, Math.min(HH * 1.25, p.y));
      });
      sim.alpha = Math.max(AFLOOR, sim.alpha * ADECAY);
      tick((t) => t + 1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* pan / zoom / drag */
  const toSvg = (cx, cy) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    const offX = (rect.width - W * scale) / 2, offY = (rect.height - H * scale) / 2;
    return { x: (cx - rect.left - offX) / scale, y: (cy - rect.top - offY) / scale };
  };
  const toContent = (cx, cy) => {
    const v = viewRef.current, p = toSvg(cx, cy);
    return { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k };
  };
  const zoomAt = (cx, cy, factor) => {
    setView((v) => {
      const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
      if (k === v.k) return v;
      const p = toSvg(cx, cy);
      return { k, x: p.x - k * ((p.x - v.x) / v.k), y: p.y - k * ((p.y - v.y) / v.k) };
    });
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onNodeDown = (key) => (e) => {
    e.stopPropagation(); e.preventDefault();
    const p = toContent(e.clientX, e.clientY);
    simRef.current.drag = { key, moved: false, sx: p.x, sy: p.y };
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.6);
  };
  const onPanStart = (e) => {
    e.preventDefault();
    try { e.target.setPointerCapture?.(e.pointerId); } catch { /* synthetic pointer */ }
    const start = toSvg(e.clientX, e.clientY);
    panRef.current = { sx: start.x, sy: start.y, vx: view.x, vy: view.y };
  };
  const onMove = (e) => {
    const sim = simRef.current;
    if (sim.drag) {
      const p = toContent(e.clientX, e.clientY);
      if (Math.abs(p.x - sim.drag.sx) + Math.abs(p.y - sim.drag.sy) > 3 / viewRef.current.k) sim.drag.moved = true;
      const node = sim.pos[sim.drag.key];
      if (node) { node.x = p.x; node.y = p.y; node.vx = 0; node.vy = 0; }
      sim.alpha = Math.max(sim.alpha, 0.7);
      return;
    }
    const pan = panRef.current;
    if (!pan) return;
    const p = toSvg(e.clientX, e.clientY);
    setView((v) => ({ ...v, x: pan.vx + (p.x - pan.sx), y: pan.vy + (p.y - pan.sy) }));
  };
  const onUp = () => {
    const sim = simRef.current;
    if (sim.drag) {
      if (sim.drag.moved) {
        const key = sim.drag.key;
        suppressClickRef.current = key;
        setTimeout(() => { if (suppressClickRef.current === key) suppressClickRef.current = null; }, 150);
      }
      sim.drag = null;
      sim.alpha = Math.max(sim.alpha, 0.35);
    }
    panRef.current = null;
  };

  /* actions */
  const expand = (key) => {
    setVisible((v) => {
      const nv = new Set(v);
      (model.adj[key] || []).forEach((n) => nv.add(n));
      return nv;
    });
  };
  const hideNode = (key) => {
    setVisible((v) => { const nv = new Set(v); nv.delete(key); return nv; });
    setSelected((s) => (s === key ? null : s));
  };
  const openNode = (n) => {
    if (n.kind === "tag") onOpenTag(n.tag);
    else onOpenSection(n.it.type);
  };
  const addByLabel = (label) => {
    const q = label.trim().toLowerCase();
    if (!q) return;
    const match = Object.values(model.nodes).find((n) =>
      (n.kind === "tag" ? `#${n.tag}` : (n.it.alias || n.it.title)).toLowerCase() === q)
      || Object.values(model.nodes).find((n) =>
        (n.kind === "tag" ? n.tag : (n.it.alias || n.it.title)).toLowerCase().includes(q));
    if (!match) return;
    setVisible((v) => new Set(v).add(match.key));
    setSelected(match.key);
    setAddText("");
  };

  const pos = simRef.current.pos;
  const sel = selected && model.nodes[selected];
  const selDeg = sel ? (model.adj[selected]?.size || 0) : 0;
  const selHidden = sel ? hiddenNeighbors(selected) : 0;

  if (!Object.keys(model.nodes).length) return <div className="empty">Nothing to explore yet — save a few items first.</div>;

  return (
    <div className="hxwrap">
      <div className="cosmosbar">
        <span className="graphstats mono">{shown.length} ON CANVAS · {shownEdges.length} EDGES · EXPLORER</span>
        <input className="gsearch hx-add" list="hx-additems" value={addText} placeholder="＋ Add item or #tag to canvas…"
          aria-label="Add item or tag to the canvas"
          onChange={(e) => setAddText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addByLabel(addText); }} />
        <datalist id="hx-additems">
          {Object.values(model.nodes).slice(0, 400).map((n) => (
            <option key={n.key} value={n.kind === "tag" ? `#${n.tag}` : (n.it.alias || n.it.title)} />
          ))}
        </datalist>
        <span style={{ flex: 1 }} />
        <button className="kbtn" onClick={() => { setVisible(seedSet()); setSelected(null); setView({ k: 1, x: 0, y: 0 }); }}
          title="Back to the starting neighbourhood">⟲ Reset</button>
      </div>

      {sel && (
        <div className="hxpanel">
          <div className="hx-kind mono">{sel.kind === "tag" ? "TAG" : (SECTIONS[sel.it.type]?.label || "ITEM").toUpperCase()}</div>
          <div className="hx-title">{sel.kind === "tag" ? `#${sel.tag}` : (sel.it.alias || sel.it.title)}</div>
          {sel.kind === "item" && sel.it.meta && <div className="hx-meta">{String(sel.it.meta).slice(0, 120)}</div>}
          <div className="hx-meta mono">
            {sel.kind === "item" && sel.it.date ? `SAVED ${sel.it.date} · ` : ""}
            {selDeg} CONNECTION{selDeg === 1 ? "" : "S"}{selHidden ? ` · ${selHidden} HIDDEN` : ""}
          </div>
          {sel.kind === "item" && sel.it.tags?.length > 0 && (
            <div className="hx-tags">{sel.it.tags.map((t) => <span key={t} className="hx-chip mono">#{t}</span>)}</div>
          )}
          <div className="hx-actions">
            {selHidden > 0 && <button className="kbtn" onClick={() => expand(selected)}>⊕ Expand {selHidden} connection{selHidden === 1 ? "" : "s"}</button>}
            <button className="kbtn" onClick={() => openNode(sel)}>↗ Open {sel.kind === "tag" ? "tag" : "in section"}</button>
            <button className="kbtn" onClick={() => hideNode(selected)}>⊘ Hide from canvas</button>
          </div>
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Progressive graph explorer — expand nodes to reveal their connections"
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: "none", cursor: panRef.current ? "grabbing" : "grab" }}
        onPointerDown={(e) => { setSelected(null); onPanStart(e); }} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={onUp}>
        <defs>
          <marker id="hx-arrow" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 4 L0 8 Z" fill="var(--ink-soft)" opacity="0.55" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {shownEdges.map((e, i) => {
            const a = pos[e.a], b = pos[e.b];
            if (!a || !b) return null;
            const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
            const R = 20;                            // stop lines at the node edge
            const x1 = a.x + ux * R, y1 = a.y + uy * R;
            const x2 = b.x - ux * (R + 4), y2 = b.y - uy * (R + 4);
            const lit = hover === e.a || hover === e.b || selected === e.a || selected === e.b;
            return (
              <g key={i} opacity={lit ? 1 : 0.65}>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={e.label === "links" ? "var(--gold)" : "var(--ink-soft)"}
                  strokeWidth={(e.label === "links" ? 2 : 1.3) / view.k}
                  markerEnd="url(#hx-arrow)" opacity={e.label === "links" ? 0.9 : 0.5} />
                <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5 / view.k} textAnchor="middle"
                  fontFamily="IBM Plex Mono" fontSize={9 / Math.max(1, view.k * 0.85)} fill="var(--ink-soft)"
                  style={{ pointerEvents: "none" }}>{e.label}</text>
              </g>
            );
          })}
          {shown.map((n) => {
            const p = pos[n.key];
            if (!p) return null;
            const isTag = n.kind === "tag";
            const color = isTag ? "var(--violet)" : (SECTIONS[n.it.type]?.color || "var(--ink-soft)");
            const label = isTag ? `#${n.tag}` : (n.it.alias || n.it.title);
            const extra = hiddenNeighbors(n.key);
            const isSel = selected === n.key;
            return (
              <g key={n.key} className="gnode gdraggable" opacity={1}
                onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}
                onPointerDown={(e) => { e.stopPropagation(); onNodeDown(n.key)(e); }}
                onDoubleClick={(e) => { e.stopPropagation(); expand(n.key); }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressClickRef.current === n.key) { suppressClickRef.current = null; return; }
                  setSelected(n.key);
                }}>
                <title>{`${label} · click to inspect, double-click to expand${extra ? ` (+${extra} hidden)` : ""}`}</title>
                {(isSel || hover === n.key) && <circle cx={p.x} cy={p.y} r={25} fill={color} opacity="0.16" style={{ pointerEvents: "none" }} />}
                <circle cx={p.x} cy={p.y} r={17} fill={color} opacity={isTag ? 0.88 : 1}
                  stroke={isSel ? "var(--ink)" : "var(--panel)"} strokeWidth={isSel ? 3 : 2.2} />
                <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="12.5" fill="#fff" style={{ pointerEvents: "none" }}>
                  {isTag ? "#" : (SECTIONS[n.it.type]?.icon || "•")}
                </text>
                {extra > 0 && (
                  <g style={{ pointerEvents: "none" }}>
                    <circle cx={p.x + 15} cy={p.y - 14} r={9} fill="var(--panel)" stroke="var(--ink-soft)" strokeWidth="1.2" />
                    <text x={p.x + 15} y={p.y - 10.7} textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="8" fill="var(--ink)">+{extra}</text>
                  </g>
                )}
                <text x={p.x} y={p.y + 33} textAnchor="middle" fontSize={12 / Math.max(1, view.k * 0.8)}
                  fontFamily={isTag ? "IBM Plex Mono" : "Public Sans"} fontWeight={isSel || hover === n.key ? 600 : 400}
                  fill={isSel || hover === n.key ? "var(--ink)" : "var(--ink-soft)"} style={{ pointerEvents: "none" }}>
                  {label.length > 22 ? label.slice(0, 20) + "…" : label}
                </text>
              </g>
            );
          })}
        </g>
        <text x={W - 8} y={H - 10} textAnchor="end" fontSize="11" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">
          click = inspect · double-click = expand · +N = connections still hidden · the canvas only grows where you ask
        </text>
      </svg>
    </div>
  );
}

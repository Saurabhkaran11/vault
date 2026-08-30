"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SECTIONS } from "@/lib/seed";
import GraphExplorer from "./GraphExplorer";

/* the 3D engine (three.js/WebGL) loads only when someone opens the 3D tab */
const Graph3D = dynamic(() => import("./Graph3D"), {
  ssr: false,
  loading: () => <div className="g3d-loading mono">LOADING THE 3D ENGINE…</div>,
});

/* Graph: a LIVE force-directed map.
 *  - a real physics simulation runs continuously: springs along every edge,
 *    repulsion between nodes, gentle perpetual drift so the map feels alive
 *  - drag any node and its neighbors get pulled along elastically; release
 *    and the graph springs back into balance
 *  - scroll to zoom (cursor-anchored), drag the background to pan
 *  - click (without dragging) opens the tag or item; hover spotlights
 *
 * Scale strategy: top-N tags render as hubs, a global item budget caps the
 * ring sizes ("+N" nodes open the rest), labels appear on zoom. The sim
 * throttles once settled and pauses when the tab is hidden. */

const W = 1200, BASE_H = 680;
const TOP_TAGS = 60;

/* Every graph mode fills its card exactly: the viewBox keeps a fixed width
 * of W but its HEIGHT follows the card's real aspect ratio, so "meet"
 * scaling never letterboxes — the drawing uses the whole page. */
function useAspectH(svgRef, deps = []) {
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
  }, deps);
  return vbH;
}
const MAX_PER_HUB = 20;
const MAX_ITEMS_TOTAL = 360;
const K_MIN = 0.4, K_MAX = 6;
const LABEL_K = 0.8;   // labels appear earlier — clarity beats minimalism here

/* physics tuning */
const ALPHA_FLOOR = 0.02;      // never fully freezes — the "alive" part
const ALPHA_DECAY = 0.995;
const DAMPING = 0.86;
const REPULSE = 2200;
const SPRING = 0.055;
const HOME_PULL = 0.02;        // hubs drift back toward their layout homes

function layout(items, query, H = BASE_H) {
  const q = query.trim().toLowerCase();
  const counts = {};
  items.forEach((i) => i.tags.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const allTags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let tags = q ? allTags.filter((t) => t.includes(q)) : allTags;
  const totalMatching = tags.length;
  tags = tags.slice(0, TOP_TAGS);
  const tagSet = new Set(tags);

  const cx = W / 2, cy = H / 2 - 10;
  const hubs = {};
  const nT = tags.length;
  const singleRing = nT <= 12;
  tags.forEach((t, i) => {
    if (nT === 1) { hubs[t] = { x: cx, y: cy }; return; }
    const ring = Math.floor(i / 12);
    const inRing = Math.min(12, nT - ring * 12);
    const idx = i - ring * 12;
    const R = (singleRing ? 0.32 : 0.16 + ring * 0.14) * Math.min(W, H * 1.4);
    const ang = (idx / inRing) * Math.PI * 2 - Math.PI / 2 + ring * 0.26;
    hubs[t] = { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R * 0.72 };
  });

  const byHub = {};
  const untagged = [];
  items.forEach((i) => {
    if (!i.tags.length) { if (!q) untagged.push(i); return; }
    const hub = i.tags.find((t) => tagSet.has(t));
    if (!hub) return;
    (byHub[hub] = byHub[hub] || []).push(i);
  });
  if (untagged.length) {
    hubs.__untagged = { x: cx, y: nT ? cy : cy - H * 0.2 };
    byHub.__untagged = untagged;
  }

  const nodes = [];   // {key, kind:'item'|'more', it?, tag?, count?, hubKey, x, y, rest}
  const hubCount = Math.max(1, Object.keys(byHub).length);
  const perHub = Math.max(4, Math.min(MAX_PER_HUB, Math.floor(MAX_ITEMS_TOTAL / hubCount)));
  for (const [hubKey, members] of Object.entries(byHub)) {
    const hub = hubs[hubKey];
    const shown = members.slice(0, perHub);
    const extra = members.length - shown.length;
    const r = 66 + Math.min(46, shown.length * 5);
    shown.forEach((it, j) => {
      const ang = (j / (shown.length + (extra > 0 ? 1 : 0))) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ key: `i${it.id}`, kind: "item", it, hubKey, x: hub.x + Math.cos(ang) * r, y: hub.y + Math.sin(ang) * r, rest: r });
    });
    if (extra > 0) {
      const ang = (shown.length / (shown.length + 1)) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ key: `m${hubKey}`, kind: "more", tag: hubKey === "__untagged" ? null : hubKey, count: extra, hubKey, x: hub.x + Math.cos(ang) * r, y: hub.y + Math.sin(ang) * r, rest: r });
    }
  }

  const renderedItems = new Set(nodes.filter((n) => n.kind === "item").map((n) => n.it.id));
  const edges = [];   // {a, b, rest, direct}
  nodes.forEach((n) => edges.push({ a: n.key, b: `t${n.hubKey}`, rest: n.rest, hubEdge: true, visible: n.kind === "item" }));
  items.forEach((i) => {
    if (!renderedItems.has(i.id)) return;
    /* extra tags beyond the anchor hub */
    i.tags.slice(1).forEach((t) => tagSet.has(t) && edges.push({ a: `i${i.id}`, b: `t${t}`, rest: 150, visible: true }));
    (i.links || []).forEach((id) => renderedItems.has(id) && edges.push({ a: `i${i.id}`, b: `i${id}`, rest: 90, direct: true, visible: true }));
  });

  return { tags, hubs, nodes, edges, counts, untagged: untagged.length, totalTags: allTags.length, totalMatching, shownItems: renderedItems.size, totalItems: items.length };
}

export default function GraphView({ items, onOpenTag, onOpenSection }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("web");   // "web" | "cosmos" | "explorer" | "3d"
  const [full, setFull] = useState(false);   // full-page takeover
  useEffect(() => {
    if (!full) return;
    const onKey = (e) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [, tick] = useState(0);               // re-render pulse from the sim
  const svgRef = useRef(null);
  const H = useAspectH(svgRef, [mode]);
  const g = useMemo(() => layout(items, query, H), [items, query, H]);
  const panRef = useRef(null);
  const suppressClickRef = useRef(null);
  const simRef = useRef({ pos: {}, alpha: 1, drag: null });
  const viewRef = useRef(view);
  viewRef.current = view;

  /* (re)seed sim positions from the layout; fresh=true discards arrangement */
  const seedPositions = (fresh) => {
    const pos = fresh ? {} : simRef.current.pos;
    const want = new Set();
    g.tags.forEach((t) => {
      const key = `t${t}`;
      want.add(key);
      if (!pos[key]) pos[key] = { x: g.hubs[t].x, y: g.hubs[t].y, vx: 0, vy: 0 };
    });
    if (g.hubs.__untagged) {
      want.add("t__untagged");
      if (!pos.t__untagged) pos.t__untagged = { x: g.hubs.__untagged.x, y: g.hubs.__untagged.y, vx: 0, vy: 0 };
    }
    g.nodes.forEach((n) => {
      want.add(n.key);
      if (!pos[n.key]) pos[n.key] = { x: n.x, y: n.y, vx: 0, vy: 0 };
    });
    Object.keys(pos).forEach((k) => { if (!want.has(k)) delete pos[k]; });
    simRef.current.pos = pos;
    simRef.current.alpha = 1;
  };

  /* keep sim in sync when the layout changes (search, data edits) */
  useEffect(() => { seedPositions(false); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [g]);

  /* ---------- the living simulation */
  useEffect(() => {
    let raf;
    let frame = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      const sim = simRef.current;
      const pos = sim.pos;
      frame++;
      /* once settled to the gentle-drift floor, run at half rate to save CPU */
      if (sim.alpha <= ALPHA_FLOOR * 1.5 && frame % 2) return;

      const a = sim.alpha;
      const keys = Object.keys(pos);

      /* repulsion */
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const p = pos[keys[i]], q = pos[keys[j]];
          let dx = p.x - q.x, dy = p.y - q.y;
          let d2 = dx * dx + dy * dy || 1;
          if (d2 > 40000) continue;                    // cutoff: > 200px apart
          const d = Math.sqrt(d2);
          const f = Math.min(6, (REPULSE / d2)) * a;
          dx /= d; dy /= d;
          p.vx += dx * f; p.vy += dy * f;
          q.vx -= dx * f; q.vy -= dy * f;
        }
      }
      /* springs along edges */
      g.edges.forEach((e) => {
        const p = pos[e.a], h = pos[e.b];
        if (!p || !h) return;
        let dx = h.x - p.x, dy = h.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - e.rest) * SPRING * a;
        dx /= d; dy /= d;
        p.vx += dx * f; p.vy += dy * f;
        h.vx -= dx * f * 0.55; h.vy -= dy * f * 0.55;  // hubs are heavier
      });
      /* hubs remember home; everything integrates */
      g.tags.forEach((t) => {
        const p = pos[`t${t}`], home = g.hubs[t];
        if (!p) return;
        p.vx += (home.x - p.x) * HOME_PULL * a;
        p.vy += (home.y - p.y) * HOME_PULL * a;
      });
      keys.forEach((k) => {
        const p = pos[k];
        if (sim.drag && sim.drag.key === k) { p.vx = 0; p.vy = 0; return; }
        p.x += (p.vx *= DAMPING);
        p.y += (p.vy *= DAMPING);
        p.x = Math.max(-W * 0.2, Math.min(W * 1.2, p.x));
        p.y = Math.max(-H * 0.2, Math.min(H * 1.2, p.y));
      });

      sim.alpha = Math.max(ALPHA_FLOOR, sim.alpha * ALPHA_DECAY);
      tick((t) => t + 1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [g]);

  /* ---------- coordinate helpers */
  const toSvg = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / W, rect.height / H);
    const offX = (rect.width - W * scale) / 2;
    const offY = (rect.height - H * scale) / 2;
    return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
  };
  const toContent = (clientX, clientY) => {
    const v = viewRef.current;
    const p = toSvg(clientX, clientY);
    return { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k };
  };

  const zoomAt = (clientX, clientY, factor) => {
    setView((v) => {
      const k = Math.min(K_MAX, Math.max(K_MIN, v.k * factor));
      if (k === v.k) return v;
      const p = toSvg(clientX, clientY);
      const cxp = (p.x - v.x) / v.k;
      const cyp = (p.y - v.y) / v.k;
      return { k, x: p.x - k * cxp, y: p.y - k * cyp };
    });
  };
  const zoomCenter = (factor) => {
    const rect = svgRef.current.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- interactions */
  const onNodeDown = (key) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toContent(e.clientX, e.clientY);
    simRef.current.drag = { key, moved: false, sx: p.x, sy: p.y };
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.6);
  };
  const onNodeClick = (key, fn) => () => {
    if (suppressClickRef.current === key) { suppressClickRef.current = null; return; }
    fn();
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
      sim.alpha = Math.max(sim.alpha, 0.7);   // dragging keeps the physics hot
      return;
    }
    const pan = panRef.current;
    if (!pan) return;
    const p = toSvg(e.clientX, e.clientY);
    const nx = pan.vx + (p.x - pan.sx);
    const ny = pan.vy + (p.y - pan.sy);
    setView((v) => ({ ...v, x: nx, y: ny }));
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
      sim.alpha = Math.max(sim.alpha, 0.35);   // let it spring back to balance
    }
    panRef.current = null;
  };

  const connected = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    g.edges.forEach((e) => { if (e.a === hover) set.add(e.b); if (e.b === hover) set.add(e.a); });
    return set;
  }, [hover, g.edges]);
  const dimmed = (key) => connected && !connected.has(key);

  const pos = simRef.current.pos;
  const at = (key, fallback) => pos[key] || fallback;
  const showItemLabels = view.k >= LABEL_K || g.shownItems <= 60;

  if (!items.length) return <div className="empty">Nothing to map yet — add a few items with #tags and the graph draws itself.</div>;

  return (
    <div className={`graphwrap graphfull${full ? " gfull" : ""}`}>
      <div className="graphkey">
        {/* row 1 — the floating search pill, dashboard-style */}
        {mode !== "explorer" && (
          <div className="gk-search">
            <span className="gk-icon" aria-hidden="true">⌕</span>
            <input className="gsearch" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "web" ? `Search ${g.totalTags} tag${g.totalTags === 1 ? "" : "s"} in your graph…` : "Filter items…"} aria-label="Search" />
          </div>
        )}
        {/* row 2 — mode toggle, zoom, full page */}
        <div className="gk-row">
          <span className="gzoom gmode" role="group" aria-label="Graph view mode">
            <button className={mode === "web" ? "on" : ""} onClick={() => setMode("web")}
              title="The living force-directed web">Web</button>
            <button className={mode === "cosmos" ? "on" : ""} onClick={() => setMode("cosmos")}
              title="Obsidian-style constellation — every item is a star, sized by its connections">Cosmos</button>
            <button className={mode === "explorer" ? "on" : ""} onClick={() => setMode("explorer")}
              title="Hume-style exploration — inspect a node, expand its connections on demand">Explorer</button>
            <button className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")}
              title="react-force-graph 3D — orbit your vault as a WebGL starfield">3D</button>
          </span>
          {mode === "web" && (
          <span className="gzoom" role="group" aria-label="Zoom">
            <button onClick={() => zoomCenter(1 / 1.3)} title="Zoom out" aria-label="Zoom out">−</button>
            <span className="mono">{Math.round(view.k * 100)}%</span>
            <button onClick={() => zoomCenter(1.3)} title="Zoom in" aria-label="Zoom in">+</button>
            <button onClick={() => { setView({ k: 1, x: 0, y: 0 }); seedPositions(true); tick((t) => t + 1); }} title="Reset view & re-settle" aria-label="Reset view">⤢</button>
          </span>
          )}
          <button className={`kbtn gfull-btn ${full ? "on" : ""}`} onClick={() => setFull((f) => !f)}
            title={full ? "Back to the page (Esc works too)" : "Take over the whole page"}>
            {full ? "🗕 Exit full page" : "⛶ Full page"}
          </button>
        </div>
        {/* row 3 — the quiet stats line */}
        {mode === "web" && (
          <span className="gk-stats mono">
            {g.totalMatching > g.tags.length ? `top ${g.tags.length} of ${g.totalMatching} tags · ` : ""}
            {g.shownItems}{g.shownItems < g.totalItems ? ` of ${g.totalItems}` : ""} items · live · scroll to zoom · drag anything
          </span>
        )}
      </div>
      {mode === "cosmos" ? (
        <CosmosGraph items={items} query={query} onOpenTag={onOpenTag} onOpenSection={onOpenSection} />
      ) : mode === "explorer" ? (
        <GraphExplorer items={items} onOpenTag={onOpenTag} onOpenSection={onOpenSection} />
      ) : mode === "3d" ? (
        <Graph3D items={items} query={query} onOpenTag={onOpenTag} onOpenSection={onOpenSection} />
      ) : (
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Live force-directed map of your items grouped by project tag"
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: "none", cursor: panRef.current ? "grabbing" : "grab" }}
        onPointerDown={onPanStart} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={onUp}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {mode === "web" && g.edges.filter((e) => e.visible).map((e, i) => {
            const a = at(e.a), b = at(e.b);
            if (!a || !b) return null;
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={e.direct ? "var(--gold)" : "var(--line)"}
                strokeDasharray={e.direct ? "6 5" : "none"}
                strokeWidth={(dimmed(e.a) || dimmed(e.b) ? 1 : 2) / view.k}
                opacity={dimmed(e.a) || dimmed(e.b) ? 0.25 : 1} />
            );
          })}

          {mode === "web" && g.tags.map((t) => {
            const key = `t${t}`;
            const h = at(key, g.hubs[t]);
            return (
              <g key={key} className="gnode gdraggable" opacity={dimmed(key) ? 0.25 : 1}
                onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
                onPointerDown={onNodeDown(key)}
                onClick={onNodeClick(key, () => onOpenTag(t))}>
                <circle cx={h.x} cy={h.y} r={24} fill="var(--violet)" stroke="var(--panel)" strokeWidth="3" />
                <text x={h.x} y={h.y + 4} textAnchor="middle" fontSize="12" fontFamily="IBM Plex Mono" fontWeight="600" fill="#fff" style={{ pointerEvents: "none" }}>{g.counts[t]}</text>
                <text x={h.x} y={h.y - 33} textAnchor="middle" fontSize="16" fontFamily="Fraunces" fontWeight="650" fill="var(--ink)" style={{ pointerEvents: "none" }}>#{t}</text>
              </g>
            );
          })}

          {/* The untagged items get a hub of their own so they read as a
           * deliberate group ("Untagged") rather than orphans drifting around
           * an invisible centre. Muted, and inert on click — it's a category,
           * not a real tag with a page to open — but it still hover-spotlights
           * its items. Only present when !q (search hides the untagged pile). */}
          {mode === "web" && g.untagged > 0 && (() => {
            const key = "t__untagged";
            const h = at(key, g.hubs.__untagged);
            if (!h) return null;
            return (
              <g key={key} className="gnode gdraggable" opacity={dimmed(key) ? 0.25 : 1}
                onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}
                onPointerDown={onNodeDown(key)}>
                <title>{`${g.untagged} untagged item${g.untagged === 1 ? "" : "s"} — add a #tag to file them`}</title>
                <circle cx={h.x} cy={h.y} r={24} fill="var(--ink-soft)" stroke="var(--panel)" strokeWidth="3" strokeDasharray="4 4" />
                <text x={h.x} y={h.y + 4} textAnchor="middle" fontSize="12" fontFamily="IBM Plex Mono" fontWeight="600" fill="#fff" style={{ pointerEvents: "none" }}>{g.untagged}</text>
                <text x={h.x} y={h.y - 33} textAnchor="middle" fontSize="16" fontFamily="Fraunces" fontWeight="650" fill="var(--ink-soft)" style={{ pointerEvents: "none" }}>Untagged</text>
              </g>
            );
          })()}

          {mode === "web" && g.nodes.map((n) => {
            const p = at(n.key, n);
            if (n.kind === "more") {
              return (
                <g key={n.key} className="gnode gdraggable"
                  onPointerDown={onNodeDown(n.key)}
                  onClick={onNodeClick(n.key, () => n.tag && onOpenTag(n.tag))}>
                  <title>{n.tag ? `${n.count} more item${n.count === 1 ? "" : "s"} — open #${n.tag}` : `${n.count} more untagged item${n.count === 1 ? "" : "s"}`}</title>
                  <circle cx={p.x} cy={p.y} r={11} fill="var(--field)" stroke="var(--ink-soft)" strokeWidth="1.5" strokeDasharray="3 3" />
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="8.5" fontFamily="IBM Plex Mono" fill="var(--ink-soft)" style={{ pointerEvents: "none" }}>+{n.count}</text>
                </g>
              );
            }
            const s = SECTIONS[n.it.type];
            const label = n.it.alias || n.it.title;
            return (
              <g key={n.key} className="gnode gdraggable" opacity={dimmed(n.key) ? 0.22 : 1}
                onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}
                onPointerDown={onNodeDown(n.key)}
                onClick={onNodeClick(n.key, () => onOpenSection(n.it.type))}>
                <title>{`${s.label}: ${n.it.title} — drag me, click to open`}</title>
                <circle cx={p.x} cy={p.y} r={10} fill={s.color} stroke="var(--panel)" strokeWidth="2.5" />
                <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9" fill="#fff" style={{ pointerEvents: "none" }}>{s.icon}</text>
                {(showItemLabels || hover === n.key) && (
                  <text x={p.x} y={p.y + 24} textAnchor="middle" fontSize={13 / Math.max(1, view.k * 0.8)} fontFamily="Public Sans"
                    fill={hover === n.key ? "var(--ink)" : "var(--ink-soft)"} fontWeight={hover === n.key ? 600 : 400}
                    style={{ pointerEvents: "none" }}>
                    {label.length > 22 ? label.slice(0, 20) + "…" : label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      )}
    </div>
  );
}

/* ---------- Cosmos view: the Obsidian-style constellation.
 *  - FLAT graph: every item is a node (no hub-and-spoke); item↔item links
 *    are the structure, tags are optional satellite nodes
 *  - node size = connection count, labels fade in with zoom (tunable)
 *  - hover spotlights a node and its neighborhood, the rest recedes
 *  - double-click focuses a LOCAL graph (neighbors within a depth you pick)
 *  - a tune panel exposes the forces & filters, like Obsidian's settings */

const CK_MIN = 0.35, CK_MAX = 6;
const C_DAMP = 0.85, C_AFLOOR = 0.02, C_ADECAY = 0.994;
const C_MAX_ITEMS = 400;

function cosmosModel(items, query, { showTags, showOrphans, focus, depth }) {
  const q = query.trim().toLowerCase();
  let pool = items.filter((i) => !i.deleted);
  if (q) pool = pool.filter((i) => (i.alias || i.title || "").toLowerCase().includes(q) || i.tags?.some((t) => t.includes(q)));
  const capped = pool.length > C_MAX_ITEMS;
  if (capped) pool = pool.slice(0, C_MAX_ITEMS);
  const ids = new Set(pool.map((i) => i.id));

  const nodes = [];                       // {key, kind:'item'|'tag', it?, tag?, count?}
  const edges = [];                       // {a, b, kind:'link'|'tag'}
  const adj = {};                         // key -> Set(keys)
  const touch = (a, b) => { (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); };

  pool.forEach((it) => nodes.push({ key: `i${it.id}`, kind: "item", it }));
  const seen = new Set();
  pool.forEach((it) => (it.links || []).forEach((id) => {
    if (!ids.has(id)) return;
    const k = it.id < id ? `${it.id}|${id}` : `${id}|${it.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: `i${it.id}`, b: `i${id}`, kind: "link" });
    touch(`i${it.id}`, `i${id}`);
  }));
  if (showTags) {
    const counts = {};
    pool.forEach((it) => it.tags?.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    Object.entries(counts).forEach(([t, count]) => nodes.push({ key: `t${t}`, kind: "tag", tag: t, count }));
    pool.forEach((it) => it.tags?.forEach((t) => { edges.push({ a: `i${it.id}`, b: `t${t}`, kind: "tag" }); touch(`i${it.id}`, `t${t}`); }));
  }

  let keep = null;
  if (focus) {
    /* local graph: BFS out to `depth` hops from the focused node */
    keep = new Set([focus]);
    let frontier = [focus];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach((k) => (adj[k] || []).forEach((nb) => { if (!keep.has(nb)) { keep.add(nb); next.push(nb); } }));
      frontier = next;
    }
  }

  const deg = {};
  edges.forEach((e) => { deg[e.a] = (deg[e.a] || 0) + 1; deg[e.b] = (deg[e.b] || 0) + 1; });

  let shown = nodes;
  if (keep) shown = nodes.filter((n) => keep.has(n.key));
  else if (!showOrphans) shown = nodes.filter((n) => deg[n.key]);
  const shownKeys = new Set(shown.map((n) => n.key));
  const shownEdges = edges.filter((e) => shownKeys.has(e.a) && shownKeys.has(e.b));

  return { nodes: shown, edges: shownEdges, deg, capped, totalItems: pool.length, hidden: nodes.length - shown.length };
}

function CosmosGraph({ items, query, onOpenTag, onOpenSection }) {
  const [showTags, setShowTags] = useState(true);
  const [showOrphans, setShowOrphans] = useState(true);
  const [panel, setPanel] = useState(false);
  const [focus, setFocus] = useState(null);         // node key for local graph
  const [depth, setDepth] = useState(1);
  const [forces, setForces] = useState({ repel: 2400, dist: 1.35, center: 0.01, labelK: 0.9 });
  const forcesRef = useRef(forces); forcesRef.current = forces;

  const g = useMemo(() => cosmosModel(items, query, { showTags, showOrphans, focus, depth }),
    [items, query, showTags, showOrphans, focus, depth]);

  /* if a filter change removed the focused node, drop the focus */
  useEffect(() => {
    if (focus && !g.nodes.some((n) => n.key === focus)) setFocus(null);
  }, [g, focus]);

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
  const gRef = useRef(g); gRef.current = g;

  /* seed new nodes on a golden-angle spiral so the sim untangles fast */
  useEffect(() => {
    const pos = simRef.current.pos;
    const want = new Set();
    g.nodes.forEach((n, i) => {
      want.add(n.key);
      if (!pos[n.key]) {
        const ang = i * 2.399963, r = 26 * Math.sqrt(i + 1);
        pos[n.key] = { x: W / 2 + Math.cos(ang) * r, y: H / 2 + Math.sin(ang) * r * 0.7, vx: 0, vy: 0 };
      }
    });
    Object.keys(pos).forEach((k) => { if (!want.has(k)) delete pos[k]; });
    simRef.current.alpha = 1;
  }, [g, H]);

  /* the flat simulation: repulsion + link springs + gentle centering */
  useEffect(() => {
    let raf, frame = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      if (document.hidden) return;
      const sim = simRef.current, pos = sim.pos, f = forcesRef.current, gg = gRef.current;
      frame++;
      if (sim.alpha <= C_AFLOOR * 1.5 && frame % 2) return;
      const a = sim.alpha;
      const keys = Object.keys(pos);
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const p = pos[keys[i]], q2 = pos[keys[j]];
          let dx = p.x - q2.x, dy = p.y - q2.y;
          let d2 = dx * dx + dy * dy || 1;
          if (d2 > 96100) continue;                  // cutoff: > 310px apart
          const d = Math.sqrt(d2);
          const fr = Math.min(7, f.repel / d2) * a;
          dx /= d; dy /= d;
          p.vx += dx * fr; p.vy += dy * fr;
          q2.vx -= dx * fr; q2.vy -= dy * fr;
        }
      }
      gg.edges.forEach((e) => {
        const p = pos[e.a], q2 = pos[e.b];
        if (!p || !q2) return;
        const rest = (e.kind === "link" ? 82 : 112) * f.dist;
        let dx = q2.x - p.x, dy = q2.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const fs = (d - rest) * 0.055 * a;
        dx /= d; dy /= d;
        p.vx += dx * fs; p.vy += dy * fs;
        q2.vx -= dx * fs; q2.vy -= dy * fs;
      });
      const HH = hRef.current;
      keys.forEach((k) => {
        const p = pos[k];
        if (sim.drag && sim.drag.key === k) { p.vx = 0; p.vy = 0; return; }
        p.vx += (W / 2 - p.x) * f.center * a;
        p.vy += (HH / 2 - p.y) * f.center * a;
        p.x += (p.vx *= C_DAMP);
        p.y += (p.vy *= C_DAMP);
        p.x = Math.max(-W * 0.3, Math.min(W * 1.3, p.x));
        p.y = Math.max(-HH * 0.3, Math.min(HH * 1.3, p.y));
      });
      sim.alpha = Math.max(C_AFLOOR, sim.alpha * C_ADECAY);
      tick((t) => t + 1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* pan / zoom / drag — same feel as the web view, self-contained */
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
      const k = Math.min(CK_MAX, Math.max(CK_MIN, v.k * factor));
      if (k === v.k) return v;
      const p = toSvg(cx, cy);
      return { k, x: p.x - k * ((p.x - v.x) / v.k), y: p.y - k * ((p.y - v.y) / v.k) };
    });
  };
  const zoomCenter = (factor) => {
    const rect = svgRef.current.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
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
  /* single-click opens, double-click focuses — so the single click waits a
     beat and a double-click cancels it (otherwise dblclick navigates away
     mid-gesture: browsers fire click,click,dblclick) */
  const clickTimer = useRef(null);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const onNodeClick = (key, fn) => () => {
    if (suppressClickRef.current === key) { suppressClickRef.current = null; return; }
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(fn, 260);
  };
  const onNodeFocus = (key) => (e) => {
    e.stopPropagation();
    clearTimeout(clickTimer.current);
    setFocus(key); setDepth(1);
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

  const connected = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    g.edges.forEach((e) => { if (e.a === hover) set.add(e.b); if (e.b === hover) set.add(e.a); });
    return set;
  }, [hover, g.edges]);
  const dim = (key) => connected && !connected.has(key);

  const pos = simRef.current.pos;
  /* Obsidian-style label fade: fully in a bit past the threshold */
  const labelOp = Math.max(0, Math.min(1, (view.k - forces.labelK + 0.3) / 0.45));
  const focusNode = focus && g.nodes.find((n) => n.key === focus);
  const linkCount = g.edges.filter((e) => e.kind === "link").length;

  return (
    <div className="cosmoswrap">
      <div className="cosmosbar">
        <span className="graphstats mono">
          {g.totalItems} ITEMS · {linkCount} LINKS{g.capped ? " · CAPPED" : ""}
          {!focus && g.hidden > 0 ? ` · ${g.hidden} ORPHANS HIDDEN` : ""}
        </span>
        {focusNode && (
          <span className="cosmosfocus mono">
            ◎ {(focusNode.kind === "tag" ? `#${focusNode.tag}` : (focusNode.it.alias || focusNode.it.title)).slice(0, 24)}
            <span className="cf-depth" role="group" aria-label="Focus depth">
              {[1, 2, 3].map((d) => (
                <button key={d} className={depth === d ? "on" : ""} onClick={() => setDepth(d)} title={`${d} hop${d > 1 ? "s" : ""} out`}>{d}</button>
              ))}
            </span>
            <button className="cf-clear" onClick={() => setFocus(null)} aria-label="Clear focus">✕</button>
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="gzoom" role="group" aria-label="Zoom">
          <button onClick={() => zoomCenter(1 / 1.3)} aria-label="Zoom out">−</button>
          <span className="mono">{Math.round(view.k * 100)}%</span>
          <button onClick={() => zoomCenter(1.3)} aria-label="Zoom in">+</button>
        </span>
        <button className={`kbtn cosmos-gear ${panel ? "on" : ""}`} onClick={() => setPanel((p) => !p)}
          aria-expanded={panel} title="Filters and forces — tune how the cosmos behaves">⚙ Tune</button>
      </div>

      {panel && (
        <div className="cosmos-panel">
          <div className="cp-sec mono">FILTERS</div>
          <label className="cp-check"><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /> Tag nodes</label>
          <label className="cp-check"><input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} /> Orphans (no links)</label>
          <div className="cp-sec mono">FORCES</div>
          <label className="cp-slide">Repel<input type="range" min="400" max="3200" step="50" value={forces.repel}
            onChange={(e) => { setForces((f) => ({ ...f, repel: +e.target.value })); simRef.current.alpha = Math.max(simRef.current.alpha, 0.5); }} /></label>
          <label className="cp-slide">Link distance<input type="range" min="0.5" max="1.9" step="0.05" value={forces.dist}
            onChange={(e) => { setForces((f) => ({ ...f, dist: +e.target.value })); simRef.current.alpha = Math.max(simRef.current.alpha, 0.5); }} /></label>
          <label className="cp-slide">Centre pull<input type="range" min="0" max="0.05" step="0.002" value={forces.center}
            onChange={(e) => { setForces((f) => ({ ...f, center: +e.target.value })); simRef.current.alpha = Math.max(simRef.current.alpha, 0.5); }} /></label>
          <div className="cp-sec mono">DISPLAY</div>
          <label className="cp-slide">Label fade<input type="range" min="0.3" max="2.2" step="0.05" value={forces.labelK}
            onChange={(e) => setForces((f) => ({ ...f, labelK: +e.target.value }))} /></label>
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Constellation of every item, linked items drawn together"
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: "none", cursor: panRef.current ? "grabbing" : "grab" }}
        onPointerDown={onPanStart} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={onUp}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {g.edges.map((e, i) => {
            const a = pos[e.a], b = pos[e.b];
            if (!a || !b) return null;
            const lit = connected && connected.has(e.a) && connected.has(e.b) && (e.a === hover || e.b === hover);
            return (
              <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={lit ? "var(--ink-soft)" : e.kind === "link" ? "var(--gold)" : "var(--line)"}
                strokeDasharray={e.kind === "link" ? "none" : "3 5"}
                strokeWidth={(lit ? 2.4 : e.kind === "link" ? 1.8 : 1.2) / view.k}
                opacity={connected && !lit ? 0.07 : e.kind === "link" ? 0.9 : 0.7} />
            );
          })}
          {g.nodes.map((n) => {
            const p = pos[n.key];
            if (!p) return null;
            const d = g.deg[n.key] || 0;
            const isTag = n.kind === "tag";
            const r = isTag ? 6 + Math.min(11, Math.sqrt(n.count) * 2.4) : 4.5 + Math.min(13, Math.sqrt(d) * 3);
            const color = isTag ? "var(--violet)" : (SECTIONS[n.it.type]?.color || "var(--ink-soft)");
            const label = isTag ? `#${n.tag}` : (n.it.alias || n.it.title);
            const lop = hover === n.key || (connected && connected.has(n.key)) ? 1 : labelOp;
            return (
              <g key={n.key} className="gnode gdraggable" opacity={dim(n.key) ? 0.1 : 1}
                onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(null)}
                onPointerDown={onNodeDown(n.key)}
                onDoubleClick={onNodeFocus(n.key)}
                onClick={onNodeClick(n.key, () => (isTag ? onOpenTag(n.tag) : onOpenSection(n.it.type)))}>
                <title>{isTag
                  ? `#${n.tag} — ${n.count} item${n.count === 1 ? "" : "s"} · click to open, double-click to focus`
                  : `${SECTIONS[n.it.type]?.label || "Item"}: ${n.it.title} · ${d} connection${d === 1 ? "" : "s"} · double-click to focus`}</title>
                {(hover === n.key || focus === n.key) && (
                  <circle cx={p.x} cy={p.y} r={r + 7} fill={color} opacity="0.18" style={{ pointerEvents: "none" }} />
                )}
                <circle cx={p.x} cy={p.y} r={r} fill={color}
                  opacity={isTag ? 0.85 : 1}
                  stroke={focus === n.key ? "var(--ink)" : "var(--panel)"} strokeWidth={(focus === n.key ? 2.5 : 1.8) / Math.max(1, view.k * 0.7)} />
                {lop > 0.02 && (
                  <text x={p.x} y={p.y + r + 13 / Math.max(1, view.k * 0.8)} textAnchor="middle"
                    fontSize={(isTag ? 12.5 : 11.5) / Math.max(1, view.k * 0.8)}
                    fontFamily={isTag ? "IBM Plex Mono" : "Public Sans"}
                    fontWeight={hover === n.key ? 600 : isTag ? 600 : 400}
                    fill={hover === n.key ? "var(--ink)" : "var(--ink-soft)"}
                    opacity={lop} style={{ pointerEvents: "none" }}>
                    {label.length > 24 ? label.slice(0, 22) + "…" : label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        <text x={W - 8} y={H - 10} textAnchor="end" fontSize="11" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">
          size = connections · solid = direct link · dashed = shared tag · double-click any star to focus its neighborhood
        </text>
      </svg>
    </div>
  );
}

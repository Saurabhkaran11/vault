"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "@/lib/seed";

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

const W = 1200, H = 680;
const TOP_TAGS = 60;
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

function layout(items, query) {
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
  const [mode, setMode] = useState("web");   // "web" (force sim) | "orbit" (staleness rings)
  const g = useMemo(() => layout(items, query), [items, query]);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [, tick] = useState(0);               // re-render pulse from the sim
  const svgRef = useRef(null);
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
    <div className="graphwrap graphfull">
      <div className="graphkey">
        <input className="gsearch" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${g.totalTags} tag${g.totalTags === 1 ? "" : "s"}…`} aria-label="Search tags" />
        <span className="graphstats mono">
          {g.totalMatching > g.tags.length ? `TOP ${g.tags.length} OF ${g.totalMatching} TAGS · ` : ""}
          {g.shownItems}{g.shownItems < g.totalItems ? ` OF ${g.totalItems}` : ""} ITEMS
        </span>
        <span className="gzoom gmode" role="group" aria-label="Graph view mode">
          <button className={mode === "web" ? "on" : ""} onClick={() => setMode("web")}
            title="The living force-directed web">Web</button>
          <button className={mode === "orbit" ? "on" : ""} onClick={() => setMode("orbit")}
            title="Items orbit their tags — neglected ones drift to the outer rings">Orbit</button>
        </span>
        <span className="gzoom" role="group" aria-label="Zoom">
          <button onClick={() => zoomCenter(1 / 1.3)} title="Zoom out" aria-label="Zoom out">−</button>
          <span className="mono">{Math.round(view.k * 100)}%</span>
          <button onClick={() => zoomCenter(1.3)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={() => { setView({ k: 1, x: 0, y: 0 }); seedPositions(true); tick((t) => t + 1); }} title="Reset view & re-settle" aria-label="Reset view">⤢</button>
        </span>
        <span className="graphhint mono">LIVE · SCROLL TO ZOOM · DRAG NODES OR BACKGROUND</span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Live force-directed map of your items grouped by project tag"
        preserveAspectRatio="xMidYMid meet"
        style={{ touchAction: "none", cursor: panRef.current ? "grabbing" : "grab" }}
        onPointerDown={onPanStart} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={onUp}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {mode === "orbit" && <OrbitLayer items={items} onOpenTag={onOpenTag} onOpenSection={onOpenSection} k={view.k} />}
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
    </div>
  );
}

/* ---------- Orbit view: items orbit their anchor tag, and how far out they
 * sit is how long they've gone untouched — fresh work hugs the hub, neglect
 * drifts to the outer ring. Same pan/zoom as the web view (it renders inside
 * the same transform group); no simulation, so it's perfectly still. */
const orbitDaysAgo = (it) => {
  const ref = it.edited || it.date;
  if (!ref) return 999;
  return Math.max(0, Math.floor((Date.now() - new Date(ref + "T00:00:00")) / 86400000));
};

function OrbitLayer({ items, onOpenTag, onOpenSection, k }) {
  const model = React.useMemo(() => {
    const byTag = {};
    const untagged = [];
    items.forEach((it) => {
      if (!it.tags?.length) { untagged.push(it); return; }
      (byTag[it.tags[0]] = byTag[it.tags[0]] || []).push(it);
    });
    const groups = Object.entries(byTag)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 12);
    if (untagged.length) groups.push(["__untagged", untagged]);

    const n = groups.length || 1;
    const cols = Math.ceil(Math.sqrt(n * (W / H)));
    const rows = Math.ceil(n / cols);
    const cellW = W / cols, cellH = H / rows;

    return groups.map(([tag, members], gi) => {
      const cx = (gi % cols) * cellW + cellW / 2;
      const cy = Math.floor(gi / cols) * cellH + cellH / 2;
      const maxR = Math.min(cellW, cellH) * 0.42;
      const rings = [maxR * 0.45, maxR * 0.72, maxR];
      const nodes = members.slice(0, 24).map((it, i) => {
        const age = orbitDaysAgo(it);
        const ring = age <= 14 ? 0 : age <= 60 ? 1 : 2;
        const ang = i * 2.399963;                 // golden angle — no clumping
        return {
          it, age, ring,
          x: cx + Math.cos(ang) * rings[ring],
          y: cy + Math.sin(ang) * rings[ring] * 0.92,
        };
      });
      return { tag, cx, cy, rings, nodes, total: members.length };
    });
  }, [items]);

  return (
    <g className="orbitlayer">
      {model.map((grp) => (
        <g key={grp.tag}>
          {grp.rings.map((r, i) => (
            <ellipse key={i} cx={grp.cx} cy={grp.cy} rx={r} ry={r * 0.92}
              fill="none" stroke="var(--line)" strokeDasharray="3 5" strokeWidth={1 / k} />
          ))}
          <g className="gnode" style={{ cursor: "pointer" }}
            onClick={() => grp.tag !== "__untagged" && onOpenTag(grp.tag)}>
            <title>{grp.tag === "__untagged" ? `${grp.total} untagged items` : `Open #${grp.tag} — ${grp.total} item${grp.total === 1 ? "" : "s"}`}</title>
            <circle cx={grp.cx} cy={grp.cy} r={15} fill={grp.tag === "__untagged" ? "var(--ink-soft)" : "var(--moss)"} stroke="var(--panel)" strokeWidth="2.5" />
            <text x={grp.cx} y={grp.cy - 24} textAnchor="middle" fontSize="13" fontFamily="Fraunces" fontWeight="650" fill="var(--ink)"
              style={{ pointerEvents: "none" }}>
              {grp.tag === "__untagged" ? "Untagged" : `#${grp.tag}`}
            </text>
          </g>
          {grp.nodes.map((n) => {
            const s = SECTIONS[n.it.type] || {};
            return (
              <g key={n.it.id} className="gnode" style={{ cursor: "pointer" }}
                onClick={() => onOpenSection(n.it.type)}>
                <title>{`${n.it.alias || n.it.title} — ${n.age === 999 ? "undated" : `${n.age} day${n.age === 1 ? "" : "s"} since touched`}${n.ring === 2 ? " · drifting" : ""}`}</title>
                <circle cx={n.x} cy={n.y} r={n.ring === 0 ? 8 : n.ring === 1 ? 6.5 : 5.5}
                  fill={s.color || "var(--ink-soft)"} opacity={n.ring === 0 ? 1 : n.ring === 1 ? 0.72 : 0.4}
                  stroke="var(--panel)" strokeWidth="1.5" />
              </g>
            );
          })}
        </g>
      ))}
      <text x={W - 8} y={H - 10} textAnchor="end" fontSize="11" fontFamily="IBM Plex Mono" fill="var(--ink-soft)">
        inner ring = touched this fortnight · outer ring = drifting
      </text>
    </g>
  );
}

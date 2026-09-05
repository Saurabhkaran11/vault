"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import { SECTIONS } from "@/lib/seed";

/* 3D view: the react-force-graph starfield.
 * WebGL spheres in real 3D space — orbit with the left mouse button, zoom
 * with the wheel, pan with the right. Click a star to fly the camera to it;
 * right-click opens the item's section (or the tag). Direct links carry
 * animated particles so structure reads even while the cloud spins. */

const MAX_NODES = 500;

export default function Graph3D({ items, query, space, onOpenTag, onOpenSection }) {
  const wrapRef = useRef(null);
  const boxRef = useRef(null);         // the bordered canvas box itself
  const fgRef = useRef();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [showTags, setShowTags] = useState(true);
  const [spin, setSpin] = useState(true);

  /* measure the canvas box directly so WebGL fills it edge to edge */
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const q = query.trim().toLowerCase();
    let pool = items.filter((i) => !i.deleted);
    if (q) pool = pool.filter((i) => (i.alias || i.title || "").toLowerCase().includes(q) || i.tags?.some((t) => t.includes(q)));
    pool = pool.slice(0, MAX_NODES);
    const ids = new Set(pool.map((i) => i.id));

    /* SECTIONS colors are CSS var() references — SVG resolves those, WebGL
       cannot (three.js would paint them black), so resolve to hex here */
    const cssColor = (v) => {
      if (!v || !v.startsWith("var(")) return v || "#5B6675";
      try {
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim();
        return resolved || "#5B6675";
      } catch { return "#5B6675"; }
    };

    /* on the space backdrop the light-theme section blues read muddy —
       swap in the dark-palette variants (same hues, more luminous) */
    const SPACE_COLORS = { note: "#82B4E8", video: "#6AB3EE", book: "#5EC1DC", doc: "#93B6DE" };
    const nodes = pool.map((it) => ({
      id: `i${it.id}`, name: it.alias || it.title, kind: "item", type: it.type,
      color: (space && SPACE_COLORS[it.type]) || cssColor(SECTIONS[it.type]?.color),
    }));
    const links = [];
    const seen = new Set();
    pool.forEach((it) => (it.links || []).forEach((id2) => {
      if (!ids.has(id2)) return;
      const k = it.id < id2 ? `${it.id}|${id2}` : `${id2}|${it.id}`;
      if (seen.has(k)) return;
      seen.add(k);
      links.push({ source: `i${it.id}`, target: `i${id2}`, kind: "link" });
    }));
    if (showTags) {
      const counts = {};
      pool.forEach((it) => it.tags?.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
      Object.entries(counts).forEach(([t, n]) => nodes.push({ id: `t${t}`, name: `#${t}`, kind: "tag", tag: t, color: space ? "#9FA6EC" : "#6C4FB0", count: n }));
      pool.forEach((it) => it.tags?.forEach((t) => links.push({ source: `i${it.id}`, target: `t${t}`, kind: "tag" })));
    }
    const deg = {};
    links.forEach((l) => { deg[l.source] = (deg[l.source] || 0) + 1; deg[l.target] = (deg[l.target] || 0) + 1; });
    nodes.forEach((n) => { n.val = 1.5 + Math.min(14, (deg[n.id] || 0) * 1.6); });
    return { nodes, links };
    /* `space` is a dep so label sprites rebuild with dark-aware colors —
       nodeThreeObject results are cached per data identity otherwise */
  }, [items, query, showTags, space]);

  /* the orbit controls only exist once the WebGL scene mounts — poll briefly */
  useEffect(() => {
    const t = setInterval(() => {
      const c = fgRef.current?.controls?.();
      if (c) { c.autoRotate = spin; c.autoRotateSpeed = 0.7; clearInterval(t); }
    }, 250);
    return () => clearInterval(t);
  }, [spin, data]);

  const fewNodes = data.nodes.length <= 150;
  const linkCount = data.links.filter((l) => l.kind === "link").length;

  return (
    <div className="g3dwrap" ref={wrapRef}>
      <div className="cosmosbar">
        <span className="graphstats mono">{data.nodes.length} STARS · {linkCount} LINKS · 3D</span>
        <span style={{ flex: 1 }} />
        <label className="cp-check g3d-check"><input type="checkbox" checked={showTags} onChange={(e) => setShowTags(e.target.checked)} /> Tag nodes</label>
        <label className="cp-check g3d-check"><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Slow spin</label>
        <button className="kbtn" onClick={() => fgRef.current?.zoomToFit(700, 50)} title="Frame the whole graph">⤢ Fit</button>
      </div>
      <div className="g3dcanvas" ref={boxRef}>
        {size.w > 0 && (
          <ForceGraph3D
            ref={fgRef}
            width={size.w}
            height={Math.max(320, size.h)}
            graphData={data}
            backgroundColor="rgba(0,0,0,0)"
            nodeColor={(n) => n.color}
            nodeOpacity={0.92}
            nodeLabel={(n) => `<div style="font-family:'Public Sans',sans-serif;font-size:12.5px;color:#26313E;background:#fff;border:1px solid #E1E6EE;border-radius:8px;padding:6px 10px;box-shadow:0 6px 16px rgba(30,50,80,.12)">${n.kind === "tag" ? `<b>${n.name}</b> · ${n.count} item${n.count === 1 ? "" : "s"}` : `<b>${n.name}</b> · ${SECTIONS[n.type]?.label || "Item"}`}<br/><span style="color:#7C8698">click: fly close · right-click: open</span></div>`}
            nodeThreeObject={(n) => {
              if (!fewNodes) return undefined;
              const label = n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name;
              const sprite = new SpriteText(label);
              sprite.color = n.kind === "tag" ? (space ? "#B4A6F2" : "#6C4FB0") : (space ? "#C7D2E8" : "#4A5563");
              sprite.textHeight = n.kind === "tag" ? 3.6 : 3.1;
              sprite.position.y = -(7 + Math.sqrt(n.val) * 2.2);
              return sprite;
            }}
            nodeThreeObjectExtend={true}
            linkColor={(l) => (l.kind === "link" ? (space ? "#E0B44C" : "#A87718") : (space ? "#65779F" : "#AEB9C9"))}
            linkOpacity={0.5}
            linkWidth={(l) => (l.kind === "link" ? 1.4 : 0.5)}
            linkDirectionalParticles={(l) => (l.kind === "link" ? 2 : 0)}
            linkDirectionalParticleWidth={1.8}
            linkDirectionalParticleSpeed={0.006}
            onNodeClick={(node) => {
              const fg = fgRef.current;
              if (!fg || node.x === undefined) return;
              const distance = 130;
              const len = Math.hypot(node.x, node.y, node.z) || 1;
              const ratio = 1 + distance / len;
              fg.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 1100);
            }}
            onNodeRightClick={(node) => {
              if (node.kind === "tag") onOpenTag(node.tag);
              else {
                const it = items.find((i) => `i${i.id}` === node.id);
                if (it) onOpenSection(it.type);
              }
            }}
            showNavInfo={false}
          />
        )}
      </div>
      <div className="g3dhint mono">DRAG TO ORBIT · WHEEL TO ZOOM · CLICK A STAR TO FLY CLOSE · RIGHT-CLICK TO OPEN</div>
    </div>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS } from "../data/seed.js";

/* LIVE Obsidian-style graph: a running force simulation.
   Nodes are draggable (pointer events); the simulation reheats on drag,
   springs settle naturally. Click (without dragging) navigates. */

const W = 900, H = 520;

export default function GraphView({ items, onOpenTag, onOpenSection }) {
  const { nodes, links } = useMemo(() => {
    const tags = [...new Set(items.flatMap((i) => i.tags))];
    const nodes = [
      ...tags.map((t) => ({ id: `tag:${t}`, kind: "tag", label: t })),
      ...items.map((i) => ({ id: `item:${i.id}`, kind: i.type, label: i.title, item: i })),
    ];
    const links = [
      ...items.flatMap((i) => i.tags.map((t) => ({ a: `item:${i.id}`, b: `tag:${t}` }))),
      /* direct library links: book → its attached notes/videos/docs */
      ...items.flatMap((i) => (i.links || [])
        .filter((id) => items.find((x) => x.id === id))
        .map((id) => ({ a: `item:${i.id}`, b: `item:${id}`, direct: true }))),
    ];
    return { nodes, links };
  }, [items]);

  const svgRef = useRef(null);
  const simRef = useRef({ pos: {}, alpha: 1, drag: null, moved: false });
  const [, force] = useState(0); // re-render tick
  const [hover, setHover] = useState(null);

  /* (re)seed positions when the node set changes, keep existing ones */
  useEffect(() => {
    const pos = simRef.current.pos;
    nodes.forEach((n, i) => {
      if (!pos[n.id]) {
        const ang = (i / Math.max(1, nodes.length)) * Math.PI * 2;
        pos[n.id] = { x: W / 2 + Math.cos(ang) * 170, y: H / 2 + Math.sin(ang) * 150, vx: 0, vy: 0 };
      }
    });
    Object.keys(pos).forEach((id) => { if (!nodes.find((n) => n.id === id)) delete pos[id]; });
    simRef.current.alpha = 1;
  }, [nodes]);

  /* the living simulation */
  useEffect(() => {
    let raf;
    const step = () => {
      const sim = simRef.current;
      const pos = sim.pos;
      if (sim.alpha > 0.005) {
        const a = sim.alpha;
        for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
          const p = pos[nodes[i].id], q = pos[nodes[j].id];
          if (!p || !q) continue;
          let dx = p.x - q.x, dy = p.y - q.y;
          let d2 = dx * dx + dy * dy || 1; const d = Math.sqrt(d2);
          const f = (2600 / d2) * a;
          dx /= d; dy /= d;
          p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f;
        }
        links.forEach((l) => {
          const p = pos[l.a], q = pos[l.b];
          if (!p || !q) return;
          let dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = (d - 95) * 0.02 * a;
          dx /= d; dy /= d;
          p.vx += dx * k; p.vy += dy * k;
          q.vx -= dx * k; q.vy -= dy * k;
        });
        nodes.forEach((n) => {
          const p = pos[n.id];
          if (!p) return;
          if (sim.drag && sim.drag.id === n.id) { p.vx = 0; p.vy = 0; return; }
          p.vx += (W / 2 - p.x) * 0.004 * a;
          p.vy += (H / 2 - p.y) * 0.004 * a;
          p.x += p.vx *= 0.85; p.y += p.vy *= 0.85;
          p.x = Math.max(40, Math.min(W - 40, p.x));
          p.y = Math.max(30, Math.min(H - 40, p.y));
        });
        sim.alpha *= 0.995;
        force((t) => t + 1);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [nodes, links]);

  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };

  const onDown = (e, id) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    simRef.current.drag = { id };
    simRef.current.moved = false;
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.6);
  };
  const onMove = (e) => {
    const sim = simRef.current;
    if (!sim.drag) return;
    const { x, y } = toSvg(e);
    const p = sim.pos[sim.drag.id];
    if (p) { p.x = Math.max(40, Math.min(W - 40, x)); p.y = Math.max(30, Math.min(H - 40, y)); }
    sim.moved = true;
    sim.alpha = Math.max(sim.alpha, 0.5);
    force((t) => t + 1);
  };
  const onUp = (n) => {
    const sim = simRef.current;
    const wasDrag = sim.moved;
    sim.drag = null;
    sim.alpha = Math.max(sim.alpha, 0.4);
    if (!wasDrag && n) {
      n.kind === "tag" ? onOpenTag(n.label) : onOpenSection(n.kind);
    }
  };

  const connected = (id) => {
    const set = new Set([id]);
    links.forEach((l) => { if (l.a === id) set.add(l.b); if (l.b === id) set.add(l.a); });
    return set;
  };
  const hi = hover ? connected(hover) : null;
  const pos = simRef.current.pos;

  return (
    <div className="graphwrap">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Draggable graph of items connected by shared tags"
        onPointerMove={onMove} onPointerUp={() => onUp(null)} onPointerLeave={() => onUp(null)}
        style={{ touchAction: "none" }}>
        {links.map((l, i) => {
          const a = pos[l.a], b = pos[l.b];
          if (!a || !b) return null;
          const dim = hi && !(hi.has(l.a) && hi.has(l.b));
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={l.direct ? "var(--gold)" : "var(--line)"}
            strokeDasharray={l.direct ? "5 4" : "none"}
            strokeWidth={dim ? 1 : 2} opacity={dim ? 0.3 : 1} />;
        })}
        {nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const isTag = n.kind === "tag";
          const dim = hi && !hi.has(n.id);
          const fill = isTag ? "var(--violet)" : SECTIONS[n.kind].color;
          return (
            <g key={n.id} className="gnode" opacity={dim ? 0.25 : 1}
              onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
              onPointerDown={(e) => onDown(e, n.id)} onPointerUp={() => onUp(n)}>
              <circle cx={p.x} cy={p.y} r={isTag ? 16 : 9} fill={fill} stroke="#fff" strokeWidth="2" />
              <text x={p.x} y={p.y + (isTag ? 30 : 22)} textAnchor="middle" fontSize={isTag ? 12 : 10}
                fontFamily={isTag ? "IBM Plex Mono" : "Public Sans"} fontWeight={isTag ? 600 : 400}
                fill="var(--ink)" style={{ pointerEvents: "none" }}>
                {n.label.length > 26 ? n.label.slice(0, 24) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="glegend">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Drag any node · click to open</div>
        <div><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--violet)", marginRight: 7 }} />tag hub</div>
        {Object.entries(SECTIONS).map(([k, s]) => (
          <div key={k}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: s.color, marginRight: 7 }} />{s.label.toLowerCase()}</div>
        ))}
      </div>
    </div>
  );
}

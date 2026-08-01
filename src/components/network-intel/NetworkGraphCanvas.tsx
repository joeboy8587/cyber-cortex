import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type GNode = {
  node_id: string;
  node_type: "aircraft" | "operator";
  label: string | null;
  registration: string | null;
  operator: string | null;
  aircraft_type: string | null;
  detections: number | null;
  risk_score: number | null;
  flag_count: number | null;
  aoi_min_mi: number | null;
};
export type GEdge = {
  src: string; dst: string;
  edge_type: "registrant" | "copresence" | "behavior";
  weight: number; detail: string | null;
};

const EDGE_COLOR: Record<string, string> = {
  registrant: "hsl(var(--muted-foreground))",
  copresence: "hsl(var(--primary))",
  behavior: "#a855f7",
};

function layout(nodes: GNode[], edges: GEdge[], W: number, H: number) {
  const pos = new Map<string, { x: number; y: number }>();
  const idx = new Map(nodes.map((n, i) => [n.node_id, i]));
  const cx = W / 2, cy = H / 2;
  nodes.forEach((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
    const r = (n.node_type === "operator" ? 0.22 : 0.42) * Math.min(W, H);
    pos.set(n.node_id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  });

  // Lightweight force relaxation (repulsion + spring), fixed iteration budget.
  const P = nodes.map((n) => ({ ...pos.get(n.node_id)!, vx: 0, vy: 0 }));
  const links = edges
    .map((e) => ({ a: idx.get(e.src), b: idx.get(e.dst), w: e.weight }))
    .filter((l): l is { a: number; b: number; w: number } => l.a !== undefined && l.b !== undefined);
  const maxW = Math.max(1, ...links.map((l) => l.w));

  for (let it = 0; it < 220; it++) {
    const k = 1 - it / 260;
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        let dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i % 7) - 3; dy = (j % 7) - 3; d2 = 16; }
        const f = 2400 / d2;
        const d = Math.sqrt(d2);
        P[i].vx += (dx / d) * f; P[i].vy += (dy / d) * f;
        P[j].vx -= (dx / d) * f; P[j].vy -= (dy / d) * f;
      }
    }
    for (const l of links) {
      const dx = P[l.b].x - P[l.a].x, dy = P[l.b].y - P[l.a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 90;
      const f = ((d - target) / d) * 0.02 * (0.4 + (l.w / maxW) * 0.6);
      P[l.a].vx += dx * f; P[l.a].vy += dy * f;
      P[l.b].vx -= dx * f; P[l.b].vy -= dy * f;
    }
    for (const p of P) {
      p.vx += (cx - p.x) * 0.004; p.vy += (cy - p.y) * 0.004;
      p.x += p.vx * k * 0.5; p.y += p.vy * k * 0.5;
      p.vx *= 0.82; p.vy *= 0.82;
      p.x = Math.max(20, Math.min(W - 20, p.x));
      p.y = Math.max(20, Math.min(H - 20, p.y));
    }
  }
  nodes.forEach((n, i) => pos.set(n.node_id, { x: P[i].x, y: P[i].y }));
  return pos;
}

export function NetworkGraphCanvas({
  nodes, edges, selected, onSelect,
}: {
  nodes: GNode[]; edges: GEdge[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 1200, H = 720;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [hover, setHover] = useState<GNode | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const pos = useMemo(() => layout(nodes, edges, W, H), [nodes, edges]);
  const maxRisk = Math.max(1, ...nodes.map((n) => Number(n.risk_score) || 0));

  const handleWheel = useCallback((e: WheelEvent) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    const cur = viewRef.current;
    const next = Math.max(0.3, Math.min(4, cur.z * Math.exp(-dy * 0.0015)));
    const k = next / cur.z;
    setView({ z: next, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k });
  }, []);
  const wheelRef = useRef(handleWheel);
  wheelRef.current = handleWheel;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); wheelRef.current(e); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.node_id, n])), [nodes]);
  const connected = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected]);
    for (const e of edges) {
      if (e.src === selected) s.add(e.dst);
      if (e.dst === selected) s.add(e.src);
    }
    return s;
  }, [selected, edges]);

  return (
    <div
      ref={wrapRef}
      className="relative rounded border border-border bg-background/40 overflow-hidden select-none"
      style={{ touchAction: "none", cursor: drag.current ? "grabbing" : "grab" }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setView((v) => ({ ...v, x: drag.current!.ox + (e.clientX - drag.current!.x), y: drag.current!.oy + (e.clientY - drag.current!.y) }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerLeave={() => { drag.current = null; }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[720px]">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          {edges.map((e, i) => {
            const s = pos.get(e.src), t = pos.get(e.dst);
            if (!s || !t) return null;
            const dim = connected && !(connected.has(e.src) && connected.has(e.dst));
            return (
              <line
                key={`${e.src}-${e.dst}-${e.edge_type}-${i}`}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={EDGE_COLOR[e.edge_type] || "hsl(var(--border))"}
                strokeOpacity={dim ? 0.06 : e.edge_type === "registrant" ? 0.3 : 0.5}
                strokeWidth={e.edge_type === "behavior" ? 1.4 : 1}
                strokeDasharray={e.edge_type === "behavior" ? "4 3" : undefined}
              />
            );
          })}
          {nodes.map((n) => {
            const p = pos.get(n.node_id);
            if (!p) return null;
            const isOp = n.node_type === "operator";
            const risk = Number(n.risk_score) || 0;
            const r = isOp ? 11 : 5 + Math.min(9, Math.sqrt(Number(n.detections) || 1) / 6);
            const fill = isOp
              ? "#f59e0b"
              : risk >= 70 ? "hsl(var(--destructive))"
              : risk >= 40 ? "#fb923c" : "#22d3ee";
            const dim = connected && !connected.has(n.node_id);
            return (
              <g
                key={n.node_id}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(n.node_id)}
                style={{ cursor: "pointer", opacity: dim ? 0.15 : 1 }}
              >
                {n.node_id === selected && (
                  <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
                )}
                {isOp ? (
                  <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={3}
                        fill={fill} fillOpacity={0.9} stroke="hsl(var(--background))" strokeWidth={1.5} />
                ) : (
                  <circle cx={p.x} cy={p.y} r={r} fill={fill} fillOpacity={0.9}
                          stroke="hsl(var(--background))" strokeWidth={1.2} />
                )}
                {(isOp || risk >= 60) && (
                  <text x={p.x} y={p.y - r - 5} textAnchor="middle" fontSize={9}
                        fontFamily="monospace" fill="hsl(var(--foreground))" opacity={0.8}>
                    {(n.label || "").slice(0, 22)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <div className="bg-card/95 border border-border rounded px-3 py-2 text-[10px] font-mono space-y-1">
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-cyan-400" /> Aircraft (low risk)</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-orange-400" /> Elevated</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-destructive" /> High risk</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 bg-amber-500 rounded-sm" /> Operator / LLC</div>
          <div className="pt-1 border-t border-border/60">— registrant · — co-presence · ┄ behavioural twin</div>
        </div>
      </div>

      <div className="absolute bottom-3 right-3 flex gap-1">
        {[["+", 1.25], ["−", 0.8]].map(([lbl, k]) => (
          <button
            key={String(lbl)}
            className="w-8 h-8 rounded border border-border bg-card/95 text-sm font-mono hover:bg-muted"
            onClick={() => setView((v) => {
              const next = Math.max(0.3, Math.min(4, v.z * (k as number)));
              const kk = next / v.z;
              const px = 600, py = 360;
              return { z: next, x: px - (px - v.x) * kk, y: py - (py - v.y) * kk };
            })}
          >{lbl}</button>
        ))}
        <button className="h-8 px-2 rounded border border-border bg-card/95 text-[10px] font-mono hover:bg-muted"
                onClick={() => setView({ x: 0, y: 0, z: 1 })}>RESET</button>
      </div>

      {hover && (
        <div className="absolute top-3 right-3 bg-card/95 border border-border rounded p-3 text-xs font-mono max-w-xs pointer-events-none">
          <div className="text-primary mb-1">{hover.label}</div>
          {hover.node_type === "aircraft" && (
            <>
              <div>Operator: {hover.operator || "UNRESOLVED"}</div>
              {hover.aircraft_type && <div>Type: {hover.aircraft_type}</div>}
              <div>Detections: {Number(hover.detections || 0).toLocaleString()}</div>
              <div>Flags: {hover.flag_count ?? 0}</div>
              <div>Closest to AOI: {hover.aoi_min_mi != null ? `${Number(hover.aoi_min_mi).toFixed(1)} mi` : "—"}</div>
            </>
          )}
          <div className="mt-1">Risk: {Number(hover.risk_score || 0).toFixed(1)} / 100 (max {maxRisk.toFixed(0)})</div>
          <div className="text-muted-foreground mt-1">Click to open profile</div>
        </div>
      )}
    </div>
  );
}

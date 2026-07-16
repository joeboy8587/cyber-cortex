import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Fuel, Plane, Network as NetworkIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Node = { id: string; hex: string; callsign: string; aircraft_type: string; operator: string; role: "tanker" | "receiver"; count: number };
type Edge = { source: string; target: string; weight: number; min_dist_nm: number; tanker_callsign: string; receiver_callsign: string };
type Encounter = { tanker_callsign: string; receiver_callsign: string; receiver_type: string; receiver_operator: string; event_time: string; altitude: number; dist_nm: number };

type Resp = { ok: boolean; error?: string; stats?: Record<string, number>; nodes: Node[]; edges: Edge[]; encounters: Encounter[] };

function layoutNodes(nodes: Node[], edges: Edge[], W: number, H: number) {
  // Simple radial layout: tankers in inner ring, receivers in outer ring around their primary tanker
  const tankers = nodes.filter(n => n.role === "tanker");
  const receivers = nodes.filter(n => n.role === "receiver");
  const cx = W / 2, cy = H / 2;
  const pos = new Map<string, { x: number; y: number }>();

  const tR = Math.min(W, H) * 0.18;
  tankers.forEach((t, i) => {
    const a = (i / Math.max(tankers.length, 1)) * Math.PI * 2;
    pos.set(t.id, { x: cx + Math.cos(a) * tR, y: cy + Math.sin(a) * tR });
  });

  // Assign each receiver to its heaviest tanker edge
  const recvToTanker = new Map<string, string>();
  for (const r of receivers) {
    const rel = edges.filter(e => e.target === r.id);
    rel.sort((a, b) => b.weight - a.weight);
    if (rel[0]) recvToTanker.set(r.id, rel[0].source);
  }
  const groups = new Map<string, Node[]>();
  for (const r of receivers) {
    const t = recvToTanker.get(r.id) || tankers[0]?.id;
    if (!t) continue;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(r);
  }
  const rR = Math.min(W, H) * 0.42;
  groups.forEach((rs, tid) => {
    const tp = pos.get(tid); if (!tp) return;
    const baseAngle = Math.atan2(tp.y - cy, tp.x - cx);
    const spread = Math.PI / 2.5;
    rs.forEach((r, i) => {
      const a = baseAngle + (rs.length === 1 ? 0 : ((i / (rs.length - 1)) - 0.5) * spread);
      pos.set(r.id, { x: cx + Math.cos(a) * rR, y: cy + Math.sin(a) * rR });
    });
  });
  // Any receiver without a tanker: park at edge
  receivers.filter(r => !pos.has(r.id)).forEach((r, i) => {
    const a = (i / receivers.length) * Math.PI * 2;
    pos.set(r.id, { x: cx + Math.cos(a) * rR, y: cy + Math.sin(a) * rR });
  });
  return pos;
}

export default function TankerNetwork() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [hover, setHover] = useState<Node | null>(null);
  const [days, setDays] = useState(30);

  const load = async () => {
    setLoading(true);
    try {
      const { data: resp, error } = await supabase.functions.invoke("tanker-network-analysis", {
        body: { days, proximityNm: 25, timeWindowMin: 15, minAltFt: 15000 },
      });
      if (error) throw error;
      if (!resp?.ok) throw new Error(resp?.error || "Analysis failed");
      setData(resp as Resp);
      toast.success(`Found ${resp.stats?.encounters || 0} refueling encounters`);
    } catch (e: any) {
      toast.error(e.message || "Failed to analyze tankers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const W = 1000, H = 640;
  const positions = useMemo(() => data ? layoutNodes(data.nodes, data.edges, W, H) : new Map(), [data]);
  const maxWeight = useMemo(() => data ? Math.max(1, ...data.edges.map(e => e.weight)) : 1, [data]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display uppercase tracking-wider flex items-center gap-3">
              <Fuel className="w-6 h-6 text-primary" />
              Military Tanker Refueling Network
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              KC-135 / KC-46 / KC-10 co-presence graph — probable air-refueling receivers within 25 nm & ±15 min at &gt; FL150.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={e => setDays(Number(e.target.value))} className="bg-card border border-border rounded px-2 py-1 text-sm">
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
            <Button onClick={load} disabled={loading} size="sm">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Re-analyze
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { l: "Tanker tracks", v: data?.stats?.tanker_tracks ?? 0 },
            { l: "Unique tankers", v: data?.stats?.unique_tankers ?? 0 },
            { l: "Unique receivers", v: data?.stats?.unique_receivers ?? 0 },
            { l: "Encounters", v: data?.stats?.encounters ?? 0 },
            { l: "Edges", v: data?.stats?.edges ?? 0 },
          ].map(s => (
            <Card key={s.l} className="p-3">
              <div className="text-[10px] font-mono uppercase text-muted-foreground">{s.l}</div>
              <div className="text-2xl font-display text-primary">{s.v.toLocaleString()}</div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <NetworkIcon className="w-4 h-4 text-primary" />
              <span className="font-mono text-xs uppercase tracking-wider">Refueling Network Graph</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-orange-500" /> Tanker</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-cyan-400" /> Receiver</span>
            </div>
          </div>
          {loading && !data ? (
            <div className="h-[640px] flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Building network…
            </div>
          ) : !data || data.nodes.length === 0 ? (
            <div className="h-[640px] flex items-center justify-center text-muted-foreground text-sm">
              No tankers or receivers detected in this window.
            </div>
          ) : (
            <div className="relative bg-background/40 rounded border border-border overflow-hidden">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[640px]">
                {data.edges.map((e, i) => {
                  const s = positions.get(e.source); const t = positions.get(e.target);
                  if (!s || !t) return null;
                  const w = 0.5 + (e.weight / maxWeight) * 3.5;
                  return (
                    <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                          stroke="hsl(var(--primary))" strokeOpacity={0.15 + (e.weight / maxWeight) * 0.55}
                          strokeWidth={w} />
                  );
                })}
                {data.nodes.map(n => {
                  const p = positions.get(n.id); if (!p) return null;
                  const r = n.role === "tanker" ? 9 + Math.min(n.count, 12) : 4 + Math.min(n.count, 8);
                  const fill = n.role === "tanker" ? "#f97316" : "#22d3ee";
                  return (
                    <g key={n.id} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                      <circle cx={p.x} cy={p.y} r={r} fill={fill} fillOpacity={0.85} stroke="hsl(var(--background))" strokeWidth={1.5} />
                      {n.role === "tanker" && (
                        <text x={p.x} y={p.y - r - 4} textAnchor="middle" fill="#fed7aa" fontSize={10} fontFamily="monospace">
                          {n.callsign}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {hover && (
                <div className="absolute top-3 left-3 bg-card/95 border border-border rounded p-3 text-xs font-mono max-w-xs">
                  <div className="flex items-center gap-2 mb-1">
                    <Plane className="w-3 h-3" />
                    <Badge variant={hover.role === "tanker" ? "default" : "secondary"} className="text-[10px]">{hover.role.toUpperCase()}</Badge>
                    <span className="text-primary">{hover.callsign}</span>
                  </div>
                  <div>HEX: {hover.hex || "—"}</div>
                  {hover.aircraft_type && <div>Type: {hover.aircraft_type}</div>}
                  {hover.operator && <div>Op: {hover.operator}</div>}
                  <div>Encounters: {hover.count}</div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Top edges table */}
        <Card className="p-4">
          <div className="font-mono text-xs uppercase tracking-wider mb-3">Top Refueling Pairs</div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">Tanker</th>
                  <th className="text-left p-2">Receiver</th>
                  <th className="text-right p-2">Encounters</th>
                  <th className="text-right p-2">Min Dist (nm)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.edges || []).slice(0, 50).map((e, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="p-2 text-orange-400">{e.tanker_callsign || e.source}</td>
                    <td className="p-2 text-cyan-300">{e.receiver_callsign || e.target}</td>
                    <td className="p-2 text-right">{e.weight}</td>
                    <td className="p-2 text-right">{e.min_dist_nm.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Recent encounters */}
        <Card className="p-4">
          <div className="font-mono text-xs uppercase tracking-wider mb-3">Recent Encounters</div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead className="text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Tanker</th>
                  <th className="text-left p-2">Receiver</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-right p-2">Alt (ft)</th>
                  <th className="text-right p-2">Dist (nm)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.encounters || []).slice(0, 100).map((e, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="p-2">{new Date(e.event_time).toLocaleString()}</td>
                    <td className="p-2 text-orange-400">{e.tanker_callsign}</td>
                    <td className="p-2 text-cyan-300">{e.receiver_callsign}</td>
                    <td className="p-2">{e.receiver_type || "—"}</td>
                    <td className="p-2 text-right">{Number(e.altitude).toLocaleString()}</td>
                    <td className="p-2 text-right">{e.dist_nm.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

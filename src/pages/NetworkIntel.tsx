import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NetworkGraphCanvas, type GEdge, type GNode } from "@/components/network-intel/NetworkGraphCanvas";
import { ProfileDrawer } from "@/components/network-intel/ProfileDrawer";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Network, RefreshCw, Brain, Search } from "lucide-react";
import { toast } from "sonner";

const EDGE_TYPES = [
  { key: "registrant", label: "Registrant" },
  { key: "copresence", label: "Co-presence" },
  { key: "behavior", label: "Behavioural twin" },
] as const;

export default function NetworkIntel() {
  const [nodes, setNodes] = useState<GNode[]>([]);
  const [edges, setEdges] = useState<GEdge[]>([]);
  const [ranked, setRanked] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [scope, setScope] = useState<"aircraft" | "operator">("aircraft");

  const [limit, setLimit] = useState(120);
  const [days, setDays] = useState(30);
  const [aoiOnly, setAoiOnly] = useState(false);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [edgeTypes, setEdgeTypes] = useState<string[]>(["registrant", "copresence", "behavior"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r] = await Promise.all([
        supabase.functions.invoke("entity-graph-build", {
          body: { action: "graph", limit, aoiOnly, flaggedOnly, search, edgeTypes },
        }),
        supabase.functions.invoke("entity-graph-build", { body: { action: "rank", scope, limit: 60 } }),
      ]);
      if (g.error) throw g.error;
      if (!g.data?.ok) throw new Error(g.data?.error || "Graph read failed");
      setNodes(g.data.nodes || []);
      setEdges(g.data.edges || []);
      setRanked(r.data?.rows || []);
      if (!(g.data.nodes || []).length) {
        toast.info("Graph is empty — run 'Rebuild graph' to index the detection archive.");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to load network");
    } finally {
      setLoading(false);
    }
  }, [limit, aoiOnly, flaggedOnly, search, edgeTypes, scope]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rebuild = async () => {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("entity-graph-build", {
        body: { action: "build", days },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Build failed");
      toast.success(`Graph rebuilt — ${data.stats?.aircraft ?? 0} aircraft, ${data.stats?.operators ?? 0} operators, ${data.stats?.edges ?? 0} links`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Rebuild failed");
    } finally {
      setBuilding(false);
    }
  };

  const trainEmbeddings = async () => {
    setEmbedding(true);
    try {
      const { data, error } = await supabase.functions.invoke("entity-embed", { body: { days: 90 } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Embedding failed");
      toast.success(`Embeddings trained on ${data.aircraft} aircraft — ${data.behavior_edges} behavioural links`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Embedding run failed");
    } finally {
      setEmbedding(false);
    }
  };

  const toggleEdge = (k: string) =>
    setEdgeTypes((cur) => cur.includes(k) ? cur.filter((c) => c !== k) : [...cur, k]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display uppercase tracking-[0.2em] text-primary flex items-center gap-3">
              <Network className="w-6 h-6" /> Network Intelligence
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Aircraft profiles connected by FAA registrant, shared time and space, and learned behavioural signature.
              Identity comes from the full FAA registry — never feed-supplied operator strings.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                    className="bg-card border border-border rounded px-2 py-1 text-sm">
              {[7, 30, 90, 180, 365].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
            <Button size="sm" variant="outline" onClick={rebuild} disabled={building}>
              {building ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Rebuild graph
            </Button>
            <Button size="sm" variant="outline" onClick={trainEmbeddings} disabled={embedding}>
              {embedding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />}
              Train behaviour model
            </Button>
          </div>
        </header>

        <Card className="p-3 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && load()}
                   placeholder="Registration or operator" className="pl-7 w-56 h-9 text-sm" />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-mono">
            <input type="checkbox" checked={aoiOnly} onChange={(e) => setAoiOnly(e.target.checked)} /> AOI only
          </label>
          <label className="flex items-center gap-1.5 text-xs font-mono">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only
          </label>
          {EDGE_TYPES.map((t) => (
            <label key={t.key} className="flex items-center gap-1.5 text-xs font-mono">
              <input type="checkbox" checked={edgeTypes.includes(t.key)} onChange={() => toggleEdge(t.key)} /> {t.label}
            </label>
          ))}
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-card border border-border rounded px-2 py-1 text-xs">
            {[60, 120, 200, 300].map((l) => <option key={l} value={l}>Top {l} nodes</option>)}
          </select>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Apply
          </Button>
          <div className="ml-auto text-xs font-mono text-muted-foreground">
            {nodes.length} nodes · {edges.length} links
          </div>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <NetworkGraphCanvas nodes={nodes} edges={edges} selected={selected} onSelect={setSelected} />
          <div className="h-[720px]">
            <ProfileDrawer nodeId={selected} />
          </div>
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-mono text-xs uppercase tracking-wider">Repeat offender ranking</div>
            <div className="flex gap-1">
              {(["aircraft", "operator"] as const).map((s) => (
                <Button key={s} size="sm" variant={scope === s ? "default" : "outline"}
                        onClick={() => { setScope(s); setTimeout(load, 0); }}>
                  {s === "aircraft" ? "Airframes" : "Operators"}
                </Button>
              ))}
            </div>
          </div>
          <ScrollArea className="h-[340px]">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-card border-b">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">{scope === "aircraft" ? "Registration" : "Operator"}</th>
                  <th className="text-left p-2">{scope === "aircraft" ? "Operator" : "State"}</th>
                  <th className="text-right p-2">Detections</th>
                  <th className="text-right p-2">Flags</th>
                  <th className="text-right p-2">AOI mi</th>
                  <th className="text-right p-2">&lt;1k ft</th>
                  <th className="text-right p-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.node_id} className="border-b hover:bg-muted/30 cursor-pointer"
                      onClick={() => setSelected(r.node_id)}>
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    <td className="p-2 text-primary">{r.label}</td>
                    <td className="p-2 truncate max-w-[220px]">{scope === "aircraft" ? (r.operator || "UNRESOLVED") : (r.operator_state || "—")}</td>
                    <td className="p-2 text-right">{Number(r.detections || 0).toLocaleString()}</td>
                    <td className="p-2 text-right">{r.flag_count ?? 0}</td>
                    <td className="p-2 text-right">{r.aoi_min_mi != null ? Number(r.aoi_min_mi).toFixed(1) : "—"}</td>
                    <td className="p-2 text-right">{r.low_alt_pct != null ? `${(Number(r.low_alt_pct) * 100).toFixed(0)}%` : "—"}</td>
                    <td className="p-2 text-right">
                      <Badge variant={Number(r.risk_score) >= 70 ? "destructive" : "secondary"}>
                        {Number(r.risk_score || 0).toFixed(0)}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!ranked.length && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
                    No ranked entities yet — run "Rebuild graph".
                  </td></tr>
                )}
              </tbody>
            </table>
          </ScrollArea>
        </Card>
      </div>
    </DashboardLayout>
  );
}

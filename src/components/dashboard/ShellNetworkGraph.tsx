import { useState, useCallback, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Network, 
  Loader2, 
  RefreshCw, 
  Building2,
  Plane,
  AlertTriangle,
  DollarSign,
  Link2,
  Shield
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractNeonData, safeNumber } from "@/lib/formatters";

interface NetworkNode {
  id: string;
  name: string;
  type: "shell" | "aircraft" | "agency" | "contractor" | "individual";
  tier: number;
  ricoIndicators: string[];
  connections: number;
  threatScore: number;
}

interface NetworkLink {
  source: string;
  target: string;
  type: "ownership" | "funding" | "operational" | "registration";
  strength: number;
}

interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
  ricoScore: number;
  totalExposure: number;
}

// KCSO operator-owned fleet — never classify as shell
const KCSO_FLEET_REGS = new Set(['N912KC', 'N913KC', 'N957E', 'N597E', 'N788FA', 'N911KC', 'N914KC', 'N915KC']);
const KCSO_OPERATOR_KEYWORDS = ['KERN COUNTY SHERIFF', 'KCSO', 'KERN CO SHERIFF'];
const isKcsoEntity = (name?: string) => {
  const n = String(name || '').toUpperCase().replace(/\s+/g, '');
  if (KCSO_FLEET_REGS.has(n)) return true;
  const raw = String(name || '').toUpperCase();
  return KCSO_OPERATOR_KEYWORDS.some(k => raw.includes(k));
};

const GOV_KEYWORDS = ['SHERIFF', 'POLICE', 'COUNTY OF', 'CITY OF', 'STATE OF', 'UNITED STATES',
  'U S ', 'US DEPT', 'DEPARTMENT OF', 'NATIONAL GUARD', 'FEDERAL', 'CUSTOMS', 'FIRE DEPT'];
const SHELL_KEYWORDS = ['LLC', 'L L C', 'LEASING', 'TRUST', 'HOLDINGS', 'HOLDING', 'CAPITAL',
  'VENTURES', 'PARTNERS', 'PROPERTIES', 'GROUP LLC', 'INVESTMENT'];

const classifyOperator = (name: string): NetworkNode["type"] => {
  const n = String(name || '').toUpperCase();
  if (isKcsoEntity(n) || GOV_KEYWORDS.some(k => n.includes(k))) return 'agency';
  if (SHELL_KEYWORDS.some(k => n.includes(k))) return 'shell';
  return 'contractor';
};

interface GraphNodeRow {
  node_id: string; node_type: string; label?: string; registration?: string;
  operator?: string; operator_type?: string; operator_state?: string;
  aircraft_type?: string; detections?: number; aoi_pings?: number;
  low_alt_pct?: number; sub_stall_pct?: number; night_pct?: number;
  flag_count?: number; critical_flags?: number; risk_score?: number;
}
interface GraphEdgeRow {
  src: string; dst: string; edge_type: string; weight?: number; detail?: string;
}

export function ShellNetworkGraph() {
  const [isLoading, setIsLoading] = useState(false);
  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);

  const loadNetworkData = useCallback(async () => {
    setIsLoading(true);

    try {
      const callGraph = async () =>
        await supabase.functions.invoke("entity-graph-build", {
          body: { action: "graph", limit: 200 },
        });

      let { data, error } = await callGraph();
      if (error) throw error;

      // Empty graph → build it once from Neon, then re-read.
      if (!data?.nodes?.length) {
        toast.info("Building the entity graph from the flight archive…");
        await supabase.functions.invoke("entity-graph-build", {
          body: { action: "build", days: 10, maxPairs: 5000 },
        });
        const retry = await callGraph();
        data = retry.data;
      }

      const rawNodes: GraphNodeRow[] = data?.nodes || [];
      const rawEdges: GraphEdgeRow[] = data?.edges || [];

      const nodeMap = new Map<string, NetworkNode>();

      rawNodes.forEach((r) => {
        const isAircraft = r.node_type === "aircraft";
        const name = String(r.label || r.registration || r.operator || r.node_id);
        const type: NetworkNode["type"] = isAircraft ? "aircraft" : classifyOperator(name);
        const indicators: string[] = [];
        if (isAircraft) {
          if (Number(r.critical_flags) > 0) indicators.push("CRITICAL_FLAGS");
          if (Number(r.sub_stall_pct) > 0.05) indicators.push("SUB_STALL_TELEMETRY");
          if (Number(r.low_alt_pct) > 0.2) indicators.push("LOW_ALTITUDE_PATTERN");
          if (Number(r.night_pct) > 0.3) indicators.push("NIGHT_OPERATIONS");
          if (Number(r.aoi_pings) > 0) indicators.push("AOI_PRESENCE");
        } else {
          indicators.push(type === "agency" ? "LAW_ENFORCEMENT_OPERATOR" : "REGISTRANT_OF_RECORD");
          if (r.operator_type) indicators.push(String(r.operator_type).toUpperCase());
        }
        nodeMap.set(r.node_id, {
          id: r.node_id,
          name,
          type,
          tier: isAircraft ? 4 : type === "agency" ? 1 : type === "shell" ? 2 : 3,
          ricoIndicators: indicators.filter(Boolean).slice(0, 4),
          connections: 0,
          threatScore: Math.round(Number(r.risk_score) || 0),
        });
      });

      const links: NetworkLink[] = [];
      rawEdges.forEach((e) => {
        const src = nodeMap.get(e.src);
        const dst = nodeMap.get(e.dst);
        if (!src || !dst) return;
        const type: NetworkLink["type"] =
          e.edge_type === "registrant" ? "ownership"
          : e.edge_type === "behavior" ? "funding"
          : "operational";
        links.push({ source: e.src, target: e.dst, type, strength: Number(e.weight) || 1 });
        src.connections++;
        dst.connections++;
      });

      const nodes = [...nodeMap.values()];
      const shellCount = nodes.filter(n => n.type === "shell").length;
      const linkedShare = nodes.length ? nodes.filter(n => n.connections > 0).length / nodes.length : 0;
      const avgRisk = nodes.length
        ? nodes.reduce((s, n) => s + n.threatScore, 0) / nodes.length
        : 0;
      const ricoScore = Math.round(Math.min(100, (shellCount * 4) + (linkedShare * 40) + (avgRisk * 0.3)));

      const totalExposure = nodes.reduce((sum, n) => {
        const tierMultiplier = [50, 20, 10, 5, 1][Math.min(n.tier, 4)];
        return sum + (tierMultiplier * 100000);
      }, 0);

      setNetworkData({ nodes, links, ricoScore, totalExposure });
      toast.success(`Mapped ${nodes.length} entities with ${links.length} connections`);

    } catch (err) {
      console.error("Network mapping error:", err);
      toast.error("Failed to map network");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => { loadNetworkData(); }, [loadNetworkData]);

  const getNodeIcon = (type: string) => {
    switch (type) {
      case "shell": return <Building2 className="h-4 w-4 text-destructive" />;
      case "agency": return <Shield className="h-4 w-4 text-blue-400" />;
      case "aircraft": return <Plane className="h-4 w-4 text-green-400" />;
      case "contractor": return <DollarSign className="h-4 w-4 text-purple-400" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getNodeBadgeClass = (type: string) => {
    switch (type) {
      case "shell": return "bg-destructive text-destructive-foreground";
      case "agency": return "bg-blue-600 text-white";
      case "aircraft": return "bg-green-600 text-white";
      case "contractor": return "bg-purple-600 text-white";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getTierLabel = (tier: number) => {
    switch (tier) {
      case 0: return "APEX";
      case 1: return "COMMAND";
      case 2: return "OPERATIONS";
      case 3: return "SUPPORT";
      default: return "ASSET";
    }
  };

  const tierGroups = useMemo(() => {
    if (!networkData) return {};
    return networkData.nodes.reduce((acc, node) => {
      const tier = node.tier;
      if (!acc[tier]) acc[tier] = [];
      acc[tier].push(node);
      return acc;
    }, {} as Record<number, NetworkNode[]>);
  }, [networkData]);

  return (
    <Card className="border-destructive/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-destructive" />
            Shell Company Network Graph
            <Badge variant="outline" className="ml-2 text-destructive border-destructive/50">
              RICO MAPPING
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={loadNetworkData}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Map Network
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {networkData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/30">
              <div className="text-xs text-destructive">RICO Score</div>
              <div className="text-2xl font-bold text-destructive">{networkData.ricoScore}%</div>
            </div>
            <div className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
              <div className="text-xs text-orange-400">Total Entities</div>
              <div className="text-2xl font-bold">{networkData.nodes.length}</div>
            </div>
            <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <div className="text-xs text-yellow-400">Connections</div>
              <div className="text-2xl font-bold">{networkData.links.length}</div>
            </div>
            <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/30">
              <div className="text-xs text-green-400">Legal Exposure</div>
              <div className="text-lg font-bold">
                ${(networkData.totalExposure / 1000000).toFixed(1)}M
              </div>
            </div>
          </div>
        )}

        <ScrollArea className="h-[400px]">
          {!networkData && !isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Network className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Map the RICO enterprise network</p>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <p className="text-sm">Building network graph...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(tierGroups)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([tier, tierNodes]) => (
                <div key={tier} className="space-y-2">
                  <div className="flex items-center gap-2 sticky top-0 bg-card py-1 z-10">
                    <Badge variant="outline" className="text-xs">
                      TIER {tier} — {getTierLabel(parseInt(tier))}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({tierNodes.length} entities)
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-4 border-l-2 border-muted">
                    {tierNodes.map(node => (
                      <div
                        key={node.id}
                        onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          selectedNode?.id === node.id 
                            ? "bg-primary/20 border-primary" 
                            : "bg-muted/30 border-muted hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {getNodeIcon(node.type)}
                            <span className="font-mono text-sm truncate max-w-[150px]">
                              {node.name}
                            </span>
                          </div>
                          <Badge className={`${getNodeBadgeClass(node.type)} text-xs`}>
                            {node.type.toUpperCase()}
                          </Badge>
                        </div>
                        
                        {node.ricoIndicators.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {node.ricoIndicators.slice(0, 2).map((indicator, i) => (
                              <Badge key={i} variant="outline" className="text-xs text-destructive border-destructive/50">
                                {indicator}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Link2 className="h-3 w-3" />
                            {node.connections} links
                          </span>
                          <span>Threat: {node.threatScore}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {selectedNode && (
          <div className="p-4 bg-primary/10 rounded-lg border border-primary/30">
            <h4 className="font-semibold flex items-center gap-2">
              {selectedNode.name}
              <Badge className={getNodeBadgeClass(selectedNode.type)}>
                {selectedNode.type.toUpperCase()}
              </Badge>
            </h4>
            <div className="grid grid-cols-3 gap-4 mt-3 text-sm">
              <div>
                <span className="text-muted-foreground">Tier:</span>
                <span className="ml-2 font-mono">{getTierLabel(selectedNode.tier)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Connections:</span>
                <span className="ml-2 font-mono">{selectedNode.connections}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Threat Score:</span>
                <span className="ml-2 font-mono text-destructive">{selectedNode.threatScore}%</span>
              </div>
            </div>
            {selectedNode.ricoIndicators.length > 0 && (
              <div className="mt-3">
                <span className="text-xs text-muted-foreground">RICO Indicators:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedNode.ricoIndicators.map((ind, i) => (
                    <Badge key={i} variant="destructive" className="text-xs">
                      {ind}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

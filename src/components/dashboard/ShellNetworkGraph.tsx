import { useState, useCallback, useMemo } from "react";
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
  Link2
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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

export function ShellNetworkGraph() {
  const [isLoading, setIsLoading] = useState(false);
  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);

  const loadNetworkData = useCallback(async () => {
    setIsLoading(true);

    try {
      // Fetch enterprise structure
      const { data: enterprise } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              entity_name, 
              tier, 
              role, 
              legal_exposure, 
              linked_aircraft,
              threat_score,
              prosecution_priority
            FROM criminal_enterprise_command_structure
            ORDER BY tier, threat_score DESC
            LIMIT 50
          `
        }
      });

      // Fetch shell company data
      const { data: shells } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT DISTINCT
              operator_name,
              registration,
              COUNT(*) as detection_count
            FROM live_flight_detections_rows
            WHERE operator_name ILIKE '%LLC%' 
               OR operator_name ILIKE '%INC%'
               OR operator_name ILIKE '%CORP%'
            GROUP BY operator_name, registration
            HAVING COUNT(*) > 5
            ORDER BY detection_count DESC
            LIMIT 30
          `
        }
      });

      // Build network graph
      const nodes: NetworkNode[] = [];
      const links: NetworkLink[] = [];
      const nodeMap = new Map<string, NetworkNode>();

      // Add enterprise entities
      const enterpriseData = Array.isArray(enterprise) ? enterprise : [];
      enterpriseData.forEach((e: any) => {
        const nodeId = e.entity_name?.toLowerCase().replace(/\s+/g, "_") || crypto.randomUUID();
        const ricoIndicators: string[] = [];
        
        if (e.role?.includes("Shell")) ricoIndicators.push("SHELL_STRUCTURE");
        if (e.role?.includes("Medical")) ricoIndicators.push("MEDICAL_FRAUD");
        if (e.tier <= 1) ricoIndicators.push("COMMAND_LEVEL");
        if (e.linked_aircraft?.length > 2) ricoIndicators.push("FLEET_CONTROL");

        const node: NetworkNode = {
          id: nodeId,
          name: e.entity_name || "Unknown",
          type: e.role?.includes("Shell") ? "shell" : 
                e.role?.includes("Agency") ? "agency" : 
                e.role?.includes("Contractor") ? "contractor" : "individual",
          tier: e.tier || 3,
          ricoIndicators,
          connections: 0,
          threatScore: e.threat_score || 50
        };
        
        nodes.push(node);
        nodeMap.set(nodeId, node);

        // Link aircraft to entity
        if (e.linked_aircraft && Array.isArray(e.linked_aircraft)) {
          e.linked_aircraft.forEach((aircraft: string) => {
            const aircraftId = aircraft.toLowerCase();
            
            if (!nodeMap.has(aircraftId)) {
              const aircraftNode: NetworkNode = {
                id: aircraftId,
                name: aircraft,
                type: "aircraft",
                tier: 4,
                ricoIndicators: [],
                connections: 0,
                threatScore: 40
              };
              nodes.push(aircraftNode);
              nodeMap.set(aircraftId, aircraftNode);
            }

            links.push({
              source: nodeId,
              target: aircraftId,
              type: "ownership",
              strength: 0.8
            });

            node.connections++;
            nodeMap.get(aircraftId)!.connections++;
          });
        }
      });

      // Add shell company connections
      const shellData = Array.isArray(shells) ? shells : [];
      shellData.forEach((s: any) => {
        const operatorId = s.operator_name?.toLowerCase().replace(/\s+/g, "_");
        const aircraftId = s.registration?.toLowerCase();
        
        if (operatorId && aircraftId && !nodeMap.has(operatorId)) {
          const shellNode: NetworkNode = {
            id: operatorId,
            name: s.operator_name,
            type: "shell",
            tier: 2,
            ricoIndicators: ["LLC_STRUCTURE", "OPERATIONAL_CONTROL"],
            connections: 1,
            threatScore: 55
          };
          nodes.push(shellNode);
          nodeMap.set(operatorId, shellNode);

          links.push({
            source: operatorId,
            target: aircraftId,
            type: "registration",
            strength: 0.6
          });
        }
      });

      // Calculate RICO score
      const tier0Nodes = nodes.filter(n => n.tier === 0).length;
      const tier1Nodes = nodes.filter(n => n.tier === 1).length;
      const shellNodes = nodes.filter(n => n.type === "shell").length;
      const ricoScore = Math.min(100, (tier0Nodes * 25) + (tier1Nodes * 15) + (shellNodes * 5));

      // Calculate total exposure
      const totalExposure = enterpriseData.reduce((sum: number, e: any) => {
        const exposure = parseFloat(e.legal_exposure?.replace(/[^0-9.]/g, "") || "0");
        return sum + exposure;
      }, 0);

      setNetworkData({
        nodes,
        links,
        ricoScore,
        totalExposure
      });

      toast.success(`Mapped ${nodes.length} entities with ${links.length} connections`);

    } catch (err) {
      console.error("Network mapping error:", err);
      toast.error("Failed to map network");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getNodeColor = (type: string) => {
    switch (type) {
      case "shell": return "bg-red-500";
      case "agency": return "bg-blue-500";
      case "aircraft": return "bg-green-500";
      case "contractor": return "bg-purple-500";
      default: return "bg-gray-500";
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
    <Card className="border-red-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Network className="h-5 w-5 text-red-400" />
            Shell Company Network Graph
            <Badge variant="outline" className="ml-2 text-red-400 border-red-400/50">
              RICO MAPPING
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={loadNetworkData}
            disabled={isLoading}
            className="bg-red-600 hover:bg-red-700"
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
        {/* Network Stats */}
        {networkData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <div className="text-xs text-red-400">RICO Score</div>
              <div className="text-2xl font-bold text-red-400">{networkData.ricoScore}%</div>
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

        {/* Hierarchical Network View */}
        <ScrollArea className="h-[400px]">
          {!networkData ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Network className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Map the RICO enterprise network</p>
              <p className="text-xs mt-1 opacity-70">Traces shell companies → aircraft → operators</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(tierGroups)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([tier, nodes]) => (
                <div key={tier} className="space-y-2">
                  <div className="flex items-center gap-2 sticky top-0 bg-card py-1">
                    <Badge variant="outline" className="text-xs">
                      TIER {tier} - {getTierLabel(parseInt(tier))}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      ({nodes.length} entities)
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-4 border-l-2 border-muted">
                    {nodes.map(node => (
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
                            {node.type === "shell" && <Building2 className="h-4 w-4 text-red-400" />}
                            {node.type === "aircraft" && <Plane className="h-4 w-4 text-green-400" />}
                            {node.type === "agency" && <AlertTriangle className="h-4 w-4 text-blue-400" />}
                            {node.type === "contractor" && <DollarSign className="h-4 w-4 text-purple-400" />}
                            <span className="font-mono text-sm truncate max-w-[150px]">
                              {node.name}
                            </span>
                          </div>
                          <Badge className={`${getNodeColor(node.type)} text-xs`}>
                            {node.type.toUpperCase()}
                          </Badge>
                        </div>
                        
                        {node.ricoIndicators.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {node.ricoIndicators.slice(0, 2).map((indicator, i) => (
                              <Badge key={i} variant="outline" className="text-xs text-red-400 border-red-400/50">
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

        {/* Selected Node Details */}
        {selectedNode && (
          <div className="p-4 bg-primary/10 rounded-lg border border-primary/30">
            <h4 className="font-semibold flex items-center gap-2">
              {selectedNode.name}
              <Badge className={getNodeColor(selectedNode.type)}>
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
                <span className="ml-2 font-mono text-red-400">{selectedNode.threatScore}%</span>
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

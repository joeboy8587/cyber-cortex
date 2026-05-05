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

// Fallback only used if Neon query fails
const FALLBACK_ENTERPRISE: Array<{
  name: string;
  type: NetworkNode["type"];
  tier: number;
  ricoIndicators: string[];
  threatScore: number;
  linkedAircraft: string[];
  linkedEntities: string[];
}> = [];


// KCSO operator-owned fleet — never classify as shell
const KCSO_FLEET_REGS = new Set(['N912KC', 'N913KC', 'N957E', 'N597E', 'N788FA', 'N911KC', 'N914KC', 'N915KC']);
const KCSO_OPERATOR_KEYWORDS = ['KERN COUNTY SHERIFF', 'KCSO', 'KERN CO SHERIFF'];
const isKcsoEntity = (name?: string) => {
  const n = String(name || '').toUpperCase().replace(/\s+/g, '');
  if (KCSO_FLEET_REGS.has(n)) return true;
  const raw = String(name || '').toUpperCase();
  return KCSO_OPERATOR_KEYWORDS.some(k => raw.includes(k));
};

export function ShellNetworkGraph() {
  const [isLoading, setIsLoading] = useState(false);
  const [networkData, setNetworkData] = useState<NetworkData | null>(null);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);

  const loadNetworkData = useCallback(async () => {
    setIsLoading(true);

    try {
      // Query live enterprise config from Neon
      const [configResp, entityResp] = await Promise.all([
        supabase.functions.invoke("neon-query", {
          body: { action: "getInvestigationConfig" }
        }),
        supabase.from("entity_registry")
          .select("canonical_identifier, entity_type, threat_classification, aliases, metadata")
          .in("entity_type", ["shell_company", "contractor", "agency", "operator"])
          .limit(50),
      ]);

      const config = configResp.data || {};
      const enterpriseHierarchy = extractNeonData(config.enterprise_hierarchy) || [];
      const shellCompanies = extractNeonData(config.shell_companies) || [];
      const kcsoFleet = extractNeonData(config.kcso_fleet) || [];

      const nodes: NetworkNode[] = [];
      const links: NetworkLink[] = [];
      const nodeMap = new Map<string, NetworkNode>();

      const addNode = (node: NetworkNode) => {
        if (!nodeMap.has(node.id)) {
          nodes.push(node);
          nodeMap.set(node.id, node);
        }
        return nodeMap.get(node.id)!;
      };

      const addLink = (source: string, target: string, type: NetworkLink["type"], strength: number) => {
        if (nodeMap.has(source) && nodeMap.has(target)) {
          links.push({ source, target, type, strength });
          nodeMap.get(source)!.connections++;
          nodeMap.get(target)!.connections++;
        }
      };

      // 1. Build from live enterprise hierarchy (from criminal_enterprise_command_structure)
      enterpriseHierarchy.forEach((entity: any) => {
        const entityId = (entity.entity_name || '').toLowerCase().replace(/[\s\/]+/g, "_");
        const linkedAircraft = Array.isArray(entity.linked_aircraft) ? entity.linked_aircraft : 
          typeof entity.linked_aircraft === 'string' ? entity.linked_aircraft.replace(/[{}]/g, '').split(',').filter(Boolean) : [];
        const linkedEntities = Array.isArray(entity.linked_entities) ? entity.linked_entities :
          typeof entity.linked_entities === 'string' ? entity.linked_entities.replace(/[{}]/g, '').split(',').filter(Boolean) : [];
        const ricoIndicators = Array.isArray(entity.rico_indicators) ? entity.rico_indicators :
          typeof entity.rico_indicators === 'string' ? entity.rico_indicators.replace(/[{}]/g, '').split(',').filter(Boolean) : [];

        addNode({
          id: entityId,
          name: entity.entity_name || entityId,
          type: entity.entity_type === 'shell_company' ? 'shell' :
                entity.entity_type === 'agency' ? 'agency' :
                entity.entity_type === 'contractor' ? 'contractor' : 'individual',
          tier: parseInt(String(entity.tier || '3')),
          ricoIndicators: ricoIndicators,
          connections: 0,
          threatScore: parseInt(String(entity.threat_score || '50'))
        });

        linkedAircraft.forEach((reg: string) => {
          const aircraftId = reg.trim().toLowerCase();
          if (!aircraftId) return;
          addNode({ id: aircraftId, name: reg.trim(), type: "aircraft", tier: 4, ricoIndicators: [], connections: 0, threatScore: 40 });
          addLink(entityId, aircraftId, "ownership", 0.9);
        });

        linkedEntities.forEach((target: string) => {
          const targetId = target.trim().toLowerCase().replace(/[\s\/]+/g, "_");
          if (nodeMap.has(targetId)) addLink(entityId, targetId, "operational", 0.7);
        });
      });

      // 1b. Add shell companies from shell_companies table (skip KCSO operator-owned aircraft)
      shellCompanies.forEach((sc: any) => {
        if (isKcsoEntity(sc.company_name)) return;
        const scId = (sc.company_name || '').toLowerCase().replace(/[\s\/]+/g, "_");
        if (!scId || nodeMap.has(scId)) return;
        addNode({
          id: scId, name: sc.company_name, type: "shell", tier: 2,
          ricoIndicators: sc.rico_indicators ? [sc.rico_indicators] : ["SHELL_STRUCTURE"],
          connections: 0, threatScore: parseInt(String(sc.risk_score || '70'))
        });
      });

      // Ensure KCSO agency node exists so fleet links resolve
      const kcsoAgencyId = "kcso_aviation_unit";
      if (!nodeMap.has(kcsoAgencyId)) {
        addNode({
          id: kcsoAgencyId, name: "Kern County Sheriff Aviation Unit",
          type: "agency", tier: 1, ricoIndicators: ["LAW_ENFORCEMENT_OPERATOR"],
          connections: 0, threatScore: 70
        });
      }

      // 1c. Add KCSO fleet aircraft
      kcsoFleet.forEach((f: any) => {
        const aircraftId = (f.tail_number || '').toLowerCase();
        if (!aircraftId) return;
        addNode({ id: aircraftId, name: f.tail_number, type: "aircraft", tier: 4, ricoIndicators: [], connections: 0, threatScore: 45 });
        // Link to KCSO if it exists
        const kcsoId = "kcso_aviation_unit";
        if (nodeMap.has(kcsoId)) addLink(kcsoId, aircraftId, "ownership", 0.95);
      });

      // If no enterprise data was loaded, use fallback
      if (enterpriseHierarchy.length === 0 && FALLBACK_ENTERPRISE.length > 0) {
        FALLBACK_ENTERPRISE.forEach(entity => {
          const entityId = entity.name.toLowerCase().replace(/[\s\/]+/g, "_");
          addNode({ id: entityId, name: entity.name, type: entity.type, tier: entity.tier, ricoIndicators: [...entity.ricoIndicators], connections: 0, threatScore: entity.threatScore });
          entity.linkedAircraft.forEach(reg => {
            const aircraftId = reg.toLowerCase();
            addNode({ id: aircraftId, name: reg, type: "aircraft", tier: 4, ricoIndicators: [], connections: 0, threatScore: 40 });
            addLink(entityId, aircraftId, "ownership", 0.9);
          });
        });
      }

      // 2. Enrich from entity_registry (Supabase)
      const entities = entityResp.data || [];
      entities.forEach((e: any) => {
        const isKcso = isKcsoEntity(e.canonical_identifier);
        const entityId = (e.canonical_identifier || "").toLowerCase().replace(/[\s\/]+/g, "_");
        if (entityId && !nodeMap.has(entityId)) {
          const resolvedType: NetworkNode["type"] = isKcso
            ? (KCSO_FLEET_REGS.has(String(e.canonical_identifier || '').toUpperCase().replace(/\s+/g, '')) ? "aircraft" : "agency")
            : e.entity_type === "shell_company" ? "shell"
            : e.entity_type === "agency" ? "agency"
            : e.entity_type === "contractor" ? "contractor" : "individual";
          addNode({
            id: entityId,
            name: e.canonical_identifier,
            type: resolvedType,
            tier: resolvedType === "aircraft" ? 4 : resolvedType === "shell" ? 2 : resolvedType === "agency" ? 1 : 3,
            ricoIndicators: isKcso ? ["LAW_ENFORCEMENT_OPERATOR"] : (e.threat_classification ? [e.threat_classification] : []),
            connections: 0,
            threatScore: 50
          });
          if (resolvedType === "aircraft" && isKcso) {
            addLink("kcso_aviation_unit", entityId, "ownership", 0.95);
          }
        }
      });

      // Calculate RICO score
      const tier0 = nodes.filter(n => n.tier === 0).length;
      const tier1 = nodes.filter(n => n.tier === 1).length;
      const shellCount = nodes.filter(n => n.type === "shell").length;
      const ricoScore = Math.min(100, (tier0 * 25) + (tier1 * 15) + (shellCount * 5) + 10);

      // Estimate total legal exposure based on entity count and tier
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

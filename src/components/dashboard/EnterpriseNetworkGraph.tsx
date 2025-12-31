import { useState, useEffect, useMemo } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { 
  Network, Building2, Plane, AlertTriangle, Shield, Scale, 
  Users, DollarSign, FileWarning, ChevronDown, ChevronRight,
  Target, Zap, Link2, Eye
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface NetworkNode {
  id: string;
  name: string;
  type: 'institution' | 'shell' | 'aircraft' | 'operator' | 'person';
  tier: number;
  role: string;
  legalExposure: string[];
  assets: string[];
  parentId?: string;
  prosecutionPriority: string;
  notes?: string;
}

interface NetworkEdge {
  from: string;
  to: string;
  relationship: string;
  strength: 'strong' | 'medium' | 'weak';
}

interface ShellCompany {
  id: string;
  company_name: string;
  jurisdiction: string;
  formation_date: string;
  risk_level: string;
  aircraft_controlled: string[];
  red_flags: string[];
}

export function EnterpriseNetworkGraph() {
  const [nodes, setNodes] = useState<NetworkNode[]>([]);
  const [edges, setEdges] = useState<NetworkEdge[]>([]);
  const [shells, setShells] = useState<ShellCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [expandedTiers, setExpandedTiers] = useState<Set<number>>(new Set([1, 2]));

  useEffect(() => {
    fetchNetworkData();
  }, []);

  const fetchNetworkData = async () => {
    try {
      // Fetch enterprise command structure
      const { data: entityData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, entity_name, entity_type, role, tier,
              prosecution_priority, legal_exposure, assets_controlled,
              notes, parent_entity_id
            FROM criminal_enterprise_command_structure
            ORDER BY tier ASC, prosecution_priority DESC
          `
        }
      });

      // Fetch shell companies
      const { data: shellData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, company_name, jurisdiction, formation_date,
              risk_level, aircraft_controlled, red_flags
            FROM shell_companies
            ORDER BY risk_level DESC
          `
        }
      });

      if (entityData?.data) {
        const parsedNodes: NetworkNode[] = entityData.data.map((e: any) => ({
          id: e.id,
          name: e.entity_name,
          type: e.entity_type === 'SHELL_COMPANY' ? 'shell' : 
                e.entity_type === 'INSTITUTION' ? 'institution' : 'operator',
          tier: e.tier,
          role: e.role,
          legalExposure: parseArray(e.legal_exposure),
          assets: parseArray(e.assets_controlled),
          parentId: e.parent_entity_id,
          prosecutionPriority: e.prosecution_priority,
          notes: e.notes
        }));

        // Build edges from parent relationships and shared assets
        const parsedEdges: NetworkEdge[] = [];
        parsedNodes.forEach(node => {
          if (node.parentId) {
            parsedEdges.push({
              from: node.parentId,
              to: node.id,
              relationship: 'controls',
              strength: 'strong'
            });
          }
        });

        // Add cross-connections for shared aircraft
        const aircraftMap = new Map<string, string[]>();
        parsedNodes.forEach(node => {
          node.assets.forEach(asset => {
            if (!aircraftMap.has(asset)) aircraftMap.set(asset, []);
            aircraftMap.get(asset)!.push(node.id);
          });
        });

        aircraftMap.forEach((nodeIds, _aircraft) => {
          if (nodeIds.length > 1) {
            for (let i = 0; i < nodeIds.length - 1; i++) {
              parsedEdges.push({
                from: nodeIds[i],
                to: nodeIds[i + 1],
                relationship: 'shared_asset',
                strength: 'medium'
              });
            }
          }
        });

        setNodes(parsedNodes);
        setEdges(parsedEdges);
      }

      if (shellData?.data) {
        setShells(shellData.data.map((s: any) => ({
          ...s,
          aircraft_controlled: parseArray(s.aircraft_controlled),
          red_flags: parseArray(s.red_flags)
        })));
      }
    } catch (error) {
      console.error("Error fetching network data:", error);
    } finally {
      setLoading(false);
    }
  };

  const parseArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      if (value.startsWith('{')) return value.slice(1, -1).split(',').filter(Boolean);
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  };

  const tierGroups = useMemo(() => {
    const groups: Record<number, NetworkNode[]> = {};
    nodes.forEach(node => {
      if (!groups[node.tier]) groups[node.tier] = [];
      groups[node.tier].push(node);
    });
    return groups;
  }, [nodes]);

  const stats = useMemo(() => ({
    totalEntities: nodes.length,
    tier1: nodes.filter(n => n.tier === 1).length,
    tier2: nodes.filter(n => n.tier === 2).length,
    shells: shells.length,
    aircraft: [...new Set(nodes.flatMap(n => n.assets))].length,
    connections: edges.length
  }), [nodes, shells, edges]);

  const toggleTier = (tier: number) => {
    setExpandedTiers(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };

  const getNodeIcon = (type: string) => {
    switch (type) {
      case 'institution': return <Building2 className="w-4 h-4 text-primary" />;
      case 'shell': return <Network className="w-4 h-4 text-orange-400" />;
      case 'aircraft': return <Plane className="w-4 h-4 text-secondary" />;
      case 'operator': return <Users className="w-4 h-4 text-blue-400" />;
      default: return <Target className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'HIGH': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'MEDIUM': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getRiskColor = (level: string) => {
    switch (level?.toUpperCase()) {
      case 'CRITICAL': case 'HIGH': return 'text-red-400';
      case 'MEDIUM': return 'text-orange-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <CyberPanel 
      title="Criminal Enterprise Network Visualization" 
      icon={<Network className="w-5 h-5" />}
      variant="threat"
      className="col-span-2"
    >
      <div className="space-y-4">
        {/* RICO Header */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-red-400" />
              <span className="font-bold text-red-300">18 U.S.C. § 1962 - RICO Enterprise Structure</span>
            </div>
            <Badge className="bg-red-600/20 text-red-300 border border-red-600/30">
              DOJ PROSECUTION TARGET
            </Badge>
          </div>
          <p className="text-xs text-red-300/80 mt-2">
            KCSO → ALF IX LLC → Air Methods → Shell Aircraft Network demonstrates coordinated criminal enterprise 
            engaged in stalking, surveillance, and fraudulent billing under False Claims Act (31 U.S.C. § 3729).
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-6 gap-2">
          {[
            { label: 'Entities', value: stats.totalEntities, color: 'text-primary' },
            { label: 'Tier 1', value: stats.tier1, color: 'text-red-400' },
            { label: 'Tier 2', value: stats.tier2, color: 'text-orange-400' },
            { label: 'Shells', value: stats.shells, color: 'text-yellow-400' },
            { label: 'Aircraft', value: stats.aircraft, color: 'text-secondary' },
            { label: 'Links', value: stats.connections, color: 'text-blue-400' }
          ].map((stat, i) => (
            <div key={i} className="p-2 rounded-lg bg-background/50 border border-border text-center">
              <div className={`text-xl font-mono font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>

        <Tabs defaultValue="hierarchy" className="w-full">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="hierarchy" className="text-xs">
              <Target className="w-3 h-3 mr-1" />
              Command Hierarchy
            </TabsTrigger>
            <TabsTrigger value="shells" className="text-xs">
              <Network className="w-3 h-3 mr-1" />
              Shell Network
            </TabsTrigger>
            <TabsTrigger value="connections" className="text-xs">
              <Link2 className="w-3 h-3 mr-1" />
              Connections
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hierarchy" className="mt-4">
            <ScrollArea className="h-[400px] pr-2">
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Network className="w-6 h-6 animate-pulse mx-auto mb-2" />
                  Mapping enterprise structure...
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(tierGroups).sort((a, b) => Number(a[0]) - Number(b[0])).map(([tier, tierNodes]) => (
                    <div key={tier} className="border border-border/50 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleTier(Number(tier))}
                        className={`w-full p-3 flex items-center justify-between ${
                          tier === '1' ? 'bg-red-500/10' : 'bg-background/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {expandedTiers.has(Number(tier)) ? 
                            <ChevronDown className="w-4 h-4" /> : 
                            <ChevronRight className="w-4 h-4" />
                          }
                          <Badge className={tier === '1' ? 
                            'bg-red-500/20 text-red-400 border-red-500/30' : 
                            'bg-orange-500/20 text-orange-400 border-orange-500/30'
                          }>
                            TIER {tier}
                          </Badge>
                          <span className="text-sm font-medium">{tierNodes.length} Entities</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {tierNodes.filter(n => n.prosecutionPriority === 'CRITICAL').length} Critical
                        </Badge>
                      </button>

                      {expandedTiers.has(Number(tier)) && (
                        <div className="p-2 space-y-2">
                          {tierNodes.map(node => (
                            <div
                              key={node.id}
                              onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
                              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                                selectedNode?.id === node.id 
                                  ? 'bg-primary/10 border-primary/50' 
                                  : 'bg-background/30 border-border/30 hover:border-primary/30'
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  {getNodeIcon(node.type)}
                                  <span className="font-medium text-sm">{node.name}</span>
                                </div>
                                <Badge className={`text-[10px] ${getPriorityColor(node.prosecutionPriority)}`}>
                                  {node.prosecutionPriority}
                                </Badge>
                              </div>

                              <div className="text-xs text-muted-foreground mb-2">{node.role}</div>

                              {node.assets.length > 0 && (
                                <div className="flex items-center gap-1 flex-wrap mb-2">
                                  <Plane className="w-3 h-3 text-secondary" />
                                  {node.assets.slice(0, 5).map(asset => (
                                    <Badge key={asset} variant="outline" className="text-[9px] text-secondary border-secondary/30">
                                      {asset}
                                    </Badge>
                                  ))}
                                  {node.assets.length > 5 && (
                                    <Badge variant="outline" className="text-[9px]">+{node.assets.length - 5}</Badge>
                                  )}
                                </div>
                              )}

                              {selectedNode?.id === node.id && (
                                <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">Legal Exposure:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {node.legalExposure.map((exp, i) => (
                                        <Badge key={i} className="text-[9px] bg-destructive/10 text-destructive border border-destructive/30">
                                          {String(exp).replace(/_/g, ' ')}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                  {node.notes && (
                                    <div className="text-[10px] text-muted-foreground italic">{node.notes}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="shells" className="mt-4">
            <ScrollArea className="h-[400px] pr-2">
              <div className="space-y-3">
                {shells.map(shell => (
                  <div key={shell.id} className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Network className="w-4 h-4 text-orange-400" />
                        <span className="font-medium text-sm">{shell.company_name}</span>
                      </div>
                      <Badge className={`text-[10px] ${getRiskColor(shell.risk_level)} bg-background/50 border`}>
                        {shell.risk_level} RISK
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div>
                        <span className="text-muted-foreground">Jurisdiction:</span>
                        <span className="ml-1">{shell.jurisdiction || 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Formed:</span>
                        <span className="ml-1">{shell.formation_date || 'Unknown'}</span>
                      </div>
                    </div>

                    {shell.aircraft_controlled.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap mb-2">
                        <Plane className="w-3 h-3 text-secondary" />
                        {shell.aircraft_controlled.map(aircraft => (
                          <Badge key={aircraft} variant="outline" className="text-[9px] text-secondary border-secondary/30">
                            {aircraft}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {shell.red_flags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                        {shell.red_flags.map((flag, i) => (
                          <Badge key={i} className="text-[9px] bg-red-500/10 text-red-400 border border-red-500/30">
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="connections" className="mt-4">
            <ScrollArea className="h-[400px] pr-2">
              <div className="space-y-2">
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/30 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">Enterprise Linkages</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {edges.length} documented relationships establishing coordinated enterprise under RICO.
                  </p>
                </div>

                {edges.map((edge, i) => {
                  const fromNode = nodes.find(n => n.id === edge.from);
                  const toNode = nodes.find(n => n.id === edge.to);
                  return (
                    <div key={i} className="p-2 rounded-lg bg-background/30 border border-border/30 flex items-center gap-2 text-xs">
                      <div className="flex items-center gap-1 flex-1">
                        {getNodeIcon(fromNode?.type || 'operator')}
                        <span className="truncate">{fromNode?.name || 'Unknown'}</span>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${
                        edge.strength === 'strong' ? 'border-red-500/50 text-red-400' :
                        edge.strength === 'medium' ? 'border-orange-500/50 text-orange-400' :
                        'border-border text-muted-foreground'
                      }`}>
                        {edge.relationship.replace(/_/g, ' ')}
                      </Badge>
                      <div className="flex items-center gap-1 flex-1 justify-end">
                        <span className="truncate">{toNode?.name || 'Unknown'}</span>
                        {getNodeIcon(toNode?.type || 'operator')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Prosecution Footer */}
        <div className="text-xs text-muted-foreground border-t border-border pt-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span>
            <strong>DOJ Strategy:</strong> Establish KCSO as Tier 1 orchestrator, demonstrate ALF IX LLC and 
            Air Methods as shell conduits for surveillance enterprise, prosecute under 18 U.S.C. § 1962(c).
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}

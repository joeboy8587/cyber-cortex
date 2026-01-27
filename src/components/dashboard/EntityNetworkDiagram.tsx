import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Network, Building2, Plane, Shield, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface EntityNode {
  id: string;
  name: string;
  type: 'agency' | 'shell' | 'aircraft' | 'contractor' | 'medical';
  tier: number;
  assets?: string[];
  legalExposure?: string[];
  parentId?: string;
  detectionCount?: number;
}

interface NetworkLink {
  source: string;
  target: string;
  relationship: string;
}

export function EntityNetworkDiagram() {
  const [entities, setEntities] = useState<EntityNode[]>([]);
  const [links, setLinks] = useState<NetworkLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTier, setExpandedTier] = useState<number | null>(1);
  const [stats, setStats] = useState({
    totalEntities: 0,
    agencies: 0,
    shells: 0,
    aircraft: 0,
    ricoPatterns: 0
  });

  useEffect(() => {
    fetchNetworkData();
  }, []);

  const safeParseArray = (value: unknown): string[] => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      if (value.startsWith('{') && value.endsWith('}')) {
        return value.slice(1, -1).split(',').filter(Boolean);
      }
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const fetchNetworkData = async () => {
    try {
      const [enterpriseRes, shellRes, operatorRes, aircraftRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT id, entity_name, entity_type, tier, role, 
                     assets_controlled, legal_exposure, parent_entity_id
              FROM criminal_enterprise_command_structure 
              ORDER BY tier, entity_name
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT * FROM shell_companies LIMIT 50`
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT operator_name, operator_type, aircraft_count, total_detections 
              FROM operator_registry 
              WHERE aircraft_count > 0
              ORDER BY total_detections DESC NULLS LAST
              LIMIT 30
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT registration, COUNT(*) as detections
              FROM live_flight_detections_rows
              WHERE registration IN ('N912KC', 'N913KC', 'N790FA', 'N791FA', 'N788FA', 'N743AM', 'N229AM', 'N997SE')
              GROUP BY registration
              ORDER BY detections DESC
            `
          }
        })
      ]);

      const nodes: EntityNode[] = [];
      const networkLinks: NetworkLink[] = [];

      // Process enterprise command structure
      const enterpriseData = Array.isArray(enterpriseRes.data) ? enterpriseRes.data : [];
      enterpriseData.forEach((e: any) => {
        const assets = safeParseArray(e.assets_controlled);
        const exposure = safeParseArray(e.legal_exposure);
        
        nodes.push({
          id: e.id,
          name: e.entity_name,
          type: e.entity_type === 'SHELL_COMPANY' ? 'shell' : 
                e.entity_type === 'INSTITUTION' ? 'agency' : 'contractor',
          tier: e.tier || 3,
          assets,
          legalExposure: exposure,
          parentId: e.parent_entity_id
        });

        // Create links to parent
        if (e.parent_entity_id) {
          networkLinks.push({
            source: e.parent_entity_id,
            target: e.id,
            relationship: 'controls'
          });
        }

        // Create links to assets
        assets.forEach((asset: string) => {
          networkLinks.push({
            source: e.id,
            target: asset,
            relationship: 'operates'
          });
        });
      });

      // Process shell companies
      const shellData = Array.isArray(shellRes.data) ? shellRes.data : [];
      shellData.forEach((s: any) => {
        if (!nodes.find(n => n.name === s.company_name)) {
          nodes.push({
            id: s.id || s.company_name,
            name: s.company_name,
            type: 'shell',
            tier: 2,
            assets: safeParseArray(s.aircraft_controlled)
          });
        }
      });

      // Process aircraft with detection counts
      const aircraftData = Array.isArray(aircraftRes.data) ? aircraftRes.data : [];
      aircraftData.forEach((a: any) => {
        nodes.push({
          id: a.registration,
          name: a.registration,
          type: 'aircraft',
          tier: 3,
          detectionCount: parseInt(a.detections) || 0
        });
      });

      setEntities(nodes);
      setLinks(networkLinks);
      setStats({
        totalEntities: nodes.length,
        agencies: nodes.filter(n => n.type === 'agency').length,
        shells: nodes.filter(n => n.type === 'shell').length,
        aircraft: nodes.filter(n => n.type === 'aircraft').length,
        ricoPatterns: networkLinks.filter(l => l.relationship === 'controls').length
      });

    } catch (err) {
      console.error("Failed to fetch network data:", err);
    } finally {
      setLoading(false);
    }
  };

  const getTypeIcon = (type: EntityNode['type']) => {
    switch (type) {
      case 'agency': return <Shield className="w-4 h-4 text-red-400" />;
      case 'shell': return <Network className="w-4 h-4 text-orange-400" />;
      case 'aircraft': return <Plane className="w-4 h-4 text-secondary" />;
      case 'medical': return <Building2 className="w-4 h-4 text-purple-400" />;
      default: return <Building2 className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1: return 'border-red-500/50 bg-red-500/10';
      case 2: return 'border-orange-500/50 bg-orange-500/10';
      case 3: return 'border-yellow-500/50 bg-yellow-500/10';
      default: return 'border-border/50 bg-background/30';
    }
  };

  const getTierLabel = (tier: number) => {
    switch (tier) {
      case 1: return 'APEX COMMAND';
      case 2: return 'OPERATIONAL LAYER';
      case 3: return 'ASSET LAYER';
      default: return 'PERIPHERAL';
    }
  };

  const entitiesByTier = [1, 2, 3].map(tier => ({
    tier,
    entities: entities.filter(e => e.tier === tier)
  }));

  return (
    <CyberPanel 
      title="Entity Network Diagram" 
      icon={<Network className="w-5 h-5" />}
      variant="threat"
    >
      <div className="space-y-4">
        {/* RICO Header */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-bold text-red-300">18 U.S.C. § 1962 - RICO Enterprise Map</span>
          </div>
          <p className="text-xs text-red-300/80">
            Visual network mapping aircraft ownership through shell companies to law enforcement command.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-2">
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-primary">{stats.totalEntities}</div>
            <div className="text-[10px] text-muted-foreground">Entities</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-red-400">{stats.agencies}</div>
            <div className="text-[10px] text-muted-foreground">Agencies</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-orange-400">{stats.shells}</div>
            <div className="text-[10px] text-muted-foreground">Shells</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-secondary">{stats.aircraft}</div>
            <div className="text-[10px] text-muted-foreground">Aircraft</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-purple-400">{stats.ricoPatterns}</div>
            <div className="text-[10px] text-muted-foreground">Links</div>
          </div>
        </div>

        {/* Tiered Network Display */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Network className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Mapping enterprise network...
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {entitiesByTier.map(({ tier, entities: tierEntities }) => (
              <div key={tier} className={`rounded-lg border ${getTierColor(tier)}`}>
                <button
                  onClick={() => setExpandedTier(expandedTier === tier ? null : tier)}
                  className="w-full p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${
                      tier === 1 ? 'bg-red-500/20 text-red-400' :
                      tier === 2 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      TIER {tier}
                    </Badge>
                    <span className="text-sm font-medium">{getTierLabel(tier)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {tierEntities.length} entities
                    </Badge>
                    {expandedTier === tier ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {expandedTier === tier && (
                  <div className="p-2 pt-0 space-y-1">
                    {tierEntities.map((entity) => (
                      <div 
                        key={entity.id}
                        className="p-2 rounded bg-background/40 border border-border/30"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {getTypeIcon(entity.type)}
                            <span className="font-medium text-sm">{entity.name}</span>
                          </div>
                          {entity.detectionCount && (
                            <Badge className="text-[9px] bg-secondary/10 text-secondary">
                              {entity.detectionCount} detections
                            </Badge>
                          )}
                        </div>

                        {entity.assets && entity.assets.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            <Plane className="w-3 h-3 text-muted-foreground" />
                            {entity.assets.slice(0, 5).map((asset) => (
                              <Badge 
                                key={asset} 
                                variant="outline" 
                                className="text-[9px] text-secondary border-secondary/30"
                              >
                                {asset}
                              </Badge>
                            ))}
                            {entity.assets.length > 5 && (
                              <Badge variant="outline" className="text-[9px]">
                                +{entity.assets.length - 5} more
                              </Badge>
                            )}
                          </div>
                        )}

                        {entity.legalExposure && entity.legalExposure.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {entity.legalExposure.slice(0, 3).map((exposure, i) => (
                              <Badge 
                                key={i}
                                className="text-[8px] bg-destructive/10 text-destructive border border-destructive/30"
                              >
                                {String(exposure).replace(/_/g, ' ')}
                              </Badge>
                            ))}
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

        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          <strong>Network Legend:</strong> Tier 1 (Command) → Tier 2 (Shells/Operators) → Tier 3 (Aircraft Assets)
        </div>
      </div>
    </CyberPanel>
  );
}

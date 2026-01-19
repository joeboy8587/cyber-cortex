import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Building2, Plane, Users, Shield, DollarSign,
  Network, Loader2, ChevronRight, AlertTriangle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Entity {
  name: string;
  type: string;
  tier: number;
  connections: string[];
  role?: string;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
}

export const EntityRelationshipMap = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [stats, setStats] = useState({
    totalEntities: 0,
    shellCompanies: 0,
    aircraft: 0,
    lawEnforcement: 0,
    privateEquity: 0
  });

  useEffect(() => {
    loadEntityData();
  }, []);

  const loadEntityData = async () => {
    try {
      // Fetch enterprise entities, KCSO fleet, and Neon KCSO tables in parallel
      const [entitiesResponse, kcsoResponse, neonKcsoResult, shellResult, operatorResult] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `
              SELECT 
                entity_name, 
                entity_type, 
                tier,
                role,
                assets_controlled,
                legal_exposure,
                evidence_count,
                prosecution_priority
              FROM criminal_enterprise_command_structure 
              ORDER BY tier, entity_name
              LIMIT 50
            `
          }
        }),
        supabase.from('kcso_fleet').select('tail_number, model, frequent_oildale_operation'),
        // Query KCSO tables from Neon
        supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `
              SELECT cluster_id, aircraft_count, detection_count, location 
              FROM "KCSO_clusters" 
              LIMIT 100
            `
          }
        }),
        // Query shell companies
        supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `SELECT * FROM shell_companies LIMIT 50`
          }
        }),
        // Query operator registry
        supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `SELECT operator_name, operator_type, aircraft_count FROM operator_registry LIMIT 50`
          }
        })
      ]);
      
      // For edge functions, response is { data: result } where result is the array
      // For Supabase tables, response is { data: [...] }
      const unwrap = (res: any): any[] => {
        if (!res?.data) return [];
        if (Array.isArray(res.data)) return res.data;
        if (Array.isArray(res.data?.data)) return res.data.data;
        return [];
      };
      
      const rows = unwrap(entitiesResponse);
      const kcsoFleet = kcsoResponse?.data || [];
      const neonKcsoClusters = unwrap(neonKcsoResult);
      const shellCompanies = unwrap(shellResult);
      const operators = unwrap(operatorResult);
      
      // Parse entities from command structure
      const parsedEntities: Entity[] = rows.map((r: any) => ({
        name: r.entity_name || 'Unknown',
        type: r.entity_type || 'Unknown',
        tier: parseInt(r.tier) || 0,
        role: r.role,
        connections: []
      }));
      
      // Add KCSO fleet aircraft as Law Enforcement entities
      const kcsoAircraftEntities: Entity[] = kcsoFleet.map((aircraft: any) => ({
        name: `KCSO ${aircraft.tail_number}`,
        type: 'Law Enforcement Aircraft',
        tier: 2,
        role: aircraft.frequent_oildale_operation ? 'Oildale Operations' : 'Surveillance Asset',
        connections: ['KCSO', 'Kern County Sheriff']
      }));

      // Add KCSO as agency entity based on cluster data
      if (neonKcsoClusters.length > 0) {
        parsedEntities.push({
          name: 'Kern County Sheriff Office',
          type: 'Law Enforcement Agency',
          tier: 1,
          role: `${neonKcsoClusters.length} surveillance clusters documented`,
          connections: ['N912KC', 'N913KC']
        });
      }

      // Add shell companies from Neon
      const shellEntities: Entity[] = shellCompanies.map((s: any) => ({
        name: s.company_name || s.name || 'Unknown Shell',
        type: 'Shell Company',
        tier: 3,
        role: s.purpose || s.role || 'Asset Concealment',
        connections: []
      }));

      // Add operators from registry
      const operatorEntities: Entity[] = operators.slice(0, 10).map((o: any) => ({
        name: o.operator_name || 'Unknown Operator',
        type: o.operator_type || 'Aviation Operator',
        tier: 3,
        role: o.aircraft_count ? `${o.aircraft_count} aircraft` : 'Operator',
        connections: []
      }));
      
      // Merge all entities - avoid duplicates
      const seenNames = new Set<string>();
      const allEntities: Entity[] = [];
      
      for (const entity of [...parsedEntities, ...kcsoAircraftEntities, ...shellEntities, ...operatorEntities]) {
        const key = entity.name.toLowerCase();
        if (!seenNames.has(key)) {
          seenNames.add(key);
          allEntities.push(entity);
        }
      }
      
      // Calculate stats - check both name and type fields for accurate categorization
      const shellCount = allEntities.filter(e => {
        const name = e.name.toLowerCase();
        const type = e.type.toLowerCase();
        return type.includes('shell') || type.includes('llc') || type.includes('company') ||
               name.includes('llc') || name.includes('holdings') || name.includes('partners');
      }).length;
      
      const aircraftCount = allEntities.filter(e => {
        const name = e.name.toLowerCase();
        const type = e.type.toLowerCase();
        // Count aviation but NOT law enforcement aircraft (those go to lawCount)
        const isAviation = type.includes('aircraft') || type.includes('aviation') ||
               name.includes('aviation') || name.includes('air ') || name.includes('aero');
        const isLawEnforcement = type.includes('law enforcement') || name.includes('kcso');
        return isAviation && !isLawEnforcement;
      }).length;
      
      const lawCount = allEntities.filter(e => {
        const name = e.name.toLowerCase();
        const type = e.type.toLowerCase();
        return type.includes('law') || type.includes('sheriff') || type.includes('police') ||
               type.includes('enforcement') || type.includes('agency') ||
               name.includes('kcso') || name.includes('sheriff') || name.includes('police') ||
               name.includes('kern county') || name.includes('law enforcement') ||
               name.includes('n913kc') || name.includes('n912kv') || name.includes('n912kc');
      }).length;
      
      const peCount = allEntities.filter(e => {
        const name = e.name.toLowerCase();
        const type = e.type.toLowerCase();
        return type.includes('equity') || type.includes('investment') || type.includes('capital') ||
               name.includes('equity') || name.includes('capital') || name.includes('fund');
      }).length;
      
      setEntities(allEntities);
      setStats({
        totalEntities: allEntities.length,
        shellCompanies: shellCount,
        aircraft: aircraftCount,
        lawEnforcement: lawCount,
        privateEquity: peCount
      });
      
    } catch (error) {
      console.error('Entity load error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getEntityIcon = (type: string, name: string = '') => {
    const t = type.toLowerCase();
    const n = name.toLowerCase();
    if (t.includes('shell') || t.includes('llc') || t.includes('company') || n.includes('llc') || n.includes('holdings')) return <Building2 className="h-4 w-4" />;
    if (t.includes('aircraft') || t.includes('aviation') || n.includes('aviation')) return <Plane className="h-4 w-4" />;
    if (t.includes('law') || t.includes('sheriff') || t.includes('agency') || n.includes('kcso') || n.includes('sheriff') || n.includes('kern county')) return <Shield className="h-4 w-4" />;
    if (t.includes('equity') || t.includes('investment') || n.includes('capital') || n.includes('equity')) return <DollarSign className="h-4 w-4" />;
    return <Users className="h-4 w-4" />;
  };

  const getTierColor = (tier: number) => {
    switch (tier) {
      case 1: return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 2: return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 3: return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      default: return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    }
  };

  const groupedEntities = entities.reduce((acc, entity) => {
    const tier = entity.tier || 0;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(entity);
    return acc;
  }, {} as Record<number, Entity[]>);

  return (
    <CyberPanel 
      title="ENTITY NETWORK"
      headerActions={
        <Badge variant="outline" className="border-primary/30">
          <Network className="h-3 w-3 mr-1" />
          {stats.totalEntities} Entities
        </Badge>
      }
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : entities.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No entity network data found</p>
            <p className="text-sm mt-1">Entity relationships will appear here when documented</p>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                <div className="flex items-center gap-2 text-purple-400 mb-1">
                  <Building2 className="h-3 w-3" />
                  <span className="text-xs">Shell Companies</span>
                </div>
                <p className="text-xl font-bold text-purple-400">{stats.shellCompanies}</p>
              </div>
              
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="flex items-center gap-2 text-blue-400 mb-1">
                  <Plane className="h-3 w-3" />
                  <span className="text-xs">Aviation Entities</span>
                </div>
                <p className="text-xl font-bold text-blue-400">{stats.aircraft}</p>
              </div>
              
              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20">
                <div className="flex items-center gap-2 text-yellow-400 mb-1">
                  <Shield className="h-3 w-3" />
                  <span className="text-xs">Law Enforcement</span>
                </div>
                <p className="text-xl font-bold text-yellow-400">{stats.lawEnforcement}</p>
              </div>
              
              <div className="p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <div className="flex items-center gap-2 text-green-400 mb-1">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-xs">Private Equity</span>
                </div>
                <p className="text-xl font-bold text-green-400">{stats.privateEquity}</p>
              </div>
            </div>

            {/* Explanation */}
            <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
              <h4 className="font-semibold text-foreground mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-400" />
                What This Means
              </h4>
              <p className="text-sm text-muted-foreground">
                This diagram shows the organizational structure documented in your database. Entities are grouped 
                by "tier" - higher tiers represent more central or controlling positions in the network. 
                Shell companies often serve to obscure ownership and control of assets like aircraft.
              </p>
            </div>

            {/* Tiered Entity List */}
            <ScrollArea className="h-[400px]">
              <div className="space-y-4 pr-4">
                {Object.entries(groupedEntities)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([tier, tierEntities]) => (
                    <div key={tier} className="space-y-2">
                      <h4 className={`text-sm font-semibold px-3 py-1 rounded ${getTierColor(Number(tier))}`}>
                        Tier {tier} ({tierEntities.length} entities)
                      </h4>
                      <div className="space-y-2 ml-2">
                        {tierEntities.map((entity, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg border border-border/30"
                          >
                            <div className="text-muted-foreground">
                              {getEntityIcon(entity.type, entity.name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-foreground truncate">
                                {entity.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-xs">
                                  {entity.type}
                                </Badge>
                                {entity.role && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {entity.role}
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </CyberPanel>
  );
};

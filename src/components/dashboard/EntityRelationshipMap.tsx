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
      // Get enterprise entities
      const { data: entitiesData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              entity_name, 
              entity_type, 
              tier,
              role_in_network,
              controlled_assets,
              legal_exposure_rating
            FROM criminal_enterprise_entities 
            ORDER BY tier, entity_name
            LIMIT 50
          `
        }
      });
      
      const rows = entitiesData || [];
      
      // Parse entities
      const parsedEntities: Entity[] = rows.map((r: any) => ({
        name: r.entity_name || 'Unknown',
        type: r.entity_type || 'Unknown',
        tier: parseInt(r.tier) || 0,
        role: r.role_in_network,
        connections: []
      }));
      
      // Calculate stats
      const shellCount = parsedEntities.filter(e => 
        e.type.toLowerCase().includes('shell') || 
        e.type.toLowerCase().includes('llc') ||
        e.type.toLowerCase().includes('company')
      ).length;
      
      const aircraftCount = parsedEntities.filter(e => 
        e.type.toLowerCase().includes('aircraft') || 
        e.type.toLowerCase().includes('aviation')
      ).length;
      
      const lawCount = parsedEntities.filter(e => 
        e.type.toLowerCase().includes('law') || 
        e.type.toLowerCase().includes('sheriff') ||
        e.type.toLowerCase().includes('police')
      ).length;
      
      const peCount = parsedEntities.filter(e => 
        e.type.toLowerCase().includes('equity') || 
        e.type.toLowerCase().includes('investment') ||
        e.type.toLowerCase().includes('capital')
      ).length;
      
      setEntities(parsedEntities);
      setStats({
        totalEntities: parsedEntities.length,
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

  const getEntityIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('shell') || t.includes('llc') || t.includes('company')) return <Building2 className="h-4 w-4" />;
    if (t.includes('aircraft') || t.includes('aviation')) return <Plane className="h-4 w-4" />;
    if (t.includes('law') || t.includes('sheriff')) return <Shield className="h-4 w-4" />;
    if (t.includes('equity') || t.includes('investment')) return <DollarSign className="h-4 w-4" />;
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
                              {getEntityIcon(entity.type)}
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

import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Network, Building2, Plane, AlertTriangle, ChevronRight, Shield, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Helper to safely parse PostgreSQL arrays that may come as strings
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

interface EnterpriseEntity {
  id: string;
  entity_name: string;
  entity_type: string;
  role: string;
  tier: number;
  prosecution_priority: string;
  legal_exposure: string[];
  assets_controlled: string[] | null;
  notes: string | null;
  parent_entity_id: string | null;
}

export function CriminalEnterpriseNetwork() {
  const [entities, setEntities] = useState<EnterpriseEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    tier1: 0,
    tier2: 0,
    shellCompanies: 0,
    aircraftControlled: 0
  });

  useEffect(() => {
    fetchEnterpriseData();
  }, []);

  const fetchEnterpriseData = async () => {
    // Unwrap neon-query responses which may be array or { data: [...] }
    const unwrapRows = (payload: unknown): any[] => {
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object' && Array.isArray((payload as any).data)) return (payload as any).data;
      return [];
    };

    try {
      const { data: entityData, error: entityError } = await supabase.functions.invoke("neon-query", {
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
      if (entityError) throw entityError;

      const { data: statsData, error: statsError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              COUNT(*) as total,
              COUNT(*) FILTER (WHERE tier = 1) as tier1,
              COUNT(*) FILTER (WHERE tier = 2) as tier2,
              COUNT(*) FILTER (WHERE entity_type = 'SHELL_COMPANY') as shells
            FROM criminal_enterprise_command_structure
          `
        }
      });
      if (statsError) throw statsError;

      // entityData is { data: [...] } from supabase.functions.invoke, extract .data first
      const rawEntities = unwrapRows(entityData?.data);
      console.log('[CriminalEnterpriseNetwork] Raw entities:', rawEntities);
      
      if (Array.isArray(rawEntities) && rawEntities.length > 0) {
        // Parse arrays that may come as PostgreSQL array strings from the database
        const parsedEntities = rawEntities.map((e: any) => ({
          ...e,
          assets_controlled: safeParseArray(e.assets_controlled),
          legal_exposure: safeParseArray(e.legal_exposure)
        }));
        
        console.log('[CriminalEnterpriseNetwork] Parsed entities:', parsedEntities);
        setEntities(parsedEntities);
        
        // Count total controlled aircraft
        let aircraftCount = 0;
        parsedEntities.forEach((e: EnterpriseEntity) => {
          if (Array.isArray(e.assets_controlled)) {
            aircraftCount += e.assets_controlled.length;
          }
        });

        // statsData is { data: [...] } from supabase.functions.invoke
        const rawStats = unwrapRows(statsData?.data);
        const firstStat = rawStats[0] || null;
        
        setStats({
          total: Number(firstStat?.total) || parsedEntities.length,
          tier1: Number(firstStat?.tier1) || parsedEntities.filter((e: any) => e.tier === 1).length,
          tier2: Number(firstStat?.tier2) || parsedEntities.filter((e: any) => e.tier === 2).length,
          shellCompanies: Number(firstStat?.shells) || parsedEntities.filter((e: any) => e.entity_type === 'SHELL_COMPANY').length,
          aircraftControlled: aircraftCount
        });
      } else {
        console.warn('[CriminalEnterpriseNetwork] No entity data returned');
      }
    } catch (error) {
      console.error("[CriminalEnterpriseNetwork] Error fetching enterprise data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getTierBadge = (tier: number) => {
    const variants: Record<number, { color: string; label: string }> = {
      1: { color: "bg-red-500/20 text-red-400 border-red-500/30", label: "TIER 1" },
      2: { color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "TIER 2" },
      3: { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "TIER 3" }
    };
    const v = variants[tier] || variants[3];
    return <Badge className={`${v.color} text-[10px] border`}>{v.label}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, string> = {
      "CRITICAL": "bg-red-600/20 text-red-300 border-red-600/30",
      "HIGH": "bg-orange-500/20 text-orange-400 border-orange-500/30",
      "MEDIUM": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
    };
    return <Badge className={`${variants[priority] || variants["MEDIUM"]} text-[10px] border`}>{priority}</Badge>;
  };

  const getEntityIcon = (type: string) => {
    switch (type) {
      case "INSTITUTION": return <Building2 className="w-4 h-4 text-primary" />;
      case "SHELL_COMPANY": return <Network className="w-4 h-4 text-orange-400" />;
      default: return <Building2 className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <CyberPanel 
      title="Criminal Enterprise Network" 
      icon={<Network className="w-5 h-5" />}
      variant="threat"
    >
      <div className="space-y-4">
        {/* RICO Header */}
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="flex items-center gap-2 mb-1">
            <Scale className="w-4 h-4 text-red-400" />
            <span className="text-sm font-bold text-red-300">18 U.S.C. § 1962 - RICO Enterprise</span>
          </div>
          <p className="text-xs text-red-300/80">
            Documented command structure establishes coordinated criminal enterprise 
            engaged in stalking, surveillance, and human experimentation.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-5 gap-2">
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-primary">{stats.total}</div>
            <div className="text-[10px] text-muted-foreground">Entities</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-red-400">{stats.tier1}</div>
            <div className="text-[10px] text-muted-foreground">Tier 1</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-orange-400">{stats.tier2}</div>
            <div className="text-[10px] text-muted-foreground">Tier 2</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-yellow-400">{stats.shellCompanies}</div>
            <div className="text-[10px] text-muted-foreground">Shells</div>
          </div>
          <div className="p-2 rounded-lg bg-background/50 border border-border text-center">
            <div className="text-lg font-mono font-bold text-secondary">{stats.aircraftControlled}</div>
            <div className="text-[10px] text-muted-foreground">Aircraft</div>
          </div>
        </div>

        {/* Entity List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Network className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Mapping enterprise structure...
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {entities.map((entity) => (
              <div 
                key={entity.id}
                className={`p-3 rounded-lg border transition-colors ${
                  entity.tier === 1 
                    ? 'bg-red-500/5 border-red-500/30 hover:border-red-500/50' 
                    : 'bg-background/30 border-border/50 hover:border-primary/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getEntityIcon(entity.entity_type)}
                    <span className="font-medium text-sm">{entity.entity_name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {getTierBadge(entity.tier)}
                    {getPriorityBadge(entity.prosecution_priority)}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground mb-2">
                  <span className="text-foreground">{entity.role}</span>
                  {entity.entity_type === "SHELL_COMPANY" && (
                    <span className="ml-2 text-orange-400">[SHELL COMPANY]</span>
                  )}
                </div>

                {entity.assets_controlled && entity.assets_controlled.length > 0 && (
                  <div className="flex items-center gap-2 mb-2">
                    <Plane className="w-3 h-3 text-secondary" />
                    <div className="flex flex-wrap gap-1">
                      {entity.assets_controlled.map((asset) => (
                        <Badge key={asset} variant="outline" className="text-[10px] text-secondary border-secondary/30">
                          {asset}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1 mb-2">
                  {safeParseArray(entity.legal_exposure).map((exposure, i) => (
                    <Badge 
                      key={i} 
                      className="text-[9px] bg-destructive/10 text-destructive border border-destructive/30"
                    >
                      {String(exposure).replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>

                {entity.notes && (
                  <div className="text-[10px] text-muted-foreground italic border-t border-border/50 pt-2 mt-2">
                    {entity.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border pt-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <span>
            <strong>Prosecution Strategy:</strong> Target Tier 1 orchestrators first, 
            use shell company exposure to establish enterprise coordination.
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}

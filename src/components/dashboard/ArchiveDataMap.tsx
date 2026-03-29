import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Map, RefreshCw, Loader2, Plane, Heart, Link, Scale, Users } from "lucide-react";

interface DomainSource {
  table: string;
  exists: boolean;
  rowCount: number;
}

interface Domain {
  view: string;
  label: string;
  description: string;
  exists: boolean;
  rowCount: number;
  sources: DomainSource[];
}

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  mv_unified_flights: <Plane className="w-5 h-5" />,
  mv_unified_biometrics: <Heart className="w-5 h-5" />,
  mv_unified_correlations: <Link className="w-5 h-5" />,
  mv_unified_legal: <Scale className="w-5 h-5" />,
  mv_unified_entities: <Users className="w-5 h-5" />,
};

const DOMAIN_COLORS: Record<string, string> = {
  mv_unified_flights: "border-blue-500/50 bg-blue-500/5",
  mv_unified_biometrics: "border-rose-500/50 bg-rose-500/5",
  mv_unified_correlations: "border-amber-500/50 bg-amber-500/5",
  mv_unified_legal: "border-violet-500/50 bg-violet-500/5",
  mv_unified_entities: "border-emerald-500/50 bg-emerald-500/5",
};

const DOMAIN_ICON_COLORS: Record<string, string> = {
  mv_unified_flights: "text-blue-400",
  mv_unified_biometrics: "text-rose-400",
  mv_unified_correlations: "text-amber-400",
  mv_unified_legal: "text-violet-400",
  mv_unified_entities: "text-emerald-400",
};

// Define cross-domain connections
const CONNECTIONS = [
  { from: "mv_unified_flights", to: "mv_unified_biometrics", label: "Timestamp Correlation" },
  { from: "mv_unified_flights", to: "mv_unified_correlations", label: "Flight-Evidence Links" },
  { from: "mv_unified_biometrics", to: "mv_unified_correlations", label: "Bio-Event Links" },
  { from: "mv_unified_correlations", to: "mv_unified_legal", label: "Evidence Chain" },
  { from: "mv_unified_entities", to: "mv_unified_flights", label: "Aircraft Registry" },
  { from: "mv_unified_entities", to: "mv_unified_legal", label: "Actors & Violations" },
];

export function ArchiveDataMap() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);

  const fetchMap = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-consolidation", {
        body: { action: "getDomainMap" }
      });
      if (error) throw error;
      setDomains(data?.data?.domains || []);
    } catch (e) {
      console.error("Failed to load data map:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchMap(); }, []);

  const totalRecords = domains.reduce((sum, d) => sum + d.sources.reduce((s, src) => s + src.rowCount, 0), 0);
  const totalSources = domains.reduce((sum, d) => sum + d.sources.filter(s => s.exists).length, 0);
  const consolidatedRecords = domains.reduce((sum, d) => sum + d.rowCount, 0);

  return (
    <CyberPanel
      title="Archive Data Map"
      icon={<Map className="w-4 h-4" />}
      headerActions={
        <Button size="sm" variant="outline" onClick={fetchMap} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Refresh Map
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded bg-card border border-border text-center">
            <div className="text-xl font-bold text-primary">{totalSources}</div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Source Tables</div>
          </div>
          <div className="p-3 rounded bg-card border border-border text-center">
            <div className="text-xl font-bold text-primary">{totalRecords.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Raw Records</div>
          </div>
          <div className="p-3 rounded bg-card border border-border text-center">
            <div className="text-xl font-bold text-primary">{consolidatedRecords.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground font-mono uppercase">Consolidated</div>
          </div>
        </div>

        {/* Domain Cluster Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {domains.map((d) => {
            const isExpanded = expandedDomain === d.view;
            const sourceRecords = d.sources.reduce((s, src) => s + src.rowCount, 0);
            return (
              <div
                key={d.view}
                className={`p-3 rounded-lg border-2 cursor-pointer transition-all hover:shadow-md ${DOMAIN_COLORS[d.view] || "border-border bg-card"}`}
                onClick={() => setExpandedDomain(isExpanded ? null : d.view)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={DOMAIN_ICON_COLORS[d.view] || "text-primary"}>
                    {DOMAIN_ICONS[d.view]}
                  </span>
                  <span className="text-sm font-bold text-foreground">{d.label}</span>
                  {d.exists ? (
                    <Badge variant="default" className="ml-auto text-[9px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">LIVE</Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-auto text-[9px]">PENDING</Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mb-2">{d.description}</p>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-primary font-bold">{sourceRecords.toLocaleString()}</span>
                  <span className="text-muted-foreground">records</span>
                  <span className="text-muted-foreground">•</span>
                  <span>{d.sources.filter(s => s.exists).length} tables</span>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
                    {d.sources.map((src) => (
                      <div key={src.table} className="flex items-center justify-between text-[10px] font-mono">
                        <span className={src.exists ? "text-foreground" : "text-muted-foreground line-through"}>
                          {src.table}
                        </span>
                        <span className="text-primary">{src.exists ? src.rowCount.toLocaleString() : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Cross-Domain Connections */}
        <div className="p-3 rounded border border-border bg-card">
          <div className="text-xs font-mono uppercase text-muted-foreground mb-2">Cross-Domain Connections</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {CONNECTIONS.map((c, i) => {
              const fromDomain = domains.find(d => d.view === c.from);
              const toDomain = domains.find(d => d.view === c.to);
              return (
                <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className={`font-bold ${DOMAIN_ICON_COLORS[c.from] || "text-primary"}`}>
                    {fromDomain?.label?.split(" ")[1] || "?"}
                  </span>
                  <span className="text-muted-foreground">⟷</span>
                  <span className={`font-bold ${DOMAIN_ICON_COLORS[c.to] || "text-primary"}`}>
                    {toDomain?.label?.split(" ")[1] || "?"}
                  </span>
                  <span className="text-muted-foreground ml-1">{c.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {domains.length === 0 && !loading && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            Loading domain map...
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Loader2, RefreshCw, Search, ArrowRight, Database, GitBranch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Relationship {
  id: number;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  join_key_type: string;
  domain: string;
  confidence: string;
}

interface DomainSummary {
  domain: string;
  join_key_type: string;
  cnt: number;
}

const DOMAIN_COLORS: Record<string, string> = {
  flight: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  biometric_flight: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  legal: "bg-red-500/20 text-red-400 border-red-500/30",
  registry: "bg-green-500/20 text-green-400 border-green-500/30",
  kcso: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  entity: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  forensic: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

export function RelationshipExplorer() {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [summary, setSummary] = useState<DomainSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [filterDomain, setFilterDomain] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchRelationships = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "getRelationships", domain: filterDomain || undefined },
      });
      if (error) throw error;
      setRelationships(data?.relationships || []);
      setSummary(data?.summary || []);
      setTotal(data?.total || 0);
    } catch (e) {
      console.error(e);
      toast.error("Could not load relationships. Build them first.");
    } finally {
      setLoading(false);
    }
  }, [filterDomain]);

  useEffect(() => { fetchRelationships(); }, [fetchRelationships]);

  const handleBuild = async () => {
    setBuilding(true);
    toast.info("Scanning all tables and mapping relationships...");
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "buildRelationships" },
      });
      if (error) throw error;
      toast.success(`Mapped ${data?.totalLinks || 0} relationships across all tables`);
      fetchRelationships();
    } catch (e) {
      console.error(e);
      toast.error("Failed to build relationships");
    } finally {
      setBuilding(false);
    }
  };

  const filtered = relationships.filter(
    (r) =>
      !searchTerm ||
      r.source_table.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.target_table.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const domains = [...new Set(summary.map((s) => s.domain))];

  return (
    <div className="space-y-4">
      {/* Summary */}
      <CyberPanel title="Database Relationship Registry" icon={<Network className="w-4 h-4" />}
        headerActions={
          <Button size="sm" variant="outline" onClick={handleBuild} disabled={building}>
            {building ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            {building ? "Scanning..." : "Build Relationships"}
          </Button>
        }
      >
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">{total}</div>
              <div className="text-xs text-muted-foreground">Total Links</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">{domains.length}</div>
              <div className="text-xs text-muted-foreground">Domains</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">
                {new Set(relationships.map((r) => r.source_table)).size}
              </div>
              <div className="text-xs text-muted-foreground">Source Tables</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">
                {new Set(relationships.map((r) => r.target_table)).size}
              </div>
              <div className="text-xs text-muted-foreground">Target Hubs</div>
            </div>
          </div>

          {/* Domain breakdown */}
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge
              variant="outline"
              className={`cursor-pointer ${!filterDomain ? "bg-primary/20 border-primary" : ""}`}
              onClick={() => setFilterDomain("")}
            >
              All
            </Badge>
            {domains.map((d) => (
              <Badge
                key={d}
                variant="outline"
                className={`cursor-pointer ${DOMAIN_COLORS[d] || ""} ${filterDomain === d ? "ring-1 ring-primary" : ""}`}
                onClick={() => setFilterDomain(d === filterDomain ? "" : d)}
              >
                {d} ({summary.filter((s) => s.domain === d).reduce((a, s) => a + s.cnt, 0)})
              </Badge>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-2">
            This registry maps how your 556+ tables connect via shared columns (registration, callsign, hex codes, case IDs, etc.)
            Click "Build Relationships" to scan and auto-detect all connections.
          </p>
        </div>
      </CyberPanel>

      {/* Relationship list */}
      <CyberPanel title={`Mapped Relationships (${filtered.length})`} icon={<GitBranch className="w-4 h-4" />}>
        <div className="p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search tables..."
              className="w-full bg-muted/50 border border-border rounded pl-10 pr-4 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary mr-2" />
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {total === 0 ? 'No relationships built yet. Click "Build Relationships" to start.' : "No results match your filter."}
            </div>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-auto">
              {filtered.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 p-2 rounded bg-muted/20 border border-border hover:border-primary/30 transition-colors"
                >
                  <Database className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs text-foreground truncate max-w-[180px]">{r.source_table}</span>
                  <span className="text-xs text-muted-foreground">.{r.source_column}</span>
                  <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                  <span className="font-mono text-xs text-primary truncate max-w-[180px]">{r.target_table}</span>
                  <span className="text-xs text-muted-foreground">.{r.target_column}</span>
                  <Badge variant="outline" className={`ml-auto text-[10px] ${DOMAIN_COLORS[r.domain] || ""}`}>
                    {r.join_key_type}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CyberPanel>
    </div>
  );
}

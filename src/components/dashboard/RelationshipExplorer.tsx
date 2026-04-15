import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Network, Loader2, RefreshCw, Search, ArrowRight, Database, GitBranch, Link, Unlink, Eye, CheckCircle2, AlertTriangle } from "lucide-react";
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
  relationship_type: string;
}

interface DomainSummary {
  domain: string;
  join_key_type: string;
  cnt: number;
}

interface FKPreview {
  sourceRows: number;
  orphanRows: number;
  targetUnique: number;
  targetTotal: number;
  isTargetUnique: boolean;
}

interface ExistingFK {
  constraint_name: string;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
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
  const [existingFKs, setExistingFKs] = useState<ExistingFK[]>([]);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<FKPreview | null>(null);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [tab, setTab] = useState<'mapped' | 'applied'>('mapped');

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

  const fetchExistingFKs = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "getExistingFKs" },
      });
      if (!error && Array.isArray(data)) setExistingFKs(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchRelationships(); fetchExistingFKs(); }, [fetchRelationships, fetchExistingFKs]);

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

  const handlePreview = async (r: Relationship) => {
    setPreviewingId(r.id);
    setPreview(null);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "previewForeignKey",
          sourceTable: r.source_table, sourceColumn: r.source_column,
          targetTable: r.target_table, targetColumn: r.target_column,
        },
      });
      if (error) throw error;
      setPreview(data);
    } catch (e: any) {
      toast.error(`Preview failed: ${e?.message || 'Unknown error'}`);
      setPreviewingId(null);
    }
  };

  const handleApplyFK = async (r: Relationship) => {
    setApplyingId(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "applyForeignKey",
          sourceTable: r.source_table, sourceColumn: r.source_column,
          targetTable: r.target_table, targetColumn: r.target_column,
        },
      });
      if (error) throw error;
      toast.success(data?.message || "Foreign key created!");
      if (data?.orphansCleaned > 0) {
        toast.info(`Cleaned ${data.orphansCleaned} orphaned rows (set to NULL)`);
      }
      setPreviewingId(null);
      setPreview(null);
      fetchRelationships();
      fetchExistingFKs();
    } catch (e: any) {
      toast.error(`FK creation failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setApplyingId(null);
    }
  };

  const handleRemoveFK = async (fk: ExistingFK) => {
    try {
      const { error } = await supabase.functions.invoke("neon-query", {
        body: { action: "removeForeignKey", constraintName: fk.constraint_name, tableName: fk.source_table },
      });
      if (error) throw error;
      toast.success(`Removed FK ${fk.constraint_name}`);
      fetchExistingFKs();
    } catch (e: any) {
      toast.error(`Remove failed: ${e?.message || 'Unknown'}`);
    }
  };

  const isAlreadyFK = (r: Relationship) =>
    existingFKs.some(fk => fk.source_table === r.source_table && fk.source_column === r.source_column && fk.target_table === r.target_table);

  const filtered = relationships.filter(
    (r) =>
      !searchTerm ||
      r.source_table.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.target_table.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const domains = [...new Set(summary.map((s) => s.domain))];

  return (
    <div className="space-y-4">
      <CyberPanel title="Database Relationship Registry" icon={<Network className="w-4 h-4" />}
        headerActions={
          <Button size="sm" variant="outline" onClick={handleBuild} disabled={building}>
            {building ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            {building ? "Scanning..." : "Build Relationships"}
          </Button>
        }
      >
        <div className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-primary">{total}</div>
              <div className="text-xs text-muted-foreground">Mapped Links</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-500">{existingFKs.length}</div>
              <div className="text-xs text-muted-foreground">Active FKs</div>
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

          <div className="flex flex-wrap gap-2 mb-4">
            <Badge variant="outline" className={`cursor-pointer ${!filterDomain ? "bg-primary/20 border-primary" : ""}`} onClick={() => setFilterDomain("")}>All</Badge>
            {domains.map((d) => (
              <Badge key={d} variant="outline" className={`cursor-pointer ${DOMAIN_COLORS[d] || ""} ${filterDomain === d ? "ring-1 ring-primary" : ""}`}
                onClick={() => setFilterDomain(d === filterDomain ? "" : d)}
              >
                {d} ({summary.filter((s) => s.domain === d).reduce((a, s) => a + s.cnt, 0)})
              </Badge>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            Scan detects shared columns across 556+ tables. Use <strong>Preview</strong> to check data compatibility, then <strong>Apply FK</strong> to create real foreign key constraints in the database.
          </p>
        </div>
      </CyberPanel>

      {/* Tab selector */}
      <div className="flex gap-2">
        <Button size="sm" variant={tab === 'mapped' ? 'default' : 'outline'} onClick={() => setTab('mapped')}>
          <GitBranch className="w-3 h-3 mr-1" /> Mapped ({filtered.length})
        </Button>
        <Button size="sm" variant={tab === 'applied' ? 'default' : 'outline'} onClick={() => setTab('applied')}>
          <Link className="w-3 h-3 mr-1" /> Applied FKs ({existingFKs.length})
        </Button>
      </div>

      {tab === 'mapped' && (
        <CyberPanel title={`Mapped Relationships (${filtered.length})`} icon={<GitBranch className="w-4 h-4" />}>
          <div className="p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search tables..." className="w-full bg-muted/50 border border-border rounded pl-10 pr-4 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
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
                {filtered.map((r) => {
                  const applied = isAlreadyFK(r);
                  const isPreviewing = previewingId === r.id;
                  return (
                    <div key={r.id}>
                      <div className={`flex items-center gap-2 p-2 rounded border transition-colors ${applied ? 'bg-green-500/10 border-green-500/30' : 'bg-muted/20 border-border hover:border-primary/30'}`}>
                        <Database className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-foreground truncate max-w-[160px]">{r.source_table}</span>
                        <span className="text-xs text-muted-foreground">.{r.source_column}</span>
                        <ArrowRight className="w-3 h-3 text-primary shrink-0" />
                        <span className="font-mono text-xs text-primary truncate max-w-[160px]">{r.target_table}</span>
                        <span className="text-xs text-muted-foreground">.{r.target_column}</span>
                        <Badge variant="outline" className={`text-[10px] ${DOMAIN_COLORS[r.domain] || ""}`}>{r.join_key_type}</Badge>
                        
                        <div className="ml-auto flex items-center gap-1">
                          {applied ? (
                            <Badge className="bg-green-600 text-white text-[10px] gap-1"><CheckCircle2 className="w-3 h-3" /> FK Active</Badge>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => isPreviewing ? (setPreviewingId(null), setPreview(null)) : handlePreview(r)}>
                                <Eye className="w-3 h-3 mr-1" /> {isPreviewing ? 'Close' : 'Preview'}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Preview panel */}
                      {isPreviewing && preview && (
                        <div className="ml-6 p-3 rounded border border-primary/30 bg-primary/5 space-y-2 text-xs">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <div><span className="text-muted-foreground">Source rows:</span> <strong>{preview.sourceRows.toLocaleString()}</strong></div>
                            <div>
                              <span className="text-muted-foreground">Orphans:</span>{' '}
                              <strong className={preview.orphanRows > 0 ? 'text-orange-400' : 'text-green-400'}>
                                {preview.orphanRows.toLocaleString()}
                              </strong>
                            </div>
                            <div><span className="text-muted-foreground">Target unique:</span> <strong>{preview.targetUnique.toLocaleString()}</strong></div>
                            <div>
                              <span className="text-muted-foreground">Target unique?</span>{' '}
                              {preview.isTargetUnique ? <CheckCircle2 className="w-3 h-3 inline text-green-400" /> : <AlertTriangle className="w-3 h-3 inline text-orange-400" />}
                            </div>
                          </div>
                          {preview.orphanRows > 0 && (
                            <p className="text-orange-400">⚠ {preview.orphanRows} orphaned rows will be set to NULL when FK is applied.</p>
                          )}
                          {!preview.isTargetUnique && (
                            <p className="text-orange-400">⚠ Target column has duplicates — a unique index will be attempted.</p>
                          )}
                          <Button size="sm" onClick={() => handleApplyFK(r)} disabled={applyingId === r.id} className="bg-green-600 hover:bg-green-700 text-white">
                            {applyingId === r.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Link className="w-3 h-3 mr-1" />}
                            Apply Foreign Key
                          </Button>
                        </div>
                      )}
                      {isPreviewing && !preview && (
                        <div className="ml-6 p-3 text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="w-3 h-3 animate-spin" /> Analyzing data compatibility...
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CyberPanel>
      )}

      {tab === 'applied' && (
        <CyberPanel title={`Active Foreign Keys (${existingFKs.length})`} icon={<Link className="w-4 h-4 text-green-500" />}>
          <div className="p-4">
            {existingFKs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No foreign keys applied yet. Use the Mapped tab to preview and apply.</div>
            ) : (
              <div className="space-y-1 max-h-[500px] overflow-auto">
                {existingFKs.map((fk) => (
                  <div key={fk.constraint_name} className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/30">
                    <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                    <span className="font-mono text-xs truncate max-w-[160px]">{fk.source_table}</span>
                    <span className="text-xs text-muted-foreground">.{fk.source_column}</span>
                    <ArrowRight className="w-3 h-3 text-green-500 shrink-0" />
                    <span className="font-mono text-xs text-green-400 truncate max-w-[160px]">{fk.target_table}</span>
                    <span className="text-xs text-muted-foreground">.{fk.target_column}</span>
                    <Badge className="ml-auto text-[10px] bg-green-600 text-white">{fk.constraint_name}</Badge>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-destructive hover:text-destructive" onClick={() => handleRemoveFK(fk)}>
                      <Unlink className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CyberPanel>
      )}
    </div>
  );
}

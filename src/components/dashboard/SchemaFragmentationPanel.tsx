import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  Database, RefreshCw, AlertTriangle, CheckCircle2, Layers,
  Trash2, GitMerge, Search
} from "lucide-react";

interface ClusterResult {
  cluster: string;
  table_count: number;
  total_rows: number;
  total_size_bytes: number;
  fragmentation_score: number;
  canonical_table: string;
  empty_tables: string[];
  duplicate_pairs: Array<{ a: string; b: string; jaccard: number }>;
  tables: Array<{
    table_name: string;
    row_count: number;
    columns: string[];
    empty: boolean;
    stale: boolean;
  }>;
}

interface AnalysisResult {
  summary: {
    total_tables: number;
    empty_tables: number;
    total_rows: number;
    clustered_tables: number;
    unclustered_tables: number;
    avg_fragmentation_score: number;
    cluster_count: number;
  };
  clusters: ClusterResult[];
  join_keys: Record<string, string[]>;
  unclustered: string[];
}

function fragColor(score: number) {
  if (score >= 70) return "text-destructive";
  if (score >= 40) return "text-warning";
  return "text-success";
}

function fragBadge(score: number) {
  if (score >= 70) return "destructive" as const;
  if (score >= 40) return "outline" as const;
  return "secondary" as const;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function SchemaFragmentationPanel() {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: result, error: err } = await supabase.functions.invoke("neon-query", {
        body: { action: "schemaFragmentationAnalysis" },
      });
      if (err) throw err;
      setData(result);
    } catch (e: any) {
      setError(e.message || "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const allEmptyTables = data
    ? data.clusters.flatMap((c) => c.empty_tables)
    : [];

  const highFragClusters = data
    ? data.clusters.filter((c) => c.fragmentation_score >= 50)
    : [];

  return (
    <CyberPanel
      title="Schema Fragmentation Analyzer"
      icon={<Layers className="w-4 h-4" />}
      headerActions={
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={runAnalysis}
          disabled={loading}
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          {data ? "Re-Scan" : "Run Analysis"}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {!data && !loading && !error && (
          <div className="text-center py-8 space-y-3">
            <Database className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Scan 900+ tables to identify fragmentation, duplicates, and consolidation targets.
            </p>
            <Button onClick={runAnalysis} size="sm">
              <Search className="w-3 h-3 mr-1" />
              Run Fragmentation Analysis
            </Button>
          </div>
        )}

        {loading && (
          <div className="space-y-2 py-4">
            <p className="text-xs text-muted-foreground text-center">
              Analyzing schema across all tables...
            </p>
            <Progress value={45} className="h-2" />
          </div>
        )}

        {error && (
          <div className="p-3 bg-destructive/10 rounded text-destructive text-xs">
            <AlertTriangle className="w-4 h-4 inline mr-1" />
            {error}
          </div>
        )}

        {data && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-primary/10 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-primary">
                  {data.summary.total_tables.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">Total Tables</div>
              </div>
              <div className="bg-destructive/10 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-destructive">
                  {data.summary.empty_tables}
                </div>
                <div className="text-[10px] text-muted-foreground">Empty Tables</div>
              </div>
              <div className="bg-warning/10 rounded-lg p-3 text-center">
                <div className={`text-xl font-bold ${fragColor(data.summary.avg_fragmentation_score)}`}>
                  {data.summary.avg_fragmentation_score}%
                </div>
                <div className="text-[10px] text-muted-foreground">Avg Fragmentation</div>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-foreground">
                  {data.summary.cluster_count}
                </div>
                <div className="text-[10px] text-muted-foreground">Domain Clusters</div>
              </div>
            </div>

            <Tabs defaultValue="clusters">
              <TabsList className="w-full grid grid-cols-4 h-8">
                <TabsTrigger value="clusters" className="text-xs">Clusters</TabsTrigger>
                <TabsTrigger value="empty" className="text-xs">
                  Empty ({allEmptyTables.length})
                </TabsTrigger>
                <TabsTrigger value="duplicates" className="text-xs">Duplicates</TabsTrigger>
                <TabsTrigger value="joinkeys" className="text-xs">Join Keys</TabsTrigger>
              </TabsList>

              {/* Clusters Tab */}
              <TabsContent value="clusters">
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {data.clusters.map((cluster) => (
                      <div
                        key={cluster.cluster}
                        className="border border-border rounded-lg p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold">{cluster.cluster}</span>
                            <Badge variant={fragBadge(cluster.fragmentation_score)}>
                              {cluster.fragmentation_score}% frag
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {cluster.table_count} tables · {cluster.total_rows.toLocaleString()} rows · {formatBytes(cluster.total_size_bytes)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 text-[10px]">
                          <CheckCircle2 className="w-3 h-3 text-success" />
                          <span className="text-muted-foreground">Canonical:</span>
                          <span className="font-mono text-success">{cluster.canonical_table}</span>
                          <span className="text-muted-foreground ml-1">
                            ({(cluster.tables.find(t => t.table_name === cluster.canonical_table)?.row_count || 0).toLocaleString()} rows)
                          </span>
                        </div>

                        {cluster.empty_tables.length > 0 && (
                          <div className="flex items-start gap-1 text-[10px]">
                            <Trash2 className="w-3 h-3 text-destructive mt-0.5" />
                            <span className="text-destructive">
                              {cluster.empty_tables.length} empty: {cluster.empty_tables.slice(0, 5).join(", ")}
                              {cluster.empty_tables.length > 5 && ` +${cluster.empty_tables.length - 5} more`}
                            </span>
                          </div>
                        )}

                        {cluster.duplicate_pairs.length > 0 && (
                          <div className="flex items-start gap-1 text-[10px]">
                            <GitMerge className="w-3 h-3 text-warning mt-0.5" />
                            <span className="text-warning">
                              {cluster.duplicate_pairs.length} similar pairs (top: {cluster.duplicate_pairs[0].a} ↔ {cluster.duplicate_pairs[0].b} @ {Math.round(cluster.duplicate_pairs[0].jaccard * 100)}%)
                            </span>
                          </div>
                        )}

                        {/* Table list (collapsed by default, show first 5) */}
                        <details className="text-[10px]">
                          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            Show all {cluster.table_count} tables
                          </summary>
                          <div className="mt-1 space-y-0.5 pl-2">
                            {cluster.tables
                              .sort((a, b) => b.row_count - a.row_count)
                              .map((t) => (
                                <div key={t.table_name} className="flex items-center justify-between font-mono">
                                  <span className={t.empty ? "text-muted-foreground line-through" : ""}>
                                    {t.table_name}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    {t.stale && <span className="text-warning">⚠</span>}
                                    <span className={t.row_count > 0 ? "text-foreground" : "text-muted-foreground"}>
                                      {t.row_count.toLocaleString()}
                                    </span>
                                  </span>
                                </div>
                              ))}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Empty Tables Tab */}
              <TabsContent value="empty">
                <ScrollArea className="h-[500px]">
                  {allEmptyTables.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No empty tables found.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground mb-2">
                        These tables have 0 rows and may be candidates for removal:
                      </p>
                      {allEmptyTables.map((t) => (
                        <div key={t} className="flex items-center justify-between p-1.5 rounded hover:bg-muted/30 text-xs font-mono">
                          <span>{t}</span>
                          <Badge variant="outline" className="text-[10px]">EMPTY</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              {/* Duplicates Tab */}
              <TabsContent value="duplicates">
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Table pairs with ≥30% column overlap (Jaccard similarity):
                    </p>
                    {data.clusters
                      .filter((c) => c.duplicate_pairs.length > 0)
                      .map((c) => (
                        <div key={c.cluster} className="space-y-1">
                          <div className="text-xs font-bold text-primary">{c.cluster}</div>
                          {c.duplicate_pairs.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[10px] font-mono p-1 rounded hover:bg-muted/30">
                              <span>{p.a} ↔ {p.b}</span>
                              <Badge
                                variant={p.jaccard >= 0.7 ? "destructive" : p.jaccard >= 0.5 ? "outline" : "secondary"}
                              >
                                {Math.round(p.jaccard * 100)}% overlap
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ))}
                    {data.clusters.every((c) => c.duplicate_pairs.length === 0) && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No significant schema overlaps detected.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Join Keys Tab */}
              <TabsContent value="joinkeys">
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Common join keys and which tables contain them:
                    </p>
                    {Object.entries(data.join_keys)
                      .sort((a, b) => b[1].length - a[1].length)
                      .map(([key, tables]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-primary">{key}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {tables.length} tables
                            </Badge>
                          </div>
                          <div className="pl-3 text-[10px] font-mono text-muted-foreground">
                            {tables.slice(0, 15).join(", ")}
                            {tables.length > 15 && ` +${tables.length - 15} more`}
                          </div>
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>

            {/* High Fragmentation Alert */}
            {highFragClusters.length > 0 && (
              <div className="p-3 bg-warning/10 border border-warning/30 rounded text-xs space-y-1">
                <div className="flex items-center gap-1 font-bold text-warning">
                  <AlertTriangle className="w-3 h-3" />
                  High Fragmentation Detected
                </div>
                <p className="text-muted-foreground">
                  {highFragClusters.length} domain(s) show significant fragmentation:{" "}
                  {highFragClusters.map((c) => `${c.cluster} (${c.table_count} tables)`).join(", ")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </CyberPanel>
  );
}

import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  Database, Activity, AlertTriangle, CheckCircle2, RefreshCw,
  Ghost, ShieldAlert, Plane, Heart, Clock, HardDrive, Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

type TableRow = {
  table_name: string;
  row_estimate: number;
  total_bytes: number;
  column_count: number;
  freshness: { ts_col: string; latest: string | null; last_24h: number; last_7d: number } | null;
};
type Report = {
  generated_at: string;
  summary: { total_tables: number; tables_with_24h_activity: number; total_bytes: number };
  tables: TableRow[];
  top_active_24h: { table: string; last_24h: number; latest: string }[];
  pipeline: Record<string, any>;
  new_tables: { tablename: string }[];
};

function fmtBytes(b: number): string {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function fmtNum(n: number): string {
  return new Intl.NumberFormat().format(n || 0);
}
function pipelineNum(p: any, key = "n"): string {
  if (!p || p.error) return "—";
  return fmtNum(Number(p[key] ?? 0));
}

export default function NeonDataHealth() {
  const { toast } = useToast();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("neon-data-health");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setReport(data);
      toast({ title: "Data Health refreshed", description: `${data.summary?.total_tables} tables inventoried` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      toast({ title: "Refresh failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, []);

  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `${ts}_NEON_DATA_HEALTH.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const p = report?.pipeline ?? {};
  const enrichPct = p.faa_enrichment_coverage && !p.faa_enrichment_coverage.error
    ? Math.round((p.faa_enrichment_coverage.enriched_tails / Math.max(1, p.faa_enrichment_coverage.total_tails)) * 100)
    : 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-display tracking-wider text-primary">NEON DATA HEALTH</h1>
            <p className="text-sm text-muted-foreground mt-1 font-mono">
              COMPREHENSIVE INVENTORY // FRESHNESS // PIPELINE COVERAGE
            </p>
            {report && (
              <p className="text-xs text-muted-foreground mt-1">
                Generated {formatDistanceToNow(new Date(report.generated_at))} ago
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {report && (
              <Button variant="outline" size="sm" onClick={exportJson}>
                <Download className="w-4 h-4 mr-1" /> Export JSON
              </Button>
            )}
            <Button onClick={fetchReport} disabled={loading} size="sm">
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Scanning…" : "Refresh"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-4 border border-destructive/40 bg-destructive/10 rounded text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 inline mr-2" />{error}
          </div>
        )}

        {!report && loading && (
          <div className="text-center py-20 text-muted-foreground text-sm">
            Inventorying Neon database…
          </div>
        )}

        {report && (
          <>
            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Tables" value={fmtNum(report.summary.total_tables)} icon={<Database className="w-4 h-4" />} />
              <StatCard label="Active (24h)" value={fmtNum(report.summary.tables_with_24h_activity)} icon={<Activity className="w-4 h-4" />} variant="success" />
              <StatCard label="Total Size" value={fmtBytes(report.summary.total_bytes)} icon={<HardDrive className="w-4 h-4" />} />
              <StatCard label="FAA Coverage" value={`${enrichPct}%`} icon={<Plane className="w-4 h-4" />} variant={enrichPct > 80 ? "success" : "warning"} />
            </div>

            <Tabs defaultValue="pipeline">
              <TabsList>
                <TabsTrigger value="pipeline">Pipeline Coverage</TabsTrigger>
                <TabsTrigger value="active">Active Tables</TabsTrigger>
                <TabsTrigger value="all">All Tables ({report.tables.length})</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="pipeline" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <PipeCard
                    icon={<Plane className="w-4 h-4" />}
                    title="Live Detections"
                    rows={[
                      ["Last 24h", pipelineNum(p.live_detections_24h)],
                      ["Last 7d", pipelineNum(p.live_detections_7d)],
                    ]}
                  />
                  <PipeCard
                    icon={<Database className="w-4 h-4" />}
                    title="FAA Registry"
                    rows={[
                      ["Total rows", pipelineNum(p.faa_registry_total)],
                      ["Tails enriched (30d)", `${fmtNum(p.faa_enrichment_coverage?.enriched_tails || 0)} / ${fmtNum(p.faa_enrichment_coverage?.total_tails || 0)}`],
                      ["Coverage", `${enrichPct}%`],
                    ]}
                    status={enrichPct > 80 ? "success" : "warning"}
                  />
                  <PipeCard
                    icon={<ShieldAlert className="w-4 h-4" />}
                    title="Quarantine"
                    rows={[
                      ["Total", pipelineNum(p.icao_quarantine_total)],
                      ["Last 7d", pipelineNum(p.icao_quarantine_total, "last_7d")],
                    ]}
                    status="warning"
                  />
                  <PipeCard
                    icon={<Ghost className="w-4 h-4" />}
                    title="Ghost Fleet"
                    rows={[["Active ICAOs", pipelineNum(p.ghost_fleet_active)]]}
                    status="destructive"
                  />
                  <PipeCard
                    icon={<Heart className="w-4 h-4" />}
                    title="Biometric Correlation"
                    rows={[
                      ["Rows", pipelineNum(p.biometric_correlation_rows)],
                      ["Unique tails", pipelineNum(p.biometric_correlation_rows, "unique_tails")],
                    ]}
                  />
                  <PipeCard
                    icon={<AlertTriangle className="w-4 h-4" />}
                    title="14 CFR § 91.119 (<1000 ft, 30d)"
                    rows={[["Detections", pipelineNum(p.violations_91_119)]]}
                    status="destructive"
                  />
                  <PipeCard
                    icon={<AlertTriangle className="w-4 h-4" />}
                    title="Sub-Stall Anomalies (30d)"
                    rows={[["<48 kts, >100 ft", pipelineNum(p.sub_stall_anomalies)]]}
                    status="warning"
                  />
                  <PipeCard
                    icon={<ShieldAlert className="w-4 h-4" />}
                    title="Foreign Registry Injections (30d)"
                    rows={[["EP-/PT-/RP-/VH-/JA-…", pipelineNum(p.foreign_registry_injections)]]}
                    status="destructive"
                  />
                  <PipeCard
                    icon={<Plane className="w-4 h-4" />}
                    title="KCSO Detections (30d)"
                    rows={[["Confirmed fleet", pipelineNum(p.kcso_detections_30d)]]}
                  />
                </div>
              </TabsContent>

              <TabsContent value="active" className="mt-4">
                <CyberPanel title="Tables with last-24h writes" icon={<Activity className="w-4 h-4" />}>
                  <div className="p-4">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border">
                        <tr><th className="text-left py-2">Table</th><th className="text-right">Rows (24h)</th><th className="text-right">Latest</th></tr>
                      </thead>
                      <tbody>
                        {report.top_active_24h.map((t) => (
                          <tr key={t.table} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="py-2 font-mono">{t.table}</td>
                            <td className="text-right text-success font-mono">{fmtNum(t.last_24h)}</td>
                            <td className="text-right text-muted-foreground">{t.latest ? new Date(t.latest).toLocaleString() : "—"}</td>
                          </tr>
                        ))}
                        {report.top_active_24h.length === 0 && (
                          <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No tables wrote in the last 24h</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CyberPanel>
              </TabsContent>

              <TabsContent value="all" className="mt-4">
                <CyberPanel title="All public tables (sorted by row count)" icon={<Database className="w-4 h-4" />}>
                  <div className="p-4 overflow-x-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground border-b border-border sticky top-0 bg-card">
                        <tr>
                          <th className="text-left py-2">Table</th>
                          <th className="text-right">Rows (est.)</th>
                          <th className="text-right">Size</th>
                          <th className="text-right">Cols</th>
                          <th className="text-right">Latest write</th>
                          <th className="text-right">24h</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.tables.map((t) => (
                          <tr key={t.table_name} className="border-b border-border/30 hover:bg-muted/20">
                            <td className="py-1.5 font-mono">{t.table_name}</td>
                            <td className="text-right font-mono">{fmtNum(t.row_estimate)}</td>
                            <td className="text-right font-mono text-muted-foreground">{fmtBytes(t.total_bytes)}</td>
                            <td className="text-right text-muted-foreground">{t.column_count}</td>
                            <td className="text-right text-muted-foreground">
                              {t.freshness?.latest ? new Date(t.freshness.latest).toLocaleDateString() : "—"}
                            </td>
                            <td className="text-right">
                              {t.freshness?.last_24h ? (
                                <Badge variant="outline" className="text-success border-success/40">{fmtNum(t.freshness.last_24h)}</Badge>
                              ) : <span className="text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CyberPanel>
              </TabsContent>

              <TabsContent value="raw" className="mt-4">
                <CyberPanel title="Forensic raw report" icon={<Clock className="w-4 h-4" />}>
                  <pre className="p-4 text-xs overflow-auto max-h-[600px] font-mono">
                    {JSON.stringify(report, null, 2)}
                  </pre>
                </CyberPanel>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function PipeCard({ icon, title, rows, status }: {
  icon: React.ReactNode;
  title: string;
  rows: [string, string][];
  status?: "success" | "warning" | "destructive";
}) {
  const color = status === "destructive" ? "border-destructive/40"
    : status === "warning" ? "border-warning/40"
    : status === "success" ? "border-success/40"
    : "border-border";
  return (
    <div className={`p-4 rounded border ${color} bg-card/50 space-y-2`}>
      <div className="flex items-center gap-2 text-xs font-display tracking-wider text-muted-foreground uppercase">
        {icon}{title}
      </div>
      <div className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-semibold">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

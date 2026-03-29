import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { safeNumber } from "@/lib/formatters";
import {
  Activity,
  Database,
  Trash2,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Layers,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
interface BloatRow {
  table_name: string;
  live_rows: string | number;
  dead_rows: string | number;
  bloat_pct: string | number;
  size: string;
  last_vacuum: string | null;
  last_autovacuum: string | null;
}

interface IndexRow {
  indexname: string;
  tablename: string;
  idx_scan: string | number;
  size: string;
}

interface TableRow {
  table_name: string;
  size: string;
  size_bytes: string | number;
  live_rows: string | number;
  dead_rows: string | number;
}

interface HealthSummary {
  total_dead_rows: number;
  total_tables: number;
  total_matviews: number;
  top_bloated: BloatRow[];
  top_unused_indexes: IndexRow[];
}

// ── helpers ───────────────────────────────────────────────────────────────────
function bloatBadge(pct: number) {
  if (pct >= 20) return <Badge variant="destructive">{pct}% bloat</Badge>;
  if (pct >= 10) return <Badge className="bg-warning/20 text-warning border-warning/30">{pct}% bloat</Badge>;
  return <Badge className="bg-success/20 text-success border-success/30">{pct}% bloat</Badge>;
}

async function callFn(action: string, extra?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("db-health-monitor", {
    body: { action, ...extra },
  });
  if (error) throw new Error(error.message);
  return data?.data ?? data;
}

// ── component ─────────────────────────────────────────────────────────────────
export function DBHealthMonitor() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [bloatRows, setBloatRows] = useState<BloatRow[]>([]);
  const [indexRows, setIndexRows] = useState<IndexRow[]>([]);
  const [schemaRows, setSchemaRows] = useState<TableRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [actionStatus, setActionStatus] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  // load summary on mount
  useEffect(() => {
    fetchSummary();
  }, []);

  async function fetchSummary() {
    setLoadingSummary(true);
    try {
      const res = await callFn("healthSummary");
      setSummary(res);
    } catch (e) {
      setActionStatus(`Error: ${(e as Error).message}`);
    } finally {
      setLoadingSummary(false);
    }
  }

  async function fetchBloat() {
    setActionStatus("Loading bloat stats…");
    try {
      const res = await callFn("bloatStats");
      setBloatRows(res.bloat ?? []);
      setActionStatus(`Loaded ${res.bloat?.length ?? 0} tables`);
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
  }

  async function fetchIndexes() {
    setActionStatus("Loading index stats…");
    try {
      const res = await callFn("indexHealth");
      setIndexRows(res.indexes ?? []);
      setActionStatus(`Loaded ${res.indexes?.length ?? 0} indexes`);
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
  }

  async function fetchSchema() {
    setActionStatus("Loading schema census…");
    try {
      const res = await callFn("schemaCensus");
      setSchemaRows(res.tables ?? []);
      setActionStatus(`${res.total_tables} tables in schema`);
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
  }

  async function runVacuumAll() {
    setActionLoading(true);
    setActionStatus("Running VACUUM ANALYZE on all bloated tables…");
    try {
      const res = await callFn("vacuumAll");
      const ok = (res.outcomes ?? []).filter((o: { ok: boolean }) => o.ok).length;
      setActionStatus(`✓ Vacuumed ${ok} tables successfully`);
      fetchSummary();
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
    finally { setActionLoading(false); }
  }

  async function createCrossModal() {
    setActionLoading(true);
    setActionStatus("Creating cross-modal materialized views…");
    try {
      const res = await callFn("createCrossModalViews");
      setActionStatus((res.created ?? []).join(" | "));
      fetchSummary();
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
    finally { setActionLoading(false); }
  }

  async function refreshCrossModal() {
    setActionLoading(true);
    setActionStatus("Refreshing cross-modal views…");
    try {
      const res = await callFn("refreshCrossModalViews");
      const ok = (res.refreshed ?? []).filter((r: { ok: boolean }) => r.ok).length;
      setActionStatus(`✓ Refreshed ${ok} cross-modal views`);
    } catch (e) { setActionStatus(`Error: ${(e as Error).message}`); }
    finally { setActionLoading(false); }
  }

  const totalDead = safeNumber(summary?.total_dead_rows);
  const deadMillions = (totalDead / 1_000_000).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display text-xl uppercase tracking-wider text-primary">
              Live DB Health Monitor
            </h2>
            <p className="font-mono text-xs text-muted-foreground">
              VACUUM · INDEX HEALTH · SCHEMA SPRAWL · CROSS-MODAL VIEWS
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchSummary}
          disabled={loadingSummary}
          className="gap-2 font-mono text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${loadingSummary ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-4">
              <p className="font-mono text-xs text-muted-foreground uppercase">Dead Rows</p>
              <p className="font-display text-2xl text-destructive mt-1">{deadMillions}M</p>
              <p className="font-mono text-xs text-muted-foreground">across all tables</p>
            </CardContent>
          </Card>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <p className="font-mono text-xs text-muted-foreground uppercase">Tables</p>
              <p className="font-display text-2xl text-primary mt-1">{summary.total_tables}</p>
              <p className="font-mono text-xs text-muted-foreground">public schema</p>
            </CardContent>
          </Card>
          <Card className="border-success/30 bg-success/5">
            <CardContent className="p-4">
              <p className="font-mono text-xs text-muted-foreground uppercase">Mat. Views</p>
              <p className="font-display text-2xl text-success mt-1">{summary.total_matviews}</p>
              <p className="font-mono text-xs text-muted-foreground">active</p>
            </CardContent>
          </Card>
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="p-4">
              <p className="font-mono text-xs text-muted-foreground uppercase">Unused Indexes</p>
              <p className="font-display text-2xl text-warning mt-1">
                {summary.top_unused_indexes?.length ?? 0}
              </p>
              <p className="font-mono text-xs text-muted-foreground">zero scans</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Action Status Bar */}
      {actionStatus && (
        <div className="flex items-center gap-2 px-3 py-2 rounded border border-primary/20 bg-primary/5 font-mono text-xs text-primary">
          {actionLoading
            ? <RefreshCw className="h-3 w-3 animate-spin shrink-0" />
            : actionStatus.startsWith("Error")
              ? <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
              : <CheckCircle className="h-3 w-3 text-success shrink-0" />
          }
          {actionStatus}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="font-mono text-xs">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="bloat" onClick={fetchBloat}>Bloat / VACUUM</TabsTrigger>
          <TabsTrigger value="indexes" onClick={fetchIndexes}>Index Health</TabsTrigger>
          <TabsTrigger value="schema" onClick={fetchSchema}>Schema Sprawl</TabsTrigger>
          <TabsTrigger value="crossmodal">Cross-Modal Views</TabsTrigger>
        </TabsList>

        {/* OVERVIEW TAB */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* top bloated */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-mono text-sm flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-destructive" /> Top Bloated Tables
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(summary?.top_bloated ?? []).map((row) => (
                  <div key={row.table_name} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-xs text-foreground truncate max-w-[180px]">{row.table_name}</span>
                      {bloatBadge(safeNumber(row.bloat_pct))}
                    </div>
                    <Progress value={Math.min(safeNumber(row.bloat_pct), 100)} className="h-1" />
                    <p className="font-mono text-xs text-muted-foreground">
                      {Number(row.dead_rows).toLocaleString()} dead rows · {row.size}
                    </p>
                  </div>
                ))}
                {!summary && <p className="font-mono text-xs text-muted-foreground">Loading…</p>}
              </CardContent>
            </Card>

            {/* top unused indexes */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-mono text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-warning" /> Unused Indexes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(summary?.top_unused_indexes ?? []).map((idx, i) => (
                  <div key={`${idx.indexname}-${i}`} className="flex justify-between items-center py-1 border-b border-border/30">
                    <div>
                      <p className="font-mono text-xs text-foreground truncate max-w-[200px]">{idx.indexname}</p>
                      <p className="font-mono text-xs text-muted-foreground">on {idx.tablename}</p>
                    </div>
                    <Badge variant="outline" className="font-mono text-xs">{idx.size}</Badge>
                  </div>
                ))}
                {!summary && <p className="font-mono text-xs text-muted-foreground">Loading…</p>}
              </CardContent>
            </Card>
          </div>

          {/* quick actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Quick Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                onClick={runVacuumAll}
                disabled={actionLoading}
                variant="destructive"
                size="sm"
                className="gap-2 font-mono text-xs"
              >
                <Trash2 className="h-3 w-3" />
                VACUUM All Bloated
              </Button>
              <Button
                onClick={createCrossModal}
                disabled={actionLoading}
                variant="outline"
                size="sm"
                className="gap-2 font-mono text-xs border-primary/40 text-primary hover:bg-primary/10"
              >
                <Layers className="h-3 w-3" />
                Create Cross-Modal Views
              </Button>
              <Button
                onClick={refreshCrossModal}
                disabled={actionLoading}
                variant="outline"
                size="sm"
                className="gap-2 font-mono text-xs border-success/40 text-success hover:bg-success/10"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh Cross-Modal
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* BLOAT TAB */}
        <TabsContent value="bloat" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="font-mono text-sm">Table Bloat Stats</CardTitle>
              <Button onClick={runVacuumAll} disabled={actionLoading} size="sm" variant="destructive"
                className="gap-2 font-mono text-xs">
                <Trash2 className="h-3 w-3" /> VACUUM All
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 text-muted-foreground">Table</th>
                      <th className="text-right py-2 text-muted-foreground">Live</th>
                      <th className="text-right py-2 text-muted-foreground">Dead</th>
                      <th className="text-right py-2 text-muted-foreground">Bloat%</th>
                      <th className="text-right py-2 text-muted-foreground">Size</th>
                      <th className="text-right py-2 text-muted-foreground">Last Vacuum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bloatRows.map((row) => (
                      <tr key={row.table_name} className="border-b border-border/20 hover:bg-muted/30">
                        <td className="py-1.5 truncate max-w-[200px]">{row.table_name}</td>
                        <td className="py-1.5 text-right text-success">{Number(row.live_rows).toLocaleString()}</td>
                        <td className="py-1.5 text-right text-destructive">{Number(row.dead_rows).toLocaleString()}</td>
                        <td className="py-1.5 text-right">
                          {bloatBadge(safeNumber(row.bloat_pct))}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">{row.size}</td>
                        <td className="py-1.5 text-right text-muted-foreground">
                          {row.last_vacuum
                            ? new Date(row.last_vacuum).toLocaleDateString()
                            : row.last_autovacuum
                              ? new Date(row.last_autovacuum).toLocaleDateString() + " (auto)"
                              : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bloatRows.length === 0 && (
                  <p className="text-center py-4 text-muted-foreground font-mono text-xs">
                    Click the tab to load bloat data
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* INDEX HEALTH TAB */}
        <TabsContent value="indexes" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm">Index Usage (sorted by scan count ↑)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 text-muted-foreground">Index</th>
                      <th className="text-left py-2 text-muted-foreground">Table</th>
                      <th className="text-right py-2 text-muted-foreground">Scans</th>
                      <th className="text-right py-2 text-muted-foreground">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexRows.map((idx, i) => (
                      <tr key={`${idx.indexname}-${i}`} className="border-b border-border/20 hover:bg-muted/30">
                        <td className="py-1.5 truncate max-w-[220px]">{idx.indexname}</td>
                        <td className="py-1.5 text-muted-foreground">{idx.tablename}</td>
                        <td className="py-1.5 text-right">
                          <span className={safeNumber(idx.idx_scan) === 0 ? "text-warning" : "text-success"}>
                            {Number(idx.idx_scan).toLocaleString()}
                          </span>
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">{idx.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {indexRows.length === 0 && (
                  <p className="text-center py-4 text-muted-foreground font-mono text-xs">
                    Click the tab to load index data
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SCHEMA SPRAWL TAB */}
        <TabsContent value="schema" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="font-mono text-sm flex items-center gap-2">
                <Database className="h-4 w-4" /> Schema Census ({schemaRows.length} shown)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border/50">
                      <th className="text-left py-2 text-muted-foreground">Table</th>
                      <th className="text-right py-2 text-muted-foreground">Live Rows</th>
                      <th className="text-right py-2 text-muted-foreground">Dead Rows</th>
                      <th className="text-right py-2 text-muted-foreground">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schemaRows.map((row) => (
                      <tr key={row.table_name} className="border-b border-border/20 hover:bg-muted/30">
                        <td className="py-1.5 truncate max-w-[240px]">{row.table_name}</td>
                        <td className="py-1.5 text-right text-success">
                          {row.live_rows != null ? Number(row.live_rows).toLocaleString() : "—"}
                        </td>
                        <td className="py-1.5 text-right text-destructive">
                          {row.dead_rows != null ? Number(row.dead_rows).toLocaleString() : "—"}
                        </td>
                        <td className="py-1.5 text-right text-muted-foreground">{row.size}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {schemaRows.length === 0 && (
                  <p className="text-center py-4 text-muted-foreground font-mono text-xs">
                    Click the tab to load schema data
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CROSS-MODAL VIEWS TAB */}
        <TabsContent value="crossmodal" className="mt-4 space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                name: "mv_flight_bio_convergence",
                label: "Flight ↔ Biometric",
                desc: "Joins telemetry with health readings by day (30-day window). Tracks heart rate, stress, and medical alerts per aircraft.",
                color: "primary",
              },
              {
                name: "mv_flight_legal_timeline",
                label: "Flight ↔ Legal Events",
                desc: "Correlates forensic events with flight detections (90-day window). Includes Bradford-Hill scores and physical verification flags.",
                color: "warning",
              },
              {
                name: "mv_entity_threat_summary",
                label: "Entity Threat Summary",
                desc: "Aggregates entity registry by type and threat classification across the full archive. Powers the network graph overlays.",
                color: "success",
              },
            ].map((v) => (
              <Card key={v.name} className={`border-${v.color}/30 bg-${v.color}/5`}>
                <CardHeader className="pb-2">
                  <CardTitle className={`font-mono text-sm text-${v.color}`}>{v.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="font-mono text-xs text-muted-foreground">{v.desc}</p>
                  <code className={`block font-mono text-xs text-${v.color}/70 bg-background/50 rounded px-2 py-1 border border-${v.color}/20`}>
                    {v.name}
                  </code>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={createCrossModal}
              disabled={actionLoading}
              variant="outline"
              className="gap-2 font-mono text-xs border-primary/40 text-primary hover:bg-primary/10"
            >
              <Layers className="h-3 w-3" />
              Create All Views
            </Button>
            <Button
              onClick={refreshCrossModal}
              disabled={actionLoading}
              variant="outline"
              className="gap-2 font-mono text-xs border-success/40 text-success hover:bg-success/10"
            >
              <RefreshCw className={`h-3 w-3 ${actionLoading ? "animate-spin" : ""}`} />
              Refresh All Views
            </Button>
          </div>

          <Card className="border-border/50">
            <CardContent className="pt-4">
              <p className="font-mono text-xs text-muted-foreground leading-relaxed">
                <span className="text-primary font-semibold">Date-range guards</span> are enforced on all joins (30–90 days)
                to prevent gateway timeouts on the 15M+ record archive.
                Run <span className="text-success">Create All Views</span> once, then schedule periodic
                <span className="text-success"> Refresh</span> calls to keep the views current.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

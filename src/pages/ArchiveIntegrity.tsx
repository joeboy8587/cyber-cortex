import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Database, ShieldCheck, Link2, HardDrive, RefreshCw, Trash2,
  Fingerprint, Download, AlertTriangle, CheckCircle2, Gauge,
} from "lucide-react";

type Audit = {
  totals: { base_tables: number; indexes: number; index_bytes: string; table_bytes: string };
  unusedIndexes: any[];
  duplicateGroups: any[];
  bloatedTables: any[];
  recommendedDrops: { index: string; table: string; reason: string; size_mb: number }[];
  reclaimableMb: number;
};
type Coverage = {
  summary: { total_tables: number; hashed_tables: number; unhashed_tables: number; unhashed_rows_est: string };
  topUnhashed: { table_name: string; est_rows: string }[];
};
type MerkleStats = {
  totalEntries: number;
  uniqueTables: number;
  lastEntry: { sequence_number: number; chain_hash: string; anchored_at: string; source_table: string } | null;
  firstEntry: { sequence_number: number; anchored_at: string } | null;
};

const fmtNum = (n: number | string) => new Intl.NumberFormat().format(Number(n) || 0);
const fmtBytes = (b: number | string) => {
  const v = Number(b) || 0;
  if (!v) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(v) / Math.log(1024));
  return `${(v / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
};

export default function ArchiveIntegrity() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [merkle, setMerkle] = useState<MerkleStats | null>(null);
  const [verify, setVerify] = useState<any>(null);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = (line: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 40));

  const call = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data ?? data;
  };

  const run = async (key: string, label: string, work: () => Promise<string>) => {
    setBusy(key);
    try {
      const msg = await work();
      pushLog(`${label}: ${msg}`);
      toast({ title: label, description: msg });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(`${label} FAILED: ${msg}`);
      toast({ title: `${label} failed`, description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const loadAll = () =>
    run("all", "Integrity scan", async () => {
      const [a, c, m] = await Promise.all([
        call("neon-archive-integrity", { action: "indexAudit", minSizeMb: 8, limit: 80 }),
        call("neon-archive-integrity", { action: "hashCoverage" }),
        call("merkle-anchor", { action: "stats" }),
      ]);
      setAudit(a); setCoverage(c); setMerkle(m);
      return `${a.recommendedDrops.length} redundant indexes (${a.reclaimableMb} MB), ${c.summary.unhashed_tables} tables unhashed, ${fmtNum(m.totalEntries)} chain links`;
    });

  const cleanupIndexes = () =>
    run("cleanup", "Index cleanup", async () => {
      if (!audit?.recommendedDrops.length) return "nothing to drop";
      const list = audit.recommendedDrops.map((d) => d.index);
      let dropped = 0;
      for (let i = 0; i < list.length; i += 16) {
        const r = await call("neon-archive-integrity", {
          action: "indexCleanup", dryRun: false, indexes: list.slice(i, i + 16),
        });
        dropped += r.dropped || 0;
      }
      const a = await call("neon-archive-integrity", { action: "indexAudit", minSizeMb: 8, limit: 80 });
      setAudit(a);
      return `${dropped} indexes dropped`;
    });

  const vacuumBloat = () =>
    run("vacuum", "Vacuum + analyze", async () => {
      const tables = (audit?.bloatedTables ?? []).slice(0, 2).map((t: any) => t.table_name);
      if (!tables.length) return "no bloated tables";
      const r = await call("neon-archive-integrity", { action: "vacuumTables", tables });
      return r.results.map((x: any) => `${x.table}: ${x.status}`).join(", ");
    });

  const rebuildTagsView = () =>
    run("tags", "Unified tag view", async () => {
      const r = await call("neon-archive-integrity", { action: "tagsView" });
      return `${r.created} rebuilt (${r.sample?.length ?? 0} tagged samples)`;
    });

  const backfillHashes = () =>
    run("hash", "SHA-256 backfill", async () => {
      let hashed = 0;
      for (let i = 0; i < 3; i++) {
        const r = await call("merkle-anchor", { action: "backfillHashes", maxTables: 6, batchSize: 20000 });
        hashed += (r.results ?? []).reduce((s: number, x: any) => s + (x.updated || 0), 0);
      }
      const c = await call("neon-archive-integrity", { action: "hashCoverage" });
      setCoverage(c);
      return `${fmtNum(hashed)} rows hashed · ${c.summary.unhashed_tables} tables still open`;
    });

  const anchorChain = () =>
    run("anchor", "Merkle anchoring", async () => {
      let anchored = 0;
      for (let i = 0; i < 3; i++) {
        const r = await call("merkle-anchor", { action: "anchorDeep", batchSize: 300, maxTables: 4, hashOnly: true });
        anchored += r.totalAnchored || 0;
      }
      const m = await call("merkle-anchor", { action: "stats" });
      setMerkle(m);
      return `${fmtNum(anchored)} new chain links`;
    });

  const verifyChain = () =>
    run("verify", "Chain verification", async () => {
      const r = await call("merkle-anchor", { action: "verify", batchSize: 2000 });
      setVerify(r);
      return `${r.integrity}: ${fmtNum(r.verified)} verified, ${r.failed} failures`;
    });

  const exportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      index_audit: audit,
      hash_coverage: coverage,
      merkle_chain: merkle,
      chain_verification: verify,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d}_WATCHTOWER_CHAIN-INTEGRITY_REPORT.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Report exported", description: "Chain integrity report downloaded" });
  };

  const hashPct = coverage
    ? Math.round((coverage.summary.hashed_tables / Math.max(1, coverage.summary.total_tables)) * 100)
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Archive Integrity &amp; Query Speed</h1>
            <p className="text-sm text-muted-foreground">
              Index health, SHA-256 coverage and Merkle chain of custody across the full archive.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={loadAll} disabled={!!busy}>
              <RefreshCw className={`mr-2 h-4 w-4 ${busy === "all" ? "animate-spin" : ""}`} />
              Run integrity scan
            </Button>
            <Button variant="outline" onClick={exportReport} disabled={!audit && !merkle}>
              <Download className="mr-2 h-4 w-4" /> Export report
            </Button>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Base tables" value={fmtNum(audit?.totals?.base_tables ?? 0)} icon={<Database className="h-4 w-4" />} />
          <StatCard
            label="Index storage"
            value={fmtBytes(audit?.totals?.index_bytes ?? 0)}
            icon={<HardDrive className="h-4 w-4" />}
            trendValue={audit ? `${fmtNum(audit.totals.indexes)} indexes · ${audit.reclaimableMb} MB reclaimable` : undefined}
          />
          <StatCard
            label="Hash coverage"
            value={`${hashPct}%`}
            icon={<Fingerprint className="h-4 w-4" />}
            trendValue={coverage ? `${coverage.summary.unhashed_tables} tables unhashed` : undefined}
          />
          <StatCard
            label="Merkle chain"
            value={fmtNum(merkle?.totalEntries ?? 0)}
            icon={<Link2 className="h-4 w-4" />}
            trendValue={merkle?.lastEntry ? `last ${new Date(merkle.lastEntry.anchored_at).toLocaleString()}` : undefined}
          />
        </div>

        <Tabs defaultValue="indexes">
          <TabsList>
            <TabsTrigger value="indexes">Query speed</TabsTrigger>
            <TabsTrigger value="hashes">Hash coverage</TabsTrigger>
            <TabsTrigger value="chain">Chain of custody</TabsTrigger>
            <TabsTrigger value="county">County integrity</TabsTrigger>
          </TabsList>

          <TabsContent value="county" className="space-y-4">
            <CountyIntegrityPanel />
          </TabsContent>

          <TabsContent value="indexes" className="space-y-4">
            <CyberPanel title="Redundant & unused indexes" icon={<Gauge className="h-4 w-4" />}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={cleanupIndexes} disabled={!!busy || !audit?.recommendedDrops.length}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Drop {audit?.recommendedDrops.length ?? 0} redundant indexes
                </Button>
                <Button size="sm" variant="outline" onClick={vacuumBloat} disabled={!!busy || !audit?.bloatedTables.length}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${busy === "vacuum" ? "animate-spin" : ""}`} /> Vacuum bloated tables
                </Button>
                <Button size="sm" variant="outline" onClick={rebuildTagsView} disabled={!!busy}>
                  Rebuild unified tag view
                </Button>
              </div>
              {!audit && <p className="text-sm text-muted-foreground">Run the integrity scan to populate.</p>}
              {audit && (
                <div className="max-h-80 space-y-1 overflow-auto text-sm">
                  {audit.recommendedDrops.slice(0, 40).map((d) => (
                    <div key={d.index} className="flex items-center justify-between rounded border border-border/50 px-3 py-1.5">
                      <div className="min-w-0">
                        <span className="font-mono text-xs">{d.index}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{d.table} · {d.reason}</span>
                      </div>
                      <Badge variant="outline">{d.size_mb} MB</Badge>
                    </div>
                  ))}
                  {!audit.recommendedDrops.length && (
                    <p className="text-sm text-muted-foreground">No redundant indexes detected.</p>
                  )}
                </div>
              )}
            </CyberPanel>

            <CyberPanel title="Dead-row bloat" icon={<AlertTriangle className="h-4 w-4" />}>
              <div className="space-y-1 text-sm">
                {(audit?.bloatedTables ?? []).map((t: any) => (
                  <div key={t.table_name} className="flex items-center justify-between rounded border border-border/50 px-3 py-1.5">
                    <span className="font-mono text-xs">{t.table_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtNum(t.dead_rows)} dead ({t.dead_pct}%) · {t.total_mb} MB
                    </span>
                  </div>
                ))}
                {!audit?.bloatedTables?.length && <p className="text-muted-foreground">No significant bloat.</p>}
              </div>
            </CyberPanel>
          </TabsContent>

          <TabsContent value="hashes" className="space-y-4">
            <CyberPanel title="SHA-256 fingerprint coverage" icon={<Fingerprint className="h-4 w-4" />}>
              <div className="mb-3">
                <Button size="sm" onClick={backfillHashes} disabled={!!busy}>
                  <Fingerprint className={`mr-2 h-4 w-4 ${busy === "hash" ? "animate-pulse" : ""}`} /> Backfill hashes
                </Button>
              </div>
              {coverage ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    {fmtNum(coverage.summary.hashed_tables)} / {fmtNum(coverage.summary.total_tables)} tables fingerprinted ·
                    ~{fmtNum(coverage.summary.unhashed_rows_est)} rows still unhashed
                  </p>
                  {coverage.topUnhashed.map((t) => (
                    <div key={t.table_name} className="flex items-center justify-between rounded border border-border/50 px-3 py-1.5">
                      <span className="font-mono text-xs">{t.table_name}</span>
                      <Badge variant="outline">{fmtNum(t.est_rows)} rows</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Run the integrity scan to populate.</p>
              )}
            </CyberPanel>
          </TabsContent>

          <TabsContent value="chain" className="space-y-4">
            <CyberPanel title="Merkle chain of custody" icon={<ShieldCheck className="h-4 w-4" />}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={anchorChain} disabled={!!busy}>
                  <Link2 className={`mr-2 h-4 w-4 ${busy === "anchor" ? "animate-pulse" : ""}`} /> Anchor new records
                </Button>
                <Button size="sm" variant="outline" onClick={verifyChain} disabled={!!busy}>
                  <ShieldCheck className="mr-2 h-4 w-4" /> Verify chain
                </Button>
              </div>
              {merkle && (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>{fmtNum(merkle.totalEntries)} anchored records across {merkle.uniqueTables} tables.</p>
                  {merkle.lastEntry && (
                    <p className="font-mono text-xs break-all">
                      head → {merkle.lastEntry.chain_hash.slice(0, 32)}… ({merkle.lastEntry.source_table},{" "}
                      {new Date(merkle.lastEntry.anchored_at).toLocaleString()})
                    </p>
                  )}
                </div>
              )}
              {verify && (
                <div className="mt-3 flex items-center gap-2">
                  {verify.integrity === "VERIFIED" ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm">
                    {verify.integrity} — {fmtNum(verify.verified)} verified, {verify.failed} failures
                  </span>
                </div>
              )}
            </CyberPanel>
          </TabsContent>
        </Tabs>

        <CyberPanel title="Activity log" icon={<Database className="h-4 w-4" />}>
          <div className="max-h-56 space-y-1 overflow-auto font-mono text-xs text-muted-foreground">
            {log.length ? log.map((l, i) => <div key={i}>{l}</div>) : <div>No actions yet.</div>}
          </div>
        </CyberPanel>
      </div>
    </DashboardLayout>
  );
}

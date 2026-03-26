import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useMerkleAnchor } from '@/hooks/useMerkleAnchor';
import {
  Link,
  ShieldCheck,
  ShieldAlert,
  Anchor,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Clock,
  Database,
  Layers,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';

export function MerkleChainPanel() {
  const { isLoading, error, anchorBatch, anchorDeep, verifyChain, getStats, getNeonCoverage } = useMerkleAnchor();
  const [stats, setStats] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [deepAnchoring, setDeepAnchoring] = useState(false);
  const [continuousRunning, setContinuousRunning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [roundsCompleted, setRoundsCompleted] = useState(0);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const s = await getStats();
      setStats(s);
    } catch { /* handled */ }
  };

  const loadCoverage = async () => {
    try {
      setLoadingCoverage(true);
      const c = await getNeonCoverage();
      setCoverage(c);
    } catch {
      toast.error('Failed to load Neon coverage');
    } finally {
      setLoadingCoverage(false);
    }
  };

  const handleAnchorBatch = async () => {
    try {
      setAnchoring(true);
      const result = await anchorBatch();
      toast.success(`Anchored ${result.totalAnchored} records`);
      await loadStats();
    } catch {
      toast.error('Merkle anchoring failed');
    } finally {
      setAnchoring(false);
    }
  };

  const handleDeepAnchor = async () => {
    try {
      setDeepAnchoring(true);
      const result = await anchorDeep(200, undefined);
      toast.success(`Deep anchored ${result.totalAnchored} records across ${result.tablesProcessed} tables`);
      await loadStats();
      if (coverage) await loadCoverage();
    } catch (e) {
      toast.error(`Deep anchoring failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setDeepAnchoring(false);
    }
  };

  const priorityTables = [
    'live_flight_detections_rows', 'master_unified_evidence_vectors', 'sentinel_violations',
    'unified_timeline_enhanced', 'biometrics_unified', 'was_threat_assessments',
    'fr24_screenshot_analysis', 'xxb_unmasking_log', 'biometric_monitoring',
    'watchtower_alerts', 'legal_ada_violations_proper', 'flagged_aircraft_rows_rows',
  ];

  const handleContinuousAnchor = async () => {
    setContinuousRunning(true);
    setRoundsCompleted(0);
    let total = 0;

    for (let i = 0; i < priorityTables.length; i++) {
      try {
        const result = await anchorTable(priorityTables[i], 500);
        setRoundsCompleted(i + 1);
        total += result.anchored;
        if (result.anchored > 0) toast.info(`${priorityTables[i]}: +${result.anchored}`);
      } catch {
        // table may not exist, skip
      }
    }

    toast.success(`Priority anchoring complete: +${total} records`);
    await loadStats();
    if (coverage) await loadCoverage();
    setContinuousRunning(false);
  };

  const handleVerify = async () => {
    try {
      setVerifying(true);
      const result = await verifyChain(1000);
      setVerifyResult(result);
      if (result.integrity === 'VERIFIED') toast.success(result.message);
      else if (result.integrity === 'EMPTY') toast.info(result.message);
      else toast.error(result.message);
    } catch {
      toast.error('Chain verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <CyberPanel
      title="MERKLE AUDIT LEDGER — Neon DB Tamper-Proof Chain"
      icon={<Link className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox icon={<Anchor className="h-5 w-5 text-cyan-400" />} value={stats?.chainLength?.toLocaleString() || '0'} label="Chain Length" />
          <StatBox icon={<Link className="h-5 w-5 text-green-400" />} value={stats?.uniqueTables || 0} label="Tables Anchored" />
          <StatBox icon={<Clock className="h-5 w-5 text-yellow-400" />} value={stats?.lastEntry?.anchored_at ? new Date(stats.lastEntry.anchored_at).toLocaleDateString() : 'Never'} label="Last Anchor" small />
          <StatBox
            icon={verifyResult?.integrity === 'VERIFIED' ? <ShieldCheck className="h-5 w-5 text-green-400" /> : verifyResult?.integrity === 'COMPROMISED' ? <ShieldAlert className="h-5 w-5 text-red-400" /> : <ShieldCheck className="h-5 w-5 text-muted-foreground" />}
            value={verifyResult?.integrity || 'UNVERIFIED'}
            label="Chain Integrity"
            small
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={loadStats} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" className="bg-cyan-600 hover:bg-cyan-700" onClick={handleAnchorBatch} disabled={anchoring}>
            {anchoring ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Anchor className="h-4 w-4 mr-1" />}
            Anchor Hashed
          </Button>
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={handleDeepAnchor} disabled={deepAnchoring || continuousRunning}>
            {deepAnchoring ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Layers className="h-4 w-4 mr-1" />}
            Deep Anchor
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={handleContinuousAnchor} disabled={continuousRunning || deepAnchoring}>
            {continuousRunning ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Round {roundsCompleted}/10
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                Continuous (10 rounds)
              </>
            )}
          </Button>
          <Button size="sm" variant="default" onClick={handleVerify} disabled={verifying || (stats?.chainLength === 0)}>
            {verifying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1" />}
            Verify
          </Button>
          <Button size="sm" variant="outline" onClick={loadCoverage} disabled={loadingCoverage}>
            {loadingCoverage ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Database className="h-4 w-4 mr-1" />}
            Neon Coverage
          </Button>
        </div>

        {/* Neon Coverage */}
        {coverage && <NeonCoverageView coverage={coverage} />}

        {/* Verification Result */}
        {verifyResult && <VerifyResultView result={verifyResult} />}

        {/* Table Breakdown */}
        {stats?.tableCounts && Object.keys(stats.tableCounts).length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {Object.entries(stats.tableCounts)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 20)
              .map(([table, count]) => (
                <div key={table} className="flex items-center justify-between p-2 bg-background/30 rounded border border-border/20">
                  <span className="font-mono text-sm text-foreground truncate">{table}</span>
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/30 text-xs">
                    {(count as number).toLocaleString()} anchored
                  </Badge>
                </div>
              ))}
          </div>
        )}

        {error && <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">{error}</div>}

        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Merkle Chain:</strong> Each entry chains hash(record + previous), creating tamper-proof coverage across your entire Neon DB.
          Use Continuous mode to anchor thousands of records across multiple rounds.
        </div>
      </div>
    </CyberPanel>
  );
}

function StatBox({ icon, value, label, small }: { icon: React.ReactNode; value: string | number; label: string; small?: boolean }) {
  return (
    <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
      <div className="mx-auto mb-1 flex justify-center">{icon}</div>
      <div className={`font-mono font-bold text-foreground ${small ? 'text-sm' : 'text-xl'}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function NeonCoverageView({ coverage }: { coverage: any }) {
  const pct = Number(coverage.overallCoverage || 0);
  const progressValue = pct > 0 && pct < 1 ? 1 : Math.min(pct, 100);

  return (
    <div className="p-3 rounded-lg bg-accent/10 border border-border space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-bold text-foreground">Neon DB Merkle Coverage</span>
        <Badge variant="secondary" className="text-xs">
          {coverage.totalAnchored?.toLocaleString()} / {coverage.totalRows?.toLocaleString()} ({pct.toFixed(pct < 1 && pct > 0 ? 4 : 2)}%)
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs font-mono">
        <div><span className="text-muted-foreground">Tables:</span> <span className="text-foreground">{coverage.totalNeonTables}</span></div>
        <div><span className="text-muted-foreground">Anchorable:</span> <span className="text-foreground">{coverage.anchorableTables}</span></div>
        <div><span className="text-muted-foreground">Anchored:</span> <span className="text-foreground font-bold">{coverage.totalAnchored?.toLocaleString()}</span></div>
      </div>
      <Progress value={progressValue} className="h-2" />
      <div className="max-h-40 overflow-y-auto space-y-1">
        {coverage.tables?.filter((t: any) => t.totalRows > 0).slice(0, 30).map((t: any) => {
          const rowCoverage = Number(t.coverage || 0);
          const rowLabel = t.anchored > 0
            ? `${rowCoverage < 1 ? rowCoverage.toFixed(4) : rowCoverage.toFixed(2)}%`
            : '—';

          return (
            <div key={t.table} className="flex items-center justify-between text-xs font-mono p-1.5 bg-background/30 rounded">
              <span className="text-foreground truncate max-w-[40%]">{t.table}</span>
              <div className="flex items-center gap-2">
                {t.hasSha256 && <Badge variant="outline" className="text-[9px]">SHA</Badge>}
                <span className="text-muted-foreground">{t.anchored.toLocaleString()}/{t.totalRows.toLocaleString()}</span>
                <Badge variant="outline" className="text-[10px]">
                  {rowLabel}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerifyResultView({ result }: { result: any }) {
  return (
    <div className={`p-3 rounded border text-sm font-mono ${
      result.integrity === 'VERIFIED' ? 'bg-green-500/10 border-green-500/30 text-green-400' :
      result.integrity === 'COMPROMISED' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
      'bg-muted/50 border-border/30 text-muted-foreground'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {result.integrity === 'VERIFIED' ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
        <span className="font-bold">{result.integrity}</span>
      </div>
      <div>{result.message}</div>
      {result.failed > 0 && (
        <div className="mt-2 text-xs">
          {result.failures.slice(0, 3).map((f: any, i: number) => (
            <div key={i}>⚠ Seq #{f.sequence_number}: {f.source_table}/{f.source_id}</div>
          ))}
        </div>
      )}
    </div>
  );
}

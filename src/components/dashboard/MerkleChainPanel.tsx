import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
} from 'lucide-react';
import { toast } from 'sonner';

export function MerkleChainPanel() {
  const { isLoading, error, anchorBatch, verifyChain, getStats } = useMerkleAnchor();
  const [stats, setStats] = useState<any>(null);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const s = await getStats();
      setStats(s);
    } catch {
      // handled by hook
    }
  };

  const handleAnchorBatch = async () => {
    try {
      setAnchoring(true);
      const result = await anchorBatch();
      toast.success(`Anchored ${result.totalAnchored} records across ${result.tables.filter(t => t.anchored > 0).length} tables`);
      await loadStats();
    } catch {
      toast.error('Merkle anchoring failed');
    } finally {
      setAnchoring(false);
    }
  };

  const handleVerify = async () => {
    try {
      setVerifying(true);
      const result = await verifyChain(1000);
      setVerifyResult(result);
      if (result.integrity === 'VERIFIED') {
        toast.success(result.message);
      } else if (result.integrity === 'EMPTY') {
        toast.info(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('Chain verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <CyberPanel
      title="MERKLE AUDIT LEDGER — Tamper-Proof Chain"
      icon={<Link className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Anchor className="h-5 w-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.chainLength?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-muted-foreground">Chain Length</div>
          </div>

          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Link className="h-5 w-5 mx-auto mb-1 text-green-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.uniqueTables || 0}
            </div>
            <div className="text-xs text-muted-foreground">Tables Anchored</div>
          </div>

          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Clock className="h-5 w-5 mx-auto mb-1 text-yellow-400" />
            <div className="text-sm font-mono text-foreground truncate">
              {stats?.lastEntry?.anchored_at
                ? new Date(stats.lastEntry.anchored_at).toLocaleDateString()
                : 'Never'}
            </div>
            <div className="text-xs text-muted-foreground">Last Anchor</div>
          </div>

          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            {verifyResult?.integrity === 'VERIFIED' ? (
              <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-green-400" />
            ) : verifyResult?.integrity === 'COMPROMISED' ? (
              <ShieldAlert className="h-5 w-5 mx-auto mb-1 text-red-400" />
            ) : (
              <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            )}
            <div className="text-sm font-mono font-bold text-foreground">
              {verifyResult?.integrity || 'UNVERIFIED'}
            </div>
            <div className="text-xs text-muted-foreground">Chain Integrity</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={loadStats} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <Button
            size="sm"
            variant="default"
            className="bg-cyan-600 hover:bg-cyan-700"
            onClick={handleAnchorBatch}
            disabled={anchoring}
          >
            {anchoring ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Anchor className="h-4 w-4 mr-1" />
            )}
            Anchor to Merkle Chain
          </Button>

          <Button
            size="sm"
            variant="default"
            onClick={handleVerify}
            disabled={verifying || (stats?.chainLength === 0)}
          >
            {verifying ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4 mr-1" />
            )}
            Verify Chain Integrity
          </Button>
        </div>

        {/* Verification Result */}
        {verifyResult && (
          <div
            className={`p-3 rounded border text-sm font-mono ${
              verifyResult.integrity === 'VERIFIED'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : verifyResult.integrity === 'COMPROMISED'
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-muted/50 border-border/30 text-muted-foreground'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {verifyResult.integrity === 'VERIFIED' ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              <span className="font-bold">{verifyResult.integrity}</span>
            </div>
            <div>{verifyResult.message}</div>
            {verifyResult.failed > 0 && (
              <div className="mt-2 text-xs">
                {verifyResult.failures.slice(0, 3).map((f: any, i: number) => (
                  <div key={i}>
                    ⚠ Seq #{f.sequence_number}: {f.source_table}/{f.source_id}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Table Breakdown */}
        {stats?.tableCounts && Object.keys(stats.tableCounts).length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1">
            {Object.entries(stats.tableCounts)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 20)
              .map(([table, count]) => (
                <div
                  key={table}
                  className="flex items-center justify-between p-2 bg-background/30 rounded border border-border/20"
                >
                  <span className="font-mono text-sm text-foreground truncate">{table}</span>
                  <Badge variant="outline" className="text-cyan-400 border-cyan-400/30 text-xs">
                    {(count as number).toLocaleString()} anchored
                  </Badge>
                </div>
              ))}
          </div>
        )}

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">{error}</div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Merkle Chain:</strong> Each entry's hash includes the previous entry's hash,
          creating an unbreakable chain. If any record is tampered with, the chain breaks —
          providing provable, court-admissible evidence of data integrity.
        </div>
      </div>
    </CyberPanel>
  );
}

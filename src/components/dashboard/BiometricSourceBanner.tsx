import { useBiometricMaster } from '@/hooks/useBiometricMaster';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, AlertTriangle, Database, Clock } from 'lucide-react';

/**
 * Source-of-truth banner for the Biometric Hub.
 * Surfaces the canonical Neon table state so investigators always know
 * which dataset the page is reading from and whether it's been backfilled.
 */
export function BiometricSourceBanner() {
  const { stats, loading, error } = useBiometricMaster({ limit: 1 });

  const totalRows = stats?.totalRows ?? 0;
  const isBackfilled = totalRows >= 1000;
  const latest = stats?.latestTimestamp
    ? new Date(stats.latestTimestamp).toLocaleString()
    : '—';

  return (
    <Card className="p-4 border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-primary/10 border border-primary/30">
            <Database className="w-5 h-5 text-primary" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Canonical Source
              </span>
              <Badge variant="outline" className="font-mono text-[10px]">
                Neon · public.watchtower_biometrics_master
              </Badge>
            </div>
            <p className="text-sm text-foreground">
              Court-ready schema · dual timezone · Bradford-Hill scored · SHA-256 chain of custody
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <Badge variant="outline" className="font-mono">Loading…</Badge>
          ) : error ? (
            <Badge variant="destructive" className="font-mono gap-1">
              <AlertTriangle className="w-3 h-3" /> {error.slice(0, 40)}
            </Badge>
          ) : (
            <>
              <Badge
                variant={isBackfilled ? 'default' : 'destructive'}
                className="font-mono gap-1"
              >
                {isBackfilled ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {totalRows.toLocaleString()} rows
              </Badge>
              <Badge variant="outline" className="font-mono gap-1">
                <Clock className="w-3 h-3" /> {latest}
              </Badge>
              {stats && (
                <>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    KCSO {stats.kcsoCount}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Shell {stats.shellCount}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    Mil {stats.militaryCount}
                  </Badge>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {!loading && !error && !isBackfilled && (
        <div className="mt-3 p-3 rounded border border-destructive/40 bg-destructive/5">
          <div className="flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-destructive">
                Backfill required — master table holds {totalRows} rows
              </p>
              <p className="text-muted-foreground">
                Legacy sources still active: <code className="font-mono text-[10px]">unified_biometric_events</code> (37,630),{' '}
                <code className="font-mono text-[10px]">confirmed_biometric_correlations</code> (76,763),{' '}
                <code className="font-mono text-[10px]">biometric_events</code>. Until backfill runs, panels read from these
                sources. See audit report (20260522).
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

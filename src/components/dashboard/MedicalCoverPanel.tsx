import { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Ambulance, RefreshCw, Hospital, Clock, Moon, Gauge, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FleetRow {
  registration: string;
  registrant: string | null;
  detections: number;
  active_days: number;
  aoi_passes: number;
  aoi_minutes: number;
  aoi_nights: number;
  min_alt_near_aoi: number | null;
  loiter_samples: number;
  hospital_terminus: number;
  base_ops: number;
  first_seen: string | null;
  last_seen: string | null;
  medical_cover_score: number;
  tier: string;
  reasons: string[];
  rebuttal: string;
}

interface Summary {
  airframes: number;
  suspected: number;
  anomalous: number;
  review: number;
  consistent: number;
  aoi_active: number;
  no_hospital_terminus: number;
  window_days: number;
}

const TIER_STYLE: Record<string, string> = {
  MEDICAL_COVER_SUSPECTED: 'bg-destructive/15 text-destructive border-destructive',
  MEDICAL_PROFILE_ANOMALY: 'bg-warning/15 text-warning border-warning',
  REVIEW: 'bg-accent/15 text-accent border-accent',
  MEDICAL_CONSISTENT: 'bg-success/10 text-success border-success',
};

const TIER_LABEL: Record<string, string> = {
  MEDICAL_COVER_SUSPECTED: 'Medical cover suspected',
  MEDICAL_PROFILE_ANOMALY: 'Medical profile anomaly',
  REVIEW: 'Needs review',
  MEDICAL_CONSISTENT: 'Consistent with medical use',
};

export function MedicalCoverPanel() {
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [open, setOpen] = useState<string | null>(null);

  const runScan = async (windowDays = days) => {
    setLoading(true);
    setDays(windowDays);
    try {
      const { data, error } = await supabase.functions.invoke('medical-cover-scan', {
        body: { days: windowDays, limit: 60 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setRows(data.fleet ?? []);
      setSummary(data.summary ?? null);
      toast.success(`Checked ${data.summary?.airframes ?? 0} air-ambulance airframes`);
    } catch (e) {
      toast.error(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CyberPanel
      title="Medical Cover Analysis — Air Ambulance Fleet"
      icon={<Ambulance className="w-4 h-4" />}
      variant="threat"
      headerActions={
        <div className="flex items-center gap-1">
          {[30, 90, 365].map((d) => (
            <Button key={d} size="sm" variant={days === d ? 'default' : 'ghost'} className="h-6 px-2 text-[10px]"
              onClick={() => runScan(d)} disabled={loading}>
              {d}d
            </Button>
          ))}
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => runScan()} disabled={loading}>
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          A medical livery is not treated as an excuse. Every air-ambulance airframe is tested against what a real
          patient transport looks like — direct transit, a scene landing, a hospital pad at the end. Only flying that a
          medical mission cannot explain is scored.
        </p>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            {[
              { label: 'Airframes checked', value: summary.airframes },
              { label: 'Over the residence', value: summary.aoi_active },
              { label: 'No hospital ending', value: summary.no_hospital_terminus },
              { label: 'Cover suspected', value: summary.suspected + summary.anomalous },
            ].map((s) => (
              <div key={s.label} className="rounded border border-border/60 bg-muted/20 p-2">
                <p className="font-mono text-lg text-foreground">{s.value}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {!summary && !loading && (
          <div className="text-center py-8 text-muted-foreground text-xs">
            Run a scan to test the air-ambulance fleet (Air Methods and related operators) against medical-mission behaviour.
          </div>
        )}

        <ScrollArea className="max-h-[560px]">
          <div className="space-y-2 pr-2">
            {rows.map((r) => (
              <button
                key={r.registration}
                onClick={() => setOpen(open === r.registration ? null : r.registration)}
                className={cn(
                  'w-full text-left p-3 rounded border transition-colors',
                  TIER_STYLE[r.tier] ?? 'border-border',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm font-bold">{r.registration}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{r.registrant ?? 'Registrant unknown'}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {TIER_LABEL[r.tier] ?? r.tier} · {r.medical_cover_score}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{r.aoi_passes} AOI hits</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.aoi_minutes} min dwell</span>
                  <span className="flex items-center gap-1"><Moon className="w-3 h-3" />{r.aoi_nights} night</span>
                  <span className="flex items-center gap-1"><Hospital className="w-3 h-3" />{r.hospital_terminus} hospital</span>
                  <span className="flex items-center gap-1">
                    <ShieldQuestion className="w-3 h-3" />
                    {r.min_alt_near_aoi ? `${r.min_alt_near_aoi} ft min` : 'no low pass'}
                  </span>
                </div>

                {open === r.registration && (
                  <div className="mt-3 space-y-2 border-t border-border/50 pt-2">
                    <ul className="space-y-1">
                      {r.reasons.map((reason, i) => (
                        <li key={i} className="text-[11px] text-foreground/90">• {reason}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] italic text-muted-foreground">{r.rebuttal}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {r.detections.toLocaleString()} detections over {r.active_days} days ·
                      {r.first_seen ? ` ${new Date(r.first_seen).toLocaleDateString()}` : ''} →
                      {r.last_seen ? ` ${new Date(r.last_seen).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </CyberPanel>
  );
}

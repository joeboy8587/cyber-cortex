import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FileText, Download, AlertTriangle, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  days: number;
  loading: boolean;
  setLoading: (v: boolean) => void;
}

export default function LegalExhibitGenerator({ days, loading, setLoading }: Props) {
  const [exhibit, setExhibit] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'ghostAircraftForensics', step: 'legalExhibit', days }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setExhibit(data.exhibit);
      toast.success('Legal exhibit generated');
    } catch (e: any) {
      toast.error(e.message || 'Exhibit generation failed');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  const exportExhibit = () => {
    if (!exhibit) return;
    const lines = [
      '=' .repeat(80),
      exhibit.title,
      '=' .repeat(80),
      `Generated: ${exhibit.generatedAt}`,
      `Analysis Period: ${exhibit.analysisPeriod?.start?.slice(0, 10)} to ${exhibit.analysisPeriod?.end?.slice(0, 10)} (${exhibit.analysisPeriod?.days} days)`,
      '',
      'OVERVIEW',
      '-'.repeat(40),
      `Total Detections: ${exhibit.overview?.total_detections?.toLocaleString()}`,
      `Pure Ghost Detections: ${exhibit.overview?.pure_ghost?.toLocaleString()}`,
      `Critical Low Altitude (<500ft): ${exhibit.overview?.critical_low?.toLocaleString()}`,
      `Night Operations (22:00-05:00 UTC): ${exhibit.overview?.night_ops?.toLocaleString()}`,
      '',
      'KEY FINDINGS',
      '-'.repeat(40),
      ...(exhibit.findings || []).map((f: string, i: number) => `${i + 1}. ${f}`),
      '',
      'OPERATOR IDENTITY MASKING BREAKDOWN',
      '-'.repeat(40),
      'Registration | Total | Masked | Mask% | Min Alt | Avg Alt',
      ...(exhibit.operatorMaskingBreakdown || []).map((m: any) =>
        `${m.registration} | ${m.total} | ${m.masked} | ${m.mask_pct}% | ${m.min_alt}ft | ${m.avg_alt}ft`
      ),
      '',
      'CRITICAL LOW-ALTITUDE EVENTS',
      '-'.repeat(40),
      ...(exhibit.criticalLowAltitudeEvents || []).map((e: any) =>
        `${e.registration} | ${e.detection_timestamp?.slice(0, 19)} | ${e.altitude}ft | ${e.identity_status} | ${e.latitude},${e.longitude}`
      ),
      '',
      'GHOST ATTRIBUTION (SPATIOTEMPORAL PROXIMITY)',
      '-'.repeat(40),
      ...(exhibit.ghostAttributionMatches || []).map((a: any) =>
        `${a.registration}: ${a.matches} proximity matches`
      ),
      '',
      '=' .repeat(80),
      'END OF EXHIBIT',
      `SHA-256 integrity hash should be computed on this document`,
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GHOST_EXHIBIT_${days}d_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Legal exhibit downloaded');
  };

  const ov = exhibit?.overview;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-muted-foreground">
          Generate annotated forensic exhibit with ghost analysis, masking breakdown, and attribution
        </p>
        <div className="flex gap-2">
          {exhibit && (
            <Button onClick={exportExhibit} size="sm" variant="outline" className="gap-1.5">
              <Download className="w-3 h-3" /> Download Exhibit
            </Button>
          )}
          <Button onClick={run} disabled={loading} size="sm" className="gap-1.5">
            {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
            Generate Exhibit
          </Button>
        </div>
      </div>

      {exhibit && (
        <ScrollArea className="h-[500px]">
          <div className="space-y-4 pr-4">
            {/* Header */}
            <div className="p-4 rounded border border-primary/30 bg-primary/5 text-center">
              <h3 className="font-mono text-sm font-bold text-primary uppercase tracking-widest">{exhibit.title}</h3>
              <p className="text-[10px] text-muted-foreground mt-1">
                Generated: {exhibit.generatedAt?.slice(0, 19)} | Period: {exhibit.analysisPeriod?.start?.slice(0, 10)} — {exhibit.analysisPeriod?.end?.slice(0, 10)}
              </p>
            </div>

            {/* Overview */}
            {ov && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Detections', value: ov.total_detections?.toLocaleString() },
                  { label: 'Pure Ghosts', value: ov.pure_ghost?.toLocaleString(), warn: ov.pure_ghost > 0 },
                  { label: 'Critical Low Alt', value: ov.critical_low?.toLocaleString(), warn: ov.critical_low > 0 },
                  { label: 'Night Ops', value: ov.night_ops?.toLocaleString() },
                ].map(({ label, value, warn }) => (
                  <div key={label} className={`p-3 rounded border ${warn ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-muted/20'}`}>
                    <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
                    <p className={`font-mono text-lg font-bold ${warn ? 'text-destructive' : ''}`}>{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Findings */}
            <div className="border border-border rounded p-3">
              <h4 className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-2">
                <AlertTriangle className="w-3 h-3" /> KEY FINDINGS
              </h4>
              <div className="space-y-1">
                {(exhibit.findings || []).map((f: string, i: number) => (
                  <p key={i} className="text-xs flex gap-2">
                    <span className="font-mono text-primary">{i + 1}.</span> {f}
                  </p>
                ))}
              </div>
            </div>

            {/* Masking breakdown */}
            <div className="border border-border rounded p-3">
              <h4 className="text-xs font-mono text-muted-foreground mb-2">OPERATOR IDENTITY MASKING</h4>
              <div className="space-y-1">
                {(exhibit.operatorMaskingBreakdown || []).map((m: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded bg-muted/10 text-xs">
                    <span className="font-mono font-bold w-16">{m.registration}</span>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-destructive rounded-full" style={{ width: `${Math.min(m.mask_pct || 0, 100)}%` }} />
                    </div>
                    <span className={`font-mono w-12 text-right ${(m.mask_pct || 0) > 10 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {m.mask_pct || 0}%
                    </span>
                    <span className="text-muted-foreground w-20 text-right">{m.masked}/{m.total}</span>
                    <span className="text-muted-foreground w-14 text-right">{m.avg_alt}ft</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Attribution */}
            {exhibit.ghostAttributionMatches?.length > 0 && (
              <div className="border border-destructive/30 rounded p-3 bg-destructive/5">
                <h4 className="text-xs font-mono text-destructive mb-2 flex items-center gap-2">
                  <Shield className="w-3 h-3" /> GHOST ATTRIBUTION MATCHES
                </h4>
                <div className="space-y-1">
                  {exhibit.ghostAttributionMatches.map((a: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/10 text-xs">
                      <span className="font-mono font-bold">{a.registration}</span>
                      <span className="font-mono text-destructive font-bold">{a.matches} proximity matches</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Low altitude events */}
            {exhibit.criticalLowAltitudeEvents?.length > 0 && (
              <div className="border border-border rounded p-3">
                <h4 className="text-xs font-mono text-muted-foreground mb-2">CRITICAL LOW-ALTITUDE EVENTS (top 50)</h4>
                <div className="space-y-1">
                  {exhibit.criticalLowAltitudeEvents.slice(0, 20).map((e: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-1.5 rounded bg-muted/10 text-[10px]">
                      <span className="font-mono font-bold w-14">{e.registration}</span>
                      <span className="text-muted-foreground w-32">{e.detection_timestamp?.slice(0, 19)?.replace('T', ' ')}</span>
                      <span className="font-mono text-destructive font-bold w-12 text-right">{e.altitude}ft</span>
                      <Badge variant={e.identity_status === 'GHOST' ? 'destructive' : 'secondary'} className="text-[8px]">
                        {e.identity_status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {!exhibit && !loading && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <FileText className="w-12 h-12 mx-auto opacity-30" />
          <p className="text-sm">Generate a comprehensive legal exhibit from ghost aircraft analysis</p>
          <p className="text-xs">Includes overview, findings, masking breakdown, attribution, and low-altitude events</p>
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Ghost, Loader2, AlertTriangle, Eye, EyeOff, Radio,
  BarChart3, Shield, Database, Crosshair, Download, Clock
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie
} from 'recharts';

export default function GhostAircraftForensics() {
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [analyzeData, setAnalyzeData] = useState<any>(null);
  const [attributionData, setAttributionData] = useState<any>(null);
  const [maskingData, setMaskingData] = useState<any>(null);
  const [hourlyData, setHourlyData] = useState<any>(null);
  const [days, setDays] = useState(30);

  const run = async (step: string) => {
    setLoading(true);
    setActiveStep(step);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'ghostAircraftForensics', step, days }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (step === 'analyze') setAnalyzeData(data);
      if (step === 'operatorAttribution') setAttributionData(data);
      if (step === 'maskingTimeline') setMaskingData(data);
      if (step === 'maskingHourly') setHourlyData(data);
      if (step === 'addColumns') toast.success(`Columns added, ${data.positionSourceInferred} rows inferred`);
      if (step === 'exportEvidence') {
        exportCSV(data.evidenceExport);
        toast.success(`Exported ${data.count} evidence records`);
      } else {
        toast.success(`${step} complete`);
      }
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
      setActiveStep(null);
    }
  };

  const exportCSV = (rows: any[]) => {
    if (!rows?.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h];
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : v ?? '';
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ghost_evidence_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtNum = (n: number) => (n || 0).toLocaleString();
  const pct = (part: number, total: number) => total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '0%';

  const ov = analyzeData?.overview;

  return (
    <CyberPanel
      title="GHOST AIRCRAFT FORENSIC ANALYZER"
      icon={<Ghost className="h-5 w-5" />}
      variant="threat"
      className="col-span-full"
      headerActions={
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-8 rounded border border-border bg-background px-2 text-xs font-mono"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <Button onClick={() => run('exportEvidence')} disabled={loading} size="sm" variant="outline" className="gap-1.5">
            {activeStep === 'exportEvidence' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Export Evidence CSV
          </Button>
          <Button onClick={() => run('addColumns')} disabled={loading} size="sm" variant="outline" className="gap-1.5">
            {activeStep === 'addColumns' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
            Add Provenance Cols
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="analyze" className="p-4 space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="analyze">👻 Ghost Analysis</TabsTrigger>
          <TabsTrigger value="attribution">🔗 Attribution</TabsTrigger>
          <TabsTrigger value="masking">🎭 Masking Timeline</TabsTrigger>
          <TabsTrigger value="hourly">🕐 Hourly Masking</TabsTrigger>
        </TabsList>

        {/* ── ANALYSIS ── */}
        <TabsContent value="analyze" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => run('analyze')} disabled={loading} size="sm" className="gap-1.5">
              {activeStep === 'analyze' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ghost className="w-3 h-3" />}
              {activeStep === 'analyze' ? 'Scanning...' : 'Run Ghost Analysis'}
            </Button>
          </div>

          {!ov && !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <Ghost className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Analyze aircraft operating without identity transponder data</p>
              <p className="text-xs">Detects pure ghosts, MLAT-only targets, and identity-masked operations</p>
              <p className="text-xs text-chart-1">Tracked: N912KC, N913KC, N597E, N743AM, N478CA, N4691R, N6196P, N224AM, N184AM, N229AM</p>
            </div>
          )}

          {ov && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Total Detections', value: fmtNum(ov.total_detections), color: 'text-foreground', icon: Radio },
                  { label: 'Pure Ghost (no ID)', value: `${fmtNum(ov.pure_ghost)} (${pct(ov.pure_ghost, ov.total_detections)})`, color: 'text-destructive', icon: Ghost },
                  { label: 'Ghost Low Alt (<1000ft)', value: fmtNum(ov.ghost_low_alt), color: 'text-chart-5', icon: Crosshair },
                  { label: 'Ghost Night Ops', value: fmtNum(ov.ghost_night_ops), color: 'text-chart-1', icon: EyeOff },
                ].map(({ label, value, color, icon: Icon }) => (
                  <div key={label} className="p-3 rounded border border-border bg-muted/20 space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
                    </div>
                    <p className={`font-mono text-lg font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-border rounded p-3">
                  <h4 className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-2">
                    <Eye className="w-3 h-3" /> IDENTITY COVERAGE
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Has ICAO24', value: ov.has_icao24 || 0 },
                          { name: 'Reg Only', value: Math.max(0, (ov.has_registration || 0) - (ov.has_icao24 || 0)) },
                          { name: 'CS Only', value: Math.max(0, (ov.has_callsign || 0) - (ov.has_registration || 0)) },
                          { name: 'Pure Ghost', value: ov.pure_ghost || 0 },
                        ].filter(d => d.value > 0)}
                        dataKey="value" nameKey="name"
                        cx="50%" cy="50%" outerRadius={75}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={false}
                      >
                        <Cell fill="hsl(var(--primary))" />
                        <Cell fill="hsl(var(--chart-2))" />
                        <Cell fill="hsl(var(--chart-5))" />
                        <Cell fill="hsl(var(--destructive))" />
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtNum(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="border border-border rounded p-3">
                  <h4 className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-2">
                    <BarChart3 className="w-3 h-3" /> DAILY GHOST ACTIVITY
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={[...(analyzeData?.dailyTrend || [])].reverse()}>
                      <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(d) => d?.slice(5, 10)} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                      <Tooltip labelFormatter={(d) => `Date: ${d}`} formatter={(v: number) => fmtNum(v)} />
                      <Bar dataKey="total" fill="hsl(var(--muted-foreground))" radius={[2, 2, 0, 0]} opacity={0.3} />
                      <Bar dataKey="ghosts" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Ghosts</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground inline-block opacity-30" /> Total</span>
                  </div>
                </div>
              </div>

              {/* Top ghost profiles */}
              <div className="border border-border rounded p-3">
                <h4 className="text-xs font-mono text-muted-foreground mb-2">TOP GHOST PROFILES</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {(analyzeData?.topGhostProfiles || []).map((g: any, i: number) => (
                      <div key={i} className="p-2 rounded border border-border bg-muted/10 flex items-center justify-between text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Ghost className="w-3 h-3 text-destructive" />
                            <span className="font-mono font-bold">{g.identifier}</span>
                            <Badge variant={g.taxonomy !== 'NONE' ? 'destructive' : 'secondary'} className="text-[9px]">{g.taxonomy}</Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                            <span>Alt: {g.avg_alt}ft (min {g.min_alt}ft)</span>
                            <span>Spd: {g.avg_speed}kt</span>
                            <span>{g.active_days} days</span>
                          </div>
                        </div>
                        <span className="font-mono text-sm font-bold text-destructive">{fmtNum(g.detections)}</span>
                      </div>
                    ))}
                    {(!analyzeData?.topGhostProfiles?.length) && (
                      <p className="text-center text-muted-foreground text-xs py-4">No pure ghost profiles found in this window</p>
                    )}
                  </div>
                </ScrollArea>
              </div>

              {/* Known operators */}
              {analyzeData?.knownOperatorsLowAlt?.length > 0 && (
                <div className="border border-destructive/30 rounded p-3 bg-destructive/5">
                  <h4 className="text-xs font-mono text-destructive mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" /> KNOWN OPERATORS — LOW ALTITUDE ({`<`}1500ft)
                  </h4>
                  <div className="space-y-1">
                    {analyzeData.knownOperatorsLowAlt.map((op: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/10 border border-border text-xs">
                        <span className="font-mono font-bold w-20">{op.registration}</span>
                        <span className="text-destructive font-bold">{fmtNum(op.ghost_adjacent_count)} passes</span>
                        <span>Min: {op.min_alt}ft</span>
                        <span>Avg: {op.avg_alt}ft</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── ATTRIBUTION ── */}
        <TabsContent value="attribution" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Spatiotemporal proximity matching (±5 min, ±0.01° lat/lng) to unmask ghost operators
            </p>
            <Button onClick={() => run('operatorAttribution')} disabled={loading} size="sm" className="gap-1.5">
              {activeStep === 'operatorAttribution' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
              Run Attribution
            </Button>
          </div>

          {attributionData?.operatorAttribution?.length > 0 ? (
            <div className="space-y-2">
              {attributionData.operatorAttribution.map((a: any, i: number) => (
                <div key={i} className="p-3 rounded border border-destructive/30 bg-destructive/5 flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm font-bold">{a.registration}</span>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Ghost avg: {a.ghost_avg_alt}ft | Known avg: {a.known_avg_alt}ft
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-lg font-bold text-destructive">{fmtNum(a.proximity_matches)}</span>
                    <p className="text-[9px] text-muted-foreground">proximity matches</p>
                  </div>
                </div>
              ))}
            </div>
          ) : attributionData ? (
            <p className="text-center py-8 text-muted-foreground text-sm">No proximity matches in {days}-day window</p>
          ) : !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <Shield className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Link ghost detections to known operators by spatiotemporal proximity</p>
            </div>
          )}
        </TabsContent>

        {/* ── MASKING TIMELINE ── */}
        <TabsContent value="masking" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Daily identity-on vs identity-off for 12 tracked operators
            </p>
            <Button onClick={() => run('maskingTimeline')} disabled={loading} size="sm" className="gap-1.5">
              {activeStep === 'maskingTimeline' ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />}
              Load Timeline
            </Button>
          </div>

          {maskingData?.maskingTimeline?.length > 0 ? (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {maskingData.maskingTimeline.map((row: any, i: number) => {
                  const maskPct = row.total_detections > 0 ? ((row.without_identity / row.total_detections) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-3 p-2 rounded border border-border bg-muted/10 text-xs">
                      <span className="font-mono font-bold w-16">{row.registration}</span>
                      <span className="text-muted-foreground w-20">{row.day?.slice(0, 10)}</span>
                      <div className="flex-1 flex items-center gap-2">
                        <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-destructive rounded-full" style={{ width: `${maskPct}%` }} />
                        </div>
                        <span className={`font-mono w-14 text-right ${maskPct > 50 ? 'text-destructive' : 'text-primary'}`}>
                          {maskPct.toFixed(0)}%
                        </span>
                      </div>
                      <span className="text-muted-foreground w-20 text-right">{row.with_identity}✓/{row.without_identity}✗</span>
                      <span className="text-muted-foreground w-16 text-right">{row.avg_alt}ft</span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : maskingData ? (
            <p className="text-center py-8 text-muted-foreground text-sm">No masking data in {days}-day window</p>
          ) : !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <EyeOff className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Identity masking timeline for tracked operators</p>
            </div>
          )}
        </TabsContent>

        {/* ── HOURLY MASKING ── */}
        <TabsContent value="hourly" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Hourly breakdown — detects if identity suppression concentrates during night ops (10PM–5AM)
            </p>
            <Button onClick={() => run('maskingHourly')} disabled={loading} size="sm" className="gap-1.5">
              {activeStep === 'maskingHourly' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
              Load Hourly
            </Button>
          </div>

          {hourlyData?.maskingHourly?.length > 0 ? (() => {
            // Group by registration
            const byReg: Record<string, any[]> = {};
            hourlyData.maskingHourly.forEach((r: any) => {
              if (!byReg[r.registration]) byReg[r.registration] = [];
              byReg[r.registration].push(r);
            });

            return (
              <div className="space-y-4">
                {Object.entries(byReg).map(([reg, rows]) => {
                  const chartData = Array.from({ length: 24 }, (_, h) => {
                    const match = rows.find((r: any) => Number(r.hour) === h);
                    return {
                      hour: h,
                      with_identity: match?.with_identity || 0,
                      without_identity: match?.without_identity || 0,
                    };
                  });
                  const totalMasked = rows.reduce((s: number, r: any) => s + (r.without_identity || 0), 0);
                  const totalAll = rows.reduce((s: number, r: any) => s + (r.total_detections || 0), 0);

                  return (
                    <div key={reg} className="border border-border rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-mono font-bold flex items-center gap-2">
                          <Clock className="w-3 h-3 text-chart-1" />
                          {reg}
                        </h4>
                        <Badge variant={totalMasked > 0 ? 'destructive' : 'secondary'} className="text-[9px]">
                          {pct(totalMasked, totalAll)} masked ({totalMasked}/{totalAll})
                        </Badge>
                      </div>
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={chartData}>
                          <XAxis dataKey="hour" tick={{ fontSize: 8 }} tickFormatter={(h) => `${h}h`} />
                          <YAxis tick={{ fontSize: 8 }} />
                          <Tooltip labelFormatter={(h) => `${h}:00 UTC`} />
                          <Bar dataKey="with_identity" stackId="a" fill="hsl(var(--primary))" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="without_identity" stackId="a" fill="hsl(var(--destructive))" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> Identity ON</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Identity OFF (masked)</span>
                </div>
              </div>
            );
          })() : hourlyData ? (
            <p className="text-center py-8 text-muted-foreground text-sm">No hourly data in {days}-day window</p>
          ) : !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <Clock className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Detect if identity suppression is concentrated during night operations</p>
              <p className="text-xs">22:00–05:00 UTC = Night Ops window</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

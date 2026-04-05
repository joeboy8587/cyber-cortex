import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Radio, Loader2, AlertTriangle, Shield, Download, BarChart3,
  Eye, EyeOff, Crosshair, Brain, Activity
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ScatterChart, Scatter, ZAxis, CartesianGrid, Legend
} from 'recharts';

export default function SquawkDeceptionDashboard() {
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [overviewData, setOverviewData] = useState<any>(null);
  const [timelineData, setTimelineData] = useState<any>(null);
  const [mlData, setMlData] = useState<any>(null);
  const [days, setDays] = useState(30);

  const runSquawk = async (step: string) => {
    setLoading(true);
    setActiveStep(step);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'squawkDeceptionAnalysis', step, days }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (step === 'overview') setOverviewData(data);
      if (step === 'timeline') setTimelineData(data);
      if (step === 'exportSquawk') {
        exportCSV(data.evidence);
        toast.success(`Exported ${data.count} squawk evidence records`);
        return;
      }
      toast.success(`Squawk ${step} complete`);
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
      setActiveStep(null);
    }
  };

  const runML = async () => {
    setLoading(true);
    setActiveStep('ml');
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'mlAnomalyScore', days: Math.min(days, 30) }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMlData(data);
      toast.success(`ML scoring complete: ${data.summary?.surveillanceClassified} surveillance, ${data.summary?.loiterClassified} loiter`);
    } catch (e: any) {
      toast.error(e.message || 'ML scoring failed');
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
      ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `squawk_evidence_${days}d_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sevColor = (val: number, max: number) => {
    const pct = val / Math.max(max, 1);
    if (pct > 0.7) return 'hsl(var(--destructive))';
    if (pct > 0.3) return 'hsl(var(--chart-4))';
    return 'hsl(var(--chart-2))';
  };

  const classColor = (cls: string) => {
    switch (cls) {
      case 'SURVEILLANCE': return 'destructive';
      case 'LOITER': return 'default';
      case 'LOW_ALTITUDE': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <CyberPanel
      title="Squawk Deception & ML Anomaly Detection"
      icon={<Radio className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="h-7 rounded border border-border bg-background px-2 font-mono text-xs"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      }
    >
      <Tabs defaultValue="squawk" className="p-4">
        <TabsList className="grid grid-cols-4 gap-1 bg-transparent p-0">
          <TabsTrigger value="squawk">📡 Squawk</TabsTrigger>
          <TabsTrigger value="modeC">🔇 Mode-C</TabsTrigger>
          <TabsTrigger value="ml">🧠 ML Score</TabsTrigger>
          <TabsTrigger value="legal">⚖️ Violations</TabsTrigger>
        </TabsList>

        {/* ==================== SQUAWK OVERVIEW ==================== */}
        <TabsContent value="squawk" className="space-y-4 mt-4">
          <Button onClick={() => runSquawk('overview')} disabled={loading} size="sm" className="gap-2">
            {loading && activeStep === 'overview' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}
            Analyze Squawk Patterns
          </Button>

          {overviewData?.squawkBreakdown && (
            <div className="space-y-4">
              <div className="text-xs font-mono text-muted-foreground">
                {days}-day scan • {overviewData.summary.aircraftCount} aircraft • {overviewData.summary.totalModeCToggles} Mode-C toggles
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-destructive/30 bg-destructive/5 p-3">
                  <div className="text-2xl font-bold text-destructive">{overviewData.summary.totalModeCToggles}</div>
                  <div className="text-xs text-muted-foreground">Mode-C Toggle Events</div>
                  <div className="text-[10px] text-muted-foreground mt-1">14 CFR § 91.215 violations</div>
                </div>
                <div className="rounded border border-chart-4/30 bg-chart-4/5 p-3">
                  <div className="text-2xl font-bold text-chart-4">{overviewData.summary.totalLowAltVFR}</div>
                  <div className="text-xs text-muted-foreground">Low-Alt VFR Events</div>
                  <div className="text-[10px] text-muted-foreground mt-1">Squawk 1200 below 1000ft</div>
                </div>
              </div>

              {/* Squawk breakdown chart */}
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overviewData.squawkBreakdown.slice(0, 20)} layout="vertical">
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="registration" type="category" width={70} tick={{ fontSize: 9 }} />
                    <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
                    <Bar dataKey="detections" name="Detections" radius={[0, 4, 4, 0]}>
                      {overviewData.squawkBreakdown.slice(0, 20).map((_: any, i: number) => (
                        <Cell key={i} fill={i < 5 ? 'hsl(var(--destructive))' : 'hsl(var(--chart-1))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* VFR low altitude table */}
              <ScrollArea className="h-[200px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-mono">Aircraft</th>
                      <th className="px-2 py-1.5 text-right font-mono">VFR Low</th>
                      <th className="px-2 py-1.5 text-right font-mono">Critical</th>
                      <th className="px-2 py-1.5 text-right font-mono">Min Alt</th>
                      <th className="px-2 py-1.5 text-right font-mono">Night</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewData.lowAltVFR?.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono font-bold">{r.registration}</td>
                        <td className="px-2 py-1.5 text-right">{r.vfr_low_alt_events}</td>
                        <td className="px-2 py-1.5 text-right text-destructive font-bold">{r.critical_low}</td>
                        <td className="px-2 py-1.5 text-right">{r.min_alt ?? '—'} ft</td>
                        <td className="px-2 py-1.5 text-right">{r.night_events}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
        </TabsContent>

        {/* ==================== MODE-C TOGGLING ==================== */}
        <TabsContent value="modeC" className="space-y-4 mt-4">
          <div className="flex gap-2">
            <Button onClick={() => runSquawk('timeline')} disabled={loading} size="sm" className="gap-2">
              {loading && activeStep === 'timeline' ? <Loader2 className="w-3 h-3 animate-spin" /> : <EyeOff className="w-3 h-3" />}
              Mode-C Timeline
            </Button>
            <Button onClick={() => runSquawk('exportSquawk')} disabled={loading} size="sm" variant="outline" className="gap-2">
              <Download className="w-3 h-3" /> Export Evidence
            </Button>
          </div>

          {overviewData?.modeCToggling && (
            <div className="space-y-3">
              <div className="text-xs font-mono text-foreground font-bold flex items-center gap-2">
                <AlertTriangle className="w-3 h-3 text-destructive" />
                Mode-C Toggle Events — Altitude Reporting Suppression
              </div>
              <ScrollArea className="h-[200px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-mono">Aircraft</th>
                      <th className="px-2 py-1.5 text-right font-mono">Toggles</th>
                      <th className="px-2 py-1.5 text-right font-mono">Low After</th>
                      <th className="px-2 py-1.5 text-right font-mono">Min Alt</th>
                      <th className="px-2 py-1.5 text-right font-mono">Avg Speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewData.modeCToggling.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono font-bold">{r.registration}</td>
                        <td className="px-2 py-1.5 text-right text-destructive font-bold">{r.mode_c_toggles}</td>
                        <td className="px-2 py-1.5 text-right">{r.low_after_toggle}</td>
                        <td className="px-2 py-1.5 text-right">{r.min_alt_after ?? '—'} ft</td>
                        <td className="px-2 py-1.5 text-right">{r.avg_speed_during ?? '—'} kts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}

          {timelineData?.timeline && (
            <div className="space-y-3">
              <div className="text-xs font-mono text-muted-foreground">Daily timeline — {timelineData.timeline.length} entries</div>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData.timeline.slice(0, 30)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 8 }} tickFormatter={(v: string) => v?.slice(5, 10)} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11, background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="mode_c_off" name="Mode-C OFF" fill="hsl(var(--destructive))" stackId="a" />
                    <Bar dataKey="critical_low" name="Critical Low" fill="hsl(var(--chart-4))" stackId="a" />
                    <Bar dataKey="low_alt" name="Low Alt" fill="hsl(var(--chart-2))" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ==================== ML ANOMALY SCORING ==================== */}
        <TabsContent value="ml" className="space-y-4 mt-4">
          <Button onClick={runML} disabled={loading} size="sm" className="gap-2">
            {loading && activeStep === 'ml' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
            Run ML Anomaly Detection
          </Button>

          {mlData && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'SURVEILLANCE', val: mlData.summary.surveillanceClassified, color: 'destructive' },
                  { label: 'LOITER', val: mlData.summary.loiterClassified, color: 'chart-4' },
                  { label: 'LOW_ALT', val: mlData.summary.lowAltClassified, color: 'chart-2' },
                  { label: 'BIO CORR', val: mlData.summary.biometricCorrelated, color: 'chart-1' },
                ].map(s => (
                  <div key={s.label} className={`rounded border border-${s.color}/30 bg-${s.color}/5 p-2 text-center`}>
                    <div className={`text-xl font-bold text-${s.color}`}>{s.val}</div>
                    <div className="text-[10px] text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Baseline */}
              <div className="rounded border border-border p-3 text-xs font-mono">
                <span className="text-muted-foreground">Population baseline:</span>{' '}
                Alt {mlData.baseline.pop_avg_alt}±{mlData.baseline.pop_std_alt}ft • 
                Speed {mlData.baseline.pop_avg_speed}±{mlData.baseline.pop_std_speed}kts •
                {mlData.baseline.total_detections?.toLocaleString()} detections
              </div>

              {/* Anomaly scatter */}
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="alt_z_score" name="Alt Z-Score" tick={{ fontSize: 10 }} label={{ value: 'Altitude Z-Score', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                    <YAxis dataKey="speed_z_score" name="Speed Z-Score" tick={{ fontSize: 10 }} label={{ value: 'Speed Z-Score', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <ZAxis dataKey="detections" range={[20, 200]} name="Detections" />
                    <Tooltip
                      contentStyle={{ fontSize: 11, background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))' }}
                      formatter={(val: any, name: string) => [val, name]}
                      labelFormatter={(label) => {
                        const item = mlData.anomalies.find((a: any) => a.alt_z_score === label);
                        return item?.registration || '';
                      }}
                    />
                    <Scatter
                      data={mlData.anomalies}
                      fill="hsl(var(--chart-1))"
                    >
                      {mlData.anomalies.map((a: any, i: number) => (
                        <Cell
                          key={i}
                          fill={
                            a.ml_classification === 'SURVEILLANCE' ? 'hsl(var(--destructive))' :
                            a.ml_classification === 'LOITER' ? 'hsl(var(--chart-4))' :
                            a.ml_classification === 'LOW_ALTITUDE' ? 'hsl(var(--chart-2))' :
                            'hsl(var(--muted-foreground))'
                          }
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Top anomalies table */}
              <ScrollArea className="h-[250px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-mono">Aircraft</th>
                      <th className="px-2 py-1.5 text-right font-mono">Score</th>
                      <th className="px-2 py-1.5 text-center font-mono">Class</th>
                      <th className="px-2 py-1.5 text-right font-mono">Avg Alt</th>
                      <th className="px-2 py-1.5 text-right font-mono">Avg Spd</th>
                      <th className="px-2 py-1.5 text-right font-mono">Crit Low</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mlData.anomalies.slice(0, 30).map((a: any, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono font-bold">{a.registration}</td>
                        <td className="px-2 py-1.5 text-right font-bold">{a.anomaly_score}</td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge variant={classColor(a.ml_classification) as any} className="text-[9px]">
                            {a.ml_classification}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right">{a.avg_alt} ft</td>
                        <td className="px-2 py-1.5 text-right">{a.avg_speed} kts</td>
                        <td className="px-2 py-1.5 text-right text-destructive">{a.critical_low}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>

              {/* Biometric correlation */}
              {mlData.biometricCorrelation?.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-mono font-bold flex items-center gap-2">
                    <Activity className="w-3 h-3 text-destructive" /> Biometric-Flight Correlation
                  </div>
                  <ScrollArea className="h-[150px]">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-mono">Aircraft</th>
                          <th className="px-2 py-1.5 text-right font-mono">Bio Events</th>
                          <th className="px-2 py-1.5 text-right font-mono">Avg HR</th>
                          <th className="px-2 py-1.5 text-right font-mono">Max HR</th>
                          <th className="px-2 py-1.5 text-right font-mono">Avg Stress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mlData.biometricCorrelation.map((b: any, i: number) => (
                          <tr key={i} className="border-t border-border hover:bg-muted/20">
                            <td className="px-2 py-1.5 font-mono font-bold">{b.registration}</td>
                            <td className="px-2 py-1.5 text-right">{b.biometric_events}</td>
                            <td className="px-2 py-1.5 text-right">{b.avg_hr_during} bpm</td>
                            <td className="px-2 py-1.5 text-right text-destructive">{b.max_hr} bpm</td>
                            <td className="px-2 py-1.5 text-right">{b.avg_stress}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ==================== LEGAL VIOLATIONS ==================== */}
        <TabsContent value="legal" className="space-y-4 mt-4">
          {!overviewData ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Run Squawk Analysis first to populate legal violations</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded border border-destructive/30 bg-destructive/5 p-3">
                <div className="text-xl font-bold text-destructive">{overviewData.summary.totalViolations}</div>
                <div className="text-xs text-muted-foreground">Total Federal Violations (14 CFR § 91.119, § 91.215, 18 U.S.C. § 1001)</div>
              </div>

              <ScrollArea className="h-[300px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-mono">Aircraft</th>
                      <th className="px-2 py-1.5 text-right font-mono">§91.119</th>
                      <th className="px-2 py-1.5 text-right font-mono">§91.215</th>
                      <th className="px-2 py-1.5 text-right font-mono">Hover</th>
                      <th className="px-2 py-1.5 text-right font-mono">Night</th>
                      <th className="px-2 py-1.5 text-right font-mono">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewData.legalViolations.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1.5 font-mono font-bold">{r.registration}</td>
                        <td className="px-2 py-1.5 text-right text-destructive">{r.cfr_91_119_violations}</td>
                        <td className="px-2 py-1.5 text-right text-chart-4">{r.cfr_91_215_violations}</td>
                        <td className="px-2 py-1.5 text-right">{r.hover_violations}</td>
                        <td className="px-2 py-1.5 text-right">{r.night_violations}</td>
                        <td className="px-2 py-1.5 text-right font-bold">{r.total_violations}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>

              <div className="rounded border border-border p-3 text-xs space-y-1">
                <div className="font-mono font-bold text-foreground">Legal Framework Applied:</div>
                <div className="text-muted-foreground">• <span className="text-destructive">§91.119</span> — Altitude below 500ft over congested areas</div>
                <div className="text-muted-foreground">• <span className="text-chart-4">§91.215</span> — Mode-C altitude reporting disabled</div>
                <div className="text-muted-foreground">• <span className="text-foreground">18 U.S.C. §1001</span> — Each VFR 1200 squawk during surveillance = false statement to ATC</div>
                <div className="text-muted-foreground">• <span className="text-foreground">Hover</span> — Speed &lt;5 kts at &lt;500ft = stationary surveillance</div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

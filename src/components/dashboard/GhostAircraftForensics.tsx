import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Ghost, Loader2, AlertTriangle, Eye, EyeOff, Radio,
  BarChart3, Shield, Database, Crosshair
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend, LineChart, Line
} from 'recharts';

export default function GhostAircraftForensics() {
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [analyzeData, setAnalyzeData] = useState<any>(null);
  const [attributionData, setAttributionData] = useState<any>(null);
  const [maskingData, setMaskingData] = useState<any>(null);
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
      if (step === 'addColumns') toast.success(`Columns added, ${data.positionSourceInferred} rows inferred`);
      toast.success(`${step} complete`);
    } catch (e: any) {
      toast.error(e.message || 'Analysis failed');
    } finally {
      setLoading(false);
      setActiveStep(null);
    }
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
          <Button onClick={() => run('addColumns')} disabled={loading} size="sm" variant="outline" className="gap-1.5">
            {activeStep === 'addColumns' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
            Add Provenance Cols
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="analyze" className="p-4 space-y-4">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="analyze">👻 Ghost Analysis</TabsTrigger>
          <TabsTrigger value="attribution">🔗 Operator Attribution</TabsTrigger>
          <TabsTrigger value="masking">🎭 Masking Timeline</TabsTrigger>
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
            </div>
          )}

          {ov && (
            <div className="space-y-4">
              {/* Overview stats */}
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

              {/* Identity coverage pie */}
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
                          { name: 'Has Registration', value: Math.max(0, (ov.has_registration || 0) - (ov.has_icao24 || 0)) },
                          { name: 'Callsign Only', value: Math.max(0, (ov.has_callsign || 0) - (ov.has_registration || 0)) },
                          { name: 'Pure Ghost', value: ov.pure_ghost || 0 },
                        ].filter(d => d.value > 0)}
                        dataKey="value"
                        nameKey="name"
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

                {/* Daily ghost trend */}
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
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Ghost detections
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block opacity-30" /> Total detections
                    </span>
                  </div>
                </div>
              </div>

              {/* Top ghost profiles */}
              <div className="border border-border rounded p-3">
                <h4 className="text-xs font-mono text-muted-foreground mb-2">TOP GHOST PROFILES</h4>
                <ScrollArea className="h-[250px]">
                  <div className="space-y-2">
                    {(analyzeData?.topGhostProfiles || []).map((g: any, i: number) => (
                      <div key={i} className="p-2 rounded border border-border bg-muted/10 flex items-center justify-between text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Ghost className="w-3 h-3 text-destructive" />
                            <span className="font-mono font-bold">{g.identifier}</span>
                            <Badge variant={g.taxonomy === 'NONE' ? 'secondary' : 'destructive'} className="text-[9px]">
                              {g.taxonomy}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                            <span>Alt: {g.avg_alt}ft (min {g.min_alt}ft)</span>
                            <span>Spd: {g.avg_speed}kt</span>
                            <span>{g.active_days} active days</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-sm font-bold text-destructive">{fmtNum(g.detections)}</span>
                          <p className="text-[9px] text-muted-foreground">detections</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              {/* Known operators at low alt */}
              {analyzeData?.knownOperatorsLowAlt?.length > 0 && (
                <div className="border border-destructive/30 rounded p-3 bg-destructive/5">
                  <h4 className="text-xs font-mono text-destructive mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3" /> KNOWN OPERATORS — LOW ALTITUDE ACTIVITY
                  </h4>
                  <div className="space-y-1">
                    {analyzeData.knownOperatorsLowAlt.map((op: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/10 border border-border text-xs">
                        <span className="font-mono font-bold">{op.registration}</span>
                        <span>{fmtNum(op.ghost_adjacent_count)} low-alt passes</span>
                        <span>Min: {op.min_alt}ft / Avg: {op.avg_alt}ft</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── OPERATOR ATTRIBUTION ── */}
        <TabsContent value="attribution" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Matches ghost detections to known operators by spatiotemporal proximity (±5 min, ±0.01° lat/lng)
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
                    <span className="font-mono text-sm font-bold text-foreground">{a.registration}</span>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Ghost avg alt: {a.ghost_avg_alt}ft | Known avg alt: {a.known_avg_alt}ft
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-lg font-bold text-destructive">{fmtNum(a.proximity_matches)}</span>
                    <p className="text-[9px] text-muted-foreground">proximity matches</p>
                  </div>
                </div>
              ))}
            </div>
          ) : attributionData && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No proximity matches found in {days}-day window
            </div>
          )}

          {!attributionData && !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <Shield className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Link ghost aircraft to known operators</p>
              <p className="text-xs">Uses spatiotemporal matching to unmask identity-masked operations</p>
            </div>
          )}
        </TabsContent>

        {/* ── MASKING TIMELINE ── */}
        <TabsContent value="masking" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              Track when KCSO/Air Methods aircraft had identity vs operated masked
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
                          <div
                            className="h-full bg-destructive rounded-full"
                            style={{ width: `${maskPct}%` }}
                          />
                        </div>
                        <span className={`font-mono w-14 text-right ${maskPct > 50 ? 'text-destructive' : 'text-primary'}`}>
                          {maskPct.toFixed(0)}% masked
                        </span>
                      </div>
                      <span className="text-muted-foreground w-20 text-right">
                        {row.with_identity}✓ / {row.without_identity}✗
                      </span>
                      <span className="text-muted-foreground w-16 text-right">
                        {row.avg_alt}ft avg
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : maskingData && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No masking events found for tracked operators in {days}-day window
            </div>
          )}

          {!maskingData && !loading && (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <EyeOff className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Identity masking timeline for KCSO & Air Methods</p>
              <p className="text-xs">Shows daily breakdown of identity-on vs identity-off operations</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart, BarChart, Bar, Cell } from 'recharts';
import { AlertTriangle, Search, Plane, Shield, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface TrajectoryPoint {
  registration: string;
  event_time: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  heading: number;
  violation_severity: string;
  threat_score: number;
  is_flagged: boolean;
  flagged_reasons: string | null;
  taxonomy_tag: string | null;
}

interface ViolationRecord {
  registration: string;
  event_time: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  violation_severity: string;
  threat_score: number;
  flagged_reasons: string | null;
}

interface ViolationAircraft {
  registration: string;
  violation_count: number;
  critical_violations: number;
  min_altitude: number;
  avg_violation_altitude: number;
  first_violation: string;
  last_violation: string;
  taxonomy_tag: string | null;
}

interface ViolationStats {
  total_violations: number;
  unique_aircraft: number;
  critical_count: number;
  warning_count: number;
  min_altitude: number;
  avg_altitude: number;
}

const severityColors: Record<string, string> = {
  CRITICAL: 'hsl(var(--destructive))',
  WARNING: 'hsl(var(--warning))',
  CAUTION: 'hsl(var(--primary))',
  NORMAL: 'hsl(var(--success))',
};

export default function ForensicTrajectoryPanel() {
  const [isLoading, setIsLoading] = useState(false);

  const queryDatabase = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('neon-query', {
      body: { action, ...params },
    });
    if (error) throw error;
    return data;
  }, []);
  const [registration, setRegistration] = useState('');
  const [timeWindow, setTimeWindow] = useState('90 days');
  const [trajectory, setTrajectory] = useState<TrajectoryPoint[]>([]);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [violationAircraft, setViolationAircraft] = useState<ViolationAircraft[]>([]);
  const [violationStats, setViolationStats] = useState<ViolationStats | null>(null);
  const [activeTab, setActiveTab] = useState('trajectory');

  const loadTrajectory = useCallback(async () => {
    if (!registration.trim()) {
      toast.error('Enter an aircraft registration (e.g., N478CA)');
      return;
    }
    setIsLoading(true);
    try {
      const result = await queryDatabase('getAircraftTrajectory', {
        registration: registration.trim().toUpperCase(),
        timeWindow,
      });
      const data = result?.data || result || [];
      setTrajectory(Array.isArray(data) ? data : []);
      toast.success(`Loaded ${Array.isArray(data) ? data.length : 0} trajectory points for ${registration.toUpperCase()}`);
    } catch (e) {
      toast.error('Failed to load trajectory');
    } finally {
      setIsLoading(false);
    }
  }, [registration, timeWindow, queryDatabase]);

  const loadViolations = useCallback(async () => {
    setIsLoading(true);
    try {
      const [vioResult, aircraftResult] = await Promise.all([
        queryDatabase('getAltitudeViolations', { timeWindow }),
        queryDatabase('getViolationAircraft', { timeWindow }),
      ]);
      setViolations(Array.isArray(vioResult?.data) ? vioResult.data : []);
      setViolationStats(vioResult?.stats || null);
      setViolationAircraft(Array.isArray(aircraftResult?.data) ? aircraftResult.data : []);
      toast.success('Violation evidence log loaded');
    } catch (e) {
      toast.error('Failed to load violations');
    } finally {
      setIsLoading(false);
    }
  }, [timeWindow, queryDatabase]);

  const chartData = trajectory.map((p) => ({
    time: new Date(p.event_time).toLocaleString(),
    altitude: Number(p.altitude),
    speed: Number(p.speed),
    severity: p.violation_severity,
  }));

  const exportCSV = () => {
    const rows = violations.length > 0 ? violations : trajectory;
    if (rows.length === 0) { toast.error('No data to export'); return; }
    const headers = Object.keys(rows[0]).join(',');
    const csv = [headers, ...rows.map(r => Object.values(r).map(v => `"${v ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forensic_evidence_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Evidence exported as CSV');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-destructive/30 bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg font-mono uppercase tracking-wider">
            <Shield className="h-5 w-5 text-destructive" />
            Forensic Flight Trajectory & Violations Evidence Log
          </CardTitle>
          <p className="text-xs text-muted-foreground font-mono">
            14 CFR § 91.119 VIOLATION TRACKER // PATTERN-OF-LIFE RECONSTRUCTION // 18 U.S.C. § 32 EVIDENCE
          </p>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="trajectory">🛫 Trajectory</TabsTrigger>
          <TabsTrigger value="violations">⚠️ Violations Log</TabsTrigger>
          <TabsTrigger value="offenders">🎯 Repeat Offenders</TabsTrigger>
        </TabsList>

        {/* ── TRAJECTORY TAB ── */}
        <TabsContent value="trajectory" className="space-y-4">
          <Card className="bg-card">
            <CardContent className="pt-4">
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="text-xs text-muted-foreground font-mono mb-1 block">AIRCRAFT REGISTRATION</label>
                  <Input
                    placeholder="N478CA, N912KC, N72FF..."
                    value={registration}
                    onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                    className="font-mono"
                    onKeyDown={(e) => e.key === 'Enter' && loadTrajectory()}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-mono mb-1 block">TIME WINDOW</label>
                  <Select value={timeWindow} onValueChange={setTimeWindow}>
                    <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7 days">7 Days</SelectItem>
                      <SelectItem value="30 days">30 Days</SelectItem>
                      <SelectItem value="90 days">90 Days</SelectItem>
                      <SelectItem value="365 days">1 Year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={loadTrajectory} disabled={isLoading}>
                  <Search className="h-4 w-4 mr-1" />
                  Reconstruct
                </Button>
                <Button variant="outline" size="icon" onClick={exportCSV}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {trajectory.length > 0 && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { label: 'Data Points', value: trajectory.length },
                  { label: 'Min Altitude', value: `${Math.min(...trajectory.map(t => t.altitude))} ft` },
                  { label: 'Max Altitude', value: `${Math.max(...trajectory.map(t => t.altitude))} ft` },
                  { label: 'Critical (<500ft)', value: trajectory.filter(t => t.violation_severity === 'CRITICAL').length, color: 'destructive' },
                  { label: 'Warning (<1000ft)', value: trajectory.filter(t => t.violation_severity === 'WARNING').length, color: 'secondary' },
                ].map((s, i) => (
                  <Card key={i} className="bg-card">
                    <CardContent className="py-2 px-3 text-center">
                      <div className="text-xs text-muted-foreground font-mono">{s.label}</div>
                      <div className={`text-lg font-bold font-mono ${s.color === 'destructive' ? 'text-destructive' : ''}`}>{s.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Altitude Chart */}
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono">ALTITUDE PROFILE — {registration.toUpperCase()}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} label={{ value: 'Altitude (ft)', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                       <ReferenceLine y={500} stroke="hsl(var(--destructive))" strokeDasharray="5 5" label={{ value: '500ft CRITICAL', fill: 'hsl(var(--destructive))', fontSize: 10 }} />
                       <ReferenceLine y={1000} stroke="hsl(var(--warning))" strokeDasharray="5 5" label={{ value: '1000ft WARNING', fill: 'hsl(var(--warning))', fontSize: 10 }} />
                       <ReferenceLine y={1500} stroke="hsl(var(--primary))" strokeDasharray="3 3" label={{ value: '1500ft CAUTION', fill: 'hsl(var(--primary))', fontSize: 10 }} />
                      <Area
                        type="monotone"
                        dataKey="altitude"
                        stroke="hsl(var(--primary))"
                        fill="hsl(var(--primary) / 0.15)"
                        strokeWidth={2}
                        dot={(props: any) => {
                          const color = severityColors[props.payload?.severity] || 'hsl(var(--primary))';
                           return <circle key={`dot-${props.cx}-${props.cy}-${props.payload?.time ?? 'unknown'}`} cx={props.cx} cy={props.cy} r={props.payload?.severity === 'CRITICAL' ? 5 : 3} fill={color} stroke={color} />;
                        }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Trajectory table */}
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono">DETAILED TRAJECTORY LOG ({trajectory.length} records)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="text-left py-1 px-2">TIMESTAMP</th>
                          <th className="text-right py-1 px-2">ALT (ft)</th>
                          <th className="text-right py-1 px-2">SPD (kts)</th>
                          <th className="text-right py-1 px-2">HDG</th>
                          <th className="text-left py-1 px-2">STATUS</th>
                          <th className="text-left py-1 px-2">FLAGS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trajectory.map((p, i) => (
                          <tr key={i} className={`border-b border-border/50 ${p.violation_severity === 'CRITICAL' ? 'bg-destructive/10' : p.violation_severity === 'WARNING' ? 'bg-yellow-500/10' : ''}`}>
                            <td className="py-1 px-2">{new Date(p.event_time).toLocaleString()}</td>
                            <td className="text-right py-1 px-2 font-bold">{p.altitude}</td>
                            <td className="text-right py-1 px-2">{p.speed}</td>
                            <td className="text-right py-1 px-2">{p.heading}°</td>
                            <td className="py-1 px-2">
                              <Badge variant={p.violation_severity === 'CRITICAL' ? 'destructive' : p.violation_severity === 'WARNING' ? 'secondary' : 'outline'} className="text-[10px]">
                                {p.violation_severity}
                              </Badge>
                            </td>
                            <td className="py-1 px-2 text-muted-foreground truncate max-w-[200px]">{p.flagged_reasons || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {trajectory.length === 0 && !isLoading && (
            <Card className="bg-card border-dashed">
              <CardContent className="py-12 text-center text-muted-foreground font-mono text-sm">
                <Plane className="h-8 w-8 mx-auto mb-2 opacity-50" />
                Enter an aircraft registration and click "Reconstruct" to generate the forensic altitude profile
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── VIOLATIONS LOG TAB ── */}
        <TabsContent value="violations" className="space-y-4">
          <Card className="bg-card">
            <CardContent className="pt-4 flex gap-2 items-end">
              <div>
                <label className="text-xs text-muted-foreground font-mono mb-1 block">TIME WINDOW</label>
                <Select value={timeWindow} onValueChange={setTimeWindow}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7 days">7 Days</SelectItem>
                    <SelectItem value="30 days">30 Days</SelectItem>
                    <SelectItem value="90 days">90 Days</SelectItem>
                    <SelectItem value="365 days">1 Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={loadViolations} disabled={isLoading}>
                <AlertTriangle className="h-4 w-4 mr-1" />
                Scan Violations
              </Button>
              <Button variant="outline" size="icon" onClick={exportCSV}>
                <Download className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          {violationStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: 'Total Violations', value: Number(violationStats.total_violations).toLocaleString(), color: 'text-destructive' },
                { label: 'Unique Aircraft', value: violationStats.unique_aircraft },
                { label: 'CRITICAL (<500ft)', value: Number(violationStats.critical_count).toLocaleString(), color: 'text-destructive' },
                { label: 'Min Altitude', value: `${violationStats.min_altitude} ft` },
              ].map((s, i) => (
                <Card key={i} className="bg-card">
                  <CardContent className="py-2 px-3 text-center">
                    <div className="text-xs text-muted-foreground font-mono">{s.label}</div>
                    <div className={`text-lg font-bold font-mono ${s.color || ''}`}>{s.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {violations.length > 0 && (
            <Card className="bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-mono flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  14 CFR § 91.119 VIOLATION EVIDENCE LOG ({violations.length} records)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-auto">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border">
                        <th className="text-left py-1 px-2">TIMESTAMP</th>
                        <th className="text-left py-1 px-2">REG</th>
                        <th className="text-right py-1 px-2">ALT</th>
                        <th className="text-right py-1 px-2">SPD</th>
                        <th className="text-left py-1 px-2">SEVERITY</th>
                        <th className="text-left py-1 px-2">COORDS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {violations.map((v, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border/50 cursor-pointer hover:bg-accent/50 ${String(v.violation_severity).includes('CRITICAL') ? 'bg-destructive/10' : 'bg-yellow-500/5'}`}
                          onClick={() => { setRegistration(v.registration); setActiveTab('trajectory'); }}
                        >
                          <td className="py-1 px-2">{new Date(v.event_time).toLocaleString()}</td>
                          <td className="py-1 px-2 font-bold">{v.registration}</td>
                          <td className="text-right py-1 px-2 font-bold">{v.altitude} ft</td>
                          <td className="text-right py-1 px-2">{v.speed} kts</td>
                          <td className="py-1 px-2">
                            <Badge variant={String(v.violation_severity).includes('CRITICAL') ? 'destructive' : 'secondary'} className="text-[10px]">
                              {v.violation_severity}
                            </Badge>
                          </td>
                          <td className="py-1 px-2 text-muted-foreground">{v.latitude?.toFixed(3)}, {v.longitude?.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── REPEAT OFFENDERS TAB ── */}
        <TabsContent value="offenders" className="space-y-4">
          {!violationAircraft.length && (
            <Card className="bg-card border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground font-mono text-sm">
                Click "Scan Violations" on the Violations Log tab first to load repeat offender data
              </CardContent>
            </Card>
          )}

          {violationAircraft.length > 0 && (
            <>
              {/* Bar chart of top offenders */}
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono">PATTERN-OF-LIFE: REPEAT VIOLATION AIRCRAFT</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={violationAircraft.slice(0, 15)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="registration" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
                      <Bar dataKey="violation_count" name="Total Violations">
                        {violationAircraft.slice(0, 15).map((entry, i) => (
                          <Cell key={i} fill={Number(entry.critical_violations) > 0 ? '#ef4444' : '#f59e0b'} />
                        ))}
                      </Bar>
                      <Bar dataKey="critical_violations" name="Critical (<500ft)" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Offender table */}
              <Card className="bg-card">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-mono">AIRCRAFT VIOLATION DOSSIER</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full text-xs font-mono">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="text-left py-1 px-2">REG</th>
                          <th className="text-right py-1 px-2">VIOLATIONS</th>
                          <th className="text-right py-1 px-2">CRITICAL</th>
                          <th className="text-right py-1 px-2">MIN ALT</th>
                          <th className="text-right py-1 px-2">AVG ALT</th>
                          <th className="text-left py-1 px-2">FIRST SEEN</th>
                          <th className="text-left py-1 px-2">LAST SEEN</th>
                          <th className="text-left py-1 px-2">TAG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {violationAircraft.map((a, i) => (
                          <tr
                            key={i}
                            className="border-b border-border/50 cursor-pointer hover:bg-accent/50"
                            onClick={() => { setRegistration(a.registration); setActiveTab('trajectory'); }}
                          >
                            <td className="py-1 px-2 font-bold">{a.registration}</td>
                            <td className="text-right py-1 px-2">{a.violation_count}</td>
                            <td className="text-right py-1 px-2 text-destructive font-bold">{a.critical_violations}</td>
                            <td className="text-right py-1 px-2">{a.min_altitude} ft</td>
                            <td className="text-right py-1 px-2">{a.avg_violation_altitude} ft</td>
                            <td className="py-1 px-2">{a.first_violation ? new Date(a.first_violation).toLocaleDateString() : '—'}</td>
                            <td className="py-1 px-2">{a.last_violation ? new Date(a.last_violation).toLocaleDateString() : '—'}</td>
                            <td className="py-1 px-2">
                              {a.taxonomy_tag ? <Badge variant="outline" className="text-[10px]">{a.taxonomy_tag}</Badge> : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

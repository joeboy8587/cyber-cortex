import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { useToast } from "@/hooks/use-toast";
import {
  Radio,
  Shield,
  AlertTriangle,
  Ghost,
  Activity,
  Eye,
  Loader2,
  RefreshCw,
  BarChart3,
  Calendar,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ComposedChart, Area, Legend, Cell, PieChart, Pie,
} from "recharts";

interface ModeCount {
  transponder_mode: string;
  registration_status: string;
  count: number;
  unique_aircraft: number;
  avg_altitude: number;
  avg_speed: number;
  flagged_count: number;
}

interface GhostEntry {
  icao_code: string;
  tail_number_count: number;
  total_detections: number;
  registrations: string[];
  avg_altitude: number;
  avg_speed: number;
  first_seen: string;
  last_seen: string;
}

interface ScoredAircraft {
  identifier: string;
  registration: string;
  icao_code: string;
  total_detections: number;
  blocked_count: number;
  low_altitude_count: number;
  loiter_count: number;
  night_ops: number;
  avg_altitude: number;
  avg_speed: number;
  ghost_score: number;
  classification: string;
  taxonomy_tag: string;
  active_days: number;
}

interface ModeSwitcher {
  icao_code: string;
  identity_count: number;
  known_registrations: string[];
  total_detections: number;
  deception_type: string;
  has_blocked: boolean;
  has_visible: boolean;
}

const COLORS = {
  CONFIRMED_GHOST: 'hsl(var(--destructive))',
  LIKELY_GHOST: 'hsl(var(--chart-1))',
  SURVEILLANCE_PATTERN: 'hsl(var(--chart-2))',
  NIGHT_OPERATOR: 'hsl(var(--chart-3))',
  POSSIBLE_DRONE: 'hsl(var(--chart-4))',
  MONITOR: 'hsl(var(--chart-5))',
};

const MODE_COLORS: Record<string, string> = {
  MODE_S: 'hsl(var(--chart-1))',
  MODE_C: 'hsl(var(--chart-2))',
  MODE_A: 'hsl(var(--chart-3))',
  UNKNOWN: 'hsl(var(--chart-4))',
};

export default function TransponderAnalysisDashboard() {
  const { customQuery } = useNeonDatabase();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [modeData, setModeData] = useState<any>(null);
  const [ghostScores, setGhostScores] = useState<any>(null);
  const [switcherData, setSwitcherData] = useState<any>(null);
  const [timeWindow, setTimeWindow] = useState('30 days');

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const { neonQuery } = await import('@/lib/neonQueryRetry');
      const [modeRes, scoreRes, switchRes] = await Promise.all([
        neonQuery({ action: 'transponderModeAnalysis', timeWindow, kernCountyOnly: true }),
        neonQuery({ action: 'ghostFleetScore', timeWindow, kernCountyOnly: true }),
        neonQuery({ action: 'transponderModeSwitching', timeWindow, kernCountyOnly: true }),
      ]);
      if (modeRes.data) setModeData(modeRes.data);
      if (scoreRes.data) setGhostScores(scoreRes.data);
      if (switchRes.data) setSwitcherData(switchRes.data);
      toast({ title: "Analysis complete", description: "Transponder mode analysis finished" });
    } catch (e) {
      toast({ title: "Analysis failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [timeWindow, toast]);

  useEffect(() => { runAnalysis(); }, []);

  // Prepare pie chart data for mode breakdown
  const modeBreakdown = modeData?.modeCounts
    ? Object.entries(
        (modeData.modeCounts as ModeCount[]).reduce((acc, r) => {
          acc[r.transponder_mode] = (acc[r.transponder_mode] || 0) + r.count;
          return acc;
        }, {} as Record<string, number>)
      ).map(([name, value]) => ({ name, value }))
    : [];

  const registrationBreakdown = modeData?.modeCounts
    ? Object.entries(
        (modeData.modeCounts as ModeCount[]).reduce((acc, r) => {
          acc[r.registration_status] = (acc[r.registration_status] || 0) + r.count;
          return acc;
        }, {} as Record<string, number>)
      ).map(([name, value]) => ({ name, value }))
    : [];

  // Merge blocked timeline with biometric overlay
  const calendarData = modeData?.blockedTimeline?.map((day: any) => {
    const bio = modeData.biometricOverlay?.find((b: any) => b.date === day.date);
    return {
      ...day,
      avg_hr: bio?.avg_hr || null,
      max_hr: bio?.max_hr || null,
      elevated_hr: bio?.elevated_count || 0,
    };
  }) || [];

  const classificationCounts = ghostScores?.classifications || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <CyberPanel
        title="Systematic Transponder Analysis Protocol"
        icon={<Radio className="w-4 h-4" />}
        headerActions={
          <div className="flex items-center gap-2">
            <select
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value)}
              className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"
            >
              <option value="7 days">7 Days</option>
              <option value="30 days">30 Days</option>
              <option value="90 days">90 Days</option>
              <option value="365 days">1 Year</option>
            </select>
            <Button size="sm" onClick={runAnalysis} disabled={loading} className="gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Analyze
            </Button>
          </div>
        }
      >
        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 p-4">
          {registrationBreakdown.map((item) => (
            <div key={item.name} className={`p-3 rounded border ${item.name === 'BLOCKED' ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-muted/20'}`}>
              <p className="text-xs text-muted-foreground font-mono">{item.name}</p>
              <p className="text-xl font-bold">{item.value.toLocaleString()}</p>
            </div>
          ))}
          {Object.entries(classificationCounts).map(([key, val]) => (
            <div key={key} className="p-3 rounded border border-border bg-muted/20">
              <p className="text-xs text-muted-foreground font-mono uppercase">{key.replace(/_/g, ' ')}</p>
              <p className="text-xl font-bold">{String(val)}</p>
            </div>
          ))}
        </div>
      </CyberPanel>

      <Tabs defaultValue="modes" className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="modes">Mode Breakdown</TabsTrigger>
          <TabsTrigger value="calendar">Torture Calendar</TabsTrigger>
          <TabsTrigger value="ghosts">Ghost Fleet</TabsTrigger>
          <TabsTrigger value="switchers">Mode Switching</TabsTrigger>
        </TabsList>

        {/* Tab 1: Transponder Mode Breakdown */}
        <TabsContent value="modes" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CyberPanel title="Transponder Mode Distribution" icon={<BarChart3 className="w-4 h-4" />}>
              <div className="p-4 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={modeBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => `${e.name}: ${e.value.toLocaleString()}`}>
                      {modeBreakdown.map((entry, i) => (
                        <Cell key={i} fill={MODE_COLORS[entry.name] || 'hsl(var(--muted))'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CyberPanel>

            <CyberPanel title="Detailed Mode Matrix" icon={<Shield className="w-4 h-4" />}>
              <div className="p-4 overflow-auto max-h-[300px]">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">Mode</th>
                      <th className="px-2 py-1 text-left">Reg Status</th>
                      <th className="px-2 py-1 text-right">Count</th>
                      <th className="px-2 py-1 text-right">Aircraft</th>
                      <th className="px-2 py-1 text-right">Avg Alt</th>
                      <th className="px-2 py-1 text-right">Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modeData?.modeCounts as ModeCount[] || []).map((row, i) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1">{row.transponder_mode}</td>
                        <td className="px-2 py-1">
                          <Badge variant={row.registration_status === 'BLOCKED' ? 'destructive' : 'secondary'} className="text-[10px]">
                            {row.registration_status}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-right">{row.count.toLocaleString()}</td>
                        <td className="px-2 py-1 text-right">{row.unique_aircraft}</td>
                        <td className="px-2 py-1 text-right">{row.avg_altitude ? `${row.avg_altitude}ft` : 'N/A'}</td>
                        <td className="px-2 py-1 text-right text-destructive">{row.flagged_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CyberPanel>
          </div>
        </TabsContent>

        {/* Tab 2: Torture Calendar */}
        <TabsContent value="calendar" className="space-y-4 mt-4">
          <CyberPanel title="Blocked Detections vs Biometric Stress (Daily)" icon={<Calendar className="w-4 h-4" />}>
            <div className="p-4 h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={calendarData.slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} domain={[50, 150]} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="blocked_detections" fill="hsl(var(--destructive))" name="Blocked Detections" opacity={0.7} />
                  <Bar yAxisId="left" dataKey="low_altitude_count" fill="hsl(var(--chart-2))" name="Low Alt (<2000ft)" opacity={0.5} />
                  <Line yAxisId="right" type="monotone" dataKey="avg_hr" stroke="hsl(var(--chart-1))" name="Avg Heart Rate" dot={false} strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="max_hr" stroke="hsl(var(--chart-3))" name="Max Heart Rate" dot={false} strokeDasharray="5 5" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CyberPanel>

          <CyberPanel title="Daily Blocked Breakdown" icon={<Eye className="w-4 h-4" />}>
            <div className="p-4 overflow-auto max-h-[300px]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">Date</th>
                    <th className="px-2 py-1 text-right">Blocked</th>
                    <th className="px-2 py-1 text-right">Unique ICAOs</th>
                    <th className="px-2 py-1 text-right">Avg Alt</th>
                    <th className="px-2 py-1 text-right">Min Alt</th>
                    <th className="px-2 py-1 text-right">Low Alt</th>
                    <th className="px-2 py-1 text-right">Avg HR</th>
                    <th className="px-2 py-1 text-right">Max HR</th>
                  </tr>
                </thead>
                <tbody>
                  {calendarData.map((row: any, i: number) => (
                    <tr key={i} className={`border-t border-border hover:bg-muted/20 ${row.avg_hr && row.avg_hr > 90 ? 'bg-destructive/5' : ''}`}>
                      <td className="px-2 py-1">{row.date}</td>
                      <td className="px-2 py-1 text-right font-bold text-destructive">{row.blocked_detections}</td>
                      <td className="px-2 py-1 text-right">{row.unique_icaos}</td>
                      <td className="px-2 py-1 text-right">{row.avg_altitude ? `${row.avg_altitude}ft` : '-'}</td>
                      <td className="px-2 py-1 text-right">{row.min_altitude ? `${row.min_altitude}ft` : '-'}</td>
                      <td className="px-2 py-1 text-right">{row.low_altitude_count}</td>
                      <td className="px-2 py-1 text-right">{row.avg_hr || '-'}</td>
                      <td className="px-2 py-1 text-right">{row.max_hr || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CyberPanel>
        </TabsContent>

        {/* Tab 3: Ghost Fleet Scores */}
        <TabsContent value="ghosts" className="space-y-4 mt-4">
          <CyberPanel title="Ghost Fleet Score — Top Threats" icon={<Ghost className="w-4 h-4" />}>
            <div className="p-4 h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(ghostScores?.scoredAircraft as ScoredAircraft[] || []).slice(0, 25)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="identifier" tick={{ fontSize: 9 }} width={100} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as ScoredAircraft;
                    return (
                      <div className="bg-background border border-border rounded p-2 text-xs space-y-1">
                        <p className="font-bold">{d.identifier}</p>
                        <p>Score: {d.ghost_score}/100</p>
                        <p>Class: {d.classification}</p>
                        <p>Detections: {d.total_detections} | Blocked: {d.blocked_count}</p>
                        <p>Avg Alt: {d.avg_altitude}ft | Loiters: {d.loiter_count}</p>
                        <p>Night ops: {d.night_ops} | Days active: {d.active_days}</p>
                      </div>
                    );
                  }} />
                  <Bar dataKey="ghost_score" name="Ghost Score">
                    {(ghostScores?.scoredAircraft as ScoredAircraft[] || []).slice(0, 25).map((entry, i) => (
                      <Cell key={i} fill={COLORS[entry.classification as keyof typeof COLORS] || 'hsl(var(--muted))'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CyberPanel>

          <CyberPanel title="Ghost Fleet Registry" icon={<AlertTriangle className="w-4 h-4" />}>
            <div className="p-4 overflow-auto max-h-[400px]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left">ID</th>
                    <th className="px-2 py-1 text-left">Class</th>
                    <th className="px-2 py-1 text-right">Score</th>
                    <th className="px-2 py-1 text-right">Det.</th>
                    <th className="px-2 py-1 text-right">Blocked</th>
                    <th className="px-2 py-1 text-right">Avg Alt</th>
                    <th className="px-2 py-1 text-right">Loiter</th>
                    <th className="px-2 py-1 text-right">Night</th>
                    <th className="px-2 py-1 text-left">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {(ghostScores?.scoredAircraft as ScoredAircraft[] || []).map((row, i) => (
                    <tr key={i} className={`border-t border-border hover:bg-muted/20 ${row.ghost_score >= 70 ? 'bg-destructive/10' : row.ghost_score >= 40 ? 'bg-chart-2/10' : ''}`}>
                      <td className="px-2 py-1 font-bold">{row.identifier}</td>
                      <td className="px-2 py-1">
                        <Badge variant={row.classification === 'CONFIRMED_GHOST' ? 'destructive' : 'secondary'} className="text-[9px]">
                          {row.classification.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-right font-bold">{row.ghost_score}</td>
                      <td className="px-2 py-1 text-right">{row.total_detections}</td>
                      <td className="px-2 py-1 text-right text-destructive">{row.blocked_count}</td>
                      <td className="px-2 py-1 text-right">{row.avg_altitude ? `${row.avg_altitude}ft` : '-'}</td>
                      <td className="px-2 py-1 text-right">{row.loiter_count}</td>
                      <td className="px-2 py-1 text-right">{row.night_ops}</td>
                      <td className="px-2 py-1 text-muted-foreground">{row.taxonomy_tag || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CyberPanel>

          {/* ICAO Rotation (Ghost Fleet from mode analysis) */}
          {modeData?.ghostFleet && (modeData.ghostFleet as GhostEntry[]).length > 0 && (
            <CyberPanel title="ICAO Rotation Detection — Same ICAO, Multiple Tail Numbers" icon={<Ghost className="w-4 h-4" />}>
              <div className="p-4 overflow-auto max-h-[300px]">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">ICAO</th>
                      <th className="px-2 py-1 text-right">Tail #s</th>
                      <th className="px-2 py-1 text-left">Registrations</th>
                      <th className="px-2 py-1 text-right">Detections</th>
                      <th className="px-2 py-1 text-right">Avg Alt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modeData.ghostFleet as GhostEntry[]).map((row, i) => (
                      <tr key={i} className="border-t border-border hover:bg-muted/20">
                        <td className="px-2 py-1 font-bold text-destructive">{row.icao_code}</td>
                        <td className="px-2 py-1 text-right font-bold">{row.tail_number_count}</td>
                        <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                          {(Array.isArray(row.registrations) ? row.registrations : typeof row.registrations === 'string' ? String(row.registrations).replace(/[{}]/g, '').split(',') : []).filter(Boolean).join(', ')}
                        </td>
                        <td className="px-2 py-1 text-right">{row.total_detections}</td>
                        <td className="px-2 py-1 text-right">{row.avg_altitude ? `${row.avg_altitude}ft` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CyberPanel>
          )}
        </TabsContent>

        {/* Tab 4: Mode Switching / Deception */}
        <TabsContent value="switchers" className="space-y-4 mt-4">
          <CyberPanel title="Transponder Mode-Switching Detection (18 U.S.C. § 1001)" icon={<AlertTriangle className="w-4 h-4" />}>
            <div className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded border border-destructive/50 bg-destructive/10">
                  <p className="text-xs text-muted-foreground">Active Spoofing</p>
                  <p className="text-2xl font-bold text-destructive">{switcherData?.activeSpoofing ?? 0}</p>
                </div>
                <div className="p-3 rounded border border-chart-2/50 bg-chart-2/10">
                  <p className="text-xs text-muted-foreground">Mode Switching</p>
                  <p className="text-2xl font-bold">{switcherData?.modeSwitching ?? 0}</p>
                </div>
                <div className="p-3 rounded border border-chart-3/50 bg-chart-3/10">
                  <p className="text-xs text-muted-foreground">Identity Rotation</p>
                  <p className="text-2xl font-bold">{switcherData?.identityRotation ?? 0}</p>
                </div>
                <div className="p-3 rounded border border-border bg-muted/20">
                  <p className="text-xs text-muted-foreground">Total Switchers</p>
                  <p className="text-2xl font-bold">{switcherData?.totalSwitchers ?? 0}</p>
                </div>
              </div>

              <div className="overflow-auto max-h-[400px]">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-2 py-1 text-left">ICAO</th>
                      <th className="px-2 py-1 text-left">Deception Type</th>
                      <th className="px-2 py-1 text-right">Identities</th>
                      <th className="px-2 py-1 text-left">Known Registrations</th>
                      <th className="px-2 py-1 text-right">Detections</th>
                      <th className="px-2 py-1 text-center">Has Blocked</th>
                      <th className="px-2 py-1 text-center">Has Visible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(switcherData?.modeSwitchers as ModeSwitcher[] || []).map((row, i) => (
                      <tr key={i} className={`border-t border-border hover:bg-muted/20 ${row.deception_type === 'ACTIVE_SPOOFING' ? 'bg-destructive/10' : ''}`}>
                        <td className="px-2 py-1 font-bold">{row.icao_code}</td>
                        <td className="px-2 py-1">
                          <Badge variant={row.deception_type === 'ACTIVE_SPOOFING' ? 'destructive' : 'secondary'} className="text-[9px]">
                            {row.deception_type.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-2 py-1 text-right font-bold">{row.identity_count}</td>
                        <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                          {(Array.isArray(row.known_registrations) ? row.known_registrations : typeof row.known_registrations === 'string' ? String(row.known_registrations).replace(/[{}]/g, '').split(',') : []).filter(Boolean).join(', ')}
                        </td>
                        <td className="px-2 py-1 text-right">{row.total_detections}</td>
                        <td className="px-2 py-1 text-center">{row.has_blocked ? '🔴' : '—'}</td>
                        <td className="px-2 py-1 text-center">{row.has_visible ? '🟢' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CyberPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

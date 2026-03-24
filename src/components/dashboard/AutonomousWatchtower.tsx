import { useState, useCallback, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Shield, Zap, AlertTriangle, Activity, RefreshCw,
  TrendingUp, Eye, CheckCircle, XCircle, BarChart3, Crosshair, Clock
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface AutonomousFlag {
  id?: string;
  flag_type: string;
  severity: string;
  registration: string | null;
  description: string;
  evidence_summary: Record<string, unknown>;
  cross_references: Array<{ source: string; count: number }>;
  confidence_score: number;
  learning_context: Record<string, unknown>;
  created_at?: string;
  auto_resolved?: boolean;
}

interface ScanResult {
  scan_id: string;
  timestamp: string;
  version?: string;
  protocol?: string;
  summary: {
    aircraft_baselines: number;
    recent_detections_analyzed?: number;
    recent_detections?: number;
    flags_generated: number;
    flags_persisted: number;
    bio_correlations: number;
    cross_references?: number;
    critical_flags: number;
    high_flags?: number;
    xxb_mlat_aircraft?: number;
    sentinel_threats_loaded?: number;
    shell_companies_loaded?: number;
    faa_lookups?: number;
    web_searches?: number;
    certainty_breakdown?: {
      absolute: number;
      near: number;
      high: number;
      statistical: number;
    };
  };
  flags: AutonomousFlag[];
  ai_analysis: string | null;
  learning_insights: string[];
}

interface TrendDataPoint {
  date: string;
  critical: number;
  high: number;
  medium: number;
  total: number;
}

interface TypeDistribution {
  name: string;
  value: number;
  color: string;
}

const TYPE_COLORS: Record<string, string> = {
  ALTITUDE_ANOMALY: 'hsl(var(--primary))',
  FREQUENCY_SPIKE: 'hsl(var(--secondary))',
  PHYSICS_VIOLATION: 'hsl(var(--destructive))',
  TEMPORAL_CONVERGENCE: 'hsl(45, 93%, 47%)',
  BIOMETRIC_CORRELATION: 'hsl(280, 65%, 60%)',
  XXB_MLAT_ANOMALY: 'hsl(200, 70%, 50%)',
  LOW_ALTITUDE_PATTERN: 'hsl(0, 80%, 55%)',
};

export function AutonomousWatchtower() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [expandedFlag, setExpandedFlag] = useState<number | null>(null);
  const [historicalFlags, setHistoricalFlags] = useState<AutonomousFlag[]>([]);
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [typeDistribution, setTypeDistribution] = useState<TypeDistribution[]>([]);
  const [activeTab, setActiveTab] = useState<'live' | 'history' | 'trends'>('live');
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load persisted flags on mount
  const loadHistoricalFlags = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('watchtower_autonomous_flags')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      const flags = ((data || []) as unknown) as AutonomousFlag[];
      setHistoricalFlags(flags);

      // Build trend data (group by day)
      const dayMap = new Map<string, { critical: number; high: number; medium: number; total: number }>();
      for (const f of flags) {
        const day = (f.created_at || '').slice(0, 10);
        if (!day) continue;
        if (!dayMap.has(day)) dayMap.set(day, { critical: 0, high: 0, medium: 0, total: 0 });
        const d = dayMap.get(day)!;
        d.total++;
        if (f.severity === 'critical') d.critical++;
        else if (f.severity === 'high') d.high++;
        else d.medium++;
      }
      const trend = Array.from(dayMap.entries())
        .map(([date, counts]) => ({ date, ...counts }))
        .sort((a, b) => a.date.localeCompare(b.date));
      setTrendData(trend);

      // Build type distribution
      const typeMap = new Map<string, number>();
      for (const f of flags) {
        typeMap.set(f.flag_type, (typeMap.get(f.flag_type) || 0) + 1);
      }
      setTypeDistribution(
        Array.from(typeMap.entries()).map(([name, value]) => ({
          name: name.replace(/_/g, ' '),
          value,
          color: TYPE_COLORS[name] || 'hsl(var(--muted-foreground))',
        }))
      );
    } catch (err) {
      console.error('Failed to load historical flags:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistoricalFlags();
  }, [loadHistoricalFlags]);

  const runAutonomousScan = useCallback(async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('autonomous-watchtower', {
        body: { mode: 'full_scan' }
      });
      if (error) throw error;
      setScanResult(data as ScanResult);
      setActiveTab('live');
      // Reload historical after scan persists new flags
      setTimeout(() => loadHistoricalFlags(), 2000);

      const critCount = (data as ScanResult).summary.critical_flags;
      if (critCount > 0) {
        toast.error(`Autonomous Watchtower: ${critCount} CRITICAL flags`, {
          description: 'Statistical anomalies detected without human bias'
        });
      } else {
        toast.success(`Autonomous scan complete: ${(data as ScanResult).summary.flags_generated} flags`);
      }
    } catch (err) {
      console.error('Autonomous scan error:', err);
      toast.error('Autonomous scan failed', { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }, [loadHistoricalFlags]);

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      default: return 'bg-muted/20 text-muted-foreground border-muted/50';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return <Badge variant="destructive" className="text-[10px]">CRITICAL</Badge>;
      case 'high': return <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30">HIGH</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">MEDIUM</Badge>;
    }
  };

  const getFlagIcon = (type: string) => {
    switch (type) {
      case 'ALTITUDE_ANOMALY': return <TrendingUp className="w-4 h-4" />;
      case 'FREQUENCY_SPIKE': return <BarChart3 className="w-4 h-4" />;
      case 'PHYSICS_VIOLATION': return <XCircle className="w-4 h-4" />;
      case 'TEMPORAL_CONVERGENCE': return <Crosshair className="w-4 h-4" />;
      case 'BIOMETRIC_CORRELATION': return <Activity className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  const renderFlagList = (flags: AutonomousFlag[]) => (
    <ScrollArea className="h-[350px]">
      <div className="space-y-2">
        {flags.map((flag, index) => (
          <div
            key={flag.id || index}
            className={`p-3 rounded border cursor-pointer transition-all ${getSeverityStyle(flag.severity)}`}
            onClick={() => setExpandedFlag(expandedFlag === index ? null : index)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 flex-1">
                {getFlagIcon(flag.flag_type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getSeverityBadge(flag.severity)}
                    <Badge variant="outline" className="text-[10px]">{flag.flag_type}</Badge>
                    {flag.registration && (
                      <span className="text-xs font-mono font-bold">{flag.registration}</span>
                    )}
                    {flag.auto_resolved && (
                      <Badge variant="secondary" className="text-[10px] bg-green-500/10 text-green-400">RESOLVED</Badge>
                    )}
                  </div>
                  <p className="text-xs mt-1 leading-relaxed">{flag.description}</p>
                  {flag.created_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {new Date(flag.created_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge variant="secondary" className="text-[10px]">
                  {flag.confidence_score}%
                </Badge>
              </div>
            </div>

            {expandedFlag === index && (
              <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">Evidence Summary</p>
                  <pre className="text-[10px] bg-background/50 p-2 rounded overflow-x-auto">
                    {JSON.stringify(flag.evidence_summary, null, 2)}
                  </pre>
                </div>
                {Array.isArray(flag.cross_references) && flag.cross_references.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground mb-1">Cross-References</p>
                    {flag.cross_references.map((ref, ri) => (
                      <Badge key={ri} variant="outline" className="text-[10px] mr-1">
                        {ref.source}: {ref.count} matches
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {flags.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">No flags found</div>
        )}
      </div>
    </ScrollArea>
  );

  return (
    <CyberPanel
      title="Autonomous Watchtower"
      icon={<Brain />}
      variant={historicalFlags.some(f => f.severity === 'critical' && !f.auto_resolved) ? "threat" : "default"}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            <Clock className="w-3 h-3 mr-1" />
            HOURLY CRON
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            <Shield className="w-3 h-3 mr-1" />
            BIAS-FREE
          </Badge>
          <Button variant="ghost" size="sm" onClick={runAutonomousScan} disabled={scanning} className="h-7 px-3">
            {scanning ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Brain className="w-3 h-3 mr-1" />}
            {scanning ? "Scanning..." : "Run Scan"}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-border pb-2">
          {(['live', 'history', 'trends'] as const).map(tab => (
            <Button
              key={tab}
              variant={activeTab === tab ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'live' && <Zap className="w-3 h-3 mr-1" />}
              {tab === 'history' && <Clock className="w-3 h-3 mr-1" />}
              {tab === 'trends' && <TrendingUp className="w-3 h-3 mr-1" />}
              {tab === 'live' ? 'Live Scan' : tab === 'history' ? `History (${historicalFlags.length})` : 'Trends'}
            </Button>
          ))}
        </div>

        {scanning && (
          <div className="text-center py-6">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
            <p className="text-sm font-medium">Autonomous Analysis in Progress</p>
            <p className="text-xs text-muted-foreground mt-1">Learning baselines → Detecting anomalies → Cross-referencing → AI synthesis</p>
            <Progress value={33} className="mt-3 max-w-xs mx-auto" />
          </div>
        )}

        {/* ===== LIVE TAB ===== */}
        {activeTab === 'live' && !scanning && (
          <>
            {!scanResult ? (
              <div className="text-center py-8 text-muted-foreground">
                <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm font-medium">Autonomous Watchtower Ready</p>
                <p className="text-xs mt-1">Statistical anomaly detection • Hourly automated scans active</p>
                <Button onClick={runAutonomousScan} className="mt-4" size="sm">
                  <Brain className="w-4 h-4 mr-2" /> Launch Autonomous Scan
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground">Baselines</p>
                    <p className="text-lg font-bold">{scanResult.summary.aircraft_baselines ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground">Analyzed</p>
                    <p className="text-lg font-bold">{(scanResult.summary.recent_detections_analyzed ?? scanResult.summary.recent_detections ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                    <p className="text-xs text-destructive">Critical</p>
                    <p className="text-lg font-bold text-destructive">{scanResult.summary.critical_flags ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-lg border border-border bg-card">
                    <p className="text-xs text-muted-foreground">Bio Corr</p>
                    <p className="text-lg font-bold">{scanResult.summary.bio_correlations ?? 0}</p>
                  </div>
                </div>

                {/* Certainty Breakdown */}
                {scanResult.summary.certainty_breakdown && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="p-2 rounded-lg border border-green-500/30 bg-green-500/5 text-center">
                      <p className="text-sm font-bold text-green-400">{scanResult.summary.certainty_breakdown.absolute}</p>
                      <p className="text-[10px] text-muted-foreground">Absolute</p>
                    </div>
                    <div className="p-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-center">
                      <p className="text-sm font-bold text-blue-400">{scanResult.summary.certainty_breakdown.near}</p>
                      <p className="text-[10px] text-muted-foreground">Near Cert.</p>
                    </div>
                    <div className="p-2 rounded-lg border border-orange-500/30 bg-orange-500/5 text-center">
                      <p className="text-sm font-bold text-orange-400">{scanResult.summary.certainty_breakdown.high}</p>
                      <p className="text-[10px] text-muted-foreground">High Conf.</p>
                    </div>
                    <div className="p-2 rounded-lg border border-border bg-card text-center">
                      <p className="text-sm font-bold">{scanResult.summary.certainty_breakdown.statistical}</p>
                      <p className="text-[10px] text-muted-foreground">Statistical</p>
                    </div>
                  </div>
                )}

                {scanResult.learning_insights.length > 0 && (
                  <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Eye className="w-4 h-4 text-primary" />
                      <span className="text-xs font-medium text-primary">Learning Insights</span>
                    </div>
                    {scanResult.learning_insights.map((insight, i) => (
                      <p key={i} className="text-xs text-muted-foreground">• {insight}</p>
                    ))}
                  </div>
                )}

                {scanResult.ai_analysis && (
                  <div className="p-3 rounded-lg border border-accent/30 bg-accent/5">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-accent-foreground" />
                      <span className="text-xs font-medium">AI Analysis (Bias-Free)</span>
                    </div>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{scanResult.ai_analysis}</p>
                  </div>
                )}

                <h4 className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Flags ({scanResult.flags.length})
                </h4>
                {renderFlagList(scanResult.flags)}
              </>
            )}
          </>
        )}

        {/* ===== HISTORY TAB ===== */}
        {activeTab === 'history' && !scanning && (
          <>
            {loadingHistory ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                Loading historical flags...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  <div className="p-2 rounded-lg border border-border bg-card text-center">
                    <p className="text-lg font-bold">{historicalFlags.length}</p>
                    <p className="text-[10px] text-muted-foreground">Total Flags</p>
                  </div>
                  <div className="p-2 rounded-lg border border-destructive/30 bg-destructive/5 text-center">
                    <p className="text-lg font-bold text-destructive">{historicalFlags.filter(f => f.severity === 'critical').length}</p>
                    <p className="text-[10px] text-muted-foreground">Critical</p>
                  </div>
                  <div className="p-2 rounded-lg border border-orange-500/30 bg-orange-500/5 text-center">
                    <p className="text-lg font-bold text-orange-400">{historicalFlags.filter(f => f.severity === 'high').length}</p>
                    <p className="text-[10px] text-muted-foreground">High</p>
                  </div>
                  <div className="p-2 rounded-lg border border-green-500/30 bg-green-500/5 text-center">
                    <p className="text-lg font-bold text-green-400">{historicalFlags.filter(f => f.auto_resolved).length}</p>
                    <p className="text-[10px] text-muted-foreground">Resolved</p>
                  </div>
                </div>
                {renderFlagList(historicalFlags)}
              </>
            )}
          </>
        )}

        {/* ===== TRENDS TAB ===== */}
        {activeTab === 'trends' && !scanning && (
          <>
            {loadingHistory ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
                Loading trend data...
              </div>
            ) : trendData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No historical data yet</p>
                <p className="text-xs mt-1">Run scans to build trend data over time</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Daily flag trend area chart */}
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> Daily Flag Trend
                  </h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: 11,
                        }}
                      />
                      <Area type="monotone" dataKey="critical" stackId="1" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive) / 0.3)" />
                      <Area type="monotone" dataKey="high" stackId="1" stroke="hsl(45, 93%, 47%)" fill="hsl(45, 93%, 47%, 0.3)" />
                      <Area type="monotone" dataKey="medium" stackId="1" stroke="hsl(var(--muted-foreground))" fill="hsl(var(--muted-foreground) / 0.2)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Flag type distribution bar chart */}
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Flag Type Distribution
                  </h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={typeDistribution} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} width={120} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                          fontSize: 11,
                        }}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {typeDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Top flagged aircraft */}
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Crosshair className="w-4 h-4" /> Top Flagged Aircraft
                  </h4>
                  <div className="space-y-1">
                    {(() => {
                      const regCount = new Map<string, number>();
                      for (const f of historicalFlags) {
                        if (f.registration) regCount.set(f.registration, (regCount.get(f.registration) || 0) + 1);
                      }
                      return Array.from(regCount.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([reg, count]) => (
                          <div key={reg} className="flex items-center justify-between text-xs p-2 rounded bg-card border border-border">
                            <span className="font-mono font-bold">{reg}</span>
                            <Badge variant="secondary" className="text-[10px]">{count} flags</Badge>
                          </div>
                        ));
                    })()}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </CyberPanel>
  );
}

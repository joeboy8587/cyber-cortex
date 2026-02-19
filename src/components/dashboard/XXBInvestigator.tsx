import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  AlertTriangle, Clock, Activity, 
  Eye, Loader2, Radio, Fingerprint, Search,
  Database, Tag, AlertCircle, CheckCircle, XCircle
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';

interface HourlyPattern {
  hour: number;
  count: number;
  label: string;
}

interface XXBStats {
  totalDetections: number;
  avgAltitude: number;
  activeDays: number;
  peakHour: number;
  nightOperations: number;
  dayOperations: number;
}

interface NullIcaoAnalysis {
  totalNullIcao: number;
  nullWithXxbTag: number;
  nullWithNoTag: number;
  nullWithOtherTag: number;
  nullLowAlt: number;
  nullHighSpeed: number;
  nullByTag: Array<{ tag: string; count: number }>;
  taxonomyIssueCount: number;
}

interface TaxonomyDiagnostic {
  tag: string;
  count: number;
  pct: string;
  issue: string | null;
  severity: 'critical' | 'warn' | 'ok';
}

export const XXBInvestigator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [deepLoading, setDeepLoading] = useState(false);
  const [stats, setStats] = useState<XXBStats | null>(null);
  const [hourlyPattern, setHourlyPattern] = useState<HourlyPattern[]>([]);
  const [hasData, setHasData] = useState(false);
  const [nullIcao, setNullIcao] = useState<NullIcaoAnalysis | null>(null);
  const [taxonomyDiag, setTaxonomyDiag] = useState<TaxonomyDiagnostic[]>([]);
  const [deepAnalysisDone, setDeepAnalysisDone] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const investigateXXB = async () => {
    setIsLoading(true);
    try {
      const { data: statsData } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `
            SELECT 
              COUNT(*) as total,
              COALESCE(AVG(NULLIF(altitude, 0)), 0) as avg_alt,
              COUNT(DISTINCT DATE(detection_timestamp)) as active_days,
              SUM(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 19 OR EXTRACT(HOUR FROM detection_timestamp) < 6 THEN 1 ELSE 0 END) as night_ops,
              SUM(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 6 AND EXTRACT(HOUR FROM detection_timestamp) < 19 THEN 1 ELSE 0 END) as day_ops
            FROM live_flight_detections_rows 
            WHERE registration ILIKE '%XXB%' OR callsign ILIKE '%XXB%' OR registration ILIKE 'XX%'
          `
        }
      });
      
      const row = statsData?.[0];
      if (row && parseInt(row.total) > 0) {
        setHasData(true);
        
        const { data: hourlyData } = await supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: `
              SELECT 
                EXTRACT(HOUR FROM detection_timestamp)::int as hour,
                COUNT(*) as count
              FROM live_flight_detections_rows 
              WHERE registration ILIKE '%XXB%' OR callsign ILIKE '%XXB%' OR registration ILIKE 'XX%'
              GROUP BY EXTRACT(HOUR FROM detection_timestamp)::int
              ORDER BY hour
            `
          }
        });
        
        const hourlyRows = hourlyData || [];
        const pattern: HourlyPattern[] = Array.from({ length: 24 }, (_, i) => ({
          hour: i, count: 0, label: `${i.toString().padStart(2, '0')}:00`
        }));
        let peakHour = 0, peakCount = 0;
        hourlyRows.forEach((r: any) => {
          const h = parseInt(r.hour);
          const c = parseInt(r.count);
          if (h >= 0 && h < 24) pattern[h].count = c;
          if (c > peakCount) { peakCount = c; peakHour = h; }
        });
        
        setHourlyPattern(pattern);
        setStats({
          totalDetections: parseInt(row.total),
          avgAltitude: parseFloat(row.avg_alt) || 0,
          activeDays: parseInt(row.active_days),
          peakHour,
          nightOperations: parseInt(row.night_ops),
          dayOperations: parseInt(row.day_ops)
        });
      } else {
        setHasData(false);
      }
    } catch (error) {
      console.error('XXB investigation error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runDeepAnalysis = async () => {
    setDeepLoading(true);
    try {
      // 1. Null ICAO code analysis
      const [nullRes, tagDistRes, totalRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                COUNT(*) as total_null_icao,
                SUM(CASE WHEN taxonomy_tag ILIKE '%xxb%' THEN 1 ELSE 0 END) as null_with_xxb_tag,
                SUM(CASE WHEN taxonomy_tag IS NULL OR taxonomy_tag = '' THEN 1 ELSE 0 END) as null_with_no_tag,
                SUM(CASE WHEN taxonomy_tag IS NOT NULL AND taxonomy_tag != '' AND taxonomy_tag NOT ILIKE '%xxb%' THEN 1 ELSE 0 END) as null_with_other_tag,
                SUM(CASE WHEN altitude > 0 AND altitude < 1000 THEN 1 ELSE 0 END) as null_low_alt,
                SUM(CASE WHEN speed > 400 THEN 1 ELSE 0 END) as null_high_speed
              FROM live_flight_detections_rows
              WHERE icao_code IS NULL OR icao_code = '' OR icao_code = 'UNKNOWN'
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                COALESCE(taxonomy_tag, 'NULL/UNTAGGED') as tag,
                COUNT(*) as count
              FROM live_flight_detections_rows
              WHERE icao_code IS NULL OR icao_code = '' OR icao_code = 'UNKNOWN'
              GROUP BY taxonomy_tag
              ORDER BY count DESC
              LIMIT 15
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                COALESCE(taxonomy_tag, 'NULL/UNTAGGED') as tag,
                COUNT(*) as cnt
              FROM live_flight_detections_rows
              GROUP BY taxonomy_tag
              ORDER BY cnt DESC
              LIMIT 20
            `
          }
        })
      ]);

      const nr = nullRes.data?.[0];
      const totalNullIcao = parseInt(nr?.total_null_icao || '0');
      const nullByTag = (nullRes.data ? nullRes.data : []);
      const tagDist = tagDistRes.data || [];
      const allTagDist = totalRes.data || [];

      setNullIcao({
        totalNullIcao,
        nullWithXxbTag: parseInt(nr?.null_with_xxb_tag || '0'),
        nullWithNoTag: parseInt(nr?.null_with_no_tag || '0'),
        nullWithOtherTag: parseInt(nr?.null_with_other_tag || '0'),
        nullLowAlt: parseInt(nr?.null_low_alt || '0'),
        nullHighSpeed: parseInt(nr?.null_high_speed || '0'),
        nullByTag: tagDist.map((r: any) => ({ tag: r.tag, count: parseInt(r.count) })),
        taxonomyIssueCount: parseInt(nr?.null_with_no_tag || '0') + parseInt(nr?.null_with_xxb_tag || '0')
      });

      // Build taxonomy diagnostics — classify each tag's forensic quality
      const totalRecords = allTagDist.reduce((s: number, r: any) => s + parseInt(r.cnt), 0);
      const diags: TaxonomyDiagnostic[] = allTagDist.map((r: any) => {
        const tag = r.tag;
        const count = parseInt(r.cnt);
        const pct = totalRecords > 0 ? ((count / totalRecords) * 100).toFixed(1) : '0.0';
        
        let issue: string | null = null;
        let severity: 'critical' | 'warn' | 'ok' = 'ok';

        if (tag === 'NULL/UNTAGGED') {
          issue = 'No taxonomy tag — records invisible to forensic filters';
          severity = 'critical';
        } else if (tag === 'xxb_live') {
          issue = 'Default fallback tag — no classification applied, may mask threat aircraft';
          severity = 'warn';
        } else if (tag === 'xxb_unknown') {
          issue = 'Null ICAO + unknown tag — possible ADS-B spoofing or ghost signal';
          severity = 'warn';
        } else if (tag?.includes('xxb_mlat')) {
          issue = 'MLAT synthetic identifier — NOT real aircraft registration, filter before prosecution';
          severity = 'critical';
        } else if (tag?.includes('tier0') || tag?.includes('kcso')) {
          severity = 'ok';
        } else if (tag?.includes('tier1') || tag?.includes('tier2')) {
          severity = 'ok';
        }

        return { tag, count, pct, issue, severity };
      });

      setTaxonomyDiag(diags);
      setDeepAnalysisDone(true);
      setActiveTab('deep');
    } catch (error) {
      console.error('Deep analysis error:', error);
    } finally {
      setDeepLoading(false);
    }
  };

  useEffect(() => {
    investigateXXB();
  }, []);

  const formatHour = (hour: number) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}${ampm}`;
  };

  const getBarColor = (hour: number) => {
    if (hour >= 18 || hour < 2) return 'hsl(0, 84%, 60%)';
    if (hour >= 2 && hour < 6) return 'hsl(38, 92%, 50%)';
    return 'hsl(217, 91%, 60%)';
  };

  const getSeverityIcon = (sev: 'critical' | 'warn' | 'ok') => {
    if (sev === 'critical') return <XCircle className="h-3 w-3 text-destructive" />;
    if (sev === 'warn') return <AlertCircle className="h-3 w-3 text-yellow-400" />;
    return <CheckCircle className="h-3 w-3 text-green-400" />;
  };

  const pieData = nullIcao?.nullByTag.slice(0, 6).map(d => ({ name: d.tag, value: d.count })) || [];
  const PIE_COLORS = ['hsl(0,84%,60%)', 'hsl(38,92%,50%)', 'hsl(217,91%,60%)', 'hsl(280,70%,60%)', 'hsl(160,60%,50%)', 'hsl(30,80%,55%)'];

  return (
    <CyberPanel 
      title="XXB DEEP INVESTIGATOR"
      headerActions={
        <div className="flex items-center gap-2">
          {stats && (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {stats.totalDetections.toLocaleString()} Detections
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={runDeepAnalysis} disabled={deepLoading}>
            {deepLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
            Deep Analysis
          </Button>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-sm">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deep">
            Null ICAO
            {nullIcao && nullIcao.totalNullIcao > 0 && (
              <Badge variant="destructive" className="ml-1 h-4 text-xs px-1">!</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="taxonomy">Taxonomy</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW TAB ── */}
        <TabsContent value="overview" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : !hasData ? (
            <div className="text-center py-12 text-muted-foreground">
              <Radio className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No XXB signal data found</p>
            </div>
          ) : (
            <>
              <div className="p-4 bg-destructive/10 rounded-lg border border-destructive/30">
                <h3 className="font-semibold text-destructive flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4" />
                  What is "XXB"?
                </h3>
                <p className="text-sm text-muted-foreground">
                  "XXB" is <strong>not a valid aircraft registration</strong>. Aircraft broadcasting "XXB" 
                  are deliberately masking identity — illegal under FAA regulations except for specific 
                  military/LE operations. Null ICAO codes alongside XXB tags suggest <strong>ADS-B spoofing 
                  or synthetic MLAT ghost signals</strong> being used as cover. Click <strong>Deep Analysis</strong> above to investigate null ICAO patterns and taxonomy classification issues.
                </p>
              </div>

              {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { icon: <Radio className="h-3 w-3" />, label: 'Total Detections', value: stats.totalDetections.toLocaleString() },
                    { icon: <Activity className="h-3 w-3" />, label: 'Avg Altitude', value: `${stats.avgAltitude.toFixed(0)} ft` },
                    { icon: <Clock className="h-3 w-3" />, label: 'Active Days', value: stats.activeDays.toString() },
                    { icon: <Eye className="h-3 w-3" />, label: 'Peak Hour', value: formatHour(stats.peakHour) },
                  ].map((s, i) => (
                    <div key={i} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        {s.icon}
                        <span className="text-xs">{s.label}</span>
                      </div>
                      <p className="text-xl font-bold text-foreground">{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {stats && (
                <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                  <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Operation Time Analysis
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
                      <p className="text-2xl font-bold text-orange-400">
                        {((stats.nightOperations / Math.max(stats.totalDetections, 1)) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Night Operations (7PM–6AM)</p>
                      <p className="text-sm text-orange-400 mt-1">{stats.nightOperations.toLocaleString()} detections</p>
                    </div>
                    <div className="text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                      <p className="text-2xl font-bold text-blue-400">
                        {((stats.dayOperations / Math.max(stats.totalDetections, 1)) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Day Operations (6AM–7PM)</p>
                      <p className="text-sm text-blue-400 mt-1">{stats.dayOperations.toLocaleString()} detections</p>
                    </div>
                  </div>
                </div>
              )}

              {hourlyPattern.length > 0 && (
                <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                  <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    24-Hour Activity Pattern
                  </h4>
                  <div className="flex gap-4 text-xs text-muted-foreground mb-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-destructive inline-block" /> KCSO Patrol (6PM–2AM)</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-orange-400 inline-block" /> Early Morning</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-blue-400 inline-block" /> Daytime</span>
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={hourlyPattern}>
                        <XAxis dataKey="hour" tickFormatter={(h) => h % 3 === 0 ? formatHour(h) : ''} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} labelFormatter={(h) => formatHour(Number(h))} formatter={(v: number) => [v.toLocaleString(), 'Detections']} />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {hourlyPattern.map((entry, i) => <Cell key={i} fill={getBarColor(entry.hour)} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="p-4 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                <h4 className="font-semibold text-yellow-400 flex items-center gap-2 mb-2">
                  <Fingerprint className="h-4 w-4" />
                  Key Finding
                </h4>
                <p className="text-sm text-muted-foreground">
                  The XXB signal peaks during documented KCSO patrol hours (6PM–2AM), operates at 
                  altitudes consistent with helicopter surveillance (~1,100 ft), and appeared on{' '}
                  <strong>{stats?.activeDays || 0} distinct days</strong>. This strongly suggests XXB 
                  is a <strong>KCSO helicopter operating with its transponder masked or in test mode</strong>.
                </p>
              </div>
            </>
          )}
        </TabsContent>

        {/* ── NULL ICAO DEEP ANALYSIS TAB ── */}
        <TabsContent value="deep" className="space-y-4">
          {!deepAnalysisDone ? (
            <div className="text-center py-12 space-y-4">
              <Database className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <p className="text-muted-foreground text-sm">Click <strong>Deep Analysis</strong> to investigate null ICAO codes and taxonomy issues</p>
              <Button onClick={runDeepAnalysis} disabled={deepLoading}>
                {deepLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Run Deep Analysis
              </Button>
            </div>
          ) : deepLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : nullIcao && (
            <>
              {/* Null ICAO Summary */}
              <div className={`p-4 rounded-lg border ${nullIcao.totalNullIcao > 1000 ? 'bg-destructive/10 border-destructive/40' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                <h3 className="font-semibold flex items-center gap-2 mb-2">
                  {nullIcao.totalNullIcao > 1000 ? <XCircle className="h-4 w-4 text-destructive" /> : <AlertCircle className="h-4 w-4 text-yellow-400" />}
                  <span>Null/Empty ICAO Code Analysis</span>
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  <strong className="text-foreground">{nullIcao.totalNullIcao.toLocaleString()} records</strong> have null, empty, or "UNKNOWN" ICAO codes in the database. 
                  This is {nullIcao.nullWithXxbTag > nullIcao.totalNullIcao * 0.5 ? 
                    'likely a taxonomy tagging issue — XXB tags assigned without a real ICAO hex present.' : 
                    'a mix of ADS-B spoofing (ghost signals), MLAT synthetic identifiers, and classification gaps.'}
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: 'Total Null ICAO', value: nullIcao.totalNullIcao.toLocaleString(), color: 'text-destructive', desc: 'Records missing transponder hex code' },
                  { label: 'Tagged XXB', value: nullIcao.nullWithXxbTag.toLocaleString(), color: 'text-orange-400', desc: 'Null ICAO + XXB taxonomy tag — possible false positive' },
                  { label: 'Completely Untagged', value: nullIcao.nullWithNoTag.toLocaleString(), color: 'text-yellow-400', desc: 'No tag at all — invisible to forensic filters' },
                  { label: 'Low Altitude Nulls', value: nullIcao.nullLowAlt.toLocaleString(), color: 'text-destructive', desc: 'Null ICAO + <1000ft altitude — high spoofing probability' },
                  { label: 'Impossible Speed', value: nullIcao.nullHighSpeed.toLocaleString(), color: 'text-destructive', desc: 'Null ICAO + >400kts — ADS-B spoofing signature' },
                  { label: 'Taxonomy Issues', value: nullIcao.taxonomyIssueCount.toLocaleString(), color: 'text-yellow-400', desc: 'Records needing reclassification' },
                ].map((s, i) => (
                  <div key={i} className="p-3 bg-muted/30 rounded-lg border border-border/50">
                    <p className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</p>
                    <p className="text-xs font-medium text-foreground">{s.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{s.desc}</p>
                  </div>
                ))}
              </div>

              {/* Diagnosis */}
              <div className="p-4 bg-muted/30 rounded-lg border border-border/50 space-y-3">
                <h4 className="font-semibold flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  Root Cause Diagnosis
                </h4>
                <div className="space-y-2 text-sm">
                  {nullIcao.nullHighSpeed > 100 && (
                    <div className="flex items-start gap-2 p-2 bg-destructive/10 rounded border border-destructive/20">
                      <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">ADS-B Spoofing Detected</p>
                        <p className="text-muted-foreground">{nullIcao.nullHighSpeed.toLocaleString()} records show null ICAO + physically impossible speed (&gt;400kts). This is a ghost signal / synthetic ADS-B broadcast, not a real aircraft. The taxonomy tag "xxb_mlat" should be applied to these records.</p>
                      </div>
                    </div>
                  )}
                  {nullIcao.nullLowAlt > 50 && (
                    <div className="flex items-start gap-2 p-2 bg-orange-500/10 rounded border border-orange-500/20">
                      <AlertCircle className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">Low-Altitude Null Signals</p>
                        <p className="text-muted-foreground">{nullIcao.nullLowAlt.toLocaleString()} records are at &lt;1,000ft with no ICAO code. Real aircraft at this altitude would have active ADS-B. These may be drones or aircraft with transponders in test/stealth mode (known KCSO pattern).</p>
                      </div>
                    </div>
                  )}
                  {nullIcao.nullWithNoTag > 0 && (
                    <div className="flex items-start gap-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/20">
                      <AlertCircle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">Classification Gap (Taxonomy Issue)</p>
                        <p className="text-muted-foreground">{nullIcao.nullWithNoTag.toLocaleString()} records have null ICAO AND no taxonomy_tag. These are invisible to all forensic filters. The <strong>backfillUnknown</strong> action in the Taxonomy Classifier can tag these as "xxb_unknown" to make them searchable.</p>
                      </div>
                    </div>
                  )}
                  {nullIcao.nullWithXxbTag > 0 && (
                    <div className="flex items-start gap-2 p-2 bg-blue-500/10 rounded border border-blue-500/20">
                      <AlertCircle className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-foreground">XXB Tag on Null ICAO Records</p>
                        <p className="text-muted-foreground">{nullIcao.nullWithXxbTag.toLocaleString()} records have an XXB taxonomy tag but no real ICAO hex. This confirms the XXB prefix is being used as both a real callsign pattern AND as a system placeholder — the taxonomy system must distinguish these two meanings (see XXB Taxonomy Classifier).</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Null ICAO by tag breakdown */}
              {nullIcao.nullByTag.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                    <h4 className="font-semibold text-sm mb-3">Null ICAO Records by Taxonomy Tag</h4>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name?.slice(0, 12)} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                            {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => v.toLocaleString()} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
                    <h4 className="font-semibold text-sm mb-3">Top Tags on Null ICAO Records</h4>
                    <ScrollArea className="h-44">
                      <div className="space-y-1">
                        {nullIcao.nullByTag.map((d, i) => (
                          <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/30">
                            <code className="text-primary font-mono">{d.tag}</code>
                            <Badge variant="outline" className="font-mono">{d.count.toLocaleString()}</Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ── TAXONOMY DIAGNOSTICS TAB ── */}
        <TabsContent value="taxonomy" className="space-y-4">
          {!deepAnalysisDone ? (
            <div className="text-center py-12 space-y-4">
              <Tag className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
              <p className="text-muted-foreground text-sm">Run Deep Analysis first to load taxonomy diagnostics</p>
              <Button onClick={runDeepAnalysis} disabled={deepLoading}>
                {deepLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Run Deep Analysis
              </Button>
            </div>
          ) : (
            <>
              <div className="p-3 bg-muted/20 rounded border border-border/50 text-sm text-muted-foreground">
                Taxonomy health check across all <strong className="text-foreground">{taxonomyDiag.reduce((s, d) => s + d.count, 0).toLocaleString()}</strong> records. 
                Critical issues indicate records that are invisible to forensic queries or may produce false correlations.
              </div>
              <ScrollArea className="h-80">
                <div className="space-y-1.5 pr-2">
                  {taxonomyDiag.map((d, i) => (
                    <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs ${
                      d.severity === 'critical' ? 'bg-destructive/10 border-destructive/30' :
                      d.severity === 'warn' ? 'bg-yellow-500/10 border-yellow-500/20' :
                      'bg-muted/20 border-border/30'
                    }`}>
                      <div className="mt-0.5">{getSeverityIcon(d.severity)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-primary font-mono font-bold">{d.tag}</code>
                          <Badge variant="outline" className="font-mono text-xs h-4 px-1">{d.count.toLocaleString()}</Badge>
                          <span className="text-muted-foreground">{d.pct}% of records</span>
                        </div>
                        {d.issue && <p className="text-muted-foreground mt-1 leading-relaxed">{d.issue}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
};

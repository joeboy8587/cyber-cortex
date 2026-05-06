import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Ghost, Loader2, AlertTriangle, Radio, Plane,
  BarChart3, Clock, Crosshair, Search, Database
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend
} from 'recharts';

interface ScanResults {
  overview: {
    total_null: number;
    unique_regs: number;
    tagged: number;
    untagged: number;
    low_alt: number;
    high_speed: number;
    earliest: string | null;
    latest: string | null;
  };
  topAircraft: Array<{
    registration: string;
    detections: number;
    tag: string;
    avg_alt: number;
    avg_speed: number;
    first_seen: string;
    last_seen: string;
  }>;
  taxonomyBreakdown: Array<{ tag: string; count: number }>;
  altitudeDistribution: Array<{ band: string; count: number }>;
  hourlyPattern: Array<{ hour: number; count: number }>;
}

const ALT_COLORS = ['hsl(var(--destructive))', 'hsl(var(--warning))', 'hsl(var(--primary))', 'hsl(var(--success))', 'hsl(var(--muted-foreground))'];
const PIE_COLORS = ['hsl(var(--destructive))', 'hsl(var(--primary))', 'hsl(var(--warning))', 'hsl(var(--success))', 'hsl(var(--accent))', 'hsl(var(--muted-foreground))'];

export function NullIcaoForensicPanel() {
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [results, setResults] = useState<ScanResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driftLoading, setDriftLoading] = useState<'audit' | 'apply' | null>(null);
  const [driftResult, setDriftResult] = useState<any>(null);

  const runColumnDrift = async (mode: 'audit' | 'apply') => {
    setDriftLoading(mode);
    setDriftResult(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('neon-query', {
        body: { action: 'fixColumnDrift', mode }
      });
      if (err) throw new Error(err.message);
      if (data?.error && !data?.partial) throw new Error(data.error);
      setDriftResult(data);
    } catch (err) {
      setDriftResult({ success: false, error: err instanceof Error ? err.message : 'Drift scan failed' });
    } finally {
      setDriftLoading(null);
    }
  };

  const runColumnFix = async () => {
    setFixing(true);
    setFixResult(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('neon-query', {
        body: { action: 'fixIcaoColumnMapping' }
      });
      if (err) throw new Error(err.message);
      if (data?.error) throw new Error(data.error);
      setFixResult(data);
    } catch (err) {
      setFixResult({ success: false, error: err instanceof Error ? err.message : 'Fix failed' });
    } finally {
      setFixing(false);
    }
  };

  const runBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const { data, error: err } = await supabase.functions.invoke('neon-query', {
        body: { action: 'backfillIcaoCodes' }
      });
      if (err) throw new Error(err.message);
      if (data?.error) throw new Error(data.error);
      setBackfillResult(data);
    } catch (err) {
      setBackfillResult({ success: false, error: err instanceof Error ? err.message : 'Backfill failed' });
    } finally {
      setBackfilling(false);
    }
  };

  const runScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const baseFilter = `WHERE icao_code IS NULL OR icao_code = '' OR icao_code = 'UNKNOWN'`;

      const [overviewRes, topAircraftRes, taxonomyRes, altDistRes, hourlyRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT COUNT(*)::int as total_null, COUNT(DISTINCT registration)::int as unique_regs, COUNT(CASE WHEN taxonomy_tag IS NOT NULL AND taxonomy_tag != '' THEN 1 END)::int as tagged, COUNT(CASE WHEN taxonomy_tag IS NULL OR taxonomy_tag = '' THEN 1 END)::int as untagged, COUNT(CASE WHEN altitude < 1000 THEN 1 END)::int as low_alt, COUNT(CASE WHEN speed > 400 THEN 1 END)::int as high_speed, MIN(detection_timestamp) as earliest, MAX(detection_timestamp) as latest FROM live_flight_detections_rows ${baseFilter}`
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT COALESCE(NULLIF(registration,''), 'GHOST (no reg)') as registration, COUNT(*)::int as detections, COALESCE(taxonomy_tag, 'UNTAGGED') as tag, ROUND(AVG(altitude)::numeric,0)::int as avg_alt, ROUND(AVG(speed)::numeric,0)::int as avg_speed, MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen FROM live_flight_detections_rows ${baseFilter} GROUP BY registration, taxonomy_tag ORDER BY detections DESC LIMIT 25`
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT COALESCE(taxonomy_tag, 'UNTAGGED') as tag, COUNT(*)::int as count FROM live_flight_detections_rows ${baseFilter} GROUP BY taxonomy_tag ORDER BY count DESC`
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT CASE WHEN altitude < 500 THEN '0-500ft' WHEN altitude < 1000 THEN '500-1000ft' WHEN altitude < 5000 THEN '1000-5000ft' WHEN altitude < 20000 THEN '5000-20000ft' ELSE '20000ft+' END as band, COUNT(*)::int as count FROM live_flight_detections_rows ${baseFilter} GROUP BY 1 ORDER BY MIN(altitude)`
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `SELECT EXTRACT(HOUR FROM detection_timestamp)::int as hour, COUNT(*)::int as count FROM live_flight_detections_rows ${baseFilter} AND detection_timestamp IS NOT NULL GROUP BY 1 ORDER BY 1`
          }
        }),
      ]);

      const ov = overviewRes.data?.[0] || {};
      const hourlyRaw = Array.isArray(hourlyRes.data) ? hourlyRes.data : [];
      const hourly = Array.from({ length: 24 }, (_, i) => {
        const match = hourlyRaw.find((r: any) => Number(r.hour) === i);
        return { hour: i, count: match ? Number(match.count) : 0 };
      });

      setResults({
        overview: {
          total_null: Number(ov.total_null) || 0,
          unique_regs: Number(ov.unique_regs) || 0,
          tagged: Number(ov.tagged) || 0,
          untagged: Number(ov.untagged) || 0,
          low_alt: Number(ov.low_alt) || 0,
          high_speed: Number(ov.high_speed) || 0,
          earliest: ov.earliest || null,
          latest: ov.latest || null,
        },
        topAircraft: (Array.isArray(topAircraftRes.data) ? topAircraftRes.data : []).map((r: any) => ({
          registration: r.registration,
          detections: Number(r.detections) || 0,
          tag: r.tag,
          avg_alt: Number(r.avg_alt) || 0,
          avg_speed: Number(r.avg_speed) || 0,
          first_seen: r.first_seen || '',
          last_seen: r.last_seen || '',
        })),
        taxonomyBreakdown: (Array.isArray(taxonomyRes.data) ? taxonomyRes.data : []).map((r: any) => ({
          tag: r.tag, count: Number(r.count) || 0
        })),
        altitudeDistribution: (Array.isArray(altDistRes.data) ? altDistRes.data : []).map((r: any) => ({
          band: r.band, count: Number(r.count) || 0
        })),
        hourlyPattern: hourly,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  const fmtNum = (n: number) => n.toLocaleString();
  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString() : 'N/A';
  const pct = (part: number, total: number) => total > 0 ? ((part / total) * 100).toFixed(1) + '%' : '0%';

  return (
    <CyberPanel
      title="Null ICAO Forensic Investigator"
      icon={<Ghost className="w-4 h-4" />}
      variant="threat"
      headerActions={
        <div className="flex items-center gap-2">
          <Button onClick={runColumnFix} disabled={fixing || loading} size="sm" variant="outline" className="gap-2">
            {fixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            {fixing ? 'Fixing...' : 'Fix Column Mapping'}
          </Button>
          <Button onClick={runBackfill} disabled={backfilling || loading} size="sm" variant="outline" className="gap-2">
            {backfilling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
            {backfilling ? 'Backfilling...' : 'Backfill ICAOs'}
          </Button>
          <Button onClick={runScan} disabled={loading} size="sm" className="gap-2">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            {loading ? 'Scanning...' : 'Run Deep Scan'}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
         {error && (
          <div className="p-3 rounded bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {fixResult && (
          <div className={`p-3 rounded text-xs border ${fixResult.success ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
            {fixResult.success ? (
              <div className="space-y-1">
                <p className="font-bold">✅ Column Mapping Fixed — {Number(fixResult.totalFixed).toLocaleString()} records corrected</p>
                <p>Type codes (icao_code→desc): {Number(fixResult.operations?.type_codes_from_icao_to_desc).toLocaleString()}</p>
                <p>Type codes (icao24→desc): {Number(fixResult.operations?.type_codes_from_icao24_to_desc).toLocaleString()}</p>
                <p>Hex copied from icao24: {Number(fixResult.operations?.hex_copied_from_icao24).toLocaleString()}</p>
                <p>Tilde hex copied (~hex→hex): {Number(fixResult.operations?.tilde_hex_copied).toLocaleString()}</p>
              </div>
            ) : (
              <p><AlertTriangle className="w-3 h-3 inline mr-1" />{fixResult.error}</p>
            )}
          </div>
        )}

        {backfillResult && (
          <div className={`p-3 rounded text-xs border ${backfillResult.success ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
            {backfillResult.success ? (
              <div className="space-y-1">
                <p className="font-bold">✅ ICAO Backfill Complete</p>
                <p>Self-backfilled (from same registration): {Number(backfillResult.selfBackfilled).toLocaleString()}</p>
                <p>Remaining null N-prefix registrations: {Number(backfillResult.nullIcaoRegistrations).toLocaleString()}</p>
                <p>FAA registry matches: {Number(backfillResult.registryMatches).toLocaleString()}</p>
                <p>Registry records updated: {Number(backfillResult.registryRecordsUpdated).toLocaleString()}</p>
                <p className="font-bold">Total updated: {Number(backfillResult.totalUpdated).toLocaleString()}</p>
                {backfillResult.mappingSample?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-muted-foreground">Sample mappings:</p>
                    {backfillResult.mappingSample.map((m: any, i: number) => (
                      <span key={i} className="inline-block mr-2">{m.registration}→{m.icao_code}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p><AlertTriangle className="w-3 h-3 inline mr-1" />{backfillResult.error}</p>
            )}
          </div>
        )}

        {!results && !loading && (
          <div className="text-center py-12 text-muted-foreground space-y-2">
            <Ghost className="w-12 h-12 mx-auto opacity-30" />
            <p className="text-sm">Investigates detections with no ICAO24 transponder hex</p>
            <p className="text-xs">Most null-ICAO records are MLAT-only tracks (legitimate). True concealment requires valid registration + flight profile + missing hex.</p>
          </div>
        )}

        {results && (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="aircraft">Aircraft</TabsTrigger>
              <TabsTrigger value="patterns">Patterns</TabsTrigger>
              <TabsTrigger value="taxonomy">Taxonomy</TabsTrigger>
            </TabsList>

            {/* ── OVERVIEW ── */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Null-ICAO Detections', value: fmtNum(results.overview.total_null), icon: Ghost, color: 'text-muted-foreground' },
                  { label: 'Unique Registrations', value: fmtNum(results.overview.unique_regs), icon: Plane, color: 'text-primary' },
                  { label: 'Low Alt (<1000ft)', value: `${fmtNum(results.overview.low_alt)} (${pct(results.overview.low_alt, results.overview.total_null)})`, icon: Crosshair, color: 'text-warning' },
                  { label: 'High Speed (>400kt)', value: `${fmtNum(results.overview.high_speed)} (${pct(results.overview.high_speed, results.overview.total_null)})`, icon: Radio, color: 'text-destructive' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="p-3 rounded border border-border bg-muted/20 space-y-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-3.5 h-3.5 ${color}`} />
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
                    </div>
                    <p className={`font-mono text-lg font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2 rounded border border-border bg-muted/10">
                  <span className="text-muted-foreground">First detection: </span>
                  <span className="font-mono">{fmtDate(results.overview.earliest)}</span>
                </div>
                <div className="p-2 rounded border border-border bg-muted/10">
                  <span className="text-muted-foreground">Last detection: </span>
                  <span className="font-mono">{fmtDate(results.overview.latest)}</span>
                </div>
              </div>

              {/* Altitude Distribution Chart */}
              <div className="border border-border rounded p-3">
                <h4 className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-2">
                  <BarChart3 className="w-3 h-3" /> ALTITUDE DISTRIBUTION
                </h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={results.altitudeDistribution}>
                    <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(v: number) => fmtNum(v)} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {results.altitudeDistribution.map((_, i) => (
                        <Cell key={i} fill={ALT_COLORS[i % ALT_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            {/* ── AIRCRAFT ── */}
            <TabsContent value="aircraft">
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {results.topAircraft.map((ac, i) => (
                    <div key={i} className="p-3 rounded border border-border bg-muted/10 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground">
                            {ac.registration}
                          </span>
                          <Badge variant={ac.tag.includes('xxb') ? 'destructive' : 'secondary'} className="text-[9px]">
                            {ac.tag}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                          <span>Alt: {ac.avg_alt}ft</span>
                          <span>Spd: {ac.avg_speed}kt</span>
                          <span>{fmtDate(ac.first_seen)} → {fmtDate(ac.last_seen)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono text-sm font-bold text-primary">{fmtNum(ac.detections)}</span>
                        <p className="text-[9px] text-muted-foreground">detections</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ── PATTERNS ── */}
            <TabsContent value="patterns">
              <div className="border border-border rounded p-3">
                <h4 className="text-xs font-mono text-muted-foreground mb-2 flex items-center gap-2">
                  <Clock className="w-3 h-3" /> HOURLY ACTIVITY (UTC)
                </h4>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={results.hourlyPattern}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={(h) => `${h}:00`} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip labelFormatter={(h) => `${h}:00 UTC`} formatter={(v: number) => fmtNum(v)} />
                    <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                      {results.hourlyPattern.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.hour >= 19 || entry.hour < 6
                            ? 'hsl(var(--destructive))'
                            : 'hsl(var(--primary))'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Night ops (19:00-06:00)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" /> Day ops (06:00-19:00)
                  </span>
                </div>
              </div>
            </TabsContent>

            {/* ── TAXONOMY ── */}
            <TabsContent value="taxonomy">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-border rounded p-3">
                  <h4 className="text-xs font-mono text-muted-foreground mb-2">TAG DISTRIBUTION</h4>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={results.taxonomyBreakdown.filter(t => t.count > 0)}
                        dataKey="count"
                        nameKey="tag"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ tag, percent }) => `${tag} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={false}
                      >
                        {results.taxonomyBreakdown.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmtNum(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1">
                    {results.taxonomyBreakdown.map((t, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded border border-border bg-muted/10 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                          <span className="font-mono">{t.tag}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{fmtNum(t.count)}</span>
                          <span className="text-muted-foreground">({pct(t.count, results.overview.total_null)})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </CyberPanel>
  );
}

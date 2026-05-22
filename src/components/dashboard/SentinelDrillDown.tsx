import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plane, Download, RefreshCw } from 'lucide-react';
import { useNeonDatabase } from '@/hooks/useNeonDatabase';
import { extractNeonData, safeNumber } from '@/lib/formatters';
import { toast } from 'sonner';

interface DetectionRow {
  detection_timestamp: string;
  registration: string;
  icao24: string | null;
  callsign: string | null;
  altitude: number | null;
  speed: number | null;
  latitude: number | null;
  longitude: number | null;
  flagged: boolean | null;
  flagged_reasons: string | null;
  threat_score: number | null;
}

interface SummaryRow {
  total: string | number;
  min_alt: string | number | null;
  max_alt: string | number | null;
  min_spd: string | number | null;
  first: string | null;
  last: string | null;
}

interface Props {
  initialRegistration?: string;
  windowMinutes?: number;
  referenceTimestamp?: string;
}

function normalizeRegistration(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper || /^\d+\s+AIRCRAFT$/.test(upper)) return '';
  return upper.split(',')[0].trim();
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

export function SentinelDrillDown({ initialRegistration = '', windowMinutes = 30, referenceTimestamp }: Props) {
  const { customQuery } = useNeonDatabase();
  const [registration, setRegistration] = useState(normalizeRegistration(initialRegistration));
  const [hours, setHours] = useState(24);
  const [dedupeByMinute, setDedupeByMinute] = useState(true);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DetectionRow[]>([]);
  const [queryMode, setQueryMode] = useState<string>('');
  const lastAutoRunKey = useRef('');
  const [summary, setSummary] = useState<{
    total: number; min_alt: number | null; max_alt: number | null;
    min_spd: number | null; first: string | null; last: string | null;
  } | null>(null);

  const run = useCallback(async (override?: string, timestampOverride?: string) => {
    const reg = normalizeRegistration(override ?? registration);
    if (!reg) {
      toast.error('Enter a registration (e.g. N912KC)');
      return;
    }
    setRegistration(reg);
    setLoading(true);
    try {
      const safeReg = escapeSqlLiteral(reg);
      const safeHours = Math.max(1, Math.min(2160, Number(hours) || 24));
      const refTs = timestampOverride || referenceTimestamp;
      const timeClause = refTs
        ? `AND detection_timestamp BETWEEN TIMESTAMP '${escapeSqlLiteral(new Date(refTs).toISOString())}' - INTERVAL '${safeHours} hours' AND TIMESTAMP '${escapeSqlLiteral(new Date(refTs).toISOString())}' + INTERVAL '2 hours'`
        : `AND detection_timestamp >= NOW() AT TIME ZONE 'UTC' - INTERVAL '${safeHours} hours'`;
      const baseWhere = `UPPER(registration) = '${safeReg}'`;
      const selectColumns = `detection_timestamp, registration, icao_code AS icao24, callsign,
                 altitude, speed, latitude, longitude,
                 flagged, flagged_reasons, threat_score`;
      const loadRows = (extraWhere: string) => customQuery(
        dedupeByMinute
          ? `SELECT DISTINCT ON (date_trunc('minute', detection_timestamp))
                    ${selectColumns}
             FROM live_flight_detections_rows
             WHERE ${baseWhere}
               ${extraWhere}
             ORDER BY date_trunc('minute', detection_timestamp) DESC, detection_timestamp DESC
             LIMIT 500`
          : `SELECT ${selectColumns}
             FROM live_flight_detections_rows
             WHERE ${baseWhere}
               ${extraWhere}
             ORDER BY detection_timestamp DESC
             LIMIT 500`
      );

      let mode = refTs ? `Around selected violation (${safeHours}h lookback)` : `Last ${safeHours}h`;
      mode += dedupeByMinute ? ' • deduped by minute' : ' • raw pings';
      let detRes = await loadRows(timeClause);
      let dets = extractNeonData<DetectionRow>(detRes);

      if (dets.length === 0) {
        detRes = await loadRows('');
        dets = extractNeonData<DetectionRow>(detRes);
        mode = (dedupeByMinute ? 'Latest archived (deduped/min)' : 'Latest archived raw pings');
      }

      const summaryWhere = mode.startsWith('Latest archived') ? '' : timeClause;
      const countExpr = dedupeByMinute
        ? "COUNT(DISTINCT date_trunc('minute', detection_timestamp))"
        : 'COUNT(*)';
      const sumRes = await customQuery(`
        SELECT ${countExpr} as total,
               MIN(altitude) as min_alt, MAX(altitude) as max_alt,
               MIN(speed) as min_spd,
               MIN(detection_timestamp) as first, MAX(detection_timestamp) as last
        FROM live_flight_detections_rows
        WHERE ${baseWhere}
          ${summaryWhere}
      `);
      const sum = extractNeonData<SummaryRow>(sumRes)[0] || null;
      setRows(dets);
      setQueryMode(mode);
      setSummary(sum ? {
        total: safeNumber(sum.total),
        min_alt: sum.min_alt != null ? safeNumber(sum.min_alt) : null,
        max_alt: sum.max_alt != null ? safeNumber(sum.max_alt) : null,
        min_spd: sum.min_spd != null ? safeNumber(sum.min_spd) : null,
        first: sum.first || null,
        last: sum.last || null,
      } : null);
      if (dets.length === 0) toast.info(`No detections found for ${reg}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown query error';
      toast.error('Drill-down query failed', { description: message });
    } finally {
      setLoading(false);
    }
  }, [registration, hours, customQuery, referenceTimestamp, dedupeByMinute]);

  useEffect(() => {
    const next = normalizeRegistration(initialRegistration);
    if (!next) return;
    const key = `${next}:${referenceTimestamp || ''}`;
    setRegistration(next);
    if (lastAutoRunKey.current === key) return;
    lastAutoRunKey.current = key;
    void run(next, referenceTimestamp);
  }, [initialRegistration, referenceTimestamp, run]);

  const exportCSV = () => {
    if (!rows.length) return;
    const header: (keyof DetectionRow)[] = ['detection_timestamp','registration','icao24','callsign','altitude','speed','latitude','longitude','flagged','flagged_reasons','threat_score'];
    const csv = [header.join(',')].concat(
      rows.map(r => header.map(k => {
        const v = r[k];
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(','))
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0,10).replace(/-/g,'');
    a.href = url;
    a.download = `${ts}_SENTINEL_DRILLDOWN_${registration.toUpperCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          Aircraft Detection Drill-Down
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            placeholder="Registration (e.g. N912KC)"
            value={registration}
            onChange={e => setRegistration(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            className="max-w-[220px] font-mono uppercase"
          />
          <select
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
            className="bg-background border rounded px-2 py-1 text-sm"
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 72h</option>
            <option value={168}>Last 7d</option>
            <option value={720}>Last 30d</option>
            <option value={2160}>Last 90d</option>
          </select>
          <Button size="sm" onClick={() => run()} disabled={loading}>
            {loading ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Plane className="h-4 w-4 mr-1" />}
            Drill Down
          </Button>
          <Button size="sm" variant="outline" onClick={exportCSV} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <div className="flex flex-wrap gap-1 ml-auto">
            {['N912KC','N913KC','N597E','N791FA','N787FA','N788FA','CONG05','STMPD19','CFC3092','N34AK'].map(r => (
              <Badge key={r} variant="outline" className="cursor-pointer hover:bg-primary/10 font-mono text-[10px]"
                onClick={() => { setRegistration(r); run(r); }}>
                {r}
              </Badge>
            ))}
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-xs">
            <Stat label="Detections" value={summary.total.toLocaleString()} />
            <Stat label="Window" value={queryMode || '—'} />
            <Stat label="Min Alt" value={summary.min_alt != null ? `${summary.min_alt}ft` : '—'} />
            <Stat label="Max Alt" value={summary.max_alt != null ? `${summary.max_alt}ft` : '—'} />
            <Stat label="Min Spd" value={summary.min_spd != null ? `${summary.min_spd}kts` : '—'} />
            <Stat label="First Seen" value={summary.first ? new Date(summary.first).toLocaleString() : '—'} />
            <Stat label="Last Seen" value={summary.last ? new Date(summary.last).toLocaleString() : '—'} />
          </div>
        )}

        <ScrollArea className="h-[420px] rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Timestamp</TableHead>
                <TableHead className="text-xs">Callsign</TableHead>
                <TableHead className="text-xs">Alt</TableHead>
                <TableHead className="text-xs">Spd</TableHead>
                <TableHead className="text-xs">Lat / Lng</TableHead>
                <TableHead className="text-xs">Flagged</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-xs py-6">
                  {loading ? 'Loading…' : 'No detections — enter a registration and click Drill Down.'}
                </TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={i} className={r.flagged ? 'bg-destructive/5' : ''}>
                  <TableCell className="text-xs font-mono">{r.detection_timestamp?.slice(0,19) || '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{r.callsign || '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{r.altitude != null ? `${r.altitude}ft` : '—'}</TableCell>
                  <TableCell className="text-xs font-mono">{r.speed != null ? `${r.speed}kts` : '—'}</TableCell>
                  <TableCell className="text-xs font-mono">
                    {r.latitude != null && r.longitude != null
                      ? `${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {r.flagged ? <Badge variant="destructive" className="text-[10px]">FLAG</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[260px] truncate">{r.flagged_reasons || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded p-2">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-mono text-primary break-words">{value}</div>
    </div>
  );
}

import { useState, useCallback } from 'react';
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
  ground_speed: number | null;
  latitude: number | null;
  longitude: number | null;
  flagged: boolean | null;
  flagged_reasons: string | null;
  threat_score: number | null;
}

interface Props {
  initialRegistration?: string;
  windowMinutes?: number;
}

export function SentinelDrillDown({ initialRegistration = '', windowMinutes = 30 }: Props) {
  const { customQuery } = useNeonDatabase();
  const [registration, setRegistration] = useState(initialRegistration);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<DetectionRow[]>([]);
  const [summary, setSummary] = useState<{
    total: number; min_alt: number | null; max_alt: number | null;
    min_spd: number | null; first: string | null; last: string | null;
  } | null>(null);

  const run = useCallback(async (override?: string) => {
    const reg = (override ?? registration).trim().toUpperCase();
    if (!reg) {
      toast.error('Enter a registration (e.g. N912KC)');
      return;
    }
    setLoading(true);
    try {
      const [detRes, sumRes] = await Promise.all([
        customQuery(`
          SELECT detection_timestamp, registration, icao24, callsign,
                 altitude, ground_speed, latitude, longitude,
                 flagged, flagged_reasons, threat_score
          FROM live_flight_detections_rows
          WHERE UPPER(registration) = '${reg.replace(/'/g, "''")}'
            AND detection_timestamp >= NOW() - INTERVAL '${hours} hours'
          ORDER BY detection_timestamp DESC
          LIMIT 500
        `),
        customQuery(`
          SELECT COUNT(*) as total,
                 MIN(altitude) as min_alt, MAX(altitude) as max_alt,
                 MIN(ground_speed) as min_spd,
                 MIN(detection_timestamp) as first, MAX(detection_timestamp) as last
          FROM live_flight_detections_rows
          WHERE UPPER(registration) = '${reg.replace(/'/g, "''")}'
            AND detection_timestamp >= NOW() - INTERVAL '${hours} hours'
        `),
      ]);
      const dets = extractNeonData<DetectionRow>(detRes);
      const sum = extractNeonData<any>(sumRes)[0] || null;
      setRows(dets);
      setSummary(sum ? {
        total: safeNumber(sum.total),
        min_alt: sum.min_alt != null ? safeNumber(sum.min_alt) : null,
        max_alt: sum.max_alt != null ? safeNumber(sum.max_alt) : null,
        min_spd: sum.min_spd != null ? safeNumber(sum.min_spd) : null,
        first: sum.first || null,
        last: sum.last || null,
      } : null);
      if (dets.length === 0) toast.info(`No detections for ${reg} in last ${hours}h`);
    } catch (e: any) {
      toast.error('Drill-down query failed', { description: e.message });
    } finally {
      setLoading(false);
    }
  }, [registration, hours, customQuery]);

  const exportCSV = () => {
    if (!rows.length) return;
    const header = ['detection_timestamp','registration','icao24','callsign','altitude','ground_speed','latitude','longitude','flagged','flagged_reasons','threat_score'];
    const csv = [header.join(',')].concat(
      rows.map(r => header.map(k => {
        const v = (r as any)[k];
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
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
            <Stat label="Detections" value={summary.total.toLocaleString()} />
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
                  <TableCell className="text-xs font-mono">{r.ground_speed != null ? `${r.ground_speed}kts` : '—'}</TableCell>
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
      <div className="text-sm font-mono text-primary truncate">{value}</div>
    </div>
  );
}

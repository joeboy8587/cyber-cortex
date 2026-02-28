import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useArchiveDatabase, ArchiveSummary } from '@/hooks/useArchiveDatabase';
import { safeNumber } from '@/lib/formatters';
import { ShieldAlert, ChevronLeft, ChevronRight, Loader2, Eye } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function SentinelViolationsBoard() {
  const {
    getSentinelViolations, getSentinelViolationsSummary,
    getWatchtowerMaster, isLoading,
  } = useArchiveDatabase();

  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('violations');
  const PAGE_SIZE = 25;

  useEffect(() => {
    getSentinelViolationsSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    loadPage(0);
  }, [tab]);

  const loadPage = async (p: number) => {
    const offset = p * PAGE_SIZE;
    try {
      const data = tab === 'violations'
        ? await getSentinelViolations({ limit: PAGE_SIZE, offset })
        : await getWatchtowerMaster({ limit: PAGE_SIZE, offset });
      setRows(data);
    } catch { setRows([]); }
  };

  const handlePage = (dir: number) => {
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    loadPage(next);
  };

  const severityColor = (s: string) => {
    const sv = (s || '').toLowerCase();
    if (sv === 'critical' || sv === 'high') return 'destructive';
    return 'outline';
  };

  return (
    <Card className="border-destructive/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-destructive/10 border border-destructive/30 flex items-center justify-center">
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-lg font-display uppercase tracking-wider">Sentinel Violations Board</CardTitle>
            <p className="text-xs font-mono text-muted-foreground">
              {safeNumber(summary?.totalRecords).toLocaleString()} VIOLATIONS + 582K WATCHTOWER EVENTS
            </p>
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary && Object.keys(summary.categories).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(summary.categories).slice(0, 10).map(([cat, cnt]) => (
              <Badge key={cat} variant="outline" className="text-[10px] font-mono">
                {cat}: {safeNumber(cnt).toLocaleString()}
              </Badge>
            ))}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="violations" className="flex-1 text-xs">
              <ShieldAlert className="h-3 w-3 mr-1" /> Violations (88K)
            </TabsTrigger>
            <TabsTrigger value="watchtower" className="flex-1 text-xs">
              <Eye className="h-3 w-3 mr-1" /> Watchtower (582K)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="violations">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Detected</TableHead>
                    <TableHead className="text-xs">Aircraft</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Severity</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.detection_timestamp?.slice(0, 19) || '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{row.aircraft_registration || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.violation_type || '—'}</Badge></TableCell>
                      <TableCell><Badge variant={severityColor(row.severity)} className="text-[10px]">{row.severity || '—'}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{row.description || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="watchtower">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Timestamp</TableHead>
                    <TableHead className="text-xs">Registration</TableHead>
                    <TableHead className="text-xs">Event Type</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">HR / Stress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.event_timestamp?.slice(0, 19) || '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{row.registration || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.event_type || '—'}</Badge></TableCell>
                      <TableCell className="text-xs">{row.source_table || '—'}</TableCell>
                      <TableCell className="text-xs">{row.heart_rate ? `${row.heart_rate} bpm` : '—'}{row.stress_level ? ` / ${row.stress_level}` : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground font-mono">Page {page + 1} • {rows.length} records</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(-1)} disabled={page === 0}><ChevronLeft className="h-3 w-3" /></Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(1)} disabled={rows.length < PAGE_SIZE}><ChevronRight className="h-3 w-3" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

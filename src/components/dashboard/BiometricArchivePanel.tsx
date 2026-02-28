import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useArchiveDatabase } from '@/hooks/useArchiveDatabase';
import { safeNumber } from '@/lib/formatters';
import { HeartPulse, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export function BiometricArchivePanel() {
  const {
    getBiometricCollapses, getBiometricBatchEvents, getBiometricEvidence,
    getBiometricAircraftCorrelations, getFullBiometricSummary, isLoading,
  } = useArchiveDatabase();

  const [totals, setTotals] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('collapses');
  const PAGE_SIZE = 25;

  useEffect(() => {
    getFullBiometricSummary().then(setTotals).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    loadPage(0);
  }, [tab]);

  const loadPage = async (p: number) => {
    const offset = p * PAGE_SIZE;
    try {
      let data: any[] = [];
      if (tab === 'collapses') data = await getBiometricCollapses({ limit: PAGE_SIZE, offset });
      else if (tab === 'batch') data = await getBiometricBatchEvents({ limit: PAGE_SIZE, offset });
      else if (tab === 'evidence') data = await getBiometricEvidence({ limit: PAGE_SIZE, offset });
      else if (tab === 'correlations') data = await getBiometricAircraftCorrelations({ limit: PAGE_SIZE, offset });
      setRows(data);
    } catch { setRows([]); }
  };

  const handlePage = (dir: number) => {
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    loadPage(next);
  };

  const totalAll = Object.values(totals).reduce((s, v) => s + safeNumber(v), 0);

  return (
    <Card className="border-destructive/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-destructive/10 border border-destructive/30 flex items-center justify-center">
            <HeartPulse className="h-4 w-4 text-destructive" />
          </div>
          <div>
            <CardTitle className="text-lg font-display uppercase tracking-wider">Full Biometric Archive</CardTitle>
            <p className="text-xs font-mono text-muted-foreground">
              {totalAll.toLocaleString()} RECORDS ACROSS 5 BIOMETRIC TABLES
            </p>
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Table counts */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            { key: 'biometric_threshold_collapses', label: 'Collapses' },
            { key: 'unified_biometric_batch_events', label: 'Batch Events' },
            { key: 'biometric_evidence', label: 'Evidence' },
            { key: 'master_biometric_aircraft_correlations', label: 'Correlations' },
            { key: 'biometric_monitoring', label: 'Monitoring' },
          ].map(item => (
            <div key={item.key} className="rounded border bg-muted/30 p-2 text-center">
              <p className="text-[10px] font-mono text-muted-foreground">{item.label}</p>
              <p className="text-sm font-bold">{safeNumber(totals[item.key]).toLocaleString()}</p>
            </div>
          ))}
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full flex-wrap h-auto">
            <TabsTrigger value="collapses" className="text-xs flex-1">Collapses</TabsTrigger>
            <TabsTrigger value="batch" className="text-xs flex-1">Batch Events</TabsTrigger>
            <TabsTrigger value="evidence" className="text-xs flex-1">Evidence</TabsTrigger>
            <TabsTrigger value="correlations" className="text-xs flex-1">Aircraft Corr.</TabsTrigger>
          </TabsList>

          <TabsContent value="collapses">
            <DataTable rows={rows} isLoading={isLoading} columns={['collapse_timestamp', 'hrv_value', 'heart_rate', 'severity', 'correlated_aircraft']} labels={['Timestamp', 'HRV', 'HR', 'Severity', 'Aircraft']} />
          </TabsContent>
          <TabsContent value="batch">
            <DataTable rows={rows} isLoading={isLoading} columns={['event_timestamp', 'event_type', 'hrv', 'heart_rate', 'severity']} labels={['Timestamp', 'Type', 'HRV', 'HR', 'Severity']} />
          </TabsContent>
          <TabsContent value="evidence">
            <DataTable rows={rows} isLoading={isLoading} columns={['measurement_timestamp', 'hrv', 'heart_rate', 'source', 'severity']} labels={['Timestamp', 'HRV', 'HR', 'Source', 'Severity']} />
          </TabsContent>
          <TabsContent value="correlations">
            <DataTable rows={rows} isLoading={isLoading} columns={['biometric_timestamp', 'registration', 'hrv_delta', 'correlation_strength', 'altitude']} labels={['Timestamp', 'Aircraft', 'HRV Δ', 'Strength', 'Altitude']} />
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

function DataTable({ rows, isLoading, columns, labels }: { rows: any[]; isLoading: boolean; columns: string[]; labels: string[] }) {
  return (
    <div className="rounded border overflow-auto max-h-[350px]">
      <Table>
        <TableHeader>
          <TableRow>
            {labels.map(l => <TableHead key={l} className="text-xs">{l}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records'}</TableCell></TableRow>
          )}
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col, j) => (
                <TableCell key={j} className="text-xs font-mono">
                  {col.includes('timestamp') ? (row[col]?.slice(0, 19) || '—') :
                   col === 'severity' ? <Badge variant="outline" className="text-[10px]">{row[col] || '—'}</Badge> :
                   String(row[col] ?? '—')}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

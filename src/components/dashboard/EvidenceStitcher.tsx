import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useArchiveDatabase, ArchiveSummary } from '@/hooks/useArchiveDatabase';
import { safeNumber } from '@/lib/formatters';
import { Link2, ChevronLeft, ChevronRight, Loader2, Layers } from 'lucide-react';

export function EvidenceStitcher() {
  const {
    getCaseEvidenceLinks, getCaseEvidenceLinksSummary,
    getInvestigatorMasterView, isLoading,
  } = useArchiveDatabase();

  const [summary, setSummary] = useState<ArchiveSummary | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('links');
  const PAGE_SIZE = 25;

  useEffect(() => {
    getCaseEvidenceLinksSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    loadPage(0);
  }, [tab]);

  const loadPage = async (p: number) => {
    const offset = p * PAGE_SIZE;
    try {
      const data = tab === 'links'
        ? await getCaseEvidenceLinks({ limit: PAGE_SIZE, offset })
        : await getInvestigatorMasterView({ limit: PAGE_SIZE, offset });
      setRows(data);
    } catch { setRows([]); }
  };

  const handlePage = (dir: number) => {
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    loadPage(next);
  };

  return (
    <Card className="border-accent/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-accent/10 border border-accent/30 flex items-center justify-center">
            <Link2 className="h-4 w-4 text-accent-foreground" />
          </div>
          <div>
            <CardTitle className="text-lg font-display uppercase tracking-wider">Cross-Modal Evidence Stitcher</CardTitle>
            <p className="text-xs font-mono text-muted-foreground">
              {safeNumber(summary?.totalRecords).toLocaleString()} CASE LINKS + 219K INVESTIGATOR VIEWS
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
            <TabsTrigger value="links" className="flex-1 text-xs">
              <Link2 className="h-3 w-3 mr-1" /> Case Evidence Links (268K)
            </TabsTrigger>
            <TabsTrigger value="master" className="flex-1 text-xs">
              <Layers className="h-3 w-3 mr-1" /> Investigator View (219K)
            </TabsTrigger>
          </TabsList>

          <TabsContent value="links">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Evidence Table</TableHead>
                    <TableHead className="text-xs">Evidence ID</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Confidence</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.evidence_table || '—'}</Badge></TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[100px]">{row.evidence_id || '—'}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{row.evidence_type || '—'}</Badge></TableCell>
                      <TableCell className="text-xs">{safeNumber(row.confidence_score)}%</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{row.link_description || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="master">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Timestamp</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Aircraft</TableHead>
                    <TableHead className="text-xs">Threat</TableHead>
                    <TableHead className="text-xs">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.event_timestamp?.slice(0, 19) || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.event_type || '—'}</Badge></TableCell>
                      <TableCell className="text-xs font-bold">{row.aircraft_id || '—'}</TableCell>
                      <TableCell className="text-xs">{row.threat_level || '—'}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{row.event_description || '—'}</TableCell>
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

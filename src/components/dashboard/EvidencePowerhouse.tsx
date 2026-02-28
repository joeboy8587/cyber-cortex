import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useArchiveDatabase, ArchiveSummary } from '@/hooks/useArchiveDatabase';
import { safeNumber } from '@/lib/formatters';
import { Database, Shield, AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

export function EvidencePowerhouse() {
  const {
    getForensicEvents, getForensicEventsSummary,
    getUnifiedEvidence, getUnifiedEvidenceSummary,
    getThreatTiers, getThreatTiersSummary,
    isLoading,
  } = useArchiveDatabase();

  const [activeTab, setActiveTab] = useState('forensic');
  const [forensicSummary, setForensicSummary] = useState<ArchiveSummary | null>(null);
  const [evidenceSummary, setEvidenceSummary] = useState<ArchiveSummary | null>(null);
  const [threatSummary, setThreatSummary] = useState<ArchiveSummary | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  useEffect(() => {
    getForensicEventsSummary().then(setForensicSummary).catch(() => {});
    getUnifiedEvidenceSummary().then(setEvidenceSummary).catch(() => {});
    getThreatTiersSummary().then(setThreatSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    loadPage(0);
  }, [activeTab]);

  const loadPage = async (p: number) => {
    const offset = p * PAGE_SIZE;
    try {
      let data: any[] = [];
      if (activeTab === 'forensic') data = await getForensicEvents({ limit: PAGE_SIZE, offset });
      else if (activeTab === 'evidence') data = await getUnifiedEvidence({ limit: PAGE_SIZE, offset });
      else if (activeTab === 'threats') data = await getThreatTiers({ limit: PAGE_SIZE, offset });
      setRows(data);
    } catch { setRows([]); }
  };

  const handlePage = (dir: number) => {
    const next = page + dir;
    if (next < 0) return;
    setPage(next);
    loadPage(next);
  };

  const summaryFor = (tab: string) => {
    if (tab === 'forensic') return forensicSummary;
    if (tab === 'evidence') return evidenceSummary;
    return threatSummary;
  };

  const summary = summaryFor(activeTab);
  const totalRecords = safeNumber(forensicSummary?.totalRecords) + safeNumber(evidenceSummary?.totalRecords) + safeNumber(threatSummary?.totalRecords);

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
              <Database className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg font-display uppercase tracking-wider">Evidence Powerhouse</CardTitle>
              <p className="text-xs font-mono text-muted-foreground">
                {totalRecords.toLocaleString()} RECORDS ACROSS 3 MEGA-TABLES
              </p>
            </div>
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Forensic Events', count: forensicSummary?.totalRecords, icon: Shield, color: 'text-chart-1' },
            { label: 'Unified Evidence', count: evidenceSummary?.totalRecords, icon: Database, color: 'text-chart-2' },
            { label: 'Threat Tiers', count: threatSummary?.totalRecords, icon: AlertTriangle, color: 'text-chart-3' },
          ].map(item => (
            <div key={item.label} className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2 mb-1">
                <item.icon className={`h-3.5 w-3.5 ${item.color}`} />
                <span className="text-xs font-mono text-muted-foreground">{item.label}</span>
              </div>
              <p className="text-lg font-bold">{safeNumber(item.count).toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="forensic" className="flex-1 text-xs">Forensic Events</TabsTrigger>
            <TabsTrigger value="evidence" className="flex-1 text-xs">Unified Evidence</TabsTrigger>
            <TabsTrigger value="threats" className="flex-1 text-xs">Threat Tiers</TabsTrigger>
          </TabsList>

          {/* Category breakdown */}
          {summary && Object.keys(summary.categories).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {Object.entries(summary.categories).slice(0, 8).map(([cat, cnt]) => (
                <Badge key={cat} variant="outline" className="text-[10px] font-mono">
                  {cat}: {safeNumber(cnt).toLocaleString()}
                </Badge>
              ))}
            </div>
          )}

          {/* Forensic Events tab */}
          <TabsContent value="forensic">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Timestamp</TableHead>
                    <TableHead className="text-xs">Registration</TableHead>
                    <TableHead className="text-xs">Tag</TableHead>
                    <TableHead className="text-xs">Score</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records found'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.event_timestamp?.slice(0, 19) || '—'}</TableCell>
                      <TableCell className="text-xs font-bold">{row.registration || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.taxonomy_tag || '—'}</Badge></TableCell>
                      <TableCell className="text-xs">{safeNumber(row.threat_score)}</TableCell>
                      <TableCell className="text-xs">{row.source_table || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Unified Evidence tab */}
          <TabsContent value="evidence">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Timestamp</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Source</TableHead>
                    <TableHead className="text-xs">Confidence</TableHead>
                    <TableHead className="text-xs">Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records found'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{row.event_timestamp?.slice(0, 19) || '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.evidence_type || '—'}</Badge></TableCell>
                      <TableCell className="text-xs">{row.source_table || '—'}</TableCell>
                      <TableCell className="text-xs">{safeNumber(row.confidence_score)}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate">{row.summary || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Threat Tiers tab */}
          <TabsContent value="threats">
            <div className="rounded border overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Detection ID</TableHead>
                    <TableHead className="text-xs">Tier</TableHead>
                    <TableHead className="text-xs">WTI Score</TableHead>
                    <TableHead className="text-xs">Threat Level</TableHead>
                    <TableHead className="text-xs">Computed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground text-xs py-8">{isLoading ? 'Loading...' : 'No records found'}</TableCell></TableRow>
                  )}
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono truncate max-w-[120px]">{row.detection_id || '—'}</TableCell>
                      <TableCell><Badge variant="destructive" className="text-[10px]">{row.tier_level || '—'}</Badge></TableCell>
                      <TableCell className="text-xs font-bold">{safeNumber(row.wti_score)}</TableCell>
                      <TableCell className="text-xs">{row.threat_level || '—'}</TableCell>
                      <TableCell className="text-xs font-mono">{row.computed_at?.slice(0, 19) || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground font-mono">
            Page {page + 1} • Showing {rows.length} records
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => handlePage(-1)} disabled={page === 0}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePage(1)} disabled={rows.length < PAGE_SIZE}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

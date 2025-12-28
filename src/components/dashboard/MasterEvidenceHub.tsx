import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Eye, RefreshCw, Loader2, Search, Clock, Plane, Shield, Scale } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface WatchtowerRecord {
  [key: string]: unknown;
  id?: string;
  event_type?: string;
  source_table?: string;
  event_timestamp?: string;
  registration?: string;
  callsign?: string;
  description?: string;
  severity?: string;
  category?: string;
}

interface InvestigatorRecord {
  [key: string]: unknown;
  id?: string;
  event_type?: string;
  timestamp?: string;
  description?: string;
  source?: string;
  priority?: string;
  linked_evidence?: string;
}

interface TimelineRecord {
  [key: string]: unknown;
  id?: string;
  event_timestamp?: string;
  event_type?: string;
  title?: string;
  description?: string;
  source_table?: string;
  severity?: string;
  aircraft_id?: string;
}

interface LegalViolation {
  [key: string]: unknown;
  id?: string;
  violation_type?: string;
  description?: string;
  date_identified?: string;
  severity?: string;
  evidence_refs?: string;
  status?: string;
}

export function MasterEvidenceHub() {
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [watchtowerData, setWatchtowerData] = useState<WatchtowerRecord[]>([]);
  const [investigatorData, setInvestigatorData] = useState<InvestigatorRecord[]>([]);
  const [timelineData, setTimelineData] = useState<TimelineRecord[]>([]);
  const [legalData, setLegalData] = useState<LegalViolation[]>([]);
  const [stats, setStats] = useState({
    watchtower: 0,
    investigator: 0,
    timeline: 0,
    legal: 0
  });

  const customQuery = useCallback(async (query: string) => {
    const { data, error } = await supabase.functions.invoke('neon-query', {
      body: { action: 'customQuery', query }
    });
    if (error) throw error;
    return data?.data || [];
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch counts
      const [watchtowerCount, investigatorCount, timelineCount, legalCount] = await Promise.all([
        customQuery('SELECT COUNT(*)::int as cnt FROM watchtower_unified_master').catch(() => [{ cnt: 0 }]),
        customQuery('SELECT COUNT(*)::int as cnt FROM investigator_master_view_rows').catch(() => [{ cnt: 0 }]),
        customQuery('SELECT COUNT(*)::int as cnt FROM unified_timeline_enhanced').catch(() => [{ cnt: 0 }]),
        customQuery('SELECT COUNT(*)::int as cnt FROM legal_ada_violations_proper').catch(() => [{ cnt: 0 }])
      ]);

      setStats({
        watchtower: watchtowerCount[0]?.cnt || 0,
        investigator: investigatorCount[0]?.cnt || 0,
        timeline: timelineCount[0]?.cnt || 0,
        legal: legalCount[0]?.cnt || 0
      });

      // Fetch sample data from each source
      const [watchtower, investigator, timeline, legal] = await Promise.all([
        customQuery(`
          SELECT * FROM watchtower_unified_master 
          ORDER BY COALESCE(event_timestamp, created_at, NOW()) DESC 
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM investigator_master_view_rows 
          ORDER BY COALESCE(timestamp, created_at, NOW()) DESC 
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM unified_timeline_enhanced 
          ORDER BY COALESCE(event_timestamp, created_at, NOW()) DESC 
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM legal_ada_violations_proper 
          ORDER BY COALESCE(date_identified, created_at, NOW()) DESC 
          LIMIT 50
        `).catch(() => [])
      ]);

      setWatchtowerData(watchtower);
      setInvestigatorData(investigator);
      setTimelineData(timeline);
      setLegalData(legal);

    } catch (err) {
      console.error('Error fetching master evidence:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getSeverityBadge = (severity?: string) => {
    const level = (severity || 'info').toLowerCase();
    const colors: Record<string, string> = {
      critical: 'bg-red-500/20 text-red-400 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-green-500/20 text-green-400 border-green-500/30',
      info: 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    };
    return colors[level] || colors.info;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const filterData = <T extends Record<string, unknown>>(data: T[]): T[] => {
    if (!searchTerm) return data;
    const term = searchTerm.toLowerCase();
    return data.filter(item => 
      Object.values(item).some(v => 
        String(v || '').toLowerCase().includes(term)
      )
    );
  };

  const totalRecords = stats.watchtower + stats.investigator + stats.timeline + stats.legal;

  return (
    <CyberPanel
      title="MASTER EVIDENCE HUB"
      icon={<Eye className="w-5 h-5" />}
      className="border-purple-500/30"
    >
      <div className="space-y-4">
        {/* Stats Header */}
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{totalRecords.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Records</div>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 text-center">
            <Plane className="w-4 h-4 mx-auto mb-1 text-cyan-400" />
            <div className="text-lg font-bold text-cyan-400">{stats.watchtower.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Watchtower</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-center">
            <Search className="w-4 h-4 mx-auto mb-1 text-orange-400" />
            <div className="text-lg font-bold text-orange-400">{stats.investigator.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Investigator</div>
          </div>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
            <Clock className="w-4 h-4 mx-auto mb-1 text-green-400" />
            <div className="text-lg font-bold text-green-400">{stats.timeline.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Timeline</div>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
            <Scale className="w-4 h-4 mx-auto mb-1 text-red-400" />
            <div className="text-lg font-bold text-red-400">{stats.legal.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Legal</div>
          </div>
        </div>

        {/* Search and Refresh */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search across all evidence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="icon" onClick={fetchData} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          </div>
        ) : (
          <Tabs defaultValue="watchtower" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="watchtower" className="text-xs">
                <Plane className="w-3 h-3 mr-1" /> Watchtower
              </TabsTrigger>
              <TabsTrigger value="investigator" className="text-xs">
                <Search className="w-3 h-3 mr-1" /> Investigator
              </TabsTrigger>
              <TabsTrigger value="timeline" className="text-xs">
                <Clock className="w-3 h-3 mr-1" /> Timeline
              </TabsTrigger>
              <TabsTrigger value="legal" className="text-xs">
                <Scale className="w-3 h-3 mr-1" /> Legal
              </TabsTrigger>
            </TabsList>

            <TabsContent value="watchtower" className="mt-4">
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {filterData(watchtowerData).map((record, idx) => (
                    <div key={idx} className="bg-muted/30 rounded-lg p-3 border border-cyan-500/20">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getSeverityBadge(String(record.severity || ''))}>
                            {String(record.severity || 'INFO')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.event_type || 'Event')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.event_timestamp || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.description || 'No description')}
                      </div>
                      {(record.registration || record.callsign) && (
                        <div className="flex gap-2 mt-2">
                          {record.registration && (
                            <Badge variant="outline" className="text-xs">
                              Reg: {String(record.registration)}
                            </Badge>
                          )}
                          {record.callsign && (
                            <Badge variant="outline" className="text-xs">
                              CS: {String(record.callsign)}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {watchtowerData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No watchtower records found
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="investigator" className="mt-4">
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {filterData(investigatorData).map((record, idx) => (
                    <div key={idx} className="bg-muted/30 rounded-lg p-3 border border-orange-500/20">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getSeverityBadge(String(record.priority || ''))}>
                            {String(record.priority || 'NORMAL')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.event_type || 'Investigation')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.timestamp || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.description || 'No description')}
                      </div>
                      {record.source && (
                        <Badge variant="outline" className="text-xs mt-2">
                          Source: {String(record.source)}
                        </Badge>
                      )}
                    </div>
                  ))}
                  {investigatorData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No investigator records found
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {filterData(timelineData).map((record, idx) => (
                    <div key={idx} className="bg-muted/30 rounded-lg p-3 border border-green-500/20">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getSeverityBadge(String(record.severity || ''))}>
                            {String(record.event_type || 'EVENT')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.title || 'Timeline Event')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.event_timestamp || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.description || 'No description')}
                      </div>
                      {record.source_table && (
                        <Badge variant="outline" className="text-xs mt-2">
                          From: {String(record.source_table)}
                        </Badge>
                      )}
                    </div>
                  ))}
                  {timelineData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No timeline events found
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="legal" className="mt-4">
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {filterData(legalData).map((record, idx) => (
                    <div key={idx} className="bg-muted/30 rounded-lg p-3 border border-red-500/20">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <Badge className={getSeverityBadge(String(record.severity || ''))}>
                            {String(record.severity || 'VIOLATION')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.violation_type || 'Legal Violation')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.date_identified || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.description || 'No description')}
                      </div>
                      {record.status && (
                        <Badge variant="outline" className="text-xs mt-2">
                          Status: {String(record.status)}
                        </Badge>
                      )}
                    </div>
                  ))}
                  {legalData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      No legal violations found
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}

        {/* Integration Notice */}
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-purple-400 font-medium text-sm">
            <Shield className="w-4 h-4" />
            Previously Missing Data Now Integrated
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            This panel surfaces {totalRecords.toLocaleString()} records from 4 major evidence tables that were previously not visible in the command center.
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}

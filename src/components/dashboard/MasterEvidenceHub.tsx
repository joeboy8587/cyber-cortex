import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Eye, RefreshCw, Loader2, Search, Clock, Plane, Shield, Scale } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// watchtower_unified_master schema
interface WatchtowerRecord {
  [key: string]: unknown;
  event_id?: string;
  event_type?: string;
  source_table?: string;
  event_timestamp?: string;
  registration?: string;
  callsign?: string;
  heart_rate?: number;
  hrv?: number;
  stress_level?: number;
  altitude_ft?: number;
  operator?: string;
}

// investigator_master_view_rows schema
interface InvestigatorRecord {
  [key: string]: unknown;
  serial_id?: number;
  event_id?: string;
  event_type?: string;
  event_description?: string;
  event_timestamp?: string;
  aircraft_id?: string;
  threat_level?: string;
  altitude?: number;
  heart_rate?: number;
  stress_score?: number;
  correlation_strength?: string;
}

// unified_timeline_enhanced schema
interface TimelineRecord {
  [key: string]: unknown;
  id?: number;
  event_id?: string;
  event_time?: string;
  event_type?: string;
  description?: string;
  source?: string;
  aircraft_id?: string;
  altitude?: number;
  threat_level?: string;
  heart_rate?: number;
  correlation_score?: number;
}

// legal_ada_violations_proper schema
interface LegalViolation {
  [key: string]: unknown;
  serial_id?: number;
  id?: string;
  aircraft_id?: string;
  aircraft_registration?: string;
  stress_score?: number;
  heart_rate?: number;
  correlation_score?: number;
  biometric_timestamp?: string;
  harm_severity?: string;
  violation_type?: string;
  created_at?: string;
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

      // Fetch sample data with correct column ordering
      const [watchtower, investigator, timeline, legal] = await Promise.all([
        customQuery(`
          SELECT * FROM watchtower_unified_master 
          ORDER BY event_timestamp DESC NULLS LAST
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM investigator_master_view_rows 
          ORDER BY event_timestamp DESC NULLS LAST
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM unified_timeline_enhanced 
          ORDER BY event_time DESC NULLS LAST
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT * FROM legal_ada_violations_proper 
          ORDER BY created_at DESC NULLS LAST
          LIMIT 50
        `).catch(() => [])
      ]);

      // Extract array from response, handling error objects
      const extractArray = (result: unknown): unknown[] => {
        if (Array.isArray(result)) return result;
        if (result && typeof result === 'object' && 'data' in result) {
          const nested = (result as { data: unknown }).data;
          if (Array.isArray(nested)) return nested;
        }
        return [];
      };

      setWatchtowerData(extractArray(watchtower) as WatchtowerRecord[]);
      setInvestigatorData(extractArray(investigator) as InvestigatorRecord[]);
      setTimelineData(extractArray(timeline) as TimelineRecord[]);
      setLegalData(extractArray(legal) as LegalViolation[]);

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
    // Ensure data is always an array
    const safeData = Array.isArray(data) ? data : [];
    if (!searchTerm) return safeData;
    const term = searchTerm.toLowerCase();
    return safeData.filter(item => 
      Object.values(item || {}).some(v => 
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
                          <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
                            {String(record.event_type || 'Event')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.source_table || '')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.event_timestamp || ''))}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {record.registration && (
                          <Badge variant="outline">Reg: {String(record.registration)}</Badge>
                        )}
                        {record.callsign && (
                          <Badge variant="outline">CS: {String(record.callsign)}</Badge>
                        )}
                        {record.heart_rate && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-400">HR: {record.heart_rate}</Badge>
                        )}
                        {record.altitude_ft && (
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400">Alt: {record.altitude_ft}ft</Badge>
                        )}
                      </div>
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
                          <Badge className={getSeverityBadge(String(record.threat_level || ''))}>
                            {String(record.threat_level || 'NORMAL')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.event_type || 'Investigation')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.event_timestamp || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.event_description || 'No description')}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {record.aircraft_id && (
                          <Badge variant="outline">Aircraft: {String(record.aircraft_id)}</Badge>
                        )}
                        {record.correlation_strength && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-400">Corr: {String(record.correlation_strength)}</Badge>
                        )}
                      </div>
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
                          <Badge className={getSeverityBadge(String(record.threat_level || ''))}>
                            {String(record.event_type || 'EVENT')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.source || 'Timeline')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.event_time || ''))}
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {String(record.description || 'No description')}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {record.aircraft_id && (
                          <Badge variant="outline">Aircraft: {String(record.aircraft_id)}</Badge>
                        )}
                        {record.correlation_score && (
                          <Badge variant="outline" className="bg-green-500/10 text-green-400">Score: {record.correlation_score}</Badge>
                        )}
                      </div>
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
                          <Badge className={getSeverityBadge(String(record.harm_severity || ''))}>
                            {String(record.harm_severity || 'VIOLATION')}
                          </Badge>
                          <span className="text-sm font-medium">{String(record.violation_type || 'Legal Violation')}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(String(record.created_at || record.biometric_timestamp || ''))}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {record.aircraft_registration && (
                          <Badge variant="outline">Reg: {String(record.aircraft_registration)}</Badge>
                        )}
                        {record.heart_rate && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-400">HR: {record.heart_rate}</Badge>
                        )}
                        {record.stress_score && (
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-400">Stress: {record.stress_score}</Badge>
                        )}
                        {record.correlation_score && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-400">Corr: {record.correlation_score}</Badge>
                        )}
                      </div>
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

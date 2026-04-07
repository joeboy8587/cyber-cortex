import { useState, useEffect, useCallback, useRef } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Database, RefreshCw, Tag, Filter, Radar, Plane, 
  FileText, AlertTriangle, Loader2, CheckCircle, BarChart3,
  Search, Clock, TrendingUp, Eye
} from 'lucide-react';

interface TaxonomyEntry {
  tag: string;
  domain: string;
  description: string;
  detection_pattern: string;
  priority: number;
  created_at: string;
  throttle_window?: number;
}

interface TaxonomyStats {
  tag: string;
  count: number;
  avg_altitude: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

interface FilteredRecord {
  registration?: string;
  callsign?: string;
  altitude?: number;
  speed?: number;
  detection_timestamp?: string;
  taxonomy_tag?: string;
}

interface BackfillState {
  table: string;
  progress: number;
  isRunning: boolean;
}

const domainIcons: Record<string, React.ReactNode> = {
  Telemetry: <Radar className="h-4 w-4" />,
  Airport: <Plane className="h-4 w-4" />,
  Registration: <FileText className="h-4 w-4" />,
  Exercise: <AlertTriangle className="h-4 w-4" />,
  MRTD: <Tag className="h-4 w-4" />,
  Industrial: <Database className="h-4 w-4" />,
  Technical: <BarChart3 className="h-4 w-4" />,
  Fallback: <Filter className="h-4 w-4" />,
};

// Improved contrast for WCAG AA compliance
const domainColors: Record<string, string> = {
  Telemetry: 'bg-red-500/20 text-red-300 border-red-500/30 font-medium',
  Airport: 'bg-blue-500/20 text-blue-300 border-blue-500/30 font-medium',
  Registration: 'bg-green-500/20 text-green-300 border-green-500/30 font-medium',
  Exercise: 'bg-amber-600/30 text-amber-200 border-amber-500/40 font-semibold', // Fixed contrast
  MRTD: 'bg-purple-500/20 text-purple-300 border-purple-500/30 font-medium',
  Industrial: 'bg-orange-500/20 text-orange-300 border-orange-500/30 font-medium',
  Technical: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30 font-medium',
  Fallback: 'bg-gray-500/20 text-gray-300 border-gray-500/30 font-medium',
};

// Full regex with flags for tooltip display
const fullRegexPatterns: Record<string, string> = {
  '^XX[bB]-': '/^XX[bB](?:-|$)/i',
  'Woodford|EGCD': '/\\b(Woodford|EGCD)\\b/i',
  '-XXB$': '/-XXB$/i',
  'Brownland|SIMEX': '/\\b(Brownland|SIMEX)\\b/i',
  'XXB|stateless': '/\\b(XXB|stateless)\\b/i',
  'DOT.*XXB|retread': '/DOT.*XXB|retread/i',
  'XXB.*=|formula': '/XXB.*=|formula/i',
};

export function XXBTaxonomyPanel() {
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[]>([]);
  const [stats, setStats] = useState<TaxonomyStats[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<FilteredRecord[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [backfillStates, setBackfillStates] = useState<Record<string, BackfillState>>({});
  const [tableInitialized, setTableInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('taxonomy');
  const [unclassifiedCount, setUnclassifiedCount] = useState<number | null>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  const createTaxonomyTable = useCallback(async () => {
    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'createTaxonomyTable' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      toast.success('Taxonomy table created', {
        description: data?.data?.message || 'id_taxonomy seeded with 7 XXB tags'
      });
      setTableInitialized(true);
      loadTaxonomy();
    } catch (err) {
      toast.error('Failed to create taxonomy table', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsCreating(false);
    }
  }, []);

  const loadTaxonomy = useCallback(async () => {
    setIsLoading(true);
    try {
      // First try the dedicated action
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getTaxonomy' }
      });
      
      if (!error && data?.data && !data?.data?.notInitialized && !data?.error?.includes('does not exist')) {
        setTaxonomy(data?.data || []);
        setTableInitialized(true);
        return;
      }
      
      // Fallback: query id_taxonomy directly (8 rows exist)
      const { data: directData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `SELECT tag, domain, description, detection_pattern, priority, created_at, throttle_window FROM id_taxonomy ORDER BY priority DESC`
        }
      });
      
      if (directData && Array.isArray(directData) && directData.length > 0) {
        setTaxonomy(directData);
        setTableInitialized(true);
      } else {
        setTableInitialized(false);
      }
    } catch (err) {
      console.error('Load taxonomy error:', err);
      // Last resort fallback
      try {
        const { data: fallback } = await supabase.functions.invoke('neon-query', {
          body: { action: 'customQuery', query: `SELECT * FROM id_taxonomy ORDER BY priority DESC` }
        });
        if (fallback && Array.isArray(fallback) && fallback.length > 0) {
          setTaxonomy(fallback);
          setTableInitialized(true);
        } else {
          setTableInitialized(false);
        }
      } catch {
        setTableInitialized(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'taxonomyStats' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      if (data?.data?.notInitialized) {
        setStats([]);
        return;
      }
      
      const statsData = data?.data || [];
      setStats(statsData);
      
      // Calculate unclassified percentage for dark-noise audit
      // The DB returns null taxonomy_tag which gets coalesced to 'unclassified' in the query
      const unclassified = statsData.find((s: TaxonomyStats) => 
        s.tag === 'unclassified' || s.tag === null
      );
      if (unclassified) {
        const total = statsData.reduce((acc: number, s: TaxonomyStats) => acc + Number(s.count), 0);
        const pct = total > 0 ? (Number(unclassified.count) / total) * 100 : 0;
        setUnclassifiedCount(pct);
      } else {
        setUnclassifiedCount(0);
      }
    } catch (err) {
      console.error('Load stats error:', err);
    }
  }, []);

  const runBackfill = useCallback(async (tableName: string) => {
    setBackfillStates(prev => ({
      ...prev,
      [tableName]: { table: tableName, progress: 0, isRunning: true }
    }));
    
    // Simulate progress while waiting for response
    const progressInterval = setInterval(() => {
      setBackfillStates(prev => {
        const current = prev[tableName];
        if (current && current.progress < 90) {
          return {
            ...prev,
            [tableName]: { ...current, progress: current.progress + 10 }
          };
        }
        return prev;
      });
    }, 500);

    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'backfillTaxonomy', table: tableName }
      });
      
      clearInterval(progressInterval);
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setBackfillStates(prev => ({
        ...prev,
        [tableName]: { table: tableName, progress: 100, isRunning: false }
      }));
      
      toast.success(`Backfill complete for ${tableName}`, {
        description: (data?.data?.backfilled || []).join(', ')
      });
      loadStats();
    } catch (err) {
      clearInterval(progressInterval);
      setBackfillStates(prev => ({
        ...prev,
        [tableName]: { table: tableName, progress: 0, isRunning: false }
      }));
      toast.error('Backfill failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }, [loadStats]);

  const queryByTag = useCallback(async (tag: string, maxAlt?: number, minSpeed?: number) => {
    setSelectedTag(tag);
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'queryByTaxonomy', 
          taxonomy_tag: tag,
          max_alt: maxAlt,
          min_speed: minSpeed
        }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setFilteredRecords(data?.data || []);
    } catch (err) {
      toast.error('Query failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const jumpToStats = useCallback((tag: string) => {
    setActiveTab('stats');
    setSelectedTag(tag);
    // Scroll to stats section after tab change
    setTimeout(() => {
      statsRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => {
    loadTaxonomy();
    loadStats();
  }, [loadTaxonomy, loadStats]);

  return (
    <TooltipProvider>
      <CyberPanel 
        title="XXB TAXONOMY CLASSIFIER" 
        icon={<Tag className="h-5 w-5" />}
        className="col-span-full"
      >
        {/* Dark-noise audit warning with quick-fix buttons */}
        {unclassifiedCount !== null && unclassifiedCount > 5 && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
              <div className="text-sm flex-1">
                <span className="text-amber-300 font-medium">Dark-noise alert:</span>{' '}
                <span className="text-amber-200/80">
                  {unclassifiedCount.toFixed(1)}% of records unclassified.
                </span>
              </div>
            </div>
            <div className="flex gap-2 ml-8">
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20"
                onClick={async () => {
                  try {
                    toast.loading('Creating classify_xxb function...');
                    const { error } = await supabase.functions.invoke('neon-query', {
                      body: { action: 'createClassifyFunction' }
                    });
                    if (error) throw error;
                    toast.success('classify_xxb function created');
                  } catch (err) {
                    toast.error('Failed to create function', {
                      description: err instanceof Error ? err.message : 'Unknown error'
                    });
                  }
                }}
              >
                1. Create Classifier
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs bg-green-500/10 border-green-500/30 hover:bg-green-500/20"
                onClick={async () => {
                  try {
                    toast.loading('Backfilling NULL → xxb_unknown...');
                    const { data, error } = await supabase.functions.invoke('neon-query', {
                      body: { action: 'backfillUnknown' }
                    });
                    if (error) throw error;
                    toast.success(data?.data?.message || 'Backfill complete');
                    loadStats();
                  } catch (err) {
                    toast.error('Backfill failed', {
                      description: err instanceof Error ? err.message : 'Unknown error'
                    });
                  }
                }}
              >
                2. Tag as xxb_unknown
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                onClick={() => loadStats()}
              >
                3. Refresh Stats
              </Button>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid grid-cols-4 w-full max-w-lg">
            <TabsTrigger value="taxonomy">Taxonomy</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
            <TabsTrigger value="filter">Filter</TabsTrigger>
            <TabsTrigger value="backfill" className="relative">
              Backfill
              {backfillStates && Object.values(backfillStates).some(s => s?.isRunning) && (
                <span className="absolute -top-1 -right-1 h-2 w-2 bg-primary rounded-full animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="taxonomy" className="space-y-4">
            {!tableInitialized ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <Database className="h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">Taxonomy table not initialized</p>
                <Button onClick={createTaxonomyTable} disabled={isCreating}>
                  {isCreating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating...</>
                  ) : (
                    <><Database className="h-4 w-4 mr-2" /> Seed id_taxonomy Table</>
                  )}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center">
                  <p className="text-sm text-muted-foreground">
                    7 XXB signal types across telemetry, aviation, and regulatory domains
                  </p>
                  <Button variant="outline" size="sm" onClick={loadTaxonomy} disabled={isLoading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Pattern</TableHead>
                      <TableHead>Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {taxonomy.map((entry) => (
                      <TableRow 
                        key={entry.tag}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => queryByTag(entry.tag)}
                      >
                        <TableCell>
                          <code className="text-primary font-mono text-sm">{entry.tag}</code>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className={`${domainColors[entry.domain] || ''} flex items-center gap-1 w-fit`}
                          >
                            {domainIcons[entry.domain]}
                            {entry.domain}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm">
                          {entry.description}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              {entry.detection_pattern}
                            </code>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary transition-colors">
                                  <Search className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="font-mono text-xs max-w-xs">
                                <p className="text-primary">Full Regex:</p>
                                <code className="text-green-400">
                                  {fullRegexPatterns[entry.detection_pattern] || `/${entry.detection_pattern}/i`}
                                </code>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant={entry.priority >= 80 ? 'destructive' : entry.priority >= 50 ? 'default' : 'secondary'}>
                              P{entry.priority}
                            </Badge>
                            {entry.domain === 'Telemetry' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    <span className="text-xs">10m</span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-sm">Throttle window: 10 minutes</p>
                                  <p className="text-xs text-muted-foreground">Click to adjust</p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </TabsContent>

          <TabsContent value="stats" className="space-y-4" ref={statsRef}>
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                Distribution of taxonomy tags across flight detections
              </p>
              <Button variant="outline" size="sm" onClick={loadStats}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Stats
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stats.map((stat) => (
                <div 
                  key={stat.tag}
                  className={`border rounded-lg p-4 bg-card hover:bg-muted/30 transition-colors cursor-pointer ${
                    selectedTag === stat.tag ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => stat.tag !== 'unclassified' && queryByTag(stat.tag)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <code className="text-primary font-mono">{stat.tag}</code>
                    <Badge variant="secondary">{stat.count} records</Badge>
                  </div>
                  {stat.avg_altitude && (
                    <p className="text-sm text-muted-foreground">
                      Avg Alt: {Math.round(stat.avg_altitude)} ft
                    </p>
                  )}
                  {stat.last_seen && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last: {new Date(stat.last_seen).toLocaleDateString()}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="filter" className="space-y-4">
            <div className="flex flex-wrap gap-2 mb-4">
              <p className="text-sm text-muted-foreground w-full mb-2">
                Quick filters for MLAT ghost detection:
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => queryByTag('xxb_mlat', 300, 120)}
              >
                <AlertTriangle className="h-4 w-4 mr-2 text-red-400" />
                MLAT &lt;300ft &gt;120kt (Tier-1)
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => queryByTag('xxb_mlat', 500)}
              >
                <Radar className="h-4 w-4 mr-2 text-yellow-400" />
                MLAT &lt;500ft (All)
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => queryByTag('xxb_sim')}
              >
                <Plane className="h-4 w-4 mr-2 text-blue-400" />
                Brownland Exercise
              </Button>
            </div>

            {selectedTag && (
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      Showing records tagged: <code className="text-primary">{selectedTag}</code>
                    </span>
                    <Badge>{filteredRecords.length} results</Badge>
                  </div>
                  {/* Stats shortcut button */}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => jumpToStats(selectedTag)}
                    className="text-primary hover:text-primary/80"
                  >
                    <TrendingUp className="h-4 w-4 mr-1" />
                    <Eye className="h-4 w-4 mr-1" />
                    View Chart
                  </Button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registration</TableHead>
                        <TableHead>Callsign</TableHead>
                        <TableHead>Altitude</TableHead>
                        <TableHead>Speed</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecords.slice(0, 20).map((rec, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{rec.registration || '-'}</TableCell>
                          <TableCell>{rec.callsign || '-'}</TableCell>
                          <TableCell>{rec.altitude ? `${rec.altitude} ft` : '-'}</TableCell>
                          <TableCell>{rec.speed ? `${rec.speed} kt` : '-'}</TableCell>
                          <TableCell className="text-xs">
                            {rec.detection_timestamp 
                              ? new Date(rec.detection_timestamp).toLocaleString() 
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="backfill" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add taxonomy_tag column and classify existing records by XXB patterns
            </p>

            <div className="grid grid-cols-2 gap-4">
              {[
                { table: 'live_flight_detections_rows', label: 'Flight Detections' },
                { table: 'ocr_aircraft_holding_patterns', label: 'OCR Patterns' },
                { table: 'radar_screenshot_analysis', label: 'Radar Screenshots' },
                { table: 'aircraft_registry_enriched', label: 'Aircraft Registry' },
              ].map(({ table, label }) => {
                const state = backfillStates[table];
                const isRunning = state?.isRunning || false;
                const progress = state?.progress || 0;
                
                return (
                  <div key={table} className="relative">
                    <Button
                      variant="outline"
                      className="h-auto py-4 w-full flex flex-col items-start relative overflow-hidden"
                      onClick={() => runBackfill(table)}
                      disabled={isRunning}
                    >
                      {/* Progress bar overlay */}
                      {isRunning && (
                        <div 
                          className="absolute inset-0 bg-primary/10 transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      )}
                      <span className="font-medium relative z-10">{label}</span>
                      <span className="text-xs text-muted-foreground font-mono relative z-10">{table}</span>
                      <div className="flex items-center gap-2 mt-2 relative z-10">
                        {isRunning ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs text-muted-foreground">{progress}%</span>
                          </>
                        ) : progress === 100 ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <Database className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </Button>
                    {/* Thin progress line under button */}
                    {isRunning && (
                      <Progress value={progress} className="h-1 mt-1" />
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </CyberPanel>
    </TooltipProvider>
  );
}

export default XXBTaxonomyPanel;

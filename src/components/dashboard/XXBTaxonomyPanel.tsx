import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Database, RefreshCw, Tag, Filter, Radar, Plane, 
  FileText, AlertTriangle, Loader2, CheckCircle, BarChart3 
} from 'lucide-react';

interface TaxonomyEntry {
  tag: string;
  domain: string;
  description: string;
  detection_pattern: string;
  priority: number;
  created_at: string;
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

const domainIcons: Record<string, React.ReactNode> = {
  Telemetry: <Radar className="h-4 w-4" />,
  Airport: <Plane className="h-4 w-4" />,
  Registration: <FileText className="h-4 w-4" />,
  Exercise: <AlertTriangle className="h-4 w-4" />,
  MRTD: <Tag className="h-4 w-4" />,
  Industrial: <Database className="h-4 w-4" />,
  Technical: <BarChart3 className="h-4 w-4" />,
};

const domainColors: Record<string, string> = {
  Telemetry: 'bg-red-500/20 text-red-400 border-red-500/30',
  Airport: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Registration: 'bg-green-500/20 text-green-400 border-green-500/30',
  Exercise: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  MRTD: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  Industrial: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Technical: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

export function XXBTaxonomyPanel() {
  const [taxonomy, setTaxonomy] = useState<TaxonomyEntry[]>([]);
  const [stats, setStats] = useState<TaxonomyStats[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<FilteredRecord[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [tableInitialized, setTableInitialized] = useState(false);

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
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getTaxonomy' }
      });
      
      if (error) throw error;
      if (data?.error) {
        if (data.error.includes('does not exist')) {
          setTableInitialized(false);
          return;
        }
        throw new Error(data.error);
      }
      
      // Handle notInitialized response
      if (data?.data?.notInitialized) {
        setTableInitialized(false);
        return;
      }
      
      setTaxonomy(data?.data || []);
      setTableInitialized(true);
    } catch (err) {
      console.error('Load taxonomy error:', err);
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
      
      // Handle notInitialized response gracefully
      if (data?.data?.notInitialized) {
        setStats([]);
        return;
      }
      
      setStats(data?.data || []);
    } catch (err) {
      console.error('Load stats error:', err);
    }
  }, []);

  const runBackfill = useCallback(async (tableName: string) => {
    setIsBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'backfillTaxonomy', table: tableName }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      toast.success(`Backfill complete for ${tableName}`, {
        description: (data?.data?.backfilled || []).join(', ')
      });
      loadStats();
    } catch (err) {
      toast.error('Backfill failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsBackfilling(false);
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

  useEffect(() => {
    loadTaxonomy();
    loadStats();
  }, [loadTaxonomy, loadStats]);

  return (
    <CyberPanel 
      title="XXB TAXONOMY CLASSIFIER" 
      icon={<Tag className="h-5 w-5" />}
      className="col-span-full"
    >
      <Tabs defaultValue="taxonomy" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="taxonomy">Taxonomy</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
          <TabsTrigger value="filter">Filter</TabsTrigger>
          <TabsTrigger value="backfill">Backfill</TabsTrigger>
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
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {entry.detection_pattern}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.priority >= 80 ? 'destructive' : entry.priority >= 50 ? 'default' : 'secondary'}>
                          P{entry.priority}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </TabsContent>

        <TabsContent value="stats" className="space-y-4">
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
                className="border rounded-lg p-4 bg-card hover:bg-muted/30 transition-colors cursor-pointer"
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
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-primary" />
                <span className="text-sm">
                  Showing records tagged: <code className="text-primary">{selectedTag}</code>
                </span>
                <Badge>{filteredRecords.length} results</Badge>
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
            ].map(({ table, label }) => (
              <Button
                key={table}
                variant="outline"
                className="h-auto py-4 flex flex-col items-start"
                onClick={() => runBackfill(table)}
                disabled={isBackfilling}
              >
                <span className="font-medium">{label}</span>
                <span className="text-xs text-muted-foreground font-mono">{table}</span>
                {isBackfilling ? (
                  <Loader2 className="h-4 w-4 mt-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mt-2 text-green-400" />
                )}
              </Button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

export default XXBTaxonomyPanel;

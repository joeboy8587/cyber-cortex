import { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Database, CheckCircle, AlertCircle, XCircle, RefreshCw, Loader2, BarChart3, AlertTriangle, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface TableStats {
  table_name: string;
  estimated_rows: number;
  integrated: boolean;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

interface CategorySummary {
  name: string;
  tables: number;
  records: number;
  integrated: number;
  coverage: number;
}

// All tables in the Neon archive are now queryable via neon-query edge function
// and browsable via TableExplorer — mark every discovered table as integrated.
// We keep a small exclusion list for system/temp tables that aren't evidence.
const EXCLUDED_TABLES = new Set([
  'schema_migrations',
  'pg_stat_statements',
]);

function isIntegrated(tableName: string): boolean {
  return !EXCLUDED_TABLES.has(tableName);
}

// Categorize tables by their purpose
function categorizeTable(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('flight') || lower.includes('aircraft') || lower.includes('radar') || lower.includes('adsb')) return 'Aviation';
  if (lower.includes('biometric') || lower.includes('heart') || lower.includes('hrv') || lower.includes('pulse') || lower.includes('welltory')) return 'Biometric';
  if (lower.includes('josiah') || lower.includes('chat') || lower.includes('conversation')) return 'AI/Josiah';
  if (lower.includes('legal') || lower.includes('rico') || lower.includes('ada') || lower.includes('nuremberg') || lower.includes('geneva')) return 'Legal';
  if (lower.includes('watchtower') || lower.includes('investigator') || lower.includes('surveillance')) return 'Surveillance';
  if (lower.includes('ocr') || lower.includes('screenshot') || lower.includes('forensic') || lower.includes('custody')) return 'Forensic/OCR';
  if (lower.includes('shell') || lower.includes('enterprise') || lower.includes('operator')) return 'Entity Analysis';
  if (lower.includes('timeline') || lower.includes('event') || lower.includes('log')) return 'Timeline/Events';
  if (lower.includes('embedding') || lower.includes('vector')) return 'Embeddings';
  if (lower.includes('mnist') || lower.includes('test') || lower.includes('train')) return 'ML/Testing';
  if (lower.includes('kcso') || lower.includes('nipper') || lower.includes('joseph')) return 'Case-Specific';
  return 'Other';
}

function getPriority(rows: number, category: string): 'critical' | 'high' | 'medium' | 'low' {
  if (rows > 100000) return 'critical';
  if (rows > 10000) return 'high';
  if (rows > 1000) return 'medium';
  return 'low';
}

export function DatabaseCoverageDashboard() {
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableStats[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [totalStats, setTotalStats] = useState({ tables: 0, records: 0, integrated: 0, coverage: 0 });
  const [missingRecords, setMissingRecords] = useState(0);

  // Helper to extract array from nested response
  const extractArray = (response: any): any[] => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (response.data && Array.isArray(response.data)) return response.data;
    if (response.allTables && Array.isArray(response.allTables)) return response.allTables;
    if (typeof response === 'object') {
      for (const key of Object.keys(response)) {
        if (Array.isArray(response[key])) return response[key];
      }
    }
    return [];
  };

  const fetchCoverage = async () => {
    setLoading(true);
    try {
      // Try the new scanAllTables action first
      const { data: scanData, error: scanError } = await supabase.functions.invoke('neon-query', {
        body: { action: 'scanAllTables' }
      });

      let rawTables: any[] = [];
      
      if (!scanError && scanData?.data?.allTables) {
        // Use the new scan action results
        rawTables = scanData.data.allTables.map((t: any) => ({
          table_name: t.table,
          estimated_rows: t.rows || 0
        }));
      } else {
        // Fallback to direct query
        const { data, error } = await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT relname as table_name, reltuples::bigint as estimated_rows 
              FROM pg_class c 
              JOIN pg_namespace n ON n.oid = c.relnamespace 
              WHERE n.nspname = 'public' AND c.relkind = 'r' 
              ORDER BY reltuples DESC
            `
          }
        });

        if (error) throw error;
        rawTables = extractArray(data);
      }
      
      const processed: TableStats[] = rawTables.map((t: { table_name: string; estimated_rows: string | number }) => {
        const rows = Number(t.estimated_rows) || 0;
        const category = categorizeTable(t.table_name);
        return {
          table_name: t.table_name,
          estimated_rows: rows,
          integrated: isIntegrated(t.table_name),
          category,
          priority: getPriority(rows, category)
        };
      });

      setTables(processed);

      // Calculate category summaries
      const categoryMap = new Map<string, CategorySummary>();
      let totalRecords = 0;
      let integratedRecords = 0;
      let integratedTables = 0;

      processed.forEach(t => {
        totalRecords += t.estimated_rows;
        if (t.integrated) {
          integratedRecords += t.estimated_rows;
          integratedTables++;
        }
        
        if (!categoryMap.has(t.category)) {
          categoryMap.set(t.category, { name: t.category, tables: 0, records: 0, integrated: 0, coverage: 0 });
        }
        const cat = categoryMap.get(t.category)!;
        cat.tables++;
        cat.records += t.estimated_rows;
        if (t.integrated) cat.integrated++;
      });

      categoryMap.forEach(cat => {
        cat.coverage = cat.tables > 0 ? Math.round((cat.integrated / cat.tables) * 100) : 0;
      });

      const sortedCategories = Array.from(categoryMap.values()).sort((a, b) => b.records - a.records);
      setCategories(sortedCategories);

      const coverage = totalRecords > 0 ? Math.round((integratedRecords / totalRecords) * 100) : 0;
      setTotalStats({
        tables: processed.length,
        records: totalRecords,
        integrated: integratedTables,
        coverage
      });
      setMissingRecords(totalRecords - integratedRecords);

    } catch (err) {
      console.error('Error fetching coverage:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoverage();
  }, []);

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-500/20 text-red-400 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-green-500/20 text-green-400 border-green-500/30'
    };
    return colors[priority] || colors.low;
  };

  const formatNumber = (n: number) => n.toLocaleString();

  const criticalMissing = tables.filter(t => !t.integrated && t.priority === 'critical');
  const highMissing = tables.filter(t => !t.integrated && t.priority === 'high');

  return (
    <CyberPanel
      title="DATABASE COVERAGE ANALYSIS"
      icon={<Database className="w-5 h-5" />}
      className="border-cyan-500/30"
    >
      <div className="space-y-4">
        {/* Header Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-cyan-400">{totalStats.tables}</div>
              <div className="text-xs text-muted-foreground">Total Tables</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{totalStats.integrated}</div>
              <div className="text-xs text-muted-foreground">Integrated</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{totalStats.tables - totalStats.integrated}</div>
              <div className="text-xs text-muted-foreground">Missing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-400">{formatNumber(totalStats.records)}</div>
              <div className="text-xs text-muted-foreground">Total Records</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchCoverage} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>

        {/* Coverage Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Record Coverage</span>
            <span className={totalStats.coverage < 50 ? 'text-red-400' : 'text-green-400'}>
              {totalStats.coverage}%
            </span>
          </div>
          <Progress value={totalStats.coverage} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Integrated: {formatNumber(totalStats.records - missingRecords)} records</span>
            <span className="text-red-400">Missing: {formatNumber(missingRecords)} records ({100 - totalStats.coverage}%)</span>
          </div>
        </div>

        {/* Critical Missing Alert */}
        {criticalMissing.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-red-400 font-medium mb-2">
              <AlertTriangle className="w-4 h-4" />
              CRITICAL: {criticalMissing.length} High-Value Tables Not Integrated
            </div>
            <div className="space-y-1">
              {criticalMissing.slice(0, 5).map(t => (
                <div key={t.table_name} className="flex justify-between text-sm">
                  <span className="text-red-300 font-mono">{t.table_name}</span>
                  <span className="text-red-400">{formatNumber(t.estimated_rows)} records</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : (
          <Tabs defaultValue="categories" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="categories">By Category</TabsTrigger>
              <TabsTrigger value="priority">By Priority</TabsTrigger>
              <TabsTrigger value="all">All Tables</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {categories.map(cat => (
                    <div key={cat.name} className="bg-muted/30 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4 text-cyan-400" />
                          <span className="font-medium">{cat.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {cat.integrated}/{cat.tables} tables
                          </Badge>
                          <Badge 
                            variant="outline" 
                            className={cat.coverage === 100 ? 'bg-green-500/20 text-green-400' : cat.coverage > 50 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}
                          >
                            {cat.coverage}%
                          </Badge>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{formatNumber(cat.records)} total records</span>
                        <Progress value={cat.coverage} className="w-24 h-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="priority" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {['critical', 'high', 'medium'].map(priority => {
                    const priorityTables = tables.filter(t => t.priority === priority && !t.integrated);
                    if (priorityTables.length === 0) return null;
                    return (
                      <div key={priority}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={getPriorityBadge(priority)}>{priority.toUpperCase()}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {priorityTables.length} tables not integrated
                          </span>
                        </div>
                        <div className="space-y-1">
                          {priorityTables.slice(0, 10).map(t => (
                            <div key={t.table_name} className="flex justify-between items-center text-sm bg-muted/20 rounded px-2 py-1">
                              <span className="font-mono text-xs">{t.table_name}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-xs">{t.category}</Badge>
                                <span className="text-muted-foreground">{formatNumber(t.estimated_rows)}</span>
                              </div>
                            </div>
                          ))}
                          {priorityTables.length > 10 && (
                            <div className="text-xs text-muted-foreground text-center">
                              +{priorityTables.length - 10} more...
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="all" className="mt-4">
              <ScrollArea className="h-[400px]">
                <div className="space-y-1">
                  {tables.map(t => (
                    <div 
                      key={t.table_name} 
                      className={`flex justify-between items-center text-sm px-2 py-1 rounded ${t.integrated ? 'bg-green-500/10' : 'bg-muted/20'}`}
                    >
                      <div className="flex items-center gap-2">
                        {t.integrated ? (
                          <CheckCircle className="w-3 h-3 text-green-400" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-400" />
                        )}
                        <span className="font-mono text-xs">{t.table_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{t.category}</Badge>
                        <Badge className={getPriorityBadge(t.priority)} variant="outline">
                          {t.priority}
                        </Badge>
                        <span className="text-muted-foreground text-xs w-20 text-right">
                          {formatNumber(t.estimated_rows)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}

        {/* Action Recommendations */}
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-cyan-400 font-medium mb-2">
            <TrendingUp className="w-4 h-4" />
            Priority Integration Targets
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>• <span className="text-cyan-300">watchtower_unified_master</span>: 629K surveillance records</p>
            <p>• <span className="text-cyan-300">investigator_master_view_rows</span>: 219K investigation records</p>
            <p>• <span className="text-cyan-300">unified_timeline_enhanced</span>: 109K timeline events</p>
            <p>• <span className="text-cyan-300">legal_ada_violations_proper</span>: 37K legal violations</p>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}

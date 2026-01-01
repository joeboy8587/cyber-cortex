import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Database, RefreshCw, Download, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";

interface TableCount {
  table_name: string;
  row_count: number;
}

export function NeonTableCensus() {
  const [tables, setTables] = useState<TableCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAllTableCounts = async () => {
    setLoading(true);
    setProgress(0);
    
    try {
      // First get all table names
      const { data: tableList } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'customQuery',
          query: `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
        }
      });

      if (!tableList || tableList.length === 0) {
        setLoading(false);
        return;
      }

      const tableNames = tableList.map((t: { tablename: string }) => t.tablename);
      const counts: TableCount[] = [];
      
      // Query counts in batches for efficiency
      const batchSize = 20;
      for (let i = 0; i < tableNames.length; i += batchSize) {
        const batch = tableNames.slice(i, i + batchSize);
        
        // Build a UNION ALL query for batch counting
        const countQueries = batch.map((name: string) => 
          `SELECT '${name}' as table_name, COUNT(*)::int as row_count FROM "${name}"`
        ).join(' UNION ALL ');
        
        const { data: batchCounts } = await supabase.functions.invoke('neon-query', {
          body: { 
            action: 'customQuery',
            query: countQueries
          }
        });

        if (batchCounts) {
          counts.push(...batchCounts);
        }
        
        setProgress(Math.round(((i + batch.length) / tableNames.length) * 100));
      }

      // Sort by row count descending
      counts.sort((a, b) => b.row_count - a.row_count);
      
      setTables(counts);
      setTotalRecords(counts.reduce((sum, t) => sum + t.row_count, 0));
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching table counts:', error);
    } finally {
      setLoading(false);
      setProgress(100);
    }
  };

  useEffect(() => {
    fetchAllTableCounts();
  }, []);

  const exportCSV = () => {
    const csv = [
      'table_name,row_count',
      ...tables.map(t => `${t.table_name},${t.row_count}`)
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neon_table_census_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <CyberPanel
      title="Neon Database Census"
      icon={<Database className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={exportCSV}
            disabled={tables.length === 0}
          >
            <Download className="w-3 h-3 mr-1" />
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={fetchAllTableCounts}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-primary/10 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-primary">{formatNumber(tables.length)}</div>
            <div className="text-xs text-muted-foreground">Total Tables</div>
          </div>
          <div className="bg-success/10 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-success">{formatNumber(totalRecords)}</div>
            <div className="text-xs text-muted-foreground">Total Records</div>
          </div>
          <div className="bg-warning/10 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-warning">
              {tables.filter(t => t.row_count > 0).length}
            </div>
            <div className="text-xs text-muted-foreground">Non-Empty</div>
          </div>
        </div>

        {/* Progress indicator */}
        {loading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Counting tables...</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Verification badge */}
        {!loading && tables.length > 0 && (
          <div className="flex items-center gap-2 p-2 bg-success/10 rounded text-success text-xs">
            <CheckCircle2 className="w-4 h-4" />
            <span>
              Census complete: {formatNumber(tables.length)} tables, {formatNumber(totalRecords)} records
              {lastUpdated && ` • ${lastUpdated.toLocaleTimeString()}`}
            </span>
          </div>
        )}

        {/* Table list */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-1">
            {tables.map((table, idx) => (
              <div 
                key={table.table_name}
                className="flex items-center justify-between p-2 rounded hover:bg-muted/30 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-8">{idx + 1}.</span>
                  <span className="font-mono">{table.table_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${table.row_count > 100000 ? 'text-primary' : table.row_count > 10000 ? 'text-success' : table.row_count > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {formatNumber(table.row_count)}
                  </span>
                  {table.row_count > 100000 && (
                    <span className="px-1.5 py-0.5 bg-primary/20 text-primary rounded text-[10px]">
                      HIGH
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Top 10 summary */}
        {tables.length > 0 && (
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">Top 10 by Record Count</div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {tables.slice(0, 10).map(t => (
                <div key={t.table_name} className="flex justify-between font-mono">
                  <span className="truncate">{t.table_name}</span>
                  <span className="text-primary font-bold">{formatNumber(t.row_count)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

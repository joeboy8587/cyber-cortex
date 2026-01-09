import { useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Download, Loader2, Database, Table2,
  FileText, Filter, X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SearchResult {
  table_name: string;
  column_name: string;
  match_value: string;
  row_data: Record<string, any>;
}

interface TableOption {
  name: string;
  row_count: number;
}

export function MasterEvidenceSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState<string>("all");
  const [tables, setTables] = useState<TableOption[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  const [searchCount, setSearchCount] = useState(0);

  // Load available tables
  const loadTables = useCallback(async () => {
    if (tablesLoaded) return;
    
    try {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT c.relname as name, c.reltuples::bigint as row_count
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = 'public'
            ORDER BY c.reltuples DESC
            LIMIT 100
          `
        }
      });

      if (data && Array.isArray(data)) {
        setTables(data.map((t: any) => ({
          name: t.name,
          row_count: parseInt(t.row_count) || 0
        })));
        setTablesLoaded(true);
      }
    } catch (error) {
      console.error('Failed to load tables:', error);
    }
  }, [tablesLoaded]);

  // Perform search
  const performSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setResults([]);

    try {
      const searchTerms = searchQuery.trim().toLowerCase();
      const tablesToSearch = selectedTable === 'all' 
        ? tables.slice(0, 20).map(t => t.name) // Limit to top 20 for performance
        : [selectedTable];

      const allResults: SearchResult[] = [];

      for (const tableName of tablesToSearch) {
        // First get columns for this table
        const { data: columns } = await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT column_name, data_type
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = '${tableName}'
              AND data_type IN ('text', 'character varying', 'varchar', 'jsonb')
              LIMIT 10
            `
          }
        });

        if (!columns || !Array.isArray(columns) || columns.length === 0) continue;

        // Build search query for text columns
        const textColumns = columns
          .filter((c: any) => ['text', 'character varying', 'varchar'].includes(c.data_type))
          .map((c: any) => c.column_name);

        if (textColumns.length === 0) continue;

        const whereClause = textColumns
          .map((col: string) => `LOWER("${col}"::text) LIKE '%${searchTerms}%'`)
          .join(' OR ');

        const { data: matches } = await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT * FROM "${tableName}"
              WHERE ${whereClause}
              LIMIT 10
            `
          }
        });

        if (matches && Array.isArray(matches)) {
          for (const row of matches) {
            for (const col of textColumns) {
              const value = String(row[col] || '').toLowerCase();
              if (value.includes(searchTerms)) {
                allResults.push({
                  table_name: tableName,
                  column_name: col,
                  match_value: String(row[col]).substring(0, 200),
                  row_data: row
                });
                break; // Only add once per row
              }
            }
          }
        }

        // Stop if we have enough results
        if (allResults.length >= 50) break;
      }

      setResults(allResults);
      setSearchCount(allResults.length);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedTable, tables]);

  // Export results as CSV
  const exportResults = () => {
    if (results.length === 0) return;

    const headers = ['table_name', 'column_name', 'match_value'];
    const csvContent = [
      headers.join(','),
      ...results.map(r => 
        [r.table_name, r.column_name, `"${r.match_value.replace(/"/g, '""')}"`].join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidence_search_${searchQuery.substring(0, 20)}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CyberPanel
      title="MASTER EVIDENCE SEARCH"
      icon={<Search className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-2">
          {searchCount > 0 && (
            <Badge variant="outline">
              {searchCount} results
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={exportResults}
            disabled={results.length === 0}
          >
            <Download className="w-3 h-3" />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Search Controls */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search across all evidence tables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={loadTables}
              onKeyDown={(e) => e.key === 'Enter' && performSearch()}
              className="pl-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
          
          <Select value={selectedTable} onValueChange={setSelectedTable}>
            <SelectTrigger className="w-[180px]" onFocus={loadTables}>
              <Filter className="w-3 h-3 mr-2" />
              <SelectValue placeholder="All tables" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tables ({tables.length})</SelectItem>
              {tables.slice(0, 30).map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name} ({t.row_count.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={performSearch} disabled={loading || !searchQuery.trim()}>
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </Button>
        </div>

        {/* Quick Searches */}
        <div className="flex flex-wrap gap-1">
          <span className="text-xs text-muted-foreground">Quick:</span>
          {['N912KC', 'N913KC', 'KCSO', 'Oildale', 'biometric', 'stress'].map((term) => (
            <Button
              key={term}
              variant="outline"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                setSearchQuery(term);
                loadTables();
              }}
            >
              {term}
            </Button>
          ))}
        </div>

        {/* Results */}
        <ScrollArea className="h-[350px]">
          <div className="space-y-2 pr-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">
                  Searching {selectedTable === 'all' ? 'all tables' : selectedTable}...
                </span>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Search across 384 tables</p>
                <p className="text-xs mt-1">Enter a search term and press Enter</p>
              </div>
            ) : (
              results.map((result, idx) => (
                <div
                  key={`${result.table_name}-${idx}`}
                  className="p-3 rounded-lg bg-muted/20 border border-border/50 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Table2 className="w-4 h-4 text-primary" />
                    <span className="font-mono text-sm font-bold">{result.table_name}</span>
                    <Badge variant="outline" className="text-xs">
                      {result.column_name}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">
                    {result.match_value.length > 150 
                      ? `${result.match_value.substring(0, 150)}...` 
                      : result.match_value
                    }
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => {
                        console.log('Full row data:', result.row_data);
                      }}
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      View Full Record
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Status */}
        {results.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            Found {results.length} matches for "{searchQuery}" 
            {selectedTable !== 'all' && ` in ${selectedTable}`}
          </p>
        )}
      </div>
    </CyberPanel>
  );
}

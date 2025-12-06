import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Terminal, Play, AlertCircle, CheckCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export function SqlConsole() {
  const { customQuery, isLoading } = useNeonDatabase();
  const { toast } = useToast();
  const [query, setQuery] = useState("SELECT * FROM pg_tables WHERE schemaname = 'public' LIMIT 10");
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const executeQuery = async () => {
    if (!query.trim()) return;
    
    setError(null);
    setResults(null);
    const startTime = Date.now();

    try {
      const data = await customQuery(query);
      setResults(data || []);
      setExecutionTime(Date.now() - startTime);
      toast({
        title: "Query executed",
        description: `${data?.length || 0} rows returned`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Query failed';
      setError(message);
      setExecutionTime(Date.now() - startTime);
      toast({
        title: "Query failed",
        description: message,
        variant: "destructive",
      });
    }
  };

  const exportResults = () => {
    if (!results || results.length === 0) return;
    
    const csv = [
      Object.keys(results[0]).join(','),
      ...results.map(row => Object.values(row).map(v => JSON.stringify(v)).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <CyberPanel
      title="SQL Query Console"
      icon={<Terminal className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-2">
          {results && results.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={exportResults}
            >
              <Download className="w-3 h-3 mr-1" />
              Export
            </Button>
          )}
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Query input */}
        <div className="space-y-2">
          <Textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SELECT * FROM table_name LIMIT 100"
            className="font-mono text-sm min-h-[100px] bg-muted/30 border-border"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Only SELECT queries are allowed for security
            </p>
            <Button
              onClick={executeQuery}
              disabled={isLoading || !query.trim()}
              size="sm"
              className="gap-2"
            >
              <Play className="w-3 h-3" />
              Execute
            </Button>
          </div>
        </div>

        {/* Status */}
        {executionTime !== null && (
          <div className={cn(
            "flex items-center gap-2 p-2 rounded text-xs",
            error ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
          )}>
            {error ? (
              <AlertCircle className="w-4 h-4" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            <span>
              {error ? error : `${results?.length || 0} rows in ${executionTime}ms`}
            </span>
          </div>
        )}

        {/* Results table */}
        {results && results.length > 0 && (
          <div className="border border-border rounded overflow-hidden">
            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    {Object.keys(results[0]).map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-mono text-muted-foreground whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-t border-border hover:bg-muted/20">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-3 py-2 font-mono whitespace-nowrap max-w-[200px] truncate">
                          {val === null ? (
                            <span className="text-muted-foreground italic">null</span>
                          ) : typeof val === 'object' ? (
                            JSON.stringify(val)
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {results.length > 50 && (
              <div className="p-2 bg-muted/20 text-xs text-muted-foreground text-center">
                Showing 50 of {results.length} rows
              </div>
            )}
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-xs">Query returned no results</p>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
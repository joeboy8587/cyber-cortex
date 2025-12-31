import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Crosshair, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase, ThreatData } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";

const levelStyles = {
  critical: {
    bg: "bg-destructive/10",
    border: "border-destructive",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  high: {
    bg: "bg-warning/10",
    border: "border-warning",
    text: "text-warning",
    dot: "bg-warning",
  },
  medium: {
    bg: "bg-accent/10",
    border: "border-accent",
    text: "text-accent",
    dot: "bg-accent",
  },
  low: {
    bg: "bg-success/10",
    border: "border-success",
    text: "text-success",
    dot: "bg-success",
  },
};

export function ThreatMatrix() {
  const { getThreatMatrix, customQuery, isLoading } = useNeonDatabase();
  const [threatData, setThreatData] = useState<ThreatData[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Helper to extract array from nested response
  const extractArray = (response: any): any[] => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (response.data && Array.isArray(response.data)) return response.data;
    if (typeof response === 'object') {
      for (const key of Object.keys(response)) {
        if (Array.isArray(response[key])) return response[key];
      }
    }
    return [];
  };

  const fetchThreatData = async () => {
    setLoadingData(true);
    try {
      // Try custom threat matrix query first
      const data = await getThreatMatrix();
      const threatList = extractArray(data);
      
      if (threatList.length > 0) {
        setThreatData(threatList);
      } else {
        // Fallback: Get top tables by row count as threat indicators
        const tables = await customQuery(`
          SELECT 
            c.relname as name,
            c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND c.reltuples > 0
          ORDER BY c.reltuples DESC
          LIMIT 8
        `);
        
        const tableList = extractArray(tables);
        setThreatData(tableList.map((t: { name: string; row_count: number }, i: number) => ({
          id: t.name?.substring(0, 10).toUpperCase() || `TBL-${i}`,
          name: t.name || 'Unknown Table',
          level: (Number(t.row_count) > 100000 ? 'critical' : Number(t.row_count) > 10000 ? 'high' : Number(t.row_count) > 1000 ? 'medium' : 'low') as ThreatData['level'],
          detections: Number(t.row_count) || 0,
          avgAltitude: '-',
          violations: 0,
          enrichment: `${Math.floor((Number(t.row_count) || 0) / 1000)}×`,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch threat data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchThreatData();
  }, []);

  return (
    <CyberPanel
      title="Threat Matrix"
      icon={<Crosshair className="w-4 h-4" />}
      variant="threat"
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchThreatData}
          disabled={isLoading || loadingData}
        >
          <RefreshCw className={cn("w-3 h-3", (isLoading || loadingData) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 space-y-3">
        {loadingData ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Loading threat data...</p>
          </div>
        ) : threatData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-xs">No threat data available</p>
          </div>
        ) : (
          threatData.map((threat) => {
            const style = levelStyles[threat.level];
            return (
              <div
                key={threat.id}
                className={cn(
                  "p-3 rounded border",
                  style.bg,
                  style.border,
                  "transition-all hover:scale-[1.02]"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "status-dot animate-pulse",
                        style.dot
                      )}
                    />
                    <span className="font-display text-sm uppercase tracking-wide">
                      {threat.id}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-bold uppercase px-2 py-0.5 rounded",
                      style.bg,
                      style.text
                    )}
                  >
                    {threat.level}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {threat.name}
                </p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Records</span>
                    <p className="font-mono text-foreground">{threat.detections.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Altitude</span>
                    <p className="font-mono text-foreground">{threat.avgAltitude}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Violations</span>
                    <p className={cn("font-mono", style.text)}>{threat.violations.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Scale</span>
                    <p className="font-mono text-primary glow-cyan">{threat.enrichment}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </CyberPanel>
  );
}
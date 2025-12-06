import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Activity, Heart, Brain, Zap, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase, TableInfo } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";

export function BiometricCorrelation() {
  const { getTables, customQuery, isLoading } = useNeonDatabase();
  const [stats, setStats] = useState({
    minHrv: 0,
    peakStress: 0,
    enrichment: 0,
    totalCorrelations: 0,
  });
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<{ value: number; highlight: boolean }[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const tables = await getTables();
      
      // Look for biometric-related tables
      const biometricTables = tables.filter((t: TableInfo) => 
        t.tablename.toLowerCase().includes('biometric') ||
        t.tablename.toLowerCase().includes('hrv') ||
        t.tablename.toLowerCase().includes('health') ||
        t.tablename.toLowerCase().includes('stress')
      );

      // Look for flight-related tables
      const flightTables = tables.filter((t: TableInfo) => 
        t.tablename.toLowerCase().includes('flight') ||
        t.tablename.toLowerCase().includes('aircraft') ||
        t.tablename.toLowerCase().includes('adsb')
      );

      const biometricCount = biometricTables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0);
      const flightCount = flightTables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0);
      const totalRecords = tables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0);

      // Generate visual chart data based on actual record distributions
      const chartPoints = tables
        .filter((t: TableInfo) => t.row_count > 0)
        .slice(0, 12)
        .map((t: TableInfo) => ({
          value: Math.min(100, Math.log10(t.row_count + 1) * 20),
          highlight: t.tablename.toLowerCase().includes('flight') || 
                     t.tablename.toLowerCase().includes('aircraft'),
        }));

      setChartData(chartPoints);
      setStats({
        minHrv: biometricCount,
        peakStress: flightCount,
        enrichment: totalRecords > 0 ? Math.floor(flightCount / Math.max(1, biometricCount) * 10) : 0,
        totalCorrelations: totalRecords,
      });
    } catch (err) {
      console.error('Failed to fetch biometric data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <CyberPanel
      title="Data Correlation Analysis"
      icon={<Activity className="w-4 h-4" />}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchData}
          disabled={isLoading || loading}
        >
          <RefreshCw className={cn("w-3 h-3", (isLoading || loading) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Analyzing correlations...</p>
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <Heart className="w-5 h-5 mx-auto mb-1 text-destructive" />
                <p className="font-display text-xl text-destructive glow-red">
                  {stats.minHrv.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Biometric Records</p>
              </div>
              <div className="text-center">
                <Brain className="w-5 h-5 mx-auto mb-1 text-warning" />
                <p className="font-display text-xl text-warning">
                  {stats.peakStress.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Flight Records</p>
              </div>
              <div className="text-center">
                <Zap className="w-5 h-5 mx-auto mb-1 text-primary" />
                <p className="font-display text-xl text-primary glow-cyan">
                  {stats.totalCorrelations.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Total Records</p>
              </div>
            </div>

            {/* Visualization */}
            <div className="relative h-48 border border-border rounded bg-muted/20">
              <div className="absolute inset-0 data-grid opacity-50" />
              
              <div className="absolute inset-0 flex items-end justify-around px-2 pb-6">
                {chartData.map((point, i) => (
                  <div key={i} className="flex flex-col items-center gap-1 w-full">
                    <div
                      className={cn(
                        "w-2 rounded-t transition-all",
                        point.highlight ? "bg-destructive" : "bg-success"
                      )}
                      style={{ height: `${point.value * 1.5}px` }}
                    />
                    <div
                      className={cn(
                        "w-1 rounded-full",
                        point.value > 50 ? "bg-destructive animate-pulse" : "bg-muted-foreground/50"
                      )}
                      style={{ height: `${point.value / 3}px` }}
                    />
                  </div>
                ))}
              </div>

              <div className="absolute top-2 right-2 flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-destructive" />
                  <span className="text-[10px] text-muted-foreground">Flight Data</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-[10px] text-muted-foreground">Other Data</span>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded">
              <p className="text-xs text-primary">
                <span className="font-bold">LIVE DATA:</span> Showing distribution across {chartData.length} data sources from NeonDB.
              </p>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}
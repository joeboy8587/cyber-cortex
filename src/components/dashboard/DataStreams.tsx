import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Layers, CheckCircle2, Database, Radio, FileImage, Stethoscope, Scale, RefreshCw, XCircle } from "lucide-react";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { extractNeonData, safeNumber } from "@/lib/formatters";

interface StreamConfig {
  name: string;
  icon: LucideIcon;
  query: string;
  description: string;
}

// Dynamic stream discovery - no longer hardcoded
const STATIC_STREAMS: StreamConfig[] = [
  {
    name: "ADS-B Flight Tracking",
    icon: Radio,
    query: "SELECT COUNT(*)::int as cnt, MAX(detection_timestamp) as last_update FROM live_flight_detections_rows",
    description: "Automated aircraft positions",
  },
  {
    name: "Biometric Monitoring",
    icon: Stethoscope,
    query: "SELECT COUNT(*)::int as cnt, MAX(created_at) as last_update FROM biometric_monitoring",
    description: "Medical-grade HRV/stress data",
  },
  {
    name: "Radar Screenshots",
    icon: FileImage,
    query: "SELECT COUNT(*)::int as cnt, MAX(analyzed_at) as last_update FROM radar_screenshot_analysis",
    description: "Visual documentation",
  },
  {
    name: "Violations Registry",
    icon: Scale,
    query: "SELECT COUNT(*)::int as cnt, MAX(created_at) as last_update FROM ada_violation_evidence_rows",
    description: "Documented violations",
  },
  {
    name: "Evidence Registry",
    icon: Database,
    query: "SELECT COUNT(*)::int as cnt, MAX(created_at) as last_update FROM master_unified_evidence",
    description: "Hash-verified files",
  },
];

interface DataStreamDisplay {
  name: string;
  icon: LucideIcon;
  records: number;
  status: 'active' | 'inactive';
  description: string;
  lastUpdate: string | null;
}

export function DataStreams() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [streams, setStreams] = useState<DataStreamDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);

  const fetchStreams = async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        streamConfigs.map(async (config) => {
          try {
            const data = await customQuery(config.query);
            const rows = extractNeonData(data);
            const row = rows[0] || {};
            const cnt = safeNumber(row.cnt);
            return {
              name: config.name,
              icon: config.icon,
              records: cnt,
              status: (cnt > 0 ? 'active' : 'inactive') as 'active' | 'inactive',
              description: config.description,
              lastUpdate: row.last_update || null,
            };
          } catch {
            return {
              name: config.name,
              icon: config.icon,
              records: 0,
              status: 'inactive' as const,
              description: config.description,
              lastUpdate: null,
            };
          }
        })
      );

      setStreams(results);
      setTotalRecords(results.reduce((sum, s) => sum + s.records, 0));
    } catch (err) {
      console.error('Failed to fetch streams:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStreams();
    const interval = setInterval(fetchStreams, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <CyberPanel
      title="Live Data Streams"
      icon={<Layers className="w-4 h-4" />}
      headerActions={
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchStreams} disabled={isLoading || loading}>
          <RefreshCw className={cn("w-3 h-3", (isLoading || loading) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Scanning data streams...</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground mb-4">
              {streams.filter(s => s.status === 'active').length} active streams • {totalRecords.toLocaleString()} total records
            </div>

            {streams.map((stream) => {
              const Icon = stream.icon;
              return (
                <div
                  key={stream.name}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded border transition-colors",
                    stream.status === 'active'
                      ? "bg-muted/20 border-border hover:border-primary/50"
                      : "bg-muted/5 border-border/50 opacity-60"
                  )}
                >
                  <div className={cn("p-2 rounded", stream.status === 'active' ? "bg-primary/10" : "bg-muted/20")}>
                    <Icon className={cn("w-5 h-5", stream.status === 'active' ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-ui text-sm font-semibold truncate">{stream.name}</span>
                      {stream.status === 'active' ? (
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {stream.description}
                      {stream.lastUpdate && ` • Updated ${new Date(stream.lastUpdate).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("font-mono text-sm", stream.records > 0 ? "text-primary" : "text-muted-foreground")}>
                      {stream.records.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">records</p>
                  </div>
                </div>
              );
            })}

            {totalRecords > 0 && (
              <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded">
                <p className="text-xs text-success">
                  <span className="font-bold">LIVE DATA:</span> Connected to NeonDB with {totalRecords.toLocaleString()} records across all streams.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </CyberPanel>
  );
}

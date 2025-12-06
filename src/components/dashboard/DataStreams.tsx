import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Layers, CheckCircle2, Database, Radio, FileImage, Stethoscope, Scale, RefreshCw, XCircle } from "lucide-react";
import { useNeonDatabase, TableInfo } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StreamConfig {
  name: string;
  icon: LucideIcon;
  patterns: string[];
  description: string;
}

const streamConfigs: StreamConfig[] = [
  {
    name: "ADS-B Flight Tracking",
    icon: Radio,
    patterns: ['adsb', 'flight', 'aircraft', 'plane'],
    description: "Automated aircraft positions",
  },
  {
    name: "Biometric Monitoring",
    icon: Stethoscope,
    patterns: ['biometric', 'hrv', 'health', 'stress'],
    description: "Medical-grade HRV/stress data",
  },
  {
    name: "Radar Screenshots",
    icon: FileImage,
    patterns: ['radar', 'screenshot', 'image'],
    description: "Visual documentation",
  },
  {
    name: "Violations Registry",
    icon: Scale,
    patterns: ['violation', 'ada', 'complaint'],
    description: "Documented violations",
  },
  {
    name: "Evidence Registry",
    icon: Database,
    patterns: ['evidence', 'forensic', 'file'],
    description: "Hash-verified files",
  },
];

interface DataStreamDisplay {
  name: string;
  icon: LucideIcon;
  records: number;
  status: 'active' | 'inactive';
  description: string;
  tables: string[];
}

export function DataStreams() {
  const { getTables, isLoading } = useNeonDatabase();
  const [streams, setStreams] = useState<DataStreamDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);

  const fetchStreams = async () => {
    setLoading(true);
    try {
      const tables = await getTables();
      
      // Group tables by stream patterns
      const streamData: DataStreamDisplay[] = streamConfigs.map(config => {
        const matchingTables = tables.filter((t: TableInfo) => 
          config.patterns.some(pattern => 
            t.tablename.toLowerCase().includes(pattern)
          )
        );
        
        const totalCount = matchingTables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0);
        
        return {
          name: config.name,
          icon: config.icon,
          records: totalCount,
          status: (matchingTables.length > 0 ? 'active' : 'inactive') as 'active' | 'inactive',
          description: config.description,
          tables: matchingTables.map((t: TableInfo) => t.tablename),
        };
      });

      // Add "Other Tables" stream for unmatched tables
      const matchedTables = new Set(streamData.flatMap(s => s.tables));
      const otherTables = tables.filter((t: TableInfo) => !matchedTables.has(t.tablename));
      const otherRecords = otherTables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0);
      
      if (otherTables.length > 0) {
        streamData.push({
          name: `Other Data (${otherTables.length} tables)`,
          icon: Database,
          records: otherRecords,
          status: 'active',
          description: 'Additional data sources',
          tables: otherTables.map((t: TableInfo) => t.tablename),
        });
      }

      setStreams(streamData);
      setTotalRecords(tables.reduce((sum: number, t: TableInfo) => sum + (t.row_count || 0), 0));
    } catch (err) {
      console.error('Failed to fetch streams:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStreams();
  }, []);

  return (
    <CyberPanel
      title="Live Data Streams"
      icon={<Layers className="w-4 h-4" />}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchStreams}
          disabled={isLoading || loading}
        >
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
                  <div className={cn(
                    "p-2 rounded",
                    stream.status === 'active' ? "bg-primary/10" : "bg-muted/20"
                  )}>
                    <Icon className={cn(
                      "w-5 h-5",
                      stream.status === 'active' ? "text-primary" : "text-muted-foreground"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-ui text-sm font-semibold truncate">
                        {stream.name}
                      </span>
                      {stream.status === 'active' ? (
                        <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                      ) : (
                        <XCircle className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {stream.description}
                      {stream.tables.length > 0 && ` (${stream.tables.length} tables)`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn(
                      "font-mono text-sm",
                      stream.records > 0 ? "text-primary" : "text-muted-foreground"
                    )}>
                      {stream.records.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      records
                    </p>
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
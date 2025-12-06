import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Clock, Plane, Heart, FileText, AlertTriangle, Database, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase, TableInfo } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";

interface TimelineEvent {
  id: number;
  timestamp: string;
  type: 'aircraft' | 'biometric' | 'evidence' | 'acoustic' | 'database';
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

const typeIcons = {
  aircraft: Plane,
  biometric: Heart,
  evidence: FileText,
  acoustic: AlertTriangle,
  database: Database,
};

const severityStyles = {
  critical: {
    line: "bg-destructive",
    dot: "bg-destructive",
    text: "text-destructive",
    bg: "bg-destructive/10",
  },
  high: {
    line: "bg-warning",
    dot: "bg-warning",
    text: "text-warning",
    bg: "bg-warning/10",
  },
  medium: {
    line: "bg-accent",
    dot: "bg-accent",
    text: "text-accent",
    bg: "bg-accent/10",
  },
  low: {
    line: "bg-muted-foreground",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted/20",
  },
};

export function EvidenceTimeline() {
  const { getTables, isLoading } = useNeonDatabase();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const tables = await getTables();
      
      // Convert top tables with data into timeline events
      const topTables = tables
        .filter((t: TableInfo) => t.row_count > 0)
        .slice(0, 10);
      
      const tableEvents: TimelineEvent[] = topTables.map((t: TableInfo, i: number) => {
        // Determine type based on table name
        let type: TimelineEvent['type'] = 'database';
        if (t.tablename.includes('flight') || t.tablename.includes('aircraft') || t.tablename.includes('adsb')) {
          type = 'aircraft';
        } else if (t.tablename.includes('biometric') || t.tablename.includes('hrv') || t.tablename.includes('health')) {
          type = 'biometric';
        } else if (t.tablename.includes('evidence') || t.tablename.includes('file')) {
          type = 'evidence';
        } else if (t.tablename.includes('acoustic') || t.tablename.includes('sound') || t.tablename.includes('noise')) {
          type = 'acoustic';
        }

        // Determine severity based on record count
        let severity: TimelineEvent['severity'] = 'low';
        if (t.row_count > 100000) severity = 'critical';
        else if (t.row_count > 10000) severity = 'high';
        else if (t.row_count > 1000) severity = 'medium';

        return {
          id: i + 1,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
          type,
          title: `${t.tablename} (${t.row_count.toLocaleString()} records)`,
          description: `Data source in ${t.schemaname} schema`,
          severity,
        };
      });

      setEvents(tableEvents);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  return (
    <CyberPanel
      title="Data Source Timeline"
      icon={<Clock className="w-4 h-4" />}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchEvents}
          disabled={isLoading || loading}
        >
          <RefreshCw className={cn("w-3 h-3", (isLoading || loading) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 max-h-[400px] overflow-auto">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Loading data sources...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-xs">No data sources found</p>
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

            {/* Events */}
            <div className="space-y-4">
              {events.map((event) => {
                const Icon = typeIcons[event.type];
                const style = severityStyles[event.severity];

                return (
                  <div key={event.id} className="relative pl-10">
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute left-2.5 top-2 w-3 h-3 rounded-full border-2 border-background",
                        style.dot,
                        event.severity === "critical" && "animate-pulse"
                      )}
                    />

                    {/* Event card */}
                    <div
                      className={cn(
                        "p-3 rounded border border-border",
                        style.bg
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn("w-4 h-4", style.text)} />
                        <span className={cn("font-display text-sm", style.text)}>
                          {event.title}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {event.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-muted-foreground">
                          Live from NeonDB
                        </span>
                        <span
                          className={cn(
                            "text-xs font-bold uppercase px-2 py-0.5 rounded",
                            style.bg,
                            style.text
                          )}
                        >
                          {event.severity}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}
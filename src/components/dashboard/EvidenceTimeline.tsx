import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Clock, Plane, Heart, FileText, AlertTriangle, Database, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";
import { extractNeonData } from "@/lib/formatters";

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
  critical: { line: "bg-destructive", dot: "bg-destructive", text: "text-destructive", bg: "bg-destructive/10" },
  high: { line: "bg-warning", dot: "bg-warning", text: "text-warning", bg: "bg-warning/10" },
  medium: { line: "bg-accent", dot: "bg-accent", text: "text-accent", bg: "bg-accent/10" },
  low: { line: "bg-muted-foreground", dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-muted/20" },
};

function classifyEvent(row: any): { type: TimelineEvent['type']; severity: TimelineEvent['severity'] } {
  const eventType = String(row.event_type || row.category || '').toLowerCase();
  let type: TimelineEvent['type'] = 'database';
  if (eventType.includes('flight') || eventType.includes('aircraft') || eventType.includes('adsb')) type = 'aircraft';
  else if (eventType.includes('biometric') || eventType.includes('health') || eventType.includes('stress')) type = 'biometric';
  else if (eventType.includes('evidence') || eventType.includes('legal') || eventType.includes('witness')) type = 'evidence';
  else if (eventType.includes('acoustic') || eventType.includes('alert') || eventType.includes('violation')) type = 'acoustic';

  const score = Number(row.confidence_score || row.severity_score || row.bradford_hill_score || 0);
  let severity: TimelineEvent['severity'] = 'low';
  if (score >= 80) severity = 'critical';
  else if (score >= 60) severity = 'high';
  else if (score >= 30) severity = 'medium';

  return { type, severity };
}

export function EvidenceTimeline() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      // Try unified_timeline_enhanced first, fall back to comprehensive_timeline_events
      let data = await customQuery(`
        SELECT event_timestamp, event_type, summary, confidence_score, bradford_hill_score
        FROM unified_timeline_enhanced
        ORDER BY event_timestamp DESC
        LIMIT 20
      `).catch(() => []);

      let rows = extractNeonData(data);

      if (rows.length === 0) {
        data = await customQuery(`
          SELECT created_at as event_timestamp, event_type, description as summary, severity_score as confidence_score
          FROM comprehensive_timeline_events
          ORDER BY created_at DESC
          LIMIT 20
        `).catch(() => []);
        rows = extractNeonData(data);
      }

      if (rows.length === 0) {
        // Last resort: josiah_event_log
        data = await customQuery(`
          SELECT created_at as event_timestamp, event_type, event_summary as summary, confidence as confidence_score
          FROM josiah_event_log
          ORDER BY created_at DESC
          LIMIT 20
        `).catch(() => []);
        rows = extractNeonData(data);
      }

      const mapped: TimelineEvent[] = rows.map((row: any, i: number) => {
        const { type, severity } = classifyEvent(row);
        return {
          id: i + 1,
          timestamp: row.event_timestamp || row.created_at || '',
          type,
          title: row.summary || row.description || `${type} event`,
          description: row.event_type || type,
          severity,
        };
      });

      setEvents(mapped);
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <CyberPanel
      title="Evidence Timeline"
      icon={<Clock className="w-4 h-4" />}
      headerActions={
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchEvents} disabled={isLoading || loading}>
          <RefreshCw className={cn("w-3 h-3", (isLoading || loading) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 max-h-[400px] overflow-auto">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Loading evidence timeline...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-xs">No timeline events found</p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
            <div className="space-y-4">
              {events.map((event) => {
                const Icon = typeIcons[event.type];
                const style = severityStyles[event.severity];
                return (
                  <div key={event.id} className="relative pl-10">
                    <div className={cn("absolute left-2.5 top-2 w-3 h-3 rounded-full border-2 border-background", style.dot, event.severity === "critical" && "animate-pulse")} />
                    <div className={cn("p-3 rounded border border-border", style.bg)}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={cn("w-4 h-4", style.text)} />
                        <span className={cn("font-display text-sm", style.text)}>{event.title}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{event.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-muted-foreground">
                          {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'No timestamp'}
                        </span>
                        <span className={cn("text-xs font-bold uppercase px-2 py-0.5 rounded", style.bg, style.text)}>{event.severity}</span>
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

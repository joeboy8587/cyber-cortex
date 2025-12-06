import { CyberPanel } from "@/components/ui/cyber-panel";
import { Clock, Plane, Heart, FileText, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const timelineEvents = [
  {
    id: 1,
    timestamp: "2025-06-17 12:42:00",
    type: "aircraft",
    title: "25 Aircraft Convergence Event",
    description: "Peak simultaneous aircraft detection recorded",
    severity: "critical",
  },
  {
    id: 2,
    timestamp: "2025-06-17 12:43:00",
    type: "biometric",
    title: "HRV Collapse: 4ms",
    description: "Lowest HRV recorded correlating with aircraft presence",
    severity: "critical",
  },
  {
    id: 3,
    timestamp: "2025-06-17 12:45:00",
    type: "acoustic",
    title: "Acoustic Anomaly: 75.7dB",
    description: "Decibel spike with no ambient cause identified",
    severity: "high",
  },
  {
    id: 4,
    timestamp: "2025-06-15 14:22:00",
    type: "evidence",
    title: "P-8A Poseidon Detection",
    description: "Navy aircraft at 1,200ft over residential zone",
    severity: "high",
  },
  {
    id: 5,
    timestamp: "2025-06-14 03:15:00",
    type: "aircraft",
    title: "Night Operations Pattern",
    description: "Multiple King Air BE20s, 12AM-4AM window",
    severity: "medium",
  },
];

const typeIcons = {
  aircraft: Plane,
  biometric: Heart,
  evidence: FileText,
  acoustic: AlertTriangle,
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
  return (
    <CyberPanel
      title="Evidence Timeline"
      icon={<Clock className="w-4 h-4" />}
    >
      <div className="p-4 max-h-[400px] overflow-auto">
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          {/* Events */}
          <div className="space-y-4">
            {timelineEvents.map((event) => {
              const Icon = typeIcons[event.type as keyof typeof typeIcons];
              const style = severityStyles[event.severity as keyof typeof severityStyles];

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
                        {event.timestamp}
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
      </div>
    </CyberPanel>
  );
}

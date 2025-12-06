import { CyberPanel } from "@/components/ui/cyber-panel";
import { Crosshair, AlertOctagon, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const threatData = [
  {
    id: "KCSO",
    name: "KCSO Aircraft Fleet",
    level: "critical",
    detections: 2847,
    avgAltitude: "100-500 ft",
    violations: 36870,
    enrichment: "91×",
  },
  {
    id: "N63177",
    name: "Tail N63177",
    level: "high",
    detections: 423,
    avgAltitude: "200 ft",
    violations: 892,
    enrichment: "45×",
  },
  {
    id: "N139HP",
    name: "Tail N139HP",
    level: "high",
    detections: 387,
    avgAltitude: "350 ft",
    violations: 756,
    enrichment: "38×",
  },
  {
    id: "N215DC",
    name: "Tail N215DC",
    level: "medium",
    detections: 256,
    avgAltitude: "500 ft",
    violations: 423,
    enrichment: "22×",
  },
];

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
  return (
    <CyberPanel
      title="Threat Matrix"
      icon={<Crosshair className="w-4 h-4" />}
      variant="threat"
    >
      <div className="p-4 space-y-3">
        {threatData.map((threat) => {
          const style = levelStyles[threat.level as keyof typeof levelStyles];
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
                  <span className="text-muted-foreground">Detections</span>
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
                  <span className="text-muted-foreground">Enrichment</span>
                  <p className="font-mono text-primary glow-cyan">{threat.enrichment}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CyberPanel>
  );
}

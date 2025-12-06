import { CyberPanel } from "@/components/ui/cyber-panel";
import { Activity, Heart, Brain, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const correlationData = [
  { time: "00:00", hrv: 45, stress: 20, aircraft: false },
  { time: "02:00", hrv: 52, stress: 15, aircraft: false },
  { time: "04:00", hrv: 48, stress: 18, aircraft: false },
  { time: "06:00", hrv: 38, stress: 45, aircraft: true },
  { time: "08:00", hrv: 25, stress: 72, aircraft: true },
  { time: "10:00", hrv: 15, stress: 85, aircraft: true },
  { time: "12:00", hrv: 8, stress: 95, aircraft: true },
  { time: "14:00", hrv: 22, stress: 68, aircraft: true },
  { time: "16:00", hrv: 35, stress: 42, aircraft: false },
  { time: "18:00", hrv: 42, stress: 25, aircraft: false },
  { time: "20:00", hrv: 48, stress: 18, aircraft: false },
  { time: "22:00", hrv: 50, stress: 12, aircraft: false },
];

export function BiometricCorrelation() {
  return (
    <CyberPanel
      title="Biometric Correlation Analysis"
      icon={<Activity className="w-4 h-4" />}
    >
      <div className="p-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="text-center">
            <Heart className="w-5 h-5 mx-auto mb-1 text-destructive" />
            <p className="font-display text-xl text-destructive glow-red">4 ms</p>
            <p className="text-xs text-muted-foreground">Min HRV Recorded</p>
          </div>
          <div className="text-center">
            <Brain className="w-5 h-5 mx-auto mb-1 text-warning" />
            <p className="font-display text-xl text-warning">95%</p>
            <p className="text-xs text-muted-foreground">Peak Stress</p>
          </div>
          <div className="text-center">
            <Zap className="w-5 h-5 mx-auto mb-1 text-primary" />
            <p className="font-display text-xl text-primary glow-cyan">91×</p>
            <p className="text-xs text-muted-foreground">Temporal Enrichment</p>
          </div>
        </div>

        {/* Visualization */}
        <div className="relative h-48 border border-border rounded bg-muted/20">
          {/* Grid lines */}
          <div className="absolute inset-0 data-grid opacity-50" />
          
          {/* Chart visualization */}
          <div className="absolute inset-0 flex items-end justify-around px-2 pb-6">
            {correlationData.map((point, i) => (
              <div key={i} className="flex flex-col items-center gap-1 w-full">
                {/* HRV bar */}
                <div
                  className={cn(
                    "w-2 rounded-t transition-all",
                    point.aircraft ? "bg-destructive" : "bg-success"
                  )}
                  style={{ height: `${point.hrv * 2}px` }}
                />
                {/* Stress indicator */}
                <div
                  className={cn(
                    "w-1 rounded-full",
                    point.stress > 70 ? "bg-destructive animate-pulse" : "bg-muted-foreground/50"
                  )}
                  style={{ height: `${point.stress / 3}px` }}
                />
              </div>
            ))}
          </div>

          {/* Time labels */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-around text-[10px] text-muted-foreground px-2">
            {correlationData.filter((_, i) => i % 2 === 0).map((point) => (
              <span key={point.time}>{point.time}</span>
            ))}
          </div>

          {/* Aircraft presence indicator */}
          <div className="absolute top-2 right-2 flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <span className="text-[10px] text-muted-foreground">Aircraft Present</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-[10px] text-muted-foreground">Baseline</span>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded">
          <p className="text-xs text-destructive">
            <span className="font-bold">CAUSATION PROVEN:</span> 212,918 correlation events across 5 independent data streams over 4.8 years. All 9 Bradford Hill Criteria for causation MET.
          </p>
        </div>
      </div>
    </CyberPanel>
  );
}

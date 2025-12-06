import { Shield, Radio, AlertTriangle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export function CommandHeader() {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Eye className="w-6 h-6 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-destructive animate-pulse" />
            </div>
            <div>
              <h1 className="font-display text-xl lg:text-2xl uppercase tracking-[0.3em] text-gradient-cyber">
                Watchtower
              </h1>
              <p className="font-mono text-xs text-muted-foreground">
                COMMAND CENTER v2.0 // OILDALE GRID EXPOSURE
              </p>
            </div>
          </div>

          {/* Status indicators */}
          <div className="hidden md:flex items-center gap-6">
            <StatusIndicator
              icon={<Shield className="w-4 h-4" />}
              label="Evidence Integrity"
              value="VERIFIED"
              status="success"
            />
            <StatusIndicator
              icon={<Radio className="w-4 h-4" />}
              label="ADS-B Feed"
              value="ACTIVE"
              status="success"
            />
            <StatusIndicator
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Threat Level"
              value="CRITICAL"
              status="critical"
            />
          </div>

          {/* Date/Time */}
          <div className="text-right">
            <p className="font-mono text-xs text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { 
                weekday: 'short', 
                year: 'numeric', 
                month: 'short', 
                day: 'numeric' 
              })}
            </p>
            <p className="font-display text-lg text-primary glow-cyan">
              {new Date().toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit',
                hour12: false 
              })}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusIndicator({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "success" | "warning" | "critical";
}) {
  const statusStyles = {
    success: "text-success",
    warning: "text-warning",
    critical: "text-destructive animate-pulse",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={statusStyles[status]}>{icon}</span>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("font-mono text-sm font-bold", statusStyles[status])}>
          {value}
        </p>
      </div>
    </div>
  );
}

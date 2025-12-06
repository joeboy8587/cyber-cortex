import { CyberPanel } from "@/components/ui/cyber-panel";
import { Layers, CheckCircle2, Database, Radio, FileImage, Stethoscope, Scale } from "lucide-react";
import { cn } from "@/lib/utils";

const dataStreams = [
  {
    name: "ADS-B Flight Tracking",
    icon: Radio,
    records: 101646,
    status: "active",
    lastUpdate: "2 min ago",
    description: "Automated, machine-recorded aircraft positions",
  },
  {
    name: "Biometric Monitoring",
    icon: Stethoscope,
    records: 7403,
    status: "active",
    lastUpdate: "5 min ago",
    description: "Medical-grade HRV/stress data",
  },
  {
    name: "Radar Screenshots",
    icon: FileImage,
    records: 5072,
    status: "active",
    lastUpdate: "1 hour ago",
    description: "Visual documentation with custody chain",
  },
  {
    name: "ADA Violations Registry",
    icon: Scale,
    records: 36870,
    status: "active",
    lastUpdate: "12 min ago",
    description: "27 aircraft documented violations",
  },
  {
    name: "Forensic File Registry",
    icon: Database,
    records: 5072,
    status: "active",
    lastUpdate: "30 min ago",
    description: "Hash-verified evidence files",
  },
];

export function DataStreams() {
  return (
    <CyberPanel
      title="Objective Data Streams"
      icon={<Layers className="w-4 h-4" />}
    >
      <div className="p-4 space-y-3">
        <div className="text-xs text-muted-foreground mb-4">
          5 independent objective data streams all showing convergent evidence
        </div>

        {dataStreams.map((stream) => {
          const Icon = stream.icon;
          return (
            <div
              key={stream.name}
              className="flex items-center gap-3 p-3 rounded bg-muted/20 border border-border hover:border-primary/50 transition-colors"
            >
              <div className="p-2 rounded bg-primary/10">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-ui text-sm font-semibold truncate">
                    {stream.name}
                  </span>
                  <CheckCircle2 className="w-3 h-3 text-success shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {stream.description}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-sm text-primary">
                  {stream.records.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {stream.lastUpdate}
                </p>
              </div>
            </div>
          );
        })}

        <div className="mt-4 p-3 bg-success/10 border border-success/30 rounded">
          <p className="text-xs text-success">
            <span className="font-bold">CONTROL DATA:</span> 75.6% of biometric readings exist WITHOUT aircraft presence, proving baseline normality.
          </p>
        </div>
      </div>
    </CyberPanel>
  );
}

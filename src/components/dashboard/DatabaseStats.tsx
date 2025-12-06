import { Database, Table2, GitBranch, AlertTriangle, Activity, Shield } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";

const stats = [
  {
    label: "Total Records",
    value: 912969,
    icon: <Database />,
    variant: "primary" as const,
    trend: "up" as const,
    trendValue: "+15,847 this week",
  },
  {
    label: "Database Tables",
    value: 261,
    icon: <Table2 />,
    variant: "default" as const,
  },
  {
    label: "Correlation Events",
    value: 212918,
    icon: <GitBranch />,
    variant: "warning" as const,
    trend: "up" as const,
    trendValue: "91× temporal enrichment",
  },
  {
    label: "ADA Violations",
    value: 36870,
    icon: <AlertTriangle />,
    variant: "destructive" as const,
  },
  {
    label: "Flight Detections",
    value: 101646,
    icon: <Activity />,
    variant: "default" as const,
  },
  {
    label: "Evidence Files",
    value: 5072,
    icon: <Shield />,
    variant: "success" as const,
  },
];

export function DatabaseStats() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}

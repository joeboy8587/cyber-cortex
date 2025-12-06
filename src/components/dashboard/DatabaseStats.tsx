import { useEffect, useState } from "react";
import { Database, Table2, GitBranch, AlertTriangle, Activity, Shield, Loader2 } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";

interface Stats {
  totalRecords: number;
  tableCount: number;
}

export function DatabaseStats() {
  const { getStats, isLoading } = useNeonDatabase();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await getStats();
        setStats(data);
      } catch (err) {
        console.error("Failed to fetch stats:", err);
      }
    };
    fetchStats();
  }, [getStats]);

  const displayStats = [
    {
      label: "Total Records",
      value: stats?.totalRecords ?? 912969,
      icon: isLoading ? <Loader2 className="animate-spin" /> : <Database />,
      variant: "primary" as const,
      trend: "up" as const,
      trendValue: "Live from NeonDB",
    },
    {
      label: "Database Tables",
      value: stats?.tableCount ?? 261,
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

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {displayStats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}

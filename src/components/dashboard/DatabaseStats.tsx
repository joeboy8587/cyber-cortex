import { useEffect, useState } from "react";
import { Database, Table2, GitBranch, Activity, Shield, Loader2 } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";

interface Stats {
  totalRecords: number;
  tableCount: number;
}

export function DatabaseStats() {
  const { getStats, customQuery, isLoading } = useNeonDatabase();
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

  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchLiveCounts = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT
                (SELECT COUNT(*)::int FROM evidence_chain_links) as correlation_events,
                (SELECT COUNT(*)::int FROM live_flight_detections_rows) as flight_detections,
                (SELECT COUNT(*)::int FROM evidence_documents) as evidence_files
            `
          }
        });
        const row = Array.isArray(data) ? data[0] : (data?.data?.[0] || {});
        setLiveCounts({
          correlations: Number(row.correlation_events) || 0,
          flights: Number(row.flight_detections) || 0,
          evidence: Number(row.evidence_files) || 0,
        });
      } catch (e) {
        console.error("Failed to fetch live counts:", e);
      }
    };
    fetchLiveCounts();
  }, []);

  const displayStats = [
    {
      label: "Total Records",
      value: stats?.totalRecords ?? 0,
      icon: isLoading ? <Loader2 className="animate-spin" /> : <Database />,
      variant: "primary" as const,
      trend: "up" as const,
      trendValue: "Live from NeonDB",
    },
    {
      label: "Database Tables",
      value: stats?.tableCount ?? 0,
      icon: <Table2 />,
      variant: "default" as const,
    },
    {
      label: "Correlation Events",
      value: liveCounts.correlations || 0,
      icon: <GitBranch />,
      variant: "warning" as const,
      trend: "up" as const,
      trendValue: "Live count",
    },
    {
      label: "Flight Detections",
      value: liveCounts.flights || 0,
      icon: <Activity />,
      variant: "default" as const,
    },
    {
      label: "Evidence Files",
      value: liveCounts.evidence || 0,
      icon: <Shield />,
      variant: "success" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
      {displayStats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}

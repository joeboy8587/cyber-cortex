import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Crosshair, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { Button } from "@/components/ui/button";
import { extractNeonData, safeNumber } from "@/lib/formatters";

interface RealThreat {
  registration: string;
  threat_type: string;
  total_violations: number;
  avg_altitude: number | null;
  escalation_level: number;
  last_seen: string;
}

const levelStyles = {
  critical: { bg: "bg-destructive/10", border: "border-destructive", text: "text-destructive", dot: "bg-destructive" },
  high: { bg: "bg-warning/10", border: "border-warning", text: "text-warning", dot: "bg-warning" },
  medium: { bg: "bg-accent/10", border: "border-accent", text: "text-accent", dot: "bg-accent" },
  low: { bg: "bg-success/10", border: "border-success", text: "text-success", dot: "bg-success" },
};

function getLevel(escalation: number): keyof typeof levelStyles {
  if (escalation >= 4) return 'critical';
  if (escalation >= 3) return 'high';
  if (escalation >= 2) return 'medium';
  return 'low';
}

export function ThreatMatrix() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [threats, setThreats] = useState<RealThreat[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const fetchThreatData = async () => {
    setLoadingData(true);
    try {
      // Query real sentinel learned threats from Supabase + flagged aircraft from Neon
      const [sentinelData, flaggedData] = await Promise.all([
        customQuery(`
          SELECT registration, threat_type, total_violations, avg_altitude, escalation_level, last_seen
          FROM sentinel_learned_threats_rows
          ORDER BY escalation_level DESC, total_violations DESC
          LIMIT 10
        `).catch(() => []),
        customQuery(`
          SELECT registration, flag_reason as threat_type, 
                 detection_count as total_violations,
                 avg_altitude, risk_score as escalation_level,
                 last_detected as last_seen
          FROM flagged_aircraft_rows_rows
          ORDER BY risk_score DESC
          LIMIT 10
        `).catch(() => [])
      ]);

      const sentinel = extractNeonData<RealThreat>(sentinelData);
      const flagged = extractNeonData(flaggedData).map((f: any) => ({
        registration: f.registration || 'UNKNOWN',
        threat_type: f.threat_type || 'Flagged',
        total_violations: safeNumber(f.total_violations),
        avg_altitude: f.avg_altitude ? safeNumber(f.avg_altitude) : null,
        escalation_level: safeNumber(f.escalation_level, 1),
        last_seen: f.last_seen || '',
      }));

      // Merge and deduplicate by registration
      const seen = new Set<string>();
      const merged: RealThreat[] = [];
      for (const t of [...sentinel, ...flagged]) {
        if (!seen.has(t.registration)) {
          seen.add(t.registration);
          merged.push(t);
        }
      }

      setThreats(merged.slice(0, 12));
    } catch (err) {
      console.error('Failed to fetch threat data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    fetchThreatData();
    const interval = setInterval(fetchThreatData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <CyberPanel
      title="Threat Matrix"
      icon={<Crosshair className="w-4 h-4" />}
      variant="threat"
      headerActions={
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchThreatData} disabled={isLoading || loadingData}>
          <RefreshCw className={cn("w-3 h-3", (isLoading || loadingData) && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 space-y-3">
        {loadingData ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Loading threat data...</p>
          </div>
        ) : threats.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-xs">No active threats detected</p>
          </div>
        ) : (
          threats.map((threat, i) => {
            const level = getLevel(safeNumber(threat.escalation_level));
            const style = levelStyles[level];
            return (
              <div key={`${threat.registration}-${i}`} className={cn("p-3 rounded border", style.bg, style.border, "transition-all hover:scale-[1.02]")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("status-dot animate-pulse", style.dot)} />
                    <span className="font-display text-sm uppercase tracking-wide font-mono">{threat.registration}</span>
                  </div>
                  <span className={cn("text-xs font-bold uppercase px-2 py-0.5 rounded", style.bg, style.text)}>{level}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">{threat.threat_type}</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Violations</span>
                    <p className={cn("font-mono", style.text)}>{safeNumber(threat.total_violations).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Altitude</span>
                    <p className="font-mono text-foreground">{threat.avg_altitude ? `${safeNumber(threat.avg_altitude).toFixed(0)}ft` : 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Escalation</span>
                    <p className="font-mono text-foreground">Level {safeNumber(threat.escalation_level)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Seen</span>
                    <p className="font-mono text-primary glow-cyan text-[10px]">
                      {threat.last_seen ? new Date(threat.last_seen).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </CyberPanel>
  );
}

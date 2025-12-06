import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Users, Plane, Building, AlertTriangle, Eye, MapPin, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AircraftProfile {
  hex: string;
  registration: string;
  owner: string;
  operator: string;
  type: string;
  detectionCount: number;
  correlationCount: number;
  firstSeen: string;
  lastSeen: string;
  threatLevel: "high" | "medium" | "low";
}

export function EnterpriseProfiles() {
  const [profiles, setProfiles] = useState<AircraftProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ 
    totalAircraft: 0, 
    totalOwners: 0, 
    totalCorrelations: 0 
  });

  useEffect(() => {
    fetchEnterpriseData();
  }, []);

  const fetchEnterpriseData = async () => {
    try {
      // Fetch top perpetrator aircraft with owner info
      const { data: aircraftData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "custom",
          query: `
            WITH aircraft_stats AS (
              SELECT 
                f.hex,
                COUNT(*) as detection_count,
                MIN(f.timestamp) as first_seen,
                MAX(f.timestamp) as last_seen
              FROM flagged_aircraft_rows_rows f
              GROUP BY f.hex
              HAVING COUNT(*) > 10
              ORDER BY COUNT(*) DESC
              LIMIT 20
            ),
            correlation_counts AS (
              SELECT 
                aircraft_hex as hex,
                COUNT(*) as correlation_count
              FROM correlation_events_mv
              GROUP BY aircraft_hex
            )
            SELECT 
              a.hex,
              COALESCE(r.registration, a.hex) as registration,
              COALESCE(r.registrant_name, 'Unknown Owner') as owner,
              COALESCE(r.operator, 'Unknown Operator') as operator,
              COALESCE(r.aircraft_type, 'Unknown Type') as type,
              a.detection_count,
              COALESCE(c.correlation_count, 0) as correlation_count,
              a.first_seen,
              a.last_seen
            FROM aircraft_stats a
            LEFT JOIN aircraft_registry_enriched r ON a.hex = r.hex
            LEFT JOIN correlation_counts c ON a.hex = c.hex
            ORDER BY a.detection_count DESC
          `
        }
      });

      // Get overall stats
      const { data: statsData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "custom",
          query: `
            SELECT 
              (SELECT COUNT(DISTINCT hex) FROM flagged_aircraft_rows_rows) as total_aircraft,
              (SELECT COUNT(DISTINCT registrant_name) FROM aircraft_registry_enriched WHERE registrant_name IS NOT NULL) as total_owners,
              (SELECT COUNT(*) FROM correlation_events_mv) as total_correlations
          `
        }
      });

      if (aircraftData?.result) {
        const processedProfiles: AircraftProfile[] = aircraftData.result.map((a: any) => {
          let threatLevel: "high" | "medium" | "low" = "low";
          if (a.detection_count > 100 || a.correlation_count > 50) threatLevel = "high";
          else if (a.detection_count > 30 || a.correlation_count > 15) threatLevel = "medium";

          return {
            hex: a.hex,
            registration: a.registration,
            owner: a.owner,
            operator: a.operator,
            type: a.type,
            detectionCount: Number(a.detection_count),
            correlationCount: Number(a.correlation_count),
            firstSeen: a.first_seen,
            lastSeen: a.last_seen,
            threatLevel
          };
        });
        setProfiles(processedProfiles);
      }

      if (statsData?.result?.[0]) {
        setStats({
          totalAircraft: Number(statsData.result[0].total_aircraft) || 0,
          totalOwners: Number(statsData.result[0].total_owners) || 0,
          totalCorrelations: Number(statsData.result[0].total_correlations) || 0
        });
      }
    } catch (error) {
      console.error("Error fetching enterprise data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getThreatBadge = (level: "high" | "medium" | "low") => {
    const variants = {
      high: "bg-red-500/20 text-red-400 border-red-500/30",
      medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      low: "bg-green-500/20 text-green-400 border-green-500/30"
    };
    return <Badge className={`${variants[level]} text-[10px] border uppercase`}>{level}</Badge>;
  };

  return (
    <CyberPanel 
      title="RICO Enterprise Profiles" 
      icon={<Users className="w-5 h-5" />}
      variant="threat"
    >
      <div className="space-y-4">
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <Plane className="w-4 h-4 mx-auto mb-1 text-primary" />
            <div className="text-lg font-mono font-bold text-primary">
              {stats.totalAircraft.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Aircraft</div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <Building className="w-4 h-4 mx-auto mb-1 text-secondary" />
            <div className="text-lg font-mono font-bold text-secondary">
              {stats.totalOwners.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Owners</div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <div className="text-lg font-mono font-bold text-destructive">
              {stats.totalCorrelations.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Correlations</div>
          </div>
        </div>

        {/* RICO Note */}
        <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
          <p className="text-xs text-primary/90">
            <strong>18 U.S.C. § 1962:</strong> These profiles document the "enterprise" structure 
            required for RICO prosecution - coordinated actors using aircraft for stalking and harassment.
          </p>
        </div>

        {/* Profiles List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <Eye className="w-6 h-6 animate-pulse mx-auto mb-2" />
            Building enterprise profiles...
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
            {profiles.map((profile) => (
              <div 
                key={profile.hex}
                className="p-3 rounded-lg bg-background/30 border border-border/50 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Hash className="w-3 h-3 text-muted-foreground" />
                    <span className="font-mono text-sm font-bold text-primary">
                      {profile.registration}
                    </span>
                  </div>
                  {getThreatBadge(profile.threatLevel)}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <Building className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Owner:</span>
                    <span className="text-foreground truncate">{profile.owner}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Operator:</span>
                    <span className="text-foreground truncate">{profile.operator}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plane className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Type:</span>
                    <span className="text-foreground">{profile.type}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-border/50">
                  <div className="text-center">
                    <div className="font-mono text-sm font-bold text-yellow-400">
                      {profile.detectionCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Detections</div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-sm font-bold text-red-400">
                      {profile.correlationCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Correlations</div>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground mt-2 flex justify-between">
                  <span>First: {new Date(profile.firstSeen).toLocaleDateString()}</span>
                  <span>Last: {new Date(profile.lastSeen).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

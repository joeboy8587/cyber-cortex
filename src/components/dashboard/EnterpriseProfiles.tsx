import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { Users, Plane, Building, AlertTriangle, Eye, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AircraftProfile {
  hex: string;
  registration: string;
  detectionCount: number;
  avgThreatScore: number;
  firstSeen: string;
  lastSeen: string;
  threatLevel: "high" | "medium" | "low";
}

export function EnterpriseProfiles() {
  const [profiles, setProfiles] = useState<AircraftProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ 
    totalAircraft: 0, 
    totalDetections: 0, 
    totalFlagged: 0 
  });

  useEffect(() => {
    fetchEnterpriseData();
  }, []);

  const fetchEnterpriseData = async () => {
    try {
      // Use dedicated action for enterprise profiles
      const { data: enterpriseData, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "getEnterpriseProfiles" }
      });

      if (error) {
        console.warn("Enterprise profiles query failed:", error);
      }

      if (enterpriseData?.profiles && Array.isArray(enterpriseData.profiles)) {
        const processedProfiles: AircraftProfile[] = enterpriseData.profiles.map((p: any) => {
          const threatScore = Number(p.avg_threat_score) || 0;
          const count = Number(p.detection_count) || 0;
          let threatLevel: "high" | "medium" | "low" = "low";
          if (threatScore > 70 || count > 100) threatLevel = "high";
          else if (threatScore > 40 || count > 30) threatLevel = "medium";

          return {
            hex: p.registration || "Unknown",
            registration: p.registration || "Unknown",
            detectionCount: count,
            avgThreatScore: threatScore,
            firstSeen: p.first_seen || "",
            lastSeen: p.last_seen || "",
            threatLevel
          };
        });

        setProfiles(processedProfiles.slice(0, 20));
        
        if (enterpriseData.stats) {
          setStats({
            totalAircraft: Number(enterpriseData.stats.totalAircraft) || 0,
            totalDetections: Number(enterpriseData.stats.totalDetections) || 0,
            totalFlagged: Number(enterpriseData.stats.totalFlagged) || 0
          });
        }
      } else {
        // Fallback to customQuery if dedicated action fails
        const { data: fallbackData } = await supabase.functions.invoke("neon-query", {
          body: {
            action: "customQuery",
            query: `
              SELECT 
                COALESCE(registration, hex) as registration,
                COUNT(*) as detection_count,
                COALESCE(AVG(threat_score), 0) as avg_threat_score,
                MIN(detection_timestamp) as first_seen,
                MAX(detection_timestamp) as last_seen
              FROM live_flight_detections_rows
              WHERE registration IS NOT NULL OR hex IS NOT NULL
              GROUP BY COALESCE(registration, hex)
              HAVING COUNT(*) > 5
              ORDER BY COUNT(*) DESC
              LIMIT 25
            `
          }
        });

        if (fallbackData && Array.isArray(fallbackData)) {
          const processedProfiles: AircraftProfile[] = fallbackData.map((p: any) => {
            const threatScore = Number(p.avg_threat_score) || 0;
            const count = Number(p.detection_count) || 0;
            let threatLevel: "high" | "medium" | "low" = "low";
            if (threatScore > 70 || count > 100) threatLevel = "high";
            else if (threatScore > 40 || count > 30) threatLevel = "medium";

            return {
              hex: p.registration || "Unknown",
              registration: p.registration || "Unknown",
              detectionCount: count,
              avgThreatScore: threatScore,
              firstSeen: p.first_seen || "",
              lastSeen: p.last_seen || "",
              threatLevel
            };
          });

          setProfiles(processedProfiles.slice(0, 20));
        }

        // Get stats separately
        const { data: statsData } = await supabase.functions.invoke("neon-query", {
          body: { action: "getDashboardCounts" }
        });

        if (statsData) {
          setStats({
            totalAircraft: Number(statsData.total_flights) || 0,
            totalDetections: Number(statsData.total_flights) || 0,
            totalFlagged: Number(statsData.flagged_flights) || 0
          });
        }
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
            <div className="text-[10px] text-muted-foreground">Registered</div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <Building className="w-4 h-4 mx-auto mb-1 text-secondary" />
            <div className="text-lg font-mono font-bold text-secondary">
              {stats.totalDetections.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Detections</div>
          </div>
          <div className="p-3 rounded-lg bg-background/50 border border-border text-center">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <div className="text-lg font-mono font-bold text-destructive">
              {stats.totalFlagged.toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">Flagged</div>
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
            {profiles.map((profile, index) => (
              <div 
                key={`${profile.hex}-${index}`}
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

                <div className="grid grid-cols-2 gap-2 mt-3 pt-2 border-t border-border/50">
                  <div className="text-center">
                    <div className="font-mono text-sm font-bold text-yellow-400">
                      {profile.detectionCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-muted-foreground">Detections</div>
                  </div>
                  <div className="text-center">
                    <div className="font-mono text-sm font-bold text-red-400">
                      {(profile.avgThreatScore * 100).toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">Threat Score</div>
                  </div>
                </div>

                {profile.firstSeen && profile.lastSeen && (
                  <div className="text-[10px] text-muted-foreground mt-2 flex justify-between">
                    <span>First: {new Date(profile.firstSeen).toLocaleDateString()}</span>
                    <span>Last: {new Date(profile.lastSeen).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

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
      // Fetch top aircraft from registry with detection stats
      const { data: aircraftData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              registration,
              detection_count,
              avg_threat_score,
              first_seen,
              last_seen
            FROM aircraft_registry_enriched
            WHERE detection_count > 10
            ORDER BY detection_count DESC
            LIMIT 20
          `
        }
      });

      // Get flagged aircraft stats
      const { data: flaggedData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              hex,
              COUNT(*) as detection_count,
              MIN(flagged_at) as first_seen,
              MAX(flagged_at) as last_seen
            FROM flagged_aircraft_rows_rows
            GROUP BY hex
            HAVING COUNT(*) > 10
            ORDER BY COUNT(*) DESC
            LIMIT 20
          `
        }
      });

      // Get overall stats
      const { data: statsData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              (SELECT COUNT(*) FROM aircraft_registry_enriched) as total_aircraft,
              (SELECT SUM(detection_count) FROM aircraft_registry_enriched) as total_detections,
              (SELECT COUNT(DISTINCT hex) FROM flagged_aircraft_rows_rows) as total_flagged
          `
        }
      });

      const processedProfiles: AircraftProfile[] = [];

      // Process registry data
      if (aircraftData?.data) {
        aircraftData.data.forEach((a: any) => {
          const threatScore = Number(a.avg_threat_score) || 0;
          let threatLevel: "high" | "medium" | "low" = "low";
          if (threatScore > 0.7 || Number(a.detection_count) > 100) threatLevel = "high";
          else if (threatScore > 0.4 || Number(a.detection_count) > 30) threatLevel = "medium";

          processedProfiles.push({
            hex: a.registration || "Unknown",
            registration: a.registration || "Unknown",
            detectionCount: Number(a.detection_count) || 0,
            avgThreatScore: threatScore,
            firstSeen: a.first_seen || "",
            lastSeen: a.last_seen || "",
            threatLevel
          });
        });
      }

      // Add flagged aircraft if not already present
      if (flaggedData?.data) {
        flaggedData.data.forEach((f: any) => {
          const exists = processedProfiles.some(p => p.hex === f.hex);
          if (!exists) {
            const count = Number(f.detection_count) || 0;
            let threatLevel: "high" | "medium" | "low" = "low";
            if (count > 100) threatLevel = "high";
            else if (count > 30) threatLevel = "medium";

            processedProfiles.push({
              hex: f.hex,
              registration: f.hex,
              detectionCount: count,
              avgThreatScore: 0,
              firstSeen: f.first_seen || "",
              lastSeen: f.last_seen || "",
              threatLevel
            });
          }
        });
      }

      // Sort by detection count
      processedProfiles.sort((a, b) => b.detectionCount - a.detectionCount);
      setProfiles(processedProfiles.slice(0, 20));

      if (statsData?.data?.[0]) {
        setStats({
          totalAircraft: Number(statsData.data[0].total_aircraft) || 0,
          totalDetections: Number(statsData.data[0].total_detections) || 0,
          totalFlagged: Number(statsData.data[0].total_flagged) || 0
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

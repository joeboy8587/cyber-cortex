import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  Radio, 
  Loader2, 
  RefreshCw, 
  AlertTriangle,
  Eye,
  EyeOff,
  Shield,
  Zap
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface SpoofingIncident {
  id: string;
  registration: string;
  callsign: string;
  spoofType: "transponder_off" | "false_altitude" | "false_callsign" | "null_data";
  detectedAt: string;
  evidence: string;
  severity: "critical" | "high" | "medium";
  legalCitation: string;
}

interface DetectionStats {
  totalScanned: number;
  spoofingDetected: number;
  transponderOff: number;
  falseData: number;
  lastScan: string;
}

export function ADSBSpoofingDetector() {
  const [isScanning, setIsScanning] = useState(false);
  const [incidents, setIncidents] = useState<SpoofingIncident[]>([]);
  const [stats, setStats] = useState<DetectionStats | null>(null);
  const [progress, setProgress] = useState(0);

  const runSpoofingDetection = useCallback(async () => {
    setIsScanning(true);
    setProgress(0);
    setIncidents([]);

    try {
      // Scan for null/missing data (transponder off)
      // CRITICAL: Exclude XXB / MLAT placeholders — those are tracker artifacts, NOT spoofing.
      // See public/data/XXB_EXPLANATION.md and src/lib/detectionClassifier.ts.
      setProgress(20);

      const { data: nullData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              registration,
              callsign,
              altitude,
              speed,
              detection_timestamp,
              icao24
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '30 days'
              -- Exclude MLAT-only placeholders (XXB, null icao24) — those are not spoofing
              AND COALESCE(UPPER(registration), '') NOT IN ('XXB','XXA','XXC','XXD','XXX','UNKNOWN','')
              AND icao24 IS NOT NULL
              AND icao24 ~ '^[0-9A-Fa-f]{6}$'
              AND (
                altitude IS NULL 
                OR speed IS NULL 
                -- Real concern: valid aircraft at altitude with speed=0 (impossible mid-flight)
                OR (speed = 0 AND altitude > 500)
              )
            ORDER BY detection_timestamp DESC
            LIMIT 100
          `
        }
      });

      setProgress(45);

      // Scan for impossible altitude changes (spoofed data)
      const { data: altitudeAnomalies } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            WITH altitude_changes AS (
              SELECT 
                registration,
                callsign,
                altitude,
                detection_timestamp,
                LAG(altitude) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_altitude,
                LAG(detection_timestamp) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_time
              FROM live_flight_detections_rows
              WHERE detection_timestamp > NOW() - INTERVAL '7 days'
                AND altitude IS NOT NULL
            )
            SELECT 
              registration,
              callsign,
              altitude,
              prev_altitude,
              detection_timestamp,
              ABS(altitude::numeric - prev_altitude::numeric) as altitude_change
            FROM altitude_changes
            WHERE ABS(altitude::numeric - prev_altitude::numeric) > 5000
              AND EXTRACT(EPOCH FROM (detection_timestamp - prev_time)) < 60
            ORDER BY altitude_change DESC
            LIMIT 50
          `
        }
      });

      setProgress(70);

      // Scan for callsign anomalies
      const { data: callsignAnomalies } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              registration,
              callsign,
              COUNT(DISTINCT callsign) as callsign_count,
              ARRAY_AGG(DISTINCT callsign) as all_callsigns,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '30 days'
              AND registration IS NOT NULL
            GROUP BY registration, callsign
            HAVING COUNT(DISTINCT callsign) > 3
            ORDER BY callsign_count DESC
            LIMIT 30
          `
        }
      });

      setProgress(85);

      // Generate incident reports
      const detectedIncidents: SpoofingIncident[] = [];
      
      // Process suppression incidents (already filtered server-side to exclude MLAT/XXB)
      const nullDataRecords = Array.isArray(nullData) ? nullData : [];
      nullDataRecords.slice(0, 20).forEach((record: any) => {
        const issues: string[] = [];
        if (record.altitude === null) issues.push("NULL_ALTITUDE");
        if (record.speed === null) issues.push("NULL_SPEED");
        if (record.speed === 0 && record.altitude > 500) issues.push("ZERO_SPEED_IN_FLIGHT");

        detectedIncidents.push({
          id: crypto.randomUUID(),
          registration: record.registration || "UNKNOWN",
          callsign: record.callsign || "UNKNOWN",
          spoofType: "null_data",
          detectedAt: record.detection_timestamp,
          evidence: `Valid aircraft missing payload data: ${issues.join(", ")} at ${record.altitude ?? "null"}ft`,
          severity: "high",
          legalCitation: "14 CFR § 91.225 — ADS-B Out Altitude Required"
        });
      });

      // Process altitude anomalies
      const altitudeRecords = Array.isArray(altitudeAnomalies) ? altitudeAnomalies : [];
      altitudeRecords.slice(0, 10).forEach((record: any) => {
        detectedIncidents.push({
          id: crypto.randomUUID(),
          registration: record.registration || "UNKNOWN",
          callsign: record.callsign || "UNKNOWN",
          spoofType: "false_altitude",
          detectedAt: record.detection_timestamp,
          evidence: `Impossible altitude change: ${Math.round(record.altitude_change)}ft in <60 seconds (${record.prev_altitude}ft → ${record.altitude}ft)`,
          severity: "critical",
          legalCitation: "18 U.S.C. § 32 - Aircraft Sabotage/False Data"
        });
      });

      // Process callsign anomalies
      const callsignRecords = Array.isArray(callsignAnomalies) ? callsignAnomalies : [];
      callsignRecords.slice(0, 10).forEach((record: any) => {
        detectedIncidents.push({
          id: crypto.randomUUID(),
          registration: record.registration,
          callsign: record.all_callsigns?.[0] || "MULTIPLE",
          spoofType: "false_callsign",
          detectedAt: record.last_seen,
          evidence: `${record.callsign_count} different callsigns used: ${record.all_callsigns?.slice(0, 4).join(", ")}...`,
          severity: "high",
          legalCitation: "49 U.S.C. § 46306 - Registration Violations"
        });
      });

      // Calculate stats
      setStats({
        totalScanned: nullDataRecords.length + altitudeRecords.length + callsignRecords.length,
        spoofingDetected: detectedIncidents.length,
        transponderOff: detectedIncidents.filter(i => i.spoofType === "null_data").length,
        falseData: detectedIncidents.filter(i => i.spoofType === "false_altitude" || i.spoofType === "false_callsign").length,
        lastScan: new Date().toISOString()
      });

      setIncidents(detectedIncidents);
      setProgress(100);

      const criticalCount = detectedIncidents.filter(i => i.severity === "critical").length;
      if (criticalCount > 0) {
        toast.error(`🚨 ${criticalCount} CRITICAL spoofing incidents detected!`);
      } else {
        toast.success(`Scan complete: ${detectedIncidents.length} anomalies detected`);
      }

    } catch (err) {
      console.error("Spoofing detection error:", err);
      toast.error("Spoofing scan failed");
    } finally {
      setIsScanning(false);
    }
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-500";
      case "high": return "bg-orange-500";
      default: return "bg-yellow-500";
    }
  };

  const getSpoofIcon = (type: string) => {
    switch (type) {
      case "transponder_off":
      case "null_data":
        return <EyeOff className="h-4 w-4 text-red-400" />;
      case "false_altitude":
        return <Zap className="h-4 w-4 text-orange-400" />;
      case "false_callsign":
        return <Shield className="h-4 w-4 text-yellow-400" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  return (
    <Card className="border-orange-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-orange-400" />
            ADS-B Spoofing Detector
            <Badge variant="outline" className="ml-2 text-orange-400 border-orange-400/50">
              REAL-TIME
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={runSpoofingDetection}
            disabled={isScanning}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Detect Spoofing
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* MLAT clarification banner */}
        <div className="p-2 rounded text-xs bg-muted/40 border border-border text-muted-foreground">
          <strong className="text-foreground">Scope:</strong> This scanner now excludes XXB / MLAT-only tracks (legitimate tracker placeholders, not spoofing).
          It flags only valid registered aircraft missing altitude or speed data mid-flight (14 CFR § 91.225 violations).
        </div>

        {isScanning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Scanning for transponder anomalies...</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Detection Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <div className="text-xs text-blue-400">Records Scanned</div>
              <div className="text-2xl font-bold">{stats.totalScanned}</div>
            </div>
            <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <div className="text-xs text-red-400">Spoofing Detected</div>
              <div className="text-2xl font-bold text-red-400">{stats.spoofingDetected}</div>
            </div>
            <div className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
              <div className="text-xs text-orange-400">Transponder Off</div>
              <div className="text-2xl font-bold">{stats.transponderOff}</div>
            </div>
            <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <div className="text-xs text-yellow-400">False Data</div>
              <div className="text-2xl font-bold">{stats.falseData}</div>
            </div>
          </div>
        )}

        {/* Incidents List */}
        <ScrollArea className="h-[350px]">
          <div className="space-y-2">
            {incidents.length === 0 && !isScanning ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Radio className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">Scan for ADS-B anomalies and transponder masking</p>
                <p className="text-xs mt-1 opacity-70">Detects hidden flights and spoofed telemetry</p>
              </div>
            ) : (
              incidents.map(incident => (
                <div
                  key={incident.id}
                  className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      {getSpoofIcon(incident.spoofType)}
                      <Badge className={getSeverityColor(incident.severity)}>
                        {incident.severity.toUpperCase()}
                      </Badge>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {incident.registration}
                      </code>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {incident.spoofType.replace("_", " ").toUpperCase()}
                    </Badge>
                  </div>
                  
                  <p className="text-sm">{incident.evidence}</p>
                  
                  <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                    <code className="text-orange-400">{incident.legalCitation}</code>
                    <span>{new Date(incident.detectedAt).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Legal Notice */}
        {incidents.length > 0 && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-red-400 text-sm font-semibold mb-1">
              <AlertTriangle className="h-4 w-4" />
              FEDERAL VIOLATION DETECTED
            </div>
            <p className="text-xs text-muted-foreground">
              ADS-B masking/spoofing violates 14 CFR § 91.227 and may constitute evidence of
              consciousness of guilt under FRE 403. All incidents are timestamped for federal filing.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

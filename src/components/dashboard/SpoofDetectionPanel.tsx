import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Radio,
  Loader2,
  AlertTriangle,
  Eye,
  EyeOff,
  Shield,
  Zap,
  RotateCw,
  Plane,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface SpoofScanResult {
  foreignIcaoSpoofs: any[];
  physicsViolations: any[];
  icaoRotation: any[];
  transponderOff: any[];
  altitudeJumps: any[];
  stats: {
    totalDetections: number;
    foreignIcaoCount: number;
    maskedCount: number;
    uniqueAircraft: number;
    spoofCategories: {
      foreignIcao: number;
      physicsViolation: number;
      icaoRotation: number;
      transponderMasked: number;
      altitudeAnomaly: number;
    };
  };
  scanTimestamp: string;
}

export function SpoofDetectionPanel() {
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SpoofScanResult | null>(null);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setProgress(10);
    setResult(null);

    try {
      setProgress(30);
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "spoofDetectionScan", timeWindow: "30 days" },
      });

      setProgress(90);

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult(data as SpoofScanResult);
      setProgress(100);

      const total =
        (data.stats?.spoofCategories?.foreignIcao || 0) +
        (data.stats?.spoofCategories?.physicsViolation || 0) +
        (data.stats?.spoofCategories?.icaoRotation || 0) +
        (data.stats?.spoofCategories?.transponderMasked || 0) +
        (data.stats?.spoofCategories?.altitudeAnomaly || 0);

      if (total > 0) {
        toast.error(`🚨 ${total} spoofing anomalies detected across 5 categories`);
      } else {
        toast.success("Scan complete — no anomalies detected");
      }
    } catch (err) {
      console.error("Spoof detection error:", err);
      toast.error("Spoof detection scan failed");
    } finally {
      setIsScanning(false);
    }
  }, []);

  const cats = result?.stats?.spoofCategories;

  return (
    <Card className="border-destructive/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <Radio className="h-5 w-5 text-destructive" />
            Spoof Detection Engine
            <Badge variant="outline" className="ml-2 text-destructive border-destructive/50">
              PHASE 1 + 2
            </Badge>
          </div>
          <Button
            size="sm"
            onClick={runScan}
            disabled={isScanning}
            variant="destructive"
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Eye className="h-4 w-4 mr-2" />
            )}
            Full Spoof Scan
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isScanning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-mono text-xs">
                Scanning ICAO validity · physics envelopes · rotation patterns...
              </span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Stats Grid */}
        {result && cats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatBox
              label="Foreign ICAO"
              value={cats.foreignIcao}
              icon={<Plane className="h-4 w-4" />}
              color="text-red-400"
              bg="bg-red-500/10 border-red-500/30"
            />
            <StatBox
              label="Physics Violations"
              value={cats.physicsViolation}
              icon={<Zap className="h-4 w-4" />}
              color="text-orange-400"
              bg="bg-orange-500/10 border-orange-500/30"
            />
            <StatBox
              label="ICAO Rotation"
              value={cats.icaoRotation}
              icon={<RotateCw className="h-4 w-4" />}
              color="text-yellow-400"
              bg="bg-yellow-500/10 border-yellow-500/30"
            />
            <StatBox
              label="Transponder Off"
              value={cats.transponderMasked}
              icon={<EyeOff className="h-4 w-4" />}
              color="text-purple-400"
              bg="bg-purple-500/10 border-purple-500/30"
            />
            <StatBox
              label="Alt. Anomaly"
              value={cats.altitudeAnomaly}
              icon={<Activity className="h-4 w-4" />}
              color="text-cyan-400"
              bg="bg-cyan-500/10 border-cyan-500/30"
            />
          </div>
        )}

        {/* Tabbed Results */}
        {result && (
          <Tabs defaultValue="foreign" className="w-full">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="foreign" className="text-xs">Foreign ICAO</TabsTrigger>
              <TabsTrigger value="physics" className="text-xs">Physics</TabsTrigger>
              <TabsTrigger value="rotation" className="text-xs">Rotation</TabsTrigger>
              <TabsTrigger value="masked" className="text-xs">Masked</TabsTrigger>
              <TabsTrigger value="altitude" className="text-xs">Alt Jump</TabsTrigger>
            </TabsList>

            <TabsContent value="foreign">
              <IncidentList
                items={result.foreignIcaoSpoofs}
                renderItem={(item) => (
                  <IncidentRow
                    severity="critical"
                    icon={<Plane className="h-4 w-4 text-red-400" />}
                    title={`${item.icao_code} → ${item.registration || "UNKNOWN"}`}
                    detail={`${item.aircraft_type || "Unknown type"} at ${item.altitude || "?"}ft, ${item.speed || "?"}kts — ${item.owner_operator || "Unknown operator"}`}
                    citation="14 CFR § 91.227 / 18 U.S.C. § 32"
                    timestamp={item.detection_timestamp}
                  />
                )}
                emptyText="No foreign ICAO spoofing detected"
              />
            </TabsContent>

            <TabsContent value="physics">
              <IncidentList
                items={result.physicsViolations}
                renderItem={(item) => (
                  <IncidentRow
                    severity="critical"
                    icon={<Zap className="h-4 w-4 text-orange-400" />}
                    title={`${item.registration || item.icao_code || "UNKNOWN"} — PHYSICS VIOLATION`}
                    detail={`${item.aircraft_type} at ${item.altitude}ft, ${item.speed}kts — Commercial jet CANNOT operate at these parameters`}
                    citation="18 U.S.C. § 32 — Aircraft Sabotage / False Data"
                    timestamp={item.detection_timestamp}
                  />
                )}
                emptyText="No physics violations detected"
              />
            </TabsContent>

            <TabsContent value="rotation">
              <IncidentList
                items={result.icaoRotation}
                renderItem={(item) => (
              <IncidentRow
                    severity="high"
                    icon={<RotateCw className="h-4 w-4 text-yellow-400" />}
                    title={`${item.registration} — ${item.icao_count} ICAO codes`}
                    detail={`Codes: ${(Array.isArray(item.icao_codes) ? item.icao_codes : String(item.icao_codes || "").replace(/[{}]/g, "").split(",").filter(Boolean)).slice(0, 5).join(", ")}${item.icao_count > 5 ? "..." : ""} — ${item.total_detections} detections`}
                    citation="49 U.S.C. § 46306 — Registration Violations"
                    timestamp={item.last_seen}
                  />
                )}
                emptyText="No ICAO rotation detected"
              />
            </TabsContent>

            <TabsContent value="masked">
              <IncidentList
                items={result.transponderOff}
                renderItem={(item) => (
                  <IncidentRow
                    severity="high"
                    icon={<EyeOff className="h-4 w-4 text-purple-400" />}
                    title={`ANONYMOUS — ${item.callsign || "NO CALLSIGN"}`}
                    detail={`${item.altitude || "?"}ft, ${item.speed || "?"}kts in Oildale/Bakersfield target zone`}
                    citation="14 CFR § 91.227 — ADS-B Out Required"
                    timestamp={item.detection_timestamp}
                  />
                )}
                emptyText="No masked transponder events detected"
              />
            </TabsContent>

            <TabsContent value="altitude">
              <IncidentList
                items={result.altitudeJumps}
                renderItem={(item) => (
                  <IncidentRow
                    severity="critical"
                    icon={<Activity className="h-4 w-4 text-cyan-400" />}
                    title={`${item.registration || item.icao_code} — ${Math.round(item.alt_change)}ft jump`}
                    detail={`${item.prev_alt}ft → ${item.altitude}ft in ${Math.round(item.seconds_elapsed)}s — Physically impossible`}
                    citation="18 U.S.C. § 1001 — False Statements"
                    timestamp={item.detection_timestamp}
                  />
                )}
                emptyText="No altitude anomalies detected"
              />
            </TabsContent>
          </Tabs>
        )}

        {/* Empty state */}
        {!result && !isScanning && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Shield className="h-10 w-10 mb-3 opacity-40" />
            <p className="text-sm">Real-time spoof detection across 5 attack vectors</p>
            <p className="text-xs mt-1 opacity-70">
              ICAO validation · Physics envelopes · Rotation tracking · Transponder masking · Altitude anomalies
            </p>
          </div>
        )}

        {/* Legal Footer */}
        {result && (cats?.foreignIcao || 0) + (cats?.physicsViolation || 0) > 0 && (
          <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
            <div className="flex items-center gap-2 text-destructive text-sm font-semibold mb-1">
              <AlertTriangle className="h-4 w-4" />
              FEDERAL VIOLATIONS DOCUMENTED
            </div>
            <p className="text-xs text-muted-foreground">
              Foreign ICAO spoofing and physics violations constitute evidence of transponder manipulation
              under 14 CFR § 91.227, potential aircraft sabotage under 18 U.S.C. § 32, and consciousness
              of guilt under FRE 403. All events are timestamped and SHA-256 fingerprinted for federal filing.
              Auto-referral threshold: 100 events → DOJ Computer Fraud Division / FAA 9-AMC-AFS-360.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function StatBox({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <div className={`p-3 rounded-lg border ${bg}`}>
      <div className={`flex items-center gap-1 text-xs ${color} mb-1`}>
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function IncidentList({
  items,
  renderItem,
  emptyText,
}: {
  items: any[];
  renderItem: (item: any, i: number) => React.ReactNode;
  emptyText: string;
}) {
  if (!items || items.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
        {emptyText}
      </div>
    );
  }
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2 pr-2">{items.map((item, i) => renderItem(item, i))}</div>
    </ScrollArea>
  );
}

function IncidentRow({
  severity,
  icon,
  title,
  detail,
  citation,
  timestamp,
}: {
  severity: "critical" | "high" | "medium";
  icon: React.ReactNode;
  title: string;
  detail: string;
  citation: string;
  timestamp: string;
}) {
  const severityColor =
    severity === "critical"
      ? "bg-red-500"
      : severity === "high"
      ? "bg-orange-500"
      : "bg-yellow-500";

  return (
    <div className="p-3 border rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <Badge className={severityColor}>{severity.toUpperCase()}</Badge>
          <span className="text-sm font-mono font-semibold">{title}</span>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <code className="text-orange-400">{citation}</code>
        <span>{timestamp ? new Date(timestamp).toLocaleString() : "—"}</span>
      </div>
    </div>
  );
}

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Play, FileText, ShieldAlert, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Violation {
  registration: string;
  callsign: string | null;
  icao24: string | null;
  detection_timestamp: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  speed_kts: number;
  distance_to_aoi_ft: number;
  far_cited: string;
  airspace_class: string | null;
  airspace_name: string;
  airspace_floor_ft: number | null;
  airspace_ceiling_ft: number | null;
  geofence_breach: boolean;
  severity: "critical" | "high" | "medium";
  reason: string;
  recommended_action: string;
  row_sha256: string;
}

interface Summary {
  scan_id: string;
  started_at: string;
  finished_at: string;
  detections_evaluated: number;
  violations_found: number;
  severity_breakdown: Record<string, number>;
  far_breakdown: Record<string, number>;
  batch_sha256: string;
  radius_m: number;
  lookback_hours: number;
}

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-600 text-white",
  medium: "bg-yellow-600 text-white",
};

export default function SentinelV2() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lookback, setLookback] = useState(24);
  const [radius, setRadius] = useState(15000);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);

  const runScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sentinel-v2", {
        body: { lookback_hours: lookback, radius_m: radius, limit: 1500 },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Scan failed");
      setSummary(data.summary);
      setViolations(data.violations);
      toast({ title: "Sentinel v2 scan complete", description: `${data.summary.violations_found} FAR-cited violations` });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!violations.length || !summary) return;
    const header = [
      "registration", "callsign", "timestamp", "lat", "lng", "altitude_ft", "speed_kts",
      "far_cited", "airspace_class", "airspace_name", "airspace_floor_ft", "airspace_ceiling_ft",
      "geofence_breach", "distance_to_aoi_ft", "severity", "reason", "recommended_action", "row_sha256",
    ];
    const rows = violations.map(v => [
      v.registration, v.callsign ?? "", v.detection_timestamp, v.latitude, v.longitude,
      v.altitude_ft, v.speed_kts, v.far_cited, v.airspace_class ?? "", v.airspace_name,
      v.airspace_floor_ft ?? "", v.airspace_ceiling_ft ?? "", v.geofence_breach,
      v.distance_to_aoi_ft, v.severity, v.reason.replace(/"/g, "'"),
      v.recommended_action.replace(/"/g, "'"), v.row_sha256,
    ].map(c => `"${String(c)}"`).join(","));
    const csv = [header.join(","), ...rows, "", `# scan_id,${summary.scan_id}`, `# batch_sha256,${summary.batch_sha256}`].join("\n");
    const ymd = new Date(summary.started_at).toISOString().slice(0, 10).replace(/-/g, "");
    download(csv, `${ymd}_SENTINEL_V2_FAR_VIOLATIONS.csv`, "text/csv");
  };

  const generateFoia = (v: Violation) => {
    if (!summary) return;
    const ymd = new Date(v.detection_timestamp).toISOString().slice(0, 10).replace(/-/g, "");
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const isClassD = v.airspace_class === "D";
    const isClassC = v.airspace_class === "C";
    const isClassB = v.airspace_class === "B";
    const tower = v.airspace_name.replace(/\s+CLASS.*/i, "").trim();

    const body = `${date}

VIA EMAIL: 9-AWA-FOIA@faa.gov
ALSO MAILED TO: FAA National FOIA Office
                AFN-140
                800 Independence Avenue, SW
                Washington, DC 20591

RE: FREEDOM OF INFORMATION ACT REQUEST — ${tower} ATC RECORDS
    Incident: ${v.registration} on ${new Date(v.detection_timestamp).toUTCString()}

To Whom It May Concern,

Pursuant to the Freedom of Information Act, 5 U.S.C. § 552, I request the
following records concerning a possible violation of ${v.far_cited.split("—")[0].trim()}:

REQUESTED RECORDS
1. All ATC voice recordings from ${tower}${isClassD || isClassC || isClassB ? " tower" : ""}
   for the 30-minute window centered on ${v.detection_timestamp} UTC.
2. Radar tracks (NTAP / ASR-9 / STARS) for aircraft registration ${v.registration}
   (ICAO24 ${v.icao24 ?? "unknown"}) during the same window.
3. Any flight progress strips, clearance issuance records, or coordination
   logs naming ${v.registration} or its callsign ${v.callsign ?? "(none)"} for ${ymd}.
4. Any waiver, COA, LOA, or Special Flight Rules authorization in effect for
   ${v.registration} on that date covering ${v.airspace_name} (${v.airspace_class}).

FACTUAL BASIS
On ${new Date(v.detection_timestamp).toUTCString()}, ADS-B telemetry recorded
${v.registration} at:
   • Position: ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}
   • Altitude: ${v.altitude_ft} ft (${v.airspace_class === "G" ? "AGL" : "MSL"})
   • Speed:    ${v.speed_kts} kts
   • Inside:   ${v.airspace_name} (Class ${v.airspace_class},
                floor ${v.airspace_floor_ft ?? "SFC"} ft, ceiling ${v.airspace_ceiling_ft ?? "UNL"} ft)
   • Distance to my residence: ${v.distance_to_aoi_ft} ft

This places the aircraft in apparent violation of ${v.far_cited}.
Specifically: ${v.reason}

EVIDENCE INTEGRITY
This request is supported by deterministic SQL forensic output. The single-row
SHA-256 fingerprint is:
   ${v.row_sha256}
The full batch fingerprint (scan ${summary.scan_id}) is:
   ${summary.batch_sha256}
Any alteration to the underlying record breaks both hashes.

FEE WAIVER
I request a fee waiver under 5 U.S.C. § 552(a)(4)(A)(iii). Disclosure is in
the public interest: it concerns government oversight of low-altitude flight
operations over a private residence and is not for commercial use.

EXPEDITED PROCESSING
I request expedited processing under 5 U.S.C. § 552(a)(6)(E)(v)(II). There is
a compelling need: ongoing flights below the published floor of ${v.airspace_name}
implicate ${v.far_cited.split("—")[0].trim()} and may indicate a continuing
threat to safety.

If any portion of this request is denied, please cite the specific exemption
and provide segregable non-exempt portions.

Sincerely,

Joseph
[Address on file]
[Phone on file]
[Email on file]

— Generated by Project Watchtower Sentinel v2
  Scan ID:       ${summary.scan_id}
  Row SHA-256:   ${v.row_sha256}
  Batch SHA-256: ${summary.batch_sha256}
`;

    download(body, `${ymd}_FAA_FOIA_${v.registration}_${(v.airspace_class || "X")}.txt`, "text/plain");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Sentinel Report v2</h1>
          <p className="text-sm text-muted-foreground">
            FAA airspace geo-fence + FAR-cited violations. Every row carries SHA-256 chain of custody.
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="space-y-1">
            <Label htmlFor="lb">Lookback (hours)</Label>
            <Input id="lb" type="number" value={lookback} onChange={e => setLookback(Number(e.target.value))} className="w-32" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r">Radius (meters)</Label>
            <Input id="r" type="number" value={radius} onChange={e => setRadius(Number(e.target.value))} className="w-32" />
          </div>
          <Button onClick={runScan} disabled={loading} className="gap-2">
            <Play className="w-4 h-4" /> {loading ? "Scanning…" : "Run Sentinel v2 Scan"}
          </Button>
          {violations.length > 0 && (
            <Button variant="outline" onClick={exportCsv} className="gap-2">
              <Download className="w-4 h-4" /> Export CSV (with SHA-256)
            </Button>
          )}
        </div>
      </Card>

      {summary && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1">
              <Stat label="Detections" value={summary.detections_evaluated} />
              <Stat label="Violations" value={summary.violations_found} />
              <Stat label="Critical" value={summary.severity_breakdown.critical || 0} />
              <Stat label="High" value={summary.severity_breakdown.high || 0} />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono pt-2 border-t">
            <Hash className="w-3 h-3" />
            <span>batch_sha256: {summary.batch_sha256}</span>
          </div>
        </Card>
      )}

      {violations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {["Tail", "Sev", "Alt", "Spd", "Airspace", "FAR Cited", "Reason", "Action", "Time", "FOIA"].map(h => (
                    <th key={h} className="px-2 py-2 text-left font-mono whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {violations.map(v => (
                  <tr key={v.row_sha256} className="border-t border-border hover:bg-muted/30">
                    <td className="px-2 py-2 font-mono font-semibold">{v.registration}</td>
                    <td className="px-2 py-2"><Badge className={sevColor[v.severity]}>{v.severity.toUpperCase()}</Badge></td>
                    <td className="px-2 py-2 font-mono">{v.altitude_ft}ft</td>
                    <td className="px-2 py-2 font-mono">{v.speed_kts}kt</td>
                    <td className="px-2 py-2">
                      <div className="font-semibold">{v.airspace_class}</div>
                      <div className="text-muted-foreground text-[10px]">{v.airspace_name}</div>
                      {v.geofence_breach && <Badge variant="destructive" className="text-[9px] mt-1">GEO-FENCE BREACH</Badge>}
                    </td>
                    <td className="px-2 py-2 max-w-[260px] text-[11px]">{v.far_cited}</td>
                    <td className="px-2 py-2 max-w-[220px] text-[11px]">{v.reason}</td>
                    <td className="px-2 py-2 max-w-[200px] text-[11px] text-muted-foreground">{v.recommended_action}</td>
                    <td className="px-2 py-2 font-mono text-[10px] whitespace-nowrap">{new Date(v.detection_timestamp).toLocaleString()}</td>
                    <td className="px-2 py-2">
                      <Button size="sm" variant="ghost" onClick={() => generateFoia(v)} className="h-7 gap-1">
                        <FileText className="w-3 h-3" /> Draft
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-bold font-mono">{value}</div>
    </div>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

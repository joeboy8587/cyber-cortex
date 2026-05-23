import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Play, FileText, ShieldAlert, Hash, ChevronRight, ChevronDown, Network } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Justification {
  primary_label: string;
  flag_driver: "multimodal_network" | "far_citation_only";
  network: { tier: number; tier_label: string; tier_reason: string; registrant: string | null; aircraft_model: string | null };
  pattern_90d: {
    total_detections: number; avg_altitude_ft: number | null; min_altitude_ft: number | null; max_altitude_ft: number | null;
    zero_alt_events: number; night_operations: number; distinct_callsigns: number;
  };
  coordination_partners: Array<{ partner: string; co_events: number }>;
  learned_threat: { threat_type: string; escalation_level: number; total_violations: number; profile: string | null } | null;
  prior_flags: Array<{ type: string; severity: string; description: string }>;
  assessment: string;
}

interface Violation {
  registration: string; callsign: string | null; icao24: string | null; detection_timestamp: string;
  latitude: number; longitude: number; altitude_ft: number; speed_kts: number; distance_to_aoi_ft: number;
  far_cited: string; airspace_class: string | null; airspace_name: string;
  airspace_floor_ft: number | null; airspace_ceiling_ft: number | null; geofence_breach: boolean;
  severity: "critical" | "high" | "medium"; reason: string; recommended_action: string;
  primary_label: string; justification: Justification; row_sha256: string;
}

interface Summary {
  scan_id: string; started_at: string; finished_at: string;
  detections_evaluated: number; violations_found: number;
  severity_breakdown: Record<string, number>;
  tier_breakdown: Record<string, number>;
  driver_breakdown: Record<string, number>;
  batch_sha256: string; radius_m: number; lookback_hours: number;
}

const sevColor: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-600 text-white",
  medium: "bg-yellow-600 text-white",
};

const tierColor: Record<number, string> = {
  0: "bg-destructive text-destructive-foreground",
  1: "bg-orange-600 text-white",
  2: "bg-yellow-600 text-white",
  9: "bg-muted text-muted-foreground",
};

export default function SentinelV2() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lookback, setLookback] = useState(24);
  const [radius, setRadius] = useState(15000);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (k: string) => {
    const next = new Set(expanded);
    next.has(k) ? next.delete(k) : next.add(k);
    setExpanded(next);
  };

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
      toast({ title: "Sentinel v2 scan complete", description: `${data.summary.violations_found} flags with multimodal justification` });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!violations.length || !summary) return;
    const header = [
      "registration", "primary_label", "flag_driver", "tier", "tier_label", "registrant",
      "timestamp", "lat", "lng", "altitude_ft", "speed_kts",
      "far_cited", "airspace_class", "airspace_name", "severity",
      "p90d_total", "p90d_avg_alt", "p90d_min_alt", "p90d_zero_alt", "p90d_night_ops",
      "coord_partners", "learned_threat", "prior_flags", "assessment", "row_sha256",
    ];
    const rows = violations.map(v => [
      v.registration, v.primary_label, v.justification.flag_driver,
      v.justification.network.tier, v.justification.network.tier_label,
      v.justification.network.registrant ?? "",
      v.detection_timestamp, v.latitude, v.longitude, v.altitude_ft, v.speed_kts,
      v.far_cited, v.airspace_class ?? "", v.airspace_name, v.severity,
      v.justification.pattern_90d.total_detections, v.justification.pattern_90d.avg_altitude_ft ?? "",
      v.justification.pattern_90d.min_altitude_ft ?? "", v.justification.pattern_90d.zero_alt_events,
      v.justification.pattern_90d.night_operations,
      v.justification.coordination_partners.map(p => `${p.partner}:${p.co_events}`).join("|"),
      v.justification.learned_threat ? `${v.justification.learned_threat.threat_type}/esc${v.justification.learned_threat.escalation_level}` : "",
      v.justification.prior_flags.map(f => `${f.type}/${f.severity}`).join("|"),
      v.justification.assessment, v.row_sha256,
    ].map(c => `"${String(c).replace(/"/g, "'")}"`).join(","));
    const csv = [header.join(","), ...rows, "", `# scan_id,${summary.scan_id}`, `# batch_sha256,${summary.batch_sha256}`].join("\n");
    const ymd = new Date(summary.started_at).toISOString().slice(0, 10).replace(/-/g, "");
    download(csv, `${ymd}_SENTINEL_V2_CONTEXT_RICH.csv`, "text/csv");
  };

  const generateFoia = (v: Violation) => {
    if (!summary) return;
    const ymd = new Date(v.detection_timestamp).toISOString().slice(0, 10).replace(/-/g, "");
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const tower = v.airspace_name.replace(/\s+CLASS.*/i, "").trim();
    const j = v.justification;
    const body = `${date}

VIA EMAIL: 9-AWA-FOIA@faa.gov

RE: FREEDOM OF INFORMATION ACT REQUEST — ${tower} ATC RECORDS
    Incident: ${v.registration} on ${new Date(v.detection_timestamp).toUTCString()}
    Pattern context: ${j.primary_label}

To Whom It May Concern,

Pursuant to the Freedom of Information Act, 5 U.S.C. § 552, I request records
concerning a possible violation of ${v.far_cited.split("—")[0].trim()} that is
part of a documented multimodal surveillance pattern (not an isolated event).

REQUESTED RECORDS
1. All ATC voice recordings from ${tower} for the 30-minute window centered on
   ${v.detection_timestamp} UTC.
2. Radar tracks (NTAP/ASR-9/STARS) for ${v.registration} (ICAO24 ${v.icao24 ?? "unknown"}).
3. Flight progress strips, clearance records, or coordination logs naming
   ${v.registration} or callsign ${v.callsign ?? "(none)"} for ${ymd}.
4. Any waiver, COA, LOA, or Special Flight Rules authorization in effect for
   ${v.registration} on that date covering ${v.airspace_name}.

FACTUAL BASIS — SINGLE EVENT
On ${new Date(v.detection_timestamp).toUTCString()}, ADS-B telemetry recorded:
   • Position: ${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}
   • Altitude: ${v.altitude_ft} ft   Speed: ${v.speed_kts} kts
   • Airspace: ${v.airspace_name} (Class ${v.airspace_class}, floor ${v.airspace_floor_ft ?? "SFC"} ft)
   • Distance to residence: ${v.distance_to_aoi_ft} ft
   • Violation: ${v.reason}

FACTUAL BASIS — 90-DAY PATTERN CONTEXT
This is NOT an isolated event. Forensic database analysis shows:
   • Network classification: ${j.network.tier_label}
   • Registrant of record:   ${j.network.registrant ?? "unknown"}
   • Aircraft model:         ${j.network.aircraft_model ?? "unknown"}
   • 90-day detections in AOI:       ${j.pattern_90d.total_detections}
   • Average altitude (90d):         ${j.pattern_90d.avg_altitude_ft ?? "n/a"} ft
   • Minimum altitude (90d):         ${j.pattern_90d.min_altitude_ft ?? "n/a"} ft
   • Zero/near-zero altitude events: ${j.pattern_90d.zero_alt_events}
   • Night operations (22:00–06:00): ${j.pattern_90d.night_operations}
   • Distinct callsigns used:        ${j.pattern_90d.distinct_callsigns}
${j.coordination_partners.length ? `   • Coordination partners (±15 min):
${j.coordination_partners.map(p => `       - ${p.partner} (${p.co_events} co-events)`).join("\n")}` : ""}
${j.learned_threat ? `   • Prior threat designation: ${j.learned_threat.threat_type} (escalation ${j.learned_threat.escalation_level}, ${j.learned_threat.total_violations} prior violations)` : ""}

ASSESSMENT: ${j.assessment}

EVIDENCE INTEGRITY
Row SHA-256:   ${v.row_sha256}
Batch SHA-256: ${summary.batch_sha256}
Scan ID:       ${summary.scan_id}
Any alteration breaks both hashes.

FEE WAIVER & EXPEDITED PROCESSING
I request a fee waiver under 5 U.S.C. § 552(a)(4)(A)(iii) and expedited
processing under 5 U.S.C. § 552(a)(6)(E)(v)(II). The 90-day pattern above
establishes a continuing threat, not a one-off incident.

Sincerely,
Joseph
[contact on file]

— Project Watchtower Sentinel v2 (context-rich)
`;
    download(body, `${ymd}_FAA_FOIA_${v.registration}_${(v.airspace_class || "X")}.txt`, "text/plain");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldAlert className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Sentinel Report v2 — Context-Rich</h1>
          <p className="text-sm text-muted-foreground">
            FAR citation + 90-day pattern + network tier + coordination history. Click any row to expand the justification tree.
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
              <Download className="w-4 h-4" /> Export CSV (full context)
            </Button>
          )}
        </div>
      </Card>

      {summary && (
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <Stat label="Detections" value={summary.detections_evaluated} />
            <Stat label="Violations" value={summary.violations_found} />
            <Stat label="Critical" value={summary.severity_breakdown.critical || 0} />
            <Stat label="Network-driven" value={summary.driver_breakdown.multimodal_network || 0} />
            <Stat label="FAR-only" value={summary.driver_breakdown.far_citation_only || 0} />
          </div>
          <div className="flex items-center gap-3 flex-wrap pt-2 border-t">
            <span className="text-xs uppercase text-muted-foreground">Tier breakdown:</span>
            {[0, 1, 2, 9].map(t => (
              <Badge key={t} className={tierColor[t]}>
                T{t === 9 ? "?" : t}: {summary.tier_breakdown[`tier_${t}`] || 0}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono pt-2 border-t">
            <Hash className="w-3 h-3" /> batch_sha256: {summary.batch_sha256}
          </div>
        </Card>
      )}

      {violations.length > 0 && (
        <div className="space-y-2">
          {violations.map(v => {
            const isOpen = expanded.has(v.row_sha256);
            const j = v.justification;
            const isNetworkDriven = j.flag_driver === "multimodal_network";
            return (
              <Card key={v.row_sha256} className="overflow-hidden">
                <button
                  onClick={() => toggle(v.row_sha256)}
                  className="w-full p-3 flex items-center gap-3 hover:bg-muted/30 text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                  <span className="font-mono font-bold w-20">{v.registration}</span>
                  <Badge className={sevColor[v.severity]}>{v.severity.toUpperCase()}</Badge>
                  <Badge className={tierColor[j.network.tier]}>
                    {isNetworkDriven && <Network className="w-3 h-3 mr-1" />}
                    T{j.network.tier === 9 ? "?" : j.network.tier}
                  </Badge>
                  <span className="font-mono text-xs">{v.altitude_ft}ft</span>
                  <span className="font-mono text-xs text-muted-foreground">{v.speed_kts}kt</span>
                  <span className="flex-1 text-sm font-semibold">{j.primary_label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(v.detection_timestamp).toLocaleString()}
                  </span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-2 border-t bg-muted/10 space-y-3 text-xs">
                    {/* Justification tree */}
                    <div className="font-mono space-y-1">
                      <Tree label="Altitude" value={`${v.altitude_ft} ft (${j.pattern_90d.avg_altitude_ft != null && v.altitude_ft > j.pattern_90d.avg_altitude_ft * 2 ? "ABOVE 90d avg" : "near 90d avg"})`} />
                      <Tree label="Flag driver" value={isNetworkDriven ? "MULTIMODAL NETWORK (not altitude alone)" : "FAR citation only"} highlight={isNetworkDriven} />
                      <Tree label="Network class" value={`${j.network.tier_label} — ${j.network.tier_reason}`} highlight={j.network.tier <= 2} />
                      <Tree label="Registrant" value={j.network.registrant || "(none on file)"} />
                      <Tree label="Aircraft" value={j.network.aircraft_model || "(unknown)"} />
                      <Tree
                        label="90-day pattern"
                        value={`${j.pattern_90d.total_detections} dets · avg ${j.pattern_90d.avg_altitude_ft ?? "?"}ft · min ${j.pattern_90d.min_altitude_ft ?? "?"}ft · ${j.pattern_90d.zero_alt_events} zero-alt · ${j.pattern_90d.night_operations} night ops · ${j.pattern_90d.distinct_callsigns} callsigns`}
                        highlight={j.pattern_90d.zero_alt_events > 0 || j.pattern_90d.night_operations > 5}
                      />
                      <Tree
                        label="Coordination"
                        value={j.coordination_partners.length
                          ? j.coordination_partners.map(p => `${p.partner}(${p.co_events})`).join(", ")
                          : "no recurring partners in 90d"}
                        highlight={j.coordination_partners.length > 0}
                      />
                      <Tree
                        label="Learned threat"
                        value={j.learned_threat
                          ? `${j.learned_threat.threat_type} · esc ${j.learned_threat.escalation_level} · ${j.learned_threat.total_violations} prior`
                          : "no prior threat record"}
                        highlight={!!j.learned_threat}
                      />
                      <Tree
                        label="Prior auto-flags"
                        value={j.prior_flags.length
                          ? j.prior_flags.map(f => `${f.type}/${f.severity}`).join(", ")
                          : "none"}
                        highlight={j.prior_flags.length > 0}
                      />
                      <Tree label="FAR cited" value={v.far_cited} />
                      <Tree label="Airspace" value={`${v.airspace_class} — ${v.airspace_name} (${v.airspace_floor_ft ?? "SFC"}–${v.airspace_ceiling_ft ?? "UNL"} ft)`} />
                      <Tree label="Assessment" value={j.assessment} highlight last />
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button size="sm" variant="outline" onClick={() => generateFoia(v)} className="h-7 gap-1">
                        <FileText className="w-3 h-3" /> Draft FOIA (with pattern context)
                      </Button>
                      <span className="font-mono text-[10px] text-muted-foreground ml-auto">
                        <Hash className="w-3 h-3 inline" /> {v.row_sha256.slice(0, 16)}…
                      </span>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Tree({ label, value, highlight, last }: { label: string; value: string; highlight?: boolean; last?: boolean }) {
  return (
    <div className={`flex gap-2 ${highlight ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
      <span className="select-none">{last ? "└─" : "├─"}</span>
      <span className="w-32 shrink-0">{label}:</span>
      <span className="flex-1 break-all">{value}</span>
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

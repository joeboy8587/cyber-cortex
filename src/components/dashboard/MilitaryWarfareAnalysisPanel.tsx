import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Crosshair, Radio, Shield, Plane, AlertTriangle, Clock, MapPin } from "lucide-react";

const RESIDENCE = { lat: 35.437649, lng: -119.022639 };

type SkyHit = {
  hex: string;
  registration: string;
  callsign: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  event_time: string;
  taxonomy_tag?: string;
  threat_score?: number;
  is_flagged?: boolean;
  distance_km: number;
  time_delta_min: number;
  proximity_score: number;
};

type SkyResult = {
  center: { lat: number; lng: number };
  radiusKm: number;
  windowMin: number;
  anchor: string;
  summary: {
    totalOverhead: number;
    uniqueAircraft: number;
    militaryCount: number;
    kcsoCount: number;
    shellCount: number;
    lowAltCount: number;
  };
  hits: SkyHit[];
};

type MilResult = {
  summary: {
    usafSpoofCount: number;
    usafSpoofDetections: number;
    militaryCallsignCount: number;
    militaryCallsignDetections: number;
    hexCollisionCount: number;
    windowDays: number;
  };
  usafSpoof: any[];
  militaryCallsigns: any[];
  hexCollisions: any[];
};

function fmtDelta(min: number) {
  const m = Math.round(min * 10) / 10;
  return m >= 0 ? `+${m}m` : `${m}m`;
}

function tagColor(tag?: string): string {
  if (!tag) return "bg-muted text-muted-foreground";
  if (/tier0_kcso|kcso/i.test(tag)) return "bg-orange-600 text-white";
  if (/tier1_priority/i.test(tag)) return "bg-destructive text-destructive-foreground";
  if (/tier2_shell|shell/i.test(tag)) return "bg-purple-700 text-white";
  if (/military/i.test(tag)) return "bg-blue-700 text-white";
  if (/medical/i.test(tag)) return "bg-emerald-700 text-white";
  return "bg-muted text-muted-foreground";
}

export default function MilitaryWarfareAnalysisPanel() {
  // Sky timeline state
  const [timestamp, setTimestamp] = useState<string>("2026-04-25T03:27:00");
  const [windowMin, setWindowMin] = useState<number>(30);
  const [radiusKm, setRadiusKm] = useState<number>(25);
  const [skyLoading, setSkyLoading] = useState(false);
  const [sky, setSky] = useState<SkyResult | null>(null);
  const [skyError, setSkyError] = useState<string | null>(null);

  // Military analysis state
  const [milDays, setMilDays] = useState<number>(14);
  const [milLoading, setMilLoading] = useState(false);
  const [mil, setMil] = useState<MilResult | null>(null);
  const [milError, setMilError] = useState<string | null>(null);

  const runSkyTimeline = async () => {
    setSkyLoading(true);
    setSkyError(null);
    try {
      const isoTs = new Date(timestamp).toISOString();
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "skyTimelineCorrelator",
          timestamp: isoTs,
          windowMinutes: windowMin,
          centerLat: RESIDENCE.lat,
          centerLng: RESIDENCE.lng,
          radiusKm,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSky(data as SkyResult);
    } catch (e: any) {
      setSkyError(e?.message || "Query failed");
    }
    setSkyLoading(false);
  };

  const runMilitaryAnalysis = async () => {
    setMilLoading(true);
    setMilError(null);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "militaryHexAnalysis", days: milDays },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMil(data as MilResult);
    } catch (e: any) {
      setMilError(e?.message || "Query failed");
    }
    setMilLoading(false);
  };

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Crosshair className="h-5 w-5" />
          Military Warfare Analysis — Protocol 47B
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Sky-timeline correlator (event → overhead aircraft) + expanded military hex/callsign forensics.
          AOI center: <span className="font-mono">{RESIDENCE.lat}, {RESIDENCE.lng}</span> (residence).
        </p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="timeline">
          <TabsList className="mb-3">
            <TabsTrigger value="timeline" className="text-destructive">
              <Clock className="h-3 w-3 mr-1" /> Sky Timeline Correlator
            </TabsTrigger>
            <TabsTrigger value="military" className="text-blue-500">
              <Shield className="h-3 w-3 mr-1" /> Military Spectrum
            </TabsTrigger>
          </TabsList>

          {/* ============ TIMELINE TAB ============ */}
          <TabsContent value="timeline" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <Label className="text-xs">Anchor timestamp (local)</Label>
                <Input
                  type="datetime-local"
                  value={timestamp}
                  onChange={(e) => setTimestamp(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">± Window (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={windowMin}
                  onChange={(e) => setWindowMin(Number(e.target.value) || 30)}
                />
              </div>
              <div>
                <Label className="text-xs">Radius (km)</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value) || 25)}
                />
              </div>
              <Button onClick={runSkyTimeline} disabled={skyLoading} className="w-full">
                {skyLoading ? "Scanning sky..." : "⚡ Correlate Sky to Event"}
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Tip: paste a Facebook post timestamp here (or any biometric spike time). The query returns every aircraft within the radius
              during ±window, scored by proximity, time delta, altitude, and tactical tag.
            </p>

            {skyError && (
              <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                {skyError}
              </div>
            )}

            {sky && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  <Stat label="Detections" value={sky.summary.totalOverhead} />
                  <Stat label="Unique A/C" value={sky.summary.uniqueAircraft} />
                  <Stat label="Military" value={sky.summary.militaryCount} tone="blue" />
                  <Stat label="KCSO" value={sky.summary.kcsoCount} tone="orange" />
                  <Stat label="Shell" value={sky.summary.shellCount} tone="purple" />
                  <Stat label="<2000ft" value={sky.summary.lowAltCount} tone="red" />
                </div>

                <div className="overflow-auto max-h-[480px] rounded border border-border/50">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Score</th>
                        <th className="p-2 text-left">Δt</th>
                        <th className="p-2 text-left">Reg</th>
                        <th className="p-2 text-left">Hex</th>
                        <th className="p-2 text-left">Callsign</th>
                        <th className="p-2 text-right">Alt (ft)</th>
                        <th className="p-2 text-right">Speed</th>
                        <th className="p-2 text-right">Dist (km)</th>
                        <th className="p-2 text-left">Class</th>
                        <th className="p-2 text-left">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sky.hits.map((h, i) => (
                        <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="p-2">
                            <Badge variant={h.proximity_score > 100 ? "destructive" : "outline"} className="font-mono">
                              {h.proximity_score}
                            </Badge>
                          </td>
                          <td className="p-2 font-mono">{fmtDelta(h.time_delta_min)}</td>
                          <td className="p-2 font-mono">{h.registration || "—"}</td>
                          <td className="p-2 font-mono text-muted-foreground">{h.hex || "—"}</td>
                          <td className="p-2 font-mono">{h.callsign || "—"}</td>
                          <td className="p-2 text-right font-mono">
                            <span className={h.altitude > 0 && h.altitude < 2000 ? "text-destructive font-bold" : ""}>
                              {h.altitude || 0}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono">{h.speed || 0}</td>
                          <td className="p-2 text-right font-mono">{Number(h.distance_km).toFixed(1)}</td>
                          <td className="p-2">
                            {h.taxonomy_tag ? (
                              <Badge className={tagColor(h.taxonomy_tag)}>{h.taxonomy_tag}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="p-2 text-muted-foreground">{new Date(h.event_time).toLocaleString()}</td>
                        </tr>
                      ))}
                      {sky.hits.length === 0 && (
                        <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">No aircraft within {sky.radiusKm}km / ±{sky.windowMin}min of anchor.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ============ MILITARY TAB ============ */}
          <TabsContent value="military" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label className="text-xs">Lookback window (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={milDays}
                  onChange={(e) => setMilDays(Number(e.target.value) || 30)}
                />
              </div>
              <div className="md:col-span-2">
                <Button onClick={runMilitaryAnalysis} disabled={milLoading} className="w-full">
                  {milLoading ? "Scanning military spectrum..." : "🛡️ Run Military Hex / Callsign / Collision Scan"}
                </Button>
              </div>
            </div>

            {milError && (
              <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                {milError}
              </div>
            )}

            {mil && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <Stat label="USAF Spoofs" value={mil.summary.usafSpoofCount} tone="red" />
                  <Stat label="Spoof Detect." value={mil.summary.usafSpoofDetections} tone="red" />
                  <Stat label="Mil Callsigns" value={mil.summary.militaryCallsignCount} tone="blue" />
                  <Stat label="Callsign Det." value={mil.summary.militaryCallsignDetections} tone="blue" />
                  <Stat label="Hex Collisions" value={mil.summary.hexCollisionCount} tone="purple" />
                </div>

                {/* USAF Spoofing */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      USAF/DOD Hex Spoofing — Civilian regs broadcasting AE/AF hex range
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-auto max-h-72">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Hex (mil)</th>
                            <th className="p-2 text-left">Reg (civ)</th>
                            <th className="p-2 text-left">Callsign</th>
                            <th className="p-2 text-right">Detections</th>
                            <th className="p-2 text-right">Avg Alt</th>
                            <th className="p-2 text-left">First → Last</th>
                            <th className="p-2 text-left">Tag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mil.usafSpoof.map((r: any, i: number) => (
                            <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                              <td className="p-2 font-mono text-destructive font-bold">{r.hex}</td>
                              <td className="p-2 font-mono">{r.registration}</td>
                              <td className="p-2 font-mono text-muted-foreground">{r.callsign || "—"}</td>
                              <td className="p-2 text-right font-mono">{r.detections}</td>
                              <td className="p-2 text-right font-mono">{r.avg_altitude || 0}</td>
                              <td className="p-2 text-muted-foreground">
                                {new Date(r.first_seen).toLocaleDateString()} → {new Date(r.last_seen).toLocaleDateString()}
                              </td>
                              <td className="p-2">
                                {r.taxonomy_tag && <Badge className={tagColor(r.taxonomy_tag)}>{r.taxonomy_tag}</Badge>}
                              </td>
                            </tr>
                          ))}
                          {mil.usafSpoof.length === 0 && (
                            <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No USAF hex spoofing detected in window.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Military Callsigns */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Radio className="h-4 w-4 text-blue-500" />
                      Military Callsign Roster (RCH/KOME/SHADY/PAT/REACH/SAM/TRON/STMPD/…)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-auto max-h-72">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Callsign</th>
                            <th className="p-2 text-right">Detections</th>
                            <th className="p-2 text-right"># Hex</th>
                            <th className="p-2 text-right"># Reg</th>
                            <th className="p-2 text-right">Avg Alt</th>
                            <th className="p-2 text-left">First → Last</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mil.militaryCallsigns.map((r: any, i: number) => (
                            <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                              <td className="p-2 font-mono text-blue-500 font-bold">{r.callsign}</td>
                              <td className="p-2 text-right font-mono">{r.detections}</td>
                              <td className="p-2 text-right font-mono">{r.unique_hex}</td>
                              <td className="p-2 text-right font-mono">{r.unique_reg}</td>
                              <td className="p-2 text-right font-mono">{r.avg_altitude || 0}</td>
                              <td className="p-2 text-muted-foreground">
                                {new Date(r.first_seen).toLocaleDateString()} → {new Date(r.last_seen).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                          {mil.militaryCallsigns.length === 0 && (
                            <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">No military callsigns detected.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Hex Collisions */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Plane className="h-4 w-4 text-purple-500" />
                      Hex Collision Exhibits — Single hex shared by ≥2 distinct registrations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-auto max-h-96">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="p-2 text-left">Hex</th>
                            <th className="p-2 text-right"># Regs</th>
                            <th className="p-2 text-right">Total Det.</th>
                            <th className="p-2 text-left">Registrations</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mil.hexCollisions.map((r: any, i: number) => (
                            <tr key={i} className="border-b border-border/30 hover:bg-muted/30 align-top">
                              <td className="p-2 font-mono text-purple-500 font-bold">{r.hex}</td>
                              <td className="p-2 text-right">
                                <Badge variant="destructive" className="font-mono">{r.distinct_regs}</Badge>
                              </td>
                              <td className="p-2 text-right font-mono">{r.total_detections}</td>
                              <td className="p-2">
                                <div className="flex flex-wrap gap-1">
                                  {(r.registrations || []).map((p: any, j: number) => (
                                    <Badge key={j} variant="outline" className="font-mono text-[10px]">
                                      {p.registration} ({p.detections})
                                    </Badge>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                          {mil.hexCollisions.length === 0 && (
                            <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No hex collisions detected.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "red" | "blue" | "orange" | "purple" }) {
  const toneCls =
    tone === "red" ? "border-destructive/40 text-destructive" :
    tone === "blue" ? "border-blue-500/40 text-blue-500" :
    tone === "orange" ? "border-orange-500/40 text-orange-500" :
    tone === "purple" ? "border-purple-500/40 text-purple-500" :
    "border-border text-foreground";
  return (
    <div className={`rounded border bg-background/40 p-2 text-center ${toneCls}`}>
      <div className="text-lg font-bold font-mono">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

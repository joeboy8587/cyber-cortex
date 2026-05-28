import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Radar, Moon, Repeat, Crosshair, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface DarknessRow {
  tail: string;
  night_total: number;
  night_masked: number;
  day_total: number;
  day_masked: number;
  night_mask_rate: number;
  day_mask_rate: number;
  evasion_delta: number;
  classification: string;
}
interface HandoffRow {
  departing_tail: string;
  arriving_tail: string;
  depart_ts: string;
  arrive_ts: string;
  gap_seconds: number;
  confidence: number;
}
interface RelayPair { pair: string; count: number; avg_gap_seconds: number }
interface ScanResult {
  generated_at: string;
  lookbackDays: number;
  darknessAudit?: { threshold: number; sample_tails_evaluated: number; flagged: number; top_offenders: DarknessRow[] };
  tacticalHandoffs?: { primary_zone_mi: number; handoff_window_minutes: number; handoffs_found: number; recent_handoffs: HandoffRow[]; top_relay_pairs: RelayPair[] };
  deepDive?: {
    tail: string; leaked_altitude_pings: number; aggressive_proximity_pings: number;
    classification: string;
    faa_identity: any;
    rooftop_geometry_sample: Array<{ detection_timestamp: string; distance_mi: number; altitude: number; ft_per_mile_ratio: number }>;
    night_masking_hot_hours: Array<{ hour_block: string; total: number; masked: number }>;
  };
  faaEnrichment?: { distinct_tails: number; regs_matched: number; mismatches: number; ghosts: number; match_rate: number; error?: string };
}

const classColor = (c: string) =>
  c === "INTENTIONAL_EVASION_SIGNATURE" || c === "TACTICAL_STANDOFF_GEOMETRY_CONFIRMED"
    ? "bg-destructive text-destructive-foreground"
    : c === "SUSPICIOUS_NIGHT_MASKING"
    ? "bg-orange-500/80 text-white"
    : "bg-muted text-muted-foreground";

export function Watchtower22Panel() {
  const [loading, setLoading] = useState(false);
  const [lookback, setLookback] = useState(14);
  const [target, setTarget] = useState("N720CA");
  const [result, setResult] = useState<ScanResult | null>(null);

  const run = async () => {
    setLoading(true); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("watchtower-22", {
        body: { action: "runAll", lookbackDays: lookback, targetTail: target },
      });
      if (error) throw error;
      setResult(data?.data || null);
      toast.success("Watchtower 2.2 scan complete");
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url; a.download = `${stamp}_WATCHTOWER22_SCAN.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-cyan-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-cyan-400">
          <Radar className="w-5 h-5" />
          Watchtower 2.2 — Darkness Audit · Handoff Detector · Deep Dive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Lookback (days)</Label>
            <Input type="number" min={1} max={90} value={lookback}
                   onChange={(e) => setLookback(Number(e.target.value) || 14)} className="w-24" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Deep-Dive Target Tail</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} className="w-32 font-mono" />
          </div>
          <Button onClick={run} disabled={loading} className="bg-cyan-600 hover:bg-cyan-700">
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Radar className="w-4 h-4 mr-2" />}
            Run Watchtower 2.2 Scan
          </Button>
          {result && (
            <Button variant="outline" onClick={exportJson}>
              <Download className="w-4 h-4 mr-2" /> Export JSON
            </Button>
          )}
        </div>

        {result?.faaEnrichment && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <Stat label="FAA Match Rate" value={`${Math.round((result.faaEnrichment.match_rate || 0) * 100)}%`} />
            <Stat label="Distinct Tails" value={result.faaEnrichment.distinct_tails} />
            <Stat label="FAA Matched" value={result.faaEnrichment.regs_matched} />
            <Stat label="ICAO↔FAA Mismatches" value={result.faaEnrichment.mismatches} tone="warn" />
            <Stat label="Ghosts / Unregistered" value={result.faaEnrichment.ghosts} tone="warn" />
          </div>
        )}

        {/* DARKNESS AUDIT */}
        {result?.darknessAudit && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
              <Moon className="w-4 h-4" /> Darkness Ratio Auditor — {result.darknessAudit.flagged} flagged of {result.darknessAudit.sample_tails_evaluated} evaluated
            </h3>
            <ScrollArea className="h-64 rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr><th className="text-left p-2">Tail</th><th className="p-2">Night Mask</th><th className="p-2">Day Mask</th><th className="p-2">Δ</th><th className="text-left p-2">Classification</th></tr>
                </thead>
                <tbody>
                  {result.darknessAudit.top_offenders.map((r) => (
                    <tr key={r.tail} className="border-t border-border">
                      <td className="p-2 font-mono">{r.tail}</td>
                      <td className="p-2 text-center">{(r.night_mask_rate * 100).toFixed(0)}% <span className="text-muted-foreground">({r.night_masked}/{r.night_total})</span></td>
                      <td className="p-2 text-center">{(r.day_mask_rate * 100).toFixed(0)}% <span className="text-muted-foreground">({r.day_masked}/{r.day_total})</span></td>
                      <td className="p-2 text-center font-mono">+{(r.evasion_delta * 100).toFixed(0)}%</td>
                      <td className="p-2"><Badge className={classColor(r.classification)}>{r.classification.replace(/_/g, " ")}</Badge></td>
                    </tr>
                  ))}
                  {result.darknessAudit.top_offenders.length === 0 && (
                    <tr><td className="p-3 text-center text-muted-foreground" colSpan={5}>No tails exceeded the 20% night-vs-day delta in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </section>
        )}

        {/* TACTICAL HANDOFFS */}
        {result?.tacticalHandoffs && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
              <Repeat className="w-4 h-4" /> Tactical Handoff Detector — {result.tacticalHandoffs.handoffs_found} handoffs in last {result.lookbackDays}d ({result.tacticalHandoffs.primary_zone_mi.toFixed(2)} mi zone)
            </h3>
            {result.tacticalHandoffs.top_relay_pairs.length > 0 && (
              <div className="rounded border border-border p-2">
                <div className="text-xs font-semibold mb-1 text-muted-foreground">Top Relay Shifts</div>
                <div className="flex flex-wrap gap-2">
                  {result.tacticalHandoffs.top_relay_pairs.map((p) => (
                    <Badge key={p.pair} variant="outline" className="font-mono text-xs">
                      {p.pair} ×{p.count} · avg {p.avg_gap_seconds}s
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <ScrollArea className="h-48 rounded border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr><th className="text-left p-2">Departing</th><th className="text-left p-2">Arriving</th><th className="p-2">Gap</th><th className="p-2">Confidence</th><th className="text-left p-2">When</th></tr>
                </thead>
                <tbody>
                  {result.tacticalHandoffs.recent_handoffs.map((h, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 font-mono">{h.departing_tail}</td>
                      <td className="p-2 font-mono">{h.arriving_tail}</td>
                      <td className="p-2 text-center">{h.gap_seconds}s</td>
                      <td className="p-2 text-center">{(h.confidence * 100).toFixed(0)}%</td>
                      <td className="p-2 text-muted-foreground">{new Date(h.depart_ts).toLocaleString()}</td>
                    </tr>
                  ))}
                  {result.tacticalHandoffs.recent_handoffs.length === 0 && (
                    <tr><td className="p-3 text-center text-muted-foreground" colSpan={5}>No tactical handoffs detected in this window.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </section>
        )}

        {/* DEEP DIVE */}
        {result?.deepDive && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
              <Crosshair className="w-4 h-4" /> Deep Dive · {result.deepDive.tail}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className={classColor(result.deepDive.classification)}>{result.deepDive.classification.replace(/_/g, " ")}</Badge>
              <span className="text-muted-foreground">Leaked-altitude pings: <b className="text-foreground">{result.deepDive.leaked_altitude_pings}</b></span>
              <span className="text-muted-foreground">Rooftop-geometry pings: <b className="text-foreground">{result.deepDive.aggressive_proximity_pings}</b></span>
              {result.deepDive.faa_identity?.registrant_name && (
                <span className="text-muted-foreground">FAA: <b className="text-foreground">{result.deepDive.faa_identity.registrant_name}</b> · {result.deepDive.faa_identity.aircraft_model}</span>
              )}
            </div>
            {result.deepDive.rooftop_geometry_sample.length > 0 && (
              <ScrollArea className="h-40 rounded border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr><th className="text-left p-2">When</th><th className="p-2">Altitude (ft)</th><th className="p-2">Distance (mi)</th><th className="p-2">ft/mi (lower = closer recon)</th></tr>
                  </thead>
                  <tbody>
                    {result.deepDive.rooftop_geometry_sample.map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="p-2">{new Date(p.detection_timestamp).toLocaleString()}</td>
                        <td className="p-2 text-center">{Math.round(p.altitude)}</td>
                        <td className="p-2 text-center">{p.distance_mi?.toFixed(2)}</td>
                        <td className="p-2 text-center font-mono text-destructive">{Math.round(p.ft_per_mile_ratio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </section>
        )}

        {!result && !loading && (
          <p className="text-xs text-muted-foreground">
            Runs three modules together: night-vs-day mask comparison, primary-zone aircraft relay detection, and a focused deep-dive on the target tail. Backed by FAA-enriched detections.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" }) {
  return (
    <div className={`rounded border p-2 ${tone === "warn" ? "border-orange-500/40 bg-orange-500/5" : "border-border"}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-mono">{value}</div>
    </div>
  );
}

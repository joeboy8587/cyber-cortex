import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertOctagon, Play } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ScanResult {
  ok: boolean;
  source_table?: string;
  scanned?: number;
  violations_generated?: number;
  inserted?: number;
  borderline?: number;
  cleared_after_agl?: number;
  terrain_unknown?: number;
  complete?: boolean;
  issues?: string[];
  capped?: boolean;
  samples?: Array<{ registration: string | null; icao: string | null; msl_reported_ft: number;
    agl: { terrain_ft: number | null; agl_ft: number | null; margin_ft: number; altitude_source: string }; status: string }>;
}

/**
 * FAR Classifier Panel — runs the sub-1000ft FAR classifier over recent
 * detections and writes citations into policy_violations. Non-technical UI:
 * one button, clear status.
 */
export function FARClassifierPanel() {
  const [running, setRunning] = useState(false);
  const [hours, setHours] = useState(24);
  const [result, setResult] = useState<ScanResult | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("far-classifier", {
        body: { action: "scan", lookbackHours: hours, limit: 600 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "No scan result returned");
      setResult(data as ScanResult);
      if (data.complete === false) toast.warning(`FAR scan partial — ${data.inserted ?? 0} findings saved; open checks shown below`);
      else toast.success(`FAR scan complete — ${data.inserted ?? 0} new findings saved`);
    } catch (e: any) {
      toast.error(`FAR scan failed: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertOctagon className="w-5 h-5" />
          FAR Low-Altitude Classifier — 14 CFR Part 91
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Flight feeds report height above sea level, but the FAA rules use height above the ground.
          Original MSL · local pressure correction when available · ground elevation · calculated AGL.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs font-mono">Lookback (hours)</Label>
            <Input
              type="number"
              min={1}
              max={720}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 24)}
              className="w-28"
            />
          </div>
          <Button onClick={run} disabled={running} variant="destructive">
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Run FAR Scan
          </Button>
          {result && (
            <div className="flex flex-wrap gap-2 text-xs font-mono">
              <Badge variant="outline">source: {result.source_table || "n/a"}</Badge>
              <Badge variant="outline">scanned: {result.scanned ?? 0}</Badge>
              <Badge variant="secondary">low-flight findings: {result.violations_generated ?? 0}</Badge>
              <Badge variant="destructive">inserted: {result.inserted ?? 0}</Badge>
              <Badge variant="outline">borderline (not filed): {result.borderline ?? 0}</Badge>
              <Badge variant="outline">cleared once ground height applied: {result.cleared_after_agl ?? 0}</Badge>
              {!!result.terrain_unknown && <Badge variant="outline">ground height unavailable: {result.terrain_unknown}</Badge>}
            </div>
          )}
        </div>

        {result && (result.complete === false || result.capped) && <div role="status" className="border-l-2 border-warning pl-3 text-sm text-warning">
          <b>Partial scan — saved findings retained.</b>
          {result.capped && <p>Latest 600 observations in the selected window; not the full archive.</p>}
          {result.issues?.map(issue => <p key={issue}>{issue}</p>)}
        </div>}
        {!!result?.samples?.length && <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <caption className="text-left text-muted-foreground pb-2">Recent sightings · lowest reported altitude first · feet · original altitude unchanged</caption>
            <thead><tr className="border-b"><th className="text-left p-2">Aircraft</th><th className="text-right p-2">Original MSL</th><th className="text-right p-2">Ground</th><th className="text-right p-2">AGL</th><th className="text-right p-2">Allowance ±</th><th className="text-left p-2">Pressure</th></tr></thead>
            <tbody>{result.samples.map((s, i) => <tr key={`${s.icao}-${i}`} className="border-b">
              <td className="p-2">{s.registration || s.icao || "—"}</td><td className="p-2 text-right">{s.msl_reported_ft}</td>
              <td className="p-2 text-right">{s.agl.terrain_ft ?? "Unavailable"}</td><td className="p-2 text-right font-semibold">{s.agl.agl_ft ?? "Unknown"}</td>
              <td className="p-2 text-right">{s.agl.margin_ft}</td><td className="p-2">{s.agl.altitude_source === "baro_qnh_corrected" ? "Corrected" : "Uncorrected"}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <div className="border-t pt-3 text-xs font-mono space-y-1">
          <div className="font-semibold text-destructive">FAA rule checks</div>
          <div>· <a href="https://www.ecfr.gov/current/title-14/section-91.119" target="_blank" rel="noreferrer" className="underline"><b>91.119(b) / (c)</b></a> — 1,000 ft above obstacles in congested areas; 500 ft surface/separation provisions elsewhere</div>
          <div>· <b>91.119(d)</b> — helicopter provisions; low flights remain visible for hazard and route checks</div>
          <div>· <b>91.119</b> — necessary takeoff/landing and obstacle context remain open checks</div>
          <div>· <b>91.13 / 91.155 / 91.209</b> — endangerment, weather and lighting require their own observations</div>
          <div>· <b>91.117</b> — indicated airspeed, not ADS-B ground speed</div>
        </div>
      </CardContent>
    </Card>
  );
}

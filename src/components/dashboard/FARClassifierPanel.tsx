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
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("far-classifier", {
        body: { action: "scan", lookbackHours: hours, limit: 1000 },
      });
      if (error) throw error;
      setResult(data as ScanResult);
      toast.success(`FAR scan complete — ${data?.inserted ?? 0} new violations`);
    } catch (e: any) {
      toast.error(`FAR scan failed: ${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-red-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-500">
          <AlertOctagon className="w-5 h-5" />
          FAR Low-Altitude Classifier — 14 CFR Part 91
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Any aircraft below 1000 ft is routed through the FAA regulations table and cited
          under 91.119, 91.13, 91.155, or 91.209. Strict rule — no exclusions.
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
              <Badge variant="secondary">violations: {result.violations_generated ?? 0}</Badge>
              <Badge variant="destructive">inserted: {result.inserted ?? 0}</Badge>
            </div>
          )}
        </div>

        <div className="rounded border p-3 bg-muted/20 text-xs font-mono space-y-1">
          <div className="font-semibold text-red-500">Citations applied</div>
          <div>· <b>91.119(c)</b> — altitude &lt; 500 ft</div>
          <div>· <b>91.119(b)</b> — &lt; 1000 ft over congested area (Oildale AOI, 3 nm radius)</div>
          <div>· <b>91.119(a)</b> — general minimum-safe-altitude fallback</div>
          <div>· <b>91.13</b> — careless/reckless (stacked when 2+ violations present)</div>
          <div>· <b>91.209</b> — night operation escalates severity one tier</div>
        </div>
      </CardContent>
    </Card>
  );
}

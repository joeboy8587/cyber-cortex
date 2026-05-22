import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Shield, MapPin, AlertTriangle, Plane, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RunSummary {
  scan_id: string;
  detections_in_aoi: number;
  unique_aircraft: number;
  registry_matches: number;
  flags_generated: number;
  flags_inserted: number;
  severity_breakdown: Record<string, number>;
  rule_breakdown: Record<string, number>;
}

interface Flag {
  flag_type: string;
  severity: string;
  registration: string;
  description: string;
  confidence_score: number;
  evidence_summary: any;
}

const sevColor = (s: string) =>
  s === "critical" ? "bg-destructive/20 text-destructive border-destructive/40"
    : s === "high" ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";

export default function FAARulesGeofencePanel() {
  const [running, setRunning] = useState(false);
  const [lookback, setLookback] = useState(24);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);

  const run = async (dryRun = false) => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("faa-rules-geofence", {
        body: { lookback_hours: lookback, dry_run: dryRun },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Scan failed");
      setSummary(data.summary);
      setFlags(data.flags || []);
      toast.success(
        `${dryRun ? "Audit" : "Scan"} complete — ${data.summary.flags_generated} flags across ${data.summary.unique_aircraft} aircraft`
      );
    } catch (e: any) {
      toast.error(e.message || "FAA rules scan failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="border-primary/30 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="font-mono text-sm uppercase tracking-wider flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          FAA Rules &amp; Geofence Engine
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          14 CFR Part 91 violations + AOI geofence (2.5 km / 1 km critical) around residence.
          Joins detections with FAA registry to enrich operator + foreign-registrant analysis.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-mono text-muted-foreground">Lookback (hours):</label>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono"
            disabled={running}
          >
            {[6, 12, 24, 48, 72, 168].map(h => <option key={h} value={h}>{h}h</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => run(true)} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <MapPin className="h-3 w-3 mr-1" />}
            Audit Only
          </Button>
          <Button size="sm" onClick={() => run(false)} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Shield className="h-3 w-3 mr-1" />}
            Run &amp; Persist Flags
          </Button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Stat label="Detections in AOI" value={summary.detections_in_aoi.toLocaleString()} />
            <Stat label="Unique Aircraft" value={summary.unique_aircraft} />
            <Stat label="FAA Registry Matched" value={summary.registry_matches} />
            <Stat label="Flags" value={summary.flags_generated} highlight={summary.flags_generated > 0} />
          </div>
        )}

        {summary && Object.keys(summary.rule_breakdown).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(summary.rule_breakdown).map(([k, v]) => (
              <Badge key={k} variant="outline" className="font-mono text-[10px]">
                {k}: {v}
              </Badge>
            ))}
          </div>
        )}

        {flags.length > 0 && (
          <ScrollArea className="h-72 border border-border rounded">
            <div className="p-2 space-y-1.5">
              {flags.map((f, i) => (
                <div key={i} className={`p-2 rounded border ${sevColor(f.severity)}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="font-mono text-[10px] uppercase font-bold">{f.severity}</span>
                    <span className="font-mono text-xs">{f.flag_type}</span>
                    <Plane className="h-3 w-3 ml-auto" />
                    <span className="font-mono text-xs font-bold">{f.registration}</span>
                    <Badge variant="outline" className="text-[10px]">{f.confidence_score}%</Badge>
                  </div>
                  <p className="text-xs text-foreground/90">{f.description}</p>
                  {f.evidence_summary?.statute && (
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                      📖 {f.evidence_summary.statute}
                      {f.evidence_summary.operator && ` • ${f.evidence_summary.operator}`}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {summary && flags.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border border-border rounded">
            <CheckCircle className="h-4 w-4 text-chart-4" />
            No FAA / geofence violations detected in this window.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className={`p-2 rounded border ${highlight ? "border-destructive/40 bg-destructive/10" : "border-border bg-background/50"}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-mono text-lg font-bold">{value}</div>
    </div>
  );
}

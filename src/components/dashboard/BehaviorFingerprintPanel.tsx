import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Radar, PlaneTakeoff, PlaneLanding, CircleDot, Pause, MoveRight, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SessionRow {
  key: string; id: string; callsign: string | null;
  start: string; end: string; duration_min: number; pings: number;
  behavior: string; airport_consistent: boolean;
  cum_turn_deg: number; bbox_radius_nm: number; alt_change_ft: number | null;
  avg_speed_kts: number | null; min_dist_kbfl_nm: number; min_dist_aoi_nm: number;
  max_alt: number | null; min_alt: number | null;
}
interface Stats {
  window_days: number; total_detections: number; aircraft_seen: number; sessions: number;
  behavior_counts: Record<string, number>;
  airport_consistent_sessions: number; anomalous_sessions: number;
  anomalous: SessionRow[]; skipped: string[];
}
interface Result { stats: Stats; sha256: string; narrative: string; provider: string; }

const BEHAVIOR_META: Record<string, { label: string; icon: typeof PlaneLanding; tone: string }> = {
  LANDING: { label: "Landing", icon: PlaneLanding, tone: "text-green-500" },
  DEPARTURE: { label: "Departure", icon: PlaneTakeoff, tone: "text-green-500" },
  TRANSIT: { label: "Passing through", icon: MoveRight, tone: "text-muted-foreground" },
  ORBIT: { label: "Tight circles", icon: CircleDot, tone: "text-orange-500" },
  HOVER: { label: "Hovering", icon: Pause, tone: "text-red-500" },
  LOITER: { label: "Loitering", icon: AlertTriangle, tone: "text-yellow-500" },
};

export function BehaviorFingerprintPanel() {
  const [days, setDays] = useState("7");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("behavior-fingerprint", {
        body: { days: Number(days) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data as Result);
      toast.success("Behavior analysis complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  const s = result?.stats;
  const counts = s?.behavior_counts ?? {};
  const behaviors = ["LANDING", "DEPARTURE", "TRANSIT", "ORBIT", "HOVER", "LOITER"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="h-5 w-5" /> Behavior Fingerprint — Airport Traffic vs. Everything Else
        </CardTitle>
        <CardDescription>
          Classifies each aircraft by <em>how it flies</em>: a real landing is a steady descent toward Meadows Field;
          tight circles, hovering, and long loitering near your home are flagged separately. No technical knowledge needed — press run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="3">Last 3 days</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={run} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Run behavior analysis
          </Button>
        </div>

        {s && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-bold">{s.aircraft_seen.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">aircraft seen</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-bold">{s.sessions.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">flight sessions</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-bold text-green-500">{s.airport_consistent_sessions.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">look like airport traffic</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-bold text-orange-500">{s.anomalous_sessions.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">don't match airport behavior</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {behaviors.map((b) => {
                const meta = BEHAVIOR_META[b];
                const Icon = meta.icon;
                return (
                  <Badge key={b} variant="outline" className="gap-1.5 py-1">
                    <Icon className={`h-3.5 w-3.5 ${meta.tone}`} />
                    {meta.label}: {counts[b] ?? 0}
                  </Badge>
                );
              })}
            </div>

            {s.anomalous.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Sessions that don't match airport behavior (closest to home first)</h4>
                <div className="rounded-lg border overflow-auto max-h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Aircraft</TableHead>
                        <TableHead>Behavior</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead className="text-right">Minutes</TableHead>
                        <TableHead className="text-right">Closest to home</TableHead>
                        <TableHead className="text-right">Turn total</TableHead>
                        <TableHead className="text-right">Alt range</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.anomalous.map((row) => {
                        const meta = BEHAVIOR_META[row.behavior] ?? BEHAVIOR_META.TRANSIT;
                        return (
                          <TableRow key={row.key}>
                            <TableCell className="font-mono font-semibold">{row.id}</TableCell>
                            <TableCell><span className={meta.tone}>{meta.label}</span></TableCell>
                            <TableCell className="text-xs">{new Date(row.start).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })}</TableCell>
                            <TableCell className="text-right">{row.duration_min}</TableCell>
                            <TableCell className="text-right">{row.min_dist_aoi_nm} NM</TableCell>
                            <TableCell className="text-right">{row.cum_turn_deg}°</TableCell>
                            <TableCell className="text-right text-xs">
                              {row.min_alt ?? "?"}–{row.max_alt ?? "?"} ft
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {result.narrative && (
              <div className="rounded-lg border bg-muted/40 p-4">
                <h4 className="text-sm font-semibold mb-2">What this means (plain language)</h4>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{result.narrative}</p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Fingerprint: <span className="font-mono">{result.sha256.slice(0, 16)}…</span> · {s.window_days}-day window · {s.total_detections.toLocaleString()} detections analyzed
              {s.skipped.length > 0 && ` · skipped: ${s.skipped.join(", ")}`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

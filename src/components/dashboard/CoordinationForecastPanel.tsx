import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Cpu, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

export function CoordinationForecastPanel() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("coordination-forecast", { body: { days } });
      if (error) throw error;
      if (res?.error) throw new Error(res.error);
      setData(res);
      toast.success("Forecast ready");
    } catch (e: any) {
      toast.error(`Forecast failed: ${e.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stamp}_POSSE_FORECAST_coordination_${days}d.json`;
    a.click();
  };

  const s = data?.stats;
  const maxHours = s ? Math.max(1, ...s.sectors.map((x: any) => x.active_hours ?? 0)) : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-primary" /> NVIDIA Coordination Forecast & Control Sectors
        </CardTitle>
        <div className="flex items-center gap-2">
          {[14, 30, 90].map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
          <Button size="sm" onClick={run} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run forecast"}
          </Button>
          {data && (
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!data && !loading && (
          <p className="text-muted-foreground">
            Compares your home area against 4 similar Kern County areas, finds the hours military and KCSO/shell aircraft
            usually appear, and measures how often a local aircraft shows up within 60 minutes of a military flight.
          </p>
        )}
        {loading && <p className="text-muted-foreground">Crunching flight history… this can take up to a minute.</p>}

        {s && (
          <>
            <div>
              <div className="mb-2 font-medium">Low-altitude activity (active hours below 2,000 ft, 1.5 NM radius)</div>
              <div className="space-y-1">
                {s.sectors.map((x: any) => (
                  <div key={x.key} className="flex items-center gap-2">
                    <span className="w-44 shrink-0 truncate">{x.name}</span>
                    <div className="h-3 flex-1 rounded bg-muted">
                      <div
                        className={`h-3 rounded ${x.control ? "bg-muted-foreground" : "bg-destructive"}`}
                        style={{ width: `${((x.active_hours ?? 0) / maxHours) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 text-right tabular-nums">
                      {x.active_hours == null ? "timed out" : `${x.active_hours} hrs · ${x.unique_aircraft} ac`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline">Ratio vs controls: {s.specificity_ratio ?? "n/a"}×</Badge>
                <Badge variant="outline">
                  p-value: {s.poisson_p_value == null ? "n/a" : s.poisson_p_value < 0.0001 ? "< 0.0001" : s.poisson_p_value.toFixed(4)}
                </Badge>
                <Badge variant="outline">Window total: {s.total_detections_in_window?.toLocaleString() ?? "n/a"} detections</Badge>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {[["Military windows", s.military_windows], ["KCSO / shell windows", s.local_windows]].map(([t, w]: any) => (
                <div key={t}>
                  <div className="mb-1 font-medium">{t}</div>
                  {w.length === 0 ? (
                    <p className="text-muted-foreground">No sightings in window.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {w.map((x: any, i: number) => (
                        <li key={i} className="flex justify-between tabular-nums">
                          <span>{DAYS[x.dow]} {fmtHour(x.hour)}</span>
                          <span>{Math.round(x.probability * 100)}% of weeks</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div>
              <div className="mb-1 font-medium">
                Military → local follow-ups: {s.handoff_count}
                {s.handoff_median_lag_min != null && ` (typical gap ${s.handoff_median_lag_min} min)`}
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-auto text-xs tabular-nums">
                {s.handoffs.slice(0, 20).map((h: any, i: number) => (
                  <li key={i}>
                    {new Date(h.mil_t).toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} — {h.mil_cs} → {h.tail} (+{h.lag_min} min)
                  </li>
                ))}
              </ul>
            </div>

            {data.narrative && (
              <div className="whitespace-pre-wrap rounded border bg-muted/40 p-3 text-xs leading-relaxed">{data.narrative}</div>
            )}
            <p className="text-xs text-muted-foreground">
              Written by: {data.provider === "nvidia-nim" ? "NVIDIA" : "backup AI"} · Fingerprint {data.sha256.slice(0, 16)}…
              {s.skipped?.length > 0 && ` · Partial: ${s.skipped.join(", ")}`}
              <br />Being near each other at the same time is a lead, not proof of coordination. All data is from public ADS-B broadcasts.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

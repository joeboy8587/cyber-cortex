import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plane, ShieldAlert, Users, Fingerprint, Copy } from "lucide-react";
import { toast } from "sonner";

type Props = { registration: string | null };

const pct = (v: unknown) => (v == null ? "—" : `${(Number(v) * 100).toFixed(0)}%`);
const num = (v: unknown, d = 0) => (v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));

export function AircraftDossier({ registration }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!registration) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: resp, error } = await supabase.functions.invoke("aircraft-profile", {
          body: { action: "profile", registration },
        });
        if (error) throw error;
        if (!resp?.ok) throw new Error(resp?.error || "Profile unavailable");
        if (!cancelled) setData(resp);
      } catch (e: any) {
        if (!cancelled) { setData(null); toast.error(e.message || "Failed to load dossier"); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [registration]);

  if (!registration) {
    return (
      <Card className="p-6 h-full flex items-center justify-center text-sm text-muted-foreground text-center">
        Select a tail number to open its dossier.
      </Card>
    );
  }
  if (loading) {
    return <Card className="p-6 h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin" /></Card>;
  }
  if (!data?.profile) {
    return <Card className="p-6 h-full text-sm text-muted-foreground">No dossier built for {registration} yet.</Card>;
  }

  const p = data.profile;
  const hours: number[] = p.hour_hist || [];
  const maxHour = Math.max(1, ...hours);
  const dows: number[] = p.dow_hist || [];
  const maxDow = Math.max(1, ...dows);

  return (
    <Card className="h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4 text-primary" />
              <span className="font-display text-xl tracking-wide">{p.registration}</span>
              {p.faa_matched
                ? <Badge variant="secondary" className="text-[10px]">FAA MATCHED</Badge>
                : <Badge variant="destructive" className="text-[10px]">NO FAA RECORD</Badge>}
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-1">
              {p.aircraft_type || "Type unknown"} · HEX {p.icao24 || "—"}
              {p.year_manufactured ? ` · ${p.year_manufactured}` : ""}
            </div>
            <div className="text-xs mt-1">
              {p.operator || <span className="text-muted-foreground">Unregistered operator</span>}
              {p.operator_city ? ` · ${[p.operator_city, p.operator_state].filter(Boolean).join(", ")}` : ""}
            </div>
          </div>
          <Badge variant={Number(p.risk_score) >= 60 ? "destructive" : "secondary"} className="font-mono">
            RISK {Number(p.risk_score || 0).toFixed(0)}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Detections", num(p.detections)],
              ["Active days", num(p.days_active)],
              ["Callsigns", (p.callsigns || []).length || "—"],
              ["Night ops", pct(p.night_pct)],
              ["Below 1,000 ft", pct(p.low_alt_pct)],
              ["Sub-stall", pct(p.sub_stall_pct)],
              ["On ground", pct(p.on_ground_pct)],
              ["Loiter index", num(p.loiter_score, 1)],
              ["Track spread", p.geo_spread_mi != null ? `${num(p.geo_spread_mi, 1)} mi` : "—"],
              ["Closest to AOI", p.aoi_min_mi != null ? `${num(p.aoi_min_mi, 1)} mi` : "—"],
              ["AOI pings", num(p.aoi_pings)],
              ["Avg altitude", p.alt_avg != null ? `${num(p.alt_avg)} ft` : "—"],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded border border-border bg-muted/20 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
                <div className="font-mono text-sm">{String(v)}</div>
              </div>
            ))}
          </div>

          <section>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Hour-of-day signature</h4>
            <div className="flex items-end gap-[2px] h-20">
              {Array.from({ length: 24 }, (_, i) => hours[i] || 0).map((c, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${i}:00 — ${c} pings`}>
                  <div
                    className={`w-full rounded-sm ${i < 6 || i >= 22 ? "bg-destructive/70" : "bg-primary/70"}`}
                    style={{ height: `${Math.max(2, (c / maxHour) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
              <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
            </div>
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Weekday signature</h4>
            <div className="grid grid-cols-7 gap-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                <div key={d} className="rounded border border-border bg-muted/20 p-1 text-center">
                  <div className="text-[10px] text-muted-foreground">{d}</div>
                  <div className="h-8 flex items-end justify-center">
                    <div className="w-3 bg-primary/70 rounded-sm"
                      style={{ height: `${Math.max(4, ((dows[i] || 0) / maxDow) * 100)}%` }} />
                  </div>
                  <div className="text-[10px] font-mono">{dows[i] || 0}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" /> Violations ({Number(p.faa_violations || 0) + Number(p.sentinel_violations || 0)})
            </h4>
            {(data.violations || []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No validated violations on record for this window.</p>
            ) : (
              <div className="space-y-1">
                {data.violations.slice(0, 10).map((v: any, i: number) => (
                  <div key={i} className="text-xs rounded border border-border bg-muted/20 p-2 font-mono">
                    <span className="text-destructive">{v.violation_type || "VIOLATION"}</span>
                    {" · "}{new Date(v.ts).toLocaleString()}
                    {v.altitude != null && <> · {num(v.altitude)} ft</>}
                    {v.altitude_deficit != null && <> · deficit {num(v.altitude_deficit)} ft</>}
                    {v.nearest_airport && <> · {v.nearest_airport}</>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Users className="w-3 h-3" /> Coordination partners ({p.partner_count || 0})
            </h4>
            {(p.top_partners || []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No co-presence partners indexed.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {(p.top_partners || []).map((t: any) => (
                  <Badge key={t.registration} variant="outline" className="font-mono text-[10px]">
                    {t.registration} ×{Number(t.weight || 0).toFixed(0)}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {(data.fleet || []).length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Same registrant fleet</h4>
              <div className="flex flex-wrap gap-1">
                {data.fleet.map((f: any) => (
                  <Badge key={f.registration} variant="secondary" className="font-mono text-[10px]">
                    {f.registration} · risk {Number(f.risk_score || 0).toFixed(0)}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {(data.twins || []).length > 0 && (
            <section>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Behavioural twins (GPU embeddings)</h4>
              <div className="flex flex-wrap gap-1">
                {data.twins.map((t: any) => (
                  <Badge key={t.registration} variant="outline" className="font-mono text-[10px]">
                    {t.registration} · {Number(t.similarity || 0).toFixed(3)}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Fingerprint className="w-3 h-3" /> Signature hash
            </h4>
            <div className="flex items-center gap-2">
              <code className="text-[10px] break-all flex-1 bg-muted/30 rounded p-2">{p.signature_hash}</code>
              <Button size="icon" variant="ghost" onClick={() => {
                navigator.clipboard.writeText(p.signature_hash || "");
                toast.success("Signature hash copied");
              }}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </Card>
  );
}

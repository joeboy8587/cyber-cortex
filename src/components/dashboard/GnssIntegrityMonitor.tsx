/**
 * GNSS/INS INTEGRITY MONITOR — ground-side position-domain innovation.
 *
 * Deliberately separated from registry-identity flags: the integrity layer
 * stands on math, the identity layer is an unresolved informational lead.
 * The two must never share a section header in an exported report.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Activity, Loader2, Radar, SatelliteDish, TriangleAlert } from "lucide-react";

type Any = Record<string, any>;

const CITATION =
  "Kujur, Khanafseh & Pervan — Detecting GNSS spoofing of ADS-B equipped aircraft using INS (ION PLANS 2020; GNSS 2022, IDM-10)";

function Method({ doctrine }: { doctrine?: Any }) {
  const c = doctrine?.calibration;
  return (
    <Card className="p-4 space-y-3 border-primary/30 bg-primary/5">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-primary">
        <SatelliteDish className="h-4 w-4" /> Method & calibration — state this in every report
      </div>
      <p className="text-sm text-foreground/85">
        This is a <strong>ground-side</strong> position-domain innovation monitor. The paper computes the test
        statistic inside the aircraft, from GNSS measurements against the aircraft's own inertial propagation.
        We compute an equivalent statistic from the ground, comparing the broadcast ADS-B position against a
        coasted prediction of that same broadcast state. Same statistic family, different observer — we do not
        reproduce the aircraft's internal filter and never claim to.
      </p>
      <div className="font-mono text-xs text-muted-foreground">
        q = |z − H·x̄| / σ &nbsp;·&nbsp; T = k<sub>FA</sub> &nbsp;·&nbsp; σ = √(σ₀² + (drift·Δt)²)
      </div>
      {c && (
        <div className="grid gap-2 sm:grid-cols-3 font-mono text-xs">
          <Stat label="k_FA (false alarm)" value={`${c.k_FA}  ·  P_FA ${c.P_FA}`} />
          <Stat label="k_MD (missed detection)" value={`${c.k_MD}  ·  P_MD ${c.P_MD}`} />
          <Stat label="Min detectable bias" value={`${c.mdb_multiplier.toFixed(2)} × σ`} />
          <Stat label="σ₀ (report noise floor)" value={`${c.sigma0_m} m`} />
          <Stat label="INS coast drift" value={`${c.drift_rate_m_per_s} m/s (1σ)`} />
          <Stat label="Max scored ping gap" value={`${c.max_gap_s} s`} />
        </div>
      )}
      {Array.isArray(doctrine?.known_gaps) && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {doctrine.known_gaps.map((g: string) => (
            <li key={g} className="flex gap-2">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-chart-4" />
              <span>{g}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[11px] italic text-muted-foreground">{CITATION}</div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

export default function GnssIntegrityMonitor() {
  const [busy, setBusy] = useState<string | null>(null);
  const [doctrine, setDoctrine] = useState<Any | undefined>();
  const [scan, setScan] = useState<Any | null>(null);
  const [envelope, setEnvelope] = useState<Any | null>(null);
  const [wide, setWide] = useState<Any | null>(null);
  const [hours, setHours] = useState("6");
  const [tail, setTail] = useState("N606BS");
  const [at, setAt] = useState("2026-09-12T20:17:45Z");

  const call = async (key: string, body: Any, set: (d: Any) => void) => {
    setBusy(key);
    try {
      const { data, error } = await supabase.functions.invoke("gnss-integrity-monitor", { body });
      if (error) throw error;
      if (data?.doctrine) setDoctrine(data.doctrine);
      if (!data?.ok) throw new Error(data?.error || "Monitor failed");
      set(data);
    } catch (e: any) {
      toast.error(e.message || "Integrity monitor failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-mono text-sm uppercase tracking-[0.2em]">
              Integrity anomalies — INS innovation monitor
            </h2>
            <p className="text-xs text-muted-foreground">
              The layer that stands on math. Registry-identity flags are reported separately and are
              informational only.
            </p>
          </div>
        </div>
      </Card>

      <Method doctrine={doctrine} />

      <Tabs defaultValue="event" className="space-y-4">
        <TabsList>
          <TabsTrigger value="event">Event envelope</TabsTrigger>
          <TabsTrigger value="wide">Wide-area classifier</TabsTrigger>
          <TabsTrigger value="scan">Rolling scan</TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------- envelope */}
        <TabsContent value="event" className="space-y-3">
          <Card className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Pulls the seconds before and after an event for one tail. If the innovation returns to baseline
              after the spike, it was jamming and inertial coasting. If it stays out of bounds, that is the
              spoofing follow-on the paper describes as hardest to detect.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input className="w-40" value={tail} onChange={(e) => setTail(e.target.value)} placeholder="Tail" />
              <Input className="w-64" value={at} onChange={(e) => setAt(e.target.value)} placeholder="Event time (UTC)" />
              <Button
                disabled={busy === "env"}
                onClick={() => call("env", { action: "envelope", registration: tail, at, windowSeconds: 60 }, setEnvelope)}
              >
                {busy === "env" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Pull 60-second envelope
              </Button>
            </div>
          </Card>

          {envelope && (
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={envelope.verdict?.includes("SPOOFING") ? "destructive" : "secondary"}>
                  {envelope.verdict}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {envelope.scored}/{envelope.pings} pings scored · q̄ before {envelope.q_mean_before ?? "—"} · q̄ after{" "}
                  {envelope.q_mean_after ?? "—"}
                </span>
              </div>
              <p className="text-sm text-foreground/85">{envelope.reason}</p>
              <p className="text-xs text-muted-foreground">{envelope.nacp_note}</p>
              <ScrollArea className="h-72">
                <table className="w-full font-mono text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="p-1">Time</th><th className="p-1">Δt</th><th className="p-1">Residual</th>
                      <th className="p-1">σ</th><th className="p-1">q</th><th className="p-1">T</th>
                      <th className="p-1">Alt</th><th className="p-1">V/S</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(envelope.series ?? []).map((s: Any, i: number) => (
                      <tr key={i} className={s.exceeds ? "text-destructive" : "text-foreground/80"}>
                        <td className="p-1">{new Date(s.ts).toISOString().slice(11, 19)}</td>
                        <td className="p-1">{s.dt_s}s</td>
                        <td className="p-1">{s.residual_m} m</td>
                        <td className="p-1">{s.sigma_m} m</td>
                        <td className="p-1">{s.q}</td>
                        <td className="p-1">{s.T}</td>
                        <td className="p-1">{s.alt ?? "—"}</td>
                        <td className="p-1">{s.vertical_rate ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>

        {/* -------------------------------------------------------- wide area */}
        <TabsContent value="wide" className="space-y-3">
          <Card className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Tests whether a multi-tail spike is a regional radio event or a per-tail artefact: a wide spread of
              q across separated counties is what a regional jamming footprint looks like; a tight cluster is not.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input className="w-64" value={at} onChange={(e) => setAt(e.target.value)} />
              <Button
                disabled={busy === "wide"}
                onClick={() => call("wide", { action: "wide_area", at, windowSeconds: 60, baselineMinutes: 10 }, setWide)}
              >
                {busy === "wide" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                Classify event
              </Button>
            </div>
          </Card>

          {wide && (
            <Card className="p-4 space-y-3">
              <Badge variant={wide.tails_exceeding > 0 ? "destructive" : "secondary"}>
                {wide.tails_exceeding} of {wide.tails_scored} tails out of bounds
              </Badge>
              <p className="text-sm text-foreground/85">{wide.classification}</p>
              <p className="text-sm text-foreground/85">{wide.onset}</p>
              <div className="font-mono text-xs text-muted-foreground">
                q spread ratio {wide.q_spread_ratio} · quiet in baseline {wide.quiet_before_spike}
              </div>
              <div className="flex flex-wrap gap-1">
                {(wide.counties ?? []).map((c: Any) => (
                  <Badge key={c.county} variant="outline" className="font-mono text-[10px]">
                    {c.county}: {c.n}
                  </Badge>
                ))}
              </div>
              <ScrollArea className="h-64">
                <table className="w-full font-mono text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="p-1">Tail</th><th className="p-1">q max</th>
                      <th className="p-1">q baseline</th><th className="p-1">Max residual</th><th className="p-1">County</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(wide.per_tail ?? []).map((t: Any) => (
                      <tr key={t.registration} className={t.exceeds ? "text-destructive" : "text-foreground/70"}>
                        <td className="p-1">{t.registration}</td>
                        <td className="p-1">{t.q_max_event}</td>
                        <td className="p-1">{t.q_mean_baseline ?? "—"}</td>
                        <td className="p-1">{t.residual_max_m} m</td>
                        <td className="p-1">{t.county ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------- scan */}
        <TabsContent value="scan" className="space-y-3">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input className="w-24" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours" />
              <Button
                disabled={busy === "scan"}
                onClick={() => call("scan", { action: "scan", hours: Number(hours) || 6 }, setScan)}
              >
                {busy === "scan" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Run integrity scan
              </Button>
            </div>
          </Card>

          {scan && (
            <Card className="p-4 space-y-3">
              <div className="grid gap-2 sm:grid-cols-4 font-mono text-xs">
                <Stat label="Pings read" value={String(scan.pings_read)} />
                <Stat label="Scored pairs" value={String(scan.scored_pairs)} />
                <Stat label="Exceedances" value={String(scan.exceedances)} />
                <Stat label="Tails flagged" value={String(scan.tails_flagged)} />
              </div>
              <p className="text-xs text-muted-foreground">{scan.coverage_note}</p>
              <ScrollArea className="h-72">
                <table className="w-full font-mono text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th className="p-1">Tail</th><th className="p-1">Time</th><th className="p-1">q</th>
                      <th className="p-1">Residual</th><th className="p-1">σ</th><th className="p-1">MDB</th>
                      <th className="p-1">County</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scan.top ?? []).map((r: Any, i: number) => (
                      <tr key={i} className="text-destructive">
                        <td className="p-1">{r.registration}</td>
                        <td className="p-1">{new Date(r.ts).toISOString().slice(0, 19).replace("T", " ")}</td>
                        <td className="p-1">{r.q}</td>
                        <td className="p-1">{r.residual_m} m</td>
                        <td className="p-1">{r.sigma_m} m</td>
                        <td className="p-1">{r.mdb_m} m</td>
                        <td className="p-1">{r.county ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Card className="p-4 border-muted-foreground/30">
        <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          Registry-identity flags — informational, unresolved
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Callsign, registry and operator findings are a separate and weaker layer. They are never merged into the
          integrity section above, and they carry no test statistic. Keeping them apart stops the weak layer from
          drowning out the strong one in a reader's attention.
        </p>
      </Card>
    </div>
  );
}

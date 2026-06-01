import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ShieldOff, Ghost, Layers, Network, Play, Loader2, Download } from "lucide-react";

type IntegrityResult = {
  generated_at: string;
  lookback_days: number;
  quarantine?: {
    summary: Record<string, number>;
    foreign_injections: any[];
    physics_commercial: any[];
    physics_generic: any[];
  };
  ghostFleet?: {
    summary: Record<string, number>;
    zero_foot_persistent: any[];
    hex_rotation: any[];
  };
  compoundThreats?: any[];
  shellNetwork?: any[];
};

export function DataIntegrityConsole() {
  const [lookbackDays, setLookbackDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const { toast } = useToast();

  const runScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sentinel-data-integrity", {
        body: { action: "runAll", lookbackDays },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data?.data || null);
      toast({ title: "Data Integrity scan complete", description: `Lookback ${lookbackDays}d` });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportJson = () => {
    if (!result) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stamp.slice(0, 10).replace(/-/g, "")}_WATCHTOWER_INTEGRITY_${lookbackDays}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counters = result
    ? {
        quarantine: result.quarantine?.summary?.total ?? 0,
        ghosts: result.ghostFleet?.summary?.total ?? 0,
        compound: result.compoundThreats?.length ?? 0,
        shells: result.shellNetwork?.length ?? 0,
      }
    : null;

  return (
    <Card className="border-primary/40 bg-card">
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <ShieldOff className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg font-display uppercase tracking-wider">
                Sentinel v3 — Data Integrity Console
              </CardTitle>
              <p className="text-xs text-muted-foreground font-mono">
                Wave 1: Quarantine · Ghost Fleet · Compound Threats · Shell Network
              </p>
            </div>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="space-y-1">
              <Label htmlFor="lb-int" className="text-xs">Lookback (days)</Label>
              <Input
                id="lb-int" type="number" min={1} max={90}
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value) || 7)}
                className="w-24"
              />
            </div>
            <Button onClick={runScan} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {loading ? "Scanning…" : "Run Integrity Scan"}
            </Button>
            {result && (
              <Button variant="outline" onClick={exportJson} className="gap-2">
                <Download className="h-4 w-4" /> Export JSON
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {counters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Counter label="Quarantined rows" value={counters.quarantine} icon={<ShieldOff className="h-4 w-4" />} tone="destructive" />
            <Counter label="Persistent ghosts" value={counters.ghosts} icon={<Ghost className="h-4 w-4" />} tone="warning" />
            <Counter label="Compound threats" value={counters.compound} icon={<Layers className="h-4 w-4" />} tone="warning" />
            <Counter label="Shell clusters" value={counters.shells} icon={<Network className="h-4 w-4" />} tone="primary" />
          </div>
        )}

        {!result && !loading && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Run the scan to quarantine spoofed rows, isolate persistent ghosts, merge compound threats, and surface shell-company clusters.
          </p>
        )}

        {result && (
          <Tabs defaultValue="quarantine">
            <TabsList className="w-full">
              <TabsTrigger value="quarantine" className="flex-1 text-xs gap-1"><ShieldOff className="h-3 w-3" /> Quarantine</TabsTrigger>
              <TabsTrigger value="ghosts" className="flex-1 text-xs gap-1"><Ghost className="h-3 w-3" /> Ghost Fleet</TabsTrigger>
              <TabsTrigger value="compound" className="flex-1 text-xs gap-1"><Layers className="h-3 w-3" /> Compound</TabsTrigger>
              <TabsTrigger value="shells" className="flex-1 text-xs gap-1"><Network className="h-3 w-3" /> Shell Network</TabsTrigger>
            </TabsList>

            <TabsContent value="quarantine" className="space-y-3 pt-3">
              <QuarantineSection title="Foreign-registry injections" reason="IDENTITY_SPOOF_FOREIGN_INJECTION" rows={result.quarantine?.foreign_injections || []} />
              <QuarantineSection title="Commercial-physics violations (737-class low/slow)" reason="PHYSICS_VIOLATION_COMMERCIAL" rows={result.quarantine?.physics_commercial || []} />
              <QuarantineSection title="Generic-physics violations (>600kt under 5000ft)" reason="PHYSICS_VIOLATION_GENERIC" rows={result.quarantine?.physics_generic || []} />
              <p className="text-[10px] font-mono text-muted-foreground">
                Rows are NEVER deleted from the universe table — they are reclassified and excluded from convergence math. Forensic reproducibility preserved.
              </p>
            </TabsContent>

            <TabsContent value="ghosts" className="space-y-3 pt-3">
              <GhostSection title="Zero-foot persistent emitters" rows={result.ghostFleet?.zero_foot_persistent || []} />
              <GhostSection title="Hex / callsign rotation ghosts" rows={result.ghostFleet?.hex_rotation || []} />
            </TabsContent>

            <TabsContent value="compound" className="pt-3">
              <CompoundTable rows={result.compoundThreats || []} />
            </TabsContent>

            <TabsContent value="shells" className="pt-3 space-y-3">
              {(result.shellNetwork || []).length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">No shell-linked tails detected in this window.</p>
              )}
              {(result.shellNetwork || []).map((c: any) => (
                <ShellClusterCard key={c.cluster} cluster={c} />
              ))}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function Counter({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "primary" | "warning" | "destructive" }) {
  const toneClass = tone === "destructive" ? "border-destructive/50 bg-destructive/10"
    : tone === "warning" ? "border-yellow-500/40 bg-yellow-500/10"
    : "border-primary/40 bg-primary/10";
  return (
    <div className={`rounded border ${toneClass} p-3`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </div>
      <div className="text-2xl font-display font-bold mt-1">{value.toLocaleString()}</div>
    </div>
  );
}

function QuarantineSection({ title, reason, rows }: { title: string; reason: string; rows: any[] }) {
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Badge variant="destructive" className="text-[10px] font-mono">{rows.length} rows · {reason}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No rows in this window.</p>
      ) : (
        <div className="overflow-auto max-h-72">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Time</TableHead>
                <TableHead className="text-xs">Registration</TableHead>
                <TableHead className="text-xs">Callsign</TableHead>
                <TableHead className="text-xs">Alt (ft)</TableHead>
                <TableHead className="text-xs">Speed (kt)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 50).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-mono">{String(r.detection_timestamp || "").slice(0, 19)}</TableCell>
                  <TableCell className="text-xs font-bold">{r.registration || "—"}</TableCell>
                  <TableCell className="text-xs">{r.callsign || "—"}</TableCell>
                  <TableCell className="text-xs">{r.altitude ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.speed ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function GhostSection({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <Badge variant="outline" className="text-[10px] font-mono">{rows.length} tails</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None detected.</p>
      ) : (
        <div className="overflow-auto max-h-72">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Identifier</TableHead>
                <TableHead className="text-xs">Detections</TableHead>
                <TableHead className="text-xs">Avg Alt / Variation</TableHead>
                <TableHead className="text-xs">Tier</TableHead>
                <TableHead className="text-xs">Referral</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs font-bold font-mono">{r.registration || r.icao24 || "—"}</TableCell>
                  <TableCell className="text-xs">{r.detections}</TableCell>
                  <TableCell className="text-xs">
                    {r.avg_altitude !== undefined ? `${r.avg_altitude} ft avg` : `${r.distinct_callsigns} callsigns / ${r.distinct_registrations} regs`}
                  </TableCell>
                  <TableCell><Badge variant="destructive" className="text-[10px]">{r.tier}</Badge></TableCell>
                  <TableCell className="text-xs font-mono">{r.referral_track}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CompoundTable({ rows }: { rows: any[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 text-center">No compound threats in this window.</p>;
  }
  return (
    <div className="overflow-auto max-h-[500px] rounded border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Registration</TableHead>
            <TableHead className="text-xs">Factors</TableHead>
            <TableHead className="text-xs">Score</TableHead>
            <TableHead className="text-xs">Detections</TableHead>
            <TableHead className="text-xs">Low-alt</TableHead>
            <TableHead className="text-xs">Sub-stall</TableHead>
            <TableHead className="text-xs">Night</TableHead>
            <TableHead className="text-xs">Min Alt</TableHead>
            <TableHead className="text-xs">Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="text-xs font-bold font-mono">{r.registration}</TableCell>
              <TableCell className="text-xs">
                <div className="flex flex-wrap gap-1">
                  {(r.factors || []).map((f: string) => (
                    <Badge key={f} variant="outline" className="text-[9px]">{f}</Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell><Badge variant="destructive" className="text-[10px]">{r.compound_score}</Badge></TableCell>
              <TableCell className="text-xs">{r.detections}</TableCell>
              <TableCell className="text-xs">{r.low_alt_count}</TableCell>
              <TableCell className="text-xs">{r.sub_stall_count}</TableCell>
              <TableCell className="text-xs">{r.night_count}</TableCell>
              <TableCell className="text-xs">{r.min_altitude ?? "—"}</TableCell>
              <TableCell className="text-xs font-mono">{String(r.last_seen || "").slice(0, 19)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ShellClusterCard({ cluster }: { cluster: any }) {
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">{cluster.cluster}</h4>
          <Badge variant="outline" className="text-[10px]">Tier {cluster.tier}</Badge>
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {cluster.unique_tails} tails · {cluster.total_detections.toLocaleString()} detections
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Registrant names: {cluster.registrant_examples.join(" · ")}
      </p>
      <div className="overflow-auto max-h-48">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Tail</TableHead>
              <TableHead className="text-xs">Detections</TableHead>
              <TableHead className="text-xs">Registrant</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cluster.tails.map((t: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="text-xs font-bold font-mono">{t.registration}</TableCell>
                <TableCell className="text-xs">{t.detections}</TableCell>
                <TableCell className="text-xs">{t.registrant}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

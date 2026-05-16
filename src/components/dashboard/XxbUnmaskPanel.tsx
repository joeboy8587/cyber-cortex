import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Ghost, ShieldCheck } from "lucide-react";

const SOURCES = [
  "live_flight_detections_rows",
  "live_flight_detections",
  "quarantine.evidence_flight_dump_20260103_sealed",
];

interface BreakdownRow {
  attribution_tier: number;
  attribution_method: string;
  n: number | string;
  unique_regs: number | string;
  unique_icao: number | string;
}

export function XxbUnmaskPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [source, setSource] = useState(SOURCES[0]);
  const [stats, setStats] = useState<{ total?: number | string; breakdown?: BreakdownRow[]; initialized?: boolean } | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);

  const call = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("xxb-unmask", {
        body: { action, source_table: source, ...extra },
      });
      if (error) throw error;
      setLastResult({ action, ...data });
      if (action === "stats") setStats(data);
      toast({ title: `${action} complete`, description: JSON.stringify(data).slice(0, 160) });
      if (action !== "stats") {
        const s = await supabase.functions.invoke("xxb-unmask", { body: { action: "stats" } });
        if (!s.error) setStats(s.data);
      }
    } catch (e: any) {
      toast({ title: `${action} failed`, description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-mono uppercase tracking-wider text-primary">
          <Ghost className="h-5 w-5" /> XXB Unmasking Engine
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">
          Forensically attribute MLAT-only "XXB" tracks to known airframes via deterministic + probabilistic bridges.
          Raw rows are never mutated — attributions are written to <code>xxb_attributions</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-mono text-muted-foreground">Source:</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs font-mono"
          >
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("init")}>
            {busy === "init" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}1. Init Table
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier1_icao", { batch_size: 25000 })}>
            {busy === "tier1_icao" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T1 · ICAO Bridge
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier2_continuity", { batch_size: 25000 })}>
            {busy === "tier2_continuity" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T2 · Continuity
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier3_callsign", { batch_size: 25000 })}>
            {busy === "tier3_callsign" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T3 · Callsign
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier4_fingerprint", { batch_size: 25000 })}>
            {busy === "tier4_fingerprint" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T4 · Fingerprint
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier5_coflight", { batch_size: 25000 })}>
            {busy === "tier5_coflight" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T5 · Co-flight
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier6_envelope", { batch_size: 25000 })}>
            {busy === "tier6_envelope" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T6 · Envelope
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => call("tier7_corridor", { batch_size: 5000 })}>
            {busy === "tier7_corridor" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            T7 · Corridor
          </Button>
          <Button size="sm" variant="default" disabled={!!busy} onClick={() => call("run_all", { batch_size: 15000 })}>
            {busy === "run_all" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            ▶ Run All Tiers
          </Button>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => call("consensus")}>
            Consensus
          </Button>
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => call("stats")}>
            <ShieldCheck className="h-3 w-3 mr-1" /> Stats
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              setBusy("deep_rescan");
              try {
                const { data, error } = await supabase.functions.invoke("neon-deep-rescan", { body: {} });
                if (error) throw error;
                setLastResult({ action: "neon-deep-rescan", ...data });
                toast({ title: "Deep rescan complete", description: `Flags written: ${data?.flags_written ?? 0}` });
              } catch (e: any) {
                toast({ title: "Deep rescan failed", description: e?.message ?? String(e), variant: "destructive" });
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "deep_rescan" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            🔭 Deep Rescan Neon DB
          </Button>
        </div>

        {stats && (
          <div className="border border-border rounded p-3 bg-muted/30">
            <div className="text-xs font-mono mb-2">
              Total attributions: <Badge variant="secondary">{String(stats.total ?? 0)}</Badge>
              {stats.initialized === false && <span className="ml-2 text-destructive">Not initialized — click "Init Table"</span>}
            </div>
            {stats.breakdown && stats.breakdown.length > 0 && (
              <table className="w-full text-xs font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left">Tier</th>
                    <th className="text-left">Method</th>
                    <th className="text-right">Rows</th>
                    <th className="text-right">Unique Reg</th>
                    <th className="text-right">Unique ICAO</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.breakdown.map((r, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td><Badge variant={r.attribution_tier === 1 ? "default" : "outline"}>T{r.attribution_tier}</Badge></td>
                      <td>{r.attribution_method}</td>
                      <td className="text-right">{String(r.n)}</td>
                      <td className="text-right">{String(r.unique_regs)}</td>
                      <td className="text-right">{String(r.unique_icao)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {lastResult && (
          <pre className="text-[10px] font-mono bg-muted/30 p-2 rounded border border-border overflow-x-auto max-h-48">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

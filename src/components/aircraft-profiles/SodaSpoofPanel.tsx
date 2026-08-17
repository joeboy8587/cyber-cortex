import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { downloadCSV } from "@/lib/csv";
import { Loader2, RadioTower, ShieldAlert, Play, GraduationCap, Download } from "lucide-react";
import { toast } from "sonner";

type Row = {
  registration: string;
  window_start: string;
  window_end: string;
  pings: number;
  claimed_icao: string | null;
  z_alt: number;
  z_spd: number;
  geo_dev_mi: number;
  new_icao: boolean;
  new_callsign: boolean;
  max_implied_kts: number | null;
  nearest_match: string | null;
  spoof_probability: number;
  verdict: string;
  evidence: { reasons?: string[]; trained?: boolean } | null;
};

const VERDICT_STYLE: Record<string, string> = {
  SPOOF_LIKELY: "bg-destructive text-destructive-foreground",
  SUSPECT: "bg-warning text-warning-foreground",
  ANOMALOUS: "bg-secondary text-secondary-foreground",
  CONSISTENT: "bg-muted text-muted-foreground",
};

export function SodaSpoofPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [l, s] = await Promise.all([
      supabase.functions.invoke("soda-spoof-detector", {
        body: { action: "list", limit: 120, minProb: 0.3 },
      }),
      supabase.functions.invoke("soda-spoof-detector", { body: { action: "stats" } }),
    ]);
    if (l.data?.ok) setRows(l.data.rows || []);
    if (s.data?.ok) setStats(s.data.stats || null);
    return s.data?.shards || 9;
  }, []);

  useEffect(() => { load(); }, [load]);

  const runPasses = async (action: "train" | "score", label: string) => {
    setBusy(action);
    try {
      const shards = (await load()) as number;
      let total = 0, flagged = 0;
      for (let part = 0; part < shards; part++) {
        setStep(`${label} — pass ${part + 1} of ${shards}…`);
        const { data, error } = await supabase.functions.invoke("soda-spoof-detector", {
          body: action === "train"
            ? { action, part, baselineDays: 120, holdoutDays: 3, minPings: 20 }
            : { action, part, evalHours: 72, minPings: 5 },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || `${label} failed`);
        total += Number(data.fingerprints || data.scored || 0);
        flagged += Number(data.flagged || 0);
      }
      toast.success(
        action === "train"
          ? `Learned ${total.toLocaleString()} aircraft fingerprints`
          : `Scored ${total.toLocaleString()} tails — ${flagged.toLocaleString()} above the suspect threshold`,
      );
      await load();
    } catch (e: any) {
      toast.error(e.message || `${label} failed`, { duration: 10000 });
    } finally {
      setBusy(null);
      setStep(null);
    }
  };

  const exportCsv = () => {
    if (!rows.length) { toast.info("Nothing to export yet — run the identity check first."); return; }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    downloadCSV(
      rows.map((r) => ({
        registration: r.registration,
        verdict: r.verdict,
        spoof_probability: r.spoof_probability,
        claimed_icao: r.claimed_icao || "",
        window_start: r.window_start,
        window_end: r.window_end,
        pings: r.pings,
        new_icao: r.new_icao,
        new_callsign: r.new_callsign,
        z_altitude: r.z_alt,
        z_speed: r.z_spd,
        geo_deviation_mi: r.geo_dev_mi,
        max_implied_kts: r.max_implied_kts ?? "",
        nearest_fingerprint: r.nearest_match || "",
        findings: (r.evidence?.reasons || []).join(" | "),
      })),
      `${stamp}_WATCHTOWER_SODA_identity-spoofing.csv`,
    );
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RadioTower className="w-4 h-4 text-primary" />
          <span className="font-display tracking-wide">ADS-B identity spoofing detector (SODA stage 2)</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {stats?.fingerprints > 0 && (
            <Badge variant="secondary" className="font-mono">
              {Number(stats.fingerprints).toLocaleString()} fingerprints
            </Badge>
          )}
          {stats?.spoof_likely > 0 && (
            <Badge variant="destructive" className="font-mono">
              {Number(stats.spoof_likely).toLocaleString()} spoof-likely
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Step 1 — learn how each tail normally behaves (altitude, speed, where it flies, what hours, which
        ICAO address and callsigns it legitimately uses) from a 120-day baseline. Step 2 — test the last
        72 hours against those fingerprints. An aircraft broadcasting an ICAO address it has never used,
        jumping outside its own operating envelope, or moving faster than physics allows is flagged as an
        identity spoof. The method follows the published SODA aircraft-classifier stage; the radio-hardware
        stage of that paper needs an SDR receiver we don't have.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => runPasses("train", "Learning baselines")} disabled={!!busy}>
          {busy === "train" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <GraduationCap className="w-3 h-3 mr-2" />}
          Learn baselines (120d)
        </Button>
        <Button size="sm" variant="outline" onClick={() => runPasses("score", "Checking identities")} disabled={!!busy}>
          {busy === "score" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Play className="w-3 h-3 mr-2" />}
          Run identity check (72h)
        </Button>
        <Button size="sm" variant="secondary" onClick={exportCsv} disabled={!!busy}>
          <Download className="w-3 h-3 mr-2" /> Export findings
        </Button>
      </div>
      {step && <div className="text-xs font-mono text-muted-foreground">{step}</div>}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            ["Tails scored", stats.scored],
            ["Spoof likely", stats.spoof_likely],
            ["Suspect", stats.suspect],
            ["ICAO swaps", stats.icao_swaps],
            ["Impersonations", stats.impersonations],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-md border border-border p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
              <div className="font-mono text-base">{Number(v || 0).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      <ScrollArea className="h-[320px] pr-2">
        <div className="space-y-2">
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">
              No identity findings yet — learn the baselines, then run the identity check.
            </div>
          )}
          {rows.map((r) => (
            <div key={`${r.registration}-${r.window_start}`} className="rounded-md border border-border p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-3 h-3 text-muted-foreground" />
                  <span className="font-mono text-sm">{r.registration}</span>
                  {r.claimed_icao && (
                    <span className="font-mono text-[10px] text-muted-foreground">ICAO {r.claimed_icao}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{Math.round(r.spoof_probability * 100)}%</span>
                  <Badge className={`font-mono text-[10px] ${VERDICT_STYLE[r.verdict] || ""}`}>
                    {r.verdict.replace("_", " ")}
                  </Badge>
                </div>
              </div>
              <ul className="text-[11px] text-muted-foreground list-disc pl-5 space-y-0.5">
                {(r.evidence?.reasons || []).map((x, i) => <li key={i}>{x}</li>)}
              </ul>
              <div className="text-[10px] font-mono text-muted-foreground">
                {r.pings} pings · {new Date(r.window_start).toLocaleString()} → {new Date(r.window_end).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
}

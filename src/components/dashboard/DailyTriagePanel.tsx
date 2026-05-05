import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, AlertTriangle, Plane, Activity, Users, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface TriageData {
  report_date: string;
  threat_level: string;
  score: number;
  synthesis: string;
  sections: {
    anomalies_24h: any[];
    residence_overflights_24h: any[];
    swarm_convergence_7d: any[];
    watchlist_active_24h: any[];
    top_biometric_corr: any[];
    db_pulse: { detections_24h: number; unique_ac_24h: number };
  };
}

export function DailyTriagePanel() {
  const [data, setData] = useState<TriageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const { data: res, error: e } = await supabase.functions.invoke("daily-triage", { body: {} });
      if (e) throw e;
      setData(res as TriageData);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally { setLoading(false); }
  };

  useEffect(() => { run(); }, []);

  const threatColor = (t?: string) =>
    t === "CRITICAL" ? "bg-destructive text-destructive-foreground" :
    t === "ELEVATED" ? "bg-warning text-warning-foreground" :
    "bg-success text-success-foreground";

  return (
    <CyberPanel
      title="Daily Triage Brief"
      icon={<AlertTriangle className="w-4 h-4" />}
      headerActions={
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={run} disabled={loading}>
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Running…" : "Refresh"}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {error && <div className="text-xs text-destructive font-mono">{error}</div>}

        {data && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground font-mono">{data.report_date}</div>
                <div className="font-display text-lg uppercase tracking-wider">Threat: <span className={`px-2 py-0.5 rounded text-sm ${threatColor(data.threat_level)}`}>{data.threat_level}</span></div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-primary">{data.score}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Score</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat icon={<Plane className="w-3 h-3" />} label="Anomaly AC (24h)" value={data.sections.anomalies_24h?.length ?? 0} />
              <Stat icon={<Activity className="w-3 h-3" />} label="Residence Passes" value={data.sections.residence_overflights_24h?.length ?? 0} />
              <Stat icon={<Users className="w-3 h-3" />} label="Swarm Events (7d)" value={data.sections.swarm_convergence_7d?.length ?? 0} />
              <Stat icon={<Database className="w-3 h-3" />} label="Detections 24h" value={data.sections.db_pulse?.detections_24h ?? 0} />
            </div>

            <ScrollArea className="h-[280px] pr-2">
              <Section title="🚨 Anomaly Aircraft (sub-stall / sub-500ft, 24h)" items={data.sections.anomalies_24h} render={(r) => (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-primary">{r.registration}</span>
                  <span className="text-muted-foreground">sub-stall:{r.sub_stall} · sub-500:{r.sub_500ft} · night:{r.night} · min-alt:{r.min_alt}ft</span>
                </div>
              )} />
              <Section title="🏠 Residence Overflights (24h)" items={data.sections.residence_overflights_24h} render={(r) => (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-primary">{r.registration}</span>
                  <span className="text-muted-foreground">{r.passes} passes · avg {r.avg_alt}ft · min {r.min_alt}ft</span>
                </div>
              )} />
              <Section title="⚡ Swarm Convergence (7d, 3+ AC same minute near AOI)" items={data.sections.swarm_convergence_7d} render={(r) => (
                <div className="text-xs font-mono">
                  <div className="text-primary">{r.minute} · {r.unique_ac} aircraft</div>
                  <div className="text-muted-foreground truncate">{Array.isArray(r.aircraft) ? r.aircraft.join(", ") : ""}</div>
                </div>
              )} />
              <Section title="👁️ Watchlist Active (KCSO / Air Methods / Shell, 24h)" items={data.sections.watchlist_active_24h} render={(r) => (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-primary">{r.registration}</span>
                  <span className="text-muted-foreground">{r.dets} dets · min-alt {r.min_alt}ft · min-spd {r.min_spd}kts</span>
                </div>
              )} />
              <Section title="💓 Top Biometric Correlations (≥0.85)" items={data.sections.top_biometric_corr} render={(r) => (
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-primary">{r.registration} <Badge variant="outline" className="ml-1 text-[9px]">{r.aircraft_type}</Badge></span>
                  <span className="text-muted-foreground">conf {r.confidence} · str {r.strength} · {r.detection_count}d/{r.biometric_event_count}b</span>
                </div>
              )} />
            </ScrollArea>

            <pre className="text-[10px] font-mono text-muted-foreground bg-muted/30 p-2 rounded whitespace-pre-wrap">{data.synthesis}</pre>
          </>
        )}

        {!data && !error && <div className="text-xs text-muted-foreground">Loading triage…</div>}
      </div>
    </CyberPanel>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="bg-primary/10 rounded p-2">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase">{icon}{label}</div>
      <div className="text-lg font-bold text-primary">{value.toLocaleString()}</div>
    </div>
  );
}

function Section<T>({ title, items, render }: { title: string; items: T[]; render: (r: T) => React.ReactNode }) {
  if (!items?.length) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-display uppercase tracking-wider text-foreground mb-1">{title}</div>
      <div className="space-y-1">{items.map((r, i) => <div key={i} className="border-l-2 border-primary/30 pl-2 py-0.5">{render(r)}</div>)}</div>
    </div>
  );
}

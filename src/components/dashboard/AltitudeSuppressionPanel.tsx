import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Download } from "lucide-react";

type Lead = {
  icao: string; callsign: string | null; detected_at: string; rule_code: string;
  registration: string | null; speed_kts: number; nearest_airport: string; airport_km: number;
  reclimb_ft: number | null;
};
type Result = { days: number; scanned: number; counts: Record<string, number>; leads: number; inserted: number; sample: Lead[] };

const FILTERS = [
  { key: "all", label: "All dropouts" },
  { key: "ALT-SUP-TGO", label: "Airport touch-and-go" },
  { key: "ALT-SUP-ENR", label: "Away from airports" },
] as const;

export function AltitudeSuppressionPanel() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const run = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("altitude-suppression-scan", { body: { days } });
    setLoading(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.timeout ? "The scan took too long. Try a shorter date range." : "Scan failed. Please try again.");
      return;
    }
    setRes(data as Result);
    toast.success(`Saved ${(data as Result).inserted} new leads`);
  };

  const rows = (res?.sample ?? []).filter(r => filter === "all" || r.rule_code === filter);

  const exportCsv = () => {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const head = "time,tail,hex,callsign,type,speed_kts,nearest_airport,airport_km,climbed_back_to_ft";
    const body = rows.map(r => [r.detected_at, r.registration, r.icao, r.callsign, r.rule_code, r.speed_kts, r.nearest_airport, r.airport_km, r.reclimb_ft ?? ""].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const note = `"All data is drawn from public ADS-B broadcasts and is independently verifiable. Leads only - confirm against raw source data."`;
    const blob = new Blob([[head, ...body, "", note].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d}_FAA_EXHIBIT_ALT_SUPPRESSION.csv`;
    a.click();
  };

  return (
    <CyberPanel title="ALTITUDE DROPOUT ALERT — 14 CFR § 91.225">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Finds aircraft moving faster than 50 knots while their altitude reads 0 ft or blank. Airports are not a free pass:
          if an aircraft never slows to a stop and climbs back out, it is logged as a touch-and-go. Only real landings that roll to a stop are left out.
          Each result is a lead to check, not proof on its own.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {[3, 7, 14, 30].map(d => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} days</Button>
          ))}
          <Button size="sm" onClick={run} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Scanning…" : "Run scan"}
          </Button>
        </div>

        {res && (
          <>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-center">
              <Stat label="Dropouts checked" v={res.scanned} />
              <Stat label="Away from airports" v={res.counts.EN_ROUTE_ALTITUDE_SUPPRESSION ?? 0} />
              <Stat label="Airport touch-and-go" v={res.counts.AIRPORT_TOUCH_AND_GO ?? 0} />
              <Stat label="Normal landings (left out)" v={res.counts.AIRPORT_LANDING_ROLL ?? 0} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map(f => (
                <Button key={f.key} size="sm" variant={filter === f.key ? "secondary" : "ghost"} onClick={() => setFilter(f.key)}>{f.label}</Button>
              ))}
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="mr-1 h-4 w-4" /> Export</Button>
            </div>
            <div className="max-h-96 overflow-auto text-sm">
              {rows.length === 0 ? <p className="text-muted-foreground">No leads in this view.</p> : rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 border-b border-border py-2">
                  <Badge variant={r.rule_code === "ALT-SUP-TGO" ? "secondary" : "destructive"}>
                    {r.rule_code === "ALT-SUP-TGO" ? "Touch-and-go" : "Away from airport"}
                  </Badge>
                  <span className="font-mono">{r.registration || r.icao}</span>
                  <span className="text-muted-foreground">{new Date(r.detected_at).toLocaleString()}</span>
                  <span>{r.speed_kts} kts</span>
                  <span className="text-muted-foreground">{r.airport_km} km from {r.nearest_airport}</span>
                  {r.reclimb_ft && <span>climbed back to {r.reclimb_ft} ft</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-2xl font-mono font-bold text-primary">{v}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AircraftDossier } from "@/components/aircraft-profiles/AircraftDossier";
import { GpuEmbeddingPanel } from "@/components/aircraft-profiles/GpuEmbeddingPanel";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Search, Plane, ShieldAlert, Crosshair } from "lucide-react";
import { toast } from "sonner";

const SORTS = [
  { key: "risk_score", label: "Risk" },
  { key: "detections", label: "Detections" },
  { key: "aoi_pings", label: "AOI pressure" },
  { key: "faa_violations", label: "FAA violations" },
  { key: "last_seen", label: "Most recent" },
] as const;

export default function AircraftProfiles() {
  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string>("risk_score");
  const [onlyViolators, setOnlyViolators] = useState(false);
  const [onlyAoi, setOnlyAoi] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        supabase.functions.invoke("aircraft-profile", {
          body: { action: "list", limit: 150, search, sort, onlyViolators, onlyAoi },
        }),
        supabase.functions.invoke("aircraft-profile", { body: { action: "stats" } }),
      ]);
      if (l.error) throw l.error;
      if (!l.data?.ok) throw new Error(l.data?.error || "Load failed");
      setRows(l.data.rows || []);
      setStats(s.data?.stats || null);
      if (!(l.data.rows || []).length) toast.info("No dossiers yet — run 'Rebuild dossiers'.");
    } catch (e: any) {
      toast.error(e.message || "Failed to load aircraft profiles");
    } finally {
      setLoading(false);
    }
  }, [search, sort, onlyViolators, onlyAoi]);

  useEffect(() => { load(); }, [load]);

  const rebuild = async () => {
    setBuilding(true);
    try {
      const PARTS = 18;
      let total = 0;
      for (let part = 0; part < PARTS; part++) {
        toast.info(`Rebuilding dossiers — pass ${part + 1} of ${PARTS}…`);
        const { data, error } = await supabase.functions.invoke("aircraft-profile", {
          body: { action: "build", days: 90, minPings: 5, parts: PARTS, part },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || "Build failed");
        total += Number(data.profiles || 0);
      }
      toast.success(`Rebuilt ${total.toLocaleString()} aircraft dossiers over 90 days`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Rebuild failed");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-wide flex items-center gap-2">
              <Plane className="w-5 h-5 text-primary" /> Aircraft Dossiers
            </h1>
            <p className="text-sm text-muted-foreground">
              One profile per tail number — behavioural signature, FAA identity, violations and coordination partners.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Refresh
            </Button>
            <Button size="sm" onClick={rebuild} disabled={building}>
              {building ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Rebuild dossiers (90d)
            </Button>
          </div>
        </header>

        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              ["Dossiers", Number(stats.profiles || 0).toLocaleString()],
              ["FAA matched", Number(stats.faa_matched || 0).toLocaleString()],
              ["With violations", Number(stats.violators || 0).toLocaleString()],
              ["AOI actors", Number(stats.aoi_actors || 0).toLocaleString()],
              ["GPU vectors", Number(stats.embedded || 0).toLocaleString()],
            ].map(([l, v]) => (
              <Card key={String(l)} className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</div>
                <div className="font-mono text-lg">{String(v)}</div>
              </Card>
            ))}
          </div>
        )}

        <GpuEmbeddingPanel
          embedded={Number(stats?.embedded || 0)}
          pending={Number(stats?.pending_embeddings || 0)}
          onImported={load}
        />


        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-3 flex flex-col min-h-[560px]">
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-7 h-8 text-xs"
                  placeholder="Tail number or operator…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button size="sm" variant={onlyViolators ? "default" : "outline"} className="h-8"
                onClick={() => setOnlyViolators((v) => !v)}>
                <ShieldAlert className="w-3 h-3 mr-1" /> Violators
              </Button>
              <Button size="sm" variant={onlyAoi ? "default" : "outline"} className="h-8"
                onClick={() => setOnlyAoi((v) => !v)}>
                <Crosshair className="w-3 h-3 mr-1" /> AOI
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              {SORTS.map((s) => (
                <Badge key={s.key} variant={sort === s.key ? "default" : "outline"}
                  className="cursor-pointer text-[10px]" onClick={() => setSort(s.key)}>
                  {s.label}
                </Badge>
              ))}
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-1 pr-2">
                {rows.map((r) => (
                  <button
                    key={r.registration}
                    onClick={() => setSelected(r.registration)}
                    className={`w-full text-left rounded border p-2 transition-colors ${
                      selected === r.registration ? "border-primary bg-primary/10" : "border-border bg-muted/20 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{r.registration}</span>
                      <Badge variant={Number(r.risk_score) >= 60 ? "destructive" : "secondary"} className="font-mono text-[10px]">
                        {Number(r.risk_score || 0).toFixed(0)}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {r.operator || "Unregistered"} · {r.aircraft_type || "type unknown"}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground">
                      {Number(r.detections || 0).toLocaleString()} pings ·
                      {" "}{Number(r.faa_violations || 0) + Number(r.sentinel_violations || 0)} violations ·
                      {" "}{Number(r.partner_count || 0)} partners
                      {Number(r.aoi_pings || 0) > 0 && <> · AOI {Number(r.aoi_pings).toLocaleString()}</>}
                    </div>
                  </button>
                ))}
                {!rows.length && !loading && (
                  <p className="text-xs text-muted-foreground p-4 text-center">No aircraft match these filters.</p>
                )}
              </div>
            </ScrollArea>
          </Card>

          <div className="min-h-[560px]">
            <AircraftDossier registration={selected} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

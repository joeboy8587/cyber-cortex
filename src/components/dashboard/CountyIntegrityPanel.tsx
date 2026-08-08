import { useCallback, useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, RefreshCw, Download, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { downloadCSV, forensicFilename } from "@/lib/csv";

type CountyStats = {
  totals: { total_rows: string; derived_rows: string; no_position: string };
  byCounty: { county: string | null; rows: string }[];
  legacy: { county: string; rows: string }[];
  disagreements: number;
};

const fmt = (n: number | string | null) => new Intl.NumberFormat().format(Number(n) || 0);

export function CountyIntegrityPanel() {
  const { toast } = useToast();
  const [stats, setStats] = useState<CountyStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const { data, error } = await supabase.functions.invoke("neon-archive-integrity", {
        body: { action: "countyStats" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStats(data.data ?? data);
    } catch (err) {
      toast({
        title: "County stats unavailable",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const rederive = async () => {
    setBusy("backfill");
    try {
      let inserted = 0;
      let remaining = 0;
      for (let i = 0; i < 3; i++) {
        const { data, error } = await supabase.functions.invoke("neon-archive-integrity", {
          body: { action: "countyBackfill", batchSize: 200000 },
        });
        if (error) throw error;
        const r = data?.data ?? data;
        inserted += Number(r.inserted || 0);
        remaining = Number(r.remaining || 0);
        if (!Number(r.inserted)) break;
      }
      toast({
        title: "County derivation",
        description: `${fmt(inserted)} detections classified · ${fmt(remaining)} remaining`,
      });
      await load();
    } catch (err) {
      toast({
        title: "Derivation failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const exportCounties = () => {
    if (!stats) return;
    const legacyMap = new Map(stats.legacy.map((l) => [l.county, Number(l.rows)]));
    downloadCSV(
      stats.byCounty.map((c) => ({
        county: c.county ?? "(no position)",
        detections_coordinate_derived: Number(c.rows),
        detections_legacy_label: legacyMap.get(c.county ?? "") ?? 0,
      })),
      forensicFilename("COUNTY-INTEGRITY", "DERIVED_VS_LEGACY"),
      ["county", "detections_coordinate_derived", "detections_legacy_label"],
    );
  };

  const total = Number(stats?.totals?.total_rows ?? 0);
  const derived = Number(stats?.totals?.derived_rows ?? 0);
  const pct = total ? Math.round((derived / total) * 100) : 0;
  const maxRows = Math.max(1, ...(stats?.byCounty ?? []).map((c) => Number(c.rows)));

  return (
    <CyberPanel title="County classification integrity" icon={<MapPin className="h-4 w-4" />}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          County labels are recomputed from each detection&apos;s own coordinates against real
          county polygons. The original <code className="font-mono">county_classification</code>{" "}
          column is preserved untouched for chain of custody.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={rederive} disabled={!!busy}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "backfill" ? "animate-spin" : ""}`} />
            Re-derive counties
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={!!busy}>
            Refresh stats
          </Button>
          <Button size="sm" variant="outline" onClick={exportCounties} disabled={!stats}>
            <Download className="mr-2 h-4 w-4" /> Export comparison
          </Button>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {fmt(derived)} / {fmt(total)} detections coordinate-classified
            </span>
            <span>{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
        </div>

        {stats && stats.disagreements > 0 && (
          <div className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span>
              {fmt(stats.disagreements)} detections were mislabelled by the legacy county column and
              are now correctly attributed.
            </span>
          </div>
        )}

        <div className="space-y-1">
          {(stats?.byCounty ?? []).map((c) => (
            <div key={c.county ?? "none"} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono">{c.county ?? "(no position)"}</span>
                <Badge variant="outline">{fmt(c.rows)}</Badge>
              </div>
              <div className="h-1 w-full rounded bg-muted">
                <div
                  className="h-1 rounded bg-primary"
                  style={{ width: `${(Number(c.rows) / maxRows) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!stats && <p className="text-sm text-muted-foreground">Loading county census…</p>}
        </div>
      </div>
    </CyberPanel>
  );
}

export default CountyIntegrityPanel;

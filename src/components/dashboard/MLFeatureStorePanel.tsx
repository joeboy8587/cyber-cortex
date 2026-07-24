import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Brain, Database, Play, TrendingUp } from "lucide-react";

type BuildStats = {
  built_or_updated?: number;
  faa_enriched?: number;
  labeled_policy?: number;
  labeled_autoflag?: number;
  stats?: { total_rows?: number; aircraft?: number; labeled_rows?: number; last_build?: string };
};

type ScoreRow = {
  icao24: string; day: string;
  faa_type?: string | null; faa_owner?: string | null;
  label: number; iforest_score: number; xgb_prob: number; ensemble: number;
};

export function MLFeatureStorePanel() {
  const [days, setDays] = useState(7);
  const [building, setBuilding] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [build, setBuild] = useState<BuildStats | null>(null);
  const [results, setResults] = useState<ScoreRow[]>([]);
  const [training, setTraining] = useState<{ positives: number; total: number; features: number } | null>(null);

  async function runBuild() {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("ml-feature-store", {
        body: { action: "build", days },
      });
      if (error) throw error;
      setBuild(data);
      toast.success(`Feature store rebuilt: ${data.built_or_updated ?? 0} rows`);
    } catch (e: any) {
      toast.error(`Build failed: ${e.message || e}`);
    } finally { setBuilding(false); }
  }

  async function runScore() {
    setScoring(true);
    try {
      const { data, error } = await supabase.functions.invoke("ml-anomaly-score", {
        body: { days, limit: 50 },
      });
      if (error) throw error;
      setResults(data.results || []);
      setTraining(data.training || null);
      toast.success(`Scored ${data.results?.length ?? 0} aircraft-days`);
    } catch (e: any) {
      toast.error(`Score failed: ${e.message || e}`);
    } finally { setScoring(false); }
  }

  return (
    <Card className="border-cyan-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-cyan-500 font-mono uppercase tracking-wider text-sm">
          <Brain className="h-4 w-4" />
          ML Feature Store + Ensemble (Phase 1+2)
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">
          Per-(icao,day) features · Isolation Forest surrogate · XGBoost weight-of-evidence · fused ensemble
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-xs font-mono text-muted-foreground">Lookback (days):</label>
          <input
            type="number" min={1} max={30} value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))}
            className="w-16 bg-background border border-border rounded px-2 py-1 text-xs font-mono"
          />
          <Button size="sm" onClick={runBuild} disabled={building} variant="outline">
            <Database className="h-3 w-3 mr-1" />
            {building ? "Building…" : "Rebuild features"}
          </Button>
          <Button size="sm" onClick={runScore} disabled={scoring} className="bg-cyan-600 hover:bg-cyan-500">
            <Play className="h-3 w-3 mr-1" />
            {scoring ? "Scoring…" : "Run ensemble"}
          </Button>
        </div>

        {build && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            <Stat label="Rows built" value={build.built_or_updated ?? 0} />
            <Stat label="FAA enriched" value={build.faa_enriched ?? 0} />
            <Stat label="Policy labels" value={build.labeled_policy ?? 0} />
            <Stat label="Auto-flag labels" value={build.labeled_autoflag ?? 0} />
            <Stat label="Total rows" value={build.stats?.total_rows ?? 0} />
            <Stat label="Aircraft" value={build.stats?.aircraft ?? 0} />
            <Stat label="Labeled" value={build.stats?.labeled_rows ?? 0} />
            <Stat label="Last build" value={build.stats?.last_build ? new Date(build.stats.last_build).toLocaleString() : "—"} />
          </div>
        )}

        {training && (
          <div className="text-xs font-mono text-muted-foreground border-l-2 border-cyan-500/50 pl-2">
            Training: {training.positives}/{training.total} labeled · {training.features} features
            {training.positives < 3 && (
              <span className="ml-2 text-amber-500">
                (low label count → XGB fallback weights; rebuild after more flags accumulate)
              </span>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="border border-border rounded overflow-hidden">
            <div className="bg-muted/40 px-3 py-1.5 text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-3 w-3" />
              Top ensemble anomalies
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/20 sticky top-0">
                  <tr className="text-left">
                    <th className="px-2 py-1">ICAO24</th>
                    <th className="px-2 py-1">Day</th>
                    <th className="px-2 py-1">FAA</th>
                    <th className="px-2 py-1 text-right">IForest</th>
                    <th className="px-2 py-1 text-right">XGB</th>
                    <th className="px-2 py-1 text-right">Ensemble</th>
                    <th className="px-2 py-1">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="px-2 py-1 font-semibold">{r.icao24}</td>
                      <td className="px-2 py-1 text-muted-foreground">{String(r.day).slice(0, 10)}</td>
                      <td className="px-2 py-1 text-muted-foreground truncate max-w-[180px]">
                        {r.faa_owner || r.faa_type || "—"}
                      </td>
                      <td className="px-2 py-1 text-right">{r.iforest_score.toFixed(3)}</td>
                      <td className="px-2 py-1 text-right">{r.xgb_prob.toFixed(3)}</td>
                      <td className="px-2 py-1 text-right">
                        <Badge
                          variant="outline"
                          className={r.ensemble >= 0.7 ? "border-red-500 text-red-400"
                            : r.ensemble >= 0.5 ? "border-amber-500 text-amber-400"
                            : "border-cyan-500/40 text-cyan-400"}
                        >
                          {r.ensemble.toFixed(3)}
                        </Badge>
                      </td>
                      <td className="px-2 py-1">
                        {r.label > 0 ? <Badge className="bg-red-600">FLAGGED</Badge> : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border border-border/60 rounded p-2">
      <div className="text-muted-foreground uppercase text-[10px]">{label}</div>
      <div className="text-foreground truncate">{value}</div>
    </div>
  );
}

import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Brain, Loader2, RefreshCw, Activity, ScanSearch } from "lucide-react";

type Tier = "CERTAIN" | "HIGH" | "MODERATE" | "LOW" | "GHOST";
const TIER_VARIANT: Record<Tier, any> = {
  CERTAIN: "destructive", HIGH: "destructive", MODERATE: "default", LOW: "secondary", GHOST: "outline",
};

export function JosiahConfidencePanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [scoreResult, setScoreResult] = useState<any>(null);
  const [recent, setRecent] = useState<any>(null);

  async function run(action: string, body: any = {}, setter: (d: any) => void) {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke("josiah-confidence-engine", {
        body: { action, ...body },
      });
      if (error) throw error;
      setter(data);
      toast({ title: `Josiah · ${action}`, description: data?.narrative?.split("\n")[0] || "complete" });
    } catch (e: any) {
      toast({ title: `${action} failed`, description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <CyberPanel title="Josiah Confidence Engine — Meta-Cognition" icon={<Brain className="w-4 h-4" />} variant="default">
      <div className="p-4 space-y-4">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          5-factor self-scoring on every detection (ADS-B integrity · transponder behavior · geospatial plausibility · temporal consistency · behavioral match).
          Layer 4 Bayesian feedback re-weights factors based on hit/miss outcomes. Calibration drift is tracked daily.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Button onClick={() => run("score", { limit: 200 }, setScoreResult)} disabled={!!busy} variant="default">
            {busy === "score" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <ScanSearch className="w-3 h-3 mr-2" />}
            Score last 24h (200)
          </Button>
          <Button onClick={() => run("meta_report", {}, setMeta)} disabled={!!busy} variant="secondary">
            {busy === "meta_report" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Activity className="w-3 h-3 mr-2" />}
            Generate meta-report
          </Button>
          <Button onClick={() => run("recent", {}, setRecent)} disabled={!!busy} variant="outline">
            {busy === "recent" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
            Load recent scores
          </Button>
        </div>

        {scoreResult && (
          <div className="border border-primary/30 rounded p-3 bg-background/50 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-primary">Scored</Badge>
              <span className="text-xs font-mono">{scoreResult.evaluated} detections · weights v{scoreResult.weights_version}</span>
              {Object.entries(scoreResult.tier_counts || {}).map(([k, v]: any) => (
                <Badge key={k} variant={TIER_VARIANT[k as Tier] || "outline"} className="text-[10px]">{k}: {v}</Badge>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-[11px] max-h-64 overflow-y-auto">
              {(scoreResult.sample || []).map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between border border-border/50 rounded px-2 py-1">
                  <span className="font-mono">{s.registration || s.icao24}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">{s.score}</span>
                    <Badge variant={TIER_VARIANT[s.tier as Tier] || "outline"} className="text-[9px]">{s.tier}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {meta && (
          <div className="border border-primary/30 rounded p-3 bg-background/50 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-primary">Meta-Confidence Report</Badge>
              <span className="text-xs font-mono">weights v{meta.weights_version}</span>
            </div>
            <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap">{meta.narrative}</pre>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[10px] font-mono">
              {Object.entries(meta.weights || {}).map(([k, v]: any) => (
                <div key={k} className="border border-border/50 rounded px-2 py-1">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="text-primary">{(Number(v) * 100).toFixed(1)}%</div>
                  {meta.adjustments?.[k] !== undefined && (
                    <div className={meta.adjustments[k] > 0 ? "text-success" : "text-destructive"}>
                      {meta.adjustments[k] > 0 ? "+" : ""}{meta.adjustments[k]}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {recent && Array.isArray(recent.scored) && (
          <div className="border border-primary/30 rounded p-3 bg-background/50 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-primary">Recent Persisted Scores</Badge>
              <span className="text-xs font-mono">{recent.scored.length} rows</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-1 text-[10px] max-h-72 overflow-y-auto">
              {recent.scored.slice(0, 60).map((s: any, i: number) => (
                <div key={i} className="flex items-center justify-between border border-border/50 rounded px-2 py-1">
                  <span className="font-mono truncate">{s.registration || s.icao24}</span>
                  <div className="flex items-center gap-1">
                    <span>{Number(s.score).toFixed(0)}</span>
                    <Badge variant={TIER_VARIANT[s.tier as Tier] || "outline"} className="text-[9px]">{s.tier}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

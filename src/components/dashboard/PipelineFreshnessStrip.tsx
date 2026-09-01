import { useCallback, useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface FreshnessRow {
  stage: string;
  latest: string | null;
  row_count: number;
}

// Stages that can be brought up to date on demand.
const REFRESH_JOBS: Record<string, { fn: string; body: Record<string, unknown>; label: string }> = {
  "Merkle ledger": { fn: "merkle-anchor", body: { action: "anchorBatch", batchSize: 500 }, label: "Seal new evidence" },
  "Policy violations": { fn: "policy-violation-scan", body: { lookbackDays: 30 }, label: "Re-scan violations" },
  "Sentinel threats": { fn: "sentinel-v2", body: {}, label: "Re-score threats" },
  "Exhibits": { fn: "promotion-engine", body: {}, label: "Run promotion rules" },
};

function ageDays(latest: string | null): number | null {
  if (!latest) return null;
  return Math.floor((Date.now() - new Date(latest).getTime()) / 86_400_000);
}

function statusOf(days: number | null): "ok" | "warn" | "stalled" {
  if (days === null) return "stalled";
  if (days <= 2) return "ok";
  if (days <= 14) return "warn";
  return "stalled";
}

const STATUS_STYLES: Record<string, string> = {
  ok: "border-success/50 text-success bg-success/10",
  warn: "border-warning/50 text-warning bg-warning/10",
  stalled: "border-destructive/50 text-destructive bg-destructive/10",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "CURRENT",
  warn: "AGING",
  stalled: "STALLED",
};


export function PipelineFreshnessStrip() {
  const { toast } = useToast();
  const [rows, setRows] = useState<FreshnessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("v_pipeline_freshness" as never)
      .select("*");
    setRows(((data || []) as unknown) as FreshnessRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runJob = async (stage: string) => {
    const job = REFRESH_JOBS[stage];
    if (!job) return;
    setRunning(stage);
    try {
      const { error } = await supabase.functions.invoke(job.fn, { body: job.body });
      if (error) throw error;
      toast({ title: `${stage} updated`, description: "New results are being written now." });
      setTimeout(load, 3000);
    } catch (e) {
      toast({
        title: `${stage} could not be updated`,
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRunning(null);
    }
  };

  const stalled = rows.filter((r) => statusOf(ageDays(r.latest)) === "stalled").length;

  return (
    <CyberPanel
      title="Evidence Pipeline Health"
      icon={<Activity className="w-4 h-4" />}
      variant={stalled > 0 ? "threat" : "success"}
      headerActions={
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <div className="p-3 sm:p-4">
        {stalled > 0 && (
          <p className="font-mono text-[11px] text-destructive mb-3">
            {stalled} pipeline stage{stalled === 1 ? "" : "s"} have not received new data in over 14 days.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {rows.map((r) => {
            const days = ageDays(r.latest);
            const st = statusOf(days);
            const job = REFRESH_JOBS[r.stage];
            return (
              <div key={r.stage} className={`rounded border p-2.5 ${STATUS_STYLES[st]}`}>
                <div className="font-mono text-[10px] uppercase tracking-wider opacity-80 truncate">
                  {r.stage}
                </div>
                <div className="font-display text-lg leading-tight">
                  {Number(r.row_count || 0).toLocaleString()}
                </div>
                <div className="flex items-center justify-between gap-1 mt-1">
                  <span className="font-mono text-[10px] opacity-80">
                    {days === null ? "no data" : days === 0 ? "today" : `${days}d ago`}
                  </span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 border-current">
                    {STATUS_LABEL[st]}
                  </Badge>
                </div>
                {job && st !== "ok" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2 h-7 text-[10px] border-current"
                    disabled={running === r.stage}
                    onClick={() => runJob(r.stage)}
                  >
                    <Play className={`w-3 h-3 mr-1 ${running === r.stage ? "animate-pulse" : ""}`} />
                    {running === r.stage ? "Running…" : job.label}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </CyberPanel>
  );

}

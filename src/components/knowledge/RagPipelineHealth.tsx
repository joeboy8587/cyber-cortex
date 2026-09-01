import { useCallback, useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench, FileStack } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type StuckDoc = {
  id: string;
  title: string;
  status: string;
  status_message: string | null;
  updated_at: string;
  chunk_count: number | null;
};

const STATUS_TONE: Record<string, string> = {
  ready: "text-success border-success/40",
  failed: "text-destructive border-destructive/40",
};

export function RagPipelineHealth() {
  const { toast } = useToast();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [stuck, setStuck] = useState<StuckDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-ingest", { body: { action: "status" } });
      if (error) throw error;
      setCounts(data?.counts ?? {});
      setTotal(data?.total ?? 0);
      setStuck(data?.stuck ?? []);
    } catch (e) {
      toast({
        title: "Could not read document pipeline",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const repair = async () => {
    setRepairing(true);
    try {
      const { data, error } = await supabase.functions.invoke("rag-ingest", {
        body: { action: "repair_stuck", limit: 5 },
      });
      if (error) throw error;
      toast({
        title: "Repair started",
        description: `${data?.requeued?.length ?? 0} document(s) re-queued. ${Math.max(0, (data?.stuck_total ?? 0) - (data?.requeued?.length ?? 0))} still waiting — run again when these finish.`,
      });
      setTimeout(load, 4000);
    } catch (e) {
      toast({
        title: "Repair failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRepairing(false);
    }
  };

  const ready = counts.ready ?? 0;
  const healthy = stuck.length === 0;

  return (
    <CyberPanel title="Document Pipeline Health" icon={<FileStack className="w-4 h-4" />}>
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_TONE.ready}>
            {ready} ready
          </Badge>
          {Object.entries(counts)
            .filter(([s]) => s !== "ready")
            .map(([s, n]) => (
              <Badge key={s} variant="outline" className={STATUS_TONE[s] ?? "text-warning border-warning/40"}>
                {n} {s}
              </Badge>
            ))}
          <span className="text-xs text-muted-foreground">of {total} uploaded</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={repair} disabled={repairing || healthy}>
              <Wrench className={`w-4 h-4 mr-1 ${repairing ? "animate-pulse" : ""}`} />
              {repairing ? "Repairing…" : "Retry stuck documents"}
            </Button>
          </div>
        </div>

        {healthy ? (
          <div className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="w-4 h-4" /> Every uploaded document finished processing.
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {stuck.length} document{stuck.length === 1 ? "" : "s"} stopped part-way through and contribute nothing
                to search or Josiah's recall. Retrying restarts them from the beginning, five at a time.
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2">Document</th>
                    <th className="text-left">Stopped at</th>
                    <th className="text-left">Last message</th>
                    <th className="text-right">Stalled for</th>
                  </tr>
                </thead>
                <tbody>
                  {stuck.map((d) => (
                    <tr key={d.id} className="border-b border-border/40">
                      <td className="py-2 pr-2">{d.title}</td>
                      <td className="text-warning font-mono">{d.status}</td>
                      <td className="text-muted-foreground max-w-[280px] truncate">{d.status_message || "—"}</td>
                      <td className="text-right text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(d.updated_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

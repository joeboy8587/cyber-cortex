import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, Network, GitBranch, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Result = { kind: string; ok: boolean; payload: any; ts: string };

export function ForceMultiplierPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<Result[]>([]);

  const run = async (kind: string, fn: string, body: any = {}) => {
    setBusy(kind);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body });
      const payload = error ? { error: error.message } : data;
      setHistory((h) => [{ kind, ok: !error, payload, ts: new Date().toISOString() }, ...h].slice(0, 8));
    } catch (e: any) {
      setHistory((h) => [{ kind, ok: false, payload: { error: e.message ?? String(e) }, ts: new Date().toISOString() }, ...h].slice(0, 8));
    } finally {
      setBusy(null);
    }
  };

  const actions = [
    {
      kind: "Build Unified Views",
      icon: <Database className="w-3.5 h-3.5" />,
      desc: "Collapse 800 tables into mv_spacetime / mv_entities / mv_correlations",
      onClick: () => run("Build Unified Views", "materialized-views", { action: "createUnified" }),
    },
    {
      kind: "Anomaly Sweep",
      icon: <Zap className="w-3.5 h-3.5" />,
      desc: "Robust z-score + Benford's Law over the unified spacetime view",
      onClick: () => run("Anomaly Sweep", "anomaly-sweep"),
    },
    {
      kind: "Graph PageRank",
      icon: <Network className="w-3.5 h-3.5" />,
      desc: "Co-presence network → PageRank → top hubs auto-flagged",
      onClick: () => run("Graph PageRank", "graph-pagerank"),
    },
    {
      kind: "View Stats",
      icon: <GitBranch className="w-3.5 h-3.5" />,
      desc: "Check materialized view row counts & populated state",
      onClick: () => run("View Stats", "materialized-views", { action: "stats" }),
    },
  ];

  return (
    <CyberPanel title="Force Multipliers" icon={<Zap className="w-4 h-4" />}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Machine-driven analysis over 20M+ records. Each tool returns in seconds (or kicks off in
          background) and auto-promotes high-confidence findings into the autonomous flag stream.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <button
              key={a.kind}
              onClick={a.onClick}
              disabled={!!busy}
              className="text-left p-2.5 rounded border border-border/50 hover:border-primary/60 hover:bg-primary/5 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                {a.icon}
                {a.kind}
                {busy === a.kind && (
                  <span className="ml-auto text-[10px] text-muted-foreground animate-pulse">running…</span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">{a.desc}</div>
            </button>
          ))}
        </div>

        {history.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Recent Runs</div>
            <ScrollArea className="h-48 rounded border border-border/40">
              <div className="p-2 space-y-2">
                {history.map((h, i) => (
                  <div key={i} className="text-[11px] font-mono">
                    <div className="flex items-center gap-2">
                      <Badge variant={h.ok ? "default" : "destructive"} className="text-[9px] py-0 h-4">
                        {h.ok ? "OK" : "ERR"}
                      </Badge>
                      <span className="font-semibold">{h.kind}</span>
                      <span className="text-muted-foreground ml-auto">{h.ts.slice(11, 19)}</span>
                    </div>
                    <pre className="mt-1 p-1.5 rounded bg-muted/40 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(h.payload, null, 1).slice(0, 800)}
                    </pre>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

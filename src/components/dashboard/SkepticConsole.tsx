import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Scale, Loader2, ShieldAlert, ShieldCheck, ShieldX, Gavel } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ReasoningRow {
  id: string;
  detection_ref: string;
  module: string;
  payload: any;
  bayes_factor: number | null;
  content_hash: string;
  created_at: string;
}

const VerdictBadge = ({ verdict }: { verdict: string }) => {
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    SURVIVES: { cls: "bg-green-500/10 border-green-500/40 text-green-400", icon: ShieldCheck, label: "SURVIVES" },
    WEAK: { cls: "bg-amber-500/10 border-amber-500/40 text-amber-400", icon: ShieldAlert, label: "WEAK" },
    REJECTED: { cls: "bg-red-500/10 border-red-500/40 text-red-400", icon: ShieldX, label: "REJECTED" },
  };
  const v = map[verdict] || map.WEAK;
  const Icon = v.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono ${v.cls}`}>
      <Icon className="w-3 h-3" /> {v.label}
    </span>
  );
};

export function SkepticConsole() {
  const [rows, setRows] = useState<ReasoningRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Demo form
  const [tail, setTail] = useState("N790FA");
  const [hyp, setHyp] = useState("STARING_PATTERN");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("reasoning_outputs")
      .select("*")
      .eq("module", "skeptic")
      .order("created_at", { ascending: false })
      .limit(25);
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runChallenge = async () => {
    if (!tail.trim() || !hyp.trim()) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("skeptic-engine", {
        body: {
          detection_ref: tail.trim().toUpperCase(),
          hypothesis: hyp.trim().toUpperCase(),
          evidence: {
            registry: tail.trim().toUpperCase(),
            altitude: 775,
            proximity_nm: 0.3,
            night_ops_pct: 24.5,
            detections: 158363,
          },
        },
      });
      if (error) throw error;
      toast({
        title: `Verdict: ${data?.verdict || "—"}`,
        description: `Bayes factor ${data?.combined_bayes_factor ?? "—"}`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Challenge failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <CyberPanel title="Skeptic Engine — Adversarial Hypothesis" icon={<Scale className="w-5 h-5" />} variant="default">
      <div className="space-y-4">
        <div className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3">
          Every hypothesis must survive 3 null-hypothesis challenges with a Bayes factor ≥ 10 before publication.
          Weak (3–10) or rejected (&lt;3) findings auto-downgrade to <span className="font-mono text-amber-400">UNRESOLVED_ANOMALY</span>.
        </div>

        {/* Run form */}
        <div className="flex flex-wrap gap-2 p-3 rounded border border-border/50 bg-background/30">
          <Input value={tail} onChange={(e) => setTail(e.target.value)} placeholder="Tail / registry" className="w-36 font-mono" />
          <Input value={hyp} onChange={(e) => setHyp(e.target.value)} placeholder="Hypothesis (e.g. STARING_PATTERN)" className="flex-1 min-w-[200px] font-mono" />
          <Button onClick={runChallenge} disabled={running} size="sm">
            {running ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Gavel className="w-4 h-4 mr-1" />}
            Challenge
          </Button>
        </div>

        {/* Results */}
        {loading ? (
          <div className="text-center py-6 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No challenges run yet. Submit a hypothesis above.</div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {rows.map((r) => {
              const p = r.payload || {};
              const verdict = p.verdict || "WEAK";
              const open = openId === r.id;
              return (
                <div key={r.id} className="rounded border border-border/50 bg-background/30">
                  <button onClick={() => setOpenId(open ? null : r.id)} className="w-full flex items-center justify-between p-3 hover:bg-background/50 transition">
                    <div className="flex items-center gap-3 text-left">
                      <span className="font-mono text-sm text-primary">{r.detection_ref}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.hypothesis}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">BF {r.bayes_factor ?? "—"}</span>
                      <VerdictBadge verdict={verdict} />
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border/40 pt-3">
                      {(p.nulls || []).map((n: any, i: number) => (
                        <div key={i} className="p-2 rounded bg-background/40 border border-border/30">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-xs text-amber-400">{n.null_name}</span>
                            <Badge variant="outline" className="font-mono text-xs">BF {n.bayes_factor}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mb-1">{n.null_claim}</div>
                          <div className="text-xs"><span className="text-muted-foreground">Rebuttal:</span> {n.rebuttal_evidence}</div>
                        </div>
                      ))}
                      <div className="text-[10px] font-mono text-muted-foreground pt-1 break-all">SHA-256: {r.content_hash}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

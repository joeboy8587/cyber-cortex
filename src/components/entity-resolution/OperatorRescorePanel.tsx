import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Target, Users } from "lucide-react";

export function OperatorRescorePanel() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<"none" | "profiles" | "rescore">("none");
  const [tails, setTails] = useState("N912KC,N913KC,N597E,N949SL,N4022W,N473CA,N791FA");
  const [result, setResult] = useState<any>(null);

  async function rebuildProfiles(includeHeavy = false) {
    setBusy("profiles");
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("operator-profile-builder", { body: { includeHeavy } });
      if (error) throw error;
      setResult(data);
      toast({ title: "Operator profiles rebuilt", description: `${data?.profiles_upserted ?? 0} profiles upserted` });
    } catch (e: any) {
      toast({ title: "Profile build failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy("none");
    }
  }

  async function rescoreThreats(targetTails?: string[]) {
    setBusy("rescore");
    setResult(null);
    try {
      const body = targetTails?.length ? { registrations: targetTails } : { maxRows: 500 };
      const { data, error } = await supabase.functions.invoke("threat-rescore-engine", { body });
      if (error) throw error;
      setResult(data);
      toast({ title: "Threats re-scored", description: `${data?.upserted ?? 0} threats updated` });
    } catch (e: any) {
      toast({ title: "Rescore failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy("none");
    }
  }

  const tailList = tails.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  return (
    <CyberPanel title="Operator Truth & Threat Re-Scoring" icon={<Target className="w-4 h-4" />} variant="default">
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Users className="w-3 h-3" /> Stage 1 — Canonical operator profiles
            </div>
            <Button onClick={rebuildProfiles} disabled={busy !== "none"} className="w-full" variant="secondary">
              {busy === "profiles" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
              Rebuild operator profiles (Neon)
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Aggregates registration across live detections, biometric correlations, alert logs, flight events &amp; FAA registry into one canonical row per tail.
            </p>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Target className="w-3 h-3" /> Stage 2 — Re-score threats (6-layer)
            </div>
            <div className="flex gap-2">
              <Button onClick={() => rescoreThreats()} disabled={busy !== "none"} className="flex-1" variant="default">
                {busy === "rescore" ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-2" />}
                Re-score top 500 tails
              </Button>
            </div>
            <div className="flex gap-2">
              <Input value={tails} onChange={(e) => setTails(e.target.value)} placeholder="N912KC,N913KC,..." className="text-xs h-8" />
              <Button size="sm" variant="outline" onClick={() => rescoreThreats(tailList)} disabled={busy !== "none" || !tailList.length}>
                Sanity-list
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Scores: physics + identity + proximity + biometric + network + repetition. Writes <code>score_breakdown</code> JSON for court-defensible audit.
            </p>
          </div>
        </div>

        {result && (
          <div className="border border-primary/30 rounded p-3 bg-background/50">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-primary">Result</Badge>
              <span className="text-xs font-mono text-muted-foreground">
                {result.profiles_upserted !== undefined
                  ? `${result.profiles_upserted} profiles, sources: ${(result.sources_used || []).join(", ")}`
                  : `${result.upserted}/${result.evaluated} tails re-scored`}
              </span>
            </div>
            {Array.isArray(result.sample) && result.sample.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {result.sample.slice(0, 12).map((s: any) => (
                  <div key={s.registration} className="flex items-center justify-between border border-border/50 rounded px-2 py-1">
                    <span className="font-mono">{s.registration}</span>
                    <Badge variant={s.level >= 4 ? "destructive" : s.level >= 3 ? "default" : "secondary"} className="text-[10px]">
                      L{s.level} · {s.score}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

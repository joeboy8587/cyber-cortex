import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Scale, Loader2, FileCheck, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Criterion {
  name: string;
  score: number;
  max: number;
  evidence: string;
  source: string;
}

interface Result {
  subject: string;
  icao: string | null;
  criteria: Criterion[];
  totalScore: number;
  maxScore: number;
  pct: number;
  verdict: string;
  narrative: string;
  content_hash: string;
}

export function ProsecutionTimelinePanel() {
  const [subject, setSubject] = useState("population-scale aerial surveillance over Oildale AOI");
  const [icao, setIcao] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("bradford-hill-synthesizer", {
        body: { subject, icao: icao.trim() || null },
      });
      if (error) throw error;
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const verdictColor = (pct: number) =>
    pct >= 80 ? "text-green-400" : pct >= 60 ? "text-yellow-400" : pct >= 40 ? "text-amber-400" : "text-red-400";

  return (
    <CyberPanel
      title="Bradford Hill Synthesizer · Phase 3"
      icon={<Scale className="w-5 h-5" />}
      variant="default"
    >
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            className="md:col-span-2"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject / claim under causation review"
          />
          <Input
            value={icao}
            onChange={(e) => setIcao(e.target.value)}
            placeholder="Optional ICAO filter (e.g. ae1f7c)"
          />
        </div>
        <Button onClick={run} disabled={loading} className="w-full">
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Synthesizing…</> : <><Scale className="w-4 h-4 mr-2" />Run Bradford Hill</>}
        </Button>

        {error && (
          <div className="p-3 bg-destructive/20 border border-destructive/50 rounded text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-background/60 border border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Causation Confidence</span>
                <span className={`text-2xl font-mono font-bold ${verdictColor(result.pct)}`}>{result.pct}%</span>
              </div>
              <Progress value={result.pct} className="h-2" />
              <p className={`text-sm mt-2 font-medium ${verdictColor(result.pct)}`}>{result.verdict}</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-2 truncate">
                sha256: {result.content_hash}
              </p>
            </div>

            <ScrollArea className="h-[320px]">
              <div className="space-y-2">
                {result.criteria.map((c) => (
                  <div key={c.name} className="p-3 rounded bg-muted/20 border border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className={`font-mono text-sm ${verdictColor((c.score / c.max) * 100)}`}>
                        {c.score}/{c.max}
                      </span>
                    </div>
                    <Progress value={(c.score / c.max) * 100} className="h-1 mb-2" />
                    <p className="text-xs text-muted-foreground">{c.evidence}</p>
                    <p className="text-[10px] font-mono text-muted-foreground/70 mt-1">source: {c.source}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {result.narrative && (
              <div className="p-3 rounded bg-primary/5 border border-primary/30">
                <div className="flex items-center gap-2 mb-1 text-xs text-primary">
                  <FileCheck className="w-3.5 h-3.5" /> Prosecution Brief Narrative
                </div>
                <p className="text-sm whitespace-pre-wrap text-foreground/90">{result.narrative}</p>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
          Deterministic SQL scoring per Bradford Hill criterion. AI is used only as a narrative wrapper —
          it cannot invent numbers. All outputs sha256-hashed to <code>reasoning_outputs</code>.
        </p>
      </div>
    </CyberPanel>
  );
}

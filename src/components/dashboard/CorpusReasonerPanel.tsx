import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, BookOpen, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LensResult {
  lens: string;
  matches?: Array<{ title: string; similarity: string; content: string }>;
  error?: string;
}

interface BriefResponse {
  subject: string;
  lenses: LensResult[];
  total_matches: number;
  brief: string;
  content_hash: string;
}

const LENS_COLOR: Record<string, string> = {
  operator: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  regulations: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  doctrine: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  precedent: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

export function CorpusReasonerPanel() {
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BriefResponse | null>(null);

  async function run() {
    if (!subject.trim()) {
      toast.error("Enter a detection subject");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("corpus-reasoner", {
        body: { subject: subject.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      toast.success(`Grounded ${data.total_matches} corpus matches across 4 lenses`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-cyan-500/30 bg-cyan-500/[0.02]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-cyan-400 font-mono uppercase text-sm tracking-wider">
          <BookOpen className="w-4 h-4" />
          Corpus Reasoner — Phase 2
        </CardTitle>
        <p className="text-xs text-muted-foreground font-mono">
          4-lens grounded retrieval: OPERATOR // REGULATIONS // DOCTRINE // PRECEDENT
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. N913WN Southwest 737 at 1000ft 223kts over Oildale"
            onKeyDown={(e) => e.key === "Enter" && run()}
            className="font-mono text-sm"
          />
          <Button onClick={run} disabled={loading} className="bg-cyan-500 hover:bg-cyan-600 text-black">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Ground It"}
          </Button>
        </div>

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="font-mono text-xs">
                {result.total_matches} matches
              </Badge>
              {result.lenses.map((l) => (
                <Badge key={l.lens} className={`font-mono text-xs ${LENS_COLOR[l.lens] || ""}`}>
                  {l.lens}: {l.matches?.length ?? 0}
                </Badge>
              ))}
              <Badge variant="outline" className="font-mono text-[10px] gap-1">
                <Hash className="w-3 h-3" />
                {result.content_hash.slice(0, 12)}…
              </Badge>
            </div>

            <ScrollArea className="h-[420px] rounded border border-cyan-500/20 bg-black/40 p-3">
              <div className="space-y-4">
                {result.lenses.map((l) => (
                  <div key={l.lens}>
                    <div className={`inline-block px-2 py-0.5 rounded text-xs font-mono uppercase border ${LENS_COLOR[l.lens] || ""}`}>
                      {l.lens}
                    </div>
                    {!l.matches?.length && (
                      <p className="text-xs text-muted-foreground font-mono mt-1 italic">
                        no corpus matches
                      </p>
                    )}
                    <div className="mt-2 space-y-2">
                      {l.matches?.map((m, i) => (
                        <div key={i} className="text-xs font-mono border-l-2 border-cyan-500/30 pl-3">
                          <div className="flex items-center gap-2 text-cyan-300/80">
                            <span>[{i + 1}]</span>
                            <span className="truncate">{m.title}</span>
                            <span className="text-muted-foreground ml-auto">sim {m.similarity}</span>
                          </div>
                          <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{m.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

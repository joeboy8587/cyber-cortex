import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, Loader2, Search, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PCIndex { name: string; host: string; dimension: number; metric: string; }
interface MultiResult { index: string; host: string; dimension: number; matches: Array<{ id: string; score: number; metadata?: any }>; }

export function PineconeSearchPanel() {
  const [indexes, setIndexes] = useState<PCIndex[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MultiResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("pinecone-search", {
          body: { action: "list_indexes" },
        });
        if (error) throw error;
        setIndexes(data?.indexes ?? []);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setDiscovering(false);
      }
    })();
  }, []);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const { data, error } = await supabase.functions.invoke("pinecone-search", {
        body: { action: "multi_search", query },
      });
      if (error) throw error;
      setResults(data?.results ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CyberPanel
      title="Pinecone Vector Search · All Indexes"
      icon={<Database className="w-5 h-5" />}
      headerActions={
        <Badge variant="outline" className="text-xs">
          {discovering ? "discovering…" : `${indexes.length} indexes`}
        </Badge>
      }
    >
      <div className="p-4 space-y-4">
        {indexes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {indexes.map((i) => (
              <Badge key={i.name} variant="secondary" className="text-[10px] font-mono">
                {i.name} · {i.dimension}d
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Semantic query across every Pinecone index…"
          />
          <Button onClick={run} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>

        {error && (
          <div className="p-3 bg-destructive/20 border border-destructive/50 rounded text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}

        {results.length > 0 && (
          <ScrollArea className="h-[360px]">
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.index} className="border border-border/50 rounded p-2 bg-muted/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-primary">{r.index}</span>
                    <span className="text-[10px] text-muted-foreground">{r.matches.length} matches · {r.dimension}d</span>
                  </div>
                  <div className="space-y-1">
                    {r.matches.slice(0, 5).map((m) => (
                      <div key={m.id} className="p-2 bg-background/40 border border-border/30 rounded">
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-muted-foreground truncate">{m.id}</span>
                          <span className="text-green-400">{(m.score * 100).toFixed(1)}%</span>
                        </div>
                        {m.metadata && (
                          <p className="text-xs text-foreground/80 line-clamp-3">
                            {typeof m.metadata === "string"
                              ? m.metadata
                              : (m.metadata.text || m.metadata.content || JSON.stringify(m.metadata)).toString()}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
          Auto-detects every Pinecone index in your account and embeds your query at the matching dimensionality
          (1536 → OpenAI small, 3072 → Gemini, custom dims supported).
        </p>
      </div>
    </CyberPanel>
  );
}

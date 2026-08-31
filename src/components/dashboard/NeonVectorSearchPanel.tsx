import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, Loader2, Search, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface VectorStore {
  key: string;
  label: string;
  table: string;
  dimension: string;
  est_rows: number;
}

interface StoreResult {
  store: string;
  label: string;
  seed_matches: number;
  matches: Array<{
    id: string;
    snippet: string;
    source_table?: string;
    score: number;
    match_type: "keyword" | "semantic";
  }>;
}

export function NeonVectorSearchPanel() {
  const [stores, setStores] = useState<VectorStore[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<StoreResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(true);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("neon-vector-search", {
          body: { action: "list_stores" },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setStores(data?.stores ?? []);
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
    setSearched(false);
    try {
      const { data, error } = await supabase.functions.invoke("neon-vector-search", {
        body: { action: "search", query, top_k: 8 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResults(data?.results ?? []);
      setSearched(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const totalRows = stores.reduce((n, s) => n + (s.est_rows || 0), 0);

  return (
    <CyberPanel
      title="Watchtower Vector Store · Semantic Search"
      icon={<Database className="w-5 h-5" />}
      headerActions={
        <Badge variant="outline" className="text-xs">
          {discovering ? "discovering…" : `${stores.length} stores`}
        </Badge>
      }
    >
      <div className="p-4 space-y-4">
        {stores.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {stores.map((s) => (
              <Badge key={s.key} variant="secondary" className="text-[10px] font-mono">
                {s.label} · {s.est_rows.toLocaleString()} · {s.dimension}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Search every embedded Watchtower document and evidence record…"
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

        {searched && results.length === 0 && !error && (
          <div className="p-3 border border-border/50 rounded text-sm text-muted-foreground">
            No matching passages found in the vector store. Try broader wording (tail number, operator, county, statute).
          </div>
        )}

        {results.length > 0 && (
          <ScrollArea className="h-[360px]">
            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.store} className="border border-border/50 rounded p-2 bg-muted/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-primary">{r.label}</span>
                    <span className="text-[10px] text-muted-foreground">{r.matches.length} passages</span>
                  </div>
                  <div className="space-y-1">
                    {r.matches.map((m) => (
                      <div key={`${r.store}-${m.id}`} className="p-2 bg-background/40 border border-border/30 rounded">
                        <div className="flex justify-between text-[10px] font-mono mb-1 gap-2">
                          <span className="text-muted-foreground truncate">
                            {m.source_table ? `${m.source_table} · ` : ""}{m.id}
                          </span>
                          <span className={m.match_type === "semantic" ? "text-green-400" : "text-secondary"}>
                            {m.match_type === "semantic" ? `${(m.score * 100).toFixed(1)}% similar` : "keyword hit"}
                          </span>
                        </div>
                        <p className="text-xs text-foreground/80 line-clamp-4 whitespace-pre-wrap">{m.snippet}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <p className="text-[10px] text-muted-foreground border-t border-border pt-2">
          Searches the Neon pgvector stores directly ({totalRows.toLocaleString()} embedded records). Keyword hits seed the
          search, then pgvector expands to the nearest neighbours inside the same embedding space — no external vector
          service required.
        </p>
      </div>
    </CyberPanel>
  );
}

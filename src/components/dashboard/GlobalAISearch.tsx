import { useState, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Search, Sparkles, Send, StopCircle, Loader2, 
  Database, FileText, Plane, Activity, Users,
  AlertTriangle, MapPin, Clock, ExternalLink, Layers, Shield
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface VectorResult {
  source_table: string;
  source_id: string;
  text_content: string;
  similarity: string;
  category: string;
  content_type?: string;
}

interface SearchSuggestion {
  query: string;
  category: string;
}

const suggestions: SearchSuggestion[] = [
  { query: "Show all XXB ghost aircraft detections in the last 24 hours", category: "Flights" },
  { query: "Find biometric anomalies correlated with flight patterns", category: "Health" },
  { query: "List shell companies linked to aircraft registrations", category: "Network" },
  { query: "Show evidence chain for KCSO surveillance incidents", category: "Legal" },
  { query: "What patterns exist between N-numbers and criminal enterprises?", category: "Analysis" },
];

const categoryConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  surveillance: { icon: <Plane className="w-3.5 h-3.5" />, color: "text-blue-400", label: "Surveillance" },
  biometric: { icon: <Activity className="w-3.5 h-3.5" />, color: "text-red-400", label: "Biometric" },
  kcso: { icon: <Shield className="w-3.5 h-3.5" />, color: "text-orange-400", label: "KCSO" },
  legal: { icon: <FileText className="w-3.5 h-3.5" />, color: "text-yellow-400", label: "Legal" },
  enterprise: { icon: <Users className="w-3.5 h-3.5" />, color: "text-purple-400", label: "Enterprise" },
  josiah: { icon: <Sparkles className="w-3.5 h-3.5" />, color: "text-cyan-400", label: "Josiah AI" },
  custody: { icon: <Database className="w-3.5 h-3.5" />, color: "text-green-400", label: "Custody" },
  timeline: { icon: <Clock className="w-3.5 h-3.5" />, color: "text-emerald-400", label: "Timeline" },
  watchtower: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-amber-400", label: "Watchtower" },
  document: { icon: <FileText className="w-3.5 h-3.5" />, color: "text-indigo-400", label: "Document" },
  other: { icon: <Layers className="w-3.5 h-3.5" />, color: "text-muted-foreground", label: "Other" },
};

export function GlobalAISearch() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [vectorResults, setVectorResults] = useState<VectorResult[]>([]);
  const [tablesSearched, setTablesSearched] = useState(0);
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    setIsSearching(true);
    setIsVectorSearching(true);
    setError(null);
    setAiResponse("");
    setVectorResults([]);
    setTablesSearched(0);

    abortRef.current = new AbortController();

    // Run AI search and vector search in parallel
    const aiPromise = runAISearch(q);
    const vectorPromise = runVectorSearch(q);

    await Promise.allSettled([aiPromise, vectorPromise]);
    setIsSearching(false);
  };

  const runVectorSearch = async (q: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('semantic-search', {
        body: { action: 'multi_search', query: q, limit: 20 }
      });

      if (error) throw new Error(error.message);
      
      setVectorResults(data?.results || []);
      setTablesSearched(data?.tables_searched || 0);
    } catch (err) {
      console.error("Vector search error:", err);
    } finally {
      setIsVectorSearching(false);
    }
  };

  const runAISearch = async (q: string) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-search`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ query: q }),
          signal: abortRef.current?.signal,
        }
      );

      if (!response.ok) {
        if (response.status === 429) throw new Error("Rate limit exceeded.");
        if (response.status === 402) throw new Error("Usage limit reached.");
        throw new Error("Search failed");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              setAiResponse(fullResponse);
            }
          } catch {
            // Incomplete JSON
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsSearching(false);
  };

  const getSimilarityColor = (sim: string) => {
    const val = parseFloat(sim);
    if (val >= 0.85) return "text-green-400";
    if (val >= 0.70) return "text-yellow-400";
    return "text-muted-foreground";
  };

  // Group vector results by category
  const groupedResults = vectorResults.reduce<Record<string, VectorResult[]>>((acc, r) => {
    const cat = r.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  return (
    <CyberPanel
      title="Global AI-Powered Search"
      icon={<Sparkles />}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            <Layers className="w-3 h-3 mr-1" />
            238 Vector Tables
          </Badge>
          <Badge variant="outline" className="text-xs">
            <Database className="w-3 h-3 mr-1" />
            18.9M Records
          </Badge>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Semantic search across all 238 vectorized evidence tables..."
            className="w-full pl-10 pr-24 py-3 bg-input border border-border rounded-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isSearching ? (
              <Button variant="destructive" size="sm" onClick={handleCancel} className="h-8">
                <StopCircle className="w-4 h-4 mr-1" />
                Stop
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={() => handleSearch()} disabled={!query.trim()} className="h-8">
                <Send className="w-4 h-4 mr-1" />
                Search
              </Button>
            )}
          </div>
        </div>

        {/* Quick Suggestions */}
        {!aiResponse && !isSearching && vectorResults.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Suggested queries:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  onClick={() => { setQuery(s.query); handleSearch(s.query); }}
                  className="text-xs h-7"
                >
                  <Badge variant="secondary" className="mr-1 text-[10px]">{s.category}</Badge>
                  {s.query.slice(0, 40)}...
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-destructive/20 border border-destructive/50 rounded text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Vector Search Results */}
        {(vectorResults.length > 0 || isVectorSearching) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Semantic Vector Results</span>
                {isVectorSearching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
              </div>
              {tablesSearched > 0 && (
                <span className="text-xs text-muted-foreground">
                  {vectorResults.length} matches across {tablesSearched} tables
                </span>
              )}
            </div>
            
            <ScrollArea className="h-[250px]">
              <div className="space-y-3">
                {Object.entries(groupedResults).map(([category, results]) => {
                  const config = categoryConfig[category] || categoryConfig.other;
                  return (
                    <div key={category} className="space-y-1">
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${config.color}`}>
                        {config.icon}
                        {config.label} ({results.length})
                      </div>
                      {results.map((result, idx) => (
                        <div
                          key={`${result.source_table}-${result.source_id}-${idx}`}
                          className="p-2.5 bg-muted/20 border border-border/50 rounded hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[10px] font-mono text-muted-foreground truncate">
                                  {result.source_table.replace(/_vectors$/, '')}
                                </span>
                                <span className={`text-[10px] font-bold ${getSimilarityColor(result.similarity)}`}>
                                  {(parseFloat(result.similarity) * 100).toFixed(1)}%
                                </span>
                              </div>
                              <p className="text-xs text-foreground line-clamp-2">
                                {result.text_content}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* AI Response */}
        {(aiResponse || (isSearching && !isVectorSearching)) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI Analysis</span>
              {isSearching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            </div>
            <ScrollArea className="h-[200px]">
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {aiResponse || "Analyzing your query across 18.9 million records..."}
                </p>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Stats Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Dual-engine: Semantic Vectors + Lovable AI
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            238 tables • 18.9M records vectorized
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}

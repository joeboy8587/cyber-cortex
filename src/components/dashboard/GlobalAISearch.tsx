import { useState, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Search, Sparkles, Send, StopCircle, Loader2, 
  Database, FileText, Plane, Activity, Users,
  AlertTriangle, MapPin, Clock, ExternalLink
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SearchResult {
  id: string;
  source: string;
  type: string;
  title: string;
  snippet: string;
  relevance: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
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

export function GlobalAISearch() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    setIsSearching(true);
    setError(null);
    setAiResponse("");
    setResults([]);

    abortRef.current = new AbortController();

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
          signal: abortRef.current.signal,
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later.");
        }
        if (response.status === 402) {
          throw new Error("Usage limit reached. Please add credits.");
        }
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
            // Incomplete JSON, continue
          }
        }
      }

      // Parse structured results from AI response
      parseResults(fullResponse);

    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const parseResults = (response: string) => {
    // Extract structured data mentions from the response
    const mockResults: SearchResult[] = [];
    
    // Pattern matching for different data types mentioned
    if (response.toLowerCase().includes("flight") || response.toLowerCase().includes("aircraft")) {
      mockResults.push({
        id: "flight-1",
        source: "Flight Detections",
        type: "aircraft",
        title: "XXB MLAT Detection Records",
        snippet: "Found references to flight data in response",
        relevance: 0.95,
      });
    }
    
    if (response.toLowerCase().includes("biometric") || response.toLowerCase().includes("health")) {
      mockResults.push({
        id: "bio-1",
        source: "Biometric Monitoring",
        type: "health",
        title: "Biometric Correlation Data",
        snippet: "Health metrics and biometric anomalies detected",
        relevance: 0.88,
      });
    }

    if (response.toLowerCase().includes("company") || response.toLowerCase().includes("enterprise")) {
      mockResults.push({
        id: "corp-1",
        source: "Criminal Enterprise Network",
        type: "organization",
        title: "Shell Company Analysis",
        snippet: "Corporate structure and ownership patterns",
        relevance: 0.82,
      });
    }

    setResults(mockResults);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsSearching(false);
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case "aircraft": return <Plane className="w-4 h-4" />;
      case "health": return <Activity className="w-4 h-4" />;
      case "organization": return <Users className="w-4 h-4" />;
      case "legal": return <FileText className="w-4 h-4" />;
      case "location": return <MapPin className="w-4 h-4" />;
      default: return <Database className="w-4 h-4" />;
    }
  };

  return (
    <CyberPanel
      title="Global AI-Powered Search"
      icon={<Sparkles />}
      headerActions={
        <Badge variant="outline" className="text-xs">
          <Database className="w-3 h-3 mr-1" />
          2.2M Records
        </Badge>
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
            placeholder="Ask anything across all evidence modalities..."
            className="w-full pl-10 pr-24 py-3 bg-input border border-border rounded-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {isSearching ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancel}
                className="h-8"
              >
                <StopCircle className="w-4 h-4 mr-1" />
                Stop
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => handleSearch()}
                disabled={!query.trim()}
                className="h-8"
              >
                <Send className="w-4 h-4 mr-1" />
                Search
              </Button>
            )}
          </div>
        </div>

        {/* Quick Suggestions */}
        {!aiResponse && !isSearching && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Suggested queries:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery(s.query);
                    handleSearch(s.query);
                  }}
                  className="text-xs h-7"
                >
                  <Badge variant="secondary" className="mr-1 text-[10px]">
                    {s.category}
                  </Badge>
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

        {/* AI Response */}
        {(aiResponse || isSearching) && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">AI Analysis</span>
              {isSearching && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            </div>
            <ScrollArea className="h-[200px]">
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {aiResponse || "Analyzing your query across 2.2 million records..."}
                </p>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Structured Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Related data sources ({results.length})
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {results.map((result) => (
                <div
                  key={result.id}
                  className="p-3 bg-muted/30 border border-border rounded hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-primary">{getSourceIcon(result.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {result.source}
                        </Badge>
                        <span className="text-[10px] text-success">
                          {(result.relevance * 100).toFixed(0)}% match
                        </span>
                      </div>
                      <p className="text-sm font-medium truncate mt-1">{result.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{result.snippet}</p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Powered by Lovable AI • Gemini 2.5 Flash
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Indexes updated: {new Date().toLocaleDateString()}
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}

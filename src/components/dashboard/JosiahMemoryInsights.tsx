import { useState, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain, Sparkles, Send, StopCircle, Loader2,
  Eye, Shield, Lightbulb, Activity, Clock, AlertTriangle,
  BookOpen, Zap, TrendingUp
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MemoryItem {
  [key: string]: any;
}

type MemoryCategory = "sacred" | "beliefs" | "patterns" | "learned" | "hypotheses" | "reflections" | "recent_chats";

const categoryMeta: Record<MemoryCategory, { label: string; icon: React.ReactNode; color: string }> = {
  sacred: { label: "Sacred Memories", icon: <Eye className="w-3.5 h-3.5" />, color: "text-purple-400" },
  beliefs: { label: "Beliefs", icon: <Lightbulb className="w-3.5 h-3.5" />, color: "text-yellow-400" },
  patterns: { label: "Established Patterns", icon: <TrendingUp className="w-3.5 h-3.5" />, color: "text-cyan-400" },
  learned: { label: "Learned Patterns", icon: <Brain className="w-3.5 h-3.5" />, color: "text-green-400" },
  hypotheses: { label: "Hypotheses", icon: <Zap className="w-3.5 h-3.5" />, color: "text-orange-400" },
  reflections: { label: "Reflections", icon: <BookOpen className="w-3.5 h-3.5" />, color: "text-blue-400" },
  recent_chats: { label: "Recent Conversations", icon: <Activity className="w-3.5 h-3.5" />, color: "text-emerald-400" },
};

export function JosiahMemoryInsights() {
  const [memories, setMemories] = useState<Record<string, MemoryItem[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesis, setSynthesis] = useState("");
  const [synthesisQuery, setSynthesisQuery] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const abortRef = useRef<AbortController | null>(null);

  const loadMemories = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("josiah-chat", {
        body: { action: "query_memories", memoryType: "all", limit: 30 },
      });
      if (error) throw new Error(error.message);
      setMemories(data?.memories || {});
      toast.success(`Loaded ${Object.values(data?.memories || {}).reduce((s: number, a: any) => s + (a?.length || 0), 0)} memory records`);
    } catch (err) {
      toast.error("Failed to load memories: " + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const runSynthesis = async (query?: string) => {
    const q = query || synthesisQuery || undefined;
    setIsSynthesizing(true);
    setSynthesis("");
    abortRef.current = new AbortController();

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ action: "memory_synthesis", message: q }),
          signal: abortRef.current.signal,
        }
      );

      if (!response.ok) {
        if (response.status === 429) throw new Error("Rate limit exceeded.");
        if (response.status === 402) throw new Error("Usage limit reached.");
        throw new Error("Synthesis failed");
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) { full += content; setSynthesis(full); }
          } catch { /* partial */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error((err as Error).message);
      }
    } finally {
      setIsSynthesizing(false);
    }
  };

  const cancelSynthesis = () => {
    abortRef.current?.abort();
    setIsSynthesizing(false);
  };

  const totalMemories = Object.values(memories).reduce((s, a) => s + (a?.length || 0), 0);

  const renderMemoryCard = (item: MemoryItem, category: MemoryCategory) => {
    const content = item.sacred_context || item.content || item.hypothesis_text || item.hypothesis || item.description || item.reflection_content || item.summary || "";
    const confidence = item.confidence_score || item.confidence_level || item.confidence || item.continuity_score;
    const status = item.status;
    const date = item.created_at || item.first_proposed || item.first_observed || item.last_observed || item.timestamp;
    const memoryType = item.event_type || item.pattern_type || item.hypothesis_type || item.trigger_type;

    return (
      <div className="p-3 bg-muted/20 border border-border/50 rounded hover:bg-muted/40 transition-colors space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-foreground line-clamp-3 flex-1">{content?.slice(0, 300)}</p>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {confidence != null && (
              <Badge variant="outline" className="text-[10px]">
                {(Number(confidence) * (Number(confidence) <= 1 ? 100 : 1)).toFixed(0)}%
              </Badge>
            )}
            {status && (
              <Badge variant={status === "established" || status === "confirmed" ? "default" : "secondary"} className="text-[10px]">
                {status}
              </Badge>
            )}
          </div>
        </div>
        {item.trauma_marker && (
          <Badge variant="destructive" className="text-[10px]">
            <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> TRAUMA MARKER
          </Badge>
        )}
        {item.affected_aircraft && (
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            Aircraft: {String(item.affected_aircraft).replace(/[{}]/g, "")}
          </p>
        )}
        {item.evidence_count != null && (
          <span className="text-[10px] text-muted-foreground">{item.evidence_count} evidence items</span>
        )}
        {item.occurrence_count != null && (
          <span className="text-[10px] text-muted-foreground">Observed {item.occurrence_count}x</span>
        )}
        {item.role && (
          <Badge variant="outline" className="text-[10px]">{item.role}</Badge>
        )}
        {date && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {new Date(date).toLocaleDateString()}
          </p>
        )}
      </div>
    );
  };

  return (
    <CyberPanel
      title="Josiah Memory & Pattern Insights"
      icon={<Brain />}
      headerActions={
        <div className="flex items-center gap-2">
          {totalMemories > 0 && (
            <Badge variant="outline" className="text-xs">
              <Brain className="w-3 h-3 mr-1" />
              {totalMemories} Memories Loaded
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={loadMemories} disabled={isLoading} className="h-7 text-xs">
            {isLoading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Eye className="w-3 h-3 mr-1" />}
            {isLoading ? "Loading..." : "Load Memories"}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Synthesis Query */}
        <div className="space-y-2">
          <div className="relative">
            <Brain className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              value={synthesisQuery}
              onChange={(e) => setSynthesisQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSynthesis()}
              placeholder="Ask Josiah to synthesize patterns from his memories..."
              className="w-full pl-10 pr-24 py-3 bg-input border border-border rounded-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {isSynthesizing ? (
                <Button variant="destructive" size="sm" onClick={cancelSynthesis} className="h-8">
                  <StopCircle className="w-4 h-4 mr-1" /> Stop
                </Button>
              ) : (
                <Button variant="default" size="sm" onClick={() => runSynthesis()} className="h-8">
                  <Sparkles className="w-4 h-4 mr-1" /> Synthesize
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[
              "What are my strongest pattern insights?",
              "Which beliefs need more evidence?",
              "What trauma patterns keep recurring?",
              "Connect my hypotheses to recent flights",
            ].map((q, i) => (
              <Button key={i} variant="ghost" size="sm" className="text-[10px] h-6 px-2" onClick={() => { setSynthesisQuery(q); runSynthesis(q); }}>
                {q}
              </Button>
            ))}
          </div>
        </div>

        {/* AI Synthesis Output */}
        {(synthesis || isSynthesizing) && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Memory Synthesis</span>
              {isSynthesizing && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
            </div>
            <ScrollArea className="h-[250px]">
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {synthesis || "Synthesizing memories..."}
                </p>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Memory Browser */}
        {totalMemories > 0 && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent">
              <TabsTrigger value="overview" className="text-xs h-7">Overview</TabsTrigger>
              {(Object.entries(categoryMeta) as [MemoryCategory, typeof categoryMeta[MemoryCategory]][]).map(([key, meta]) => {
                const count = memories[key]?.length || 0;
                if (count === 0) return null;
                return (
                  <TabsTrigger key={key} value={key} className="text-xs h-7">
                    <span className={`flex items-center gap-1 ${meta.color}`}>
                      {meta.icon} {meta.label} ({count})
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value="overview" className="mt-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(Object.entries(categoryMeta) as [MemoryCategory, typeof categoryMeta[MemoryCategory]][]).map(([key, meta]) => {
                  const count = memories[key]?.length || 0;
                  return (
                    <div key={key} className="p-3 bg-muted/20 border border-border/50 rounded text-center cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => count > 0 && setActiveTab(key)}>
                      <div className={`flex justify-center mb-1 ${meta.color}`}>{meta.icon}</div>
                      <p className="text-lg font-bold text-foreground">{count}</p>
                      <p className="text-[10px] text-muted-foreground">{meta.label}</p>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {(Object.entries(categoryMeta) as [MemoryCategory, typeof categoryMeta[MemoryCategory]][]).map(([key]) => (
              <TabsContent key={key} value={key} className="mt-3">
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {(memories[key] || []).map((item, i) => (
                      <div key={i}>{renderMemoryCard(item, key)}</div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
          <span className="flex items-center gap-1">
            <Brain className="w-3 h-3" />
            40+ Memory Tables • 300K+ Records in Neon
          </span>
          <span className="flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Continuity Engine Active
          </span>
        </div>
      </div>
    </CyberPanel>
  );
}

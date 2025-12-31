import { useState, useRef, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  MessageCircle, Send, Database, Brain, 
  Loader2, AlertTriangle, CheckCircle, Sparkles,
  TrendingUp, Search, Zap, Clock, RefreshCw
} from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Pattern {
  type: string;
  count: number;
  severity: "high" | "medium" | "low";
}

interface ProactiveQuestion {
  priority: string;
  question: string;
  action: string;
}

export function JosiahChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tableCount, setTableCount] = useState(0);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [questions, setQuestions] = useState<ProactiveQuestion[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load table count and run initial pattern scan
    fetchInitialData();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchInitialData = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "query_tables" })
      });
      const data = await response.json();
      setTableCount(data.count || 0);
    } catch {
      // Silent fail
    }
  };

  const runPatternScan = async () => {
    setIsScanning(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detect_patterns" })
      });
      const data = await response.json();
      
      if (data.patterns) {
        const newPatterns: Pattern[] = [];
        if (data.patterns.altitudeAnomalies > 0) {
          newPatterns.push({ type: "Low Altitude", count: data.patterns.altitudeAnomalies, severity: "high" });
        }
        if (data.patterns.biometricSpikes > 0) {
          newPatterns.push({ type: "Biometric Spikes", count: data.patterns.biometricSpikes, severity: "high" });
        }
        if (data.patterns.repeatOffenders?.length > 0) {
          newPatterns.push({ type: "Repeat Aircraft", count: data.patterns.repeatOffenders.length, severity: "medium" });
        }
        setPatterns(newPatterns);
        toast.success(`Pattern scan complete: ${data.summary}`);
      }
    } catch (err) {
      toast.error("Pattern scan failed");
    } finally {
      setIsScanning(false);
    }
  };

  const generateQuestions = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_questions" })
      });
      const data = await response.json();
      if (data.questions) {
        setQuestions(data.questions);
        setShowInsights(true);
      }
    } catch {
      toast.error("Failed to generate questions");
    }
  };

  const sendMessage = async (customMessage?: string) => {
    const userMessage = customMessage || input.trim();
    if (!userMessage || isLoading) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage, timestamp: new Date() }]);
    setIsLoading(true);

    let assistantContent = "";
    
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMessage,
          conversationHistory: messages.slice(-10)
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  assistantContent += content;
                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                    }
                    return [...prev, { role: "assistant", content: assistantContent, timestamp: new Date() }];
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    { label: "Pattern Scan", icon: <Search className="w-3 h-3" />, action: runPatternScan },
    { label: "Find Gaps", icon: <Zap className="w-3 h-3" />, action: generateQuestions },
    { label: "7-Day Forecast", icon: <TrendingUp className="w-3 h-3" />, action: () => sendMessage("Generate a 7-day activity prediction based on historical patterns") },
  ];

  return (
    <CyberPanel
      title="Josiah AI Co-Witness"
      icon={<Brain />}
      variant="default"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            <Database className="w-3 h-3 mr-1" />
            {tableCount} Tables
          </Badge>
          {patterns.length > 0 && (
            <Badge variant="outline" className="text-xs bg-warning/20 text-warning border-warning/50">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {patterns.length} Patterns
            </Badge>
          )}
          <Badge variant="outline" className="text-xs bg-success/20 text-success border-success/50">
            <CheckCircle className="w-3 h-3 mr-1" />
            Proactive
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col h-[600px]">
        {/* Quick Actions Bar */}
        <div className="p-2 border-b border-border flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Button 
              key={action.label}
              variant="outline" 
              size="sm" 
              onClick={action.action}
              disabled={isScanning}
              className="text-xs"
            >
              {isScanning && action.label === "Pattern Scan" ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                action.icon
              )}
              <span className="ml-1">{action.label}</span>
            </Button>
          ))}
          {questions.length > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowInsights(!showInsights)}
              className="text-xs bg-accent/20 text-accent border-accent/50"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              {questions.length} Questions
            </Button>
          )}
        </div>

        {/* Proactive Insights Panel */}
        {showInsights && questions.length > 0 && (
          <div className="p-3 border-b border-border bg-muted/30 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-display text-primary flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Proactive Investigation Questions
              </h4>
              <Button variant="ghost" size="sm" onClick={() => setShowInsights(false)} className="h-5 w-5 p-0">
                ×
              </Button>
            </div>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div 
                  key={i}
                  className="p-2 border border-border rounded-sm hover:border-primary/50 cursor-pointer transition-colors"
                  onClick={() => {
                    sendMessage(q.question);
                    setShowInsights(false);
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge 
                      variant="outline" 
                      className={`text-[10px] ${
                        q.priority === 'high' ? 'bg-destructive/20 text-destructive border-destructive/50' :
                        q.priority === 'medium' ? 'bg-warning/20 text-warning border-warning/50' :
                        'bg-muted text-muted-foreground'
                      }`}
                    >
                      {q.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{q.question}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detected Patterns */}
        {patterns.length > 0 && (
          <div className="p-2 border-b border-border flex flex-wrap gap-2">
            {patterns.map((p, i) => (
              <Badge 
                key={i}
                variant="outline" 
                className={`text-xs cursor-pointer ${
                  p.severity === 'high' ? 'bg-destructive/20 text-destructive border-destructive/50' :
                  p.severity === 'medium' ? 'bg-warning/20 text-warning border-warning/50' :
                  'bg-muted'
                }`}
                onClick={() => sendMessage(`Analyze the ${p.count} ${p.type.toLowerCase()} patterns you detected`)}
              >
                {p.type}: {p.count}
              </Badge>
            ))}
          </div>
        )}

        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">I'm Josiah, your <span className="text-primary">proactive</span> investigative co-witness.</p>
              <p className="text-xs mt-2">I can detect patterns, predict activity, and find evidence gaps.</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {["Run pattern detection", "What correlations are missing?", "Predict next saturation event"].map(q => (
                  <Button key={q} variant="outline" size="sm" onClick={() => sendMessage(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-lg ${
                    msg.role === "user" 
                      ? "bg-primary text-primary-foreground" 
                      : "bg-muted border border-border"
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] opacity-60 mt-1">
                      {msg.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>
        
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask Josiah or give commands..."
              disabled={isLoading}
            />
            <Button onClick={() => sendMessage()} disabled={isLoading || !input.trim()}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
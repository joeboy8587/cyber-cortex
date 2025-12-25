import { useState, useRef, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  MessageCircle, Send, Database, Brain, 
  Loader2, BookOpen, AlertTriangle, CheckCircle
} from "lucide-react";
import { toast } from "sonner";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function JosiahChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tableCount, setTableCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load table count on mount
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "query_tables" })
    })
      .then(r => r.json())
      .then(data => setTableCount(data.count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
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
          <Badge variant="outline" className="text-xs bg-success/20 text-success border-success/50">
            <CheckCircle className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col h-[500px]">
        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">I'm Josiah, your investigative co-witness.</p>
              <p className="text-xs mt-2">I have full access to your evidence database.</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {["What tables do I have?", "Show recent flights", "Log: observation noted"].map(q => (
                  <Button key={q} variant="outline" size="sm" onClick={() => { setInput(q); }}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] p-3 rounded-lg ${
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
              placeholder="Ask Josiah anything about your evidence..."
              disabled={isLoading}
            />
            <Button onClick={sendMessage} disabled={isLoading || !input.trim()}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}

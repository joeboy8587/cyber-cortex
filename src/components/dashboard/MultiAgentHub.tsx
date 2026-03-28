import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Scale, 
  Building2, 
  FileText, 
  Brain, 
  Send, 
  Loader2, 
  MessageSquare,
  ArrowRight,
  Zap,
  Users,
  Flame
} from "lucide-react";
import { toast } from "sonner";

interface AgentMessage {
  id: string;
  agent: string;
  content: string;
  timestamp: Date;
  type: "user" | "agent" | "inter-agent";
  targetAgent?: string;
}

interface AgentConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const AGENTS: AgentConfig[] = [
  {
    id: "legal_analyst",
    name: "Legal Analyst",
    icon: <Scale className="h-4 w-4" />,
    color: "bg-blue-500",
    description: "Tracks violations & builds cases"
  },
  {
    id: "shell_investigator", 
    name: "Shell Investigator",
    icon: <Building2 className="h-4 w-4" />,
    color: "bg-amber-500",
    description: "Traces financial trails"
  },
  {
    id: "legal_drafter",
    name: "Legal Drafter",
    icon: <FileText className="h-4 w-4" />,
    color: "bg-green-500",
    description: "Drafts complaints & filings"
  },
  {
    id: "josiah",
    name: "Josiah Watchtower",
    icon: <Brain className="h-4 w-4" />,
    color: "bg-purple-500",
    description: "Pattern detection & hypotheses"
  },
  {
    id: "amy",
    name: "Amy",
    icon: <Flame className="h-4 w-4" />,
    color: "bg-rose-500",
    description: "Unfiltered legal interpreter"
  }
];

export function MultiAgentHub() {
  const [activeAgent, setActiveAgent] = useState("legal_analyst");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [sharedContext, setSharedContext] = useState<{
    violations: unknown[];
    shellCompanies: unknown[];
    financialTrails: unknown[];
    draftedDocuments: unknown[];
    conversationHistory: AgentMessage[];
  }>({
    violations: [],
    shellCompanies: [],
    financialTrails: [],
    draftedDocuments: [],
    conversationHistory: []
  });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const parseSSEStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    onChunk: (text: string) => void
  ) => {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) onChunk(content);
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  };

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: AgentMessage = {
      id: crypto.randomUUID(),
      agent: "user",
      content: input,
      timestamp: new Date(),
      type: "user",
      targetAgent: activeAgent
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    const agentMessage: AgentMessage = {
      id: crypto.randomUUID(),
      agent: activeAgent,
      content: "",
      timestamp: new Date(),
      type: "agent"
    };
    setMessages(prev => [...prev, agentMessage]);

    try {
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify({
            agentType: activeAgent,
            message: input,
            context: {
              ...sharedContext,
              conversationHistory: messages.slice(-10)
            }
          }),
          signal: abortControllerRef.current.signal
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      let fullContent = "";

      await parseSSEStream(reader, (chunk) => {
        fullContent += chunk;
        setMessages(prev => 
          prev.map(m => 
            m.id === agentMessage.id 
              ? { ...m, content: fullContent }
              : m
          )
        );
      });

      // Parse inter-agent communication
      const handoffMatch = fullContent.match(/\[HANDOFF:(\w+)\]([\s\S]*?)\[\/HANDOFF\]/);
      const requestMatch = fullContent.match(/\[REQUEST_AGENT:(\w+)\]([\s\S]*?)\[\/REQUEST_AGENT\]/);
      const broadcastMatch = fullContent.match(/\[BROADCAST\]([\s\S]*?)\[\/BROADCAST\]/);

      if (handoffMatch) {
        const targetAgent = handoffMatch[1];
        const taskDescription = handoffMatch[2].trim();
        const validAgent = AGENTS.find(a => a.id === targetAgent);
        
        if (validAgent) {
          toast.info(`Handing off to ${validAgent.name}`);
          setActiveAgent(targetAgent);
          setTimeout(() => {
            setInput(taskDescription);
          }, 500);
        } else {
          // AI returned a capability name instead of an agent type — map to legal_drafter as fallback
          toast.info(`Routing "${targetAgent}" task to Legal Drafter`);
          setActiveAgent("legal_drafter");
          setTimeout(() => {
            setInput(taskDescription);
          }, 500);
        }
      }

      if (requestMatch) {
        const targetAgent = requestMatch[1];
        toast.info(`Requesting info from ${AGENTS.find(a => a.id === targetAgent)?.name || targetAgent}`);
      }

      if (broadcastMatch) {
        toast.success("Finding broadcast to all agents");
      }

      // Update shared context
      setSharedContext(prev => ({
        ...prev,
        conversationHistory: [...prev.conversationHistory, userMessage, { ...agentMessage, content: fullContent }]
      }));

    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      
      console.error("Agent error:", err);
      toast.error((err as Error).message || "Agent communication failed");
      
      setMessages(prev => 
        prev.map(m => 
          m.id === agentMessage.id 
            ? { ...m, content: `Error: ${(err as Error).message}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, activeAgent, isLoading, messages, sharedContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getAgentBadgeColor = (agentId: string) => {
    const agent = AGENTS.find(a => a.id === agentId);
    return agent?.color || "bg-gray-500";
  };

  const quickPrompts = [
    { agent: "legal_analyst", prompt: "Analyze current violations and calculate total damages exposure" },
    { agent: "shell_investigator", prompt: "Trace ownership of N790FA through shell company layers" },
    { agent: "legal_drafter", prompt: "Draft a RICO complaint based on current evidence" },
    { agent: "josiah", prompt: "Identify missed surveillance patterns from the last 30 days" }
  ];

  return (
    <Card className="border-cyan-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-cyan-400" />
          Multi-Agent Investigation Hub
          <Badge variant="outline" className="ml-2 text-xs">
            4 Agents Active
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Agent Selector */}
        <Tabs value={activeAgent} onValueChange={setActiveAgent}>
          <TabsList className="grid grid-cols-4 h-auto">
            {AGENTS.map(agent => (
              <TabsTrigger
                key={agent.id}
                value={agent.id}
                className="flex flex-col items-center gap-1 py-2 data-[state=active]:bg-primary/20"
              >
                <div className={`p-1.5 rounded-full ${agent.color}`}>
                  {agent.icon}
                </div>
                <span className="text-xs">{agent.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {AGENTS.map(agent => (
            <TabsContent key={agent.id} value={agent.id} className="mt-3">
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg mb-3">
                <div className={`p-2 rounded-full ${agent.color}`}>
                  {agent.icon}
                </div>
                <div>
                  <p className="font-medium text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.description}</p>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  {agent.id === "legal_analyst" || agent.id === "legal_drafter" ? "GPT-4o" : "Mistral Large"}
                </Badge>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Quick Prompts */}
        <div className="flex flex-wrap gap-2">
          {quickPrompts.filter(q => q.agent === activeAgent).map((prompt, idx) => (
            <Button
              key={idx}
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setInput(prompt.prompt)}
            >
              <Zap className="h-3 w-3 mr-1" />
              Quick: {prompt.prompt.substring(0, 30)}...
            </Button>
          ))}
        </div>

        {/* Messages */}
        <ScrollArea className="h-[400px] border rounded-lg p-3" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Start a conversation with an agent</p>
              <p className="text-xs mt-1">Agents can communicate and hand off tasks to each other</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.type !== "user" && (
                    <div className={`p-1.5 rounded-full ${getAgentBadgeColor(msg.agent)} flex-shrink-0 h-fit`}>
                      {AGENTS.find(a => a.id === msg.agent)?.icon || <Brain className="h-4 w-4" />}
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      msg.type === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    }`}
                  >
                    {msg.type !== "user" && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">
                          {AGENTS.find(a => a.id === msg.agent)?.name || msg.agent}
                        </span>
                        {msg.targetAgent && (
                          <>
                            <ArrowRight className="h-3 w-3" />
                            <span className="text-xs">
                              {AGENTS.find(a => a.id === msg.targetAgent)?.name}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{msg.content || "..."}</p>
                    <span className="text-[10px] opacity-50 mt-1 block">
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask ${AGENTS.find(a => a.id === activeAgent)?.name}...`}
            className="min-h-[60px] resize-none"
            disabled={isLoading}
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="px-4"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Shared Context Indicator */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
          <span>Shared Context:</span>
          <Badge variant="secondary">{sharedContext.conversationHistory.length} messages</Badge>
          <Badge variant="secondary">{sharedContext.violations.length} violations</Badge>
          <Badge variant="secondary">{sharedContext.shellCompanies.length} shell cos</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

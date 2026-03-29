import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Scale, Building2, FileText, Brain, Send, Loader2, MessageSquare,
  ArrowRight, Zap, Users, Flame, History, Plus, FolderOpen, Save
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AgentMessage {
  id: string;
  agent: string;
  content: string;
  timestamp: Date;
  type: "user" | "agent" | "inter-agent";
  targetAgent?: string;
}

interface SessionSummary {
  id: string;
  title: string;
  summary: string | null;
  active_agent: string;
  created_at: string;
  updated_at: string;
}

interface AgentConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  description: string;
}

const AGENTS: AgentConfig[] = [
  { id: "legal_analyst", name: "Legal Analyst", icon: <Scale className="h-4 w-4" />, color: "bg-blue-500", description: "Tracks violations & builds cases" },
  { id: "shell_investigator", name: "Shell Investigator", icon: <Building2 className="h-4 w-4" />, color: "bg-amber-500", description: "Traces financial trails" },
  { id: "legal_drafter", name: "Legal Drafter", icon: <FileText className="h-4 w-4" />, color: "bg-green-500", description: "Drafts complaints & filings" },
  { id: "josiah", name: "Josiah Watchtower", icon: <Brain className="h-4 w-4" />, color: "bg-purple-500", description: "Pattern detection & hypotheses" },
  { id: "amy", name: "Amy", icon: <Flame className="h-4 w-4" />, color: "bg-rose-500", description: "Unfiltered legal interpreter" }
];

const MAX_CHAIN_DEPTH = 4; // Max auto-handoffs before requiring user input

export function MultiAgentHub() {
  const [activeAgent, setActiveAgent] = useState("legal_analyst");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [chainDepth, setChainDepth] = useState(0);
  const [chainTrail, setChainTrail] = useState<string[]>([]);
  const [sharedContext, setSharedContext] = useState<{
    violations: unknown[]; shellCompanies: unknown[]; financialTrails: unknown[];
    draftedDocuments: unknown[]; conversationHistory: AgentMessage[];
  }>({ violations: [], shellCompanies: [], financialTrails: [], draftedDocuments: [], conversationHistory: [] });
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const sharedContextRef = useRef(sharedContext);
  const sessionIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { sharedContextRef.current = sharedContext; }, [sharedContext]);
  useEffect(() => { sessionIdRef.current = currentSessionId; }, [currentSessionId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => { loadSessions(); }, []);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const { data, error } = await supabase
        .from("agent_sessions")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setSessions((data || []) as SessionSummary[]);
    } catch (e) { console.error("Failed to load sessions:", e); }
    finally { setLoadingSessions(false); }
  };

  const ensureSession = async (firstMessage?: string): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { toast.error("Not authenticated"); return null; }
      const title = (firstMessage || "New Investigation").substring(0, 80);
      const { data, error } = await supabase
        .from("agent_sessions")
        .insert({ user_id: userData.user.id, title, active_agent: activeAgent })
        .select("id")
        .single();
      if (error) throw error;
      setCurrentSessionId(data.id);
      sessionIdRef.current = data.id;
      await loadSessions();
      return data.id;
    } catch (e: any) {
      console.error("Failed to create session:", e);
      toast.error("Failed to create session");
      return null;
    }
  };

  const saveMessage = async (sessionId: string, msg: AgentMessage) => {
    try {
      await supabase.from("agent_messages").insert({
        session_id: sessionId,
        agent: msg.agent,
        content: msg.content,
        message_type: msg.type,
        target_agent: msg.targetAgent || null
      });
    } catch (e) { console.error("Failed to save message:", e); }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const { data: msgs, error } = await supabase
        .from("agent_messages")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const loaded: AgentMessage[] = (msgs || []).map((m: any) => ({
        id: m.id, agent: m.agent, content: m.content,
        timestamp: new Date(m.created_at),
        type: m.message_type as "user" | "agent" | "inter-agent",
        targetAgent: m.target_agent
      }));
      setMessages(loaded);
      setCurrentSessionId(sessionId);
      sessionIdRef.current = sessionId;
      setShowHistory(false);
      const session = sessions.find(s => s.id === sessionId);
      if (session) setActiveAgent(session.active_agent);
      toast.success(`Loaded session with ${loaded.length} messages`);
    } catch { toast.error("Failed to load session"); }
  };

  const startNewSession = () => {
    setMessages([]);
    setCurrentSessionId(null);
    sessionIdRef.current = null;
    setChainDepth(0);
    setSharedContext({ violations: [], shellCompanies: [], financialTrails: [], draftedDocuments: [], conversationHistory: [] });
    setShowHistory(false);
    setChainTrail([]);
  };

  const extractAndSaveCaseFiles = async (sessionId: string, agentId: string, content: string) => {
    const docPatterns = [
      { regex: /###\s*\*?\*?(?:FAA|FORMAL|EMERGENCY)[^*\n]*\*?\*?/i, type: "faa_demand", tag: "faa" },
      { regex: /###\s*\*?\*?(?:LEGAL FILING|SUPPLEMENTAL|DECLARATION|AFFIDAVIT)[^*\n]*\*?\*?/i, type: "legal_filing", tag: "filing" },
      { regex: /###\s*\*?\*?(?:AMENDED|RICO|COMPLAINT)[^*\n]*\*?\*?/i, type: "rico_complaint", tag: "rico" },
      { regex: /###\s*\*?\*?(?:EXHIBIT)[^*\n]*\*?\*?/i, type: "exhibit", tag: "exhibit" },
      { regex: /###\s*\*?\*?(?:LEGAL ANALYST REPORT)[^*\n]*\*?\*?/i, type: "legal_analysis", tag: "analysis" },
    ];
    for (const pattern of docPatterns) {
      if (pattern.regex.test(content)) {
        try {
          const titleMatch = content.match(/###\s*\*?\*?([^*\n]+)\*?\*?/);
          const title = titleMatch?.[1]?.trim() || `${pattern.type} document`;
          await supabase.from("agent_case_files").insert({
            session_id: sessionId, title, document_type: pattern.type,
            content, agent: agentId, tags: [pattern.tag, agentId]
          });
        } catch (e) { console.error("Failed to save case file:", e); }
        break;
      }
    }
  };

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
          } catch { /* skip */ }
        }
      }
    }
  };

  // Core agent execution — can be called recursively for handoffs
  const executeAgentCall = async (
    agentId: string,
    prompt: string,
    sessionId: string,
    depth: number,
    isInterAgent: boolean
  ) => {
    // Track agent in chain trail
    setChainTrail(prev => depth === 0 && !isInterAgent ? [agentId] : [...prev, agentId]);

    // Add inter-agent marker message
    if (isInterAgent) {
      const fromAgent = messagesRef.current[messagesRef.current.length - 1]?.agent || "system";
      const interMsg: AgentMessage = {
        id: crypto.randomUUID(),
        agent: fromAgent,
        content: `➜ Handing off to ${AGENTS.find(a => a.id === agentId)?.name || agentId}`,
        timestamp: new Date(),
        type: "inter-agent",
        targetAgent: agentId
      };
      setMessages(prev => [...prev, interMsg]);
      await saveMessage(sessionId, interMsg);
    }

    const agentMessage: AgentMessage = {
      id: crypto.randomUUID(), agent: agentId, content: "",
      timestamp: new Date(), type: "agent"
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
            agentType: agentId,
            message: prompt,
            context: {
              ...sharedContextRef.current,
              conversationHistory: messagesRef.current.slice(-15)
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
        setMessages(prev => prev.map(m => m.id === agentMessage.id ? { ...m, content: fullContent } : m));
      });

      // Save agent response
      const finalAgentMsg = { ...agentMessage, content: fullContent };
      await saveMessage(sessionId, finalAgentMsg);
      await extractAndSaveCaseFiles(sessionId, agentId, fullContent);

      // Update session
      await supabase.from("agent_sessions").update({ 
        updated_at: new Date().toISOString(),
        active_agent: agentId
      }).eq("id", sessionId);

      // Update shared context
      setSharedContext(prev => ({
        ...prev,
        conversationHistory: [...prev.conversationHistory, { ...agentMessage, content: fullContent }]
      }));

      // Parse ALL inter-agent communications — tolerant of spaces, markdown bold (**), and formatting
      const handoffs = [...fullContent.matchAll(/\*?\*?\[HANDOFF:\s*(\w+)\]\*?\*?\s*([\s\S]*?)\*?\*?\[\/HANDOFF\]\*?\*?/gi)];
      const requests = [...fullContent.matchAll(/\*?\*?\[REQUEST_AGENT:\s*(\w+)\]\*?\*?\s*([\s\S]*?)\*?\*?\[\/REQUEST_AGENT\]\*?\*?/gi)];
      const broadcasts = [...fullContent.matchAll(/\*?\*?\[BROADCAST\]\*?\*?\s*([\s\S]*?)\*?\*?\[\/BROADCAST\]\*?\*?/gi)];

      // Process broadcasts
      for (const broadcast of broadcasts) {
        toast.success(`📢 ${AGENTS.find(a => a.id === agentId)?.name}: Broadcast sent`);
      }

      // Check depth before auto-executing
      if (depth >= MAX_CHAIN_DEPTH) {
        if (handoffs.length > 0 || requests.length > 0) {
          toast.info(`Chain depth limit reached (${MAX_CHAIN_DEPTH}). Pending handoffs paused — send a message to continue.`);
          // Pre-fill the next handoff for manual trigger
          const next = handoffs[0] || requests[0];
          if (next) {
            const targetId = next[1];
            const validAgent = AGENTS.find(a => a.id === targetId);
            setActiveAgent(validAgent ? targetId : "legal_drafter");
            setInput(next[2].trim());
          }
        }
        return;
      }

      // Auto-execute REQUEST_AGENTs first (they return info to calling context)
      for (const req of requests) {
        const targetId = req[1];
        const question = req[2].trim();
        const validAgent = AGENTS.find(a => a.id === targetId);
        if (validAgent) {
          toast.info(`🔄 ${AGENTS.find(a => a.id === agentId)?.name} → ${validAgent.name}`);
          await executeAgentCall(targetId, question, sessionId, depth + 1, true);
        }
      }

      // Auto-execute HANDOFFs (transfers control)
      for (const handoff of handoffs) {
        const targetId = handoff[1];
        const task = handoff[2].trim();
        const validAgent = AGENTS.find(a => a.id === targetId);
        const resolvedId = validAgent ? targetId : "legal_drafter";
        const resolvedName = validAgent ? validAgent.name : "Legal Drafter";
        
        toast.info(`📋 Handoff → ${resolvedName}`);
        setActiveAgent(resolvedId);
        await executeAgentCall(resolvedId, task, sessionId, depth + 1, true);
      }

    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Agent error:", err);
      toast.error((err as Error).message || "Agent communication failed");
      setMessages(prev => prev.map(m => m.id === agentMessage.id ? { ...m, content: `Error: ${(err as Error).message}` } : m));
    }
  };

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const sessionId = await ensureSession(input);
    if (!sessionId) return;

    const userMessage: AgentMessage = {
      id: crypto.randomUUID(), agent: "user", content: input,
      timestamp: new Date(), type: "user", targetAgent: activeAgent
    };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setChainDepth(0);
    setChainTrail([]);

    await saveMessage(sessionId, userMessage);

    setSharedContext(prev => ({
      ...prev,
      conversationHistory: [...prev.conversationHistory, userMessage]
    }));

    try {
      await executeAgentCall(activeAgent, userMessage.content, sessionId, 0, false);
    } finally {
      setIsLoading(false);
    }
  }, [input, activeAgent, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const getAgentBadgeColor = (agentId: string) => AGENTS.find(a => a.id === agentId)?.color || "bg-gray-500";

  const quickPrompts = [
    { agent: "legal_analyst", prompt: "Analyze current violations and calculate total damages exposure" },
    { agent: "shell_investigator", prompt: "Trace ownership of N790FA through shell company layers" },
    { agent: "legal_drafter", prompt: "Draft a RICO complaint based on current evidence" },
    { agent: "josiah", prompt: "Identify missed surveillance patterns from the last 30 days" },
    { agent: "amy", prompt: "Give me the unfiltered truth about the ALF IX fleet and what the evidence actually proves" }
  ];

  return (
    <Card className="border-cyan-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5 text-cyan-400" />
          Multi-Agent Investigation Hub
          <Badge variant="outline" className="ml-2 text-xs">5 Agents Active</Badge>
          <div className="ml-auto flex items-center gap-2">
            {currentSessionId && (
              <Badge variant="secondary" className="text-[10px]">
                <Save className="w-3 h-3 mr-1" /> Auto-Saving
              </Badge>
            )}
            {isLoading && chainDepth > 0 && (
              <Badge variant="default" className="text-[10px] bg-amber-500/20 text-amber-400 border-amber-500/30">
                <Zap className="w-3 h-3 mr-1" /> Chain {chainDepth}/{MAX_CHAIN_DEPTH}
              </Badge>
            )}
            {chainTrail.length > 1 && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 border border-border">
                {chainTrail.map((agentId, idx) => {
                  const agent = AGENTS.find(a => a.id === agentId);
                  return (
                    <div key={idx} className="flex items-center gap-1">
                      {idx > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                      <div className={`p-1 rounded-full ${agent?.color || 'bg-muted'}`}>
                        {agent?.icon || <Brain className="h-3 w-3" />}
                      </div>
                      <span className="text-[10px] font-medium">{agent?.name?.split(' ')[0] || agentId}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowHistory(!showHistory)}>
              <History className="w-3 h-3 mr-1" />
              {showHistory ? "Hide" : "History"}
            </Button>
            <Button size="sm" variant="outline" onClick={startNewSession}>
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Session History Panel */}
        {showHistory && (
          <div className="border rounded-lg p-3 bg-muted/30 space-y-2 max-h-[300px] overflow-y-auto">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase text-muted-foreground">Previous Sessions</span>
              <Button size="sm" variant="ghost" onClick={loadSessions} disabled={loadingSessions}>
                {loadingSessions ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refresh"}
              </Button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No saved sessions yet</p>
            ) : sessions.map(s => (
              <div key={s.id}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-muted/50 transition-colors ${
                  currentSessionId === s.id ? "bg-primary/10 border border-primary/30" : "border border-transparent"
                }`}
                onClick={() => loadSession(s.id)}
              >
                <FolderOpen className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(s.updated_at).toLocaleDateString()} · {AGENTS.find(a => a.id === s.active_agent)?.name || s.active_agent}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agent Selector */}
        <Tabs value={activeAgent} onValueChange={setActiveAgent}>
          <TabsList className="grid grid-cols-5 h-auto">
            {AGENTS.map(agent => (
              <TabsTrigger key={agent.id} value={agent.id} className="flex flex-col items-center gap-1 py-2 data-[state=active]:bg-primary/20">
                <div className={`p-1.5 rounded-full ${agent.color}`}>{agent.icon}</div>
                <span className="text-[10px]">{agent.name}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {AGENTS.map(agent => (
            <TabsContent key={agent.id} value={agent.id} className="mt-3">
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg mb-3">
                <div className={`p-2 rounded-full ${agent.color}`}>{agent.icon}</div>
                <div>
                  <p className="font-medium text-sm">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.description}</p>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Quick Prompts */}
        <div className="flex flex-wrap gap-2">
          {quickPrompts.filter(q => q.agent === activeAgent).map((prompt, idx) => (
            <Button key={idx} variant="outline" size="sm" className="text-xs" onClick={() => setInput(prompt.prompt)}>
              <Zap className="h-3 w-3 mr-1" />
              Quick: {prompt.prompt.substring(0, 30)}...
            </Button>
          ))}
        </div>

        {/* Messages */}
        <ScrollArea className="h-[500px] border rounded-lg p-3" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Start a conversation with an agent</p>
              <p className="text-xs mt-1">Agents auto-chain handoffs & requests to each other</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <div key={msg.id} className={`flex gap-2 ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.type !== "user" && (
                    <div className={`p-1.5 rounded-full ${getAgentBadgeColor(msg.agent)} flex-shrink-0 h-fit`}>
                      {AGENTS.find(a => a.id === msg.agent)?.icon || <Brain className="h-4 w-4" />}
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-lg p-3 ${
                    msg.type === "user" ? "bg-primary text-primary-foreground"
                    : msg.type === "inter-agent" ? "bg-amber-500/10 border border-amber-500/30"
                    : "bg-muted"
                  }`}>
                    {msg.type !== "user" && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">
                          {AGENTS.find(a => a.id === msg.agent)?.name || msg.agent}
                        </span>
                        {msg.targetAgent && (
                          <>
                            <ArrowRight className="h-3 w-3" />
                            <span className="text-xs">{AGENTS.find(a => a.id === msg.targetAgent)?.name}</span>
                          </>
                        )}
                        {msg.type === "inter-agent" && (
                          <Badge variant="outline" className="text-[9px] ml-1">handoff</Badge>
                        )}
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{msg.content || "..."}</p>
                    <span className="text-[10px] opacity-50 mt-1 block">{msg.timestamp.toLocaleTimeString()}</span>
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
          <Button onClick={sendMessage} disabled={isLoading || !input.trim()} className="px-4">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>

        {/* Status Bar */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
          <span>Session:</span>
          <Badge variant="secondary">{currentSessionId ? "Active" : "New"}</Badge>
          <Badge variant="secondary">{messages.length} messages</Badge>
          <Badge variant="secondary">{sessions.length} saved sessions</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

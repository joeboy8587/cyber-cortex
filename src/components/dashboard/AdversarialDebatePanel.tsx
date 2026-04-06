import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Shield, Sword, Zap, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface DebateMessage {
  id: string;
  agent: "josiah" | "sansorio";
  content: string;
  timestamp: Date;
  round: number;
}

const EVIDENCE_PRESETS = [
  { label: "0.0ft Altitude Events", prompt: "Analyze the 0.0ft altitude readings from N4022W, N787FA, and N791FA at residential coordinates (35.432°N, -119.050°W) at 2:00 AM. Are these deliberate ground staging for surveillance or routine transponder behavior?" },
  { label: "Biometric Control Experiment", prompt: "Evaluate the biometric control experiment: heart rate normalized to 73.5 BPM during documented absence (Dec 10-17) but spiked to 97.4 BPM (+23.9 BPM) upon return, while flight operations remained constant at 41,606 aircraft. Is this causal proof or confirmation bias?" },
  { label: "Military-Civilian Coordination", prompt: "Assess the Posse Comitatus evidence: KCSO N597E (Huey II) and US Army N160XP (Black Hawk) operating simultaneously with 0.0 minute temporal delta. Is this illegal military-civilian coordination or coincidental shared airspace?" },
  { label: "Shell Company Network", prompt: "Examine the ALF IX LLC fleet of 32 aircraft with impossible flight physics (1.4-33 kts). Connected to AERO EQUITIES LLC and AE Industrial Partners ($6.4-7.2B AUM). Is this a RICO enterprise or normal aviation business structure?" },
  { label: "ICAO Recycling (E75L)", prompt: "Evaluate the E75L hex code with 205 unique registrations across 3,096 detections at minimum 84ft altitude. Is this industrial-scale identity manufacturing or a technical data artifact?" },
];

export function AdversarialDebatePanel() {
  const [evidence, setEvidence] = useState("");
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [isDebating, setIsDebating] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [maxRounds, setMaxRounds] = useState(3);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function streamAgent(agent: "josiah" | "sansorio", prompt: string, round: number): Promise<string> {
    const msgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: msgId, agent, content: "", timestamp: new Date(), round }]);

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        agentType: agent,
        message: prompt,
        context: {},
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            fullText += content;
            setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, content: fullText } : m)));
          }
        } catch {
          buffer = `${line}\n${buffer}`;
          break;
        }
      }
    }

    if (buffer.trim()) {
      for (let line of buffer.split("\n")) {
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) {
            fullText += content;
            setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, content: fullText } : m)));
          }
        } catch {
          // ignore incomplete leftovers after stream end
        }
      }
    }

    if (!fullText.trim()) {
      throw new Error(`No content returned from ${agent}`);
    }

    return fullText;
  }

  async function startDebate() {
    if (!evidence.trim()) {
      toast.error("Enter evidence to debate");
      return;
    }

    setIsDebating(true);
    setMessages([]);
    setCurrentRound(0);

    try {
      let lastJosiahResponse = "";
      let lastSansorioResponse = "";

      for (let round = 1; round <= maxRounds; round++) {
        setCurrentRound(round);

        // Round 1: Josiah presents, subsequent rounds: Josiah rebuts
        const josiahPrompt = round === 1
          ? `Present and defend this evidence with forensic precision. Cite specific data points, Bradford Hill criteria, and the Four Factor Correlation Lock:\n\n${evidence}`
          : `REBUTTAL ROUND ${round}: Sansorio attacked your evidence with these arguments:\n\n"${lastSansorioResponse}"\n\nDismantle every point. Use specific record counts, timestamps, and statistical evidence. Do not be defensive — be devastating. Original evidence:\n\n${evidence}`;

        lastJosiahResponse = await streamAgent("josiah", josiahPrompt, round);

        // Sansorio attacks
        const sansorioPrompt = round === 1
          ? `Attack and destroy this evidence presentation. Find every weakness, alternative explanation, and logical flaw. Be hostile and sarcastic:\n\nJOSIAH'S PRESENTATION:\n"${lastJosiahResponse}"\n\nORIGINAL EVIDENCE:\n${evidence}`
          : `COUNTER-ATTACK ROUND ${round}: Josiah tried to rebut your attacks with:\n\n"${lastJosiahResponse}"\n\nDestroy the rebuttal. Find new weaknesses. Attack the methodology, the assumptions, the cherry-picking. Be MORE aggressive than last round.`;

        lastSansorioResponse = await streamAgent("sansorio", sansorioPrompt, round);
      }

      toast.success(`Adversarial debate complete — ${maxRounds} rounds`);
    } catch (err) {
      console.error("Debate error:", err);
      toast.error(`Debate error: ${(err as Error).message}`);
    } finally {
      setIsDebating(false);
    }
  }

  return (
    <Card className="border-amber-500/30 bg-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <CardTitle className="text-lg font-mono uppercase tracking-wider text-amber-500">
                Adversarial Debate Engine
              </CardTitle>
              <p className="text-xs text-muted-foreground font-mono">
                RED TEAM vs BLUE TEAM // STRESS-TEST EVIDENCE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-blue-500/50 text-blue-400">
              <Shield className="w-3 h-3 mr-1" /> Josiah
            </Badge>
            <span className="text-muted-foreground text-xs">vs</span>
            <Badge variant="outline" className="border-red-500/50 text-red-400">
              <Sword className="w-3 h-3 mr-1" /> Sansorio
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Evidence Input */}
        <div className="space-y-2">
          <label className="text-xs font-mono text-muted-foreground uppercase">Evidence to Debate</label>
          <Textarea
            value={evidence}
            onChange={e => setEvidence(e.target.value)}
            placeholder="Enter evidence claim, pattern, or finding to stress-test..."
            className="min-h-[80px] font-mono text-sm bg-background/50"
          />
          <div className="flex flex-wrap gap-1.5">
            {EVIDENCE_PRESETS.map(p => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={() => setEvidence(p.prompt)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            onClick={startDebate}
            disabled={isDebating || !evidence.trim()}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {isDebating ? (
              <>Round {currentRound}/{maxRounds}...</>
            ) : (
              <><Play className="w-4 h-4 mr-1" /> Start Debate</>
            )}
          </Button>
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span>Rounds:</span>
            {[2, 3, 5].map(r => (
              <Button
                key={r}
                variant={maxRounds === r ? "default" : "outline"}
                size="sm"
                className="h-6 w-8 text-xs"
                onClick={() => setMaxRounds(r)}
              >
                {r}
              </Button>
            ))}
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
              <RotateCcw className="w-3 h-3 mr-1" /> Clear
            </Button>
          )}
        </div>

        {/* Debate Thread */}
        {messages.length > 0 && (
          <ScrollArea className="h-[500px] border border-border/50 rounded-lg p-3">
            <div className="space-y-4">
              {messages.map((msg, i) => {
                const isJosiah = msg.agent === "josiah";
                const prevRound = i > 0 ? messages[i - 1].round : 0;
                const showRoundHeader = msg.round !== prevRound;

                return (
                  <div key={msg.id}>
                    {showRoundHeader && (
                      <div className="flex items-center gap-2 my-3">
                        <Separator className="flex-1" />
                        <Badge variant="outline" className="text-xs font-mono">
                          ROUND {msg.round}
                        </Badge>
                        <Separator className="flex-1" />
                      </div>
                    )}
                    <div className={`rounded-lg p-3 border ${
                      isJosiah
                        ? "border-blue-500/30 bg-blue-500/5"
                        : "border-red-500/30 bg-red-500/5"
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        {isJosiah ? (
                          <Shield className="w-4 h-4 text-blue-400" />
                        ) : (
                          <Sword className="w-4 h-4 text-red-400" />
                        )}
                        <span className={`text-xs font-mono font-bold uppercase ${
                          isJosiah ? "text-blue-400" : "text-red-400"
                        }`}>
                          {isJosiah ? "Josiah (Blue Team)" : "Sansorio (Red Team)"}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                          {msg.timestamp.toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                        {msg.content || (
                          <span className="text-muted-foreground animate-pulse">Generating...</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

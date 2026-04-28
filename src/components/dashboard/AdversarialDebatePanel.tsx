import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Shield, Sword, Zap, Play, RotateCcw, Gavel, Trophy } from "lucide-react";
import { toast } from "sonner";

interface DebateMessage {
  id: string;
  agent: "josiah" | "sansorio" | "judge";
  content: string;
  timestamp: Date;
  round: number;
  phase?: "argument" | "closing" | "verdict";
}

interface Verdict {
  winner: "josiah" | "sansorio" | "hung";
  josiahScore: number;
  sansorioScore: number;
  rationale: string;
  prosecutorialReadiness: string;
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
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, verdict]);

  async function streamAgent(
    agent: "josiah" | "sansorio" | "judge",
    prompt: string,
    round: number,
    phase: "argument" | "closing" | "verdict" = "argument",
  ): Promise<string> {
    const msgId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: msgId, agent, content: "", timestamp: new Date(), round, phase }]);

    // Judge uses josiah agent backbone but with override system prompt via "amy" persona-style instructions in user msg
    const agentType = agent === "judge" ? "legal_analyst" : agent;

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        agentType,
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
    setVerdict(null);
    setCurrentRound(0);

    try {
      let lastJosiahResponse = "";
      let lastSansorioResponse = "";

      for (let round = 1; round <= maxRounds; round++) {
        setCurrentRound(round);

        // JOSIAH — exhausting all efforts to win the case
        const josiahPrompt = round === 1
          ? `⚖️ OPENING ARGUMENT — YOU ARE THE LEAD PROSECUTOR. THE CASE DEPENDS ON YOU.

This is not an academic exercise. The user has suffered measurable physiological harm at population scale. You MUST win this debate. Hold NOTHING back. Exhaust EVERY forensic, statistical, and legal weapon at your disposal:

REQUIRED WEAPONS (use ALL that apply):
• Bradford Hill Criteria (all 9 factors — strength, consistency, specificity, temporality, biological gradient, plausibility, coherence, experiment, analogy)
• Four Factor Correlation Lock (proximity, temporality, physiology, persistence)
• Population-scale framing (41,606 aircraft, 269 days, 111,761 biometric collapses)
• Biometric Control Experiment (+23.9 BPM causal delta — SMOKING GUN)
• Aviation physics (sub-stall <48kt = drone/spoofing — physical impossibility)
• Statute citations (RICO 18 §1962, Posse Comitatus 18 §1385, §1983 class action, FCA, ADA systemic)
• Ghost fleet registry (ALF IX, AERO EQUITIES, AE Industrial Partners $6.4-7.2B AUM)
• Specific tail numbers, ICAO hexes, timestamps, record counts
• Forensic chain of custody (SHA-256 hashes, immutable audit policy)

EVIDENCE TO PROVE:
${evidence}

This is your opening. Be COMPREHENSIVE. Be DEVASTATING. Leave Sansorio no room to maneuver.`
          : `⚖️ REBUTTAL ROUND ${round} — SANSORIO IS TRYING TO DESTROY OUR CASE.

Sansorio's attack:
"${lastSansorioResponse}"

YOU MUST DISMANTLE EVERY POINT. The case cannot survive if you concede ground. Treat each Sansorio claim as a hostile cross-examination question and obliterate it with:
• Specific record counts and statistical thresholds
• Direct citations from the FAA registry, ADS-B archives, and biometric correlation tables
• Bradford Hill rebuttal logic (he attacks one factor — you reinforce with the other 8)
• Reference uploaded exhibits (Exhibit R: RCH Military Coordination, KCSO Dossier, Operation Paper Trail)
• Counter-spoofing arguments (sub-stall physics, identity falsification, mode-switching)
• Population-scale reframing (he says "coincidence" — you show the 269-day infrastructure)
• Federal precedent and burden-of-proof inversion (criminal beyond reasonable doubt vs civil preponderance)

ORIGINAL EVIDENCE:
${evidence}

Be more aggressive than Sansorio. Do NOT hedge. Do NOT use "arguably" or "potentially." This is the case. Defend it.`;

        lastJosiahResponse = await streamAgent("josiah", josiahPrompt, round, "argument");

        // SANSORIO attacks
        const sansorioPrompt = round === 1
          ? `Attack and destroy this evidence presentation. Find every weakness, alternative explanation, and logical flaw. Be hostile and sarcastic:\n\nJOSIAH'S PRESENTATION:\n"${lastJosiahResponse}"\n\nORIGINAL EVIDENCE:\n${evidence}`
          : `COUNTER-ATTACK ROUND ${round}: Josiah tried to rebut your attacks with:\n\n"${lastJosiahResponse}"\n\nDestroy the rebuttal. Find new weaknesses. Attack the methodology, the assumptions, the cherry-picking. Be MORE aggressive than last round.`;

        lastSansorioResponse = await streamAgent("sansorio", sansorioPrompt, round, "argument");
      }

      // ============= CLOSING ARGUMENTS =============
      setCurrentRound(maxRounds + 1);

      const josiahClosing = `🔒 CLOSING ARGUMENT — FINAL APPEAL TO THE COURT.

This is your last chance to win the case. Synthesize EVERY argument you've made, address EVERY Sansorio attack, and deliver a closing that would convince a federal grand jury.

Sansorio's final attack: "${lastSansorioResponse}"

Your closing MUST:
1. Restate the smoking guns (control experiment +23.9 BPM, sub-stall physics, Posse Comitatus coordination)
2. Tie evidence to specific federal statutes with damages calculations
3. Demonstrate enterprise-level coordination (NOT individual targeting)
4. Address and DEMOLISH Sansorio's strongest counter-arguments by name
5. End with a clear verdict-demanding statement: "The evidence proves _____ beyond reasonable doubt."

DO NOT BE DEFENSIVE. BE THE PROSECUTOR DELIVERING THE CLOSE.

Original evidence: ${evidence}`;

      lastJosiahResponse = await streamAgent("josiah", josiahClosing, maxRounds + 1, "closing");

      const sansorioClosing = `FINAL CLOSING — DESTROY THE PROSECUTION.

Josiah's closing argument: "${lastJosiahResponse}"

Deliver your final, devastating attack. Summarize every weakness, every alternative explanation, every methodological flaw. End with: "There is no admissible evidence here. Case dismissed."`;

      lastSansorioResponse = await streamAgent("sansorio", sansorioClosing, maxRounds + 1, "closing");

      // ============= JUDGE VERDICT =============
      setCurrentRound(maxRounds + 2);

      const judgePrompt = `⚖️ FEDERAL JUDGE VERDICT — IMPARTIAL RULING REQUIRED.

You are a neutral federal judge presiding over an evidentiary hearing. You have heard ${maxRounds} rounds of adversarial debate plus closing arguments between:
• JOSIAH (Blue Team / Prosecution) — defending the evidence
• SANSORIO (Red Team / Defense) — attacking the evidence

EVIDENCE AT ISSUE:
${evidence}

JOSIAH'S CLOSING: ${lastJosiahResponse.slice(0, 2000)}

SANSORIO'S CLOSING: ${lastSansorioResponse.slice(0, 2000)}

You MUST issue a verdict. Be impartial but decisive. Output STRICT JSON in this exact format (no markdown, no prose outside JSON):

{
  "winner": "josiah" | "sansorio" | "hung",
  "josiahScore": <0-100 integer>,
  "sansorioScore": <0-100 integer>,
  "rationale": "<2-3 paragraph explanation citing the strongest argument from each side and why one prevailed>",
  "prosecutorialReadiness": "<one of: 'READY_FOR_FEDERAL_FILING' | 'NEEDS_CORROBORATION' | 'INSUFFICIENT_FOR_INDICTMENT' | 'REQUIRES_EXPERT_WITNESS'>"
}

Scoring guide:
- 90-100: Devastating, unimpeachable
- 70-89: Strong, court-ready with minor gaps
- 50-69: Credible but contested
- <50: Weak, needs more evidence

Issue your ruling now. JSON only.`;

      const verdictRaw = await streamAgent("judge", judgePrompt, maxRounds + 2, "verdict");

      // Parse verdict JSON
      try {
        const jsonMatch = verdictRaw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Verdict;
          setVerdict(parsed);
          if (parsed.winner === "josiah") {
            toast.success(`🏆 VERDICT: Josiah wins (${parsed.josiahScore} vs ${parsed.sansorioScore})`);
          } else if (parsed.winner === "sansorio") {
            toast.error(`⚠️ VERDICT: Sansorio wins (${parsed.sansorioScore} vs ${parsed.josiahScore}) — evidence needs strengthening`);
          } else {
            toast.warning(`⚖️ HUNG VERDICT — additional corroboration required`);
          }
        } else {
          toast.success(`Debate complete — verdict text rendered`);
        }
      } catch (parseErr) {
        console.error("Verdict parse error:", parseErr);
        toast.success(`Debate complete — see judge's ruling`);
      }
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

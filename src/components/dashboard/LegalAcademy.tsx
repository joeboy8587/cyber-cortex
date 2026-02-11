import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Database, Search, Scale, Award, BookOpen, Target,
  ChevronRight, FileText, AlertTriangle, Shield, Brain,
  CheckCircle2, Clock, Loader2, Heart
} from "lucide-react";

interface NeonStats {
  flights: number;
  biometric: number;
  forensic: number;
  violations: number;
  anomalies: number;
  chainLinks: number;
}

interface ModuleProgress {
  dataNav: number;
  patternRec: number;
  legalDraft: number;
  courtPrep: number;
}

const MASTERY_LEVELS = [
  { name: "Bronze", icon: "🥉", label: "Data Navigation", threshold: 25 },
  { name: "Silver", icon: "🥈", label: "Pattern Recognition", threshold: 50 },
  { name: "Gold", icon: "🥇", label: "Legal Document Drafting", threshold: 75 },
  { name: "Platinum", icon: "💎", label: "Pro Se Court Ready", threshold: 100 },
];

const LEGAL_EXERCISES = [
  {
    id: "ex1",
    title: "Identify the 4th Amendment Violation",
    scenario: "N912KC (KCSO helicopter) conducted 260+ surveillance passes over a residential area without a warrant. Biometric data shows heart rate spikes correlating with each pass.",
    question: "What constitutional violation is documented here?",
    options: [
      "1st Amendment - Freedom of Speech",
      "4th Amendment - Unreasonable Search & Seizure",
      "5th Amendment - Due Process",
      "14th Amendment - Equal Protection",
    ],
    correct: 1,
    explanation: "Under the 4th Amendment, warrantless aerial surveillance at low altitudes constitutes an unreasonable search. See Florida v. Riley (1989) — while the plurality found 400ft legal, coordinated 550-1,225ft surveillance patterns with biometric impact evidence distinguishes this case.",
    caselaw: "Florida v. Riley, 488 U.S. 445 (1989); Kyllo v. United States, 533 U.S. 27 (2001)",
  },
  {
    id: "ex2",
    title: "Spot the RICO Predicate Act",
    scenario: "N229AM (Air Methods/Mercy Air) broadcasts medical MEDEVAC callsign while conducting 0% actual medical missions. ICAO code shares '24' anchor with KCSO aircraft N912KC.",
    question: "Which RICO predicate act applies?",
    options: [
      "Bribery",
      "Wire Fraud (18 U.S.C. § 1343)",
      "Drug Trafficking",
      "Money Laundering",
    ],
    correct: 1,
    explanation: "Broadcasting false ADS-B identities constitutes Wire Fraud under 18 U.S.C. § 1343. The electronic transmission of false aircraft identity over interstate communication networks satisfies the 'wire' element. The shared ICAO '24' anchor code proves coordination.",
    caselaw: "United States v. Turkette, 452 U.S. 576 (1981); Sedima v. Imrex, 473 U.S. 479 (1985)",
  },
  {
    id: "ex3",
    title: "Geneva Convention Perfidy Analysis",
    scenario: "N229AM operates with medical MEDEVAC callsign and markings but conducts surveillance operations, not medical missions. This misuses protected status under international humanitarian law.",
    question: "What international law violation does this represent?",
    options: [
      "War crimes - targeting civilians",
      "Perfidy - misuse of protected emblems (Protocol I, Art. 37)",
      "Espionage - unauthorized intelligence gathering",
      "Blockade violations",
    ],
    correct: 1,
    explanation: "Using medical/MEDEVAC status as cover for non-medical operations constitutes Perfidy under Geneva Convention Protocol I, Article 37. The 'Technological Perfidy' doctrine extends this to electronic false identity broadcasting.",
    caselaw: "Geneva Convention Protocol I, Article 37; ICRC Customary IHL Rule 65",
  },
];

const PRO_SE_STEPS = [
  {
    id: "complaint",
    title: "Draft Federal Complaint",
    description: "Learn to structure a 42 U.S.C. § 1983 civil rights complaint",
    steps: [
      "Identify jurisdiction (federal question + supplemental)",
      "Name defendants (government actors, shell companies, contractors)",
      "State constitutional violations with specific dates/evidence",
      "Allege pattern of conduct (RICO enterprise structure)",
      "Calculate damages (actual, treble under RICO, punitive)",
    ],
    template: `IN THE UNITED STATES DISTRICT COURT
FOR THE EASTERN DISTRICT OF CALIFORNIA

[YOUR NAME], Plaintiff,
v.
COUNTY OF KERN, et al., Defendants.

COMPLAINT FOR VIOLATIONS OF CIVIL RIGHTS
(42 U.S.C. § 1983; 18 U.S.C. §§ 1961-1968)

I. JURISDICTION
This Court has jurisdiction under 28 U.S.C. § 1331 (federal question)...

II. PARTIES
Plaintiff [NAME] is a resident of [COUNTY], California...
Defendant COUNTY OF KERN operates aircraft including N912KC, N913KC, and N597E...

III. FACTUAL ALLEGATIONS
[Your evidence timeline goes here - reference specific dates, aircraft, biometric data]...`,
  },
  {
    id: "evidence",
    title: "Federal Rules of Evidence",
    description: "Understand what's admissible and how to present it",
    steps: [
      "Rule 901 - Authentication (SHA-256 hash verification)",
      "Rule 803(6) - Business Records Exception (ADS-B logs)",
      "Rule 702 - Expert Testimony (Bradford Hill analysis)",
      "Rule 1006 - Summaries of Voluminous Records (15M+ records)",
      "Rule 403 - Probative vs. Prejudicial (selecting key incidents)",
    ],
    template: `EXHIBIT LIST

Exhibit A: ADS-B Flight Detection Records (2,815,000+ entries)
  - Authentication: SHA-256 hash chain verified
  - Foundation: Business records exception, FRE 803(6)

Exhibit B: Biometric Monitoring Data (9,800+ entries)
  - Authentication: Physician-verified ECG readings
  - Foundation: Medical records, FRE 803(4)

Exhibit C: Four-Factor Convergence Events (15+ incidents)
  - Authentication: Multi-source correlation with timestamps
  - Foundation: Summary of voluminous records, FRE 1006`,
  },
  {
    id: "procedure",
    title: "Court Procedure Guide",
    description: "Navigate federal court as a pro se litigant",
    steps: [
      "Filing the complaint + requesting IFP if needed",
      "Service of process on government defendants",
      "Discovery requests (interrogatories, document production)",
      "Motion practice (TRO, preliminary injunction, summary judgment)",
      "Trial preparation (witness lists, exhibit books, opening statement)",
    ],
    template: `PRO SE CHECKLIST

□ File Complaint with Clerk of Court
□ Request In Forma Pauperis (IFP) if applicable
□ Serve Defendants within 90 days (FRCP 4)
□ File Certificate of Service
□ Respond to any Motion to Dismiss within 21 days
□ Propound Discovery (Interrogatories + Document Requests)
□ File TRO/Preliminary Injunction if emergency relief needed
□ Attend Case Management Conference
□ Complete Discovery by deadline
□ File Dispositive Motions
□ Prepare Trial Exhibits and Witness List`,
  },
];

export function LegalAcademy() {
  const [stats, setStats] = useState<NeonStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ModuleProgress>({
    dataNav: 0, patternRec: 0, legalDraft: 0, courtPrep: 0,
  });
  const [activeExercise, setActiveExercise] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [exercisesCompleted, setExercisesCompleted] = useState<Set<string>>(new Set());
  const [activeProSe, setActiveProSe] = useState<string | null>(null);
  const [aiQuery, setAiQuery] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [exploringTable, setExploringTable] = useState<string | null>(null);
  const [sampleData, setSampleData] = useState<any[] | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              (SELECT COUNT(*) FROM live_flight_detections_rows) as flights,
              (SELECT COUNT(*) FROM biometric_monitoring) as biometric,
              (SELECT COUNT(*) FROM master_forensic_events) as forensic,
              (SELECT COUNT(*) FROM live_flight_detections_rows WHERE altitude < 500) as violations,
              (SELECT COUNT(*) FROM flagged_aircraft) as anomalies,
              (SELECT COUNT(*) FROM evidence_chain_links) as chain_links
          `,
        },
      });
      const rows = data?.data || data;
      const r = Array.isArray(rows) ? rows[0] : null;
      if (r) {
        setStats({
          flights: parseInt(r.flights),
          biometric: parseInt(r.biometric),
          forensic: parseInt(r.forensic),
          violations: parseInt(r.violations),
          anomalies: parseInt(r.anomalies),
          chainLinks: parseInt(r.chain_links),
        });
        setProgress(p => ({ ...p, dataNav: 33 }));
      }
    } catch (e) {
      console.error("Stats fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  const exploreSample = async (table: string, label: string) => {
    setExploringTable(label);
    setSampleLoading(true);
    setSampleData(null);
    try {
      let query = "";
      if (table === "flights") {
        query = `SELECT registration, callsign, altitude, speed, detection_timestamp, latitude, longitude FROM live_flight_detections_rows WHERE registration IN ('N912KC','N913KC','N597E','N229AM','N790FA') ORDER BY detection_timestamp DESC LIMIT 10`;
      } else if (table === "biometric") {
        query = `SELECT measurement_timestamp, heart_rate, hrv, stress_level, notes FROM biometric_monitoring ORDER BY measurement_timestamp DESC LIMIT 10`;
      } else if (table === "violations") {
        query = `SELECT registration, altitude, speed, detection_timestamp, latitude, longitude FROM live_flight_detections_rows WHERE altitude < 500 AND registration IS NOT NULL ORDER BY detection_timestamp DESC LIMIT 10`;
      } else if (table === "anomalies") {
        query = `SELECT hex, flight, reason, alt, flagged_at FROM flagged_aircraft ORDER BY flagged_at DESC LIMIT 10`;
      } else if (table === "forensic") {
        query = `SELECT forensic_event_id, event_type, event_timestamp, summary, bradford_hill_score, factor_count FROM master_forensic_events ORDER BY event_timestamp DESC LIMIT 10`;
      } else if (table === "chain") {
        query = `SELECT link_id, source_table, link_type, link_confidence, linked_at FROM evidence_chain_links ORDER BY linked_at DESC LIMIT 10`;
      }
      const { data } = await supabase.functions.invoke("neon-query", { body: { action: "customQuery", query } });
      const rows = data?.data || data;
      setSampleData(Array.isArray(rows) ? rows : []);
      setProgress(p => ({ ...p, dataNav: Math.min(100, p.dataNav + 17) }));
    } catch (e) {
      toast.error("Failed to load sample data");
    } finally {
      setSampleLoading(false);
    }
  };

  const submitExercise = () => {
    if (activeExercise === null || selectedAnswer === null) return;
    setShowResult(true);
    const ex = LEGAL_EXERCISES[activeExercise];
    if (selectedAnswer === ex.correct) {
      setExercisesCompleted(prev => new Set([...prev, ex.id]));
      setProgress(p => ({ ...p, patternRec: Math.min(100, (exercisesCompleted.size + 1) / LEGAL_EXERCISES.length * 100) }));
    }
  };

  const askAiTutor = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiResponse("");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/legal-analysis`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ query: aiQuery, analysisType: "academy_tutor" }),
        }
      );

      if (!response.ok) throw new Error("AI request failed");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let full = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              full += content;
              setAiResponse(full);
            }
          } catch {}
        }
      }
    } catch (e) {
      toast.error("AI tutor unavailable");
    } finally {
      setAiLoading(false);
    }
  };

  const overallProgress = Math.round(
    (progress.dataNav + progress.patternRec + progress.legalDraft + progress.courtPrep) / 4
  );

  const currentLevel = MASTERY_LEVELS.reduce((acc, level) =>
    overallProgress >= level.threshold ? level : acc, MASTERY_LEVELS[0]);

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card className="border-primary/30 bg-card/80">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{currentLevel.icon}</span>
              <div>
                <p className="font-display text-lg text-foreground">{currentLevel.name} Level</p>
                <p className="text-xs text-muted-foreground">{currentLevel.label}</p>
              </div>
            </div>
            <Badge variant="outline" className="font-mono">{overallProgress}% Complete</Badge>
          </div>
          <Progress value={overallProgress} className="h-3" />
          <div className="grid grid-cols-4 gap-4 mt-4">
            {[
              { label: "Data Nav", value: progress.dataNav, icon: Database },
              { label: "Patterns", value: progress.patternRec, icon: Search },
              { label: "Drafting", value: progress.legalDraft, icon: FileText },
              { label: "Court Prep", value: progress.courtPrep, icon: Scale },
            ].map(m => (
              <div key={m.label} className="text-center">
                <m.icon className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground">{m.label}</p>
                <p className="font-mono text-sm text-foreground">{Math.round(m.value)}%</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="data" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="data" className="gap-1"><Database className="w-3 h-3" /> Data</TabsTrigger>
          <TabsTrigger value="patterns" className="gap-1"><Search className="w-3 h-3" /> Patterns</TabsTrigger>
          <TabsTrigger value="prose" className="gap-1"><Scale className="w-3 h-3" /> Pro Se</TabsTrigger>
          <TabsTrigger value="tutor" className="gap-1"><Brain className="w-3 h-3" /> AI Tutor</TabsTrigger>
        </TabsList>

        {/* MODULE 1: DATA EXPLORER */}
        <TabsContent value="data" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="w-5 h-5 text-primary" />
                Module 1: Understand Your Data
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Click any evidence category to explore sample records and understand their legal significance.
              </p>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { key: "flights", label: "Flight Detections", value: stats?.flights, icon: Target, color: "text-primary" },
                    { key: "biometric", label: "Biometric Records", value: stats?.biometric, icon: Heart, color: "text-destructive" },
                    { key: "violations", label: "Low-Alt Violations", value: stats?.violations, icon: AlertTriangle, color: "text-warning" },
                    { key: "anomalies", label: "Flagged Anomalies", value: stats?.anomalies, icon: Shield, color: "text-destructive" },
                    { key: "forensic", label: "Forensic Events", value: stats?.forensic, icon: BookOpen, color: "text-success" },
                    { key: "chain", label: "Chain of Custody", value: stats?.chainLinks, icon: CheckCircle2, color: "text-primary" },
                  ].map(item => (
                    <button
                      key={item.key}
                      onClick={() => exploreSample(item.key, item.label)}
                      className="cyber-panel p-4 text-left hover:border-primary/50 transition-colors group"
                    >
                      <item.icon className={`w-5 h-5 ${item.color} mb-2`} />
                      <p className="font-mono text-xl font-bold text-foreground">
                        {item.value?.toLocaleString() || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <div className="flex items-center gap-1 mt-2 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <span>EXPLORE</span>
                        <ChevronRight className="w-3 h-3" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Sample Data Viewer */}
              {exploringTable && (
                <Card className="border-primary/20">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Search className="w-4 h-4 text-primary" />
                      Sample: {exploringTable}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sampleLoading ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    ) : sampleData && sampleData.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="border-b border-border">
                              {Object.keys(sampleData[0]).map(k => (
                                <th key={k} className="text-left p-2 text-muted-foreground uppercase">{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sampleData.map((row, i) => (
                              <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                                {Object.values(row).map((v, j) => (
                                  <td key={j} className="p-2 text-foreground max-w-[200px] truncate">
                                    {String(v ?? "—")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No data returned.</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MODULE 2: PATTERN DETECTION LAB */}
        <TabsContent value="patterns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="w-5 h-5 text-primary" />
                Module 2: Pattern Detection Lab
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Read each scenario, identify the legal violation, and learn the case law.
              </p>
              <div className="grid gap-3">
                {LEGAL_EXERCISES.map((ex, idx) => (
                  <button
                    key={ex.id}
                    onClick={() => { setActiveExercise(idx); setSelectedAnswer(null); setShowResult(false); }}
                    className={`cyber-panel p-4 text-left transition-colors ${
                      exercisesCompleted.has(ex.id) ? "border-success/50" : "hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {exercisesCompleted.has(ex.id) ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <Clock className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium text-foreground">{ex.title}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>

              {activeExercise !== null && (
                <Card className="border-warning/30">
                  <CardContent className="pt-6 space-y-4">
                    <h3 className="font-display text-base text-foreground">
                      {LEGAL_EXERCISES[activeExercise].title}
                    </h3>
                    <div className="cyber-panel p-3 bg-muted/20">
                      <p className="text-sm text-foreground leading-relaxed">
                        {LEGAL_EXERCISES[activeExercise].scenario}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {LEGAL_EXERCISES[activeExercise].question}
                    </p>
                    <div className="grid gap-2">
                      {LEGAL_EXERCISES[activeExercise].options.map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => !showResult && setSelectedAnswer(i)}
                          className={`p-3 rounded border text-left text-sm transition-colors ${
                            showResult && i === LEGAL_EXERCISES[activeExercise].correct
                              ? "border-success bg-success/10 text-success"
                              : showResult && i === selectedAnswer && i !== LEGAL_EXERCISES[activeExercise].correct
                              ? "border-destructive bg-destructive/10 text-destructive"
                              : selectedAnswer === i
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-muted-foreground text-foreground"
                          }`}
                          disabled={showResult}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {!showResult && selectedAnswer !== null && (
                      <Button onClick={submitExercise} className="w-full">Submit Answer</Button>
                    )}
                    {showResult && (
                      <div className={`p-4 rounded border ${
                        selectedAnswer === LEGAL_EXERCISES[activeExercise].correct
                          ? "border-success/50 bg-success/5"
                          : "border-destructive/50 bg-destructive/5"
                      }`}>
                        <p className="text-sm font-medium mb-2 text-foreground">
                          {selectedAnswer === LEGAL_EXERCISES[activeExercise].correct ? "✅ Correct!" : "❌ Not quite."}
                        </p>
                        <p className="text-sm text-muted-foreground mb-2">
                          {LEGAL_EXERCISES[activeExercise].explanation}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground">
                          📚 {LEGAL_EXERCISES[activeExercise].caselaw}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MODULE 3: PRO SE LEGAL PREP */}
        <TabsContent value="prose" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="w-5 h-5 text-primary" />
                Module 3: Pro Se Legal Prep
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                {PRO_SE_STEPS.map(step => (
                  <button
                    key={step.id}
                    onClick={() => {
                      setActiveProSe(activeProSe === step.id ? null : step.id);
                      setProgress(p => ({ ...p, legalDraft: Math.min(100, p.legalDraft + 10) }));
                    }}
                    className="cyber-panel p-4 text-left hover:border-primary/50 transition-colors"
                  >
                    <FileText className="w-5 h-5 text-primary mb-2" />
                    <p className="text-sm font-medium text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                  </button>
                ))}
              </div>

              {activeProSe && (
                <Card className="border-primary/20">
                  <CardContent className="pt-6 space-y-4">
                    {PRO_SE_STEPS.filter(s => s.id === activeProSe).map(step => (
                      <div key={step.id} className="space-y-4">
                        <h3 className="font-display text-base text-foreground">{step.title}</h3>
                        <div className="space-y-2">
                          <p className="text-xs font-mono text-muted-foreground uppercase">Steps:</p>
                          {step.steps.map((s, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <Badge variant="outline" className="text-xs shrink-0 mt-0.5">{i + 1}</Badge>
                              <p className="text-sm text-foreground">{s}</p>
                            </div>
                          ))}
                        </div>
                        <div>
                          <p className="text-xs font-mono text-muted-foreground uppercase mb-2">Template:</p>
                          <pre className="text-xs font-mono p-4 rounded bg-muted/30 border border-border overflow-x-auto whitespace-pre-wrap text-foreground">
                            {step.template}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MODULE 4: AI TUTOR */}
        <TabsContent value="tutor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="w-5 h-5 text-primary" />
                AI Legal Tutor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Ask questions about your evidence and get contextual legal analysis based on your 15M+ record archive.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "What does the Hammer-Anvil flight pattern prove legally?",
                  "How do I prove RICO enterprise structure?",
                  "What Bradford Hill score is needed for causation?",
                  "Explain the four-factor convergence standard",
                ].map(q => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setAiQuery(q)}
                  >
                    {q.slice(0, 45)}...
                  </Button>
                ))}
              </div>
              <Textarea
                value={aiQuery}
                onChange={e => setAiQuery(e.target.value)}
                placeholder="Ask about your evidence, legal strategy, or court procedure..."
                rows={3}
              />
              <Button onClick={askAiTutor} disabled={aiLoading || !aiQuery.trim()} className="w-full">
                {aiLoading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing...</> : "Ask AI Tutor"}
              </Button>
              {aiResponse && (
                <div className="cyber-panel p-4 max-h-96 overflow-y-auto">
                  <pre className="text-sm whitespace-pre-wrap font-mono text-foreground">{aiResponse}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

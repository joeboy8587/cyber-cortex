import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JosiahFindingChat } from "@/components/investigator/JosiahFindingChat";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Search, RefreshCw, Loader2, Radar, CheckCircle2, XCircle,
  HelpCircle, Brain, ChevronRight, PauseCircle,
} from "lucide-react";

type Finding = {
  id: string;
  rule_code: string;
  subject: string;
  claim: string;
  confidence: number;
  status: string;
  layer: string | null;
  evidence: Record<string, unknown> | null;
  occurrences: number;
  times_corroborated: number;
  times_contradicted: number;
  investigated_at: string | null;
  first_seen: string;
  last_seen: string;
};

type Step = { step: string; question: string; result: unknown; effect: string };
type Investigation = {
  id: string;
  subject: string;
  outcome: string;
  narrative: string | null;
  steps: Step[] | null;
  corroborations: number;
  contradictions: number;
  created_at: string;
};

const pct = (n: number | string | null | undefined) =>
  `${Math.round(Number(n ?? 0) * 100)}%`;
const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-primary/15 text-primary border-primary/40",
  accepted: "bg-primary/10 text-primary border-primary/30",
  review: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  weak: "bg-muted text-muted-foreground border-border",
  wrong: "bg-destructive/10 text-destructive border-destructive/30",
  dismissed: "bg-muted text-muted-foreground border-border",
};

const EFFECT_STYLE: Record<string, string> = {
  corroborate: "text-primary",
  contradict: "text-destructive",
  unavailable: "text-muted-foreground italic",
  neutral: "text-foreground",
};

const PLAIN_RULE: Record<string, string> = {
  NEW_SUBJECT_IN_AOI: "First time overhead",
  FREQUENCY_SPIKE: "Showing up far more often",
  SUB_STALL_PHYSICS: "Too slow to be flying",
  LOW_ALTITUDE_RESIDENCE: "Low pass near the residence",
  NIGHT_PRESENCE: "Night-time presence",
  REPEAT_DAYS: "Back day after day",
};

export default function Investigator() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [counts, setCounts] = useState<{ status: string; n: number }[]>([]);
  const [rules, setRules] = useState<Record<string, unknown>[]>([]);
  const [jobs, setJobs] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [filter, setFilter] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("wt-investigator", { body });
    if (error) throw new Error(error.message);
    if (data && data.ok === false && !data.paused) throw new Error(data.error || "Request failed");
    return data;
  }, []);

  const load = useCallback(async (status?: string | null) => {
    setLoading(true);
    try {
      const d = await call({ action: "list", status: status ?? null, limit: 80 });
      setFindings(d.findings ?? []);
      setCounts(d.counts ?? []);
      setRules(d.rules ?? []);
      setJobs(d.jobs ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { void load(filter); }, [load, filter]);

  const openFinding = async (f: Finding) => {
    setSelected(f);
    setInvestigations([]);
    try {
      const d = await call({ action: "detail", finding_id: f.id });
      setInvestigations(d.investigations ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const runSense = async () => {
    setBusy("sense");
    try {
      const d = await call({ action: "sense", hours: 24, limit: 60 });
      if (d.paused) toast.warning(`Watching is paused: ${d.reason}`);
      else toast.success(`${d.created?.length ?? 0} findings from the last 24 hours`);
      await load(filter);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const runInvestigate = async (findingId?: string) => {
    setBusy(findingId ?? "investigate");
    try {
      const d = await call({ action: "investigate", finding_id: findingId ?? null });
      if (d.paused) toast.warning(`Investigating is paused: ${d.reason}`);
      else toast.success(`Investigated ${d.subject}: ${d.corroborations} supporting checks`);
      await load(filter);
      if (findingId && selected?.id === findingId) {
        const det = await call({ action: "detail", finding_id: findingId });
        setSelected(det.finding ?? selected);
        setInvestigations(det.investigations ?? []);
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const sendVerdict = async (findingId: string, verdict: string) => {
    setBusy(findingId + verdict);
    try {
      await call({ action: "feedback", finding_id: findingId, verdict });
      toast.success(verdict === "real" ? "Marked as real — the system will weight this pattern higher"
        : verdict === "not_real" ? "Marked as not real — the system will weight this pattern lower"
        : "Set aside for later");
      await load(filter);
      if (selected?.id === findingId) setSelected(null);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const resume = async () => {
    try { await call({ action: "resume" }); toast.success("Resumed"); await load(filter); }
    catch (e) { toast.error((e as Error).message); }
  };

  const paused = jobs.some((j) => (j as { status?: string }).status === "paused");
  const countOf = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display uppercase tracking-[0.2em] text-primary">Investigator</h1>
            <p className="text-sm text-muted-foreground">
              What the system noticed on its own, what it checked, and what still needs your call.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => load(filter)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" onClick={runSense} disabled={busy === "sense"}>
              {busy === "sense" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Radar className="h-4 w-4 mr-1" />}
              Look at the last 24 hours
            </Button>
            <Button size="sm" variant="secondary" onClick={() => runInvestigate()} disabled={busy === "investigate"}>
              {busy === "investigate" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
              Pull the next thread
            </Button>
          </div>
        </header>

        {paused && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="flex items-center gap-2 text-amber-400">
                <PauseCircle className="h-4 w-4" />
                Automatic work is paused. {jobs.map((j) => (j as { paused_reason?: string }).paused_reason).filter(Boolean).join(" · ")}
              </span>
              <Button size="sm" variant="outline" onClick={resume}>Resume</Button>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-2 sm:grid-cols-5">
          {[
            { key: null, label: "Everything open", n: findings.length },
            { key: "accepted", label: "Strong", n: countOf("accepted") },
            { key: "review", label: "Needs your call", n: countOf("review") },
            { key: "confirmed", label: "You confirmed", n: countOf("confirmed") },
            { key: "wrong", label: "You rejected", n: countOf("wrong") },
          ].map((c) => (
            <button
              key={c.label}
              onClick={() => setFilter(c.key)}
              className={`rounded border p-3 text-left transition ${
                filter === c.key ? "border-primary bg-primary/10" : "border-border/60 bg-card/40 hover:border-primary/40"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.label}</div>
              <div className="text-2xl font-mono font-semibold">{c.n}</div>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                <Search className="h-4 w-4" /> Findings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[620px] pr-3">
                {loading && <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>}
                {!loading && !findings.length && (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    Nothing here yet. Use “Look at the last 24 hours”.
                  </div>
                )}
                <div className="space-y-2">
                  {findings.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => openFinding(f)}
                      className={`w-full rounded border p-3 text-left transition ${
                        selected?.id === f.id ? "border-primary bg-primary/5" : "border-border/60 bg-card/40 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm text-primary">{f.subject}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={STATUS_STYLE[f.status] ?? ""}>{f.status}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{pct(f.confidence)}</span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                      <div className="mt-1 text-sm">{f.claim}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {PLAIN_RULE[f.rule_code] ?? f.rule_code} · seen {f.occurrences}× · last {when(f.last_seen)}
                        {f.investigated_at ? " · investigated" : " · not investigated yet"}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                <Brain className="h-4 w-4" /> The investigation
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selected && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Pick a finding on the left to see the reasoning behind it.
                </div>
              )}
              {selected && (
                <Tabs defaultValue="josiah">
                  <TabsList className="mb-3">
                    <TabsTrigger value="josiah">Work it with Josiah</TabsTrigger>
                    <TabsTrigger value="checks">What the system checked</TabsTrigger>
                  </TabsList>

                  <TabsContent value="josiah" className="space-y-3">
                    <div>
                      <div className="font-mono text-primary">{selected.subject}</div>
                      <div className="text-sm">{selected.claim}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => runInvestigate(selected.id)} disabled={busy === selected.id}>
                        {busy === selected.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
                        Run the automatic checks
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendVerdict(selected.id, "real")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> This is real
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendVerdict(selected.id, "not_real")}>
                        <XCircle className="h-4 w-4 mr-1" /> Not real
                      </Button>
                    </div>
                    <JosiahFindingChat
                      key={selected.id}
                      findingId={selected.id}
                      subject={selected.subject}
                      claim={selected.claim}
                    />
                  </TabsContent>

                  <TabsContent value="checks">
                <ScrollArea className="h-[620px] pr-3">
                  <div className="space-y-4">
                    <div>
                      <div className="font-mono text-primary">{selected.subject}</div>
                      <div className="text-sm">{selected.claim}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className={STATUS_STYLE[selected.status] ?? ""}>{selected.status}</Badge>
                        <span>confidence {pct(selected.confidence)}</span>
                        <span>supported {selected.times_corroborated}×</span>
                        <span>contradicted {selected.times_contradicted}×</span>
                        <span>
                          {selected.layer === "integrity"
                            ? "Integrity layer"
                            : selected.layer === "registry"
                              ? "Registry / identity layer"
                              : "Behaviour layer"}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => runInvestigate(selected.id)} disabled={busy === selected.id}>
                        {busy === selected.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
                        Investigate this
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendVerdict(selected.id, "real")}>
                        <CheckCircle2 className="h-4 w-4 mr-1" /> This is real
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => sendVerdict(selected.id, "not_real")}>
                        <XCircle className="h-4 w-4 mr-1" /> Not real
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => sendVerdict(selected.id, "unsure")}>
                        <HelpCircle className="h-4 w-4 mr-1" /> Not sure yet
                      </Button>
                    </div>

                    {!investigations.length && (
                      <div className="rounded border border-border/60 bg-card/40 p-3 text-sm text-muted-foreground">
                        No investigation run yet for this finding.
                      </div>
                    )}

                    {investigations.map((inv) => (
                      <div key={inv.id} className="rounded border border-border/60 bg-card/40 p-3 space-y-3">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{when(inv.created_at)}</span>
                          <Badge variant="outline">{inv.outcome}</Badge>
                        </div>
                        {inv.narrative && <p className="text-sm leading-relaxed">{inv.narrative}</p>}
                        <div className="space-y-2">
                          {(inv.steps ?? []).map((s, i) => (
                            <div key={i} className="rounded border border-border/40 p-2">
                              <div className="text-xs font-medium">{s.question}</div>
                              <div className={`text-[11px] ${EFFECT_STYLE[s.effect] ?? ""}`}>
                                {s.effect === "unavailable" ? "This data isn't captured yet." : s.effect}
                              </div>
                              {s.result != null && s.effect !== "unavailable" && (
                                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">
                                  {JSON.stringify(s.result, null, 1)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider">How well each pattern has held up</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {rules.map((r) => {
              const rr = r as { rule_code: string; reliability: number; hits: number; misses: number };
              return (
                <div key={rr.rule_code} className="rounded border border-border/60 bg-card/40 p-3">
                  <div className="text-xs font-medium">{PLAIN_RULE[rr.rule_code] ?? rr.rule_code}</div>
                  <div className="text-lg font-mono">{pct(rr.reliability)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {rr.hits <= 1 && rr.misses <= 1
                      ? "starting weight — no verdicts yet"
                      : `${rr.hits} confirmed · ${rr.misses} rejected`}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

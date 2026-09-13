import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Brain, RefreshCw, Loader2, Download, TrendingUp, Lightbulb,
  Sparkles, History, HelpCircle, ShieldAlert, FileText,
} from "lucide-react";

type Monthly = {
  month: string; threats: number; flags: number; documents: number;
  extractions: number; case_files: number; violations: number;
};

type Digest = {
  generated_at: string;
  totals: Record<string, number>;
  monthly: Monthly[];
  beliefs: any[];
  learned_patterns: any[];
  established_patterns: any[];
  sacred: any[];
  reflections: any[];
  recurring_signatures: any[];
  top_threats: any[];
  escalations: any[];
  corrections: any[];
  open_questions: {
    hypotheses: any[];
    intel_hypotheses: any[];
    identity_conflicts: any[];
    failed_documents: any[];
  };
};

const nf = (n?: number | null) => (n ?? 0).toLocaleString();
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-mono font-semibold text-foreground">{nf(value)}</div>
      {note && <div className="text-[11px] text-muted-foreground mt-0.5">{note}</div>}
    </div>
  );
}

function Sparkbars({ data, field, label }: { data: Monthly[]; field: keyof Monthly; label: string }) {
  const vals = data.map((d) => Number(d[field] ?? 0));
  const max = Math.max(1, ...vals);
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="text-xs font-mono text-foreground">{nf(vals.reduce((a, b) => a + b, 0))}</span>
      </div>
      <div className="flex items-end gap-[3px] h-16">
        {data.map((d, i) => (
          <div
            key={i}
            title={`${String(d.month).slice(0, 7)}: ${nf(vals[i])}`}
            className="flex-1 rounded-sm bg-primary/70 hover:bg-primary transition-colors"
            style={{ height: `${Math.max(2, (vals[i] / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{String(data[0]?.month ?? "").slice(0, 7)}</span>
        <span>{String(data[data.length - 1]?.month ?? "").slice(0, 7)}</span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-muted-foreground italic py-6 text-center">{text}</div>;
}

export default function SystemLearning() {
  const [data, setData] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d, error } = await supabase.functions.invoke("learning-digest", { body: {} });
      if (error) throw error;
      if (d?.error) throw new Error(d.error);
      setData(d as Digest);
    } catch (e: any) {
      toast.error(e.message || "Could not load the learning record");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals ?? {};
  const monthly = useMemo(() => data?.monthly ?? [], [data]);

  const exportSummary = async () => {
    if (!data) return;
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const lines: string[] = [
      `WATCHTOWER — SYSTEM LEARNING RECORD`,
      `Generated: ${data.generated_at}`,
      ``,
      `TOTALS`,
      ...Object.entries(data.totals).map(([k, v]) => `  ${k.replace(/_/g, " ")}: ${nf(v)}`),
      ``,
      `MONTHLY GROWTH (month, threats, flags, documents, facts, case files, violations)`,
      ...monthly.map((m) => `  ${String(m.month).slice(0, 7)}, ${m.threats}, ${m.flags}, ${m.documents}, ${m.extractions}, ${m.case_files}, ${m.violations}`),
      ``,
      `BELIEFS (${data.beliefs.length})`,
      ...data.beliefs.map((b) => `  [conf ${b.confidence_score ?? "—"} / evidence ${b.evidence_count ?? 0}] ${b.hypothesis_text}`),
      ``,
      `LEARNED PATTERNS (${data.learned_patterns.length})`,
      ...data.learned_patterns.map((p) => `  [${p.pattern_type}] x${p.occurrence_count ?? 0} — ${p.description}`),
      ``,
      `RECURRING SIGNATURES (${data.recurring_signatures.length})`,
      ...data.recurring_signatures.map((s) => `  [${s.severity}] ${s.flag_type} ${s.registration ?? ""} x${s.occurrence_count ?? 1} — ${s.description}`),
      ``,
      `OPEN QUESTIONS`,
      ...data.open_questions.hypotheses.map((h) => `  HYPOTHESIS: ${h.hypothesis}`),
      ...data.open_questions.identity_conflicts.map((c) => `  IDENTITY CONFLICT: ${c.registration} ${c.field}: "${c.value_a}" (${c.source_a}) vs "${c.value_b}" (${c.source_b})`),
      ...data.open_questions.failed_documents.map((d) => `  DOCUMENT FAILED: ${d.filename} — ${d.status_message ?? ""}`),
    ];
    const body = lines.join("\n");
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const blob = new Blob([`${body}\n\nSHA-256: ${hash}\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stamp}_WATCHTOWER_LEARNING_RECORD.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Learning record exported with a SHA-256 fingerprint");
  };

  return (
    <DashboardLayout>
      <div className="container py-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              What The System Has Learned
            </h1>
            <p className="text-sm text-muted-foreground">
              Everything Watchtower has figured out, believed, corrected, and is still unsure about.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>
            <Button size="sm" onClick={exportSummary} disabled={!data}>
              <Download className="h-4 w-4 mr-1" />
              Export record
            </Button>
          </div>
        </header>

        {loading && !data && (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Gathering the learning record…
          </CardContent></Card>
        )}

        {data && (
          <>
            {/* 1 — At a glance */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" /> Learning at a glance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <Metric label="Threat profiles" value={t.threat_profiles} note="aircraft the system tracks by behaviour" />
                  <Metric label="Flags raised" value={t.flags_total} note={`${nf(t.flags_open)} still open`} />
                  <Metric label="Documents read" value={t.documents} note={`${nf(t.passages)} passages indexed`} />
                  <Metric label="Facts extracted" value={t.extracted_facts} note={`${nf(t.facts_promoted)} promoted`} />
                  <Metric label="Case files built" value={t.case_files} />
                  <Metric label="Violations detected" value={t.policy_violations} />
                  <Metric label="Beliefs held" value={t.beliefs} />
                  <Metric label="Learned patterns" value={t.learned_patterns} />
                  <Metric label="Core memories" value={t.sacred_memories} />
                  <Metric label="Reflections written" value={t.reflections} />
                  <Metric label="Pattern observations" value={t.pattern_learning_rows} />
                  <Metric label="Conversation turns" value={t.conversation_turns} />
                </div>
                {monthly.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Sparkbars data={monthly} field="flags" label="Flags raised per month" />
                    <Sparkbars data={monthly} field="threats" label="New threat profiles per month" />
                    <Sparkbars data={monthly} field="extractions" label="Facts extracted per month" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Tabs defaultValue="beliefs">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="beliefs"><Lightbulb className="h-3.5 w-3.5 mr-1" />What it believes</TabsTrigger>
                <TabsTrigger value="patterns"><Sparkles className="h-3.5 w-3.5 mr-1" />Patterns discovered</TabsTrigger>
                <TabsTrigger value="changed"><History className="h-3.5 w-3.5 mr-1" />How judgment changed</TabsTrigger>
                <TabsTrigger value="unsure"><HelpCircle className="h-3.5 w-3.5 mr-1" />Still unsure</TabsTrigger>
              </TabsList>

              {/* 2 — Beliefs */}
              <TabsContent value="beliefs" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Strongest beliefs</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[320px] pr-3">
                      {data.beliefs.length === 0 && <Empty text="No beliefs recorded yet." />}
                      <div className="space-y-2">
                        {data.beliefs.map((b, i) => (
                          <div key={i} className="rounded border border-border/60 p-3">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant="outline">confidence {b.confidence_score ?? "—"}</Badge>
                              <Badge variant="secondary">reinforced {nf(b.evidence_count)}×</Badge>
                              <span className="text-[11px] text-muted-foreground">
                                first held {day(b.first_proposed)} · updated {day(b.last_updated)}
                              </span>
                            </div>
                            <p className="text-sm leading-snug">{b.hypothesis_text}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Core memories</CardTitle></CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[260px] pr-3">
                        {data.sacred.length === 0 && <Empty text="No core memories stored." />}
                        <div className="space-y-2">
                          {data.sacred.map((s, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                                {s.event_type} · {day(s.created_at)}
                              </div>
                              <p className="text-xs leading-snug">{s.sacred_context}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Recent reflections</CardTitle></CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[260px] pr-3">
                        {data.reflections.length === 0 && <Empty text="No reflections written yet." />}
                        <div className="space-y-2">
                          {data.reflections.map((r, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="text-[11px] text-muted-foreground mb-1">
                                {r.trigger_type ?? "reflection"} · {day(r.created_at)}
                              </div>
                              <p className="text-xs leading-snug line-clamp-6">{r.reflection_content}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* 3 — Patterns */}
              <TabsContent value="patterns" className="space-y-4 mt-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm uppercase tracking-wider">Recurring signatures it found on its own</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[320px] pr-3">
                      {data.recurring_signatures.length === 0 && <Empty text="No open signatures." />}
                      <div className="space-y-2">
                        {data.recurring_signatures.map((s, i) => (
                          <div key={i} className="rounded border border-border/60 p-3">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <Badge variant={s.severity === "critical" ? "destructive" : "outline"}>{s.severity}</Badge>
                              <span className="text-xs font-mono">{s.flag_type}</span>
                              {s.registration && <span className="text-xs font-mono text-muted-foreground">{s.registration}</span>}
                              <Badge variant="secondary">seen {nf(s.occurrence_count ?? 1)}×</Badge>
                              <span className="text-[11px] text-muted-foreground">
                                {day(s.first_seen)} → {day(s.last_seen)}
                              </span>
                            </div>
                            <p className="text-xs leading-snug">{s.description}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Learned patterns</CardTitle></CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[260px] pr-3">
                        {data.learned_patterns.length === 0 && <Empty text="No learned patterns yet." />}
                        <div className="space-y-2">
                          {data.learned_patterns.map((p, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge variant="outline">{p.pattern_type}</Badge>
                                <Badge variant="secondary">{nf(p.occurrence_count)}×</Badge>
                                <span className="text-[11px] text-muted-foreground">{day(p.first_observed)} → {day(p.last_observed)}</span>
                              </div>
                              <p className="text-xs leading-snug">{p.description}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Established patterns</CardTitle></CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[260px] pr-3">
                        {data.established_patterns.length === 0 && <Empty text="No established patterns yet." />}
                        <div className="space-y-2">
                          {data.established_patterns.map((p, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <Badge variant="outline">{p.pattern_type}</Badge>
                                <Badge variant="secondary">{nf(p.occurrence_count)}×</Badge>
                              </div>
                              <p className="text-xs leading-snug">{p.description}</p>
                              {p.affected_aircraft && (
                                <p className="text-[11px] font-mono text-muted-foreground mt-1">{String(p.affected_aircraft).slice(0, 160)}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* 4 — How judgment changed */}
              <TabsContent value="changed" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4 text-destructive" /> Escalated aircraft
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[320px] pr-3">
                        {data.escalations.length === 0 && <Empty text="Nothing escalated yet." />}
                        <div className="space-y-2">
                          {data.escalations.map((e, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5 flex items-center justify-between gap-2">
                              <div>
                                <div className="font-mono text-sm">{e.registration}</div>
                                <div className="text-[11px] text-muted-foreground">{e.threat_type} · last seen {day(e.last_seen)}</div>
                              </div>
                              <div className="text-right">
                                <Badge variant="destructive">level {e.escalation_level}</Badge>
                                <div className="text-[11px] text-muted-foreground mt-1">{nf(e.total_violations)} violations</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm uppercase tracking-wider">Self-corrections (flags withdrawn)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-[11px] text-muted-foreground mb-2">
                        {nf(t.flags_auto_resolved)} of {nf(t.flags_total)} flags were closed by the system itself after review.
                      </div>
                      <ScrollArea className="h-[280px] pr-3">
                        {data.corrections.length === 0 && <Empty text="No withdrawn flags to show." />}
                        <div className="space-y-2">
                          {data.corrections.map((c, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <Badge variant="outline">{c.flag_type}</Badge>
                                {c.registration && <span className="text-xs font-mono">{c.registration}</span>}
                                <span className="text-[11px] text-muted-foreground">{c.resolved_reason}</span>
                              </div>
                              <p className="text-xs leading-snug line-clamp-3">{c.description}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Highest-ranked threat profiles</CardTitle></CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[300px]">
                      <table className="w-full text-xs font-mono">
                        <thead className="sticky top-0 bg-muted/40">
                          <tr className="text-left">
                            <th className="px-2 py-1">Aircraft</th>
                            <th className="px-2 py-1">Type</th>
                            <th className="px-2 py-1 text-right">Violations</th>
                            <th className="px-2 py-1 text-right">Level</th>
                            <th className="px-2 py-1">Status</th>
                            <th className="px-2 py-1">First seen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.top_threats.map((r, i) => (
                            <tr key={i} className="border-t border-border/40">
                              <td className="px-2 py-1 font-semibold">{r.registration}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.threat_type}</td>
                              <td className="px-2 py-1 text-right">{nf(r.total_violations)}</td>
                              <td className="px-2 py-1 text-right">{r.escalation_level}</td>
                              <td className="px-2 py-1 text-muted-foreground">{r.countermeasure_status ?? "—"}</td>
                              <td className="px-2 py-1 text-muted-foreground">{day(r.first_seen)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 5 — Still unsure */}
              <TabsContent value="unsure" className="space-y-4 mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Open hypotheses</CardTitle></CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[300px] pr-3">
                        {data.open_questions.hypotheses.length === 0 && data.open_questions.intel_hypotheses.length === 0 && (
                          <Empty text="No open hypotheses." />
                        )}
                        <div className="space-y-2">
                          {data.open_questions.hypotheses.map((h, i) => (
                            <div key={`h${i}`} className="rounded border border-border/60 p-2.5">
                              <div className="text-[11px] text-muted-foreground mb-1">{h.source_type ?? "hypothesis"} · {day(h.created_at)}</div>
                              <p className="text-xs leading-snug line-clamp-5">{h.hypothesis}</p>
                            </div>
                          ))}
                          {data.open_questions.intel_hypotheses.map((h, i) => (
                            <div key={`i${i}`} className="rounded border border-border/60 p-2.5">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline">{h.hypothesis_type}</Badge>
                                <span className="text-[11px] text-muted-foreground">confidence {h.confidence_level ?? "—"}</span>
                              </div>
                              <p className="text-xs leading-snug line-clamp-5">{h.hypothesis}</p>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm uppercase tracking-wider">Unresolved identity conflicts</CardTitle></CardHeader>
                    <CardContent>
                      <div className="text-[11px] text-muted-foreground mb-2">
                        {nf(t.identity_conflicts_open)} operator records disagree between sources and need a decision.
                      </div>
                      <ScrollArea className="h-[270px] pr-3">
                        {data.open_questions.identity_conflicts.length === 0 && <Empty text="No unresolved conflicts." />}
                        <div className="space-y-2">
                          {data.open_questions.identity_conflicts.map((c, i) => (
                            <div key={i} className="rounded border border-border/60 p-2.5">
                              <div className="font-mono text-xs mb-1">{c.registration} · {c.field}</div>
                              <div className="text-xs">A: {c.value_a} <span className="text-muted-foreground">({c.source_a})</span></div>
                              <div className="text-xs">B: {c.value_b} <span className="text-muted-foreground">({c.source_b})</span></div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                      <FileText className="h-4 w-4" /> Documents that failed to process
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.open_questions.failed_documents.length === 0
                      ? <Empty text="Every document was processed successfully." />
                      : (
                        <div className="space-y-2">
                          {data.open_questions.failed_documents.map((d, i) => (
                            <div key={i} className="rounded border border-destructive/40 p-2.5">
                              <div className="text-xs font-medium">{d.title || d.filename}</div>
                              <div className="text-[11px] text-muted-foreground">{d.status_message || "No reason recorded"} · {day(d.created_at)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

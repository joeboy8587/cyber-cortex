import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, ShieldCheck, Plane, Users, FileCheck2, Search } from "lucide-react";

const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

type Conflict = {
  id: string; registration: string; field: string;
  value_a: string | null; source_a: string | null;
  value_b: string | null; source_b: string | null;
  detected_at: string; kind: string; quality: string;
  authority: Record<string, unknown> | null; suggested_resolution: string;
};

type Fact = {
  id: string; extraction_type: string; label: string; value: string | null;
  context: string | null; confidence: number; status: string; document_id: string;
};
type CaseRow = { case_id: string; case_code: string; case_name: string };

export default function FocusFire() {
  const [busy, setBusy] = useState<string | null>(null);

  // 1. conflicts
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [conflictStats, setConflictStats] = useState<Record<string, number>>({});

  // 2. deep dive
  const [subject, setSubject] = useState("N916HT");
  const [dossier, setDossier] = useState<any>(null);

  // 3. pairs
  const [pairs, setPairs] = useState<any[] | null>(null);

  // 4. facts
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseId, setCaseId] = useState<string>("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [factStats, setFactStats] = useState<{ total: number; already_promoted: number }>({ total: 0, already_promoted: 0 });

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("wt-focus", { body });
    if (error) throw new Error(error.message);
    if (data && data.ok === false) throw new Error(data.error || "Request failed");
    return data;
  }, []);

  const loadConflicts = useCallback(async () => {
    setBusy("conflicts");
    try {
      const d = await call({ action: "conflicts" });
      setConflicts(d.conflicts ?? []);
      setConflictStats({
        total: d.total ?? 0,
        aircraft_identity: d.aircraft_identity ?? 0,
        network_links: d.network_links ?? 0,
        placeholders: d.placeholders ?? 0,
      });
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }, [call]);

  const loadFacts = useCallback(async () => {
    setBusy("facts");
    try {
      const d = await call({ action: "facts" });
      setFacts(d.ready ?? []);
      setCases(d.cases ?? []);
      setFactStats({ total: d.total ?? 0, already_promoted: d.already_promoted ?? 0 });
      if (!caseId && d.cases?.length) setCaseId(d.cases[0].case_id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }, [call, caseId]);

  useEffect(() => { loadConflicts(); loadFacts(); /* eslint-disable-next-line */ }, []);

  const resolve = async (c: Conflict, value: string) => {
    setBusy(c.id);
    try {
      await call({ action: "resolve_conflict", id: c.id, resolved_value: value });
      setConflicts((cs) => (cs ?? []).filter((x) => x.id !== c.id));
      toast.success(`${c.registration} settled`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const runDossier = async () => {
    setBusy("dossier");
    try { setDossier(await call({ action: "dossier", subject })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const runPairs = async () => {
    setBusy("pairs");
    try {
      const d = await call({ action: "pairs", days: 30, min_shared: 6 });
      if (d.unavailable) toast.message("That lookup was too slow to finish — try a shorter window.");
      setPairs(d.pairs ?? []);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const promote = async () => {
    const ids = Object.keys(picked).filter((k) => picked[k]);
    if (!ids.length || !caseId) { toast.error("Pick a case and at least one fact."); return; }
    setBusy("promote");
    try {
      const d = await call({ action: "promote_facts", ids, case_id: caseId });
      toast.success(`${d.promoted} fact${d.promoted === 1 ? "" : "s"} filed as exhibits`);
      setPicked({});
      await loadFacts();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };

  const spin = (k: string) => busy === k;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Focus Fire</h1>
          <p className="text-sm text-muted-foreground">
            The four priorities: settle the identity conflicts, work a single aircraft end to end,
            expose aircraft that fly together, and turn extracted facts into numbered exhibits.
          </p>
        </div>

        <Tabs defaultValue="conflicts">
          <TabsList>
            <TabsTrigger value="conflicts"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />Identity conflicts</TabsTrigger>
            <TabsTrigger value="dossier"><Plane className="mr-1.5 h-3.5 w-3.5" />Deep dive</TabsTrigger>
            <TabsTrigger value="pairs"><Users className="mr-1.5 h-3.5 w-3.5" />Flying together</TabsTrigger>
            <TabsTrigger value="facts"><FileCheck2 className="mr-1.5 h-3.5 w-3.5" />Facts to exhibits</TabsTrigger>
          </TabsList>

          {/* 1 */}
          <TabsContent value="conflicts" className="mt-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Open identity conflicts</CardTitle>
                <Button size="sm" variant="outline" onClick={loadConflicts} disabled={!!busy}>
                  {spin("conflicts") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{conflictStats.total ?? 0} open</Badge>
                  <Badge variant="outline">{conflictStats.aircraft_identity ?? 0} aircraft identity</Badge>
                  <Badge variant="outline">{conflictStats.network_links ?? 0} network links</Badge>
                  <Badge variant="outline">{conflictStats.placeholders ?? 0} placeholder data</Badge>
                </div>
                <ScrollArea className="h-[560px] pr-3">
                  <div className="space-y-2">
                    {(conflicts ?? []).map((c) => (
                      <div key={c.id} className="rounded border border-border/60 bg-card/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm text-primary">{c.registration}</span>
                          <div className="flex gap-2">
                            <Badge variant="outline">
                              {c.kind === "aircraft_identity" ? "Registry / identity" : "Network link"}
                            </Badge>
                            {c.quality === "placeholder" && <Badge variant="destructive">Placeholder</Badge>}
                          </div>
                        </div>
                        <div className="mt-1 text-sm">
                          <span className="text-muted-foreground">{c.field}: </span>
                          <span>{c.value_a ?? "—"}</span>
                          <span className="text-muted-foreground"> ({c.source_a ?? "?"}) vs </span>
                          <span>{c.value_b ?? "—"}</span>
                          <span className="text-muted-foreground"> ({c.source_b ?? "?"})</span>
                        </div>
                        <div className="mt-1 text-[12px] text-muted-foreground">{c.suggested_resolution}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.value_a && (
                            <Button size="sm" variant="outline" disabled={!!busy}
                              onClick={() => resolve(c, String(c.value_a))}>Use “{String(c.value_a).slice(0, 28)}”</Button>
                          )}
                          {c.value_b && (
                            <Button size="sm" variant="outline" disabled={!!busy}
                              onClick={() => resolve(c, String(c.value_b))}>Use “{String(c.value_b).slice(0, 28)}”</Button>
                          )}
                          {(c.authority as any)?.operator && (
                            <Button size="sm" disabled={!!busy}
                              onClick={() => resolve(c, String((c.authority as any).operator))}>
                              Use FAA registry
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" disabled={!!busy}
                            onClick={() => resolve(c, "dismissed — not evidence")}>Dismiss</Button>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">found {when(c.detected_at)}</div>
                      </div>
                    ))}
                    {conflicts && conflicts.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">Nothing left open.</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2 */}
          <TabsContent value="dossier" className="mt-3">
            <Card>
              <CardHeader><CardTitle className="text-base">One aircraft, end to end</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Input value={subject} onChange={(e) => setSubject(e.target.value.toUpperCase())}
                    placeholder="Tail number, e.g. N916HT" className="max-w-[220px] font-mono" />
                  <Button onClick={runDossier} disabled={!!busy}>
                    {spin("dossier") ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}
                    Build the picture
                  </Button>
                </div>

                {dossier && (
                  <div className="space-y-3">
                    <div className="rounded border border-border/60 bg-card/40 p-3 text-sm">
                      <div className="font-mono text-primary">{dossier.subject}</div>
                      {dossier.identity ? (
                        <div className="mt-1">
                          {dossier.identity.aircraft_type ?? "unknown type"} · registered to{" "}
                          <span className="font-medium">{dossier.identity.operator ?? "unknown owner"}</span>
                          {dossier.identity.operator_city ? ` of ${dossier.identity.operator_city}, ${dossier.identity.operator_state ?? ""}` : ""}
                        </div>
                      ) : <div className="mt-1 text-muted-foreground">No registry record resolved.</div>}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <Stat label="This month overhead" value={dossier.trend?.this_month ?? 0} />
                      <Stat label="Last month" value={dossier.trend?.last_month ?? 0} />
                      <Stat label="Busiest month on record" value={dossier.trend?.peak_month ?? 0} />
                    </div>

                    <Block title="Month by month overhead">
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                        {(dossier.monthly ?? []).map((m: any) => (
                          <span key={m.month} className="rounded bg-muted/50 px-1.5 py-0.5">{m.month}: {m.contacts}</span>
                        ))}
                      </div>
                    </Block>

                    <Block title="Low passes near the residence (last 120 days)">
                      {(dossier.low_passes ?? []).length === 0 ? <Empty /> : (
                        <div className="space-y-1 text-[12px] font-mono">
                          {dossier.low_passes.slice(0, 12).map((p: any, i: number) => (
                            <div key={i}>{when(p.detection_timestamp)} · {p.altitude} ft · {p.speed} kts · {p.metres_from_home} m away</div>
                          ))}
                        </div>
                      )}
                    </Block>

                    <Block title="Night-time presence">
                      <div className="text-sm">
                        {dossier.night?.night_contacts ?? 0} contacts across {dossier.night?.night_days ?? 0} nights.
                      </div>
                    </Block>

                    <Block title="Who was overhead at the same time (last 30 days)">
                      {(dossier.co_present ?? []).length === 0 ? <Empty /> : (
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                          {dossier.co_present.map((p: any) => (
                            <span key={p.reg} className="rounded bg-muted/50 px-1.5 py-0.5">{p.reg} · {p.shared_windows}×</span>
                          ))}
                        </div>
                      )}
                    </Block>

                    <Block title="Aircraft that fly the same way">
                      {(dossier.behaviour_neighbours ?? []).length === 0 ? <Empty /> : (
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                          {dossier.behaviour_neighbours.map((n: any, i: number) => (
                            <span key={i} className="rounded bg-muted/50 px-1.5 py-0.5">
                              {n.registration ?? n.reg ?? String(n)} {n.similarity ? `· ${Number(n.similarity).toFixed(3)}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </Block>

                    <Block title="Heart-rate correlation">
                      {(dossier.biometric ?? []).length === 0 ? <Empty /> : (
                        <div className="space-y-1 text-[12px] font-mono">
                          {dossier.biometric.map((b: any, i: number) => (
                            <div key={i}>{b.threat_level ?? "—"} · score {b.threat_score ?? "—"} · strength {b.correlation_strength ?? "—"}</div>
                          ))}
                        </div>
                      )}
                    </Block>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3 */}
          <TabsContent value="pairs" className="mt-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Aircraft that show up together</CardTitle>
                <Button size="sm" onClick={runPairs} disabled={!!busy}>
                  {spin("pairs") ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Run the check
                </Button>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-xs text-muted-foreground">
                  Last 30 days over the area of interest. Two aircraft count as sharing a window when both
                  appear inside the same 15-minute slot.
                </p>
                <ScrollArea className="h-[520px] pr-3">
                  <div className="space-y-2">
                    {(pairs ?? []).map((p: any, i: number) => (
                      <div key={i} className="rounded border border-border/60 bg-card/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-sm text-primary">{p.reg_a} + {p.reg_b}</span>
                          <div className="flex gap-2">
                            {p.same_operator && <Badge>Same owner</Badge>}
                            <Badge variant="outline">{p.verdict}</Badge>
                          </div>
                        </div>
                        <div className="mt-1 text-sm">
                          {p.shared_windows} shared windows · {Math.round(p.overlap_ratio * 100)}% of the quieter aircraft's time
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {p.operator_a ?? "owner unknown"} ({p.type_a ?? "type unknown"}) · {p.operator_b ?? "owner unknown"} ({p.type_b ?? "type unknown"})
                        </div>
                      </div>
                    ))}
                    {pairs && pairs.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">No repeated pairings in this window.</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 4 */}
          <TabsContent value="facts" className="mt-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Turn extracted facts into exhibits</CardTitle>
                <Button size="sm" variant="outline" onClick={loadFacts} disabled={!!busy}>
                  {spin("facts") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{factStats.total} facts extracted</Badge>
                  <Badge variant="outline">{factStats.already_promoted} already filed</Badge>
                  <Badge variant="outline">{(facts ?? []).length} ready now</Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={caseId}
                    onChange={(e) => setCaseId(e.target.value)}
                    className="h-9 rounded border border-border bg-background px-2 text-sm"
                  >
                    {cases.map((c) => (
                      <option key={c.case_id} value={c.case_id}>{c.case_code} — {c.case_name}</option>
                    ))}
                  </select>
                  <Button onClick={promote} disabled={!!busy}>
                    {spin("promote") ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileCheck2 className="mr-1.5 h-3.5 w-3.5" />}
                    File {Object.values(picked).filter(Boolean).length || ""} as exhibits
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!!busy}
                    onClick={() => setPicked(Object.fromEntries((facts ?? []).map((f) => [f.id, true])))}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setPicked({})}>Clear</Button>
                </div>

                <ScrollArea className="h-[520px] pr-3">
                  <div className="space-y-2">
                    {(facts ?? []).map((f) => (
                      <label key={f.id} className="flex cursor-pointer gap-3 rounded border border-border/60 bg-card/40 p-3">
                        <Checkbox
                          checked={!!picked[f.id]}
                          onCheckedChange={(v) => setPicked((p) => ({ ...p, [f.id]: !!v }))}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{f.label}</span>
                            <div className="flex gap-2">
                              <Badge variant="outline">{f.extraction_type}</Badge>
                              <span className="font-mono text-xs text-muted-foreground">{Math.round(Number(f.confidence) * 100)}%</span>
                            </div>
                          </div>
                          {f.value && <div className="mt-1 text-sm">{f.value}</div>}
                          {f.context && <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{f.context}</div>}
                        </div>
                      </label>
                    ))}
                    {facts && facts.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">Nothing waiting.</div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-xl">{value}</div>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="text-sm text-muted-foreground">Nothing found in this window.</div>;
}

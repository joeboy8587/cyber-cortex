import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { CalendarDays, RefreshCw, Loader2, Download, CheckCircle2, XCircle, Brain } from "lucide-react";

type Finding = {
  id: string; rule_code: string; subject: string; claim: string;
  confidence: number; status: string; layer: string | null;
  occurrences: number; first_seen: string; last_seen: string;
  evidence: Record<string, unknown> | null;
};
type Investigation = { id: string; subject: string; outcome: string; narrative: string | null; created_at: string };

type Brief = {
  generated_at: string;
  window_hours: number;
  whats_new: Finding[];
  needs_your_call: Finding[];
  strongest: Finding[];
  recent_investigations: Investigation[];
};

const pct = (n: number | string | null | undefined) => `${Math.round(Number(n ?? 0) * 100)}%`;
const when = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

function Row({ f, children }: { f: Finding; children?: React.ReactNode }) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-primary">{f.subject}</span>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {f.layer === "integrity" ? "Integrity" : f.layer === "registry" ? "Registry / identity" : "Behaviour"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{pct(f.confidence)}</span>
        </div>
      </div>
      <div className="mt-1 text-sm">{f.claim}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">seen {f.occurrences}× · last {when(f.last_seen)}</div>
      {children && <div className="mt-2 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export default function DailyBrief() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("wt-investigator", { body });
    if (error) throw new Error(error.message);
    if (data && data.ok === false && !data.paused) throw new Error(data.error || "Request failed");
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await call({ action: "brief", hours: 24 });
      setBrief(d as Brief);
    } catch (e) { toast.error((e as Error).message); } finally { setLoading(false); }
  }, [call]);

  useEffect(() => { void load(); }, [load]);

  const verdict = async (id: string, v: string) => {
    setBusy(id + v);
    try {
      await call({ action: "feedback", finding_id: id, verdict: v });
      toast.success(v === "real" ? "Confirmed" : "Rejected");
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const investigateAll = async () => {
    setBusy("batch");
    try {
      const d = await call({ action: "investigate_batch", count: 3 });
      if (d.paused) toast.warning(`Paused: ${d.reason}`);
      else toast.success(`${d.runs?.length ?? 0} threads pulled`);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const promote = async (f: Finding) => {
    setBusy(f.id + "promote");
    try {
      const { error } = await supabase.from("watchtower_autonomous_flags").insert({
        flag_type: f.rule_code,
        severity: Number(f.confidence) >= 0.8 ? "critical" : "high",
        registration: f.subject,
        description: f.claim,
        evidence_summary: (f.evidence ?? {}) as never,
        confidence_score: Number(f.confidence),
        source_scan_id: `WT_INVESTIGATOR_${stamp()}`,
      });
      if (error) throw new Error(error.message);
      toast.success(`${f.subject} added to the case flags`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const downloadPacket = () => {
    if (!brief) return;
    const lines: string[] = [];
    lines.push(`WATCHTOWER DAILY BRIEF — ${new Date(brief.generated_at).toLocaleString()}`);
    lines.push(`Window: last ${brief.window_hours} hours`);
    lines.push("");
    const block = (title: string, rows: Finding[]) => {
      lines.push(`## ${title}`);
      if (!rows.length) lines.push("(none)");
      rows.forEach((f) => {
        lines.push(`- [${f.layer === "integrity" ? "INTEGRITY" : "REGISTRY/IDENTITY"}] ${f.subject} — ${f.claim}`);
        lines.push(`  confidence ${pct(f.confidence)} · seen ${f.occurrences}× · first ${when(f.first_seen)} · last ${when(f.last_seen)}`);
      });
      lines.push("");
    };
    block("What's new", brief.whats_new);
    block("Needs your call", brief.needs_your_call);
    block("Strongest standing findings", brief.strongest);
    lines.push("## Investigations");
    brief.recent_investigations.forEach((i) => {
      lines.push(`- ${i.subject} (${i.outcome}, ${when(i.created_at)})`);
      if (i.narrative) lines.push(`  ${i.narrative}`);
    });
    lines.push("");
    lines.push("Integrity-layer findings and registry/identity findings are reported separately and must not be merged.");
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stamp()}_WATCHTOWER_BRIEF_daily-findings.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Brief downloaded");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-display uppercase tracking-[0.2em] text-primary">Daily Brief</h1>
            <p className="text-sm text-muted-foreground">
              {brief ? `Prepared ${when(brief.generated_at)} · last ${brief.window_hours} hours` : "Today's findings, in order of strength."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" variant="secondary" onClick={investigateAll} disabled={busy === "batch"}>
              {busy === "batch" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
              Pull three threads
            </Button>
            <Button size="sm" onClick={downloadPacket} disabled={!brief}>
              <Download className="h-4 w-4 mr-1" /> Download the brief
            </Button>
          </div>
        </header>

        {loading && <div className="py-16 text-center text-sm text-muted-foreground">Preparing today's brief…</div>}

        {brief && !loading && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" /> What's new ({brief.whats_new.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-2">
                    {!brief.whats_new.length && <div className="py-8 text-center text-sm text-muted-foreground">Nothing new in this window.</div>}
                    {brief.whats_new.map((f) => (
                      <Row key={f.id} f={f}>
                        <Button size="sm" variant="outline" onClick={() => promote(f)} disabled={busy === f.id + "promote"}>
                          Add to case flags
                        </Button>
                      </Row>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wider">Needs your call ({brief.needs_your_call.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-2">
                    {!brief.needs_your_call.length && <div className="py-8 text-center text-sm text-muted-foreground">Nothing waiting on you.</div>}
                    {brief.needs_your_call.map((f) => (
                      <Row key={f.id} f={f}>
                        <Button size="sm" variant="outline" onClick={() => verdict(f.id, "real")} disabled={busy === f.id + "real"}>
                          <CheckCircle2 className="h-4 w-4 mr-1" /> Real
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => verdict(f.id, "not_real")} disabled={busy === f.id + "not_real"}>
                          <XCircle className="h-4 w-4 mr-1" /> Not real
                        </Button>
                      </Row>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wider">Strongest standing findings</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[340px] pr-3">
                  <div className="space-y-2">
                    {brief.strongest.map((f) => (
                      <Row key={f.id} f={f}>
                        <Button size="sm" variant="outline" onClick={() => promote(f)} disabled={busy === f.id + "promote"}>
                          Add to case flags
                        </Button>
                      </Row>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wider">Latest investigations</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[340px] pr-3">
                  <div className="space-y-2">
                    {!brief.recent_investigations.length && <div className="py-8 text-center text-sm text-muted-foreground">No investigations yet.</div>}
                    {brief.recent_investigations.map((i) => (
                      <div key={i.id} className="rounded border border-border/60 bg-card/40 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm text-primary">{i.subject}</span>
                          <Badge variant="outline">{i.outcome}</Badge>
                        </div>
                        {i.narrative && <p className="mt-1 text-sm leading-relaxed">{i.narrative}</p>}
                        <div className="mt-1 text-[11px] text-muted-foreground">{when(i.created_at)}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

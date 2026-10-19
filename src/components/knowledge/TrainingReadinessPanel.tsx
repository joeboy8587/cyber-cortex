import { useCallback, useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Download } from "lucide-react";

type LabelKey = "proven" | "normal" | "exclude" | "unsorted";
const LABELS: { key: LabelKey; title: string; hint: string }[] = [
  { key: "proven", title: "Proven", hint: "Tied to a confirmed fact, exhibit or FAA-verified watchlist airframe" },
  { key: "normal", title: "Normal", hint: "Routine airline / airport / ground traffic" },
  { key: "exclude", title: "Don't use", hint: "Damaged imports, test codes, old altitude flags" },
  { key: "unsorted", title: "Not yet sorted", hint: "Kept for review" },
];
type Row = { id: string; source_table: string; source_id: string; subject: string | null; label: LabelKey; reason_code: string; reason_text: string; rule_version: string; observed_at: string | null; sha256: string };

async function sha256Hex(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function TrainingReadinessPanel() {
  const [counts, setCounts] = useState<Record<LabelKey, number>>({ proven: 0, normal: 0, exclude: 0, unsorted: 0 });
  const [review, setReview] = useState<Row[]>([]);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [span, setSpan] = useState<{ earliest: string; latest: string } | null>(null);

  const load = useCallback(async () => {
    const c = { ...counts };
    await Promise.all(LABELS.map(async l => {
      const { count } = await supabase.from("training_labels").select("id", { count: "exact", head: true }).eq("label", l.key).eq("superseded", false);
      c[l.key] = count ?? 0;
    }));
    setCounts(c);
    const { data } = await supabase.from("training_labels").select("*").eq("superseded", false).eq("reason_code", "WATCHLIST_NEEDS_REVIEW").order("observed_at", { ascending: false }).limit(15);
    setReview((data as Row[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const sweep = async (scope: "flights" | "policy_flags" | "sealed_archive") => {
    setBusy(scope);
    let cursor: string | undefined = scope === "sealed_archive" ? (localStorage.getItem("tr_sealed_cursor") ?? undefined) : undefined;
    if (cursor === "done") { setBusy(null); return toast.info("The whole sealed archive is already sorted."); }
    let total = 0; let rounds = 0;
    try {
      do {
        const { data, error } = await supabase.functions.invoke("training-label-sweep", { body: { scope, days, cursor } });
        if (error || data?.error) throw new Error(data?.error ?? error?.message);
        total += data.labeled; cursor = data.next_cursor ?? undefined; rounds++;
        if (scope === "sealed_archive") { localStorage.setItem("tr_sealed_cursor", cursor ?? "done"); if (data.span) setSpan(data.span); if (data.total_pages) setProgress(Math.min(100, Math.round((Number(cursor ?? data.total_pages) / data.total_pages) * 100))); }
      } while (cursor && rounds < (scope === "sealed_archive" ? 40 : 10));
      toast.success(`Sorted ${total.toLocaleString()} records${cursor ? " (more remain — press again to continue)" : ""}.`);
    } catch (e) {
      toast.error(`Sorting stopped: ${e instanceof Error ? e.message : e}`);
    } finally { setBusy(null); load(); }
  };

  const decide = async (r: Row, label: LabelKey) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Please sign in");
    const sha = await sha256Hex(`USER|${r.source_table}|${r.source_id}|${label}`);
    const { error } = await supabase.from("training_labels").upsert({
      source_db: "neon", source_table: r.source_table, source_id: r.source_id, subject: r.subject, label,
      reason_code: "USER_DECISION", reason_text: `Set by investigator (was: ${r.reason_text})`,
      rule_version: `USER:${u.user.id}`, decided_by: u.user.id, observed_at: r.observed_at, sha256: sha,
    }, { onConflict: "source_table,source_id,rule_version" });
    if (error) return toast.error(error.message);
    await supabase.from("training_labels").update({ superseded: true, superseded_reason: "Replaced by investigator decision" }).eq("id", r.id);
    toast.success("Saved — your decision replaces the automatic label.");
    load();
  };

  const exportCsv = async () => {
    setBusy("export");
    const all: Row[] = [];
    for (let from = 0; from < 50000; from += 1000) {
      const { data } = await supabase.from("training_labels").select("*").eq("superseded", false).range(from, from + 999);
      if (!data?.length) break; all.push(...(data as Row[])); if (data.length < 1000) break;
    }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = ["source_table,source_id,subject,label,reason_code,reason_text,rule_version,observed_at,sha256",
      ...all.map(r => [r.source_table, r.source_id, r.subject, r.label, r.reason_code, r.reason_text, r.rule_version, r.observed_at, r.sha256].map(esc).join(","))].join("\n");
    const digest = await sha256Hex(body);
    const text = `${body}\n\n# ${all.length} labels. SHA-256 of rows above: ${digest}\n# All data referenced in this document is drawn from public sources — FAA ADS-B broadcasts, public corporate filings, and published regulations — and is independently verifiable by any member of the public.\n`;
    const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `${ymd}_ML_EXHIBIT_TRAINING_MANIFEST.csv`; a.click();
    setBusy(null);
  };

  return (
    <CyberPanel title="TRAINING READINESS — WHAT'S SAFE TO LEARN FROM">
      <p className="text-sm text-muted-foreground mb-4">
        Sorts records into Proven, Normal and Don't use before any AI training. Original records are never changed or deleted.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {LABELS.map(l => (
          <div key={l.key} className="rounded border border-border p-3">
            <div className="text-2xl font-bold">{counts[l.key].toLocaleString()}</div>
            <div className="font-medium">{l.title}</div>
            <div className="text-xs text-muted-foreground">{l.hint}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[7, 30, 90].map(d => (
          <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} days</Button>
        ))}
        <Button size="sm" onClick={() => sweep("flights")} disabled={!!busy}>
          <RefreshCw className={`h-4 w-4 mr-1 ${busy === "flights" ? "animate-spin" : ""}`} />Sort flight records
        </Button>
        <Button size="sm" variant="secondary" onClick={() => sweep("policy_flags")} disabled={!!busy}>
          <RefreshCw className={`h-4 w-4 mr-1 ${busy === "policy_flags" ? "animate-spin" : ""}`} />Sort rule flags
        </Button>
        <Button size="sm" variant="secondary" onClick={() => sweep("sealed_archive")} disabled={!!busy}>
          <RefreshCw className={`h-4 w-4 mr-1 ${busy === "sealed_archive" ? "animate-spin" : ""}`} />Sort sealed archive (earliest records)
        </Button>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!!busy}><Download className="h-4 w-4 mr-1" />Export</Button>
      </div>
      {progress != null && (
        <p className="text-sm mb-4">Sealed archive: about {progress}% sorted{span ? ` — last batch covered ${new Date(span.earliest).toLocaleDateString()} to ${new Date(span.latest).toLocaleDateString()}` : ""}. Press again to continue; it picks up where it stopped. The archive itself is only read, never changed.</p>
      )}
      <h4 className="font-semibold mb-2">Needs your decision (watchlist aircraft)</h4>
      {review.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting right now.</p> : (
        <div className="space-y-2">
          {review.map(r => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
              <Badge variant="outline">{r.subject ?? "?"}</Badge>
              <span className="text-muted-foreground">{r.observed_at ? new Date(r.observed_at).toLocaleString() : ""}</span>
              <span className="flex-1">Why? {r.reason_text}</span>
              <Button size="sm" variant="outline" onClick={() => decide(r, "proven")}>Proven</Button>
              <Button size="sm" variant="outline" onClick={() => decide(r, "normal")}>Normal</Button>
              <Button size="sm" variant="outline" onClick={() => decide(r, "exclude")}>Don't use</Button>
            </div>
          ))}
        </div>
      )}
    </CyberPanel>
  );
}

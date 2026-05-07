import { useEffect, useMemo, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Database, Hammer, CheckCircle2, RefreshCw } from "lucide-react";
import { neonQuery } from "@/lib/neonQueryRetry";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface EntityRow {
  type: string;
  canonical_value: string;
  source_table: string;
  occurrences: number;
  last_seen: string | null;
}

const DEFAULT_CASE_ID = "8a741d4f-8c20-4fbe-8b99-8fbc37300cb1"; // CASE-001-RICO

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function EntityIndexTable() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ probed: number; sources_available: number; generated_at?: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [minOccurrences, setMinOccurrences] = useState(100);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try {
      const data: any = await neonQuery({ action: "entityCanonicalIndex", min_occurrences: 5, limit: 5000 }, 0);
      setRows((data?.rows as EntityRow[]) ?? []);
      setMeta({ probed: data?.probed, sources_available: data?.sources_available, generated_at: data?.generated_at });
    } catch (e: any) {
      toast({ title: "Failed to load canonical index", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // Pre-load any already-promoted canonical_values for current case
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("watchtower_autonomous_flags")
        .select("registration")
        .eq("flag_type", "CANONICAL_HIGH_OCCURRENCE")
        .limit(1000);
      if (data) setPromoted(new Set(data.map(r => r.registration ?? "").filter(Boolean)));
    })();
  }, []);

  const types = useMemo(() => Array.from(new Set(rows.map(r => r.type))).sort(), [rows]);
  const sources = useMemo(() => Array.from(new Set(rows.map(r => r.source_table))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter(r =>
      r.occurrences >= minOccurrences &&
      (!typeFilter || r.type === typeFilter) &&
      (!sourceFilter || r.source_table === sourceFilter) &&
      (!q || r.canonical_value.toLowerCase().includes(q))
    ).slice(0, 500);
  }, [rows, filter, typeFilter, sourceFilter, minOccurrences]);

  const promote = async (row: EntityRow) => {
    const key = `${row.canonical_value}|${row.source_table}`;
    setPromoting(key);
    try {
      const snapshotTs = new Date().toISOString();
      const sourceHash = await sha256Hex(JSON.stringify({
        canonical: row.canonical_value, source_table: row.source_table,
        occurrences: row.occurrences, snapshot_ts: snapshotTs,
      }));

      // Severity ladder by occurrence count
      const severity =
        row.occurrences >= 5000 ? "critical" :
        row.occurrences >= 1000 ? "high" :
        row.occurrences >= 100 ? "medium" : "low";

      // 1. Insert exhibit
      const exhibitCode = `EXH-D-${row.canonical_value.replace(/[^A-Z0-9]/gi, "").slice(0, 12)}-${sourceHash.slice(0, 6).toUpperCase()}`;
      const { data: exhibit, error: exErr } = await supabase
        .from("exhibits")
        .insert({
          case_id: DEFAULT_CASE_ID,
          exhibit_code: exhibitCode,
          exhibit_name: `Canonical Entity ${row.canonical_value} — ${row.source_table}`,
          tier: severity === "critical" ? 1 : severity === "high" ? 2 : 3,
          evidence_type: "entity_canonical",
          status: "draft",
          sha256_hash: sourceHash,
          promotion_rule: "entity_canonical_index_phase1",
          description: `${row.occurrences.toLocaleString()} occurrences of ${row.type} ${row.canonical_value} in ${row.source_table}.`,
          legal_significance: severity === "critical"
            ? "High-frequency canonical entity; primary defendant candidate for RICO/§1983 pleading."
            : "Supporting canonical entity for pattern-of-conduct evidence.",
          chain_of_custody: [{ action: "promote_from_canonical_index", at: snapshotTs, source_hash: sourceHash }] as any,
        })
        .select()
        .single();
      if (exErr) throw exErr;

      // 2. Insert autonomous flag
      const { error: flagErr } = await supabase
        .from("watchtower_autonomous_flags")
        .insert({
          flag_type: "CANONICAL_HIGH_OCCURRENCE",
          severity,
          registration: row.canonical_value,
          description: `Promoted from canonical index: ${row.occurrences.toLocaleString()} occurrences in ${row.source_table}`,
          confidence_score: Math.min(1, row.occurrences / 5000),
          evidence_summary: {
            canonical_value: row.canonical_value, type: row.type,
            source_table: row.source_table, occurrences: row.occurrences,
            last_seen: row.last_seen, exhibit_code: exhibitCode, exhibit_id: exhibit?.exhibit_id,
          } as any,
          source_scan_id: `entity_canonical_index:${snapshotTs}`,
        });
      if (flagErr) throw flagErr;

      // 3. Audit trail
      const resultHash = await sha256Hex(`${sourceHash}|${exhibit?.exhibit_id}`);
      await supabase.from("exhibit_audit_trail").insert({
        case_id: DEFAULT_CASE_ID,
        exhibit_id: exhibit?.exhibit_id,
        action: "PROMOTE",
        rule_applied: "entity_canonical_index_phase1",
        source_hash: sourceHash,
        result_hash: resultHash,
        records_evaluated: row.occurrences,
        records_promoted: 1,
        metadata: { canonical_value: row.canonical_value, type: row.type, source_table: row.source_table } as any,
      });

      setPromoted(prev => new Set(prev).add(row.canonical_value));
      toast({
        title: "Promoted to exhibit",
        description: `${exhibitCode} · severity ${severity} · SHA-256 ${sourceHash.slice(0, 12)}…`,
      });
    } catch (e: any) {
      toast({ title: "Promotion failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally { setPromoting(null); }
  };

  return (
    <CyberPanel title="Canonical Entity Index" icon={<Database className="w-4 h-4" />}>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground flex-1">
            Every operator, registration, ICAO, and identifier resolved to a canonical value with occurrence
            counts across source tables. Click <span className="text-primary font-mono">[PROMOTE]</span> to
            create an exhibit + autonomous flag + SHA-256 audit entry in one click.
          </p>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>

        {meta && (
          <div className="text-[10px] font-mono text-muted-foreground">
            {rows.length.toLocaleString()} canonical rows · {meta.sources_available}/{meta.probed} source columns active
            {meta.generated_at && ` · generated ${new Date(meta.generated_at).toLocaleTimeString()}`}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="search canonical value…" className="h-8 text-xs flex-1 min-w-[180px]" />
          <Input
            type="number" value={minOccurrences} onChange={e => setMinOccurrences(Math.max(0, Number(e.target.value) || 0))}
            className="h-8 text-xs w-28" placeholder="min occ"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          <button onClick={() => setTypeFilter(null)} className={`text-[10px] px-2 py-0.5 rounded border ${!typeFilter ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"}`}>
            All types
          </button>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              className={`text-[10px] px-2 py-0.5 rounded border ${typeFilter === t ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"}`}>
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <button onClick={() => setSourceFilter(null)} className={`text-[10px] px-2 py-0.5 rounded border ${!sourceFilter ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"}`}>
            All sources
          </button>
          {sources.map(s => (
            <button key={s} onClick={() => setSourceFilter(sourceFilter === s ? null : s)}
              className={`text-[10px] px-2 py-0.5 rounded border font-mono ${sourceFilter === s ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"}`}>
              {s}
            </button>
          ))}
        </div>

        <ScrollArea className="h-[560px] rounded border border-border/40">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/95 backdrop-blur border-b border-border/60">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Canonical Value</th>
                <th className="px-2 py-1.5">Source</th>
                <th className="px-2 py-1.5 text-right">Occurrences</th>
                <th className="px-2 py-1.5">Last Seen</th>
                <th className="px-2 py-1.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const key = `${r.canonical_value}|${r.source_table}`;
                const isPromoted = promoted.has(r.canonical_value);
                return (
                  <tr key={key} className="border-b border-border/20 hover:bg-muted/30">
                    <td className="px-2 py-1.5"><Badge variant="outline" className="text-[9px] py-0">{r.type}</Badge></td>
                    <td className="px-2 py-1.5 font-mono font-semibold text-foreground">{r.canonical_value}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">{r.source_table}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{Number(r.occurrences).toLocaleString()}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                      {r.last_seen ? new Date(r.last_seen).toLocaleString() : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isPromoted ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> Exhibit
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-6 text-[10px]"
                          disabled={promoting === key}
                          onClick={() => promote(r)}>
                          {promoting === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Hammer className="w-3 h-3 mr-1" />PROMOTE</>}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={6} className="text-center text-muted-foreground py-8 text-xs">No canonical entities match filters.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </CyberPanel>
  );
}

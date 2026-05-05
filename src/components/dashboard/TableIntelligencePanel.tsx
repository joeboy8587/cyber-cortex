import { useState, useMemo } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Brain, Search, Loader2, Layers, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CatalogEntry {
  schema: string; table: string; full_name: string;
  row_count: number; column_count: number;
  domains: string[];
  entities: { canonical: string; column: string }[];
  quality: "high" | "medium" | "low";
  sample_columns: string[];
}

interface Catalog {
  scanned_at: string;
  summary: {
    total_tables: number; high_quality: number; medium_quality: number; low_quality: number;
    domain_counts: Record<string, number>;
    canonical_entities: Record<string, number>;
  };
  catalog: CatalogEntry[];
  entity_index: Record<string, { table: string; column: string; rows: number }[]>;
}

const DOMAIN_COLORS: Record<string, string> = {
  flight: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  aircraft: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
  biometric: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  legal: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  financial: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  ai_pattern: "bg-violet-500/20 text-violet-300 border-violet-500/40",
  kcso_mil: "bg-red-500/20 text-red-300 border-red-500/40",
  geo: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  audit: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  report: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  uncategorized: "bg-muted text-muted-foreground border-border",
};

export function TableIntelligencePanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [filter, setFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [qualityFilter, setQualityFilter] = useState<string | null>("high");
  const [entityTerm, setEntityTerm] = useState("N229AM");
  const [entityResult, setEntityResult] = useState<any>(null);

  const buildCatalog = async () => {
    setBusy("catalog");
    try {
      const { data, error } = await supabase.functions.invoke("table-intelligence", { body: { action: "buildCatalog" } });
      if (error) throw error;
      setCatalog(data as Catalog);
    } catch (e) {
      console.error(e);
    } finally { setBusy(null); }
  };

  const findEntity = async () => {
    if (!entityTerm.trim()) return;
    setBusy("entity");
    setEntityResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("table-intelligence", {
        body: { action: "findEntity", term: entityTerm.trim() },
      });
      if (error) throw error;
      setEntityResult(data);
    } catch (e: any) {
      setEntityResult({ error: e.message });
    } finally { setBusy(null); }
  };

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = filter.toLowerCase();
    return catalog.catalog.filter((c) => {
      if (qualityFilter && c.quality !== qualityFilter) return false;
      if (domainFilter && !c.domains.includes(domainFilter)) return false;
      if (q && !c.full_name.toLowerCase().includes(q) && !c.sample_columns.join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 200);
  }, [catalog, filter, domainFilter, qualityFilter]);

  return (
    <CyberPanel title="Table Intelligence Catalog" icon={<Brain className="w-4 h-4" />}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Discovery layer over schema sprawl. Classifies every table by domain, surfaces small-but-high-value
          tables, and resolves a single entity (e.g. <code>N229AM</code>) across every table that holds it.
        </p>

        <div className="flex gap-2">
          <Button size="sm" onClick={buildCatalog} disabled={busy === "catalog"}>
            {busy === "catalog" ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Scanning…</> : <><Layers className="w-3 h-3 mr-1" />Build Catalog</>}
          </Button>
          <Input value={entityTerm} onChange={(e) => setEntityTerm(e.target.value)} placeholder="Tail / ICAO / call-sign" className="h-8 text-xs" />
          <Button size="sm" variant="outline" onClick={findEntity} disabled={busy === "entity"}>
            {busy === "entity" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3 mr-1" />}
            Find
          </Button>
        </div>

        {entityResult && (
          <div className="rounded border border-primary/40 bg-primary/5 p-2">
            {entityResult.error ? (
              <div className="text-xs text-destructive">{entityResult.error}</div>
            ) : (
              <>
                <div className="text-xs font-semibold mb-1">
                  <span className="text-primary">{entityResult.term}</span> → {entityResult.total_tables_with_hits} tables, {entityResult.total_records_across_db.toLocaleString()} records
                </div>
                <ScrollArea className="h-32">
                  <div className="space-y-0.5">
                    {(entityResult.hits ?? []).map((h: any) => (
                      <div key={h.table + h.column} className="flex justify-between text-[11px] font-mono">
                        <span className="truncate text-foreground">{h.table}</span>
                        <span className="text-muted-foreground ml-2">{h.column} · {h.matches.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        )}

        {catalog && (
          <>
            <div className="grid grid-cols-4 gap-2 text-center">
              <Stat label="Tables" value={catalog.summary.total_tables} />
              <Stat label="High value" value={catalog.summary.high_quality} accent="good" />
              <Stat label="Medium" value={catalog.summary.medium_quality} />
              <Stat label="Low / empty" value={catalog.summary.low_quality} accent="warn" />
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Domains</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(catalog.summary.domain_counts).sort((a, b) => b[1] - a[1]).map(([d, n]) => (
                  <button key={d} onClick={() => setDomainFilter(domainFilter === d ? null : d)}
                    className={`text-[10px] px-2 py-0.5 rounded border ${DOMAIN_COLORS[d] ?? DOMAIN_COLORS.uncategorized} ${domainFilter === d ? "ring-1 ring-primary" : ""}`}>
                    {d} · {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter table or column…" className="h-7 text-xs pl-7" />
              </div>
              {(["high", "medium", "low"] as const).map((q) => (
                <button key={q} onClick={() => setQualityFilter(qualityFilter === q ? null : q)}
                  className={`text-[10px] px-2 py-1 rounded border ${qualityFilter === q ? "bg-primary/20 border-primary text-primary" : "border-border text-muted-foreground"}`}>
                  {q}
                </button>
              ))}
            </div>

            <ScrollArea className="h-80 rounded border border-border/40">
              <div className="p-2 space-y-1">
                {filtered.map((c) => (
                  <div key={c.full_name} className="text-[11px] p-1.5 rounded hover:bg-muted/40 border border-transparent hover:border-border/40">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold truncate flex-1">{c.full_name}</span>
                      <Badge variant="outline" className="text-[9px] py-0 h-4">{c.row_count.toLocaleString()}</Badge>
                      <Badge className={`text-[9px] py-0 h-4 ${c.quality === "high" ? "bg-emerald-500/20 text-emerald-300" : c.quality === "low" ? "bg-muted" : "bg-yellow-500/20 text-yellow-300"}`}>
                        {c.quality}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {c.domains.map((d) => (
                        <span key={d} className={`text-[9px] px-1.5 rounded border ${DOMAIN_COLORS[d] ?? DOMAIN_COLORS.uncategorized}`}>{d}</span>
                      ))}
                      {c.entities.map((e) => (
                        <span key={e.column} className="text-[9px] px-1.5 rounded border border-primary/40 text-primary">
                          {e.canonical}:{e.column}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {filtered.length === 0 && <div className="text-[11px] text-muted-foreground p-4 text-center">No tables match current filters.</div>}
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: "good" | "warn" }) {
  const color = accent === "good" ? "text-emerald-400" : accent === "warn" ? "text-orange-400" : "text-primary";
  return (
    <div className="p-2 rounded border border-border/50 bg-background/30">
      <div className={`text-lg font-mono font-bold ${color}`}>{value.toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

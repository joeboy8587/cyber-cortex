import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Database, Loader2, AlertTriangle, Layers, Copy, Archive, FileSearch, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface InventoryReport {
  scanned_at: string;
  summary: {
    total_schemas: number;
    total_tables: number;
    total_rows_estimate: number;
    total_size_pretty: string;
    empty_tables: number;
    empty_pct: number;
    duplicate_groups: number;
    duplicate_table_count: number;
    fragment_families: number;
  };
  schemas: { schema: string; table_count: number }[];
  top_tables: { schema: string; table: string; row_count: number; size_pretty: string; column_count: number }[];
  empty_tables_sample: { schema: string; table: string }[];
  duplicates: { signature: string; tables: string[]; total_rows: number }[];
  fragment_families: { family_name: string; tables: { name: string; rows: number }[]; total_rows: number }[];
}

export function ForensicDBInventory() {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const runScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("forensic-db-inventory", {
        body: { action: "fullScan" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setReport(data as InventoryReport);
      toast({ title: "Inventory complete", description: `Scanned ${(data as any).summary.total_tables} tables across ${(data as any).summary.total_schemas} schemas` });
    } catch (err) {
      toast({ title: "Scan failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  return (
    <CyberPanel title="Forensic DB Inventory (Phase 1 — Read-Only)" icon={<FileSearch className="w-5 h-5" />} variant="default">
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs text-foreground">
            <strong className="text-primary">Safe scan.</strong> This audits all schemas, tables, row counts, sizes, duplicates, and fragmentation patterns.
            <span className="text-muted-foreground"> No data is modified or deleted.</span> A snapshot is saved to <code className="text-[10px]">forensic_db_inventory_snapshots</code>.
          </p>
        </div>

        <Button onClick={runScan} disabled={loading} className="w-full">
          {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning Neon DB…</> : <><Database className="w-4 h-4 mr-2" />Run Full Inventory Scan</>}
        </Button>

        {report && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Stat label="Tables" value={report.summary.total_tables} />
              <Stat label="Total Rows" value={report.summary.total_rows_estimate.toLocaleString()} />
              <Stat label="Total Size" value={report.summary.total_size_pretty} />
              <Stat label="Schemas" value={report.summary.total_schemas} />
              <Stat label="Empty Tables" value={`${report.summary.empty_tables} (${report.summary.empty_pct}%)`} accent="warn" />
              <Stat label="Duplicate Groups" value={report.summary.duplicate_groups} accent="warn" />
              <Stat label="Duplicate Tables" value={report.summary.duplicate_table_count} accent="warn" />
              <Stat label="Fragment Families" value={report.summary.fragment_families} accent="warn" />
            </div>

            {/* Schemas */}
            <Section title="Schemas" icon={<Layers className="w-4 h-4" />} k="schemas" expanded={expanded} onToggle={toggle}>
              <div className="space-y-1">
                {report.schemas.map((s) => (
                  <div key={s.schema} className="flex justify-between text-xs p-2 rounded bg-background/30 border border-border/30">
                    <span className="font-mono text-primary">{s.schema}</span>
                    <Badge variant="outline" className="text-[10px]">{s.table_count} tables</Badge>
                  </div>
                ))}
              </div>
            </Section>

            {/* Fragment Families */}
            <Section title={`Fragment Families (${report.fragment_families.length})`} icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} k="fragments" expanded={expanded} onToggle={toggle}>
              <div className="space-y-2">
                {report.fragment_families.map((f) => (
                  <div key={f.family_name} className="rounded border border-orange-500/30 bg-orange-500/5 p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-orange-400">{f.family_name}</span>
                      <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30">
                        {f.tables.length} tables · {f.total_rows.toLocaleString()} rows
                      </Badge>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {f.tables.slice(0, 20).map((t) => (
                        <div key={t.name} className="flex justify-between text-[11px] font-mono">
                          <span className="text-muted-foreground truncate">{t.name}</span>
                          <span className="text-foreground">{t.rows.toLocaleString()}</span>
                        </div>
                      ))}
                      {f.tables.length > 20 && <div className="text-[10px] text-muted-foreground">+{f.tables.length - 20} more</div>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Duplicates */}
            <Section title={`Duplicate-Shape Tables (${report.duplicates.length} groups)`} icon={<Copy className="w-4 h-4 text-yellow-400" />} k="dupes" expanded={expanded} onToggle={toggle}>
              <div className="space-y-2">
                {report.duplicates.map((d, i) => (
                  <div key={i} className="rounded border border-yellow-500/30 bg-yellow-500/5 p-2">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-medium text-yellow-400">Group {i + 1} · {d.tables.length} tables</span>
                      <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                        {d.total_rows.toLocaleString()} rows
                      </Badge>
                    </div>
                    <div className="space-y-0.5">
                      {d.tables.map((t) => (
                        <div key={t} className="text-[11px] font-mono text-muted-foreground">{t}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Top tables by size */}
            <Section title="Top 50 Tables by Size" icon={<Database className="w-4 h-4" />} k="top" expanded={expanded} onToggle={toggle}>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {report.top_tables.map((t) => (
                  <div key={`${t.schema}.${t.table}`} className="flex justify-between items-center text-xs p-1.5 rounded bg-background/30 border border-border/30">
                    <span className="font-mono text-foreground truncate">{t.schema}.{t.table}</span>
                    <div className="flex gap-2 items-center">
                      <span className="text-muted-foreground text-[10px]">{t.row_count.toLocaleString()} rows</span>
                      <Badge variant="outline" className="text-[10px]">{t.size_pretty}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Empty tables */}
            <Section title={`Empty Tables Sample (${report.empty_tables_sample.length} of ${report.summary.empty_tables})`} icon={<Archive className="w-4 h-4 text-muted-foreground" />} k="empty" expanded={expanded} onToggle={toggle}>
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {report.empty_tables_sample.map((t) => (
                  <div key={`${t.schema}.${t.table}`} className="text-[11px] font-mono text-muted-foreground">
                    {t.schema}.{t.table}
                  </div>
                ))}
              </div>
            </Section>

            <div className="text-[10px] text-muted-foreground border-t border-border pt-2">
              Scanned: {new Date(report.scanned_at).toLocaleString()} · Snapshot saved to <code>forensic_db_inventory_snapshots</code>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: "warn" }) {
  return (
    <div className={`p-2 rounded-lg bg-background/50 border text-center ${accent === "warn" ? "border-orange-500/30" : "border-border"}`}>
      <div className={`text-base font-mono font-bold ${accent === "warn" ? "text-orange-400" : "text-primary"}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, icon, k, expanded, onToggle, children }: {
  title: string; icon: React.ReactNode; k: string; expanded: Record<string, boolean>; onToggle: (k: string) => void; children: React.ReactNode;
}) {
  const open = expanded[k] ?? false;
  return (
    <div className="rounded-lg border border-border/50">
      <button onClick={() => onToggle(k)} className="w-full p-2 flex items-center justify-between hover:bg-background/30">
        <div className="flex items-center gap-2 text-sm font-medium">{icon}{title}</div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && <div className="p-2 border-t border-border/30">{children}</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldCheck, Play, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  id: string;
  source_type: string;
  source_path: string;
  table_name: string;
  column_ref: string | null;
  status: string;
  suggested_fix: string | null;
  severity: string;
  scanned_at: string;
}

/**
 * SchemaWiringPanel — displays which UI files and edge functions reference
 * which Neon tables/columns and flags stale references (dropped tables,
 * renamed columns) that cause 5xx errors like the recent `ground_speed` break.
 */
export function SchemaWiringPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("schema_wiring_report")
      .select("*")
      .order("severity", { ascending: false })
      .order("scanned_at", { ascending: false })
      .limit(1000);
    if (error) toast.error(error.message);
    else setRows((data as Row[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const scan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("schema-wiring-audit", {
        body: { action: "audit" },
      });
      if (error) throw error;
      toast.success(`Audit complete — ${data?.summary?.critical ?? 0} critical, ${data?.summary?.renamed ?? 0} renamed`);
      await load();
    } catch (e: any) {
      toast.error(`Audit failed: ${e?.message || e}`);
    } finally { setScanning(false); }
  };

  const filtered = rows.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (!filter) return true;
    const f = filter.toLowerCase();
    return r.source_path.toLowerCase().includes(f)
      || r.table_name.toLowerCase().includes(f)
      || (r.column_ref || "").toLowerCase().includes(f);
  });

  const counts = {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    renamed: rows.filter((r) => r.status === "renamed").length,
    missing: rows.filter((r) => r.status === "missing_column").length,
    dropped: rows.filter((r) => r.status === "dropped_table").length,
  };

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-500">
          <ShieldCheck className="w-5 h-5" />
          Schema Wiring Audit — Catch Broken Table/Column References
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Cross-checks every registered UI component and edge function against the live Neon schema.
          Flags dropped tables and renamed columns before they cause 5xx errors.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Run Wiring Audit
          </Button>
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Filter by file, table, or column..."
              value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {["all","ok","renamed","missing_column","dropped_table"].map((s) => (
              <Badge key={s} variant={statusFilter === s ? "default" : "outline"}
                className="cursor-pointer" onClick={() => setStatusFilter(s)}>
                {s}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex gap-2 text-xs font-mono">
          <Badge variant="outline">total: {counts.total}</Badge>
          <Badge variant="secondary">ok: {counts.ok}</Badge>
          <Badge variant="default">renamed: {counts.renamed}</Badge>
          <Badge variant="destructive">missing: {counts.missing}</Badge>
          <Badge variant="destructive">dropped: {counts.dropped}</Badge>
        </div>

        <ScrollArea className="h-[440px] rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card border-b">
              <tr>
                <th className="text-left p-2">Source</th>
                <th className="text-left p-2">Table</th>
                <th className="text-left p-2">Column</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Fix</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="p-2">
                    <div className="font-bold">{r.source_path}</div>
                    <div className="text-muted-foreground">{r.source_type}</div>
                  </td>
                  <td className="p-2">{r.table_name}</td>
                  <td className="p-2">{r.column_ref || "—"}</td>
                  <td className="p-2">
                    <Badge variant={
                      r.status === "ok" ? "secondary"
                      : r.status === "renamed" ? "default"
                      : "destructive"
                    }>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground">{r.suggested_fix || ""}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                  {loading ? "Loading..." : rows.length === 0 ? "No audit yet — click 'Run Wiring Audit'." : "No matches."}
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

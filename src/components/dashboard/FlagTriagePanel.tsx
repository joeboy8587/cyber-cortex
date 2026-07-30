import { useCallback, useEffect, useMemo, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, RefreshCw, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface FlagGroup {
  id: string;
  signature: string;
  flag_type: string;
  registration: string | null;
  description: string;
  effective_severity: Severity;
  occurrence_count: number;
  first_seen: string | null;
  last_seen: string | null;
  confidence_score: number | null;
}

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

const SEV_STYLES: Record<Severity, string> = {
  critical: "border-destructive/60 text-destructive bg-destructive/10",
  high: "border-warning/60 text-warning bg-warning/10",
  medium: "border-primary/50 text-primary bg-primary/10",
  low: "border-border text-muted-foreground bg-muted/20",
  info: "border-border text-muted-foreground bg-muted/10",
};

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function FlagTriagePanel() {
  const [groups, setGroups] = useState<FlagGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<Severity>("critical");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async (sev: Severity) => {
    setLoading(true);
    const { data } = await supabase
      .from("v_watchtower_flag_groups" as never)
      .select("*")
      .eq("effective_severity", sev)
      .order("last_seen", { ascending: false })
      .limit(300);
    setGroups(((data || []) as unknown) as FlagGroup[]);
    setLoading(false);
  }, []);

  const loadCounts = useCallback(async () => {
    const next: Record<string, number> = {};
    for (const sev of SEV_ORDER) {
      const { count } = await supabase
        .from("v_watchtower_flag_groups" as never)
        .select("*", { count: "exact", head: true })
        .eq("effective_severity", sev);
      next[sev] = count || 0;
    }
    setCounts(next);
  }, []);

  useEffect(() => { load(severity); }, [load, severity]);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        (g.registration || "").toLowerCase().includes(q) ||
        g.flag_type.toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q),
    );
  }, [groups, search]);

  const totalOccurrences = groups.reduce((s, g) => s + (g.occurrence_count || 1), 0);

  return (
    <CyberPanel
      title="Findings Triage"
      icon={<AlertTriangle className="w-4 h-4" />}
      variant={severity === "critical" ? "threat" : "default"}
      headerActions={
        <Button size="sm" variant="ghost" onClick={() => { load(severity); loadCounts(); }} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <div className="p-3 sm:p-4 space-y-3">
        <p className="font-mono text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          Repeat detections are grouped into one finding — the counter shows how many times it recurred.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {SEV_ORDER.map((sev) => (
            <button
              key={sev}
              onClick={() => setSeverity(sev)}
              className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-opacity ${
                SEV_STYLES[sev]
              } ${severity === sev ? "opacity-100 ring-1 ring-current" : "opacity-60 hover:opacity-90"}`}
            >
              {sev} · {counts[sev] ?? "…"}
            </button>
          ))}
        </div>

        <Input
          placeholder="Filter by tail number, finding type, or text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="font-mono text-xs"
        />

        <div className="font-mono text-[10px] text-muted-foreground">
          Showing {filtered.length} finding{filtered.length === 1 ? "" : "s"} · {totalOccurrences.toLocaleString()} underlying detections
        </div>

        <ScrollArea className="h-[420px] pr-2">
          <div className="space-y-2">
            {filtered.map((g) => (
              <div key={g.id} className="rounded border border-border bg-card/40 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-xs uppercase tracking-wider text-foreground">
                        {g.flag_type.replace(/_/g, " ")}
                      </span>
                      {g.registration && (
                        <Badge variant="outline" className="font-mono text-[10px]">{g.registration}</Badge>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground mt-1 break-words">
                      {g.description}
                    </p>
                    <p className="font-mono text-[10px] text-muted-foreground/70 mt-1">
                      first {fmt(g.first_seen)} · last {fmt(g.last_seen)}
                      {g.confidence_score != null && ` · confidence ${Math.round(Number(g.confidence_score))}`}
                    </p>
                  </div>
                  <Badge className={`shrink-0 font-mono text-[10px] border ${SEV_STYLES[g.effective_severity]}`} variant="outline">
                    ×{(g.occurrence_count || 1).toLocaleString()}
                  </Badge>
                </div>
              </div>
            ))}
            {!loading && filtered.length === 0 && (
              <p className="font-mono text-xs text-muted-foreground py-6 text-center">
                No findings at this priority.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </CyberPanel>
  );
}

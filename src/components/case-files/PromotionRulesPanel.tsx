import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Filter, Zap, CheckCircle2, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface PromotionRule {
  rule_id: string;
  rule_name: string;
  rule_category: string;
  sql_condition: string;
  priority: number;
  description: string | null;
  is_active: boolean;
}

interface PromotionResult {
  rule_name: string;
  rule_id: string;
  category: string;
  table: string;
  records_evaluated: number;
  records_matched: number;
  sample_records: unknown[];
  audit_id?: string;
}

interface PromotionSummary {
  rules_executed: number;
  tables_scanned: number;
  total_evaluated: number;
  total_promoted: number;
  promotion_rate: string;
}

const categoryColors: Record<string, string> = {
  altitude_trigger: "bg-destructive/10 text-destructive border-destructive/30",
  flag_indicator: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  severity_level: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
  temporal_proximity: "bg-primary/10 text-primary border-primary/30",
};

export function PromotionRulesPanel() {
  const [rules, setRules] = useState<PromotionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRules, setSelectedRules] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<PromotionResult[] | null>(null);
  const [summary, setSummary] = useState<PromotionSummary | null>(null);

  useEffect(() => {
    supabase.from("promotion_rules").select("*").order("priority").then(({ data }) => {
      if (data) {
        const typed = data as unknown as PromotionRule[];
        setRules(typed);
        setSelectedRules(new Set(typed.filter(r => r.is_active).map(r => r.rule_id)));
      }
      setLoading(false);
    });
  }, []);

  const toggleRule = (id: string) => {
    setSelectedRules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const runPromotion = useCallback(async () => {
    if (selectedRules.size === 0) {
      toast.error("Select at least one promotion rule");
      return;
    }
    setIsRunning(true);
    setResults(null);
    setSummary(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/promotion-engine`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            ruleIds: Array.from(selectedRules),
            dryRun,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || "Promotion engine failed");
        return;
      }

      setResults(data.results);
      setSummary(data.summary);
      toast.success(
        dryRun
          ? `Dry run complete: ${data.summary.total_promoted.toLocaleString()} records would be promoted`
          : `Promotion complete: ${data.summary.total_promoted.toLocaleString()} records promoted with audit trail`
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsRunning(false);
    }
  }, [selectedRules, dryRun]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            <Filter className="w-4 h-4" /> Promotion Rules ({rules.length})
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Eye className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground">DRY RUN</span>
              <Switch checked={dryRun} onCheckedChange={setDryRun} />
            </div>
            <Button
              onClick={runPromotion}
              disabled={isRunning || selectedRules.size === 0}
              size="sm"
              className="gap-2"
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {isRunning
                ? "Scanning 20M+ records..."
                : dryRun
                ? `Preview (${selectedRules.size} rules)`
                : `Execute (${selectedRules.size} rules)`}
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[300px]">
          <div className="space-y-2 pr-4">
            {rules.map(r => {
              const selected = selectedRules.has(r.rule_id);
              return (
                <div
                  key={r.rule_id}
                  className={`border rounded p-3 flex items-start gap-4 cursor-pointer transition-colors ${
                    selected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border opacity-60"
                  }`}
                  onClick={() => toggleRule(r.rule_id)}
                >
                  <div className="flex-shrink-0 w-8 text-center">
                    <span className="font-mono text-lg font-bold text-primary">
                      {r.priority}
                    </span>
                    <p className="text-[8px] text-muted-foreground">PRI</p>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{r.rule_name}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] ${
                          categoryColors[r.rule_category] || ""
                        }`}
                      >
                        {r.rule_category.replace("_", " ")}
                      </Badge>
                      {selected && (
                        <CheckCircle2 className="h-3 w-3 text-primary ml-auto" />
                      )}
                    </div>
                    <code className="block text-[11px] font-mono text-muted-foreground bg-muted/30 rounded px-2 py-1">
                      {r.sql_condition}
                    </code>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Results */}
      {summary && results && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-primary uppercase tracking-wider flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Promotion Results
              {dryRun && (
                <Badge variant="outline" className="text-[9px] ml-2">
                  DRY RUN
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="bg-muted/30 rounded p-3 text-center">
                <p className="text-xl font-mono font-bold text-primary">
                  {summary.rules_executed}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  RULES EXECUTED
                </p>
              </div>
              <div className="bg-muted/30 rounded p-3 text-center">
                <p className="text-xl font-mono font-bold text-primary">
                  {summary.tables_scanned}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  TABLES SCANNED
                </p>
              </div>
              <div className="bg-muted/30 rounded p-3 text-center">
                <p className="text-xl font-mono font-bold text-primary">
                  {summary.total_evaluated.toLocaleString()}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  RECORDS EVALUATED
                </p>
              </div>
              <div className="bg-muted/30 rounded p-3 text-center">
                <p className="text-xl font-mono font-bold text-destructive">
                  {summary.total_promoted.toLocaleString()}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  RECORDS PROMOTED
                </p>
              </div>
              <div className="bg-muted/30 rounded p-3 text-center">
                <p className="text-xl font-mono font-bold text-yellow-400">
                  {summary.promotion_rate}
                </p>
                <p className="text-[9px] font-mono text-muted-foreground">
                  PROMOTION RATE
                </p>
              </div>
            </div>

            {/* Per-rule results */}
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="border border-border rounded p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {r.records_matched > 0 ? (
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                        )}
                        <span className="text-sm font-semibold">
                          {r.rule_name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[9px] ${
                            categoryColors[r.category] || ""
                          }`}
                        >
                          {r.category.replace("_", " ")}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.table}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs font-mono text-muted-foreground">
                      <span>
                        Evaluated:{" "}
                        <span className="text-foreground">
                          {r.records_evaluated.toLocaleString()}
                        </span>
                      </span>
                      <span>
                        Matched:{" "}
                        <span
                          className={
                            r.records_matched > 0
                              ? "text-destructive font-bold"
                              : "text-foreground"
                          }
                        >
                          {r.records_matched.toLocaleString()}
                        </span>
                      </span>
                      {r.audit_id && (
                        <span className="text-primary">
                          Audit: {r.audit_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>
                    {r.sample_records.length > 0 && (
                      <details className="text-[10px]">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                          Sample records ({r.sample_records.length})
                        </summary>
                        <pre className="mt-1 bg-muted/30 rounded p-2 overflow-x-auto text-[9px] max-h-32">
                          {JSON.stringify(r.sample_records, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

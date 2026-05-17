import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, Database, ShieldAlert, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AuditResp {
  mode: string;
  timestamp: string;
  audit_before: any;
  fixes: any;
  audit_after: any;
}

export const SchemaIntegrityPanel: React.FC = () => {
  const [loading, setLoading] = useState<"audit" | "fix" | null>(null);
  const [data, setData] = useState<AuditResp | null>(null);

  const run = async (mode: "audit" | "fix") => {
    setLoading(mode);
    try {
      const { data: resp, error } = await supabase.functions.invoke("schema-integrity-fix", {
        body: { mode },
      });
      if (error) throw error;
      setData(resp);
      toast.success(mode === "fix" ? "Schema repaired" : "Audit complete");
    } catch (e: any) {
      toast.error(e.message || "Failed");
    } finally {
      setLoading(null);
    }
  };

  const before = data?.audit_before;
  const after = data?.audit_after ?? before;
  const issues = before?.issues ?? [];

  return (
    <CyberPanel title="Neon Schema Integrity" icon={<Database className="h-5 w-5" />} variant={issues.length ? "threat" : "default"}>
      <div className="space-y-4">
        <div className="text-xs text-muted-foreground leading-relaxed">
          Audits column-name drift (<code>tail_number</code> vs <code>registration</code>, <code>icao_hex</code> vs <code>icao24</code>),
          NULL ICAO codes on KCSO fleet, missing <code>government_link</code> flags, and quarantines corrupt ICAO values.
          All bad rows are copied to <code>icao_quarantine</code> before being nulled — forensic reproducibility is preserved.
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => run("audit")} disabled={loading !== null}>
            <ShieldAlert className="h-4 w-4 mr-1" />
            {loading === "audit" ? "Auditing…" : "Audit Only"}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => run("fix")} disabled={loading !== null}>
            <Wrench className="h-4 w-4 mr-1" />
            {loading === "fix" ? "Repairing…" : "Audit + Repair"}
          </Button>
        </div>

        {data && (
          <ScrollArea className="h-[520px] pr-3">
            {/* Issues */}
            {issues.length > 0 ? (
              <div className="bg-destructive/10 border border-destructive/40 rounded p-3 mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-semibold text-destructive">{issues.length} integrity issues</span>
                </div>
                <ul className="text-xs space-y-1">
                  {issues.map((i: string, idx: number) => (
                    <li key={idx} className="font-mono text-destructive/90">• {i}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="bg-success/10 border border-success/30 rounded p-3 mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="text-sm">No integrity issues detected</span>
              </div>
            )}

            {/* Table schema audit */}
            <div className="space-y-2 mb-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Table Schema</div>
              {Object.entries(before?.tables ?? {}).map(([t, info]: any) => (
                <div key={t} className="border border-border/40 rounded p-2 bg-muted/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm">{t}</span>
                    {info.exists ? (
                      <span className="text-xs text-muted-foreground">~{info.row_estimate?.toLocaleString()} rows</span>
                    ) : (
                      <Badge variant="outline" className="text-xs">missing</Badge>
                    )}
                  </div>
                  {info.exists && (
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      {info.has_registration && <Badge variant="secondary">registration</Badge>}
                      {info.has_tail_number && <Badge variant="outline">tail_number</Badge>}
                      {info.has_icao24 && <Badge variant="secondary">icao24</Badge>}
                      {info.has_icao_hex && <Badge variant="outline">icao_hex</Badge>}
                      {info.has_icao_code && <Badge variant="secondary">icao_code</Badge>}
                      {info.has_government_link && <Badge variant="secondary">government_link</Badge>}
                    </div>
                  )}
                  {info.icao_quality && (
                    <div className="mt-2 text-[11px] text-muted-foreground font-mono">
                      non_hex/bad_len: {info.icao_quality.non_hex_or_bad_len} ·
                      tail_in_icao: {info.icao_quality.tail_in_icao_field} ·
                      short: {info.icao_quality.short_icao} ·
                      002025: {info.icao_quality.suspect_002025}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* KCSO fleet state */}
            {before?.kcso?.length > 0 && (
              <div className="space-y-2 mb-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">KCSO Fleet (aircraft table)</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Tail</th><th>ICAO</th><th>Gov flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(after?.kcso ?? before.kcso).map((r: any) => (
                      <tr key={r.reg} className="border-t border-border/30">
                        <td className="py-1 font-mono">{r.reg}</td>
                        <td className={r.icao ? "font-mono" : "text-destructive font-mono"}>
                          {r.icao || "NULL"}
                        </td>
                        <td>
                          {r.government_link === true ? (
                            <Badge variant="secondary">TRUE</Badge>
                          ) : (
                            <Badge variant="destructive">FALSE</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fix results */}
            {data.fixes && (
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Repairs Applied</div>
                <pre className="text-[11px] bg-muted/30 rounded p-2 overflow-x-auto">
                  {JSON.stringify(data.fixes, null, 2)}
                </pre>
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </CyberPanel>
  );
};

export default SchemaIntegrityPanel;

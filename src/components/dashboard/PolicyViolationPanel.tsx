import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Gavel, ShieldAlert, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Violation {
  id: string;
  icao: string;
  callsign: string | null;
  detected_at: string;
  rule_code: string;
  rule_title: string;
  manual_section: string | null;
  severity: string;
  evidence: any;
  sha256: string | null;
}

const sevColor = (s: string) =>
  s === "critical" ? "bg-destructive text-destructive-foreground"
  : s === "high" ? "bg-orange-500/80 text-white"
  : s === "medium" ? "bg-yellow-500/70 text-black"
  : "bg-muted text-muted-foreground";

export function PolicyViolationPanel() {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(14);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [scanReport, setScanReport] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("policy_violations")
      .select("*")
      .order("detected_at", { ascending: false })
      .limit(200);
    if (error) toast.error(`Load failed: ${error.message}`);
    else setViolations((data as Violation[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const runScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("policy-violation-scan", {
        body: { lookbackDays: days },
      });
      if (error) throw error;
      setScanReport(data);
      toast.success(`Scan complete — ${data?.totalInserted ?? 0} new violations recorded`);
      await load();
    } catch (e: any) {
      toast.error(`Scan failed: ${e?.message || e}`);
    } finally { setScanning(false); }
  };

  const exportCsv = () => {
    if (violations.length === 0) return;
    const headers = ["detected_at", "icao", "callsign", "rule_code", "rule_title", "manual_section", "severity", "sha256"];
    const rows = violations.map(v => headers.map(h => JSON.stringify((v as any)[h] ?? "")).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0,10).replace(/-/g,"");
    a.href = url; a.download = `${stamp}_KCSO_POLICY_VIOLATIONS.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-orange-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-orange-500">
          <Gavel className="w-5 h-5" />
          KCSO Air Support Policy Violation Engine
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Auto-flags every KCSO flight that violates the Air Support Unit Operations Manual
          (B-401 night/mountain, C-100 hover, A-401 surveillance, B-1102 transport, foreign-prefix ghosts).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="pv-days" className="text-xs">Lookback (days)</Label>
            <Input
              id="pv-days" type="number" min={1} max={90}
              value={days} onChange={(e) => setDays(Number(e.target.value) || 14)}
              className="w-28"
            />
          </div>
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
            Run Policy Scan
          </Button>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={violations.length === 0}>
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </Button>
        </div>

        {scanReport && (
          <div className="rounded border border-orange-500/30 bg-orange-500/5 p-3 text-xs font-mono space-y-1">
            <div>Scanned {scanReport.lookbackDays}d · inserted <b>{scanReport.totalInserted}</b> new violations</div>
            <div className="flex flex-wrap gap-2 mt-1">
              {scanReport.rules?.map((r: any) => (
                <Badge key={r.rule_code} variant="outline">
                  {r.rule_code}: {r.matches ?? r.error}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="h-[420px] rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card border-b">
              <tr>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">ICAO</th>
                <th className="text-left p-2">Callsign</th>
                <th className="text-left p-2">Rule</th>
                <th className="text-left p-2">Section</th>
                <th className="text-left p-2">Severity</th>
              </tr>
            </thead>
            <tbody>
              {violations.map(v => (
                <tr key={v.id} className="border-b hover:bg-muted/30">
                  <td className="p-2 whitespace-nowrap">{new Date(v.detected_at).toLocaleString()}</td>
                  <td className="p-2">{v.icao}</td>
                  <td className="p-2">{v.callsign || "—"}</td>
                  <td className="p-2"><b>{v.rule_code}</b> {v.rule_title}</td>
                  <td className="p-2 text-muted-foreground">{v.manual_section}</td>
                  <td className="p-2"><Badge className={sevColor(v.severity)}>{v.severity}</Badge></td>
                </tr>
              ))}
              {violations.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                  No violations recorded yet. Click "Run Policy Scan" to evaluate the last {days} days.
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

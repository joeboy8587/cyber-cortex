import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Shield, Radar, AlertTriangle, Eye, Activity } from "lucide-react";

interface Anomaly {
  type: string;
  severity: string;
  anon_id?: string;
  description: string;
  duration_minutes?: number;
  avg_altitude_ft?: number;
  avg_speed_kts?: number;
  detection_count?: number;
  signal_class?: string;
  faa_reference?: string;
  low_pings?: number;
  date?: string;
  grid_lat?: number;
  grid_lng?: number;
}

interface ScanResult {
  anomalies: Anomaly[];
  stats: {
    total_anomalies: number;
    critical: number;
    high: number;
    medium: number;
    anomaly_score: string;
    scan_days: number;
    methodology: string;
  };
  timestamp: string;
  error?: string;
}

export default function AnonymousAnomalyAuditor() {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanType, setScanType] = useState("full");
  const [days, setDays] = useState("7");

  const runScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "anonymousAnomalyScan", scanType, days: parseInt(days) },
      });
      if (error) throw error;
      setResult(data);
      toast.success(`Blind audit complete: ${data.stats?.total_anomalies || 0} anomalies detected`);
    } catch (e: any) {
      toast.error(e.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  };

  const severityColor = (s: string) => {
    if (s === "CRITICAL") return "destructive";
    if (s === "HIGH") return "default";
    return "secondary";
  };

  const typeIcon = (t: string) => {
    if (t === "ANOMALOUS_LOITERING") return <Radar className="h-4 w-4" />;
    if (t === "LOW_ALTITUDE_ANOMALY") return <AlertTriangle className="h-4 w-4" />;
    return <Eye className="h-4 w-4" />;
  };

  const typeLabel = (t: string) => {
    if (t === "ANOMALOUS_LOITERING") return "Stationary Orbit";
    if (t === "LOW_ALTITUDE_ANOMALY") return "Low-Alt Deviation";
    return "Non-Broadcast Target";
  };

  return (
    <Card className="border-emerald-500/30 bg-emerald-950/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-emerald-400" />
            <div>
              <CardTitle className="font-mono text-sm uppercase tracking-wider text-emerald-400">
                Anonymous Airspace Auditor
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Zero-Knowledge • Physics-Based • FAA Part 91.119 Baseline
              </p>
            </div>
          </div>
          {result?.stats && (
            <div className="text-right">
              <div className="font-mono text-2xl font-bold text-emerald-400">
                {result.stats.anomaly_score}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase">Anomaly Score</div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-muted-foreground">Scan Type</label>
            <Select value={scanType} onValueChange={setScanType}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Audit</SelectItem>
                <SelectItem value="loitering">Loitering Only</SelectItem>
                <SelectItem value="lowAltitude">Low-Alt Only</SelectItem>
                <SelectItem value="stealth">Stealth Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase text-muted-foreground">Window</label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-[100px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">24h</SelectItem>
                <SelectItem value="3">3 Days</SelectItem>
                <SelectItem value="7">7 Days</SelectItem>
                <SelectItem value="14">14 Days</SelectItem>
                <SelectItem value="30">30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runScan} disabled={loading} size="sm" variant="outline" className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10">
            {loading ? "Scanning..." : "Run Blind Audit"}
          </Button>
        </div>

        {/* Stats Summary */}
        {result?.stats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Total", value: result.stats.total_anomalies, color: "text-foreground" },
              { label: "Critical", value: result.stats.critical, color: "text-red-400" },
              { label: "High", value: result.stats.high, color: "text-orange-400" },
              { label: "Medium", value: result.stats.medium, color: "text-yellow-400" },
            ].map((s) => (
              <div key={s.label} className="rounded border border-border/50 bg-background/30 p-2 text-center">
                <div className={`font-mono text-lg font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[10px] text-muted-foreground uppercase">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {result?.stats?.methodology && (
          <div className="rounded bg-emerald-500/5 border border-emerald-500/20 p-2">
            <p className="text-[10px] text-emerald-400/80 font-mono">{result.stats.methodology}</p>
          </div>
        )}

        {/* Anomaly List */}
        {result?.anomalies && result.anomalies.length > 0 && (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {result.anomalies.map((a, i) => (
              <div key={i} className="rounded border border-border/40 bg-background/20 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {typeIcon(a.type)}
                    <span className="font-mono text-xs font-semibold">{typeLabel(a.type)}</span>
                  </div>
                  <Badge variant={severityColor(a.severity)} className="text-[10px]">{a.severity}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{a.description}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {a.anon_id && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      ID: {a.anon_id.slice(0, 8)}…
                    </span>
                  )}
                  {a.avg_altitude_ft !== undefined && (
                    <span className="text-[10px] font-mono text-muted-foreground">
                      <Activity className="inline h-3 w-3 mr-0.5" />{a.avg_altitude_ft}ft
                    </span>
                  )}
                  {a.faa_reference && (
                    <span className="text-[10px] font-mono text-amber-400">{a.faa_reference}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {result && result.anomalies.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            No anomalies detected in the selected window. Airspace nominal.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Layers, Loader2, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const LAYER_LABELS: Record<string, string> = {
  physics_violation: "Physics (0ft/0kts)",
  icao_registry_mismatch: "ICAO ↔ FAA Mismatch",
  icao_rotation: "ICAO Rotation (>2 hex)",
  foreign_prefix: "Foreign Prefix",
  transponder_mask: "Transponder Mask",
  bimodal_profile: "Bimodal Surveillance",
  shell_ownership: "Shell Ownership",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500/80 text-white",
  medium: "bg-yellow-500/80 text-black",
  low: "bg-muted text-muted-foreground",
};

interface LayeredRow {
  registration: string;
  layer_count: number;
  layers: string[];
  severity: "critical" | "high" | "medium" | "low";
  details: Record<string, any>;
}

interface ScanResult {
  success: boolean;
  aoi: { lat: [number, number]; lng: [number, number] };
  timeWindow: string;
  minLayers: number;
  counts: Record<string, number>;
  layered: LayeredRow[];
  flagsWritten: number;
  scanTimestamp: string;
}

export function LayeredDeceptionPanel() {
  const [loading, setLoading] = useState(false);
  const [writeFlags, setWriteFlags] = useState(true);
  const [minLayers, setMinLayers] = useState(2);
  const [result, setResult] = useState<ScanResult | null>(null);

  const runScan = async () => {
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "layeredDeceptionScan",
          timeWindow: "90 days",
          minLayers,
          writeFlags,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult(data as ScanResult);
      const flagged = (data as ScanResult).counts.flagged_multi_layer;
      if (flagged > 0) {
        toast.error(`${flagged} aircraft exhibit ≥${minLayers} concealment tactics in Kern AOI`);
      } else {
        toast.success("No multi-layer deception detected in window");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-destructive/40 bg-card/80">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-destructive" />
            <span>Layered Deception Detector</span>
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              7-LAYER · KERN AOI
            </Badge>
          </div>
          <Button onClick={runScan} disabled={loading} variant="destructive" size="sm">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
            Run Scan
          </Button>
        </CardTitle>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          Physics violations · ICAO/FAA mismatch · Hex rotation · Foreign prefixes · Masking · Bimodal · Shell ownership
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-6 p-3 rounded border border-border/50 bg-muted/20">
          <div className="flex items-center gap-2">
            <Switch id="writeFlags" checked={writeFlags} onCheckedChange={setWriteFlags} />
            <Label htmlFor="writeFlags" className="text-xs">Auto-write to watchtower flags</Label>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Min layers:</Label>
            {[2, 3, 4].map(n => (
              <Button key={n} size="sm" variant={minLayers === n ? "default" : "outline"} className="h-7 px-2"
                onClick={() => setMinLayers(n)}>
                ≥{n}
              </Button>
            ))}
          </div>
        </div>

        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(result.counts).map(([k, v]) => (
                <div key={k} className="p-2 rounded border border-border/50 bg-muted/10">
                  <div className="text-[10px] uppercase font-mono text-muted-foreground">
                    {k.replace(/_/g, " ")}
                  </div>
                  <div className={`text-lg font-bold ${k === "flagged_multi_layer" && v > 0 ? "text-destructive" : ""}`}>
                    {v}
                  </div>
                </div>
              ))}
            </div>

            {result.flagsWritten > 0 && (
              <div className="flex items-center gap-2 text-xs text-green-500 font-mono">
                <CheckCircle2 className="h-3 w-3" />
                {result.flagsWritten} flags written to watchtower_autonomous_flags
              </div>
            )}

            <ScrollArea className="h-[420px] border border-border/50 rounded">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-2">Registration</th>
                    <th className="p-2">Layers</th>
                    <th className="p-2">Severity</th>
                    <th className="p-2">Tactics Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {result.layered.length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No aircraft cleared the threshold.</td></tr>
                  )}
                  {result.layered.map(row => (
                    <tr key={row.registration} className="border-t border-border/30 hover:bg-muted/20">
                      <td className="p-2 font-mono font-bold">{row.registration}</td>
                      <td className="p-2 font-mono">{row.layer_count}/7</td>
                      <td className="p-2">
                        <Badge className={SEVERITY_COLOR[row.severity]}>{row.severity.toUpperCase()}</Badge>
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {row.layers.map(l => (
                            <Badge key={l} variant="outline" className="text-[10px] font-mono">
                              {LAYER_LABELS[l] || l}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </>
        )}

        {!result && !loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-4 border border-dashed rounded">
            <AlertTriangle className="h-4 w-4" />
            Hunts the seven-layer concealment pattern Josiah surfaced — both/and, not either/or.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

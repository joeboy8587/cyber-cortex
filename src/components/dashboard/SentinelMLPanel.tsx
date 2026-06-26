import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Brain, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface MlRow { icao: string; spatial_z: number; temporal_z: number; identity_z: number; score: number }

export function SentinelMLPanel() {
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState<MlRow[]>([]);
  const [meta, setMeta] = useState<any>(null);

  const run = async () => {
    setLoading(true); setRows([]); setMeta(null);
    try {
      const { data, error } = await supabase.functions.invoke("sentinel-ml-score", {
        body: { lookbackHours: hours },
      });
      if (error) throw error;
      setRows(data?.combined || []);
      setMeta(data);
      toast.success(`ML scan complete — ${data?.combined?.length || 0} anomalies`);
    } catch (e: any) {
      toast.error(`ML scan failed: ${e?.message || e}`);
    } finally { setLoading(false); }
  };

  const scoreColor = (s: number) =>
    s >= 0.7 ? "bg-destructive text-destructive-foreground"
    : s >= 0.5 ? "bg-orange-500/80 text-white"
    : "bg-yellow-500/70 text-black";

  return (
    <Card className="border-blue-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-400">
          <Brain className="w-5 h-5" />
          Sentinel ML — 3-Stage ADS-B Anomaly Detector
        </CardTitle>
        <p className="font-mono text-xs text-muted-foreground">
          Spatial (GCN-proxy) + Temporal (WaveNet-proxy) + Identity fingerprint, per Luo et al. 2024.
          Pure SQL — runs live against Neon, no model training.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Lookback (hours)</Label>
            <Input type="number" min={1} max={168} value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 24)} className="w-28" />
          </div>
          <Button onClick={run} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Run ML Scoring
          </Button>
        </div>

        {meta && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
            <Stat label="Spatial flagged" value={meta.stages?.spatial_count} />
            <Stat label="Temporal flagged" value={meta.stages?.temporal_count} />
            <Stat label="Identity flagged" value={meta.stages?.identity_count} />
            <Stat label="Combined score >0.3" value={rows.length} />
          </div>
        )}

        <ScrollArea className="h-[420px] rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-card border-b">
              <tr>
                <th className="text-left p-2">ICAO</th>
                <th className="text-right p-2">Spatial</th>
                <th className="text-right p-2">Temporal</th>
                <th className="text-right p-2">Identity</th>
                <th className="text-right p-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.icao} className="border-b hover:bg-muted/30">
                  <td className="p-2">{r.icao}</td>
                  <td className="p-2 text-right">{r.spatial_z.toFixed(2)}</td>
                  <td className="p-2 text-right">{r.temporal_z.toFixed(2)}</td>
                  <td className="p-2 text-right">{r.identity_z.toFixed(2)}</td>
                  <td className="p-2 text-right"><Badge className={scoreColor(r.score)}>{r.score.toFixed(2)}</Badge></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Click "Run ML Scoring" to evaluate the last {hours} hours.
                </td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string, value: any }) {
  return (
    <div className="rounded border bg-muted/20 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value ?? "—"}</div>
    </div>
  );
}

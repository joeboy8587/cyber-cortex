import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPin, RefreshCw, Crosshair, Network } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Detection {
  registration: string | null;
  callsign: string | null;
  icao: string | null;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  speed_kt: number;
  timestamp: string;
  nearest_airport: string;
  nearest_airport_km: string;
  aoi_distance_km: string;
  zone_classification: string;
  taxonomy_tag: string | null;
}

interface CohortRow {
  registration: string;
  coincident_pings: number;
  days_coincident: number;
  avg_alt_ft: number;
  min_alt_ft: number;
  avg_distance_km: number;
  min_distance_km: number;
  coordination_score: number;
}

const ZONE_COLORS: Record<string, string> = {
  OIL_FIELD_ZONE: 'bg-chart-2/20 text-chart-2 border-chart-2/40',
  DESERT_TEST_CORRIDOR: 'bg-destructive/20 text-destructive border-destructive/40',
  AGRICULTURAL_BELT: 'bg-chart-1/20 text-chart-1 border-chart-1/40',
  NORTH_VALLEY_RURAL: 'bg-chart-3/20 text-chart-3 border-chart-3/40',
  UNCLASSIFIED_RURAL: 'bg-muted text-muted-foreground',
};

export function OpenFieldStagingPanel() {
  const [loading, setLoading] = useState(false);
  const [coordLoading, setCoordLoading] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [days, setDays] = useState(7);
  const [exclusionKm, setExclusionKm] = useState(5);
  const [cohort, setCohort] = useState<CohortRow[]>([]);
  const [coordSummary, setCoordSummary] = useState<any>(null);
  const [anchor, setAnchor] = useState('N912KC');

  const scan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'openFieldStaging', days, exclusionKm },
      });
      if (error) throw error;
      setDetections(data?.detections || []);
      setSummary(data?.summary || null);
      toast.success(`${data?.detections?.length || 0} rural staging pings located`);
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const runCoordination = async () => {
    setCoordLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'kcsoCoordinationCheck', anchor, days: 30, windowMin: 15, altCeilingFt: 3000 },
      });
      if (error) throw error;
      setCohort(data?.cohort || []);
      setCoordSummary(data?.summary || null);
      toast.success(`${data?.cohort?.length || 0} aircraft coincident with ${anchor}`);
    } catch (e: any) {
      toast.error(`Coordination check failed: ${e.message}`);
    } finally {
      setCoordLoading(false);
    }
  };

  return (
    <CyberPanel title="Open Field Seven & KCSO Coordination Matrix">
      <p className="-mt-2 mb-3 font-mono text-[10px] uppercase text-muted-foreground">
        Geolocates altitude=0 / sub-50kt detections OUTSIDE airport exclusion zones — and maps coincident low-altitude assets to KCSO anchor (N912KC)
      </p>
      <Tabs defaultValue="staging" className="space-y-4">
        <TabsList>
          <TabsTrigger value="staging" className="gap-2"><MapPin className="h-3 w-3" />Open Field Staging</TabsTrigger>
          <TabsTrigger value="coordination" className="gap-2"><Network className="h-3 w-3" />KCSO Coordination</TabsTrigger>
        </TabsList>

        <TabsContent value="staging" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded border border-border/40 bg-background/40 p-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Window (days)</label>
              <select value={days} onChange={e => setDays(Number(e.target.value))} className="h-9 rounded border border-border bg-background px-2 font-mono text-xs">
                <option value={3}>3</option>
                <option value={7}>7</option>
                <option value={14}>14</option>
                <option value={30}>30</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Airport Exclusion (km)</label>
              <select value={exclusionKm} onChange={e => setExclusionKm(Number(e.target.value))} className="h-9 rounded border border-border bg-background px-2 font-mono text-xs">
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={10}>10</option>
              </select>
            </div>
            <Button onClick={scan} disabled={loading} size="sm" className="gap-2">
              {loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
              {loading ? "Hunting..." : "Locate Rural Staging"}
            </Button>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Pings</div>
                <div className="font-display text-2xl text-primary">{summary.total_detections}</div>
              </div>
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
                <div className="font-mono text-[10px] uppercase text-destructive">Unique Aircraft</div>
                <div className="font-display text-2xl text-destructive">{summary.unique_aircraft}</div>
              </div>
              <div className="rounded border border-chart-2/40 bg-chart-2/5 p-3">
                <div className="font-mono text-[10px] uppercase text-chart-2">Closest to AOI</div>
                <div className="font-display text-2xl text-chart-2">{summary.closest_to_aoi_km ?? '—'} km</div>
              </div>
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Zones</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(summary.zone_breakdown || {}).map(([z, c]: any) => (
                    <Badge key={z} variant="outline" className={`${ZONE_COLORS[z] || ''} text-[9px]`}>{z}: {c}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {detections.length === 0 ? (
            <div className="rounded border border-dashed border-border/50 p-6 text-center font-mono text-xs text-muted-foreground">
              No data yet — run scan to expose rural ground staging.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-border/40">
              <table className="w-full font-mono text-xs">
                <thead className="bg-muted/30 text-left uppercase text-[10px] text-muted-foreground">
                  <tr>
                    <th className="p-2">Reg / Callsign</th>
                    <th className="p-2">Coordinates</th>
                    <th className="p-2">Zone</th>
                    <th className="p-2">Nearest Airport</th>
                    <th className="p-2">AOI Dist</th>
                    <th className="p-2">Speed</th>
                    <th className="p-2">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {detections.map((d, i) => (
                    <tr key={i} className="border-t border-border/30 hover:bg-muted/20">
                      <td className="p-2">
                        <div className="font-bold text-primary">{d.registration || '—'}</div>
                        <div className="text-[10px] text-muted-foreground">{d.callsign || ''}</div>
                      </td>
                      <td className="p-2 text-[10px] text-muted-foreground">
                        <a href={`https://www.google.com/maps/@${d.latitude},${d.longitude},16z`} target="_blank" rel="noopener noreferrer" className="text-chart-1 underline">
                          {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)}
                        </a>
                      </td>
                      <td className="p-2"><Badge variant="outline" className={`${ZONE_COLORS[d.zone_classification] || ''} text-[9px]`}>{d.zone_classification}</Badge></td>
                      <td className="p-2 text-muted-foreground">{d.nearest_airport} <span className="text-[9px]">({d.nearest_airport_km}km)</span></td>
                      <td className="p-2">{d.aoi_distance_km} km</td>
                      <td className="p-2">{d.speed_kt} kt</td>
                      <td className="p-2 text-[10px] text-muted-foreground">{new Date(d.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="coordination" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded border border-border/40 bg-background/40 p-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-muted-foreground">Anchor Registration</label>
              <input value={anchor} onChange={e => setAnchor(e.target.value.toUpperCase())} className="h-9 w-32 rounded border border-border bg-background px-2 font-mono text-xs" />
            </div>
            <Button onClick={runCoordination} disabled={coordLoading} size="sm" className="gap-2">
              {coordLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
              Map Coordination Network
            </Button>
          </div>

          {coordSummary && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Coincident Aircraft</div>
                <div className="font-display text-2xl text-primary">{coordSummary.coincident_aircraft}</div>
              </div>
              <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
                <div className="font-mono text-[10px] uppercase text-destructive">High Coordination</div>
                <div className="font-display text-2xl text-destructive">{coordSummary.high_coordination}</div>
              </div>
              <div className="rounded border border-border/40 bg-background/40 p-3">
                <div className="font-mono text-[10px] uppercase text-muted-foreground">Window</div>
                <div className="font-display text-2xl text-foreground">±{coordSummary.window_minutes}min</div>
              </div>
            </div>
          )}

          {cohort.length === 0 ? (
            <div className="rounded border border-dashed border-border/50 p-6 text-center font-mono text-xs text-muted-foreground">
              Run the coordination check to map the {anchor} cohort.
            </div>
          ) : (
            <div className="overflow-x-auto rounded border border-border/40">
              <table className="w-full font-mono text-xs">
                <thead className="bg-muted/30 text-left uppercase text-[10px] text-muted-foreground">
                  <tr>
                    <th className="p-2">Reg</th>
                    <th className="p-2">Coincident Pings</th>
                    <th className="p-2">Days</th>
                    <th className="p-2">Avg / Min Alt</th>
                    <th className="p-2">Avg / Min Dist</th>
                    <th className="p-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {cohort.map((c) => (
                    <tr key={c.registration} className={`border-t border-border/30 hover:bg-muted/20 ${c.coordination_score >= 30 ? 'bg-destructive/5' : ''}`}>
                      <td className="p-2 font-bold text-primary">{c.registration}</td>
                      <td className="p-2">{c.coincident_pings}</td>
                      <td className="p-2">{c.days_coincident}</td>
                      <td className="p-2 text-muted-foreground">{c.avg_alt_ft} / {c.min_alt_ft} ft</td>
                      <td className="p-2 text-muted-foreground">{c.avg_distance_km} / {c.min_distance_km} km</td>
                      <td className="p-2"><Badge variant={c.coordination_score >= 30 ? 'destructive' : 'secondary'}>{c.coordination_score}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

export default OpenFieldStagingPanel;

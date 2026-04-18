import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plane, MapPin, Home, AlertTriangle, RefreshCw, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Detection {
  registration: string;
  icao_code: string;
  callsign: string;
  latitude: number;
  longitude: number;
  speed: number;
  detection_timestamp: string;
  taxonomy_tag: string;
  nearest_airport: string;
  nearest_airport_name: string;
  nearest_airport_km: number;
  aoi_distance_km: number;
  classification: 'AIRPORT_GROUND' | 'RESIDENTIAL_STAGING' | 'OPEN_FIELD';
  evidence_weight: 'DROP' | 'KEEP_TIER1' | 'INVESTIGATE';
}

interface Result {
  summary: {
    total_zero_foot: number;
    airport_ground: number;
    residential_staging: number;
    open_field: number;
    airports_used: Array<{ icao: string; name: string; lat: number; lon: number }>;
    airport_radius_km: number;
    aoi: { lat: number; lon: number; radius_km: number };
    days_window: number;
  };
  detections: Detection[];
  topStagingSuspects: Array<{ registration: string; count: number; first_seen: string; last_seen: string }>;
}

export function ZeroFootClassifier() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<'staging' | 'airport' | 'open' | 'suspects'>('staging');

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'zeroFootClassification', days: 7, airportRadiusKm: 5, aoi_radius_km: 3, limit: 1000 }
      });
      if (error) throw error;
      setResult(data as Result);
      toast.success(`Classified ${(data as Result).summary.total_zero_foot} zero-foot detections`);
    } catch (e: any) {
      console.error(e);
      toast.error(`Classification failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredDetections = (cls: Detection['classification']) =>
    result?.detections.filter(d => d.classification === cls) ?? [];

  return (
    <CyberPanel
      title="ZERO-FOOT AIRPORT FILTER"
      icon={<Filter className="w-5 h-5 text-primary" />}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted-foreground max-w-2xl">
            Reclassifies altitude=0 / NULL detections by proximity to known airports (5km).
            Filters out ramp/taxi noise so only genuine residential staging counts as Tier 1 evidence.
          </p>
          <Button onClick={run} disabled={loading} size="sm">
            {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Filter className="w-4 h-4 mr-2" />}
            Run Classification
          </Button>
        </div>

        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-card/50 border border-primary/30 rounded-lg p-3 text-center">
                <div className="text-2xl font-mono font-bold text-primary">{result.summary.total_zero_foot}</div>
                <div className="text-xs text-muted-foreground">Total 0ft</div>
              </div>
              <div className="bg-card/50 border border-muted rounded-lg p-3 text-center">
                <div className="text-2xl font-mono font-bold text-muted-foreground">{result.summary.airport_ground}</div>
                <div className="text-xs text-muted-foreground">Airport (drop)</div>
              </div>
              <div className="bg-card/50 border border-destructive/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-mono font-bold text-destructive">{result.summary.residential_staging}</div>
                <div className="text-xs text-muted-foreground">Residential</div>
              </div>
              <div className="bg-card/50 border border-warning/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-mono font-bold text-warning">{result.summary.open_field}</div>
                <div className="text-xs text-muted-foreground">Open Field</div>
              </div>
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="staging" className="gap-1">
                  <Home className="w-3 h-3" /> Residential
                </TabsTrigger>
                <TabsTrigger value="suspects">Top Suspects</TabsTrigger>
                <TabsTrigger value="airport" className="gap-1">
                  <Plane className="w-3 h-3" /> Airport
                </TabsTrigger>
                <TabsTrigger value="open" className="gap-1">
                  <MapPin className="w-3 h-3" /> Open Field
                </TabsTrigger>
              </TabsList>

              <TabsContent value="staging">
                <DetectionTable rows={filteredDetections('RESIDENTIAL_STAGING')} highlight="destructive" />
              </TabsContent>
              <TabsContent value="airport">
                <DetectionTable rows={filteredDetections('AIRPORT_GROUND')} highlight="muted" />
              </TabsContent>
              <TabsContent value="open">
                <DetectionTable rows={filteredDetections('OPEN_FIELD')} highlight="warning" />
              </TabsContent>
              <TabsContent value="suspects">
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left">Registration</th>
                        <th className="px-3 py-2 text-right">0ft Detections</th>
                        <th className="px-3 py-2 text-left">First Seen</th>
                        <th className="px-3 py-2 text-left">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.topStagingSuspects.map((s) => (
                        <tr key={s.registration} className="border-t border-border">
                          <td className="px-3 py-2 font-mono font-bold text-destructive">{s.registration}</td>
                          <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {new Date(s.first_seen).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {new Date(s.last_seen).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {result.topStagingSuspects.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                          No residential staging suspects in window
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            </Tabs>

            <div className="text-xs text-muted-foreground border-t border-border pt-3">
              <div className="flex items-center gap-2 flex-wrap">
                <AlertTriangle className="w-3 h-3" />
                Window: {result.summary.days_window}d • Airport radius: {result.summary.airport_radius_km}km •
                AOI: {result.summary.aoi.lat.toFixed(4)}, {result.summary.aoi.lon.toFixed(4)} (r={result.summary.aoi.radius_km}km)
              </div>
              <div className="mt-1">
                Whitelisted airports: {result.summary.airports_used.map(a => a.icao).join(', ')}
              </div>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

function DetectionTable({ rows, highlight }: { rows: Detection[]; highlight: 'destructive' | 'muted' | 'warning' }) {
  if (rows.length === 0) {
    return <div className="text-center py-6 text-muted-foreground text-sm">No detections in this category</div>;
  }
  const colorClass = highlight === 'destructive' ? 'text-destructive'
    : highlight === 'warning' ? 'text-warning'
    : 'text-muted-foreground';

  return (
    <div className="border border-border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 sticky top-0">
          <tr>
            <th className="px-3 py-2 text-left">Reg</th>
            <th className="px-3 py-2 text-left">Callsign</th>
            <th className="px-3 py-2 text-right">Speed</th>
            <th className="px-3 py-2 text-left">Nearest Airport</th>
            <th className="px-3 py-2 text-right">AOI dist</th>
            <th className="px-3 py-2 text-left">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={`${r.registration}-${r.detection_timestamp}-${i}`} className="border-t border-border">
              <td className={`px-3 py-2 font-mono font-bold ${colorClass}`}>{r.registration || 'N/A'}</td>
              <td className="px-3 py-2 font-mono">{r.callsign || '-'}</td>
              <td className="px-3 py-2 text-right font-mono">{r.speed ?? 0}kt</td>
              <td className="px-3 py-2 font-mono">
                <Badge variant="outline" className="text-[10px]">{r.nearest_airport}</Badge>
                <span className="ml-1 text-muted-foreground">{r.nearest_airport_km}km</span>
              </td>
              <td className="px-3 py-2 text-right font-mono">{r.aoi_distance_km}km</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {new Date(r.detection_timestamp).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && (
        <div className="text-xs text-muted-foreground p-2 text-center border-t border-border">
          Showing first 200 of {rows.length}
        </div>
      )}
    </div>
  );
}

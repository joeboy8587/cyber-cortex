import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Crosshair, MapPin, Plane, Shield, Moon, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import UnmaskHQMap from "@/components/dashboard/UnmaskHQMapView";

interface HQLocation {
  id: string;
  cluster_center_lat: number;
  cluster_center_lng: number;
  visit_count: number;
  unique_aircraft: number;
  aircraft_list: string[];
  first_visit: string;
  last_visit: string;
  hq_confidence_score: number;
  location_type: string;
  cross_references: any[];
  night_operations: number;
  ai_assessment: string | null;
  scan_id: string;
  created_at: string;
}

interface HQSummary {
  total_locations: number;
  max_confidence: number;
  total_visits: number;
  total_scans: number;
}

export default function UnmaskHQSystem() {
  const [locations, setLocations] = useState<HQLocation[]>([]);
  const [summary, setSummary] = useState<HQSummary | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<HQLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "getUnmaskHQData" },
      });
      if (error) throw error;
      const payload = result?.data || result;
      const locs = (payload?.locations || []).map((l: any) => ({
        ...l,
        aircraft_list: typeof l.aircraft_list === "string" ? JSON.parse(l.aircraft_list) : l.aircraft_list || [],
        cross_references: typeof l.cross_references === "string" ? JSON.parse(l.cross_references) : l.cross_references || [],
      }));
      setLocations(locs);
      setSummary(payload?.summary || null);
    } catch (e) {
      console.error("Failed to load HQ data:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const runScan = async () => {
    setIsScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("unmask-hq");
      if (error) throw error;
      toast.success(`Scan complete: ${data?.persisted || 0} HQ locations discovered`);
      await loadData();
    } catch (e: any) {
      toast.error(`Scan failed: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const confidenceColor = (score: number) => {
    if (score >= 80) return "text-red-400";
    if (score >= 60) return "text-orange-400";
    if (score >= 40) return "text-yellow-400";
    return "text-muted-foreground";
  };

  const confidenceBadge = (score: number) => {
    if (score >= 80) return "destructive";
    if (score >= 60) return "default";
    return "secondary";
  };

  const locationTypeLabel = (t: string) => {
    const map: Record<string, string> = {
      probable_base: "🏢 Probable Base",
      convergence_point: "🔀 Convergence Point",
      covert_facility: "🌙 Covert Facility",
      private_airstrip: "🛬 Private Airstrip",
      commercial_airport: "✈️ Commercial Airport",
      helipad: "🚁 Helipad",
      unknown_facility: "❓ Unknown Facility",
    };
    return map[t] || t;
  };

  return (
    <Card className="border-red-500/30 bg-card/95">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-red-500/20 border border-red-500/40 flex items-center justify-center">
              <Crosshair className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <CardTitle className="text-lg font-display uppercase tracking-wider text-red-400">
                Unmask HQ System
              </CardTitle>
              <p className="text-xs font-mono text-muted-foreground">
                LANDING CLUSTER ANALYSIS // BASE DETECTION // GPS INTELLIGENCE
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {summary && (
              <Badge variant="outline" className="text-xs font-mono">
                {summary.total_locations || 0} LOCATIONS
              </Badge>
            )}
            <Button size="sm" onClick={runScan} disabled={isScanning} variant="destructive">
              {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Crosshair className="w-4 h-4 mr-1" />}
              {isScanning ? "Scanning..." : "Run Scan"}
            </Button>
            <Button size="sm" variant="outline" onClick={loadData} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="map">
          <TabsList className="mb-4">
            <TabsTrigger value="map">🗺️ Map</TabsTrigger>
            <TabsTrigger value="table">📊 HQ Table</TabsTrigger>
            <TabsTrigger value="drilldown">🔍 Drill-Down</TabsTrigger>
          </TabsList>

          <TabsContent value="map">
            <div className="h-[500px] rounded-lg overflow-hidden border border-border">
              <UnmaskHQMap locations={locations} onSelectLocation={(loc: any) => setSelectedLocation(loc as HQLocation)} selectedId={selectedLocation?.id} />
            </div>
            {summary && (
              <div className="grid grid-cols-4 gap-3 mt-4">
                <div className="p-3 rounded bg-muted/50 border border-border text-center">
                  <div className="text-2xl font-bold text-red-400">{summary.total_locations || 0}</div>
                  <div className="text-xs text-muted-foreground">Locations Found</div>
                </div>
                <div className="p-3 rounded bg-muted/50 border border-border text-center">
                  <div className="text-2xl font-bold text-orange-400">{summary.max_confidence || 0}</div>
                  <div className="text-xs text-muted-foreground">Max Confidence</div>
                </div>
                <div className="p-3 rounded bg-muted/50 border border-border text-center">
                  <div className="text-2xl font-bold text-yellow-400">{summary.total_visits || 0}</div>
                  <div className="text-xs text-muted-foreground">Total Landings</div>
                </div>
                <div className="p-3 rounded bg-muted/50 border border-border text-center">
                  <div className="text-2xl font-bold text-primary">{summary.total_scans || 0}</div>
                  <div className="text-xs text-muted-foreground">Scans Run</div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="table">
            {locations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No HQ locations discovered yet. Run a scan to analyze landing patterns.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {locations.map((loc, i) => (
                  <div
                    key={loc.id}
                    onClick={() => setSelectedLocation(loc)}
                    className={`p-3 rounded border cursor-pointer transition-colors ${
                      selectedLocation?.id === loc.id ? "border-red-500/60 bg-red-500/10" : "border-border hover:border-primary/30 bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-muted-foreground w-6">#{i + 1}</span>
                        <MapPin className={`w-4 h-4 ${confidenceColor(loc.hq_confidence_score)}`} />
                        <div>
                          <div className="font-mono text-sm">
                            {loc.cluster_center_lat.toFixed(4)}, {loc.cluster_center_lng.toFixed(4)}
                          </div>
                          <div className="text-xs text-muted-foreground">{locationTypeLabel(loc.location_type)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {loc.night_operations > 0 && (
                          <Badge variant="outline" className="text-xs"><Moon className="w-3 h-3 mr-1" />{loc.night_operations}</Badge>
                        )}
                        <Badge variant="outline" className="text-xs"><Plane className="w-3 h-3 mr-1" />{loc.unique_aircraft}</Badge>
                        <Badge variant="outline" className="text-xs"><Shield className="w-3 h-3 mr-1" />{loc.visit_count} visits</Badge>
                        <Badge variant={confidenceBadge(loc.hq_confidence_score) as any} className="font-mono">
                          {loc.hq_confidence_score}%
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="drilldown">
            {selectedLocation ? (
              <div className="space-y-4">
                <div className="p-4 rounded border border-red-500/30 bg-red-500/5">
                  <h3 className="font-display text-lg text-red-400 mb-2">
                    Location: {selectedLocation.cluster_center_lat.toFixed(4)}, {selectedLocation.cluster_center_lng.toFixed(4)}
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div><span className="text-xs text-muted-foreground">Type</span><div className="text-sm">{locationTypeLabel(selectedLocation.location_type)}</div></div>
                    <div><span className="text-xs text-muted-foreground">Confidence</span><div className={`text-sm font-bold ${confidenceColor(selectedLocation.hq_confidence_score)}`}>{selectedLocation.hq_confidence_score}%</div></div>
                    <div><span className="text-xs text-muted-foreground">Visit Count</span><div className="text-sm">{selectedLocation.visit_count}</div></div>
                    <div><span className="text-xs text-muted-foreground">Night Ops</span><div className="text-sm">{selectedLocation.night_operations}</div></div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Plane className="w-4 h-4" /> Aircraft at This Location</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedLocation.aircraft_list.map((reg) => (
                      <Badge key={reg} variant="outline" className="font-mono">{reg}</Badge>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <span className="text-xs text-muted-foreground">First Visit</span>
                    <div className="text-sm font-mono">{selectedLocation.first_visit ? new Date(selectedLocation.first_visit).toLocaleDateString() : "N/A"}</div>
                  </div>
                  <div className="p-3 rounded bg-muted/30 border border-border">
                    <span className="text-xs text-muted-foreground">Last Visit</span>
                    <div className="text-sm font-mono">{selectedLocation.last_visit ? new Date(selectedLocation.last_visit).toLocaleDateString() : "N/A"}</div>
                  </div>
                </div>

                {selectedLocation.cross_references.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Cross References</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedLocation.cross_references.map((ref: any, i: number) => (
                        <Badge key={i} variant="secondary">{ref.type}: {ref.name}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Crosshair className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Select a location from the Map or Table to drill down.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Radar, AlertTriangle, Eye, Zap, Target, Bug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface DroneResult {
  hoverCandidates: any[];
  nullDataEvents: any[];
  faFleet: any[];
  droneScoring: any[];
  swarmEvents: any[];
  stats: {
    nullDataTotal: number;
    hoverTotal: number;
    lowAltTotal: number;
    droneCandidateAircraft: number;
    totalScanned: number;
  };
  scanTimestamp: string;
}

function getDroneLabel(score: number) {
  if (score >= 70) return { label: "CONFIRMED", color: "bg-red-500/20 text-red-400 border-red-500/30" };
  if (score >= 40) return { label: "LIKELY", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" };
  if (score >= 20) return { label: "POSSIBLE", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  return { label: "LOW", color: "bg-muted text-muted-foreground border-border" };
}

function DroneRow({ item, type }: { item: any; type: string }) {
  const reg = item.registration || "UNKNOWN";

  const details: Record<string, string> = {
    hover: `${item.altitude} ft • ${item.speed} kts • ${item.hover_type}`,
    nullData: `ALT ${item.altitude} ft • SPD 0 kts — transponder anomaly`,
    fa: `${item.detection_count} detections • ${item.icao_count} ICAO codes • min ${item.min_altitude} ft • avg ${item.avg_speed} kts`,
    score: `Score: ${item.drone_score}/100 • Hover: ${item.hover_events} • NULL: ${item.null_data} • ICAO: ${item.icao_count} codes`,
    swarm: `${item.aircraft_count} aircraft • avg ${item.avg_altitude} ft / ${item.avg_speed} kts`,
  };

  const scoreInfo = type === "score" ? getDroneLabel(item.drone_score || 0) : null;

  return (
    <div className="flex items-start justify-between border-b border-border/30 py-2 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-primary font-bold">{reg}</span>
          {scoreInfo && (
            <Badge variant="outline" className={`text-[10px] ${scoreInfo.color}`}>
              {scoreInfo.label} ({item.drone_score}%)
            </Badge>
          )}
          {type === "fa" && (
            <Badge variant="outline" className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">
              FA FLEET
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{details[type] || ""}</p>
        {type === "swarm" && item.aircraft_list && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Aircraft: {(Array.isArray(item.aircraft_list)
              ? item.aircraft_list
              : String(item.aircraft_list || "").replace(/[{}]/g, "").split(",").filter(Boolean)
            ).slice(0, 8).join(", ")}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 ml-2">
        <span className="text-[10px] text-muted-foreground">
          {type === "swarm"
            ? new Date(item.window_start).toLocaleString()
            : item.detection_timestamp
              ? new Date(item.detection_timestamp).toLocaleString()
              : item.last_seen
                ? new Date(item.last_seen).toLocaleDateString()
                : ""}
        </span>
      </div>
    </div>
  );
}

export function DroneInvestigationPanel() {
  const [results, setResults] = useState<DroneResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const runScan = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "droneInvestigationScan", timeWindow: "90 days" },
      });
      if (error) throw error;
      setResults(data);
      toast({
        title: "🛸 Drone Investigation Complete",
        description: `${data.stats?.droneCandidateAircraft || 0} drone candidates identified across ${data.stats?.totalScanned || 0} records`,
      });
    } catch (e: any) {
      toast({ title: "Scan Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: "scoring", label: "Drone Scores", icon: Target, count: results?.droneScoring?.length },
    { id: "fa", label: "FA Fleet", icon: Bug, count: results?.faFleet?.length },
    { id: "hover", label: "Hover Events", icon: Eye, count: results?.hoverCandidates?.length },
    { id: "nulldata", label: "NULL DATA", icon: AlertTriangle, count: results?.nullDataEvents?.length },
    { id: "swarm", label: "Swarm Detection", icon: Zap, count: results?.swarmEvents?.length },
  ];

  const defaultTab = results
    ? tabs.find((t) => (t.count || 0) > 0)?.id || "scoring"
    : "scoring";

  return (
    <Card className="border-orange-500/30 bg-card/80">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 font-mono text-base uppercase tracking-wider">
          <Radar className="h-5 w-5 text-orange-400" />
          Drone Investigation Engine
          <Badge variant="outline" className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30">
            UAS DETECTION
          </Badge>
        </CardTitle>
        <Button
          onClick={runScan}
          disabled={loading}
          variant="destructive"
          className="bg-orange-600 hover:bg-orange-700"
        >
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Radar className="h-4 w-4 mr-2" />}
          Investigate Drones
        </Button>
      </CardHeader>
      <CardContent>
        {!results && !loading && (
          <div className="text-center py-10 text-muted-foreground space-y-2">
            <Radar className="h-10 w-10 mx-auto opacity-30" />
            <p className="font-mono text-sm">Drone detection across 5 vectors</p>
            <p className="text-xs">
              Hover detection • NULL DATA • FA Fleet analysis • Drone scoring • Swarm detection
            </p>
          </div>
        )}

        {loading && (
          <div className="text-center py-10 space-y-2">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-orange-400" />
            <p className="font-mono text-sm text-orange-400">Scanning for drone signatures...</p>
          </div>
        )}

        {results && !loading && (
          <div className="space-y-4">
            {/* Aggregate Banner */}
            <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-400">
                    {results.stats.droneCandidateAircraft}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase">Drone Candidates</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">{results.stats.nullDataTotal}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">NULL DATA Events</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-400">{results.stats.hoverTotal}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Hover Events</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-400">{results.stats.lowAltTotal}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Low Alt (&lt;500ft)</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-foreground">{results.swarmEvents.length}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Swarm Windows</div>
                </div>
              </div>
              <div className="mt-3 text-center">
                <p className="text-xs text-muted-foreground">
                  Scanned {results.stats.totalScanned.toLocaleString()} records •{" "}
                  {new Date(results.scanTimestamp).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Legal Citations */}
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                14 CFR Part 107 – UAS Operations
              </Badge>
              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                49 U.S.C. § 46306 – Registration Fraud
              </Badge>
              <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30">
                18 U.S.C. § 32 – False ADS-B Data
              </Badge>
              <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30">
                Remote ID Violations
              </Badge>
            </div>

            {/* Tabs */}
            <Tabs defaultValue={defaultTab} className="space-y-3">
              <TabsList className="grid h-auto w-full grid-cols-5 gap-1 bg-muted/30 p-1">
                {tabs.map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="flex items-center gap-1 text-[11px] data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400"
                  >
                    <t.icon className="h-3 w-3" />
                    {t.label}
                    {(t.count || 0) > 0 && (
                      <Badge variant="secondary" className="h-4 min-w-[16px] px-1 text-[9px]">
                        {t.count}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="scoring" className="max-h-96 overflow-y-auto">
                {results.droneScoring.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">No drone candidates detected</p>
                ) : (
                  results.droneScoring.map((item, i) => <DroneRow key={i} item={item} type="score" />)
                )}
              </TabsContent>

              <TabsContent value="fa" className="max-h-96 overflow-y-auto">
                {results.faFleet.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">No FA fleet aircraft detected</p>
                ) : (
                  <>
                    <div className="rounded border border-red-500/30 bg-red-500/5 p-2 mb-3">
                      <p className="text-xs text-red-400 font-mono">
                        ⚠ ALF IX LLC "Cessna 172" Fleet — Sequential serial numbers (172S13163–174) —
                        Bulk purchase pattern consistent with drone fleet acquisition
                      </p>
                    </div>
                    {results.faFleet.map((item, i) => <DroneRow key={i} item={item} type="fa" />)}
                  </>
                )}
              </TabsContent>

              <TabsContent value="hover" className="max-h-96 overflow-y-auto">
                {results.hoverCandidates.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">No hover events detected</p>
                ) : (
                  results.hoverCandidates.map((item, i) => <DroneRow key={i} item={item} type="hover" />)
                )}
              </TabsContent>

              <TabsContent value="nulldata" className="max-h-96 overflow-y-auto">
                {results.nullDataEvents.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">No NULL DATA events detected</p>
                ) : (
                  <>
                    <div className="rounded border border-yellow-500/30 bg-yellow-500/5 p-2 mb-3">
                      <p className="text-xs text-yellow-400 font-mono">
                        Speed = 0 at altitude &gt; 100 ft — Impossible for fixed-wing aircraft —
                        Drone hover or transponder manipulation
                      </p>
                    </div>
                    {results.nullDataEvents.map((item, i) => <DroneRow key={i} item={item} type="nullData" />)}
                  </>
                )}
              </TabsContent>

              <TabsContent value="swarm" className="max-h-96 overflow-y-auto">
                {results.swarmEvents.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">No swarm formations detected</p>
                ) : (
                  <>
                    <div className="rounded border border-cyan-500/30 bg-cyan-500/5 p-2 mb-3">
                      <p className="text-xs text-cyan-400 font-mono">
                        3+ drone candidates detected within 5-minute windows — coordinated UAS operations
                      </p>
                    </div>
                    {results.swarmEvents.map((item, i) => <DroneRow key={i} item={item} type="swarm" />)}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

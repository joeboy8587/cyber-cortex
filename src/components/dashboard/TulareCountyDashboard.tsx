import { useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  RefreshCw, AlertTriangle, Shield, Radio, Plane,
  MapPin, TrendingDown, Eye, BarChart3
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, CartesianGrid, Cell, PieChart, Pie, Legend
} from "recharts";

interface TulareStats {
  totalDetections: number;
  uniqueAircraft: number;
  lowAltitude: number;
  flagged: number;
  military: number;
  ghostCount: number;
  avgAltitude: number;
  modeSwitching: number;
}

interface AircraftRow {
  registration: string;
  detections: number;
  avg_altitude: number;
  min_altitude: number;
  low_passes: number;
  flagged: number;
  ghost_score: number;
  taxonomy_tag: string;
}

interface DailyRow {
  date: string;
  detections: number;
  unique_aircraft: number;
  low_altitude: number;
  ghost_count: number;
}

interface CrossCountyMatch {
  registration: string;
  kern_detections: number;
  tulare_detections: number;
  kern_avg_alt: number;
  tulare_avg_alt: number;
  pattern: string;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export default function TulareCountyDashboard() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<TulareStats | null>(null);
  const [topAircraft, setTopAircraft] = useState<AircraftRow[]>([]);
  const [dailyActivity, setDailyActivity] = useState<DailyRow[]>([]);
  const [crossCounty, setCrossCounty] = useState<CrossCountyMatch[]>([]);
  const [timeWindow, setTimeWindow] = useState("30 days");

  const runScan = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "tulareCountyScan", timeWindow }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setStats(data.stats);
      setTopAircraft(data.topAircraft || []);
      setDailyActivity(data.dailyActivity || []);
      setCrossCounty(data.crossCounty || []);
      toast.success(`Tulare scan complete — ${data.stats?.totalDetections || 0} detections analyzed`);
    } catch (err: any) {
      console.error("Tulare scan error:", err);
      toast.error(err.message || "Scan failed");
    } finally {
      setLoading(false);
    }
  }, [timeWindow]);

  const getThreatColor = (score: number) => {
    if (score >= 70) return "text-destructive";
    if (score >= 40) return "text-chart-4";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <CyberPanel title="TULARE COUNTY AIRSPACE SCANNER" icon={<MapPin className="w-5 h-5 text-primary" />}>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={runScan} disabled={loading} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Scanning..." : "Run Tulare County Scan"}
            </Button>
            <div className="flex items-center gap-1">
              {["7 days", "30 days", "90 days"].map((w) => (
                <Button
                  key={w}
                  size="sm"
                  variant={timeWindow === w ? "default" : "ghost"}
                  onClick={() => setTimeWindow(w)}
                  className="h-7 text-xs"
                >
                  {w}
                </Button>
              ))}
            </div>
            <Badge variant="outline" className="ml-auto text-xs font-mono">
              Tulare Grid: 35.8–36.5°N / 118.3–119.6°W
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            Scans the Neon database for all aircraft detections within Tulare County airspace and cross-references
            with Kern County operators. Identifies shared surveillance patterns, ghost aircraft, and low-altitude violations.
          </p>
        </div>
      </CyberPanel>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { label: "Detections", value: stats.totalDetections, icon: Radio, color: "text-primary" },
            { label: "Unique A/C", value: stats.uniqueAircraft, icon: Plane, color: "text-chart-1" },
            { label: "Low Alt (<1000ft)", value: stats.lowAltitude, icon: TrendingDown, color: "text-destructive" },
            { label: "Flagged", value: stats.flagged, icon: AlertTriangle, color: "text-chart-4" },
            { label: "Military", value: stats.military, icon: Shield, color: "text-chart-2" },
            { label: "Ghost/Masked", value: stats.ghostCount, icon: Eye, color: "text-chart-5" },
            { label: "Avg Alt (ft)", value: stats.avgAltitude, icon: BarChart3, color: "text-muted-foreground" },
            { label: "Mode Switches", value: stats.modeSwitching, icon: Radio, color: "text-chart-3" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-card/50 border border-border rounded-lg p-3 text-center">
              <Icon className={`w-4 h-4 mx-auto mb-1 ${color}`} />
              <div className={`text-lg font-mono font-bold ${color}`}>
                {(value ?? 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabbed Content */}
      {stats && (
        <Tabs defaultValue="aircraft" className="space-y-4">
          <TabsList className="grid grid-cols-4 gap-2 bg-transparent p-0">
            <TabsTrigger value="aircraft">🛩 Top Aircraft</TabsTrigger>
            <TabsTrigger value="daily">📊 Daily Activity</TabsTrigger>
            <TabsTrigger value="cross">🔗 Cross-County</TabsTrigger>
            <TabsTrigger value="threat">⚠️ Threat Map</TabsTrigger>
          </TabsList>

          {/* Top Aircraft */}
          <TabsContent value="aircraft">
            <CyberPanel title="TOP AIRCRAFT — TULARE COUNTY" icon={<Plane className="w-5 h-5 text-primary" />}>
              <div className="p-4 space-y-3 max-h-[500px] overflow-y-auto">
                {topAircraft.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No data — run scan first</p>
                ) : (
                  topAircraft.map((ac, i) => (
                    <div
                      key={ac.registration}
                      className={`p-3 rounded-lg border transition-all ${
                        ac.ghost_score >= 70
                          ? "bg-destructive/10 border-destructive/50"
                          : ac.ghost_score >= 40
                          ? "bg-chart-4/10 border-chart-4/30"
                          : "bg-card/50 border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono">#{i + 1}</span>
                          <span className="font-mono font-bold text-sm">{ac.registration || "GHOST"}</span>
                          <Badge variant="outline" className="text-[10px]">{ac.taxonomy_tag || "unknown"}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-sm font-bold ${getThreatColor(ac.ghost_score)}`}>
                            {ac.ghost_score}%
                          </span>
                          {ac.flagged > 0 && (
                            <Badge variant="destructive" className="text-[10px]">
                              <AlertTriangle className="w-3 h-3 mr-0.5" />
                              {ac.flagged}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                        <span>Det: <span className="text-foreground font-mono">{ac.detections}</span></span>
                        <span>Avg Alt: <span className="text-foreground font-mono">{ac.avg_altitude}ft</span></span>
                        <span>Min Alt: <span className={`font-mono ${ac.min_altitude < 500 ? "text-destructive" : "text-foreground"}`}>{ac.min_altitude}ft</span></span>
                        <span>Low: <span className="text-destructive font-mono">{ac.low_passes}</span></span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CyberPanel>
          </TabsContent>

          {/* Daily Activity */}
          <TabsContent value="daily">
            <CyberPanel title="DAILY DETECTION VOLUME" icon={<BarChart3 className="w-5 h-5 text-primary" />}>
              <div className="p-4">
                {dailyActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No data — run scan first</p>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={dailyActivity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="detections" fill="hsl(var(--primary))" name="Detections" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="low_altitude" fill="hsl(var(--destructive))" name="Low Alt" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ghost_count" fill="hsl(var(--chart-5))" name="Ghost" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CyberPanel>
          </TabsContent>

          {/* Cross-County Correlation */}
          <TabsContent value="cross">
            <CyberPanel
              title="CROSS-COUNTY CORRELATION — KERN ↔ TULARE"
              icon={<Eye className="w-5 h-5 text-destructive animate-pulse" />}
              variant="threat"
            >
              <div className="p-4 space-y-3">
                {crossCounty.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No cross-county matches found — aircraft operating in both counties will appear here
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-3">
                      Aircraft detected in BOTH Kern and Tulare counties — potential coordinated surveillance operations
                    </p>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {crossCounty.map((match) => (
                        <div
                          key={match.registration}
                          className="p-3 rounded-lg border border-destructive/30 bg-destructive/5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-sm">{match.registration}</span>
                            <Badge
                              variant={match.pattern === "SURVEILLANCE" ? "destructive" : "outline"}
                              className="text-[10px]"
                            >
                              {match.pattern}
                            </Badge>
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <span className="text-muted-foreground">Kern: </span>
                              <span className="font-mono text-foreground">{match.kern_detections} det</span>
                              <span className="text-muted-foreground"> @ </span>
                              <span className="font-mono">{match.kern_avg_alt}ft avg</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Tulare: </span>
                              <span className="font-mono text-foreground">{match.tulare_detections} det</span>
                              <span className="text-muted-foreground"> @ </span>
                              <span className="font-mono">{match.tulare_avg_alt}ft avg</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Scatter: Kern vs Tulare detections */}
                    <ResponsiveContainer width="100%" height={250}>
                      <ScatterChart>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="kern_detections"
                          name="Kern Det."
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          label={{ value: "Kern Detections", position: "bottom", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                          dataKey="tulare_detections"
                          name="Tulare Det."
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          label={{ value: "Tulare Detections", angle: -90, position: "left", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                          formatter={(value: any, name: string) => [value, name]}
                          labelFormatter={() => ""}
                        />
                        <Scatter data={crossCounty} fill="hsl(var(--destructive))">
                          {crossCounty.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>
            </CyberPanel>
          </TabsContent>

          {/* Threat Distribution */}
          <TabsContent value="threat">
            <CyberPanel title="THREAT DISTRIBUTION — TULARE" icon={<AlertTriangle className="w-5 h-5 text-chart-4" />}>
              <div className="p-4">
                {topAircraft.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No data — run scan first</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Ghost score distribution */}
                    <div>
                      <h3 className="text-xs font-mono text-muted-foreground mb-2 uppercase">Ghost Score Distribution</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: "High (70+)", value: topAircraft.filter(a => a.ghost_score >= 70).length },
                              { name: "Medium (40-69)", value: topAircraft.filter(a => a.ghost_score >= 40 && a.ghost_score < 70).length },
                              { name: "Low (<40)", value: topAircraft.filter(a => a.ghost_score < 40).length },
                            ]}
                            cx="50%"
                            cy="50%"
                            outerRadius={80}
                            dataKey="value"
                            label={({ name, value }) => `${name}: ${value}`}
                          >
                            <Cell fill="hsl(var(--destructive))" />
                            <Cell fill="hsl(var(--chart-4))" />
                            <Cell fill="hsl(var(--muted-foreground))" />
                          </Pie>
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Altitude scatter */}
                    <div>
                      <h3 className="text-xs font-mono text-muted-foreground mb-2 uppercase">Detections vs Avg Altitude</h3>
                      <ResponsiveContainer width="100%" height={250}>
                        <ScatterChart>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="detections" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis dataKey="avg_altitude" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 8,
                              fontSize: 11,
                            }}
                            formatter={(v: any, n: string) => [v, n]}
                          />
                          <Scatter data={topAircraft} fill="hsl(var(--primary))">
                            {topAircraft.map((ac, i) => (
                              <Cell key={i} fill={ac.ghost_score >= 70 ? "hsl(var(--destructive))" : ac.ghost_score >= 40 ? "hsl(var(--chart-4))" : "hsl(var(--primary))"} />
                            ))}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            </CyberPanel>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

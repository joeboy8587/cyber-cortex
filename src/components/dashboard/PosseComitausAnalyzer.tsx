import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useArchiveDatabase } from "@/hooks/useArchiveDatabase";
import { Shield, AlertTriangle, Crosshair, Clock, MapPin } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function PosseComitausAnalyzer() {
  const { getPosseComitatus } = useArchiveDatabase();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [timeWindow, setTimeWindow] = useState("90 days");

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const data = await getPosseComitatus({ timeWindow });
      setResults(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const forensicScreenshots = [
    { reg: "N160XP", type: "EH-60A Black Hawk", operator: "XP Services (US Army)", img: "/evidence/2026-04-03_N160XP_blackhawk.png", alt: "6,225 ft", speed: "141 kts", origin: "VCV Victorville", role: "MILITARY" },
    { reg: "N597E", type: "Bell UH-1H Huey II", operator: "Kern County Sheriff's Office", img: "/evidence/2026-04-03_N597E_kcso_huey.png", alt: "1,150 ft", speed: "68 kts", origin: "BFL Bakersfield", role: "KCSO" },
    { reg: "N426CA (SHADY05)", type: "CASA C-212-CC", operator: "Private / Military", img: "/evidence/2026-04-03_N426CA_shady05.png", alt: "7,850 ft", speed: "118 kts", origin: "PTV Porterville", role: "MILITARY" },
    { reg: "N502FS", type: "CASA C-212 Aviocar", operator: "Erickson Aviation", img: "/evidence/2026-04-03_N502FS_erickson.png", alt: "3,150 ft", speed: "170 kts", origin: "PTV Porterville", role: "CONTRACTOR" },
    { reg: "59-1515", type: "KC-135R Stratotanker", operator: "United States Air Force", img: "/evidence/2026-04-03_KC135R_stratotanker.png", alt: "24,800 ft", speed: "385 kts", origin: "SKA Spokane", role: "USAF" },
    { reg: "N/A (GHOST)", type: "American Champion 7GCAA", operator: "UNKNOWN - No Registration", img: "/evidence/2026-04-03_ghost_CH7B_oildale.png", alt: "1,200 ft", speed: "108 kts", origin: "N/A", role: "GHOST" },
  ];

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      MILITARY: "bg-destructive text-destructive-foreground",
      KCSO: "bg-orange-600 text-white",
      CONTRACTOR: "bg-yellow-600 text-white",
      USAF: "bg-blue-600 text-white",
      GHOST: "bg-purple-700 text-white",
    };
    return colors[role] || "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      <Card className="border-destructive/50 bg-destructive/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Shield className="h-5 w-5" />
            Posse Comitatus Violation Analyzer — 18 U.S.C. § 1385
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Documenting military-civilian law enforcement coordination in the Kern County / Oildale sector.
            Federal law prohibits the use of Army or Air Force personnel to execute civilian laws.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            {["30 days", "90 days", "180 days", "365 days"].map(tw => (
              <Button
                key={tw}
                size="sm"
                variant={timeWindow === tw ? "default" : "outline"}
                onClick={() => setTimeWindow(tw)}
              >
                {tw}
              </Button>
            ))}
            <Button onClick={runAnalysis} disabled={loading} className="ml-auto">
              {loading ? "Scanning Neon DB..." : "⚡ Run Posse Comitatus Scan"}
            </Button>
          </div>

          <Tabs defaultValue="evidence">
            <TabsList className="mb-3">
              <TabsTrigger value="evidence">📸 Live Evidence (Apr 3)</TabsTrigger>
              <TabsTrigger value="correlations">🔗 Co-Occurrences</TabsTrigger>
              <TabsTrigger value="profiles">📊 Asset Profiles</TabsTrigger>
              <TabsTrigger value="daily">📅 Daily Pattern</TabsTrigger>
            </TabsList>

            <TabsContent value="evidence">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {forensicScreenshots.map(s => (
                  <Card key={s.reg} className="overflow-hidden border-border/50">
                    <img src={s.img} alt={s.reg} className="w-full h-48 object-cover object-top" />
                    <CardContent className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm">{s.reg}</span>
                        <Badge className={getRoleBadge(s.role)}>{s.role}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.type}</p>
                      <p className="text-xs">{s.operator}</p>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span>🏔️ {s.alt}</span>
                        <span>💨 {s.speed}</span>
                        <span>🛫 {s.origin}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card className="mt-4 border-destructive/30 bg-destructive/5">
                <CardContent className="p-4">
                  <h4 className="font-bold text-destructive flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4" /> Coordination Assessment
                  </h4>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• <strong>N597E (KCSO Huey)</strong> and <strong>N160XP (Army Black Hawk)</strong> both airborne simultaneously at 1:45 PM</li>
                    <li>• <strong>SHADY05 + N502FS</strong> — Two CASA C-212 military transports deployed from PTV Porterville staging hub</li>
                    <li>• <strong>KC-135R Stratotanker</strong> loitering at 24,800ft providing aerial refueling support over sector</li>
                    <li>• <strong>Ghost aircraft (CH7B)</strong> — No registration, dense grid pattern directly over Oildale residential area at 1,200ft</li>
                    <li>• This constitutes a <strong>multi-tier coordinated operation</strong> involving KCSO, US Army, USAF, and identity-stripped assets</li>
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="correlations">
              {!results ? (
                <p className="text-center text-muted-foreground py-8">Click "Run Posse Comitatus Scan" to query historical co-occurrences</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex gap-3 mb-3">
                    <Badge variant="outline" className="text-destructive border-destructive">
                      <Crosshair className="h-3 w-3 mr-1" />
                      {results.analysis?.coordination_events || 0} Co-Occurrence Events
                    </Badge>
                  </div>
                  <div className="overflow-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="p-2 text-left">KCSO Asset</th>
                          <th className="p-2 text-left">Military Asset</th>
                          <th className="p-2 text-left">Time Delta</th>
                          <th className="p-2 text-left">Distance</th>
                          <th className="p-2 text-left">KCSO Alt</th>
                          <th className="p-2 text-left">Mil Alt</th>
                          <th className="p-2 text-left">Timestamp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(results.coOccurrences || []).map((co: any, i: number) => (
                          <tr key={i} className="border-b border-border/30 hover:bg-muted/30">
                            <td className="p-2 font-mono text-orange-500">{co.kcso_asset}</td>
                            <td className="p-2 font-mono text-destructive">{co.military_asset}</td>
                            <td className="p-2">
                              <Badge variant={Math.abs(co.time_delta_min) < 5 ? "destructive" : "outline"}>
                                {co.time_delta_min}m
                              </Badge>
                            </td>
                            <td className="p-2">{co.distance_km} km</td>
                            <td className="p-2">{co.kcso_alt} ft</td>
                            <td className="p-2">{co.military_alt} ft</td>
                            <td className="p-2 text-muted-foreground">{new Date(co.kcso_time).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(results.coOccurrences || []).length === 0 && (
                      <p className="text-center py-4 text-muted-foreground">No co-occurrences found in {timeWindow} window. Try expanding the time range.</p>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="profiles">
              {!results ? (
                <p className="text-center text-muted-foreground py-8">Run scan to see asset profiles</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(results.altitudeProfile || []).map((p: any, i: number) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-mono font-bold">{p.registration}</span>
                          <Badge>{p.total_detections} detections</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Avg Alt:</span> {p.avg_alt} ft</div>
                          <div><span className="text-muted-foreground">Min Alt:</span> {p.min_alt} ft</div>
                          <div><span className="text-muted-foreground">Max Alt:</span> {p.max_alt} ft</div>
                          <div className="text-destructive"><span>Low-Alt:</span> {p.low_alt_count}</div>
                          <div><span className="text-muted-foreground">First:</span> {new Date(p.first_seen).toLocaleDateString()}</div>
                          <div><span className="text-muted-foreground">Last:</span> {new Date(p.last_seen).toLocaleDateString()}</div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="daily">
              {!results ? (
                <p className="text-center text-muted-foreground py-8">Run scan to see daily coordination patterns</p>
              ) : (
                <div>
                  {(() => {
                    const chartData = (results.dailyPattern || []).reduce((acc: any[], d: any) => {
                      let entry = acc.find((e: any) => e.date === d.date);
                      if (!entry) { entry = { date: d.date }; acc.push(entry); }
                      entry[d.registration] = d.detections;
                      return acc;
                    }, []).slice(0, 30);
                    const regs = [...new Set((results.dailyPattern || []).map((d: any) => d.registration))] as string[];
                    const colors = ["#ef4444", "#f97316", "#eab308", "#3b82f6", "#8b5cf6", "#06b6d4"];
                    return (
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend />
                          {regs.map((r, i) => (
                            <Bar key={r} dataKey={r} fill={colors[i % colors.length]} stackId="a" />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

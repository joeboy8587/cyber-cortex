import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plane, RefreshCw, TrendingUp, Moon } from "lucide-react";
import { toast } from "sonner";
import { neonQuery } from "@/lib/neonQueryRetry";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";

const assessmentColors: Record<string, string> = {
  HIGH_SUSPICION: "destructive",
  LOGISTICS_PATTERN: "default",
  SUSTAINED_OPS: "secondary",
  MONITOR: "outline",
};

export default function DenverLogisticsAnalyzer() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runScan = async () => {
    setLoading(true);
    try {
      const { data } = await neonQuery({ action: "denverLogisticsScan" });
      setResults(data);
      toast.success(`Logistics scan complete: ${data?.flights?.length || 0} carrier patterns identified`);
    } catch (e) {
      toast.error("Scan failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const flights = results?.flights || [];
  const hourly = results?.hourlyPattern || [];
  const correlation = results?.surgeCorrelation || [];
  const summary = results?.summary || {};

  const hourlyChartData = Array.from({ length: 24 }, (_, h) => {
    const match = hourly.find((hp: any) => parseInt(hp.hour) === h);
    return { hour: `${h}:00`, detections: match ? parseInt(match.detections) : 0, callsigns: match ? parseInt(match.unique_callsigns) : 0 };
  });

  return (
    <div className="space-y-4">
      <Card className="border-accent/30 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plane className="h-5 w-5 text-accent-foreground" />
              Denver Logistics Pipeline Analyzer
            </CardTitle>
            <Button size="sm" onClick={runScan} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Scanning..." : "Scan Pipeline"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tracks nightly commercial carrier patterns, correlates with local drone activity surges, and identifies logistics corridors
          </p>
        </CardHeader>
        <CardContent>
          {summary.totalFlights > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Card className="bg-destructive/10 border-destructive/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-destructive">{summary.highSuspicion}</div>
                  <div className="text-xs text-muted-foreground">High Suspicion</div>
                </CardContent>
              </Card>
              <Card className="bg-accent/10 border-accent/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-accent-foreground">{summary.logisticsPattern}</div>
                  <div className="text-xs text-muted-foreground">Logistics Pattern</div>
                </CardContent>
              </Card>
              <Card className="bg-primary/10 border-primary/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-primary">{summary.totalFlights}</div>
                  <div className="text-xs text-muted-foreground">Total Carriers</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Hourly Distribution Chart */}
          {hourly.length > 0 && (
            <Card className="mb-4 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Moon className="h-4 w-4" />
                  24-Hour Carrier Activity (Night Shuttle Detection)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={hourlyChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Bar dataKey="detections" fill="hsl(var(--primary))" name="Detections" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Drone Surge Correlation */}
          {correlation.length > 0 && (
            <Card className="mb-4 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Commercial vs Drone Activity Correlation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={correlation.slice(0, 30).reverse()}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="flight_date" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    <Line type="monotone" dataKey="commercial_count" stroke="hsl(var(--primary))" name="Commercial" dot={false} />
                    <Line type="monotone" dataKey="drone_count" stroke="hsl(var(--destructive))" name="Drone Activity" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Carrier Table */}
          {flights.length > 0 ? (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Callsign</TableHead>
                    <TableHead>Registration</TableHead>
                    <TableHead>Detections</TableHead>
                    <TableHead>Active Days</TableHead>
                    <TableHead>Avg Alt</TableHead>
                    <TableHead>Night %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flights.map((f: any, i: number) => (
                    <TableRow key={i} className={f.assessment === 'HIGH_SUSPICION' ? 'bg-destructive/5' : ''}>
                      <TableCell>
                        <Badge variant={assessmentColors[f.assessment] as any || "outline"}>
                          {f.assessment?.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{f.callsign || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{f.registration || "—"}</TableCell>
                      <TableCell className="font-mono">{parseInt(f.detection_count).toLocaleString()}</TableCell>
                      <TableCell>{f.active_days}</TableCell>
                      <TableCell>{Math.round(parseFloat(f.avg_alt))} ft</TableCell>
                      <TableCell>
                        <span className={parseFloat(f.night_pct) > 50 ? "text-accent-foreground font-bold" : ""}>
                          {f.night_pct}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !loading ? (
            <div className="text-center py-8">
              <Plane className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Click "Scan Pipeline" to analyze commercial carrier logistics patterns and drone activity correlation</p>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">Scanning 90-day logistics corridor...</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Crosshair, RefreshCw, Ghost, Cpu } from "lucide-react";
import { toast } from "sonner";
import { neonQuery } from "@/lib/neonQueryRetry";

const classColors: Record<string, string> = {
  CONFIRMED_DRONE: "destructive",
  PROBABLE_DRONE: "destructive",
  SUSPECTED_DRONE: "default",
  POSSIBLE_DRONE: "secondary",
  UNDETERMINED: "outline",
};

export default function GhostToDroneEngine() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  const runCorrelation = async () => {
    setLoading(true);
    try {
      const { data } = await neonQuery({ action: "ghostToDroneCorrelation" });
      setResults(data);
      toast.success(`Correlation complete: ${data?.summary?.totalGhosts || 0} ghost platforms analyzed`);
    } catch (e) {
      toast.error("Correlation failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const ghosts = results?.ghosts || [];
  const summary = results?.summary || {};

  return (
    <div className="space-y-4">
      <Card className="border-destructive/30 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Ghost className="h-5 w-5 text-destructive" />
              Ghost-to-Drone Correlation Engine
            </CardTitle>
            <Button size="sm" onClick={runCorrelation} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Correlating..." : "Run Correlation"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cross-references physics violations (sub-stall speeds, negative altitudes, hover patterns) to cluster ghost detections into probable drone platforms
          </p>
        </CardHeader>
        <CardContent>
          {summary.totalGhosts > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Card className="bg-destructive/10 border-destructive/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-destructive">{summary.confirmed}</div>
                  <div className="text-xs text-muted-foreground">Confirmed Drones</div>
                </CardContent>
              </Card>
              <Card className="bg-accent/10 border-accent/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-accent-foreground">{summary.probable}</div>
                  <div className="text-xs text-muted-foreground">Probable</div>
                </CardContent>
              </Card>
              <Card className="bg-secondary/30 border-secondary/50">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-secondary-foreground">{summary.suspected}</div>
                  <div className="text-xs text-muted-foreground">Suspected</div>
                </CardContent>
              </Card>
              <Card className="bg-muted/30 border-border">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold">{summary.possible}</div>
                  <div className="text-xs text-muted-foreground">Possible</div>
                </CardContent>
              </Card>
              <Card className="bg-primary/10 border-primary/30">
                <CardContent className="pt-3 pb-2 text-center">
                  <div className="text-2xl font-bold text-primary">{summary.totalDetections?.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Detections</div>
                </CardContent>
              </Card>
            </div>
          )}

          {ghosts.length > 0 ? (
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Callsign / ICAO</TableHead>
                    <TableHead>Detections</TableHead>
                    <TableHead>Avg Alt</TableHead>
                    <TableHead>Min Speed</TableHead>
                    <TableHead>Night Ops %</TableHead>
                    <TableHead>Primary Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ghosts.map((g: any, i: number) => (
                    <TableRow key={i} className={g.drone_classification === 'CONFIRMED_DRONE' ? 'bg-destructive/5' : ''}>
                      <TableCell>
                        <Badge variant={classColors[g.drone_classification] as any || "outline"}>
                          {g.drone_classification?.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-mono">{g.callsign || "—"}</div>
                        {g.icao && <div className="text-xs text-muted-foreground">{g.icao}</div>}
                        {g.registration && <div className="text-xs text-muted-foreground">{g.registration}</div>}
                      </TableCell>
                      <TableCell className="font-mono">{parseInt(g.detection_count).toLocaleString()}</TableCell>
                      <TableCell>
                        <span className={parseFloat(g.avg_alt) < 500 ? "text-destructive font-bold" : ""}>
                          {Math.round(parseFloat(g.avg_alt))} ft
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={parseFloat(g.min_speed) < 50 ? "text-destructive font-bold" : ""}>
                          {parseFloat(g.min_speed).toFixed(1)} kts
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={parseFloat(g.night_ops_pct) > 40 ? "text-orange-400 font-bold" : ""}>
                          {g.night_ops_pct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px]">{g.primary_evidence}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !loading ? (
            <div className="text-center py-8">
              <Cpu className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">Click "Run Correlation" to analyze ghost aircraft for drone platform signatures</p>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">Analyzing physics violations across 90-day window...</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

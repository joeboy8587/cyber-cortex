import { useState, useEffect } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, TrendingUp, Plane, Calendar, Activity, Target, Search, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface DailyFlightData {
  date: string;
  flight_count: number;
  unique_aircraft: number;
  low_altitude_count: number;
  flagged_count: number;
  avg_altitude: number;
}

interface AnomalyData {
  date: string;
  flight_count: number;
  baseline_avg: number;
  multiplier: number;
  top_aircraft: { registration: string; count: number }[];
}

interface PredictionData {
  predicted_date: string;
  probability: number;
  factors: string[];
  historical_pattern: string;
}

interface DataQualityIssue {
  issue_type: string;
  count: number;
  examples: string[];
  recommendation: string;
}

interface CorruptedRegistration {
  registration: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

export function FlightSaturationAnalyzer() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("anomalies");
  
  const [dailyData, setDailyData] = useState<DailyFlightData[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyData[]>([]);
  const [predictions, setPredictions] = useState<PredictionData[]>([]);
  const [dataQuality, setDataQuality] = useState<DataQualityIssue[]>([]);
  const [corruptedRegs, setCorruptedRegs] = useState<CorruptedRegistration[]>([]);
  const [dec27Analysis, setDec27Analysis] = useState<any>(null);

  const runFullAnalysis = async () => {
    setIsLoading(true);
    toast({ title: "Running saturation analysis...", description: "Querying flight patterns" });

    try {
      // Get daily flight counts
      const { data: dailyResult } = await supabase.functions.invoke('neon-query', {
        body: { action: 'analyzeSaturation', analysisType: 'daily' }
      });
      if (dailyResult?.data) setDailyData(dailyResult.data);

      // Detect anomalies
      const { data: anomalyResult } = await supabase.functions.invoke('neon-query', {
        body: { action: 'analyzeSaturation', analysisType: 'anomalies' }
      });
      if (anomalyResult?.anomalies) setAnomalies(anomalyResult.anomalies);

      // Predict next saturation event
      const { data: predictionResult } = await supabase.functions.invoke('neon-query', {
        body: { action: 'analyzeSaturation', analysisType: 'predict' }
      });
      if (predictionResult?.predictions) setPredictions(predictionResult.predictions);

      // Data quality issues
      const { data: qualityResult } = await supabase.functions.invoke('neon-query', {
        body: { action: 'analyzeSaturation', analysisType: 'quality' }
      });
      if (qualityResult?.issues) setDataQuality(qualityResult.issues);
      if (qualityResult?.corrupted) setCorruptedRegs(qualityResult.corrupted);

      // December 27th deep dive
      const { data: dec27Result } = await supabase.functions.invoke('neon-query', {
        body: { action: 'analyzeSaturation', analysisType: 'dec27' }
      });
      if (dec27Result) setDec27Analysis(dec27Result);

      toast({ title: "Analysis complete", description: `Found ${anomalyResult?.anomalies?.length || 0} anomalies` });
    } catch (error) {
      console.error('Saturation analysis error:', error);
      toast({ title: "Analysis failed", description: String(error), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    runFullAnalysis();
  }, []);

  const getMultiplierBadge = (multiplier: number) => {
    if (multiplier >= 100) return <Badge variant="destructive" className="animate-pulse">{multiplier.toFixed(0)}x EXTREME</Badge>;
    if (multiplier >= 50) return <Badge variant="destructive">{multiplier.toFixed(0)}x CRITICAL</Badge>;
    if (multiplier >= 10) return <Badge className="bg-orange-500">{multiplier.toFixed(0)}x HIGH</Badge>;
    if (multiplier >= 5) return <Badge className="bg-yellow-500 text-black">{multiplier.toFixed(0)}x ELEVATED</Badge>;
    return <Badge variant="secondary">{multiplier.toFixed(1)}x</Badge>;
  };

  return (
    <CyberPanel
      title="Flight Saturation Analyzer"
      icon={<Activity className="w-4 h-4" />}
      className="col-span-full"
      headerActions={
        <div className="flex items-center gap-2">
          {anomalies.length > 0 && (
            <Badge variant="destructive" className="animate-pulse">
              {anomalies.length} Anomalies Detected
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={runFullAnalysis} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Search className="w-4 h-4 mr-1" />}
            Analyze
          </Button>
        </div>
      }
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="p-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="anomalies">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Anomalies
          </TabsTrigger>
          <TabsTrigger value="dec27">
            <Calendar className="w-3 h-3 mr-1" />
            Dec 27th
          </TabsTrigger>
          <TabsTrigger value="predictions">
            <TrendingUp className="w-3 h-3 mr-1" />
            Predictions
          </TabsTrigger>
          <TabsTrigger value="quality">
            <AlertCircle className="w-3 h-3 mr-1" />
            Data Quality
          </TabsTrigger>
          <TabsTrigger value="daily">
            <Plane className="w-3 h-3 mr-1" />
            Daily Trends
          </TabsTrigger>
        </TabsList>

        {/* Anomalies Tab */}
        <TabsContent value="anomalies" className="mt-4">
          <ScrollArea className="h-[400px]">
            {anomalies.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {isLoading ? "Analyzing flight patterns..." : "No anomalies detected"}
              </div>
            ) : (
              <div className="space-y-3">
                {anomalies.map((anomaly, i) => (
                  <Card key={i} className="border-destructive/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          {anomaly.date}
                        </CardTitle>
                        {getMultiplierBadge(anomaly.multiplier)}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-muted/50 p-2 rounded">
                          <p className="text-muted-foreground">Flight Count</p>
                          <p className="font-bold text-lg">{anomaly.flight_count}</p>
                        </div>
                        <div className="bg-muted/50 p-2 rounded">
                          <p className="text-muted-foreground">Baseline Avg</p>
                          <p className="font-bold text-lg">{anomaly.baseline_avg.toFixed(1)}</p>
                        </div>
                        <div className="bg-muted/50 p-2 rounded">
                          <p className="text-muted-foreground">Variance</p>
                          <p className="font-bold text-lg text-destructive">+{((anomaly.multiplier - 1) * 100).toFixed(0)}%</p>
                        </div>
                      </div>
                      {anomaly.top_aircraft && anomaly.top_aircraft.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">Top Aircraft:</p>
                          <div className="flex flex-wrap gap-1">
                            {anomaly.top_aircraft.slice(0, 5).map((ac, j) => (
                              <Badge key={j} variant="outline" className="text-xs">
                                {ac.registration} ({ac.count})
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* December 27th Deep Dive */}
        <TabsContent value="dec27" className="mt-4">
          {dec27Analysis ? (
            <div className="space-y-4">
              <Card className="border-destructive">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" />
                    December 27th Saturation Event Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <div className="bg-destructive/10 p-3 rounded border border-destructive/30">
                      <p className="text-xs text-muted-foreground">Total Flights</p>
                      <p className="text-2xl font-bold text-destructive">{dec27Analysis.totalFlights || 0}</p>
                    </div>
                    <div className="bg-muted/50 p-3 rounded">
                      <p className="text-xs text-muted-foreground">Unique Aircraft</p>
                      <p className="text-2xl font-bold">{dec27Analysis.uniqueAircraft || 0}</p>
                    </div>
                    <div className="bg-orange-500/10 p-3 rounded border border-orange-500/30">
                      <p className="text-xs text-muted-foreground">Low Altitude</p>
                      <p className="text-2xl font-bold text-orange-500">{dec27Analysis.lowAltitudeCount || 0}</p>
                    </div>
                    <div className="bg-primary/10 p-3 rounded">
                      <p className="text-xs text-muted-foreground">Flagged</p>
                      <p className="text-2xl font-bold text-primary">{dec27Analysis.flaggedCount || 0}</p>
                    </div>
                  </div>

                  {dec27Analysis.topAircraft && dec27Analysis.topAircraft.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Top Aircraft on Dec 27th</h4>
                      <ScrollArea className="h-[150px]">
                        <div className="space-y-1">
                          {dec27Analysis.topAircraft.map((ac: any, i: number) => (
                            <div key={i} className="flex items-center justify-between bg-muted/30 p-2 rounded text-sm">
                              <span className="font-mono">{ac.registration || ac.hex || 'Unknown'}</span>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">{ac.count} detections</Badge>
                                {ac.flagged && <Badge variant="destructive">Flagged</Badge>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}

                  {dec27Analysis.biometricCorrelations > 0 && (
                    <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded">
                      <p className="text-sm font-semibold text-purple-400">⚠️ Biometric Correlations Found</p>
                      <p className="text-xs text-muted-foreground">
                        {dec27Analysis.biometricCorrelations} biometric events correlated with flight activity on Dec 27th
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {isLoading ? "Analyzing December 27th data..." : "No December 27th data available"}
            </div>
          )}
        </TabsContent>

        {/* Predictions Tab */}
        <TabsContent value="predictions" className="mt-4">
          <ScrollArea className="h-[400px]">
            {predictions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {isLoading ? "Generating predictions..." : "No predictions available"}
              </div>
            ) : (
              <div className="space-y-3">
                <Card className="border-primary">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Next Predicted Saturation Event
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {predictions.map((pred, i) => (
                      <div key={i} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold">{pred.predicted_date}</span>
                          <Badge className={pred.probability > 0.7 ? "bg-destructive" : pred.probability > 0.4 ? "bg-orange-500" : "bg-yellow-500 text-black"}>
                            {(pred.probability * 100).toFixed(0)}% Probability
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <p className="font-semibold mb-1">Contributing Factors:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {pred.factors.map((factor, j) => (
                              <li key={j}>{factor}</li>
                            ))}
                          </ul>
                        </div>
                        <p className="text-xs italic text-muted-foreground">
                          Pattern: {pred.historical_pattern}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Data Quality Tab */}
        <TabsContent value="quality" className="mt-4">
          <ScrollArea className="h-[400px]">
            <div className="space-y-4">
              {dataQuality.map((issue, i) => (
                <Card key={i} className={issue.count > 100 ? "border-destructive/50" : "border-yellow-500/50"}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">{issue.issue_type}</CardTitle>
                      <Badge variant={issue.count > 100 ? "destructive" : "secondary"}>
                        {issue.count} records
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <p className="text-muted-foreground">{issue.recommendation}</p>
                    {issue.examples.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {issue.examples.slice(0, 5).map((ex, j) => (
                          <Badge key={j} variant="outline" className="font-mono">{ex}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {corruptedRegs.length > 0 && (
                <Card className="border-destructive">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      Corrupted Registrations (ISTRATION Pattern)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {corruptedRegs.map((reg, i) => (
                        <div key={i} className="flex items-center justify-between bg-muted/30 p-2 rounded text-xs">
                          <span className="font-mono text-destructive">{reg.registration}</span>
                          <div className="flex items-center gap-2">
                            <span>{reg.count} occurrences</span>
                            <span className="text-muted-foreground">
                              {reg.first_seen} - {reg.last_seen}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Daily Trends Tab */}
        <TabsContent value="daily" className="mt-4">
          <ScrollArea className="h-[400px]">
            {dailyData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {isLoading ? "Loading daily data..." : "No daily data available"}
              </div>
            ) : (
              <div className="space-y-2">
                {dailyData.slice(0, 30).map((day, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/30 p-2 rounded text-sm">
                    <span className="font-mono w-24">{day.date}</span>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{day.flight_count} flights</Badge>
                      <Badge variant="secondary">{day.unique_aircraft} aircraft</Badge>
                      {day.low_altitude_count > 0 && (
                        <Badge className="bg-orange-500">{day.low_altitude_count} low alt</Badge>
                      )}
                      {day.flagged_count > 0 && (
                        <Badge variant="destructive">{day.flagged_count} flagged</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

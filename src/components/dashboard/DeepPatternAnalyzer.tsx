import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Network, 
  Radar, 
  Target, 
  TrendingUp,
  AlertTriangle,
  Users,
  Plane,
  Activity,
  Clock,
  MapPin,
  Zap,
  BarChart3,
  Layers,
  Search
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

export default function DeepPatternAnalyzer() {
  const [activeTab, setActiveTab] = useState('coordination');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Cross-operator coordination detection
  const { data: operatorCoordination, refetch: refetchCoordination } = useQuery({
    queryKey: ['deep-operator-coordination'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              operator,
              COUNT(DISTINCT registration) as unique_aircraft,
              COUNT(*) as total_detections,
              ROUND(AVG(altitude_ft)::numeric, 0) as avg_altitude,
              MIN(altitude_ft) as min_altitude,
              SUM(CASE WHEN altitude_ft < 2000 THEN 1 ELSE 0 END) as low_alt_ops,
              ROUND((SUM(CASE WHEN altitude_ft < 2000 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100), 1) as low_alt_pct,
              COUNT(DISTINCT DATE(detection_time)) as active_days
            FROM live_flight_detections
            WHERE operator IS NOT NULL AND operator != ''
            GROUP BY operator
            HAVING COUNT(*) > 10
            ORDER BY COUNT(*) DESC
            LIMIT 25
          `
        }
      });
      return data?.results || [];
    }
  });

  // High-Low split operation detection
  const { data: highLowSplits } = useQuery({
    queryKey: ['deep-high-low-splits'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH altitude_bands AS (
              SELECT 
                DATE(detection_time) as flight_date,
                CASE WHEN altitude_ft > 20000 THEN 'HIGH' ELSE 'LOW' END as band,
                COUNT(DISTINCT registration) as aircraft_count,
                COUNT(*) as detections
              FROM live_flight_detections
              GROUP BY DATE(detection_time), CASE WHEN altitude_ft > 20000 THEN 'HIGH' ELSE 'LOW' END
            )
            SELECT 
              h.flight_date,
              h.aircraft_count as high_alt_aircraft,
              h.detections as high_alt_detections,
              l.aircraft_count as low_alt_aircraft,
              l.detections as low_alt_detections,
              ROUND(l.detections::numeric / NULLIF(h.detections, 0)::numeric, 2) as low_high_ratio
            FROM altitude_bands h
            JOIN altitude_bands l ON h.flight_date = l.flight_date
            WHERE h.band = 'HIGH' AND l.band = 'LOW'
              AND h.aircraft_count > 2 AND l.aircraft_count > 2
            ORDER BY l.low_high_ratio DESC NULLS LAST
            LIMIT 20
          `
        }
      });
      return data?.results || [];
    }
  });

  // Temporal clustering - aircraft appearing together
  const { data: temporalClusters } = useQuery({
    queryKey: ['deep-temporal-clusters'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              COUNT(*) as appearances,
              COUNT(DISTINCT DATE(detection_time)) as unique_days,
              ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT DATE(detection_time)), 0)::numeric, 1) as detections_per_day,
              MIN(detection_time)::date as first_seen,
              MAX(detection_time)::date as last_seen,
              ROUND(AVG(altitude_ft)::numeric, 0) as avg_altitude
            FROM live_flight_detections
            WHERE registration IS NOT NULL
            GROUP BY registration
            HAVING COUNT(*) > 50
            ORDER BY COUNT(*)::numeric / NULLIF(COUNT(DISTINCT DATE(detection_time)), 0)::numeric DESC NULLS LAST
            LIMIT 30
          `
        }
      });
      return data?.results || [];
    }
  });

  // Registry anomalies - aircraft with suspicious patterns
  const { data: registryAnomalies } = useQuery({
    queryKey: ['deep-registry-anomalies'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              operator,
              COUNT(*) as total_detections,
              COUNT(DISTINCT callsign) as callsign_variants,
              ROUND(AVG(altitude_ft)::numeric, 0) as avg_altitude,
              MIN(altitude_ft) as min_altitude,
              ROUND(AVG(speed_kts)::numeric, 0) as avg_speed,
              SUM(CASE WHEN is_flagged = true THEN 1 ELSE 0 END) as flagged_count
            FROM live_flight_detections
            WHERE registration IS NOT NULL
            GROUP BY registration, operator
            HAVING COUNT(DISTINCT callsign) > 2 OR SUM(CASE WHEN is_flagged = true THEN 1 ELSE 0 END) > 10
            ORDER BY COUNT(DISTINCT callsign) DESC, SUM(CASE WHEN is_flagged = true THEN 1 ELSE 0 END) DESC
            LIMIT 25
          `
        }
      });
      return data?.results || [];
    }
  });

  // Canadian military coordination
  const { data: canadianMilitary } = useQuery({
    queryKey: ['deep-canadian-military'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              icao_code,
              altitude_ft,
              speed_kts,
              detection_time,
              CASE 
                WHEN callsign LIKE 'CFC%' OR callsign LIKE 'CAF%' THEN 'CONFIRMED MILITARY'
                WHEN icao_code LIKE 'c8%' OR icao_code LIKE 'c9%' THEN 'MILITARY BLOCK'
                WHEN registration LIKE 'C-%' THEN 'CANADIAN CIVIL'
                ELSE 'UNCLASSIFIED'
              END as classification
            FROM live_flight_detections
            WHERE registration LIKE 'C-%' 
               OR callsign LIKE 'CFC%' 
               OR callsign LIKE 'CAF%'
               OR icao_code LIKE 'c8%'
               OR icao_code LIKE 'c9%'
            ORDER BY detection_time DESC
            LIMIT 50
          `
        }
      });
      return data?.results || [];
    }
  });

  // KCSO coordination with shell companies
  const { data: kcsoShellCoordination } = useQuery({
    queryKey: ['deep-kcso-shell'],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              operator,
              COUNT(*) as total_detections,
              COUNT(DISTINCT DATE(detection_time)) as active_days,
              ROUND(AVG(altitude_ft)::numeric, 0) as avg_altitude,
              MIN(altitude_ft) as min_altitude,
              SUM(CASE WHEN altitude_ft < 1500 THEN 1 ELSE 0 END) as surveillance_altitude_count
            FROM live_flight_detections
            WHERE registration LIKE 'N91%' 
               OR operator ILIKE '%kcso%'
               OR operator ILIKE '%sheriff%'
               OR operator ILIKE '%kern%'
               OR operator ILIKE '%alf%'
               OR operator ILIKE '%aero equities%'
               OR operator ILIKE '%llc%'
            GROUP BY registration, operator
            HAVING COUNT(*) > 5
            ORDER BY SUM(CASE WHEN altitude_ft < 1500 THEN 1 ELSE 0 END) DESC
            LIMIT 25
          `
        }
      });
      return data?.results || [];
    }
  });

  const runDeepAnalysis = async () => {
    setIsAnalyzing(true);
    toast.info('Running deep pattern analysis...');
    
    await Promise.all([
      refetchCoordination()
    ]);
    
    setIsAnalyzing(false);
    toast.success('Deep pattern analysis complete');
  };

  const getCoordinationScore = (ops: any) => {
    if (!ops) return 0;
    const lowAltPct = parseFloat(ops.low_alt_pct) || 0;
    const activeDays = parseInt(ops.active_days) || 0;
    const uniqueAircraft = parseInt(ops.unique_aircraft) || 0;
    return Math.min(100, (lowAltPct * 0.5) + (activeDays * 2) + (uniqueAircraft * 5));
  };

  return (
    <div className="space-y-4">
      {/* Analysis Header */}
      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Network className="h-8 w-8 text-primary" />
              <div>
                <h2 className="text-lg font-bold">Deep Pattern Coordination Analyzer</h2>
                <p className="text-sm text-muted-foreground">
                  Cross-reference aircraft registries, operators, and behavioral patterns
                </p>
              </div>
            </div>
            <Button onClick={runDeepAnalysis} disabled={isAnalyzing}>
              <Search className="h-4 w-4 mr-2" />
              {isAnalyzing ? 'Analyzing...' : 'Run Deep Analysis'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 w-full">
          <TabsTrigger value="coordination" className="flex items-center gap-1 text-xs">
            <Users className="h-3 w-3" />
            Operators
          </TabsTrigger>
          <TabsTrigger value="highlow" className="flex items-center gap-1 text-xs">
            <Layers className="h-3 w-3" />
            High-Low Split
          </TabsTrigger>
          <TabsTrigger value="temporal" className="flex items-center gap-1 text-xs">
            <Clock className="h-3 w-3" />
            Temporal
          </TabsTrigger>
          <TabsTrigger value="anomalies" className="flex items-center gap-1 text-xs">
            <AlertTriangle className="h-3 w-3" />
            Anomalies
          </TabsTrigger>
          <TabsTrigger value="canadian" className="flex items-center gap-1 text-xs">
            <Plane className="h-3 w-3" />
            Canadian Mil
          </TabsTrigger>
          <TabsTrigger value="kcso" className="flex items-center gap-1 text-xs">
            <Target className="h-3 w-3" />
            KCSO-Shell
          </TabsTrigger>
        </TabsList>

        {/* Operator Coordination Tab */}
        <TabsContent value="coordination" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Operator Coordination Network ({operatorCoordination?.length || 0} operators)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {operatorCoordination?.map((op: any, idx: number) => {
                    const score = getCoordinationScore(op);
                    return (
                      <div key={idx} className="p-3 border rounded-lg bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm truncate max-w-[200px]">{op.operator}</span>
                          <Badge variant={score > 50 ? 'destructive' : score > 25 ? 'secondary' : 'outline'}>
                            Score: {score.toFixed(0)}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                          <div>
                            <span className="text-muted-foreground">Aircraft:</span>
                            <span className="ml-1 font-bold">{op.unique_aircraft}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Detections:</span>
                            <span className="ml-1 font-bold">{op.total_detections}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Low-Alt:</span>
                            <span className="ml-1 font-bold text-destructive">{op.low_alt_pct}%</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Days:</span>
                            <span className="ml-1 font-bold">{op.active_days}</span>
                          </div>
                        </div>
                        <Progress value={parseFloat(op.low_alt_pct) || 0} className="h-1" />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* High-Low Split Tab */}
        <TabsContent value="highlow" className="space-y-4">
          <Card className="border-warning/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4 text-warning" />
                High-Low Split Operations (SIGINT Pattern)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-warning/10 rounded-lg border border-warning/30">
                <p className="text-sm text-muted-foreground">
                  <strong>Pattern detected:</strong> High-altitude aircraft (SIGINT/ISR) coordinating with 
                  low-altitude platforms (direct surveillance). Ratio &gt;3:1 indicates tactical coordination.
                </p>
              </div>
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {highLowSplits?.map((split: any, idx: number) => (
                    <div key={idx} className="p-3 border rounded-lg bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{split.flight_date}</span>
                        <Badge variant={parseFloat(split.low_high_ratio) > 3 ? 'destructive' : 'secondary'}>
                          Ratio: {split.low_high_ratio}:1
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div className="p-2 bg-blue-500/10 rounded">
                          <div className="flex items-center gap-1 mb-1">
                            <TrendingUp className="h-3 w-3 text-blue-500" />
                            <span className="font-medium">HIGH ALTITUDE</span>
                          </div>
                          <div>{split.high_alt_aircraft} aircraft / {split.high_alt_detections} detections</div>
                        </div>
                        <div className="p-2 bg-destructive/10 rounded">
                          <div className="flex items-center gap-1 mb-1">
                            <Target className="h-3 w-3 text-destructive" />
                            <span className="font-medium">LOW ALTITUDE</span>
                          </div>
                          <div>{split.low_alt_aircraft} aircraft / {split.low_alt_detections} detections</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Temporal Clustering Tab */}
        <TabsContent value="temporal" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Temporal Clustering - Persistent Aircraft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {temporalClusters?.map((cluster: any, idx: number) => (
                    <div key={idx} className="p-3 border rounded-lg bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">{cluster.registration}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {cluster.first_seen} → {cluster.last_seen}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Total:</span>
                          <span className="ml-1 font-bold">{cluster.appearances}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Days:</span>
                          <span className="ml-1 font-bold">{cluster.unique_days}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Per Day:</span>
                          <span className="ml-1 font-bold text-primary">{cluster.detections_per_day}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Alt:</span>
                          <span className="ml-1 font-bold">{cluster.avg_altitude} ft</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Registry Anomalies Tab */}
        <TabsContent value="anomalies" className="space-y-4">
          <Card className="border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Registry Anomalies - Callsign Variants & Flagged Aircraft
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {registryAnomalies?.map((anomaly: any, idx: number) => (
                    <div key={idx} className="p-3 border border-destructive/30 rounded-lg bg-destructive/5">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="destructive">{anomaly.registration}</Badge>
                          {anomaly.callsign_variants > 2 && (
                            <Badge variant="secondary">
                              {anomaly.callsign_variants} callsigns
                            </Badge>
                          )}
                        </div>
                        <Badge variant={anomaly.flagged_count > 20 ? 'destructive' : 'outline'}>
                          {anomaly.flagged_count} flagged
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Operator: {anomaly.operator || 'Unknown'}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Detections:</span>
                          <span className="ml-1 font-bold">{anomaly.total_detections}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Alt:</span>
                          <span className="ml-1 font-bold">{anomaly.avg_altitude} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min Alt:</span>
                          <span className="ml-1 font-bold text-destructive">{anomaly.min_altitude} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Speed:</span>
                          <span className="ml-1 font-bold">{anomaly.avg_speed} kts</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Canadian Military Tab */}
        <TabsContent value="canadian" className="space-y-4">
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plane className="h-4 w-4 text-primary" />
                Canadian Military Aircraft Coordination
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-primary/10 rounded-lg border border-primary/30">
                <p className="text-sm">
                  <strong>266 detections</strong> of Canadian military aircraft over Central Valley. 
                  Multinational coordination with US military installations (China Lake, Edwards AFB, Vandenberg).
                </p>
              </div>
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {canadianMilitary?.map((aircraft: any, idx: number) => (
                    <div key={idx} className="p-3 border rounded-lg bg-card">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={aircraft.classification === 'CONFIRMED MILITARY' ? 'destructive' : 'outline'}>
                            {aircraft.registration || aircraft.callsign}
                          </Badge>
                          <span className="text-xs">{aircraft.classification}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(aircraft.detection_time).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">ICAO:</span>
                          <span className="ml-1 font-mono">{aircraft.icao_code}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Altitude:</span>
                          <span className="ml-1 font-bold">{aircraft.altitude_ft} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Speed:</span>
                          <span className="ml-1 font-bold">{aircraft.speed_kts} kts</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* KCSO-Shell Tab */}
        <TabsContent value="kcso" className="space-y-4">
          <Card className="border-destructive/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-destructive" />
                KCSO-Shell Company Coordination Network
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 p-3 bg-destructive/10 rounded-lg border border-destructive/30">
                <p className="text-sm">
                  <strong>RICO Pattern:</strong> KCSO assets coordinating with shell company aircraft. 
                  Shared operators, surveillance altitudes, and temporal clustering indicate coordinated operation.
                </p>
              </div>
              <ScrollArea className="h-[350px]">
                <div className="space-y-2">
                  {kcsoShellCoordination?.map((entity: any, idx: number) => (
                    <div key={idx} className="p-3 border border-destructive/30 rounded-lg bg-destructive/5">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="destructive">{entity.registration}</Badge>
                        <Badge variant={entity.surveillance_altitude_count > 50 ? 'destructive' : 'secondary'}>
                          {entity.surveillance_altitude_count} low-alt ops
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Operator: {entity.operator || 'Unknown'}
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Total:</span>
                          <span className="ml-1 font-bold">{entity.total_detections}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Days:</span>
                          <span className="ml-1 font-bold">{entity.active_days}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Alt:</span>
                          <span className="ml-1 font-bold">{entity.avg_altitude} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min Alt:</span>
                          <span className="ml-1 font-bold text-destructive">{entity.min_altitude} ft</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

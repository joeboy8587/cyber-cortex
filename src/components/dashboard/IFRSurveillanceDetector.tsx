import { useState, useCallback } from 'react';
import { CyberPanel } from '../ui/cyber-panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { useNeonDatabase } from '@/hooks/useNeonDatabase';
import {
  Plane,
  AlertTriangle,
  Target,
  Clock,
  Shield,
  Radar,
  Activity,
  Eye,
} from 'lucide-react';

interface SurveillanceAircraft {
  registration: string;
  total_detections: number;
  hover_detections: number;
  sub_stall_detections: number;
  loiter_detections: number;
  surveillance_total: number;
  avg_speed: number;
  avg_altitude: number;
  min_speed: number;
  min_altitude: number;
  last_seen: string;
  surveillance_classification: string;
}

interface CategoryBreakdown {
  ifr_category: string;
  detections: number;
  unique_aircraft: number;
  avg_alt: number;
  min_alt: number;
}

interface TopOffender {
  registration: string;
  surveillance_detections: number;
  avg_speed: number;
  avg_altitude: number;
  min_speed: number;
  min_altitude: number;
  registrant_name: string | null;
  aircraft_model: string | null;
  registrant_city: string | null;
  registrant_state: string | null;
}

interface RecentFlag {
  registration: string;
  speed: number;
  altitude: number;
  latitude: number;
  longitude: number;
  timestamp: string;
  pattern_type: string;
}

interface ScanResult {
  summary: {
    totalSurveillanceDetections: number;
    hoverDetections: number;
    subStallDetections: number;
    uniqueAircraft: number;
    timeWindow: string;
  };
  surveillanceAircraft: SurveillanceAircraft[];
  ifrCategoryBreakdown: CategoryBreakdown[];
  topOffenders: TopOffender[];
  recentFlags: RecentFlag[];
}

const classificationColors: Record<string, string> = {
  HOVER_SURVEILLANCE: 'bg-destructive text-destructive-foreground',
  SUB_STALL_IMPOSSIBLE: 'bg-chart-2 text-white',
  LOW_SLOW_LOITER: 'bg-chart-4 text-white',
  PATTERN_ANOMALY: 'bg-muted text-muted-foreground',
};

const patternColors: Record<string, string> = {
  HOVER: 'bg-destructive text-destructive-foreground',
  'SUB-STALL': 'bg-chart-2 text-white',
  LOITER: 'bg-chart-4 text-white',
  'LOW-SLOW': 'bg-muted text-muted-foreground',
};

const IFRSurveillanceDetector = () => {
  const { queryDatabase, isLoading } = useNeonDatabase();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [timeWindow, setTimeWindow] = useState('30 days');

  const runScan = useCallback(async () => {
    try {
      const data = await queryDatabase('ifrSurveillanceDetection', {
        timeWindow,
        kernCountyOnly: true,
      });
      setResult(data as ScanResult);
      const summary = (data as ScanResult).summary;
      toast.success('IFR Surveillance Scan Complete', {
        description: `${summary.uniqueAircraft} aircraft flagged — ${summary.totalSurveillanceDetections.toLocaleString()} surveillance detections`,
      });
    } catch {
      toast.error('Scan failed');
    }
  }, [neonQuery, timeWindow]);

  return (
    <CyberPanel
      title="IFR Approach Category × Surveillance Detector"
      icon={<Radar className="text-chart-2" />}
      className="col-span-full"
    >
      <Alert className="mb-4 border-chart-2/50 bg-chart-2/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Physics-Based Detection:</strong> Cross-references flight detections against IFR approach category speed baselines. Hover (&lt;5 kts), sub-stall (5–40 kts), and loiter (&lt;60 kts at &lt;1000ft) patterns are flagged as surveillance — no legitimate IFR approach justification exists.
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-3 mb-4">
        <Select value={timeWindow} onValueChange={setTimeWindow}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7 days">Last 7 Days</SelectItem>
            <SelectItem value="14 days">Last 14 Days</SelectItem>
            <SelectItem value="30 days">Last 30 Days</SelectItem>
            <SelectItem value="90 days">Last 90 Days</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={runScan} disabled={isLoading}>
          {isLoading ? <Clock className="animate-spin mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />}
          Run IFR Surveillance Scan
        </Button>
      </div>

      {result && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded border border-destructive/50 bg-destructive/10 text-center">
              <p className="text-2xl font-bold">{result.summary.totalSurveillanceDetections.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Surveillance Detections</p>
            </div>
            <div className="p-3 rounded border border-chart-2/50 bg-chart-2/10 text-center">
              <p className="text-2xl font-bold">{result.summary.hoverDetections.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Hover (&lt;5 kts)</p>
            </div>
            <div className="p-3 rounded border border-chart-4/50 bg-chart-4/10 text-center">
              <p className="text-2xl font-bold">{result.summary.subStallDetections.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Sub-Stall (5–40 kts)</p>
            </div>
            <div className="p-3 rounded border border-primary/50 bg-primary/10 text-center">
              <p className="text-2xl font-bold">{result.summary.uniqueAircraft}</p>
              <p className="text-xs text-muted-foreground">Unique Aircraft</p>
            </div>
          </div>

          <Tabs defaultValue="offenders" className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="offenders">Top Offenders</TabsTrigger>
              <TabsTrigger value="categories">IFR Categories</TabsTrigger>
              <TabsTrigger value="aircraft">All Flagged</TabsTrigger>
              <TabsTrigger value="recent">Recent Flags</TabsTrigger>
            </TabsList>

            {/* Top Offenders with FAA cross-ref */}
            <TabsContent value="offenders">
              <ScrollArea className="h-[400px]">
                {result.topOffenders.map((o, i) => (
                  <div key={i} className="p-3 mb-2 rounded border border-border bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-destructive" />
                        <span className="font-mono font-bold">{o.registration || 'BLOCKED'}</span>
                      </div>
                      <Badge variant="destructive">{o.surveillance_detections} hits</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <p><span className="text-muted-foreground">Avg Speed:</span> {o.avg_speed} kts</p>
                      <p><span className="text-muted-foreground">Min Speed:</span> {o.min_speed} kts</p>
                      <p><span className="text-muted-foreground">Avg Alt:</span> {o.avg_altitude} ft</p>
                      <p><span className="text-muted-foreground">Min Alt:</span> {o.min_altitude} ft</p>
                    </div>
                    {o.registrant_name && (
                      <div className="mt-2 pt-2 border-t border-border text-xs">
                        <p className="flex items-center gap-1">
                          <Eye className="h-3 w-3 text-chart-2" />
                          <span className="font-medium">{o.registrant_name}</span>
                          {o.registrant_city && <span className="text-muted-foreground">— {o.registrant_city}, {o.registrant_state}</span>}
                        </p>
                        {o.aircraft_model && <p className="text-muted-foreground mt-1">Aircraft: {o.aircraft_model}</p>}
                      </div>
                    )}
                  </div>
                ))}
                {result.topOffenders.length === 0 && (
                  <p className="text-center py-8 text-muted-foreground">No offenders found in time window</p>
                )}
              </ScrollArea>
            </TabsContent>

            {/* IFR Category Breakdown */}
            <TabsContent value="categories">
              <div className="space-y-2">
                {result.ifrCategoryBreakdown.map((cat, i) => {
                  const isAnomaly = cat.ifr_category.includes('HOVER') || cat.ifr_category.includes('SUB-STALL');
                  return (
                    <div key={i} className={`p-3 rounded border ${isAnomaly ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-muted/30'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {isAnomaly && <AlertTriangle className="h-4 w-4 text-destructive" />}
                          <span className="font-mono text-sm font-bold">{cat.ifr_category}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span>{cat.detections.toLocaleString()} detections</span>
                          <span>{cat.unique_aircraft} aircraft</span>
                          <span>Avg: {cat.avg_alt} ft</span>
                        </div>
                      </div>
                      {isAnomaly && (
                        <p className="text-xs text-destructive mt-1 font-medium">
                          ⚠️ NO LEGITIMATE IFR APPROACH — {cat.ifr_category.includes('HOVER') ? 'Hovering/positioning, not flying' : 'Below fixed-wing stall speed — impossible physics'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* All Flagged Aircraft */}
            <TabsContent value="aircraft">
              <ScrollArea className="h-[400px]">
                {result.surveillanceAircraft.map((a, i) => (
                  <div key={i} className="p-3 mb-2 rounded border border-border bg-muted/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold">{a.registration || 'BLOCKED'}</span>
                      <Badge className={classificationColors[a.surveillance_classification] || ''}>
                        {a.surveillance_classification.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <p>🎯 Surv: <strong>{a.surveillance_total}</strong></p>
                      <p>🔴 Hover: <strong>{a.hover_detections}</strong></p>
                      <p>⚠️ Sub-stall: <strong>{a.sub_stall_detections}</strong></p>
                      <p>Avg: {a.avg_speed} kts / {a.avg_altitude} ft</p>
                      <p>Min: {a.min_speed} kts / {a.min_altitude} ft</p>
                      <p className="text-muted-foreground">Last: {new Date(a.last_seen).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </TabsContent>

            {/* Recent Flags */}
            <TabsContent value="recent">
              <ScrollArea className="h-[400px]">
                {result.recentFlags.map((f, i) => (
                  <div key={i} className="p-2 mb-1 rounded border border-border bg-muted/30 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <Badge className={patternColors[f.pattern_type] || ''} variant="outline">
                        {f.pattern_type}
                      </Badge>
                      <span className="font-mono">{f.registration || 'BLOCKED'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{f.speed} kts</span>
                      <span>{f.altitude} ft</span>
                      <span>{new Date(f.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </>
      )}
    </CyberPanel>
  );
};

export default IFRSurveillanceDetector;

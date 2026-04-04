import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { extractNeonData } from '@/lib/formatters';
import { 
  Plane, RefreshCw, Target, Clock, 
  AlertTriangle, Eye, Calendar, TrendingUp, ArrowUpDown
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CommercialFlight {
  registration: string;
  callsign: string;
  carrier: string;
  detections: number;
  avg_altitude: number;
  min_altitude: number;
  first_seen: string;
  last_seen: string;
  is_low_altitude: boolean;
}

interface TemporalPattern {
  hour: number;
  count: number;
  percentage: number;
}

interface CarrierSummary {
  carrier: string;
  flights: number;
  total_detections: number;
  avg_altitude: number;
  low_alt_count: number;
}

const CARRIER_MAP: Record<string, string> = {
  ASA: 'Alaska Airlines', QXE: 'Horizon Air', SKW: 'SkyWest', AAL: 'American',
  UAL: 'United', DAL: 'Delta', SWA: 'Southwest', FFT: 'Frontier',
  JBU: 'JetBlue', NKS: 'Spirit', HAL: 'Hawaiian', SCX: 'Sun Country',
  RPA: 'Republic', ENY: 'Envoy', PDT: 'Piedmont', PSA: 'PSA Airlines',
  JIA: 'PSA Airlines', CPZ: 'Compass', MES: 'Mesa', GJS: 'GoJet',
  TCF: 'Shuttle America', EDV: 'Endeavor', FDX: 'FedEx', UPS: 'UPS',
  GTI: 'Atlas Air', ABX: 'ABX Air',
};

function getCarrier(callsign: string): string {
  const prefix = callsign?.substring(0, 3) || '';
  return CARRIER_MAP[prefix] || prefix || 'Unknown';
}

export const AlaskaAirlinesDashboard = () => {
  const [flights, setFlights] = useState<CommercialFlight[]>([]);
  const [temporalPattern, setTemporalPattern] = useState<TemporalPattern[]>([]);
  const [carrierSummary, setCarrierSummary] = useState<CarrierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalDetections, setTotalDetections] = useState(0);
  const [lowAltCount, setLowAltCount] = useState(0);
  const [peakHour, setPeakHour] = useState(19);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // All commercial aircraft over Oildale grid
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              COUNT(*) as detections,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(COALESCE(altitude, 0)) as min_altitude,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE 
              latitude BETWEEN 35.25 AND 35.55
              AND longitude BETWEEN -119.25 AND -118.85
              AND callsign IS NOT NULL AND callsign != ''
              AND registration IS NOT NULL AND registration != ''
              AND (
                callsign ~ '^[A-Z]{3}[0-9]'
              )
            GROUP BY registration, callsign
            HAVING COUNT(*) >= 2
            ORDER BY detections DESC
            LIMIT 200
          `
        }
      });

      if (error) throw error;
      const rawData = extractNeonData(data);

      const processed: CommercialFlight[] = rawData.map((row: Record<string, unknown>) => {
        const cs = (row.callsign as string) || '';
        const minAlt = parseFloat(row.min_altitude as string) || 0;
        return {
          registration: (row.registration as string) || 'N/A',
          callsign: cs,
          carrier: getCarrier(cs),
          detections: parseInt(row.detections as string) || 0,
          avg_altitude: parseFloat(row.avg_altitude as string) || 0,
          min_altitude: minAlt,
          first_seen: (row.first_seen as string) || '',
          last_seen: (row.last_seen as string) || '',
          is_low_altitude: minAlt < 1500 && minAlt > 0,
        };
      });

      setFlights(processed);
      setTotalDetections(processed.reduce((s, f) => s + f.detections, 0));
      setLowAltCount(processed.filter(f => f.is_low_altitude).length);

      // Carrier summary
      const byCarrier: Record<string, CarrierSummary> = {};
      processed.forEach(f => {
        if (!byCarrier[f.carrier]) {
          byCarrier[f.carrier] = { carrier: f.carrier, flights: 0, total_detections: 0, avg_altitude: 0, low_alt_count: 0 };
        }
        byCarrier[f.carrier].flights++;
        byCarrier[f.carrier].total_detections += f.detections;
        byCarrier[f.carrier].avg_altitude += f.avg_altitude;
        if (f.is_low_altitude) byCarrier[f.carrier].low_alt_count++;
      });
      const carriers = Object.values(byCarrier)
        .map(c => ({ ...c, avg_altitude: Math.round(c.avg_altitude / c.flights) }))
        .sort((a, b) => b.total_detections - a.total_detections);
      setCarrierSummary(carriers);

      // Temporal pattern over Oildale grid
      const { data: temporalData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              EXTRACT(HOUR FROM detection_timestamp) as hour,
              COUNT(*) as count
            FROM live_flight_detections_rows
            WHERE latitude BETWEEN 35.25 AND 35.55
              AND longitude BETWEEN -119.25 AND -118.85
              AND callsign ~ '^[A-Z]{3}[0-9]'
            GROUP BY EXTRACT(HOUR FROM detection_timestamp)
            ORDER BY hour
          `
        }
      });

      const temporalRaw = extractNeonData(temporalData);
      const totalT = temporalRaw.reduce((s: number, r: any) => s + parseInt(r.count || '0'), 0);
      const tp: TemporalPattern[] = temporalRaw.map((r: any) => ({
        hour: parseInt(r.hour),
        count: parseInt(r.count),
        percentage: totalT > 0 ? (parseInt(r.count) / totalT) * 100 : 0
      }));
      setTemporalPattern(tp);
      if (tp.length > 0) setPeakHour(tp.reduce((m, t) => t.count > m.count ? t : m, tp[0]).hour);

    } catch (err) {
      console.error('Error fetching commercial data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const formatHour = (hour: number) => {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return `${hour % 12 || 12}${suffix}`;
  };

  return (
    <CyberPanel 
      title="COMMERCIAL AIRCRAFT — OILDALE GRID" 
      icon={<Plane className="h-5 w-5 text-cyan-400" />}
      className="col-span-2"
    >
      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Target className="h-5 w-5 text-cyan-400" />
          <span className="font-bold text-cyan-400">ALL COMMERCIAL TRAFFIC — OILDALE SECTOR</span>
        </div>
        <p className="text-sm text-foreground/80">
          Monitoring <strong>all</strong> commercial carriers over the Oildale grid (35.25–35.55°N / 119.25–118.85°W).
          Includes Alaska, United, American, Delta, Southwest, SkyWest, Horizon, Frontier, cargo, and all ICAO-prefixed callsigns.
          Low-altitude events (&lt;1,500 ft) flagged automatically.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        <div className="bg-background/50 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{totalDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{flights.length}</div>
          <div className="text-xs text-muted-foreground">Unique Flights</div>
        </div>
        <div className="bg-background/50 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-yellow-400">{carrierSummary.length}</div>
          <div className="text-xs text-muted-foreground">Carriers</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{lowAltCount}</div>
          <div className="text-xs text-muted-foreground">Low-Alt Events</div>
        </div>
        <div className="bg-background/50 border border-purple-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-purple-400">{formatHour(peakHour)}</div>
          <div className="text-xs text-muted-foreground">Peak Hour</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="carriers" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="carriers">By Carrier</TabsTrigger>
          <TabsTrigger value="flights">All Flights</TabsTrigger>
          <TabsTrigger value="temporal">Hourly</TabsTrigger>
        </TabsList>

        {/* Carrier breakdown */}
        <TabsContent value="carriers">
          <ScrollArea className="h-[380px]">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />Scanning Oildale grid...
              </div>
            ) : (
              <div className="space-y-2">
                {carrierSummary.map(c => (
                  <div key={c.carrier} className="p-3 rounded-lg border border-border/30 bg-background/30 hover:border-cyan-500/50 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold text-primary">{c.carrier}</span>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          <Plane className="h-3 w-3 mr-1" />{c.flights} flights
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs">
                          <Eye className="h-3 w-3 mr-1" />{c.total_detections.toLocaleString()}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span><ArrowUpDown className="h-3 w-3 inline mr-1" />{c.avg_altitude.toLocaleString()}ft avg</span>
                      {c.low_alt_count > 0 && (
                        <span className="text-red-400">
                          <AlertTriangle className="h-3 w-3 inline mr-1" />{c.low_alt_count} low-alt
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* All flights */}
        <TabsContent value="flights">
          <ScrollArea className="h-[380px]">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />Loading...
              </div>
            ) : (
              <div className="space-y-2">
                {flights.map((f, i) => (
                  <div key={`${f.callsign}-${i}`}
                    className={`p-3 rounded-lg border ${f.is_low_altitude ? 'border-red-500/40 bg-red-500/10' : 'border-border/30 bg-background/30'} hover:border-cyan-500/50 transition-colors`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {f.is_low_altitude && <AlertTriangle className="h-4 w-4 text-red-400" />}
                        <span className="font-mono font-bold text-primary">{f.callsign}</span>
                        <span className="font-mono text-muted-foreground text-sm">{f.registration}</span>
                        <Badge variant="secondary" className="text-xs">{f.carrier}</Badge>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        <Eye className="h-3 w-3 mr-1" />{f.detections}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className={f.is_low_altitude ? 'text-red-400' : ''}>
                        <ArrowUpDown className="h-3 w-3 inline mr-1" />
                        {f.avg_altitude}ft avg / {f.min_altitude}ft min
                      </span>
                      <span>
                        <Calendar className="h-3 w-3 inline mr-1" />
                        {f.first_seen && new Date(f.first_seen).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Temporal */}
        <TabsContent value="temporal">
          <div className="space-y-1 h-[380px] overflow-auto">
            {temporalPattern.map(t => (
              <div key={t.hour} className="flex items-center gap-2">
                <span className={`w-12 text-xs font-mono ${t.hour === peakHour ? 'text-purple-400 font-bold' : 'text-muted-foreground'}`}>
                  {formatHour(t.hour)}
                </span>
                <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden">
                  <div 
                    className={`h-full ${t.hour === peakHour ? 'bg-purple-500' : 'bg-cyan-500/50'} transition-all`}
                    style={{ width: `${Math.min(100, t.percentage * 3)}%` }}
                  />
                </div>
                <span className="w-16 text-xs text-right text-muted-foreground">{t.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-4 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-sm font-medium text-cyan-400 mb-2">
          <TrendingUp className="h-4 w-4" />
          Oildale Grid Analysis
        </div>
        <div className="text-xs text-foreground/70 space-y-1">
          <p>• <strong>Full Commercial Sweep:</strong> All ICAO-prefixed callsigns within the Oildale bounding box</p>
          <p>• <strong>Low-Altitude Flag:</strong> Any commercial aircraft below 1,500ft over residential Oildale</p>
          <p>• <strong>Carrier Breakdown:</strong> Identifies which airlines have the highest presence in the sector</p>
          <p>• <strong>Temporal Clustering:</strong> Detects coordinated convergence windows across all carriers</p>
        </div>
      </div>
    </CyberPanel>
  );
};

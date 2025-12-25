import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plane, RefreshCw, Target, Clock, MapPin, 
  AlertTriangle, Eye, Calendar, TrendingUp, ArrowUpDown
} from 'lucide-react';

interface AlaskaFlight {
  registration: string;
  callsign: string;
  flight_number: string;
  detections: number;
  avg_altitude: number;
  min_altitude: number;
  first_seen: string;
  last_seen: string;
  is_target: boolean;
}

interface TemporalPattern {
  hour: number;
  count: number;
  percentage: number;
}

interface AlaskaStats {
  totalDetections: number;
  targetSightings: number;
  uniqueFlights: number;
  avgAltitude: number;
  lowAltitudeEvents: number;
  peakHour: number;
}

export const AlaskaAirlinesDashboard = () => {
  const [flights, setFlights] = useState<AlaskaFlight[]>([]);
  const [temporalPattern, setTemporalPattern] = useState<TemporalPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AlaskaStats>({
    totalDetections: 0,
    targetSightings: 0,
    uniqueFlights: 0,
    avgAltitude: 0,
    lowAltitudeEvents: 0,
    peakHour: 19 // 7 PM
  });

  // Target callsigns from investigation
  const TARGET_CALLSIGNS = ['ASA1310', 'ASA559', 'ASA711', 'QXE2456', 'SKW3307'];

  const fetchAlaskaData = useCallback(async () => {
    setLoading(true);
    try {
      // Query for Alaska Airlines and associated carriers
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              COALESCE(
                CASE 
                  WHEN callsign LIKE 'ASA%' THEN 'AS' || SUBSTRING(callsign FROM 4)
                  WHEN callsign LIKE 'QXE%' THEN 'QX' || SUBSTRING(callsign FROM 4)
                  WHEN callsign LIKE 'SKW%' THEN 'OO' || SUBSTRING(callsign FROM 4)
                  ELSE callsign
                END, 
                callsign
              ) as flight_number,
              COUNT(*) as detections,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(COALESCE(altitude, 0)) as min_altitude,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE 
              callsign LIKE 'ASA%' OR 
              callsign LIKE 'QXE%' OR 
              callsign LIKE 'SKW%' OR
              registration LIKE 'N4%' OR
              registration LIKE 'N6%'
            GROUP BY registration, callsign
            ORDER BY detections DESC
            LIMIT 100
          `
        }
      });

      if (error) throw error;

      const rawData = data?.data || [];
      
      // Process flights
      const processed: AlaskaFlight[] = rawData.map((row: Record<string, unknown>) => {
        const callsign = (row.callsign as string) || '';
        return {
          registration: (row.registration as string) || 'N/A',
          callsign,
          flight_number: (row.flight_number as string) || callsign,
          detections: parseInt(row.detections as string) || 0,
          avg_altitude: parseFloat(row.avg_altitude as string) || 0,
          min_altitude: parseFloat(row.min_altitude as string) || 0,
          first_seen: (row.first_seen as string) || '',
          last_seen: (row.last_seen as string) || '',
          is_target: TARGET_CALLSIGNS.includes(callsign)
        };
      });

      setFlights(processed);

      // Query temporal pattern
      const { data: temporalData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              EXTRACT(HOUR FROM detection_timestamp) as hour,
              COUNT(*) as count
            FROM live_flight_detections_rows
            WHERE callsign LIKE 'ASA%' OR callsign LIKE 'QXE%' OR callsign LIKE 'SKW%'
            GROUP BY EXTRACT(HOUR FROM detection_timestamp)
            ORDER BY hour
          `
        }
      });

      const temporalRaw = temporalData?.data || [];
      const totalTemporal = temporalRaw.reduce((sum: number, r: { count: string }) => 
        sum + parseInt(r.count || '0'), 0);
      
      const temporalProcessed: TemporalPattern[] = temporalRaw.map((r: { hour: string; count: string }) => ({
        hour: parseInt(r.hour),
        count: parseInt(r.count),
        percentage: totalTemporal > 0 ? (parseInt(r.count) / totalTemporal) * 100 : 0
      }));

      setTemporalPattern(temporalProcessed);

      // Calculate stats
      const totalDet = processed.reduce((sum, f) => sum + f.detections, 0);
      const targetSightings = processed.filter(f => f.is_target).reduce((sum, f) => sum + f.detections, 0);
      const avgAlt = processed.length > 0 
        ? processed.reduce((sum, f) => sum + f.avg_altitude, 0) / processed.length 
        : 0;
      const lowAlt = processed.filter(f => f.min_altitude < 1500).length;
      const peakHour = temporalProcessed.length > 0 
        ? temporalProcessed.reduce((max, t) => t.count > max.count ? t : max, temporalProcessed[0]).hour
        : 19;

      setStats({
        totalDetections: totalDet,
        targetSightings,
        uniqueFlights: processed.length,
        avgAltitude: Math.round(avgAlt),
        lowAltitudeEvents: lowAlt,
        peakHour
      });

    } catch (err) {
      console.error('Error fetching Alaska data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlaskaData();
  }, [fetchAlaskaData]);

  const formatHour = (hour: number) => {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}${suffix}`;
  };

  return (
    <CyberPanel 
      title="ALASKA AIRLINES INVESTIGATION" 
      icon={<Target className="h-5 w-5 text-cyan-400" />}
      className="col-span-2"
    >
      {/* Investigation Alert */}
      <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Target className="h-5 w-5 text-cyan-400" />
          <span className="font-bold text-cyan-400">TARGET AIRCRAFT TRACKING</span>
        </div>
        <p className="text-sm text-foreground/80">
          Monitoring Alaska Airlines and regional partners (Horizon Air QXE, SkyWest SKW) for 
          coordinated surveillance patterns. Target callsigns: ASA1310, ASA559, ASA711, QXE2456, SKW3307.
          Primary temporal pattern: 7:28 PM convergence. Low-altitude operations flagged at 1,067ft.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        <div className="bg-background/50 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{stats.totalDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{stats.targetSightings}</div>
          <div className="text-xs text-muted-foreground">Target Sightings</div>
        </div>
        <div className="bg-background/50 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{stats.uniqueFlights}</div>
          <div className="text-xs text-muted-foreground">Unique Flights</div>
        </div>
        <div className="bg-background/50 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-yellow-400">{stats.avgAltitude.toLocaleString()}ft</div>
          <div className="text-xs text-muted-foreground">Avg Altitude</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{stats.lowAltitudeEvents}</div>
          <div className="text-xs text-muted-foreground">Low-Alt Events</div>
        </div>
        <div className="bg-background/50 border border-purple-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-purple-400">{formatHour(stats.peakHour)}</div>
          <div className="text-xs text-muted-foreground">Peak Hour</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchAlaskaData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {TARGET_CALLSIGNS.map(cs => (
          <Badge key={cs} variant="outline" className="font-mono text-xs bg-red-500/10 border-red-500/30 text-red-400">
            <Target className="h-3 w-3 mr-1" />
            {cs}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Flight List */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Plane className="h-4 w-4 text-cyan-400" />
            Alaska/Regional Flights
          </div>
          <ScrollArea className="h-[350px]">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />
                Scanning Alaska operations...
              </div>
            ) : (
              <div className="space-y-2">
                {flights.map((flight, idx) => (
                  <div 
                    key={`${flight.callsign}-${idx}`}
                    className={`p-3 rounded-lg border ${
                      flight.is_target 
                        ? 'border-red-500/40 bg-red-500/10' 
                        : 'border-border/30 bg-background/30'
                    } hover:border-cyan-500/50 transition-colors`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        {flight.is_target && <Target className="h-4 w-4 text-red-400" />}
                        <span className="font-mono font-bold text-primary">{flight.callsign}</span>
                        <span className="font-mono text-muted-foreground text-sm">{flight.registration}</span>
                      </div>
                      <Badge variant="outline" className="font-mono">
                        <Eye className="h-3 w-3 mr-1" />
                        {flight.detections}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className={flight.min_altitude < 1500 ? 'text-red-400' : ''}>
                        <ArrowUpDown className="h-3 w-3 inline mr-1" />
                        {flight.avg_altitude}ft avg / {flight.min_altitude}ft min
                      </span>
                      <span>
                        <Calendar className="h-3 w-3 inline mr-1" />
                        {flight.first_seen && new Date(flight.first_seen).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Temporal Pattern */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Clock className="h-4 w-4 text-purple-400" />
            Hourly Distribution
          </div>
          <div className="space-y-1 h-[350px] overflow-auto">
            {temporalPattern.map((t) => (
              <div key={t.hour} className="flex items-center gap-2">
                <span className={`w-12 text-xs font-mono ${t.hour === stats.peakHour ? 'text-purple-400 font-bold' : 'text-muted-foreground'}`}>
                  {formatHour(t.hour)}
                </span>
                <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden">
                  <div 
                    className={`h-full ${t.hour === 19 ? 'bg-purple-500' : 'bg-cyan-500/50'} transition-all`}
                    style={{ width: `${Math.min(100, t.percentage * 3)}%` }}
                  />
                </div>
                <span className="w-12 text-xs text-right text-muted-foreground">
                  {t.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Investigation Notes */}
      <div className="mt-4 p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-sm font-medium text-cyan-400 mb-2">
          <TrendingUp className="h-4 w-4" />
          Pattern Analysis
        </div>
        <div className="text-xs text-foreground/70 space-y-1">
          <p>• <strong>7:28 PM Convergence:</strong> Statistical clustering of target aircraft at this specific time</p>
          <p>• <strong>Geographic Focus:</strong> Bakersfield CBD / Oildale corridor (35.40-35.60°N)</p>
          <p>• <strong>Low-Altitude Ops:</strong> Minimum 1,067ft recorded - below normal commercial approach</p>
          <p>• <strong>Regional Coordination:</strong> Horizon (QXE) and SkyWest (SKW) patterns match Alaska timing</p>
        </div>
      </div>
    </CyberPanel>
  );
};

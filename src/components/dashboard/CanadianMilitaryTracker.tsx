import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Plane, RefreshCw, MapPin, Calendar, AlertTriangle, 
  Flag, Eye, ArrowUpDown, Radio
} from 'lucide-react';

interface CanadianAircraft {
  registration: string;
  callsign: string;
  icao_hex: string;
  aircraft_type: string;
  operator: string;
  detections: number;
  avg_altitude: number;
  first_seen: string;
  last_seen: string;
  classification: 'military' | 'commercial' | 'private' | 'unknown';
}

interface CorridorStats {
  totalDetections: number;
  uniqueAircraft: number;
  militaryCount: number;
  commercialCount: number;
  avgAltitude: number;
  dateRange: { start: string; end: string };
}

export const CanadianMilitaryTracker = () => {
  const [aircraft, setAircraft] = useState<CanadianAircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CorridorStats>({
    totalDetections: 0,
    uniqueAircraft: 0,
    militaryCount: 0,
    commercialCount: 0,
    avgAltitude: 0,
    dateRange: { start: '', end: '' }
  });

  // Canadian ICAO hex prefixes: C00000-C3FFFF
  const isCanadianICAO = (hex: string): boolean => {
    if (!hex) return false;
    const val = parseInt(hex, 16);
    return val >= 0xC00000 && val <= 0xC3FFFF;
  };

  // Check if callsign is Canadian military pattern
  const isCanadianMilitary = (callsign: string, registration: string): boolean => {
    if (!callsign && !registration) return false;
    const militaryPatterns = [
      /^CF[A-Z]{3}/, // CFABC pattern
      /^CFC\d+/, // CFC followed by numbers
      /^RCAF/, // Royal Canadian Air Force
      /^CANFORCE/, // Canadian Forces
    ];
    const cs = (callsign || '').toUpperCase();
    const reg = (registration || '').toUpperCase();
    return militaryPatterns.some(p => p.test(cs) || p.test(reg));
  };

  const classifyAircraft = (callsign: string, registration: string): 'military' | 'commercial' | 'private' | 'unknown' => {
    if (isCanadianMilitary(callsign, registration)) return 'military';
    const commercialPatterns = [/^AC[A-Z]?\d/, /^WJA/, /^TSC/, /^SKV/, /^PD[A-Z]?\d/];
    const cs = (callsign || '').toUpperCase();
    if (commercialPatterns.some(p => p.test(cs))) return 'commercial';
    if (registration?.startsWith('C-')) return 'private';
    return 'unknown';
  };

  const fetchCanadianAircraft = useCallback(async () => {
    setLoading(true);
    try {
      // Query for Canadian aircraft in Bakersfield corridor
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              icao_hex,
              aircraft_type,
              COALESCE(owner, operator, 'Unknown') as operator,
              COUNT(*) as detections,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE 
              (
                registration LIKE 'C-%' OR 
                registration LIKE 'CF%' OR
                callsign LIKE 'CF%' OR
                callsign LIKE 'AC%' OR
                callsign LIKE 'WJA%' OR
                (icao_hex IS NOT NULL AND icao_hex >= 'C00000' AND icao_hex <= 'C3FFFF')
              )
              AND latitude BETWEEN 35.30 AND 35.70
              AND longitude BETWEEN -119.30 AND -118.80
            GROUP BY registration, callsign, icao_hex, aircraft_type, COALESCE(owner, operator, 'Unknown')
            ORDER BY detections DESC
            LIMIT 100
          `
        }
      });

      if (error) throw error;

      const rawData = data?.data || [];
      
      // Process and classify aircraft
      const processed: CanadianAircraft[] = rawData.map((row: Record<string, unknown>) => ({
        registration: (row.registration as string) || 'N/A',
        callsign: (row.callsign as string) || 'N/A',
        icao_hex: (row.icao_hex as string) || '',
        aircraft_type: (row.aircraft_type as string) || 'Unknown',
        operator: (row.operator as string) || 'Unknown',
        detections: parseInt(row.detections as string) || 0,
        avg_altitude: parseFloat(row.avg_altitude as string) || 0,
        first_seen: (row.first_seen as string) || '',
        last_seen: (row.last_seen as string) || '',
        classification: classifyAircraft(row.callsign as string, row.registration as string)
      }));

      setAircraft(processed);

      // Calculate stats
      const totalDet = processed.reduce((sum, a) => sum + a.detections, 0);
      const militaryCount = processed.filter(a => a.classification === 'military').length;
      const commercialCount = processed.filter(a => a.classification === 'commercial').length;
      const avgAlt = processed.length > 0 
        ? processed.reduce((sum, a) => sum + a.avg_altitude, 0) / processed.length 
        : 0;

      const dates = processed
        .filter(a => a.first_seen)
        .map(a => new Date(a.first_seen).getTime());
      const endDates = processed
        .filter(a => a.last_seen)
        .map(a => new Date(a.last_seen).getTime());

      setStats({
        totalDetections: totalDet,
        uniqueAircraft: processed.length,
        militaryCount,
        commercialCount,
        avgAltitude: Math.round(avgAlt),
        dateRange: {
          start: dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString() : 'N/A',
          end: endDates.length > 0 ? new Date(Math.max(...endDates)).toLocaleDateString() : 'N/A'
        }
      });

    } catch (err) {
      console.error('Error fetching Canadian aircraft:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCanadianAircraft();
  }, [fetchCanadianAircraft]);

  const getClassBadge = (classification: string) => {
    const styles = {
      military: 'bg-red-500/20 text-red-400 border-red-500/30',
      commercial: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      private: 'bg-green-500/20 text-green-400 border-green-500/30',
      unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
    };
    return styles[classification as keyof typeof styles] || styles.unknown;
  };

  return (
    <CyberPanel 
      title="CANADIAN AIRCRAFT CORRIDOR TRACKER" 
      icon={<Flag className="h-5 w-5 text-red-400" />}
      className="col-span-2"
    >
      {/* Intelligence Banner */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <span className="font-bold text-red-400">FOREIGN MILITARY ACTIVITY DETECTED</span>
        </div>
        <p className="text-sm text-foreground/80">
          Canadian-registered aircraft detected operating within Bakersfield surveillance corridor 
          (35.30-35.70°N, 118.80-119.30°W). Includes potential RCAF/military assets mixed with 
          commercial traffic. ICAO hex range C00000-C3FFFF confirms Canadian registry.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-3 mb-6">
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{stats.totalDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{stats.uniqueAircraft}</div>
          <div className="text-xs text-muted-foreground">Unique Aircraft</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{stats.militaryCount}</div>
          <div className="text-xs text-muted-foreground">Military</div>
        </div>
        <div className="bg-background/50 border border-blue-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-blue-400">{stats.commercialCount}</div>
          <div className="text-xs text-muted-foreground">Commercial</div>
        </div>
        <div className="bg-background/50 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{stats.avgAltitude.toLocaleString()}ft</div>
          <div className="text-xs text-muted-foreground">Avg Altitude</div>
        </div>
        <div className="bg-background/50 border border-muted/30 rounded-lg p-3 text-center">
          <div className="text-sm font-mono text-muted-foreground">{stats.dateRange.start}</div>
          <div className="text-xs text-muted-foreground">to {stats.dateRange.end}</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchCanadianAircraft} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Badge variant="outline" className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          Bakersfield Corridor
        </Badge>
        <Badge variant="outline" className="flex items-center gap-1">
          <Radio className="h-3 w-3" />
          ICAO: C00000-C3FFFF
        </Badge>
      </div>

      {/* Aircraft List */}
      <ScrollArea className="h-[400px]">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="h-6 w-6 mx-auto animate-spin mb-2" />
            Scanning Canadian registry...
          </div>
        ) : aircraft.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No Canadian aircraft found in corridor
          </div>
        ) : (
          <div className="space-y-2">
            {aircraft.map((ac, idx) => (
              <div 
                key={`${ac.registration}-${idx}`}
                className={`p-4 rounded-lg border ${
                  ac.classification === 'military' 
                    ? 'border-red-500/40 bg-red-500/5' 
                    : 'border-border/30 bg-background/30'
                } hover:border-primary/50 transition-colors`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <Plane className={`h-4 w-4 ${ac.classification === 'military' ? 'text-red-400' : 'text-cyan-400'}`} />
                    <span className="font-mono font-bold text-primary">{ac.registration}</span>
                    <span className="font-mono text-muted-foreground text-sm">{ac.callsign}</span>
                    <Badge className={getClassBadge(ac.classification)}>
                      {ac.classification.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">
                      <Eye className="h-3 w-3 mr-1" />
                      {ac.detections.toLocaleString()}
                    </Badge>
                    <span className={`text-sm font-mono ${ac.avg_altitude < 2000 ? 'text-red-400' : 'text-muted-foreground'}`}>
                      <ArrowUpDown className="h-3 w-3 inline mr-1" />
                      {ac.avg_altitude.toLocaleString()}ft
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                  <div>
                    <span className="text-foreground/70">Type:</span> {ac.aircraft_type}
                  </div>
                  <div>
                    <span className="text-foreground/70">Operator:</span> {ac.operator}
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {ac.first_seen && new Date(ac.first_seen).toLocaleDateString()} - {ac.last_seen && new Date(ac.last_seen).toLocaleDateString()}
                  </div>
                </div>
                {ac.icao_hex && (
                  <div className="text-xs text-muted-foreground mt-1">
                    <Radio className="h-3 w-3 inline mr-1" />
                    ICAO Hex: <span className="font-mono text-cyan-400">{ac.icao_hex}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Legal Context */}
      <div className="mt-4 p-4 bg-red-500/5 border border-red-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-sm font-medium text-red-400 mb-2">
          <AlertTriangle className="h-4 w-4" />
          Intelligence Assessment
        </div>
        <p className="text-xs text-foreground/70">
          Canadian military aircraft operating over U.S. civilian airspace requires NORAD coordination 
          and FAA notification. Unannounced or unscheduled military flights may indicate joint 
          surveillance operations or treaty-exempt intelligence gathering. Cross-reference with 
          KCSO coordination records.
        </p>
      </div>
    </CyberPanel>
  );
};

import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Plane, AlertTriangle, Shield, Target, RefreshCw, Download, TrendingUp } from 'lucide-react';

interface AircraftEntry {
  registration: string;
  frequency: number;
  avg_altitude: number;
  min_altitude: number;
  first_seen: string;
  last_seen: string;
  operator: string;
  threat_level: 'critical' | 'high' | 'medium' | 'low';
  is_law_enforcement: boolean;
  biometric_correlations: number;
}

export const FleetTrackingLedger = () => {
  const [fleetData, setFleetData] = useState<AircraftEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'le' | 'high-freq'>('all');

  const fetchFleetData = useCallback(async () => {
    setLoading(true);
    try {
      // Get aircraft frequency and stats
      const { data: flightData, error: flightError } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              COUNT(*) as frequency,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(COALESCE(altitude, 9999)) as min_altitude,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen,
              MAX(callsign) as operator
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL AND registration != ''
            GROUP BY registration
            ORDER BY frequency DESC
            LIMIT 100
          `
        }
      });

      if (flightError) throw flightError;

      // Get biometric correlation counts per aircraft
      const { data: correlationData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              aircraft_registration as registration,
              COUNT(*) as correlation_count
            FROM josiah_reflections_rows
            WHERE aircraft_registration IS NOT NULL
            GROUP BY aircraft_registration
          `
        }
      });

      const correlationMap = new Map<string, number>();
      if (correlationData?.data) {
        correlationData.data.forEach((row: { registration: string; correlation_count: number }) => {
          correlationMap.set(row.registration, row.correlation_count);
        });
      }

      // Process and enrich fleet data
      const enrichedFleet: AircraftEntry[] = (flightData?.data || []).map((row: {
        registration: string;
        frequency: number;
        avg_altitude: number;
        min_altitude: number;
        first_seen: string;
        last_seen: string;
        operator: string;
      }) => {
        const isLE = /^N9(1[0-9]|2[0-9])KC$/.test(row.registration) || 
                    /LE$/.test(row.registration) ||
                    row.operator?.toLowerCase().includes('sheriff') ||
                    row.operator?.toLowerCase().includes('police') ||
                    row.operator?.toLowerCase().includes('law enforcement');
        
        const correlations = correlationMap.get(row.registration) || 0;
        const freq = Number(row.frequency);
        const minAlt = Number(row.min_altitude);
        
        // Calculate threat level based on frequency, altitude, and correlations
        let threatLevel: 'critical' | 'high' | 'medium' | 'low' = 'low';
        if (freq > 10 && correlations > 5 && minAlt < 1500) {
          threatLevel = 'critical';
        } else if (freq > 5 || correlations > 3 || minAlt < 1000) {
          threatLevel = 'high';
        } else if (freq > 2 || correlations > 1) {
          threatLevel = 'medium';
        }

        return {
          registration: row.registration,
          frequency: freq,
          avg_altitude: Number(row.avg_altitude),
          min_altitude: minAlt,
          first_seen: row.first_seen,
          last_seen: row.last_seen,
          operator: row.operator || 'Unknown',
          threat_level: threatLevel,
          is_law_enforcement: isLE,
          biometric_correlations: correlations
        };
      });

      setFleetData(enrichedFleet);
    } catch (err) {
      console.error('Error fetching fleet data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFleetData();
  }, [fetchFleetData]);

  const filteredData = fleetData.filter(aircraft => {
    if (filter === 'le') return aircraft.is_law_enforcement;
    if (filter === 'high-freq') return aircraft.frequency >= 5;
    return true;
  });

  const getThreatBadge = (level: string) => {
    const styles = {
      critical: 'bg-red-500/20 text-red-400 border-red-500/30',
      high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      low: 'bg-green-500/20 text-green-400 border-green-500/30'
    };
    return styles[level as keyof typeof styles] || styles.low;
  };

  const totalFlights = fleetData.reduce((sum, a) => sum + a.frequency, 0);
  const leAircraft = fleetData.filter(a => a.is_law_enforcement).length;
  const criticalThreats = fleetData.filter(a => a.threat_level === 'critical').length;

  return (
    <CyberPanel 
      title="Fleet Tracking Ledger" 
      icon={<Plane className="h-5 w-5" />}
      className="col-span-2"
    >
      {/* Stats Header */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{fleetData.length}</div>
          <div className="text-xs text-muted-foreground">Unique Aircraft</div>
        </div>
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{totalFlights.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-yellow-400">{leAircraft}</div>
          <div className="text-xs text-muted-foreground">Law Enforcement</div>
        </div>
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{criticalThreats}</div>
          <div className="text-xs text-muted-foreground">Critical Threats</div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex gap-2 mb-4">
        <Button 
          variant={filter === 'all' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('all')}
        >
          All Aircraft
        </Button>
        <Button 
          variant={filter === 'le' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('le')}
        >
          <Shield className="h-3 w-3 mr-1" />
          Law Enforcement
        </Button>
        <Button 
          variant={filter === 'high-freq' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('high-freq')}
        >
          <TrendingUp className="h-3 w-3 mr-1" />
          High Frequency (5+)
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={fetchFleetData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button variant="outline" size="sm">
          <Download className="h-3 w-3 mr-1" />
          Export
        </Button>
      </div>

      {/* Fleet Table */}
      <div className="overflow-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background/90 backdrop-blur">
            <tr className="border-b border-border/30">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Registration</th>
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Operator</th>
              <th className="text-center py-2 px-2 text-muted-foreground font-medium">Freq</th>
              <th className="text-center py-2 px-2 text-muted-foreground font-medium">Min Alt</th>
              <th className="text-center py-2 px-2 text-muted-foreground font-medium">Bio Corr</th>
              <th className="text-center py-2 px-2 text-muted-foreground font-medium">Threat</th>
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading fleet data...
                </td>
              </tr>
            ) : filteredData.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  No aircraft found
                </td>
              </tr>
            ) : (
              filteredData.map((aircraft, idx) => (
                <tr 
                  key={aircraft.registration} 
                  className={`border-b border-border/10 hover:bg-primary/5 ${
                    aircraft.threat_level === 'critical' ? 'bg-red-500/5' : ''
                  }`}
                >
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      {aircraft.is_law_enforcement && (
                        <Shield className="h-3 w-3 text-yellow-400" />
                      )}
                      <span className="font-mono text-primary">{aircraft.registration}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-foreground/80 max-w-[200px] truncate">
                    {aircraft.operator}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className={`font-mono ${
                      aircraft.frequency >= 10 ? 'text-red-400' : 
                      aircraft.frequency >= 5 ? 'text-orange-400' : 'text-foreground'
                    }`}>
                      {aircraft.frequency}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className={`font-mono ${
                      aircraft.min_altitude < 1000 ? 'text-red-400' : 
                      aircraft.min_altitude < 1500 ? 'text-yellow-400' : 'text-foreground'
                    }`}>
                      {aircraft.min_altitude}ft
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    {aircraft.biometric_correlations > 0 ? (
                      <Badge variant="outline" className="bg-magenta/10 text-magenta border-magenta/30">
                        <Target className="h-2 w-2 mr-1" />
                        {aircraft.biometric_correlations}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <Badge className={getThreatBadge(aircraft.threat_level)}>
                      {aircraft.threat_level.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground text-xs">
                    {aircraft.last_seen ? new Date(aircraft.last_seen).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </CyberPanel>
  );
};

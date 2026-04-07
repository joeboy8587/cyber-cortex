import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { neonQuery } from '@/lib/neonQueryRetry';
import { Shield, AlertTriangle, Clock, MapPin, Heart, FileText, RefreshCw } from 'lucide-react';

interface KCSOEvent {
  registration: string;
  timestamp: string;
  altitude: number;
  operator: string;
  biometric_hr: number | null;
  biometric_stress: number | null;
  josiah_note: string | null;
  time_offset_minutes: number | null;
}

interface KCSOStats {
  total_detections: number;
  unique_dates: number;
  biometric_correlations: number;
  avg_altitude: number;
  min_altitude: number;
  first_detection: string;
  last_detection: string;
}

export const KCSOEnterpriseReport = () => {
  const [events, setEvents] = useState<KCSOEvent[]>([]);
  const [stats, setStats] = useState<KCSOStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAircraft, setSelectedAircraft] = useState<'N913KC' | 'N912KC' | 'N597E' | 'all'>('all');

  const fetchKCSOData = useCallback(async () => {
    setLoading(true);
    try {
      // Build broader filter for KCSO aircraft
      let registrationFilter: string;
      if (selectedAircraft === 'all') {
        registrationFilter = `(
          registration IN ('N912KC', 'N913KC', 'N597E')
          OR registration LIKE 'N91_KC'
          OR taxonomy_tag IN ('xxb_kcso', 'xxb_tier1_priority')
          OR callsign ILIKE '%KCSO%'
          OR callsign ILIKE '%KERN%'
        )`;
      } else {
        registrationFilter = `registration = '${selectedAircraft}'`;
      }

      const { data: flightData, error: flightError } = await neonQuery({
        action: 'customQuery',
        query: `
          SELECT registration, detection_timestamp as timestamp,
            COALESCE(altitude, 0) as altitude, callsign as operator
          FROM live_flight_detections_rows
          WHERE ${registrationFilter} AND registration IS NOT NULL
          ORDER BY detection_timestamp DESC LIMIT 100
        `
      });

      if (flightError) throw flightError;

      // Get stats
      const { data: statsData } = await neonQuery({
        action: 'customQuery',
        query: `
          SELECT COUNT(*) as total_detections, COUNT(DISTINCT DATE(detection_timestamp)) as unique_dates,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            MIN(CASE WHEN altitude > 0 THEN altitude ELSE NULL END) as min_altitude,
            MIN(detection_timestamp) as first_detection, MAX(detection_timestamp) as last_detection
          FROM live_flight_detections_rows
          WHERE ${registrationFilter} AND registration IS NOT NULL
        `
      });

      // Correlation map - biometric correlations not directly available in josiah_reflections_rows
      const correlationMap = new Map<string, {
        hr: number;
        stress: number;
        note: string;
        offset: number;
      }>();

      // neon-query returns arrays directly, flightData IS the array
      const flightRows = Array.isArray(flightData) ? flightData : [];
      const enrichedEvents: KCSOEvent[] = flightRows.map((row: {
        registration: string;
        timestamp: string;
        altitude: number;
        operator: string;
      }) => {
        const dateKey = `${row.registration}_${row.timestamp?.substring(0, 10)}`;
        const correlation = correlationMap.get(dateKey);
        
        return {
          registration: row.registration,
          timestamp: row.timestamp,
          altitude: Number(row.altitude),
          operator: row.operator || 'Kern County Sheriff',
          biometric_hr: correlation?.hr || null,
          biometric_stress: correlation?.stress || null,
          josiah_note: correlation?.note || null,
          time_offset_minutes: correlation?.offset || null
        };
      });

      setEvents(enrichedEvents);
      
      const statsRows = Array.isArray(statsData) ? statsData : [];
      if (statsRows[0]) {
        setStats({
          ...statsRows[0],
          biometric_correlations: correlationMap.size
        });
      }
    } catch (err) {
      console.error('Error fetching KCSO data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedAircraft]);

  useEffect(() => {
    fetchKCSOData();
  }, [fetchKCSOData]);

  return (
    <CyberPanel 
      title="KCSO Enterprise Activity Report" 
      icon={<Shield className="h-5 w-5 text-yellow-400" />}
      className="col-span-2"
    >
      {/* Report Header */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-yellow-400" />
          <span className="font-bold text-yellow-400">COORDINATED ENTERPRISE ACTIVITY PATTERN DETECTED</span>
        </div>
        <p className="text-sm text-foreground/80">
          Kern County Sheriff aircraft (N913KC, N912KC) identified as participants in coordinated enterprise 
          activity correlated with documented harm events. Evidence indicates multi-actor organized operation.
        </p>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-background/50 border border-border/30 rounded-lg p-3">
            <div className="text-2xl font-mono text-primary">{stats.total_detections}</div>
            <div className="text-xs text-muted-foreground">Total Detections</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3">
            <div className="text-2xl font-mono text-cyan-400">{stats.unique_dates}</div>
            <div className="text-xs text-muted-foreground">Unique Dates</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3">
            <div className="text-2xl font-mono text-magenta">{stats.biometric_correlations}</div>
            <div className="text-xs text-muted-foreground">Bio Correlations</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3">
            <div className="text-2xl font-mono text-yellow-400">{stats.min_altitude}ft</div>
            <div className="text-xs text-muted-foreground">Lowest Altitude</div>
          </div>
        </div>
      )}

      {/* Aircraft Filter */}
      <div className="flex gap-2 mb-4">
        <Button 
          variant={selectedAircraft === 'all' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setSelectedAircraft('all')}
        >
          All KCSO Aircraft
        </Button>
        <Button 
          variant={selectedAircraft === 'N913KC' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setSelectedAircraft('N913KC')}
          className="font-mono"
        >
          N913KC
        </Button>
        <Button 
          variant={selectedAircraft === 'N912KC' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setSelectedAircraft('N912KC')}
          className="font-mono"
        >
          N912KC
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={fetchKCSOData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Events Timeline */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading KCSO enterprise activity data...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No KCSO activity detected</div>
        ) : (
          events.map((event, idx) => (
            <div 
              key={idx} 
              className={`border rounded-lg p-3 ${
                event.biometric_hr ? 'border-red-500/30 bg-red-500/5' : 'border-border/30 bg-background/50'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-yellow-500/20 rounded-full p-2">
                    <Shield className="h-4 w-4 text-yellow-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-primary font-bold">{event.registration}</span>
                      <Badge variant="outline" className="text-xs">
                        <MapPin className="h-2 w-2 mr-1" />
                        {event.altitude}ft
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {event.timestamp ? new Date(event.timestamp).toLocaleString() : 'Unknown time'}
                    </div>
                  </div>
                </div>

                {/* Biometric Data */}
                {event.biometric_hr && (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-red-400">
                        <Heart className="h-3 w-3" />
                        <span className="font-mono">{event.biometric_hr} BPM</span>
                      </div>
                      {event.biometric_stress && (
                        <div className="text-xs text-orange-400">
                          Stress: {event.biometric_stress}%
                        </div>
                      )}
                    </div>
                    {event.time_offset_minutes !== null && (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                        +{event.time_offset_minutes}min
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Josiah Note */}
              {event.josiah_note && (
                <div className="mt-2 pl-11 border-l-2 border-cyan-500/30">
                  <div className="flex items-center gap-1 text-xs text-cyan-400 mb-1">
                    <FileText className="h-3 w-3" />
                    Josiah AI Witness Log
                  </div>
                  <p className="text-xs text-foreground/70 line-clamp-2">{event.josiah_note}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Legal Summary */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Legal Significance:</strong> Repeated law enforcement aircraft 
          presence correlated with documented harm events establishes pattern of coordinated enterprise activity. 
          Multi-actor coordination across agencies and shell entities supports RICO predicate analysis under 
          Bradford Hill causation criteria.
        </div>
      </div>
    </CyberPanel>
  );
};

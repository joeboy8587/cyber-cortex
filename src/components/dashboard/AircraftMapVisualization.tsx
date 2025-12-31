import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Plane, AlertTriangle, Shield, Target, Radio, Satellite } from 'lucide-react';
import { useNeonDatabase, UnifiedFlight } from '@/hooks/useNeonDatabase';
import AircraftMapContent from './AircraftMapContent';

interface FlightData {
  hex: string;
  registration: string;
  callsign: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  heading: number;
  threat_level: 'critical' | 'high' | 'medium' | 'normal';
  threat_score: number;
  taxonomy_tag: string;
  is_flagged: boolean;
  flagged_reasons: string;
  data_source?: string;
}

const threatColors = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  normal: '#22c55e'
};

const sourceColors = {
  live_detection: '#22c55e',
  surveillance_feed: '#f97316'
};

const threatRadius = {
  critical: 12,
  high: 10,
  medium: 8,
  normal: 6
};


const AircraftMapVisualization: React.FC = () => {
  const { getUnifiedFlights, connectionStatus, isLoading: dbLoading } = useNeonDatabase();
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'critical'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'live' | 'surveillance'>('all');

  const fetchFlightData = useCallback(async () => {
    setLoading(true);
    try {
      // Use unified query that combines all flight tables
      const unifiedData = await getUnifiedFlights('24 hours', 500);
      
      // Transform to FlightData format
      const flightData: FlightData[] = (unifiedData || [])
        .filter((f: UnifiedFlight) => f.latitude && f.longitude && f.latitude !== 0 && f.longitude !== 0)
        .map((f: UnifiedFlight) => ({
          hex: f.hex || '',
          registration: f.registration || 'N/A',
          callsign: f.callsign || '',
          altitude: f.altitude || 0,
          speed: f.speed || 0,
          latitude: f.latitude,
          longitude: f.longitude,
          heading: f.heading || 0,
          threat_level: f.threat_level,
          threat_score: f.threat_score || 0,
          taxonomy_tag: f.taxonomy_tag || '',
          is_flagged: f.is_flagged || false,
          flagged_reasons: f.flagged_reasons || '',
          data_source: f.data_source
        }));

      setFlights(flightData);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch flight data:', err);
    } finally {
      setLoading(false);
    }
  }, [getUnifiedFlights]);

  useEffect(() => {
    fetchFlightData();
    const interval = setInterval(fetchFlightData, 30000);
    return () => clearInterval(interval);
  }, [fetchFlightData]);

  const filteredFlights = flights.filter(f => {
    // Source filter
    if (sourceFilter === 'live' && f.data_source !== 'live_detection') return false;
    if (sourceFilter === 'surveillance' && f.data_source !== 'surveillance_feed') return false;
    
    // Threat filter
    if (filter === 'flagged') return f.is_flagged || f.threat_level === 'critical' || f.threat_level === 'high';
    if (filter === 'critical') return f.threat_level === 'critical';
    return true;
  });

  const stats = {
    total: flights.length,
    critical: flights.filter(f => f.threat_level === 'critical').length,
    high: flights.filter(f => f.threat_level === 'high').length,
    medium: flights.filter(f => f.threat_level === 'medium').length,
    flagged: flights.filter(f => f.is_flagged).length,
    liveCount: flights.filter(f => f.data_source === 'live_detection').length,
    surveillanceCount: flights.filter(f => f.data_source === 'surveillance_feed').length
  };

  return (
    <Card className="col-span-full border-destructive/30 bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-destructive" />
            <CardTitle className="text-lg font-semibold">Real-Time Aircraft Map</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {filteredFlights.length} visible
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchFlightData}
              disabled={loading}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        
        {/* Stats bar */}
        <div className="flex flex-wrap gap-2 mt-2">
          {/* Source filters */}
          <div className="flex items-center gap-1 border-r border-border pr-2 mr-1">
            <Button
              variant={sourceFilter === 'all' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSourceFilter('all')}
              className="h-7 text-xs"
            >
              All Sources
            </Button>
            <Button
              variant={sourceFilter === 'live' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSourceFilter('live')}
              className="h-7 text-xs gap-1"
            >
              <Radio className="h-3 w-3 text-green-500" />
              Live ({stats.liveCount})
            </Button>
            <Button
              variant={sourceFilter === 'surveillance' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setSourceFilter('surveillance')}
              className="h-7 text-xs gap-1"
            >
              <Satellite className="h-3 w-3 text-orange-500" />
              Curated ({stats.surveillanceCount})
            </Button>
          </div>

          {/* Threat filters */}
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className="h-7 text-xs"
          >
            <Plane className="h-3 w-3 mr-1" />
            All ({stats.total})
          </Button>
          <Button
            variant={filter === 'flagged' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('flagged')}
            className="h-7 text-xs border-orange-500/50 text-orange-400 hover:bg-orange-500/20"
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            Flagged ({stats.flagged})
          </Button>
          <Button
            variant={filter === 'critical' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('critical')}
            className="h-7 text-xs border-red-500/50 text-red-400 hover:bg-red-500/20"
          >
            <Shield className="h-3 w-3 mr-1" />
            Critical ({stats.critical})
          </Button>
          
          {/* Legend */}
          <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500" /> Critical
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-orange-500" /> High
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-yellow-500" /> Medium
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-500" /> Normal
            </span>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="h-[500px] w-full rounded-b-lg overflow-hidden">
          <AircraftMapContent 
            flights={filteredFlights} 
            threatColors={threatColors}
            threatRadius={threatRadius}
          />
        </div>
        
        {lastUpdate && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border/50">
            Last updated: {lastUpdate.toLocaleTimeString()} • Auto-refresh: 30s
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AircraftMapVisualization;

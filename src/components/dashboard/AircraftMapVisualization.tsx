import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Plane, AlertTriangle, Shield, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import 'leaflet/dist/leaflet.css';

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
}

const threatColors = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  normal: '#22c55e'
};

const threatRadius = {
  critical: 12,
  high: 10,
  medium: 8,
  normal: 6
};

// Component to handle map bounds fitting
function MapBoundsUpdater({ flights }: { flights: FlightData[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (flights.length > 0) {
      const validFlights = flights.filter(f => f.latitude && f.longitude);
      if (validFlights.length > 0) {
        const bounds = validFlights.map(f => [f.latitude, f.longitude] as [number, number]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
      }
    }
  }, [flights, map]);
  
  return null;
}

const AircraftMapVisualization: React.FC = () => {
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'critical'>('all');

  const fetchFlightData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT DISTINCT ON (registration)
              icao_code as hex,
              registration,
              callsign,
              altitude,
              speed,
              latitude,
              longitude,
              heading,
              threat_score,
              taxonomy_tag,
              flagged as is_flagged,
              flagged_reasons,
              CASE 
                WHEN taxonomy_tag IN ('xxb_tier1_priority', 'xxb_kcso', 'xxb_kcso_shell') THEN 'critical'
                WHEN taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell') THEN 'high'
                WHEN taxonomy_tag = 'xxb_military' THEN 'high'
                WHEN taxonomy_tag = 'xxb_medical_air' THEN 'medium'
                WHEN taxonomy_tag = 'xxb_low_alt_suspicious' THEN 'medium'
                WHEN altitude < 1500 AND altitude > 0 THEN 'medium'
                ELSE 'normal'
              END as threat_level
            FROM live_flight_detections_rows
            WHERE latitude IS NOT NULL 
              AND longitude IS NOT NULL
              AND latitude != 0
              AND longitude != 0
            ORDER BY registration, detection_timestamp DESC
            LIMIT 500
          `
        }
      });

      if (error) throw error;
      
      const flightData = data?.data || [];
      setFlights(flightData);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to fetch flight data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFlightData();
    const interval = setInterval(fetchFlightData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [fetchFlightData]);

  const filteredFlights = flights.filter(f => {
    if (filter === 'flagged') return f.is_flagged || f.threat_level === 'critical' || f.threat_level === 'high';
    if (filter === 'critical') return f.threat_level === 'critical';
    return true;
  });

  const stats = {
    total: flights.length,
    critical: flights.filter(f => f.threat_level === 'critical').length,
    high: flights.filter(f => f.threat_level === 'high').length,
    medium: flights.filter(f => f.threat_level === 'medium').length,
    flagged: flights.filter(f => f.is_flagged).length
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
          <MapContainer
            center={[35.4, -119.0]}
            zoom={6}
            style={{ height: '100%', width: '100%' }}
            className="z-0"
          >
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            
            <MapBoundsUpdater flights={filteredFlights} />
            
            {filteredFlights.map((flight, idx) => (
              <CircleMarker
                key={`${flight.registration}-${idx}`}
                center={[flight.latitude, flight.longitude]}
                radius={threatRadius[flight.threat_level]}
                fillColor={threatColors[flight.threat_level]}
                fillOpacity={0.8}
                color={flight.is_flagged ? '#fff' : threatColors[flight.threat_level]}
                weight={flight.is_flagged ? 2 : 1}
              >
                <Popup>
                  <div className="text-sm space-y-1 min-w-[200px]">
                    <div className="font-bold text-base flex items-center gap-2">
                      {flight.registration || flight.hex}
                      {flight.is_flagged && (
                        <span className="text-xs px-1.5 py-0.5 bg-red-500 text-white rounded">
                          FLAGGED
                        </span>
                      )}
                    </div>
                    <div className="text-gray-600">Callsign: {flight.callsign || 'N/A'}</div>
                    <div className="text-gray-600">Altitude: {flight.altitude?.toFixed(0) || 'N/A'} ft</div>
                    <div className="text-gray-600">Speed: {flight.speed?.toFixed(0) || 'N/A'} kts</div>
                    <div className="text-gray-600">Heading: {flight.heading?.toFixed(0) || 'N/A'}°</div>
                    <div className="text-gray-600">
                      Threat: <span style={{ color: threatColors[flight.threat_level] }}>
                        {flight.threat_level.toUpperCase()}
                      </span>
                      {flight.threat_score > 0 && ` (${flight.threat_score})`}
                    </div>
                    {flight.taxonomy_tag && (
                      <div className="text-gray-600">Tag: {flight.taxonomy_tag}</div>
                    )}
                    {flight.flagged_reasons && (
                      <div className="text-red-600 text-xs mt-1">
                        {flight.flagged_reasons}
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
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

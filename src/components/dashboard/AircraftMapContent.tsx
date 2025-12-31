import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
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

interface MapContentProps {
  flights: FlightData[];
  threatColors: Record<string, string>;
  threatRadius: Record<string, number>;
}

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

const AircraftMapContent: React.FC<MapContentProps> = ({ flights, threatColors, threatRadius }) => {
  return (
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
      
      <MapBoundsUpdater flights={flights} />
      
      {flights.map((flight, idx) => (
        <CircleMarker
          key={`${flight.registration}-${idx}`}
          center={[flight.latitude, flight.longitude]}
          radius={threatRadius[flight.threat_level] || 6}
          fillColor={threatColors[flight.threat_level] || '#22c55e'}
          fillOpacity={0.8}
          color={flight.is_flagged ? '#fff' : (threatColors[flight.threat_level] || '#22c55e')}
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
                Threat: <span style={{ color: threatColors[flight.threat_level] || '#22c55e' }}>
                  {(flight.threat_level || 'normal').toUpperCase()}
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
  );
};

export default AircraftMapContent;

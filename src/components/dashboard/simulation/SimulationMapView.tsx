import { useEffect, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";

export interface FlightEvent {
  id: string;
  registration: string;
  callsign?: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  speed?: number;
  timestamp: string;
  threatLevel: "critical" | "high" | "medium" | "low";
  isLowAltitude: boolean;
  isMilitary: boolean;
  isShellCo: boolean;
}

// Custom aircraft icon creator
function createAircraftIcon(color: string, heading: number = 0): L.DivIcon {
  return L.divIcon({
    html: `<div style="transform: rotate(${heading}deg); color: ${color}; font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">✈</div>`,
    className: 'aircraft-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Get color for threat level
function getThreatColor(level: string): string {
  switch (level) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    default: return "#22c55e";
  }
}

// Component to handle map center updates
function MapCenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  
  useEffect(() => {
    if (center && center[0] !== 0 && center[1] !== 0) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  
  return null;
}

interface SimulationMapViewProps {
  mapCenter: [number, number];
  visibleFlights: FlightEvent[];
}

export function SimulationMapView({ mapCenter, visibleFlights }: SimulationMapViewProps) {
  const [ready, setReady] = useState(false);

  // Initialize Leaflet icons on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    
    try {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
      });
    } catch (e) {
      console.warn("Leaflet icon init failed:", e);
    }
    
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => setReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <div className="h-full w-full bg-background/50 flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Initializing map...</div>
      </div>
    );
  }

  return (
    <MapContainer
      center={mapCenter}
      zoom={11}
      className="h-full w-full"
      style={{ background: "#1a1a2e" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
      />
      
      <MapCenterUpdater center={mapCenter} />
      
      {/* Target location circle */}
      <Circle
        center={mapCenter}
        radius={500}
        pathOptions={{
          color: "#ef4444",
          fillColor: "#ef4444",
          fillOpacity: 0.2,
          weight: 2,
          dashArray: "5, 5",
        }}
      />

      {/* Aircraft markers */}
      {visibleFlights.map((flight) => (
        <Marker
          key={flight.id}
          position={[flight.latitude, flight.longitude]}
          icon={createAircraftIcon(getThreatColor(flight.threatLevel), flight.heading)}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-bold">{flight.registration}</div>
              {flight.callsign && <div className="text-xs">{flight.callsign}</div>}
              <div>Alt: {flight.altitude}ft</div>
              <div>Speed: {flight.speed}kts</div>
              {flight.isMilitary && (
                <Badge className="mt-1 bg-destructive text-xs">MILITARY</Badge>
              )}
              {flight.isShellCo && (
                <Badge className="mt-1 bg-primary text-xs">SHELL CO</Badge>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

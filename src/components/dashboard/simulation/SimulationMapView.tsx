import { useEffect, useState, useRef } from "react";
import L from "leaflet";
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

function getThreatColor(level: string): string {
  switch (level) {
    case "critical": return "#ef4444";
    case "high": return "#f97316";
    case "medium": return "#eab308";
    default: return "#22c55e";
  }
}

function getThreatRadius(level: string): number {
  switch (level) {
    case "critical": return 12;
    case "high": return 10;
    case "medium": return 8;
    default: return 6;
  }
}

interface SimulationMapViewProps {
  mapCenter: [number, number];
  visibleFlights: FlightEvent[];
}

function SimulationMapView({ mapCenter, visibleFlights }: SimulationMapViewProps) {
  const [ready, setReady] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);
  const targetCircleRef = useRef<L.Circle | null>(null);

  // 150ms delay before rendering map (required by architecture pattern)
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Initialize map imperatively (mirrors AircraftMapContent.tsx pattern)
  useEffect(() => {
    if (!ready || !mapContainerRef.current || mapRef.current) return;

    mapRef.current = L.map(mapContainerRef.current, {
      center: mapCenter,
      zoom: 11,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    }).addTo(mapRef.current);

    // Target location circle (red dashed ring)
    targetCircleRef.current = L.circle(mapCenter, {
      radius: 500,
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 0.2,
      weight: 2,
      dashArray: "5, 5",
    }).addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [ready, mapCenter]);

  // Update markers when visibleFlights changes
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Filter valid coordinates
    const validFlights = visibleFlights.filter(
      f =>
        f.latitude != null &&
        f.longitude != null &&
        !isNaN(f.latitude) &&
        !isNaN(f.longitude) &&
        Math.abs(f.latitude) <= 90 &&
        Math.abs(f.longitude) <= 180
    );

    validFlights.forEach(flight => {
      const color = getThreatColor(flight.threatLevel);
      const radius = getThreatRadius(flight.threatLevel);

      const marker = L.circleMarker([flight.latitude, flight.longitude], {
        radius,
        fillColor: color,
        fillOpacity: 0.85,
        color: "#fff",
        weight: 1,
      });

      const popupContent = `
        <div style="min-width: 180px; font-size: 13px; color: #222;">
          <div style="font-weight: bold; font-size: 15px; margin-bottom: 4px;">${flight.registration}</div>
          ${flight.callsign ? `<div style="color: #555; margin-bottom: 2px;">Callsign: ${flight.callsign}</div>` : ""}
          <div style="color: #555;">Altitude: ${flight.altitude} ft</div>
          <div style="color: #555;">Speed: ${flight.speed ?? "N/A"} kts</div>
          <div style="color: #555;">Heading: ${flight.heading}°</div>
          <div style="margin-top: 6px;">
            Threat: <span style="color: ${color}; font-weight: bold;">${flight.threatLevel.toUpperCase()}</span>
          </div>
          ${flight.isMilitary ? `<div style="color: #ef4444; font-size: 11px; margin-top: 4px;">⚠ MILITARY</div>` : ""}
          ${flight.isShellCo ? `<div style="color: #a855f7; font-size: 11px; margin-top: 2px;">⚠ SHELL CO</div>` : ""}
          ${flight.isLowAltitude ? `<div style="color: #f97316; font-size: 11px; margin-top: 2px;">⚠ LOW ALTITUDE</div>` : ""}
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.addTo(mapRef.current!);
      markersRef.current.push(marker);
    });
  }, [visibleFlights]);

  if (!ready) {
    return (
      <div className="h-full w-full bg-background/50 flex items-center justify-center">
        <div className="text-muted-foreground animate-pulse">Initializing map...</div>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      style={{ height: "100%", width: "100%", background: "#1a1a2e" }}
      className="z-0"
    />
  );
}

export default SimulationMapView;

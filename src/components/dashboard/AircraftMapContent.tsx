import React, { useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import L from 'leaflet';
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

const AircraftMapContent: React.FC<MapContentProps> = ({ flights, threatColors, threatRadius }) => {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.CircleMarker[]>([]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center on Bakersfield, CA (Kern County)
    mapRef.current = L.map(mapContainerRef.current, {
      center: [35.373, -119.019],
      zoom: 9,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    }).addTo(mapRef.current);

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update markers when flights change
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Add new markers
    const validFlights = flights.filter(f => 
      f.latitude != null && f.longitude != null && 
      !isNaN(f.latitude) && !isNaN(f.longitude) &&
      Math.abs(f.latitude) <= 90 && Math.abs(f.longitude) <= 180
    );
    
    validFlights.forEach(flight => {
      const color = threatColors[flight.threat_level] || '#22c55e';
      const radius = threatRadius[flight.threat_level] || 6;

      const marker = L.circleMarker([flight.latitude, flight.longitude], {
        radius,
        fillColor: color,
        fillOpacity: 0.8,
        color: flight.is_flagged ? '#fff' : color,
        weight: flight.is_flagged ? 2 : 1
      });

      const popupContent = `
        <div style="min-width: 200px; font-size: 14px;">
          <div style="font-weight: bold; font-size: 16px; display: flex; align-items: center; gap: 8px;">
            ${flight.registration || flight.hex}
            ${flight.is_flagged ? '<span style="font-size: 12px; padding: 2px 6px; background: #ef4444; color: white; border-radius: 4px;">FLAGGED</span>' : ''}
          </div>
          <div style="color: #666; margin-top: 4px;">Callsign: ${flight.callsign || 'N/A'}</div>
          <div style="color: #666;">Altitude: ${flight.altitude?.toFixed(0) || 'N/A'} ft</div>
          <div style="color: #666;">Speed: ${flight.speed?.toFixed(0) || 'N/A'} kts</div>
          <div style="color: #666;">Heading: ${flight.heading?.toFixed(0) || 'N/A'}°</div>
          <div style="color: #666;">
            Threat: <span style="color: ${color}; font-weight: bold;">
              ${(flight.threat_level || 'normal').toUpperCase()}
            </span>
            ${flight.threat_score > 0 ? ` (${flight.threat_score})` : ''}
          </div>
          ${flight.taxonomy_tag ? `<div style="color: #666;">Tag: ${flight.taxonomy_tag}</div>` : ''}
          ${flight.flagged_reasons ? `<div style="color: #ef4444; font-size: 12px; margin-top: 4px;">${flight.flagged_reasons}</div>` : ''}
        </div>
      `;

      marker.bindPopup(popupContent);

      // Permanent tail-number label for critical & high threats (and flagged)
      const showLabel =
        flight.threat_level === 'critical' ||
        flight.threat_level === 'high' ||
        flight.is_flagged;

      if (showLabel) {
        const label = flight.registration || flight.callsign || flight.hex;
        if (label) {
          marker.bindTooltip(label, {
            permanent: true,
            direction: 'top',
            offset: [0, -radius - 2],
            className: `aircraft-label-${flight.threat_level}`,
          });
        }
      }

      marker.addTo(mapRef.current!);
      markersRef.current.push(marker);
    });

    // Fit bounds if we have flights
    if (validFlights.length > 0) {
      const bounds = L.latLngBounds(validFlights.map(f => [f.latitude, f.longitude] as [number, number]));
      mapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
    }
  }, [flights, threatColors, threatRadius]);

  return (
    <div 
      ref={mapContainerRef} 
      style={{ height: '100%', width: '100%' }}
      className="z-0"
    />
  );
};

export default AircraftMapContent;

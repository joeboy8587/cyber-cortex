import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

interface HQLocation {
  id: string;
  cluster_center_lat: number;
  cluster_center_lng: number;
  visit_count: number;
  unique_aircraft: number;
  hq_confidence_score: number;
  location_type: string;
  aircraft_list: string[];
  night_operations: number;
  [key: string]: any;
}

interface Props {
  locations: HQLocation[];
  onSelectLocation: (loc: HQLocation) => void;
  selectedId?: string;
}

function MapCenterUpdater({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prev = useRef({ lat: 0, lng: 0 });
  useEffect(() => {
    if (prev.current.lat !== lat || prev.current.lng !== lng) {
      prev.current = { lat, lng };
      map.setView([lat, lng], 10);
    }
  }, [lat, lng, map]);
  return null;
}

const getColor = (score: number) => {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#eab308";
  return "#6b7280";
};

const getRadius = (visits: number) => Math.min(30, 8 + visits * 2);

function UnmaskHQMapView({ locations, onSelectLocation, selectedId }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 250);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return <div className="h-full flex items-center justify-center bg-muted text-muted-foreground">Loading map...</div>;
  }

  const center: [number, number] = locations.length > 0
    ? [locations[0].cluster_center_lat, locations[0].cluster_center_lng]
    : [35.4, -119.0];

  const selected = selectedId ? locations.find(l => l.id === selectedId) : null;

  return (
    <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }} className="z-0">
      <TileLayer
        attribution='&copy; <a href="https://carto.com">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {selected && (
        <MapCenterUpdater lat={selected.cluster_center_lat} lng={selected.cluster_center_lng} />
      )}
      {locations.map((loc) => (
        <CircleMarker
          key={loc.id}
          center={[loc.cluster_center_lat, loc.cluster_center_lng]}
          radius={getRadius(loc.visit_count)}
          pathOptions={{
            color: getColor(loc.hq_confidence_score),
            fillColor: getColor(loc.hq_confidence_score),
            fillOpacity: loc.id === selectedId ? 0.8 : 0.4,
            weight: loc.id === selectedId ? 3 : 1,
          }}
          eventHandlers={{ click: () => onSelectLocation(loc) }}
        >
          <Tooltip>
            <span className="text-xs font-mono">
              {loc.hq_confidence_score}% — {loc.visit_count} visits — {loc.unique_aircraft} aircraft
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

export default UnmaskHQMapView;

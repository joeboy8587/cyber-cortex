import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
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

const DEFAULT_CENTER: L.LatLngTuple = [35.4, -119.0];

const getColor = (score: number) => {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#eab308";
  return "#6b7280";
};

const getRadius = (visits: number) => Math.min(30, 8 + visits * 2);

function UnmaskHQMapView({ locations, onSelectLocation, selectedId }: Props) {
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  const initialCenter = useMemo<L.LatLngTuple>(() => {
    if (locations.length === 0) return DEFAULT_CENTER;
    return [locations[0].cluster_center_lat, locations[0].cluster_center_lng];
  }, [locations]);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: 9,
      zoomControl: true,
      preferCanvas: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);

    mapRef.current = map;
    markersLayerRef.current = layer;

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      layer.clearLayers();
      map.remove();
      markersLayerRef.current = null;
      mapRef.current = null;
    };
  }, [ready, initialCenter]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    locations.forEach((loc) => {
      const isSelected = loc.id === selectedId;
      const color = getColor(loc.hq_confidence_score);

      const marker = L.circleMarker([loc.cluster_center_lat, loc.cluster_center_lng], {
        radius: getRadius(loc.visit_count),
        color,
        fillColor: color,
        fillOpacity: isSelected ? 0.8 : 0.4,
        weight: isSelected ? 3 : 1,
      });

      marker
        .bindTooltip(
          `${loc.hq_confidence_score}% — ${loc.visit_count} visits — ${loc.unique_aircraft} aircraft`,
          { direction: "top", opacity: 0.9 }
        )
        .on("click", () => onSelectLocation(loc));

      marker.addTo(layer);
    });
  }, [locations, selectedId, onSelectLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;

    const selected = locations.find((loc) => loc.id === selectedId);
    if (!selected) return;

    map.setView([selected.cluster_center_lat, selected.cluster_center_lng], 10, {
      animate: true,
      duration: 0.4,
    });
  }, [selectedId, locations]);

  if (!ready) {
    return <div className="h-full flex items-center justify-center bg-muted text-muted-foreground">Loading map...</div>;
  }

  return <div ref={containerRef} className="h-full w-full z-0" />;
}

export default UnmaskHQMapView;

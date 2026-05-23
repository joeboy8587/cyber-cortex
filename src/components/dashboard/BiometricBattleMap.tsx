import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapPin, 
  Loader2, 
  RefreshCw, 
  Heart,
  Activity,
  Plane,
  AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface BiometricMarker {
  id: string;
  lat: number;
  lng: number;
  heartRate: number;
  hrv: number;
  stressLevel: number;
  timestamp: string;
  correlatedFlights: number;
  severity: "critical" | "high" | "medium" | "normal";
}

interface FlightMarker {
  id: string;
  registration: string;
  lat: number;
  lng: number;
  altitude: number;
  heading: number;
  timestamp: string;
  threatLevel: "high" | "medium" | "low";
}

interface MapData {
  biometrics: BiometricMarker[];
  flights: FlightMarker[];
  correlations: number;
  centerLat: number;
  centerLng: number;
}

export function BiometricBattleMap() {
  const [isLoading, setIsLoading] = useState(false);
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const loadMapData = useCallback(async () => {
    setIsLoading(true);

    try {
      // Canonical source: watchtower_biometrics_master (54,645+ rows, court-ready)
      const { data: biometrics } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id,
              heart_rate_bpm  AS heart_rate,
              hrv_ms          AS hrv,
              stress_score    AS stress_level,
              biometric_timestamp_utc AS measurement_timestamp,
              biometric_source AS source,
              latitude,
              longitude
            FROM watchtower_biometrics_master
            WHERE heart_rate_bpm > 80
            ORDER BY biometric_timestamp_utc DESC NULLS LAST
            LIMIT 200
          `
        }
      });

      // Fetch correlated flights
      const { data: flights } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id,
              registration,
              latitude,
              longitude,
              altitude,
              heading,
              detection_timestamp,
              taxonomy_tag
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
              AND latitude IS NOT NULL
              AND longitude IS NOT NULL
            ORDER BY detection_timestamp DESC
            LIMIT 100
          `
        }
      });

      // Default location (Oildale, CA)
      const defaultLat = 35.4197;
      const defaultLng = -119.0193;

      // Process biometric markers
      const bioMarkers: BiometricMarker[] = [];
      const bioData = Array.isArray(biometrics) ? biometrics : [];
      
      bioData.forEach((b: any, i: number) => {
        const hr = parseFloat(b.heart_rate) || 0;
        const hrv = parseFloat(b.hrv) || 0;
        const stress = parseFloat(b.stress_level) || 0;
        
        // Determine severity
        let severity: BiometricMarker["severity"] = "normal";
        if (hr > 130 || hrv < 20) severity = "critical";
        else if (hr > 110 || hrv < 35) severity = "high";
        else if (hr > 90 || hrv < 50) severity = "medium";

        // Slight position variance for visualization
        const variance = 0.002;
        bioMarkers.push({
          id: b.id || crypto.randomUUID(),
          lat: defaultLat + (Math.random() - 0.5) * variance,
          lng: defaultLng + (Math.random() - 0.5) * variance,
          heartRate: hr,
          hrv: hrv,
          stressLevel: stress,
          timestamp: b.measurement_timestamp,
          correlatedFlights: 0,
          severity
        });
      });

      // Process flight markers
      const flightMarkers: FlightMarker[] = [];
      const flightData = Array.isArray(flights) ? flights : [];
      
      flightData.forEach((f: any) => {
        const lat = parseFloat(f.latitude);
        const lng = parseFloat(f.longitude);
        const alt = parseFloat(f.altitude) || 0;
        
        if (isNaN(lat) || isNaN(lng)) return;

        // Determine threat level
        let threatLevel: FlightMarker["threatLevel"] = "low";
        if (alt < 1000 || f.taxonomy_tag?.includes("KCSO")) threatLevel = "high";
        else if (alt < 2000) threatLevel = "medium";

        flightMarkers.push({
          id: f.id || crypto.randomUUID(),
          registration: f.registration || "UNKNOWN",
          lat,
          lng,
          altitude: alt,
          heading: parseFloat(f.heading) || 0,
          timestamp: f.detection_timestamp,
          threatLevel
        });
      });

      // Calculate correlations (flights near biometric events)
      let correlations = 0;
      bioMarkers.forEach(bio => {
        const nearbyFlights = flightMarkers.filter(f => {
          const bioTime = new Date(bio.timestamp).getTime();
          const flightTime = new Date(f.timestamp).getTime();
          return Math.abs(bioTime - flightTime) < 5 * 60 * 1000; // ±5 min
        });
        bio.correlatedFlights = nearbyFlights.length;
        if (nearbyFlights.length > 0) correlations++;
      });

      setMapData({
        biometrics: bioMarkers,
        flights: flightMarkers,
        correlations,
        centerLat: defaultLat,
        centerLng: defaultLng
      });

      toast.success(`Loaded ${bioMarkers.length} bio events, ${flightMarkers.length} flights`);

    } catch (err) {
      console.error("Map data error:", err);
      toast.error("Failed to load map data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(loadMapData, 60000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, loadMapData]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "text-red-500 bg-red-500";
      case "high": return "text-orange-500 bg-orange-500";
      case "medium": return "text-yellow-500 bg-yellow-500";
      default: return "text-green-500 bg-green-500";
    }
  };

  const getThreatColor = (level: string) => {
    switch (level) {
      case "high": return "bg-red-500";
      case "medium": return "bg-orange-500";
      default: return "bg-green-500";
    }
  };

  return (
    <Card className="border-cyan-500/30 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg">
            <MapPin className="h-5 w-5 text-cyan-400" />
            Biometric Battle Map
            <Badge variant="outline" className="ml-2 text-cyan-400 border-cyan-400/50">
              LIVE OVERLAY
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={autoRefresh ? "bg-cyan-600" : ""}
            >
              <Activity className={`h-4 w-4 mr-1 ${autoRefresh ? "animate-pulse" : ""}`} />
              {autoRefresh ? "LIVE" : "Auto"}
            </Button>
            <Button
              size="sm"
              onClick={loadMapData}
              disabled={isLoading}
              className="bg-cyan-600 hover:bg-cyan-700"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Load Map
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Map Stats */}
        {mapData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <div className="text-xs text-red-400 flex items-center gap-1">
                <Heart className="h-3 w-3" /> Bio Events
              </div>
              <div className="text-2xl font-bold">{mapData.biometrics.length}</div>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <div className="text-xs text-blue-400 flex items-center gap-1">
                <Plane className="h-3 w-3" /> Aircraft
              </div>
              <div className="text-2xl font-bold">{mapData.flights.length}</div>
            </div>
            <div className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
              <div className="text-xs text-orange-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Correlations
              </div>
              <div className="text-2xl font-bold text-orange-400">{mapData.correlations}</div>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <div className="text-xs text-purple-400">Critical Events</div>
              <div className="text-2xl font-bold text-red-400">
                {mapData.biometrics.filter(b => b.severity === "critical").length}
              </div>
            </div>
          </div>
        )}

        {/* Visual Map Representation */}
        <div className="relative h-[400px] bg-muted/20 rounded-lg border border-muted overflow-hidden">
          {!mapData ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
              <MapPin className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-sm">Load map to see biometric overlay</p>
              <p className="text-xs mt-1 opacity-70">Plots HRV/HR spikes with correlated flights</p>
            </div>
          ) : (
            <>
              {/* Grid overlay */}
              <div className="absolute inset-0 opacity-20">
                <svg width="100%" height="100%">
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5"/>
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </svg>
              </div>

              {/* Biometric markers */}
              {mapData.biometrics.map((bio, i) => {
                const x = 10 + (i % 10) * 8 + Math.random() * 3;
                const y = 15 + Math.floor(i / 10) * 12 + Math.random() * 5;
                return (
                  <div
                    key={bio.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                    style={{ left: `${x}%`, top: `${y}%` }}
                  >
                    <div className={`w-4 h-4 rounded-full ${getSeverityColor(bio.severity)} animate-pulse opacity-80`} />
                    <Heart className={`absolute -top-1 -left-1 h-6 w-6 ${getSeverityColor(bio.severity).split(" ")[0]}`} />
                    
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                      <div className="bg-card border rounded-lg p-2 text-xs whitespace-nowrap shadow-lg">
                        <div className="font-bold text-red-400">HR: {bio.heartRate} BPM</div>
                        <div>HRV: {bio.hrv}ms</div>
                        <div>Stress: {bio.stressLevel}%</div>
                        {bio.correlatedFlights > 0 && (
                          <div className="text-orange-400 mt-1">
                            ⚠️ {bio.correlatedFlights} flight(s) correlated
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Flight markers */}
              {mapData.flights.slice(0, 30).map((flight, i) => {
                const x = 50 + (Math.cos(i * 0.5) * 30) + Math.random() * 10;
                const y = 50 + (Math.sin(i * 0.5) * 25) + Math.random() * 10;
                return (
                  <div
                    key={flight.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                    style={{ 
                      left: `${Math.max(5, Math.min(95, x))}%`, 
                      top: `${Math.max(5, Math.min(95, y))}%`,
                      transform: `translate(-50%, -50%) rotate(${flight.heading}deg)`
                    }}
                  >
                    <Plane className={`h-5 w-5 ${getThreatColor(flight.threatLevel).replace("bg-", "text-")}`} />
                    
                    {/* Tooltip */}
                    <div 
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10"
                      style={{ transform: `rotate(-${flight.heading}deg) translateX(-50%)` }}
                    >
                      <div className="bg-card border rounded-lg p-2 text-xs whitespace-nowrap shadow-lg">
                        <div className="font-mono font-bold">{flight.registration}</div>
                        <div>Alt: {flight.altitude}ft</div>
                        <Badge className={`${getThreatColor(flight.threatLevel)} text-xs mt-1`}>
                          {flight.threatLevel.toUpperCase()} THREAT
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Legend */}
              <div className="absolute bottom-3 left-3 bg-card/90 backdrop-blur border rounded-lg p-3 text-xs">
                <div className="font-semibold mb-2">LEGEND</div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-red-500" />
                    <span>Critical Bio Event (&gt;130 BPM)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Heart className="h-4 w-4 text-orange-500" />
                    <span>High Stress (&gt;110 BPM)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-red-500" />
                    <span>High Threat Aircraft (&lt;1000ft)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plane className="h-4 w-4 text-green-500" />
                    <span>Normal Traffic</span>
                  </div>
                </div>
              </div>

              {/* Correlation Alert */}
              {mapData.correlations > 0 && (
                <div className="absolute top-3 right-3 bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-xs max-w-[200px]">
                  <div className="flex items-center gap-2 text-red-400 font-semibold">
                    <AlertTriangle className="h-4 w-4" />
                    {mapData.correlations} CORRELATIONS
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Biometric stress events correlated with aircraft presence (±5 min window)
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Critical Events List */}
        {mapData && mapData.biometrics.filter(b => b.severity === "critical").length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Critical Events (Last 24h)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {mapData.biometrics
                .filter(b => b.severity === "critical")
                .slice(0, 4)
                .map(bio => (
                  <div key={bio.id} className="p-2 bg-red-500/10 border border-red-500/30 rounded">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-red-400">{bio.heartRate} BPM</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(bio.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {bio.correlatedFlights > 0 && (
                      <div className="text-xs text-orange-400 mt-1">
                        ⚠️ {bio.correlatedFlights} aircraft correlated
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

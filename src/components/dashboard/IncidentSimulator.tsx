import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { 
  Play, 
  Pause, 
  ChevronLeft, 
  ChevronRight,
  AlertTriangle,
  Settings,
  Download,
  Loader2,
  RefreshCw,
  Target,
  Shield
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format, subHours, addMinutes, differenceInMinutes } from "date-fns";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet icon issue - wrapped in try-catch for SSR safety
try {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
} catch (e) {
  console.warn("Leaflet icon init warning:", e);
}

interface FlightEvent {
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

interface BiometricEvent {
  id: string;
  heartRate: number;
  stress: number;
  hrv: number;
  timestamp: string;
  severity: "critical" | "high" | "medium" | "normal";
}

interface Alert {
  id: string;
  type: "low_altitude" | "biometric" | "rico" | "ai_analysis";
  title: string;
  subtitle: string;
  severity: "critical" | "high" | "medium";
  timestamp: string;
}

interface SimulationData {
  flights: FlightEvent[];
  biometrics: BiometricEvent[];
  alerts: Alert[];
}

// Custom aircraft icons
const createAircraftIcon = (color: string, heading: number = 0) => {
  try {
    return L.divIcon({
      html: `<div style="transform: rotate(${heading}deg); color: ${color}; font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">✈</div>`,
      className: 'aircraft-marker',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  } catch (e) {
    return undefined;
  }
};

// Map center updater component
function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (map) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export function IncidentSimulator() {
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime, setStartTime] = useState(subHours(new Date(), 1));
  const [endTime, setEndTime] = useState(new Date());
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [simulationData, setSimulationData] = useState<SimulationData | null>(null);
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  
  // Default center (Oildale, CA)
  const mapCenter: [number, number] = [35.4197, -119.0193];

  // Calculate timeline progress
  const totalMinutes = differenceInMinutes(endTime, startTime);
  const currentMinutes = differenceInMinutes(currentTime, startTime);
  const progressPercent = totalMinutes > 0 ? (currentMinutes / totalMinutes) * 100 : 0;

  // Load simulation data
  const loadSimulationData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Fetch flights in time window
      const { data: flightsData, error: flightsError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, registration, callsign, latitude, longitude, 
              altitude, heading, speed, detection_timestamp,
              taxonomy_tag
            FROM live_flight_detections_rows
            WHERE detection_timestamp BETWEEN '${startTime.toISOString()}' AND '${endTime.toISOString()}'
              AND latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY detection_timestamp ASC
            LIMIT 500
          `
        }
      });

      if (flightsError) {
        console.error("Flights query error:", flightsError);
      }

      // Fetch biometrics in time window
      const { data: biometricsData, error: bioError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id, heart_rate, stress_level, hrv, measurement_timestamp
            FROM biometric_monitoring
            WHERE measurement_timestamp BETWEEN '${startTime.toISOString()}' AND '${endTime.toISOString()}'
            ORDER BY measurement_timestamp ASC
            LIMIT 200
          `
        }
      });

      if (bioError) {
        console.error("Biometrics query error:", bioError);
      }

      // Process flights - handle both array and object responses
      const flightRows = Array.isArray(flightsData) ? flightsData : 
                         (flightsData?.rows || flightsData?.data || []);
      
      const flights: FlightEvent[] = flightRows.map((f: any) => {
        const alt = parseFloat(f.altitude) || 0;
        const isLowAlt = alt < 1000 && alt > 0;
        const isMilitary = f.taxonomy_tag?.includes("MILITARY") || f.callsign?.startsWith("STMPD");
        const isShell = f.taxonomy_tag?.includes("SHELL") || f.taxonomy_tag?.includes("ALF");
        
        let threatLevel: FlightEvent["threatLevel"] = "low";
        if (isLowAlt && (isMilitary || isShell)) threatLevel = "critical";
        else if (isLowAlt || isMilitary) threatLevel = "high";
        else if (isShell) threatLevel = "medium";

        return {
          id: f.id || String(Math.random()),
          registration: f.registration || "UNKNOWN",
          callsign: f.callsign,
          latitude: parseFloat(f.latitude) || 0,
          longitude: parseFloat(f.longitude) || 0,
          altitude: alt,
          heading: parseFloat(f.heading) || 0,
          speed: parseFloat(f.speed) || 0,
          timestamp: f.detection_timestamp,
          threatLevel,
          isLowAltitude: isLowAlt,
          isMilitary,
          isShellCo: isShell,
        };
      }).filter((f: FlightEvent) => f.latitude !== 0 && f.longitude !== 0);

      // Process biometrics
      const bioRows = Array.isArray(biometricsData) ? biometricsData :
                      (biometricsData?.rows || biometricsData?.data || []);
      
      const biometrics: BiometricEvent[] = bioRows.map((b: any) => {
        const hr = parseFloat(b.heart_rate) || 0;
        const stress = parseFloat(b.stress_level) || 0;
        const hrv = parseFloat(b.hrv) || 50;
        
        let severity: BiometricEvent["severity"] = "normal";
        if (hr > 130 || stress > 85 || hrv < 20) severity = "critical";
        else if (hr > 110 || stress > 70 || hrv < 35) severity = "high";
        else if (hr > 90 || stress > 50 || hrv < 50) severity = "medium";

        return {
          id: b.id || String(Math.random()),
          heartRate: hr,
          stress,
          hrv,
          timestamp: b.measurement_timestamp,
          severity,
        };
      });

      // Generate alerts from data
      const alerts: Alert[] = [];
      
      // Low altitude alerts
      flights.filter(f => f.isLowAltitude).slice(0, 5).forEach((f, i) => {
        alerts.push({
          id: `low_alt_${i}`,
          type: "low_altitude",
          title: "LOW ALTITUDE ALERT",
          subtitle: `${f.registration} ${f.altitude}ft - ${f.isMilitary ? "Military" : "Repeat Offender"}`,
          severity: f.threatLevel === "critical" ? "critical" : "high",
          timestamp: f.timestamp,
        });
      });

      // Biometric alerts
      biometrics.filter(b => b.severity !== "normal").slice(0, 3).forEach((b, i) => {
        alerts.push({
          id: `bio_${i}`,
          type: "biometric",
          title: "BIOMETRIC SPIKE",
          subtitle: `Heart Rate ${b.heartRate} BPM | Stress ${b.stress}%`,
          severity: b.severity === "critical" ? "critical" : "high",
          timestamp: b.timestamp,
        });
      });

      // RICO flags (shell company flights)
      const shellFlights = flights.filter(f => f.isShellCo);
      if (shellFlights.length > 0) {
        alerts.push({
          id: "rico_1",
          type: "rico",
          title: "RICO FLAG",
          subtitle: `${shellFlights.length} Coordinated Shell Co Flights`,
          severity: "critical",
          timestamp: shellFlights[0].timestamp,
        });
      }

      setSimulationData({ flights, biometrics, alerts });
      setActiveAlerts(alerts.slice(0, 4));
      
      // Generate AI analysis
      const analysisText = generateAIAnalysis(flights, biometrics);
      setAiAnalysis(analysisText);

      toast.success(`Loaded ${flights.length} flights, ${biometrics.length} biometric events`);
    } catch (err) {
      console.error("Simulation load error:", err);
      setError((err as Error).message);
      toast.error("Failed to load simulation data");
    } finally {
      setIsLoading(false);
    }
  }, [startTime, endTime]);

  // Generate AI analysis text
  const generateAIAnalysis = (flights: FlightEvent[], biometrics: BiometricEvent[]): string => {
    const militaryCount = flights.filter(f => f.isMilitary).length;
    const lowAltCount = flights.filter(f => f.isLowAltitude).length;
    const shellCount = flights.filter(f => f.isShellCo).length;
    const criticalBio = biometrics.filter(b => b.severity === "critical").length;

    let analysis = "";
    if (flights.length > 50) {
      analysis += `Multiple aircraft converging in tight timing (${flights.length} total). `;
    }
    if (militaryCount > 0) {
      analysis += `Suspected military aircraft present (${militaryCount} detected). `;
    }
    if (criticalBio > 0) {
      analysis += `Elevated biometrics detected (${criticalBio} critical events). `;
    }
    if (shellCount > 0 || lowAltCount > 10) {
      analysis += "Possible RICO enterprise activity.";
    }
    
    return analysis || "Monitoring active. No significant patterns detected.";
  };

  // Get flights visible at current time
  const visibleFlights = useMemo(() => {
    if (!simulationData) return [];
    return simulationData.flights.filter(f => {
      const flightTime = new Date(f.timestamp);
      return flightTime <= currentTime;
    }).slice(-100); // Last 100 for performance
  }, [simulationData, currentTime]);

  // Stats calculations
  const stats = useMemo(() => {
    if (!simulationData) return { total: 0, lowAlt: 0, bioAlerts: 0, ricoFlags: 0 };
    return {
      total: simulationData.flights.length,
      lowAlt: simulationData.flights.filter(f => f.isLowAltitude).length,
      bioAlerts: simulationData.biometrics.filter(b => b.severity !== "normal").length,
      ricoFlags: simulationData.alerts.filter(a => a.type === "rico").length,
    };
  }, [simulationData]);

  // Playback effect
  useEffect(() => {
    if (!isPlaying) return;
    
    const interval = setInterval(() => {
      setCurrentTime(prev => {
        const next = addMinutes(prev, playbackSpeed);
        if (next >= endTime) {
          setIsPlaying(false);
          return endTime;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, endTime]);

  // Handle timeline slider change
  const handleTimelineChange = (value: number[]) => {
    const minutes = (value[0] / 100) * totalMinutes;
    setCurrentTime(addMinutes(startTime, minutes));
  };

  // Get color for threat level
  const getThreatColor = (level: string) => {
    switch (level) {
      case "critical": return "hsl(var(--destructive))";
      case "high": return "hsl(24, 95%, 53%)";
      case "medium": return "hsl(48, 96%, 53%)";
      default: return "hsl(142, 76%, 36%)";
    }
  };

  // Error display
  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Simulation Error</h2>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => { setError(null); loadSimulationData(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-4">
            <h1 className="font-display text-lg uppercase tracking-wider text-primary">
              Watchtower Command Center
            </h1>
          </div>
          <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive animate-pulse">
            SIMULATION MODE ACTIVE
          </Badge>
        </div>
        
        {/* Time controls */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border/50">
          <Button variant="ghost" size="icon" onClick={() => setCurrentTime(subHours(currentTime, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <div className="font-mono text-sm bg-muted px-3 py-1 rounded">
            {format(currentTime, "dd MMM yyyy")}
          </div>
          
          <Button
            variant={isPlaying ? "destructive" : "default"}
            size="sm"
            onClick={() => setIsPlaying(!isPlaying)}
            disabled={!simulationData}
          >
            {isPlaying ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            {isPlaying ? "Pause" : "Play"}
          </Button>

          {/* Timeline progress bar */}
          <div className="flex-1 mx-4">
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div 
                className="absolute left-0 top-0 h-full bg-destructive transition-all"
                style={{ width: `${progressPercent}%` }}
              />
              <div className="absolute inset-0 flex">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="flex-1 border-r border-muted-foreground/20" />
                ))}
              </div>
            </div>
          </div>

          <div className="font-mono text-lg font-bold text-primary">
            {format(currentTime, "HH:mm:ss")}
          </div>
          <span className="text-xs text-muted-foreground">UTC</span>
          
          <Button variant="ghost" size="icon" onClick={() => setCurrentTime(addMinutes(currentTime, 60))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map area */}
        <div className="flex-1 relative">
          {!simulationData ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/20">
              <Target className="h-16 w-16 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground mb-4">Load simulation data to begin</p>
              <Button onClick={loadSimulationData} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Load Last Hour
              </Button>
            </div>
          ) : (
            <MapContainer
              center={mapCenter}
              zoom={11}
              className="h-full w-full"
              style={{ background: "hsl(var(--background))" }}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              />
              <MapUpdater center={mapCenter} />
              
              {/* Target location circle */}
              <Circle
                center={mapCenter}
                radius={500}
                pathOptions={{
                  color: "hsl(var(--destructive))",
                  fillColor: "hsl(var(--destructive))",
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
          )}

          {/* Convergence event overlay */}
          {simulationData && stats.total > 50 && (
            <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-destructive/90 backdrop-blur px-4 py-2 rounded-lg border border-destructive flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive-foreground animate-pulse" />
              <div>
                <div className="font-bold text-destructive-foreground text-sm">CRITICAL CONVERGENCE EVENT:</div>
                <div className="text-destructive-foreground/80 text-xs">{stats.total} Aircraft Detected</div>
              </div>
            </div>
          )}
        </div>

        {/* Right panel - Alerts */}
        <div className="w-80 border-l border-border bg-card/50 backdrop-blur overflow-y-auto">
          <div className="p-3 space-y-3">
            {/* Alert cards */}
            {activeAlerts.map((alert) => (
              <Card 
                key={alert.id} 
                className={`border-l-4 ${
                  alert.type === "low_altitude" ? "border-l-orange-500 bg-orange-500/10" :
                  alert.type === "biometric" ? "border-l-destructive bg-destructive/10" :
                  alert.type === "rico" ? "border-l-primary bg-primary/10" :
                  "border-l-accent bg-accent/10"
                }`}
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className={`text-xs font-bold uppercase ${
                        alert.type === "low_altitude" ? "text-orange-400" :
                        alert.type === "biometric" ? "text-destructive" :
                        alert.type === "rico" ? "text-primary" :
                        "text-accent-foreground"
                      }`}>
                        {alert.title}
                      </div>
                      <div className="text-sm mt-1">{alert.subtitle}</div>
                    </div>
                    <AlertTriangle className={`h-4 w-4 ${
                      alert.severity === "critical" ? "text-destructive" : "text-orange-500"
                    }`} />
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* AI Analysis panel */}
            {aiAnalysis && (
              <Card className="border-accent/50 bg-accent/5">
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                      <Shield className="h-4 w-4 text-accent-foreground" />
                    </div>
                    <div className="text-xs font-bold text-accent-foreground">AI ANALYSIS (Josiah)</div>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {aiAnalysis}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar - Timeline & Stats */}
      <div className="border-t border-border bg-card/80 backdrop-blur">
        {/* Timeline scrubber */}
        <div className="px-4 py-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span>EVENT TIMELINE</span>
          </div>
          <Slider
            value={[progressPercent]}
            onValueChange={handleTimelineChange}
            max={100}
            step={0.1}
            className="w-full"
            disabled={!simulationData}
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{format(startTime, "h:mm a")}</span>
            <span>{format(addMinutes(startTime, totalMinutes * 0.25), "h:mm a")}</span>
            <span>{format(addMinutes(startTime, totalMinutes * 0.5), "h:mm a")}</span>
            <span>{format(addMinutes(startTime, totalMinutes * 0.75), "h:mm a")}</span>
            <span>{format(endTime, "h:mm a")}</span>
          </div>
        </div>

        {/* Stats and actions */}
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">TOTAL AIRCRAFT</div>
            </div>
            <div className="text-center border-l border-border pl-4">
              <div className="text-2xl font-bold text-orange-400">{stats.lowAlt}</div>
              <div className="text-xs text-muted-foreground">LOW ALTITUDE &lt;500 FT</div>
            </div>
            <div className="text-center border-l border-border pl-4">
              <div className="text-2xl font-bold text-destructive">{stats.bioAlerts}</div>
              <div className="text-xs text-muted-foreground">BIOMETRIC ALERTS</div>
            </div>
            <div className="text-center border-l border-border pl-4">
              <div className="text-2xl font-bold text-primary">{stats.ricoFlags}</div>
              <div className="text-xs text-muted-foreground">RICO FLAGS</div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-destructive/50 text-destructive">
              <AlertTriangle className="h-4 w-4 mr-1" />
              Report Incident
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export Data
            </Button>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" />
              Analysis Tools
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

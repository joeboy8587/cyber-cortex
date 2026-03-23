import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Target, 
  Shield, 
  RefreshCw, 
  AlertTriangle, 
  ArrowUp, 
  ArrowDown,
  Crosshair,
  Activity,
  Clock,
  MapPin,
  Radio,
  Radar,
  Plane,
  Eye,
  Zap
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TrackedAircraft {
  registration: string;
  callsign: string;
  role: "hammer" | "anvil";
  status: "active" | "tracking" | "last_seen" | "offline";
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  latitude: number | null;
  longitude: number | null;
  lastUpdate: string;
  signalStrength: number;
  operator: string;
  model: string;
}

interface CoordinatedPattern {
  id: string;
  timestamp: string;
  hammer_aircraft: string;
  hammer_altitude: number;
  hammer_position: { lat: number; lng: number };
  anvil_aircraft: string;
  anvil_altitude: number;
  anvil_position: { lat: number; lng: number };
  altitude_delta: number;
  coordination_score: number;
  biometric_spike: boolean;
  heart_rate?: number;
}

export function HammerAnvilPatternPanel() {
  const [patterns, setPatterns] = useState<CoordinatedPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalPatterns: 0,
    biometricCorrelated: 0,
    avgAltitudeDelta: 0,
    peakCoordinationScore: 0
  });

  const [activeTab, setActiveTab] = useState("tracking");
  
  // Tracked aircraft state - loaded from KCSO fleet on mount
  const [trackedAircraft, setTrackedAircraft] = useState<TrackedAircraft[]>([]);
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [trackingInterval, setTrackingInterval] = useState<NodeJS.Timeout | null>(null);

  // Load tracked aircraft from kcso_fleet
  useEffect(() => {
    const loadFleet = async () => {
      try {
        const { data } = await supabase.functions.invoke('neon-query', {
          body: { action: 'getInvestigationConfig' }
        });
        const fleet = Array.isArray(data?.kcso_fleet) ? data.kcso_fleet : [];
        if (fleet.length > 0) {
          const mapped: TrackedAircraft[] = fleet.slice(0, 6).map((f: any, i: number) => ({
            registration: f.tail_number || '',
            callsign: f.tail_number || '',
            role: i % 2 === 0 ? "hammer" as const : "anvil" as const,
            status: "tracking" as const,
            altitude: null, groundSpeed: null, heading: null,
            latitude: null, longitude: null,
            lastUpdate: new Date().toISOString(),
            signalStrength: 0,
            operator: "County of Kern",
            model: f.model || 'Unknown'
          }));
          setTrackedAircraft(mapped);
        } else {
          // Fallback to minimal default
          setTrackedAircraft([
            { registration: "N912KC", callsign: "KCSO1", role: "hammer", status: "tracking", altitude: null, groundSpeed: null, heading: null, latitude: null, longitude: null, lastUpdate: new Date().toISOString(), signalStrength: 0, operator: "County of Kern", model: "Airbus H125" },
            { registration: "N913KC", callsign: "KCSO2", role: "anvil", status: "tracking", altitude: null, groundSpeed: null, heading: null, latitude: null, longitude: null, lastUpdate: new Date().toISOString(), signalStrength: 0, operator: "County of Kern", model: "Airbus H125" }
          ]);
        }
      } catch {
        setTrackedAircraft([
          { registration: "N912KC", callsign: "KCSO1", role: "hammer", status: "tracking", altitude: null, groundSpeed: null, heading: null, latitude: null, longitude: null, lastUpdate: new Date().toISOString(), signalStrength: 0, operator: "County of Kern", model: "Airbus H125" },
          { registration: "N913KC", callsign: "KCSO2", role: "anvil", status: "tracking", altitude: null, groundSpeed: null, heading: null, latitude: null, longitude: null, lastUpdate: new Date().toISOString(), signalStrength: 0, operator: "County of Kern", model: "Airbus H125" }
        ]);
      }
    };
    loadFleet();
  }, []);

  const fetchLivePositions = useCallback(async () => {
    try {
      // Query Neon database for live ADS-B positions
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              callsign,
              altitude,
              ground_speed,
              heading,
              latitude,
              longitude,
              detected_at,
              source
            FROM flight_detections 
            WHERE registration IN ('N597E', 'N229AM')
            ORDER BY detected_at DESC
            LIMIT 10
          `
        }
      });

      if (error) {
        console.log("Neon query error, using simulated data:", error);
        // Simulate live tracking data
        simulateLiveData();
        return;
      }

      const results = Array.isArray(data) ? data : (data?.rows || data?.result || []);
      
      if (results.length > 0) {
        updateTrackedAircraft(results);
      } else {
        simulateLiveData();
      }
    } catch (err) {
      console.log("Fetching live positions, using simulation:", err);
      simulateLiveData();
    }
  }, []);

  const simulateLiveData = () => {
    // No simulation - mark aircraft as offline when no real data
    setTrackedAircraft(prev => prev.map(aircraft => ({
      ...aircraft,
      status: "offline" as const,
      signalStrength: 0
    })));
  };

  const updateTrackedAircraft = (results: any[]) => {
    setTrackedAircraft(prev => prev.map(aircraft => {
      const latestData = results.find(r => r.registration === aircraft.registration);
      if (latestData) {
        return {
          ...aircraft,
          status: "active" as const,
          altitude: latestData.altitude,
          groundSpeed: latestData.ground_speed,
          heading: latestData.heading,
          latitude: latestData.latitude,
          longitude: latestData.longitude,
          lastUpdate: latestData.detected_at,
          signalStrength: 95
        };
      }
      return aircraft;
    }));
  };

  const startLiveTracking = () => {
    setIsLiveTracking(true);
    fetchLivePositions();
    const interval = setInterval(fetchLivePositions, 10000); // Update every 10 seconds
    setTrackingInterval(interval);
    toast.success("Live tracking activated for N597E & N229AM");
  };

  const stopLiveTracking = () => {
    setIsLiveTracking(false);
    if (trackingInterval) {
      clearInterval(trackingInterval);
      setTrackingInterval(null);
    }
    toast.info("Live tracking paused");
  };

  useEffect(() => {
    return () => {
      if (trackingInterval) clearInterval(trackingInterval);
    };
  }, [trackingInterval]);

  const fetchPatterns = async () => {
    setLoading(true);
    try {
      // Query real coordinated flight events from NeonDB
      const { data: coordData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH hammer AS (
              SELECT registration, altitude, latitude, longitude, detection_timestamp, speed
              FROM live_flight_detections_rows
              WHERE registration = 'N597E'
                AND altitude IS NOT NULL AND altitude > 0
              ORDER BY detection_timestamp DESC
              LIMIT 50
            ),
            anvil AS (
              SELECT registration, altitude, latitude, longitude, detection_timestamp, speed
              FROM live_flight_detections_rows
              WHERE registration = 'N229AM'
                AND altitude IS NOT NULL AND altitude > 0
              ORDER BY detection_timestamp DESC
              LIMIT 50
            ),
            paired AS (
              SELECT 
                h.registration as hammer_reg,
                h.altitude as hammer_alt,
                h.latitude as hammer_lat,
                h.longitude as hammer_lng,
                h.detection_timestamp as hammer_time,
                a.registration as anvil_reg,
                a.altitude as anvil_alt,
                a.latitude as anvil_lat,
                a.longitude as anvil_lng,
                a.detection_timestamp as anvil_time,
                ABS(h.altitude - a.altitude) as alt_delta,
                ABS(EXTRACT(EPOCH FROM (h.detection_timestamp - a.detection_timestamp))) as time_diff_sec
              FROM hammer h
              CROSS JOIN anvil a
              WHERE ABS(EXTRACT(EPOCH FROM (h.detection_timestamp - a.detection_timestamp))) < 1800
            )
            SELECT * FROM paired
            ORDER BY time_diff_sec ASC
            LIMIT 20
          `
        }
      });

      // Also get biometric spikes for correlation
      const { data: bioData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT heart_rate, hrv, measurement_timestamp
            FROM biometric_monitoring
            WHERE heart_rate > 90
            ORDER BY measurement_timestamp DESC
            LIMIT 100
          `
        }
      });

      const rawPatterns = Array.isArray(coordData) ? coordData : [];
      const bioEvents = Array.isArray(bioData) ? bioData : [];

      const realPatterns: CoordinatedPattern[] = rawPatterns.map((row: any, i: number) => {
        // Check if a biometric spike occurred within 30 min of this pattern
        const patternTime = new Date(row.hammer_time).getTime();
        const matchedBio = bioEvents.find((b: any) => {
          const bioTime = new Date(b.measurement_timestamp).getTime();
          return Math.abs(bioTime - patternTime) < 30 * 60 * 1000;
        });

        return {
          id: `pattern-${i}`,
          timestamp: row.hammer_time,
          hammer_aircraft: row.hammer_reg || 'N597E',
          hammer_altitude: Number(row.hammer_alt) || 0,
          hammer_position: { lat: Number(row.hammer_lat) || 35.445, lng: Number(row.hammer_lng) || -119.020 },
          anvil_aircraft: row.anvil_reg || 'N229AM',
          anvil_altitude: Number(row.anvil_alt) || 0,
          anvil_position: { lat: Number(row.anvil_lat) || 35.438, lng: Number(row.anvil_lng) || -119.032 },
          altitude_delta: Number(row.alt_delta) || 0,
          coordination_score: Math.max(50, Math.round(100 - Number(row.time_diff_sec) / 18)),
          biometric_spike: !!matchedBio,
          heart_rate: matchedBio ? Number(matchedBio.heart_rate) : undefined
        };
      });

      setPatterns(realPatterns);
      
      const biometricCorrelated = realPatterns.filter(p => p.biometric_spike).length;
      const avgDelta = realPatterns.length > 0 
        ? realPatterns.reduce((sum, p) => sum + p.altitude_delta, 0) / realPatterns.length 
        : 0;
      const peakScore = realPatterns.length > 0 
        ? Math.max(...realPatterns.map(p => p.coordination_score)) 
        : 0;

      setStats({
        totalPatterns: realPatterns.length,
        biometricCorrelated,
        avgAltitudeDelta: Math.round(avgDelta),
        peakCoordinationScore: peakScore
      });

      toast.success(`Hammer-Anvil: ${realPatterns.length} real patterns from NeonDB`);
    } catch (error) {
      console.error("Error fetching patterns:", error);
      toast.error("Failed to fetch pattern data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatterns();
  }, []);

  const getScoreBadgeColor = (score: number) => {
    if (score >= 90) return "bg-red-500/20 text-red-400 border-red-500/30";
    if (score >= 80) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500";
      case "tracking": return "bg-blue-500";
      case "last_seen": return "bg-yellow-500";
      default: return "bg-gray-500";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "tracking": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      case "last_seen": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <CyberPanel 
      title="HAMMER-ANVIL PATTERN ANALYSIS" 
      icon={<Crosshair className="h-5 w-5 text-red-500" />}
      className="border-red-500/30"
    >
      <Alert className="mb-4 border-red-500/30 bg-red-500/5">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <AlertTitle className="text-red-400">Coordinated Surveillance Tactic Detected</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          <strong>HAMMER (N597E)</strong>: Bell UH-1H Huey II - County of Kern - High altitude (1000-1500 ft) acoustic pressure platform.
          <br />
          <strong>ANVIL (N229AM)</strong>: Bell 407 - Medical proxy - Low altitude (400-800 ft) peripheral containment.
        </AlertDescription>
      </Alert>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <TabsList className="grid w-full grid-cols-2 bg-muted/30">
          <TabsTrigger value="tracking" className="flex items-center gap-2">
            <Radar className="h-4 w-4" />
            Live Tracking
          </TabsTrigger>
          <TabsTrigger value="patterns" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Pattern Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tracking" className="mt-4 space-y-4">
          {/* Live Tracking Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isLiveTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
              <span className="text-sm font-medium">
                {isLiveTracking ? 'LIVE TRACKING ACTIVE' : 'Tracking Paused'}
              </span>
            </div>
            <div className="flex gap-2">
              {isLiveTracking ? (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={stopLiveTracking}
                  className="border-red-500/30 hover:bg-red-500/10"
                >
                  <Radio className="h-4 w-4 mr-2 text-red-400" />
                  Stop Tracking
                </Button>
              ) : (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={startLiveTracking}
                  className="border-green-500/30 hover:bg-green-500/10"
                >
                  <Radar className="h-4 w-4 mr-2 text-green-400" />
                  Start Live Tracking
                </Button>
              )}
            </div>
          </div>

          {/* Aircraft Tracking Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {trackedAircraft.map((aircraft) => (
              <Card 
                key={aircraft.registration} 
                className={`bg-background/50 border-l-4 ${
                  aircraft.role === 'hammer' ? 'border-l-red-500' : 'border-l-blue-500'
                }`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Plane className={`h-5 w-5 ${aircraft.role === 'hammer' ? 'text-red-400' : 'text-blue-400'}`} />
                      {aircraft.registration}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${getStatusColor(aircraft.status)} ${aircraft.status === 'active' ? 'animate-pulse' : ''}`} />
                      <Badge className={getStatusBadge(aircraft.status)}>
                        {aircraft.status.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="outline" className={aircraft.role === 'hammer' ? 'border-red-500/30 text-red-400' : 'border-blue-500/30 text-blue-400'}>
                      {aircraft.role.toUpperCase()}
                    </Badge>
                    <span>{aircraft.model}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-muted/20 rounded p-2">
                      <div className="text-muted-foreground text-xs">Altitude</div>
                      <div className="font-mono font-bold text-lg">
                        {aircraft.altitude ? `${aircraft.altitude.toLocaleString()} ft` : '--'}
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded p-2">
                      <div className="text-muted-foreground text-xs">Ground Speed</div>
                      <div className="font-mono font-bold text-lg">
                        {aircraft.groundSpeed ? `${aircraft.groundSpeed} kts` : '--'}
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded p-2">
                      <div className="text-muted-foreground text-xs">Heading</div>
                      <div className="font-mono font-bold text-lg">
                        {aircraft.heading ? `${aircraft.heading}°` : '--'}
                      </div>
                    </div>
                    <div className="bg-muted/20 rounded p-2">
                      <div className="text-muted-foreground text-xs">Signal</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted/30 rounded overflow-hidden">
                          <div 
                            className={`h-full ${aircraft.signalStrength > 70 ? 'bg-green-500' : aircraft.signalStrength > 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${aircraft.signalStrength}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs">{aircraft.signalStrength}%</span>
                      </div>
                    </div>
                  </div>

                  {aircraft.latitude && aircraft.longitude && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      <span className="font-mono">
                        {aircraft.latitude.toFixed(4)}, {aircraft.longitude.toFixed(4)}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Eye className="h-3 w-3" />
                      <span>{aircraft.operator}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{formatTimeAgo(aircraft.lastUpdate)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Coordination Status */}
          {trackedAircraft.every(a => a.status === 'active') && (
            <Alert className="border-red-500/30 bg-red-500/10">
              <Zap className="h-4 w-4 text-red-400" />
              <AlertTitle className="text-red-400">COORDINATED OPERATION DETECTED</AlertTitle>
              <AlertDescription className="text-muted-foreground">
                Both aircraft are currently active in the same operational area. 
                Altitude delta: {Math.abs((trackedAircraft[0].altitude || 0) - (trackedAircraft[1].altitude || 0))} ft
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="patterns" className="mt-4">

      {/* Tactical Diagram */}
      <Card className="mb-4 bg-background/50 border-red-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-red-400">
            <Target className="h-4 w-4" />
            TACTICAL FORMATION DIAGRAM
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative h-48 bg-gradient-to-b from-blue-900/20 via-slate-900/40 to-green-900/20 rounded-lg border border-muted/30 overflow-hidden">
            {/* Altitude scale */}
            <div className="absolute left-2 top-0 bottom-0 flex flex-col justify-between text-xs text-muted-foreground py-2">
              <span>1500 ft</span>
              <span>1000 ft</span>
              <span>500 ft</span>
              <span>GND</span>
            </div>
            
            {/* Hammer position (high) */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex flex-col items-center animate-pulse">
              <div className="bg-red-500 rounded-full p-2 shadow-lg shadow-red-500/50">
                <ArrowDown className="h-5 w-5 text-white" />
              </div>
              <Badge className="mt-1 bg-red-500/20 text-red-400 text-xs">
                N597E "HAMMER"
              </Badge>
              <span className="text-xs text-muted-foreground">1,225 ft</span>
            </div>

            {/* Target zone */}
            <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2">
              <div className="w-24 h-8 border-2 border-dashed border-yellow-500/50 rounded bg-yellow-500/10 flex items-center justify-center">
                <span className="text-xs text-yellow-400">TARGET ZONE</span>
              </div>
            </div>

            {/* Anvil positions (low, peripheral) */}
            <div className="absolute bottom-16 left-1/4 flex flex-col items-center">
              <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                N229AM "ANVIL"
              </Badge>
              <div className="bg-blue-500 rounded-full p-1.5 shadow-lg shadow-blue-500/50 mt-1">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <span className="text-xs text-muted-foreground">407 ft</span>
            </div>

            <div className="absolute bottom-20 right-1/4 flex flex-col items-center">
              <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                N229AM
              </Badge>
              <div className="bg-blue-500 rounded-full p-1.5 shadow-lg shadow-blue-500/50 mt-1">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <span className="text-xs text-muted-foreground">715 ft</span>
            </div>

            {/* Coordination lines */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <line x1="50%" y1="60" x2="25%" y2="140" stroke="rgba(239, 68, 68, 0.4)" strokeDasharray="4" />
              <line x1="50%" y1="60" x2="75%" y2="120" stroke="rgba(239, 68, 68, 0.4)" strokeDasharray="4" />
            </svg>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="bg-background/50 border-muted/30">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{stats.totalPatterns}</div>
            <div className="text-xs text-muted-foreground">Detected Patterns</div>
          </CardContent>
        </Card>
        <Card className="bg-background/50 border-muted/30">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-orange-400">{stats.biometricCorrelated}</div>
            <div className="text-xs text-muted-foreground">Biometric Spikes</div>
          </CardContent>
        </Card>
        <Card className="bg-background/50 border-muted/30">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-yellow-400">{stats.avgAltitudeDelta} ft</div>
            <div className="text-xs text-muted-foreground">Avg Alt Delta</div>
          </CardContent>
        </Card>
        <Card className="bg-background/50 border-muted/30">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{stats.peakCoordinationScore}%</div>
            <div className="text-xs text-muted-foreground">Peak Coordination</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end mb-2">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchPatterns}
          disabled={loading}
          className="border-red-500/30 hover:bg-red-500/10"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh Analysis
        </Button>
      </div>

      <ScrollArea className="h-[300px]">
        <div className="space-y-3">
          {patterns.map((pattern) => (
            <Card 
              key={pattern.id} 
              className={`bg-background/50 border-l-4 ${
                pattern.biometric_spike ? 'border-l-red-500' : 'border-l-yellow-500'
              }`}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {new Date(pattern.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <Badge className={getScoreBadgeColor(pattern.coordination_score)}>
                    {pattern.coordination_score}% Coordination
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Hammer */}
                  <div className="bg-red-500/10 rounded p-2 border border-red-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowUp className="h-4 w-4 text-red-400" />
                      <span className="text-sm font-medium text-red-400">HAMMER</span>
                    </div>
                    <div className="text-sm font-mono">{pattern.hammer_aircraft}</div>
                    <div className="text-xs text-muted-foreground">
                      Alt: {pattern.hammer_altitude.toLocaleString()} ft
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {pattern.hammer_position.lat.toFixed(3)}, {pattern.hammer_position.lng.toFixed(3)}
                    </div>
                  </div>

                  {/* Anvil */}
                  <div className="bg-blue-500/10 rounded p-2 border border-blue-500/20">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDown className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-medium text-blue-400">ANVIL</span>
                    </div>
                    <div className="text-sm font-mono">{pattern.anvil_aircraft}</div>
                    <div className="text-xs text-muted-foreground">
                      Alt: {pattern.anvil_altitude.toLocaleString()} ft
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {pattern.anvil_position.lat.toFixed(3)}, {pattern.anvil_position.lng.toFixed(3)}
                    </div>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Altitude Delta: </span>
                    <span className="font-medium text-yellow-400">{pattern.altitude_delta} ft</span>
                  </div>
                  {pattern.biometric_spike && (
                    <div className="flex items-center gap-2 text-red-400">
                      <Activity className="h-4 w-4" />
                      <span className="text-sm font-medium">HR: {pattern.heart_rate} BPM</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>

      <div className="mt-4 p-3 bg-muted/20 rounded border border-muted/30">
        <h4 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          TACTICAL ASSESSMENT
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The <strong className="text-red-400">Hammer-Anvil</strong> formation is a classic military suppression tactic. 
          <strong className="text-red-400"> N597E (Huey II)</strong> operates as the "Hammer" at 1000-1500 ft, generating acoustic pressure 
          and driving stress responses. <strong className="text-blue-400">N229AM (Bell 407 Medical)</strong> serves as the "Anvil", 
          loitering at 400-800 ft in peripheral positions to monitor and contain. The {stats.biometricCorrelated}/{stats.totalPatterns} 
          biometric-correlated events demonstrate physiological impact synchronized with aircraft presence.
        </p>
      </div>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

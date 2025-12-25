import { useEffect, useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Plane, RefreshCw, AlertTriangle, Shield, Radio, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";

interface LiveFlight {
  hex: string;
  registration: string;
  callsign: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  detection_timestamp: string;
  taxonomy_tag?: string;
  threat_level: 'critical' | 'high' | 'medium' | 'low' | 'normal';
  is_military: boolean;
  is_flagged: boolean;
}

interface FlightStats {
  total_active: number;
  flagged_count: number;
  military_count: number;
  low_altitude_count: number;
  kcso_related: number;
}

export function LiveFlightTracker() {
  const [flights, setFlights] = useState<LiveFlight[]>([]);
  const [stats, setStats] = useState<FlightStats>({
    total_active: 0,
    flagged_count: 0,
    military_count: 0,
    low_altitude_count: 0,
    kcso_related: 0
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLiveFlights = useCallback(async () => {
    try {
      // Get recent flights from last 24 hours with classification
      const { data: flightData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            WITH recent_flights AS (
              SELECT 
                hex, registration, callsign, altitude, speed, 
                latitude, longitude, detection_timestamp, taxonomy_tag,
                CASE 
                  WHEN taxonomy_tag IN ('xxb_kcso', 'xxb_shell', 'xxb_kcso_shell') THEN 'critical'
                  WHEN registration ~ '^[0-9]{2}-[0-9]{5}$' OR registration ~ '^[0-9]{6}$' OR registration LIKE 'RAIDR%' THEN 'high'
                  WHEN altitude < 2000 AND speed < 150 THEN 'medium'
                  WHEN taxonomy_tag = 'xxb_mercy_air' THEN 'medium'
                  ELSE 'normal'
                END as threat_level,
                CASE 
                  WHEN registration ~ '^[0-9]{2}-[0-9]{5}$' OR registration ~ '^[0-9]{6}$' 
                    OR registration LIKE 'RAIDR%' OR callsign LIKE 'NAVY%' 
                    OR callsign LIKE 'ARMY%' THEN true 
                  ELSE false 
                END as is_military,
                CASE 
                  WHEN taxonomy_tag IN ('xxb_kcso', 'xxb_shell', 'xxb_flagged', 'xxb_kcso_shell') THEN true 
                  ELSE false 
                END as is_flagged
              FROM live_flight_detections_rows
              WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
              ORDER BY detection_timestamp DESC
              LIMIT 100
            )
            SELECT * FROM recent_flights ORDER BY 
              CASE threat_level 
                WHEN 'critical' THEN 1 
                WHEN 'high' THEN 2 
                WHEN 'medium' THEN 3 
                ELSE 4 
              END,
              detection_timestamp DESC
          `
        }
      });

      // Get aggregate stats
      const { data: statsData } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              COUNT(DISTINCT hex) as total_active,
              COUNT(DISTINCT CASE WHEN taxonomy_tag IN ('xxb_kcso', 'xxb_shell', 'xxb_flagged', 'xxb_kcso_shell') THEN hex END) as flagged_count,
              COUNT(DISTINCT CASE WHEN registration ~ '^[0-9]{2}-[0-9]{5}$' OR registration ~ '^[0-9]{6}$' OR registration LIKE 'RAIDR%' THEN hex END) as military_count,
              COUNT(DISTINCT CASE WHEN altitude < 2000 THEN hex END) as low_altitude_count,
              COUNT(DISTINCT CASE WHEN taxonomy_tag LIKE '%kcso%' THEN hex END) as kcso_related
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
          `
        }
      });

      const flightList: LiveFlight[] = (flightData?.data || []).map((f: Record<string, unknown>) => ({
        hex: String(f.hex || ''),
        registration: String(f.registration || 'N/A'),
        callsign: String(f.callsign || 'N/A'),
        altitude: Number(f.altitude) || 0,
        speed: Number(f.speed) || 0,
        latitude: Number(f.latitude) || 0,
        longitude: Number(f.longitude) || 0,
        detection_timestamp: String(f.detection_timestamp || ''),
        taxonomy_tag: f.taxonomy_tag ? String(f.taxonomy_tag) : undefined,
        threat_level: (f.threat_level || 'normal') as LiveFlight['threat_level'],
        is_military: Boolean(f.is_military),
        is_flagged: Boolean(f.is_flagged)
      }));

      setFlights(flightList);
      
      if (statsData?.data?.[0]) {
        setStats({
          total_active: parseInt(statsData.data[0].total_active) || 0,
          flagged_count: parseInt(statsData.data[0].flagged_count) || 0,
          military_count: parseInt(statsData.data[0].military_count) || 0,
          low_altitude_count: parseInt(statsData.data[0].low_altitude_count) || 0,
          kcso_related: parseInt(statsData.data[0].kcso_related) || 0
        });
      }
      
      setLastUpdate(new Date());
    } catch (error) {
      console.error("Failed to fetch live flights:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveFlights();
    
    // Auto-refresh every 30 seconds if enabled
    const interval = autoRefresh ? setInterval(fetchLiveFlights, 30000) : null;
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchLiveFlights, autoRefresh]);

  const getThreatBadge = (level: string) => {
    switch (level) {
      case 'critical':
        return <Badge variant="destructive" className="animate-pulse">CRITICAL</Badge>;
      case 'high':
        return <Badge className="bg-orange-500 text-white">HIGH</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500 text-black">MEDIUM</Badge>;
      default:
        return <Badge variant="outline">NORMAL</Badge>;
    }
  };

  return (
    <CyberPanel
      title="LIVE FLIGHT TRACKER"
      icon={<Radio className="w-5 h-5 text-primary animate-pulse" />}
    >
      <div className="p-4 space-y-4">
        {/* Control Bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={autoRefresh ? "default" : "outline"}
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              <Radio className={`w-4 h-4 mr-1 ${autoRefresh ? 'animate-pulse' : ''}`} />
              {autoRefresh ? 'LIVE' : 'PAUSED'}
            </Button>
            <Button size="sm" variant="outline" onClick={fetchLiveFlights} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            Last update: {lastUpdate.toLocaleTimeString()}
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="bg-card/50 border border-primary/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-mono font-bold text-primary">{stats.total_active}</div>
            <div className="text-xs text-muted-foreground">Active (24h)</div>
          </div>
          <div className="bg-card/50 border border-destructive/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-mono font-bold text-destructive">{stats.flagged_count}</div>
            <div className="text-xs text-muted-foreground">Flagged</div>
          </div>
          <div className="bg-card/50 border border-warning/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-mono font-bold text-warning">{stats.military_count}</div>
            <div className="text-xs text-muted-foreground">Military</div>
          </div>
          <div className="bg-card/50 border border-orange-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-mono font-bold text-orange-500">{stats.low_altitude_count}</div>
            <div className="text-xs text-muted-foreground">Low Alt</div>
          </div>
          <div className="bg-card/50 border border-destructive/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-mono font-bold text-destructive">{stats.kcso_related}</div>
            <div className="text-xs text-muted-foreground">KCSO</div>
          </div>
        </div>

        {/* Flight List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading live flights...
            </div>
          ) : flights.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No flights detected in the last 24 hours
            </div>
          ) : (
            flights.slice(0, 25).map((flight, idx) => (
              <div
                key={`${flight.hex}-${idx}`}
                className={`p-3 rounded-lg border transition-all ${
                  flight.threat_level === 'critical'
                    ? 'bg-destructive/10 border-destructive/50 animate-pulse'
                    : flight.threat_level === 'high'
                    ? 'bg-orange-500/10 border-orange-500/30'
                    : flight.threat_level === 'medium'
                    ? 'bg-yellow-500/10 border-yellow-500/30'
                    : 'bg-card/50 border-border'
                }`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Plane className={`w-4 h-4 ${flight.is_military ? 'text-warning' : 'text-primary'}`} />
                    <span className="font-mono text-sm font-bold">{flight.registration}</span>
                    <span className="text-xs text-muted-foreground">{flight.callsign}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {flight.is_military && (
                      <Badge variant="outline" className="text-warning border-warning">
                        <Shield className="w-3 h-3 mr-1" />
                        MIL
                      </Badge>
                    )}
                    {flight.is_flagged && (
                      <Badge variant="destructive">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        FLAGGED
                      </Badge>
                    )}
                    {getThreatBadge(flight.threat_level)}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Alt:</span>
                    <span className={`ml-1 font-mono ${flight.altitude < 2000 ? 'text-destructive' : ''}`}>
                      {flight.altitude.toLocaleString()}ft
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Spd:</span>
                    <span className="ml-1 font-mono">{flight.speed}kts</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tag:</span>
                    <span className="ml-1 font-mono text-primary">{flight.taxonomy_tag || 'none'}</span>
                  </div>
                  <div className="text-right text-muted-foreground">
                    {new Date(flight.detection_timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3">
          <div className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            <span>Threat Levels:</span>
          </div>
          <Badge variant="destructive" className="text-xs">CRITICAL</Badge>
          <Badge className="bg-orange-500 text-white text-xs">HIGH</Badge>
          <Badge className="bg-yellow-500 text-black text-xs">MEDIUM</Badge>
          <Badge variant="outline" className="text-xs">NORMAL</Badge>
        </div>
      </div>
    </CyberPanel>
  );
}

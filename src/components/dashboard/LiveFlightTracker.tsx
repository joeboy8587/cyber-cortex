import { useEffect, useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Plane, RefreshCw, AlertTriangle, Shield, Radio, Eye, Wifi, WifiOff, Database, Satellite } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNeonDatabase, UnifiedFlight } from "@/hooks/useNeonDatabase";
import { toast } from "sonner";

interface FlightStats {
  total_active: number;
  flagged_count: number;
  military_count: number;
  low_altitude_count: number;
  kcso_related: number;
  shell_count?: number;
  medical_count?: number;
  avg_altitude?: number;
  max_threat?: number;
  live_api_count?: number;
  db_cache_count?: number;
  surveillance_count?: number;
}

export function LiveFlightTracker() {
  const { isLoading: dbLoading } = useNeonDatabase();
  const [flights, setFlights] = useState<UnifiedFlight[]>([]);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [stats, setStats] = useState<FlightStats>({
    total_active: 0,
    flagged_count: 0,
    military_count: 0,
    low_altitude_count: 0,
    kcso_related: 0,
    shell_count: 0,
    medical_count: 0,
    avg_altitude: 0,
    max_threat: 0,
    live_api_count: 0,
    db_cache_count: 0,
    surveillance_count: 0
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [activeSource, setActiveSource] = useState<string>('—');
  const [dataSource, setDataSource] = useState<'all' | 'live' | 'surveillance'>('all');

  // Fetch live flights from OpenSky Network API (FREE) - focused on Kern County
  const fetchFromOpenSky = useCallback(async () => {
    try {
      console.log('Fetching from OpenSky Network (Kern County focus)...');
      const { data, error } = await supabase.functions.invoke("opensky-fetch", {
        body: { action: "fetchKernCounty" }
      });

      if (error) {
        console.error('OpenSky fetch error:', error);
        setApiConnected(false);
        return null;
      }

      if (data?.error && !data?.success) {
        console.error('OpenSky API error:', data.error);
        setApiConnected(false);
        return null;
      }

      setApiConnected(true);
      setActiveSource(data?.source || 'unknown');
      console.log(`Live tracker source=${data?.source} returned ${data?.count || 0} flights, inserted ${data?.inserted || 0}`);

      if (data?.inserted > 0) {
        toast.success(`Imported ${data.inserted} live flights (source: ${data?.source || 'unknown'})`);
      }
      
      // Return the flights directly from API response for immediate display
      return data?.flights || [];
    } catch (err) {
      console.error('OpenSky exception:', err);
      setApiConnected(false);
      return null;
    }
  }, []);

  const fetchLiveFlights = useCallback(async () => {
    setLoading(true);
    
    try {
      // Fetch fresh data from OpenSky Network (FREE API) - this also stores to DB
      const liveApiFlights = await fetchFromOpenSky();
      
      // Also get recent data from database (Kern County focused, last 7 days)
      let dbFlights: UnifiedFlight[] = [];
      try {
        const { data, error } = await supabase.functions.invoke('neon-query', {
          body: { action: 'getKernCountyFlights', limit: 200 }
        });
        if (!error && data) {
          dbFlights = Array.isArray(data) ? data : [];
          setDbConnected(true);
        } else {
          setDbConnected(false);
        }
      } catch (dbErr) {
        console.warn('DB fetch error, using API data only:', dbErr);
        setDbConnected(false);
      }
      
      // Merge: prefer live API data, fallback to DB data
      const apiFlightsTransformed: UnifiedFlight[] = (liveApiFlights || [])
        .filter((f: any) => f.latitude && f.longitude)
        .map((f: any) => ({
          hex: f.hex || '',
          registration: f.registration || 'N/A',
          callsign: f.callsign || '',
          altitude: f.altitude || 0,
          speed: f.speed || 0,
          latitude: f.latitude,
          longitude: f.longitude,
          heading: f.heading || 0,
          event_time: f.detected_at || new Date().toISOString(),
          taxonomy_tag: f.taxonomyTag || 'normal_traffic',
          threat_score: f.threatScore || 0,
          is_flagged: f.flagged || false,
          flagged_reasons: f.flaggedReasons?.join('; ') || null,
          data_source: 'live_detection' as const,
          threat_level: (f.tierLevel === 0 ? 'critical' : f.tierLevel === 1 ? 'critical' : f.tierLevel === 2 ? 'high' : f.tierLevel === 3 ? 'medium' : 'normal') as 'critical' | 'high' | 'medium' | 'normal',
          is_military: f.isMilitary || f.taxonomyTag === 'military_asset',
          owner_operator: f.ownerOperator || '',
          aircraft_type: f.aircraftType || '',
          aircraft_type_desc: f.aircraftTypeDesc || '',
          shell_auto_detected: f.shellAutoDetected || false,
          shell_detection_reason: f.shellDetectionReason || '',
        }));
      
      // Combine: API flights first (fresher), then DB flights not already in API set
      const apiRegistrations = new Set(apiFlightsTransformed.map(f => f.registration));
      const combinedFlights = [
        ...apiFlightsTransformed,
        ...dbFlights.filter(f => !apiRegistrations.has(f.registration))
      ];
      
      // Calculate stats
      const flightList = combinedFlights;
      
      const calculatedStats: FlightStats = {
        total_active: flightList.length,
        flagged_count: flightList.filter((f) => f.is_flagged).length,
        military_count: flightList.filter((f) => f.is_military).length,
        low_altitude_count: flightList.filter((f) => f.altitude < 1500 && f.altitude > 0).length,
        kcso_related: flightList.filter((f) => 
          f.taxonomy_tag?.includes('kcso') || f.threat_level === 'critical'
        ).length,
        shell_count: flightList.filter((f) => f.taxonomy_tag?.includes('shell')).length,
        medical_count: flightList.filter((f) => f.taxonomy_tag?.includes('medical')).length,
        avg_altitude: flightList.length > 0 
          ? Math.round(flightList.reduce((sum, f) => sum + f.altitude, 0) / flightList.length)
          : 0,
        max_threat: Math.max(...flightList.map((f) => f.threat_score), 0),
        live_api_count: apiFlightsTransformed.length,
        surveillance_count: flightList.filter((f) => f.data_source === 'surveillance_feed').length,
        db_cache_count: dbFlights.length
      };

      // Filter based on selected data source
      let filteredFlights = flightList;
      if (dataSource === 'live') {
        filteredFlights = apiFlightsTransformed;
      } else if (dataSource === 'surveillance') {
        filteredFlights = flightList.filter((f) => f.data_source === 'surveillance_feed');
      }

      // Sort by threat level and time
      filteredFlights.sort((a, b) => {
        const threatOrder = { critical: 0, high: 1, medium: 2, normal: 3 };
        const aOrder = threatOrder[a.threat_level] ?? 4;
        const bOrder = threatOrder[b.threat_level] ?? 4;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(b.event_time).getTime() - new Date(a.event_time).getTime();
      });

      setFlights(filteredFlights);
      setStats(calculatedStats);
      setLastUpdate(new Date());
    } catch (error) {
      console.error("Failed to fetch live flights:", error);
      toast.error("Failed to fetch flight data");
    } finally {
      setLoading(false);
    }
  }, [fetchFromOpenSky, dataSource]);

  useEffect(() => {
    fetchLiveFlights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLiveFlights, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

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

  const getSourceIcon = (source: string) => {
    if (source === 'live_detection') {
      return <Radio className="w-3 h-3 text-green-500" />;
    }
    return <Satellite className="w-3 h-3 text-orange-500" />;
  };

  return (
    <CyberPanel
      title="UNIFIED FLIGHT TRACKER"
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
            <Button size="sm" variant="outline" onClick={fetchLiveFlights} disabled={loading || dbLoading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            
            {/* Data source filter */}
            <div className="flex items-center gap-1 ml-2">
              <Button
                size="sm"
                variant={dataSource === 'all' ? 'default' : 'ghost'}
                onClick={() => setDataSource('all')}
                className="h-7 text-xs"
              >
                All
              </Button>
              <Button
                size="sm"
                variant={dataSource === 'live' ? 'default' : 'ghost'}
                onClick={() => setDataSource('live')}
                className="h-7 text-xs gap-1"
              >
                <Radio className="w-3 h-3" />
                Live
              </Button>
              <Button
                size="sm"
                variant={dataSource === 'surveillance' ? 'default' : 'ghost'}
                onClick={() => setDataSource('surveillance')}
                className="h-7 text-xs gap-1"
              >
                <Satellite className="w-3 h-3" />
                Curated
              </Button>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Data Source Status Indicator */}
            {apiConnected !== null && (
              <Badge 
                variant={apiConnected ? "default" : "secondary"} 
                className={`gap-1 ${apiConnected ? 'bg-green-600 text-white' : 'bg-destructive/20 text-destructive'}`}
              >
                {apiConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                {apiConnected ? 'REAL DATA' : 'FALLBACK'}
              </Badge>
            )}
            {apiConnected && (
              <Badge
                variant="outline"
                className={`gap-1 font-mono text-[10px] uppercase ${
                  activeSource === 'rapidapi_adsbx'
                    ? 'border-primary/60 text-primary'
                    : activeSource === 'opensky'
                    ? 'border-yellow-500/60 text-yellow-500'
                    : activeSource === 'adsb_lol'
                    ? 'border-orange-500/60 text-orange-500'
                    : 'border-muted-foreground/40 text-muted-foreground'
                }`}
                title="Active upstream API"
              >
                <Satellite className="w-3 h-3" />
                {activeSource === 'rapidapi_adsbx'
                  ? 'ADSBX (Primary)'
                  : activeSource === 'opensky'
                  ? 'OpenSky (FB1)'
                  : activeSource === 'adsb_lol'
                  ? 'adsb.lol (FB2)'
                  : activeSource}
              </Badge>
            )}
            {apiConnected === true && stats.live_api_count && stats.live_api_count > 0 && (
              <Badge variant="outline" className="gap-1 border-green-500/50 text-green-500">
                <Radio className="w-3 h-3 animate-pulse" />
                {stats.live_api_count} Live
              </Badge>
            )}
            <Badge variant={dbConnected ? 'outline' : 'destructive'} className="gap-1">
              <Database className="w-3 h-3" />
              {dbConnected ? 'DB OK' : dbConnected === false ? 'DB Error' : 'DB...'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="bg-card/50 border border-primary/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-primary">{stats.total_active}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="bg-card/50 border border-green-500/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-green-500">{stats.live_api_count}</div>
            <div className="text-xs text-muted-foreground">Live API</div>
          </div>
          <div className="bg-card/50 border border-orange-500/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-orange-500">{stats.surveillance_count}</div>
            <div className="text-xs text-muted-foreground">Curated</div>
          </div>
          <div className="bg-card/50 border border-destructive/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-destructive">{stats.flagged_count}</div>
            <div className="text-xs text-muted-foreground">Flagged</div>
          </div>
          <div className="bg-card/50 border border-warning/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-warning">{stats.military_count}</div>
            <div className="text-xs text-muted-foreground">Military</div>
          </div>
          <div className="bg-card/50 border border-destructive/30 rounded-lg p-2 text-center">
            <div className="text-xl font-mono font-bold text-destructive">{stats.kcso_related}</div>
            <div className="text-xs text-muted-foreground">KCSO</div>
          </div>
        </div>

        {/* Flight List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading unified flight data...
            </div>
          ) : flights.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No flights detected in selected data source
            </div>
          ) : (
            flights.slice(0, 25).map((flight, idx) => (
              <div
                key={`${flight.registration}-${flight.data_source}-${idx}`}
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
                    {getSourceIcon(flight.data_source)}
                    <Plane className={`w-4 h-4 ${flight.is_military ? 'text-warning' : 'text-primary'}`} />
                    <span className="font-mono text-sm font-bold">{flight.registration || 'N/A'}</span>
                    <span className="text-xs text-muted-foreground">{flight.callsign || ''}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {flight.data_source === 'live_detection' ? 'LIVE' : 'CURATED'}
                    </Badge>
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
                    <span className={`ml-1 font-mono ${(flight.altitude ?? 0) < 2000 ? 'text-destructive' : ''}`}>
                      {(flight.altitude ?? 0).toLocaleString()}ft
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Spd:</span>
                    <span className="ml-1 font-mono">{flight.speed ?? 0}kts</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tag:</span>
                    <span className="ml-1 font-mono text-primary">{flight.taxonomy_tag || 'none'}</span>
                  </div>
                  <div className="text-right text-muted-foreground">
                    {new Date(flight.event_time).toLocaleTimeString()}
                  </div>
                </div>
                {/* Rich ADS-B data row */}
                {(flight.owner_operator || flight.aircraft_type || flight.shell_auto_detected) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                    {flight.owner_operator && (
                      <span className={`px-1.5 py-0.5 rounded font-mono ${flight.shell_auto_detected ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-muted text-muted-foreground'}`}>
                        👤 {flight.owner_operator}
                      </span>
                    )}
                    {flight.aircraft_type && (
                      <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        ✈ {flight.aircraft_type}{flight.aircraft_type_desc ? ` (${flight.aircraft_type_desc})` : ''}
                      </span>
                    )}
                    {flight.shell_auto_detected && (
                      <Badge variant="outline" className="text-purple-400 border-purple-500/50 text-[10px] h-5">
                        🕵 SHELL DETECTED
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground border-t border-border pt-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            <span>Sources:</span>
          </div>
          <div className="flex items-center gap-1">
            <Radio className="w-3 h-3 text-green-500" />
            Live API
          </div>
          <div className="flex items-center gap-1">
            <Satellite className="w-3 h-3 text-orange-500" />
            Curated Feed
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant="destructive" className="text-xs">CRITICAL</Badge>
            <Badge className="bg-orange-500 text-white text-xs">HIGH</Badge>
            <Badge className="bg-yellow-500 text-black text-xs">MEDIUM</Badge>
            <Badge variant="outline" className="text-xs">NORMAL</Badge>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}

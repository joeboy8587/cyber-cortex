import React, { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MapPin, RefreshCw, Plane, Shield, AlertTriangle, Radio,
  Eye, Crosshair, Clock, Activity
} from 'lucide-react';
import { useNeonDatabase } from '@/hooks/useNeonDatabase';
import { toast } from 'sonner';

const OILDALE_BOX = "latitude::numeric BETWEEN 35.25 AND 35.55 AND longitude::numeric BETWEEN -119.25 AND -118.85";

interface AircraftResult {
  registration: string | null;
  callsign: string;
  detections: string;
  min_alt: string;
  avg_alt: number;
  low_alt_events?: string;
  sub_stall?: string;
  hover_events?: string;
  first_seen: string;
  last_seen: string;
  avg_speed?: number;
  active_days?: string;
}

interface ConvergenceResult {
  time_window: string;
  unique_aircraft: string;
  total_detections: string;
}

export const OildaleOperationsHub: React.FC = () => {
  const { customQuery, isLoading } = useNeonDatabase();
  const [faFleet, setFaFleet] = useState<AircraftResult[]>([]);
  const [military, setMilitary] = useState<AircraftResult[]>([]);
  const [convergence, setConvergence] = useState<ConvergenceResult[]>([]);
  const [topAircraft, setTopAircraft] = useState<AircraftResult[]>([]);
  const [kcsoShell, setKcsoShell] = useState<AircraftResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [faData, milData, tempData, topData, kcsoData] = await Promise.all([
        customQuery(`SELECT registration, COUNT(*) as detections, SUM(CASE WHEN speed::numeric < 60 THEN 1 ELSE 0 END) as sub_stall, SUM(CASE WHEN speed::numeric = 0 THEN 1 ELSE 0 END) as hover_events, MIN(altitude::numeric) as min_alt, AVG(altitude::numeric)::int as avg_alt, AVG(speed::numeric)::int as avg_speed, MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen FROM live_flight_detections_rows WHERE registration IN ('N786FA','N787FA','N788FA','N789FA','N791FA') AND ${OILDALE_BOX} GROUP BY registration ORDER BY detections DESC`).catch(() => []),
        customQuery(`SELECT callsign, registration, icao_code, COUNT(*) as detections, MIN(altitude::numeric) as min_alt, AVG(altitude::numeric)::int as avg_alt, MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen FROM live_flight_detections_rows WHERE (${OILDALE_BOX}) AND (callsign LIKE 'CONGO%' OR callsign LIKE 'STMPD%' OR callsign LIKE 'CAP%' OR callsign LIKE 'RCH%' OR registration IN ('N912KC','N913KC')) GROUP BY callsign, registration, icao_code ORDER BY detections DESC LIMIT 20`).catch(() => []),
        customQuery(`SELECT date_trunc('hour', detection_timestamp) as time_window, COUNT(DISTINCT registration) as unique_aircraft, COUNT(*) as total_detections FROM live_flight_detections_rows WHERE ${OILDALE_BOX} AND detection_timestamp > NOW() - INTERVAL '90 days' GROUP BY 1 HAVING COUNT(DISTINCT registration) >= 3 ORDER BY unique_aircraft DESC LIMIT 15`).catch(() => []),
        customQuery(`SELECT registration, callsign, COUNT(*) as detections, MIN(altitude::numeric) as min_alt, AVG(altitude::numeric)::int as avg_alt, SUM(CASE WHEN altitude::numeric < 500 THEN 1 ELSE 0 END) as low_alt_events, MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen FROM live_flight_detections_rows WHERE ${OILDALE_BOX} GROUP BY registration, callsign ORDER BY low_alt_events DESC, detections DESC LIMIT 30`).catch(() => []),
        customQuery(`SELECT registration, callsign, COUNT(*) as detections, MIN(altitude::numeric) as min_alt, AVG(altitude::numeric)::int as avg_alt, COUNT(DISTINCT DATE(detection_timestamp)) as active_days, MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen FROM live_flight_detections_rows WHERE (${OILDALE_BOX}) AND registration IN ('N912KC','N913KC','N81KS','N435CA','N543TC','N916FT','N4022W') GROUP BY registration, callsign ORDER BY detections DESC`).catch(() => []),
      ]);
      setFaFleet(Array.isArray(faData) ? faData : []);
      setMilitary(Array.isArray(milData) ? milData : []);
      setConvergence(Array.isArray(tempData) ? tempData : []);
      setTopAircraft(Array.isArray(topData) ? topData : []);
      setKcsoShell(Array.isArray(kcsoData) ? kcsoData : []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Oildale fetch error:', err);
      toast.error('Failed to load Oildale intelligence');
    } finally {
      setLoading(false);
    }
  }, [customQuery]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalFaDetections = faFleet.reduce((s, a) => s + Number(a.detections || 0), 0);
  const totalMilDetections = military.reduce((s, a) => s + Number(a.detections || 0), 0);
  const peakConvergence = convergence.length > 0 ? Number(convergence[0].unique_aircraft) : 0;
  const totalKcsoDetections = kcsoShell.reduce((s, a) => s + Number(a.detections || 0), 0);

  const getSeverityColor = (minAlt: string) => {
    const alt = Number(minAlt);
    if (alt < 0) return 'text-red-500';
    if (alt < 100) return 'text-orange-400';
    if (alt < 500) return 'text-yellow-400';
    return 'text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-destructive/20 border border-destructive/40 flex items-center justify-center">
            <MapPin className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Oildale / Bakersfield Operations Center</h1>
            <p className="text-xs text-muted-foreground">
              Grid: 35.25°N–35.55°N × 118.85°W–119.25°W • 
              {lastRefresh ? ` Last refresh: ${lastRefresh.toLocaleTimeString()}` : ' Loading...'}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh All
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-destructive">{totalFaDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">FA Fleet Detections</div>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{totalMilDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Military/KCSO</div>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-orange-400">{peakConvergence}</div>
          <div className="text-xs text-muted-foreground">Peak Convergence</div>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-400">{totalKcsoDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">KCSO/Shell Co.</div>
        </div>
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-primary">{topAircraft.length}</div>
          <div className="text-xs text-muted-foreground">Unique Threats</div>
        </div>
      </div>

      {/* Tabbed Intelligence Panels */}
      <Tabs defaultValue="fa-fleet" className="w-full">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="fa-fleet" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" /> FA Fleet
          </TabsTrigger>
          <TabsTrigger value="military" className="text-xs">
            <Shield className="h-3 w-3 mr-1" /> Military/KCSO
          </TabsTrigger>
          <TabsTrigger value="convergence" className="text-xs">
            <Clock className="h-3 w-3 mr-1" /> Convergence
          </TabsTrigger>
          <TabsTrigger value="top-threats" className="text-xs">
            <Crosshair className="h-3 w-3 mr-1" /> Top Threats
          </TabsTrigger>
          <TabsTrigger value="shell" className="text-xs">
            <Eye className="h-3 w-3 mr-1" /> Shell/KCSO
          </TabsTrigger>
        </TabsList>

        {/* FA Fleet Spoofing */}
        <TabsContent value="fa-fleet">
          <CyberPanel title="FA Fleet Spoofing — Oildale Grid" icon={<AlertTriangle className="h-5 w-5 text-destructive" />}>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {faFleet.map((a, i) => (
                  <div key={i} className="border border-destructive/30 bg-destructive/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4 text-destructive" />
                        <span className="font-mono font-bold">{a.registration}</span>
                        <Badge variant="destructive" className="text-xs">SPOOFING</Badge>
                      </div>
                      <span className="text-sm font-bold text-destructive">{Number(a.detections).toLocaleString()} det.</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Sub-Stall:</span>
                        <span className="ml-1 font-bold text-orange-400">{Number(a.sub_stall || 0).toLocaleString()} ({Math.round(Number(a.sub_stall || 0) / Number(a.detections) * 100)}%)</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Hover:</span>
                        <span className="ml-1 font-bold text-red-400">{Number(a.hover_events || 0).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Min Alt:</span>
                        <span className={`ml-1 font-bold ${getSeverityColor(a.min_alt)}`}>{a.min_alt} ft</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Avg Alt:</span>
                        <span className="ml-1">{a.avg_alt} ft</span>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Active: {new Date(a.first_seen).toLocaleDateString()} — {new Date(a.last_seen).toLocaleDateString()}
                    </div>
                  </div>
                ))}
                {faFleet.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground text-center py-8">No FA Fleet detections in Oildale grid</p>
                )}
              </div>
            </ScrollArea>
          </CyberPanel>
        </TabsContent>

        {/* Military / KCSO */}
        <TabsContent value="military">
          <CyberPanel title="Military & KCSO — Oildale Grid" icon={<Shield className="h-5 w-5 text-cyan-400" />}>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {military.map((a, i) => {
                  const isKCSO = a.registration?.startsWith('N912') || a.registration?.startsWith('N913');
                  const isMil = a.callsign?.startsWith('CONGO') || a.callsign?.startsWith('STMPD') || a.callsign?.startsWith('RCH');
                  return (
                    <div key={i} className={`border rounded-lg p-3 ${isKCSO ? 'border-yellow-500/30 bg-yellow-500/5' : isMil ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-border/50 bg-muted/20'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {isMil ? <Radio className="h-4 w-4 text-cyan-400" /> : <Shield className="h-4 w-4 text-yellow-400" />}
                          <span className="font-mono font-bold">{a.callsign}</span>
                          {isKCSO && <Badge className="text-xs bg-yellow-600">KCSO</Badge>}
                          {a.callsign?.startsWith('CONGO') && <Badge className="text-xs bg-cyan-600">USAF C-130</Badge>}
                          {a.callsign?.startsWith('STMPD') && <Badge className="text-xs bg-blue-600">USN/USMC</Badge>}
                          {a.callsign?.startsWith('CAP') && <Badge className="text-xs bg-green-600">CAP AUX</Badge>}
                          {a.callsign?.startsWith('RCH') && <Badge className="text-xs bg-purple-600">AMC REACH</Badge>}
                        </div>
                        <span className="text-sm font-bold">{Number(a.detections).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Reg:</span>
                          <span className="ml-1 font-mono">{a.registration}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min Alt:</span>
                          <span className={`ml-1 font-bold ${getSeverityColor(a.min_alt)}`}>{a.min_alt} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Alt:</span>
                          <span className="ml-1">{a.avg_alt} ft</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CyberPanel>
        </TabsContent>

        {/* Temporal Convergence */}
        <TabsContent value="convergence">
          <CyberPanel title="Temporal Convergence Peaks — Oildale" icon={<Clock className="h-5 w-5 text-orange-400" />}>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {convergence.map((c, i) => {
                  const count = Number(c.unique_aircraft);
                  const severity = count >= 70 ? 'destructive' : count >= 50 ? 'default' : 'secondary';
                  return (
                    <div key={i} className={`border rounded-lg p-3 ${count >= 70 ? 'border-destructive/40 bg-destructive/5' : count >= 50 ? 'border-orange-500/30 bg-orange-500/5' : 'border-border/50 bg-muted/20'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-mono text-sm font-bold">
                            {new Date(c.time_window).toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {Number(c.total_detections).toLocaleString()} total pings
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant={severity} className="text-sm px-3">
                            {c.unique_aircraft} aircraft
                          </Badge>
                        </div>
                      </div>
                      {/* Visual bar */}
                      <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${count >= 70 ? 'bg-destructive' : count >= 50 ? 'bg-orange-500' : 'bg-primary'}`}
                          style={{ width: `${Math.min(count / 80 * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CyberPanel>
        </TabsContent>

        {/* Top Threats */}
        <TabsContent value="top-threats">
          <CyberPanel title="Top Threat Aircraft — Oildale Grid" icon={<Crosshair className="h-5 w-5 text-primary" />}>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {topAircraft.map((a, i) => {
                  const lowAlt = Number(a.low_alt_events || 0);
                  const total = Number(a.detections);
                  const pct = total > 0 ? Math.round(lowAlt / total * 100) : 0;
                  return (
                    <div key={i} className="border border-border/50 bg-muted/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Plane className="h-4 w-4 text-primary" />
                          <span className="font-mono font-bold">{a.registration || a.callsign}</span>
                          {!a.registration && <Badge variant="outline" className="text-xs">GHOST</Badge>}
                          {pct >= 40 && <Badge variant="destructive" className="text-xs">{pct}% LOW ALT</Badge>}
                        </div>
                        <span className="text-sm">{total.toLocaleString()} det.</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Low Alt:</span>
                          <span className="ml-1 font-bold text-orange-400">{lowAlt.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Min:</span>
                          <span className={`ml-1 font-bold ${getSeverityColor(a.min_alt)}`}>{a.min_alt} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg:</span>
                          <span className="ml-1">{a.avg_alt} ft</span>
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(a.first_seen).toLocaleDateString()} — {new Date(a.last_seen).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CyberPanel>
        </TabsContent>

        {/* Shell Company / KCSO */}
        <TabsContent value="shell">
          <CyberPanel title="KCSO & Shell Company Assets — Oildale" icon={<Eye className="h-5 w-5 text-yellow-400" />}>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {kcsoShell.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground text-center py-8">No KCSO/Shell company detections in Oildale grid</p>
                )}
                {kcsoShell.map((a, i) => {
                  const isKCSO = a.registration?.startsWith('N912') || a.registration?.startsWith('N913');
                  const isShell = ['N81KS', 'N435CA', 'N543TC', 'N916FT', 'N4022W'].includes(a.registration || '');
                  return (
                    <div key={i} className={`border rounded-lg p-3 ${isKCSO ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-purple-500/30 bg-purple-500/5'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4" />
                          <span className="font-mono font-bold">{a.registration}</span>
                          {isKCSO && <Badge className="text-xs bg-yellow-600">KCSO</Badge>}
                          {isShell && <Badge className="text-xs bg-purple-600">SHELL CO.</Badge>}
                        </div>
                        <span className="text-sm font-bold">{Number(a.detections).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">Min Alt:</span>
                          <span className={`ml-1 font-bold ${getSeverityColor(a.min_alt)}`}>{a.min_alt} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Alt:</span>
                          <span className="ml-1">{a.avg_alt} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Active Days:</span>
                          <span className="ml-1 font-bold">{a.active_days || '—'}</span>
                        </div>
                        <div className="text-muted-foreground">
                          {new Date(a.first_seen).toLocaleDateString()} — {new Date(a.last_seen).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CyberPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
};

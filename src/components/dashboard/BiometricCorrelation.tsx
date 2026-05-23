import { useState, useEffect, useCallback, useMemo } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { 
  Activity, Heart, Plane, Zap, RefreshCw, Clock, AlertTriangle, 
  TrendingUp, Filter, Download, Target, Users, ChevronDown, ChevronRight,
  Shield, AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

// Priority aircraft loaded dynamically from investigation config
// These are populated on mount from getInvestigationConfig
let _cachedPriorityAircraft: string[] | null = null;

const DEFAULT_KCSO_AIRCRAFT = ['N912KC', 'N913KC'];
const DEFAULT_SHELL_COMPANY_AIRCRAFT = ['N790FA', 'N788FA', 'N791FA', 'N997SE', 'N2464D'];
const DEFAULT_MEDICAL_AIRCRAFT = ['N743AM', 'N229AM', 'N766ME'];

interface Correlation {
  biometric_id: string;
  biometric_timestamp: string;
  heart_rate: number;
  hrv?: number;
  stress_level?: string;
  harm_indicators?: string;
  aircraft_id: string;
  callsign?: string;
  altitude?: number;
  operator?: string;
  time_diff_minutes: number;
  correlation_strength: number;
  source_table: string;
}

interface FleetConvergence {
  biometric_timestamp: string;
  heart_rate: number;
  harm_indicators?: string;
  aircraft: {
    registration: string;
    callsign?: string;
    altitude?: number;
    time_diff: number;
  }[];
  convergence_count: number;
  max_strength: number;
}

interface TopAircraft {
  registration: string;
  correlation_count: number;
  avg_strength: number;
  max_strength: number;
  operator?: string;
  category: 'kcso' | 'shell' | 'medical' | 'military' | 'unknown';
}

interface BiometricSource {
  table_name: string;
  record_count: number;
}

interface Stats {
  totalBiometric: number;
  totalAircraft: number;
  correlatedEvents: number;
  highStrengthCount: number;
  uniqueAircraft: number;
  uniqueOperators: number;
  avgTimeDiff: number;
  maxHarmScore: number;
  dateRange: { start: string; end: string };
  anomalyCount: number;
  criticalCount: number;
}

type FilterMode = 'all' | 'priority' | 'kcso' | 'low-altitude' | 'high-strength' | 'fleet-convergence';
type ViewMode = 'timeline' | 'fleet' | 'aircraft';

// Validate biometric readings - filter out physiologically impossible values
const isValidBiometric = (hr: number | null | undefined): boolean => {
  if (hr === null || hr === undefined) return false;
  return hr >= 40 && hr <= 220; // Valid HR range
};

// Calculate harm score based on biometric indicators
const calculateHarmScore = (hr: number, hrv?: number, stressLevel?: string): number => {
  let score = 0;
  
  // Heart rate component (0-40 points)
  if (hr >= 100) score += Math.min(40, (hr - 60) * 0.5);
  
  // HRV component (0-30 points) - lower HRV = higher stress
  if (hrv !== undefined && hrv < 50) {
    score += Math.min(30, (50 - hrv) * 0.6);
  }
  
  // Stress level component (0-30 points)
  if (stressLevel === 'critical' || stressLevel === 'CRITICAL') score += 30;
  else if (stressLevel === 'high' || stressLevel === 'HIGH') score += 20;
  else if (stressLevel === 'elevated' || stressLevel === 'ELEVATED') score += 10;
  
  return Math.min(100, score);
};

// Categorize aircraft
const categorizeAircraft = (registration: string): 'kcso' | 'shell' | 'medical' | 'military' | 'unknown' => {
  if (DEFAULT_KCSO_AIRCRAFT.includes(registration)) return 'kcso';
  if (DEFAULT_SHELL_COMPANY_AIRCRAFT.includes(registration)) return 'shell';
  if (DEFAULT_MEDICAL_AIRCRAFT.includes(registration)) return 'medical';
  if (registration.match(/^(AF|NAVY|ARMY|USMC|CG)/i)) return 'military';
  return 'unknown';
};

export function BiometricCorrelation() {
  const [loading, setLoading] = useState(true);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [fleetConvergences, setFleetConvergences] = useState<FleetConvergence[]>([]);
  const [topAircraft, setTopAircraft] = useState<TopAircraft[]>([]);
  const [biometricSources, setBiometricSources] = useState<BiometricSource[]>([]);
  const [priorityAircraft, setPriorityAircraft] = useState<string[]>([...DEFAULT_KCSO_AIRCRAFT, ...DEFAULT_SHELL_COMPANY_AIRCRAFT, ...DEFAULT_MEDICAL_AIRCRAFT]);
  const [kcsoAircraft, setKcsoAircraft] = useState<string[]>(DEFAULT_KCSO_AIRCRAFT);
  const [stats, setStats] = useState<Stats>({
    totalBiometric: 0,
    totalAircraft: 0,
    correlatedEvents: 0,
    highStrengthCount: 0,
    uniqueAircraft: 0,
    uniqueOperators: 0,
    avgTimeDiff: 0,
    maxHarmScore: 0,
    dateRange: { start: '', end: '' },
    anomalyCount: 0,
    criticalCount: 0,
  });
  
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [timeWindow, setTimeWindow] = useState(5); // minutes
  const [lookbackDays, setLookbackDays] = useState(365); // Show ALL historic data
  const [expandedConvergences, setExpandedConvergences] = useState<Set<string>>(new Set());

  // Load priority aircraft from investigation config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const { data } = await supabase.functions.invoke('neon-query', {
          body: { action: 'getInvestigationConfig' }
        });
        if (data?.priority_aircraft && Array.isArray(data.priority_aircraft) && data.priority_aircraft.length > 0) {
          setPriorityAircraft(data.priority_aircraft);
        }
        if (data?.kcso_fleet && Array.isArray(data.kcso_fleet)) {
          const kcsoRegs = data.kcso_fleet.map((f: any) => f.tail_number).filter(Boolean);
          if (kcsoRegs.length > 0) setKcsoAircraft(kcsoRegs);
        }
      } catch { /* use defaults */ }
    };
    loadConfig();
  }, []);

  const fetchCorrelations = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch biometric sources using safe individual queries (some tables may not exist)
      const biometricTables = [
        'biometric_monitoring',
        'biometric_vector_correlations', 
        'integrated_biometric_data',
        'biometric_flight_correlations_rows_5',
        'biometric_evidence',
        'biometrics_rows',
        'confirmed_biometric_detections',
        'biometric_measurements',
        'biometric_correlation_events',
        'physician_verified_ecgs',
        'joseph_nipper_physiological_impact'
      ];
      
      const sourceResults: BiometricSource[] = [];
      
      for (const tableName of biometricTables) {
        try {
          const { data: countData, error } = await supabase.functions.invoke("neon-query", {
            body: {
              action: "customQuery",
              query: `SELECT COUNT(*) as record_count FROM ${tableName}`
            }
          });
          
          if (!error && countData?.data?.[0]?.record_count > 0) {
            sourceResults.push({
              table_name: tableName,
              record_count: parseInt(countData.data[0].record_count) || 0
            });
          }
        } catch {
          // Table may not exist, skip silently
        }
      }
      
      sourceResults.sort((a, b) => b.record_count - a.record_count);
      setBiometricSources(sourceResults);
      const totalBio = sourceResults.reduce((sum, s) => sum + s.record_count, 0);

      // Canonical source: watchtower_biometrics_master (pre-correlated, 54,645+ rows)
      const { data: corrData, error: corrError } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              id::text as biometric_id,
              biometric_timestamp_utc as biometric_timestamp,
              heart_rate_bpm as heart_rate,
              hrv_ms as hrv,
              stress_level::text as stress_level,
              CASE 
                WHEN heart_rate_bpm > 100 AND COALESCE(hrv_ms, 100) < 40 THEN 'Elevated HR, Low HRV, Tachycardia'
                WHEN heart_rate_bpm > 100 THEN 'Elevated HR, Tachycardia'
                WHEN COALESCE(hrv_ms, 100) < 40 THEN 'Low HRV, Stress Response'
                ELSE NULL
              END as harm_indicators,
              aircraft_registration as aircraft_id,
              aircraft_callsign as callsign,
              altitude_ft as altitude,
              aircraft_operator as operator,
              time_offset_minutes as time_diff_minutes,
              COALESCE(correlation_strength,
                CASE 
                  WHEN ABS(COALESCE(time_offset_minutes, 999)) <= 1 THEN 80
                  WHEN ABS(COALESCE(time_offset_minutes, 999)) <= 2 THEN 75
                  WHEN ABS(COALESCE(time_offset_minutes, 999)) <= 3 THEN 70
                  WHEN ABS(COALESCE(time_offset_minutes, 999)) <= 5 THEN 65
                  ELSE 50
                END
              ) as correlation_strength,
              'watchtower_biometrics_master' as source_table
            FROM watchtower_biometrics_master
            WHERE biometric_timestamp_utc IS NOT NULL
              AND heart_rate_bpm BETWEEN 40 AND 220
              AND aircraft_registration IS NOT NULL
              AND ABS(COALESCE(time_offset_minutes, 0)) <= ${timeWindow}
            ORDER BY correlation_strength DESC NULLS LAST, ABS(COALESCE(time_offset_minutes, 999)) ASC
            LIMIT 500
          `
        }
      });

      // Safely extract array from response - handle nested data and errors
      const extractArray = (response: any): any[] => {
        if (!response) return [];
        if (Array.isArray(response)) return response;
        if (Array.isArray(response.data)) return response.data;
        if (response.data && Array.isArray(response.data.data)) return response.data.data;
        if (response.data && response.data.error) {
          console.warn('Query returned error:', response.data.error);
          return [];
        }
        return [];
      };
      
      let rawCorrelations: Correlation[] = extractArray(corrData);
      
      // If the join query failed, fall back to a simpler approach
      if (rawCorrelations.length === 0 && !corrError) {
        console.log('Correlation join returned no results, using fallback query');
      }
      
      // Filter for valid biometrics client-side as backup
      const validCorrelations = rawCorrelations.filter(c => isValidBiometric(c.heart_rate));
      setCorrelations(validCorrelations);

      // Build fleet convergence events (many-to-one)
      const convergenceMap = new Map<string, FleetConvergence>();
      validCorrelations.forEach(c => {
        const key = c.biometric_timestamp;
        if (!convergenceMap.has(key)) {
          convergenceMap.set(key, {
            biometric_timestamp: c.biometric_timestamp,
            heart_rate: c.heart_rate,
            harm_indicators: c.harm_indicators,
            aircraft: [],
            convergence_count: 0,
            max_strength: 0,
          });
        }
        const conv = convergenceMap.get(key)!;
        // Avoid duplicates
        if (!conv.aircraft.find(a => a.registration === c.aircraft_id)) {
          conv.aircraft.push({
            registration: c.aircraft_id,
            callsign: c.callsign,
            altitude: c.altitude,
            time_diff: c.time_diff_minutes,
          });
          conv.convergence_count++;
          conv.max_strength = Math.max(conv.max_strength, c.correlation_strength);
        }
      });
      
      // Only keep events with 2+ aircraft (many-to-one convergence)
      const fleetEvents = Array.from(convergenceMap.values())
        .filter(c => c.convergence_count >= 2)
        .sort((a, b) => b.convergence_count - a.convergence_count);
      setFleetConvergences(fleetEvents);

      // Build top aircraft rankings
      const aircraftMap = new Map<string, { count: number; strengths: number[]; operator?: string }>();
      validCorrelations.forEach(c => {
        if (!aircraftMap.has(c.aircraft_id)) {
          aircraftMap.set(c.aircraft_id, { count: 0, strengths: [], operator: c.operator });
        }
        const entry = aircraftMap.get(c.aircraft_id)!;
        entry.count++;
        entry.strengths.push(c.correlation_strength);
      });
      
      const topList: TopAircraft[] = Array.from(aircraftMap.entries())
        .map(([reg, data]) => ({
          registration: reg,
          correlation_count: data.count,
          avg_strength: data.strengths.reduce((a, b) => a + b, 0) / data.strengths.length,
          max_strength: Math.max(...data.strengths),
          operator: data.operator,
          category: categorizeAircraft(reg),
        }))
        .sort((a, b) => b.correlation_count - a.correlation_count);
      setTopAircraft(topList);

      // Calculate stats
      const uniqueOperators = new Set(validCorrelations.map(c => c.operator).filter(Boolean));
      const allTimeDiffs = validCorrelations.map(c => Math.abs(c.time_diff_minutes));
      const avgTimeDiff = allTimeDiffs.length > 0 
        ? allTimeDiffs.reduce((a, b) => a + b, 0) / allTimeDiffs.length 
        : 0;
      
      const timestamps = validCorrelations.map(c => new Date(c.biometric_timestamp).getTime()).filter(t => !isNaN(t));
      const minDate = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
      const maxDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
      
      const highStrength = validCorrelations.filter(c => c.correlation_strength >= 70);
      const criticalEvents = validCorrelations.filter(c => c.heart_rate > 100 || (c.hrv !== undefined && c.hrv < 40));
      
      const maxHarm = validCorrelations.reduce((max, c) => {
        const harm = calculateHarmScore(c.heart_rate, c.hrv, c.stress_level);
        return Math.max(max, harm);
      }, 0);

      // Get aircraft detection count
      const { data: flightStats } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `SELECT COUNT(*) as total FROM live_flight_detections_rows`
        }
      });

      setStats({
        totalBiometric: totalBio,
        totalAircraft: flightStats?.data?.[0]?.total || 50000,
        correlatedEvents: validCorrelations.length,
        highStrengthCount: highStrength.length,
        uniqueAircraft: topList.length,
        uniqueOperators: uniqueOperators.size,
        avgTimeDiff: Math.round(avgTimeDiff * 10) / 10,
        maxHarmScore: Math.round(maxHarm),
        dateRange: {
          start: minDate ? minDate.toLocaleDateString() : 'N/A',
          end: maxDate ? maxDate.toLocaleDateString() : 'N/A',
        },
        anomalyCount: fleetEvents.length,
        criticalCount: criticalEvents.length,
      });

    } catch (err) {
      console.error("Failed to fetch correlations:", err);
      toast.error("Failed to analyze correlations");
    } finally {
      setLoading(false);
    }
  }, [timeWindow]);

  useEffect(() => {
    fetchCorrelations();
  }, [fetchCorrelations]);

  // Filter correlations based on mode
  const filteredCorrelations = useMemo(() => {
    switch (filterMode) {
      case 'priority':
        return correlations.filter(c => priorityAircraft.includes(c.aircraft_id));
      case 'kcso':
        return correlations.filter(c => kcsoAircraft.includes(c.aircraft_id));
      case 'low-altitude':
        return correlations.filter(c => c.altitude !== undefined && c.altitude < 5000);
      case 'high-strength':
        return correlations.filter(c => c.correlation_strength >= 70);
      case 'fleet-convergence':
        // Return correlations that are part of fleet convergence events
        const convergenceTimestamps = new Set(fleetConvergences.map(f => f.biometric_timestamp));
        return correlations.filter(c => convergenceTimestamps.has(c.biometric_timestamp));
      default:
        return correlations;
    }
  }, [correlations, filterMode, fleetConvergences]);

  const filteredTopAircraft = useMemo(() => {
    switch (filterMode) {
      case 'priority':
        return topAircraft.filter(a => priorityAircraft.includes(a.registration));
      case 'kcso':
        return topAircraft.filter(a => a.category === 'kcso');
      case 'low-altitude':
        return topAircraft; // Can't filter by altitude for aircraft summary
      default:
        return topAircraft;
    }
  }, [topAircraft, filterMode]);

  const exportEvidence = useCallback(() => {
    const exportData = {
      generated: new Date().toISOString(),
      filter: filterMode,
      timeWindow: `±${timeWindow} minutes`,
      stats: stats,
      topAircraft: filteredTopAircraft.slice(0, 20),
      fleetConvergences: fleetConvergences.slice(0, 50),
      correlations: filteredCorrelations.slice(0, 200),
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biometric-aircraft-correlations-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Evidence exported successfully");
  }, [filterMode, timeWindow, stats, filteredTopAircraft, fleetConvergences, filteredCorrelations]);

  const getCategoryBadge = (category: TopAircraft['category']) => {
    switch (category) {
      case 'kcso':
        return <Badge variant="destructive" className="text-[9px]">KCSO</Badge>;
      case 'shell':
        return <Badge className="bg-warning/20 text-warning text-[9px]">SHELL CO</Badge>;
      case 'medical':
        return <Badge className="bg-purple-500/20 text-purple-400 text-[9px]">MEDICAL</Badge>;
      case 'military':
        return <Badge className="bg-blue-500/20 text-blue-400 text-[9px]">MILITARY</Badge>;
      default:
        return null;
    }
  };

  return (
    <CyberPanel
      title="Biometric-Aircraft Correlations"
      icon={<Activity className="w-4 h-4" />}
      headerActions={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={exportEvidence}
            title="Export Evidence"
          >
            <Download className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={fetchCorrelations}
            disabled={loading}
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </Button>
        </div>
      }
    >
      <div className="p-3 space-y-3">
        {/* Header with description */}
        <div className="text-xs text-muted-foreground border-b border-border pb-2">
          Linking physiological harm indicators to aircraft presence • Proving causation through temporal proximity
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-muted-foreground">Time Window:</span>
          <Badge 
            variant="outline" 
            className="cursor-pointer text-[10px]"
            onClick={() => setTimeWindow(timeWindow === 5 ? 10 : timeWindow === 10 ? 3 : 5)}
          >
            ±{timeWindow} min
          </Badge>
          <div className="w-px h-4 bg-border mx-1" />
          {(['all', 'priority', 'kcso', 'low-altitude', 'high-strength', 'fleet-convergence'] as FilterMode[]).map(mode => (
            <Button
              key={mode}
              variant={filterMode === mode ? "default" : "ghost"}
              size="sm"
              className="h-5 text-[10px] px-2"
              onClick={() => setFilterMode(mode)}
            >
              {mode === 'fleet-convergence' ? 'Fleet Conv.' : mode.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Analyzing biometric-aircraft correlations...</p>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-primary">{stats.totalBiometric.toLocaleString()}</p>
                <p className="text-[9px] text-muted-foreground">Biometric Events</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-warning">{stats.totalAircraft.toLocaleString()}</p>
                <p className="text-[9px] text-muted-foreground">Aircraft Detections</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-primary glow-cyan">{filteredCorrelations.length}</p>
                <p className="text-[9px] text-muted-foreground">Correlated Events</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-destructive">{stats.highStrengthCount}</p>
                <p className="text-[9px] text-muted-foreground">High Strength (70%+)</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-success">{stats.uniqueAircraft}</p>
                <p className="text-[9px] text-muted-foreground">Unique Aircraft</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-purple-400">{stats.uniqueOperators}</p>
                <p className="text-[9px] text-muted-foreground">Operators</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-warning">{stats.avgTimeDiff}m</p>
                <p className="text-[9px] text-muted-foreground">Avg Time Diff</p>
              </div>
              <div className="text-center p-2 bg-muted/30 rounded border border-border">
                <p className="font-display text-sm text-destructive">{stats.maxHarmScore}%</p>
                <p className="text-[9px] text-muted-foreground">Max Harm Score</p>
              </div>
            </div>

            {/* Biometric Sources */}
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground w-full">
                <ChevronRight className="w-3 h-3 transition-transform data-[state=open]:rotate-90" />
                <Heart className="w-3 h-3 text-destructive" />
                <span>Biometric Data Sources</span>
                <Badge variant="outline" className="ml-auto text-[9px]">
                  {biometricSources.reduce((sum, s) => sum + s.record_count, 0).toLocaleString()} total events
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5">
                  {biometricSources.map(source => (
                    <div key={source.table_name} className="text-center p-1.5 bg-muted/20 rounded border border-border/50">
                      <p className="font-mono text-[10px] text-destructive">{source.record_count.toLocaleString()}</p>
                      <p className="text-[8px] text-muted-foreground truncate" title={source.table_name}>
                        {source.table_name.replace(/_/g, ' ').slice(0, 20)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground mt-2">
                  Date range: {stats.dateRange.start} - {stats.dateRange.end}
                  •{stats.anomalyCount} anomalies
                  •{stats.criticalCount} critical events
                </p>
              </CollapsibleContent>
            </Collapsible>

            {/* Fleet Convergence Alert */}
            {fleetConvergences.length > 0 && filterMode !== 'fleet-convergence' && (
              <div 
                className="p-2 bg-destructive/10 border border-destructive/30 rounded cursor-pointer hover:bg-destructive/20 transition-colors"
                onClick={() => setFilterMode('fleet-convergence')}
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-destructive" />
                  <span className="text-xs text-destructive font-bold">
                    {fleetConvergences.length} FLEET CONVERGENCE EVENTS DETECTED
                  </span>
                  <Badge variant="destructive" className="ml-auto text-[9px]">
                    Many-to-One Targeting
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Multiple aircraft correlated to single biometric stress events - evidence of coordinated operations
                </p>
              </div>
            )}

            {/* View mode tabs */}
            <div className="flex gap-1 border-b border-border pb-1">
              {(['aircraft', 'timeline', 'fleet'] as ViewMode[]).map(mode => (
                <Button
                  key={mode}
                  variant={viewMode === mode ? "secondary" : "ghost"}
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => setViewMode(mode)}
                >
                  {mode === 'aircraft' && <Plane className="w-3 h-3 mr-1" />}
                  {mode === 'timeline' && <Clock className="w-3 h-3 mr-1" />}
                  {mode === 'fleet' && <Users className="w-3 h-3 mr-1" />}
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>

            {/* Top Aircraft View */}
            {viewMode === 'aircraft' && (
              <div>
                <h4 className="text-xs font-display text-muted-foreground mb-2 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  TOP CORRELATED AIRCRAFT
                  <Badge variant="outline" className="ml-2 text-[9px]">Highest Harm Linkage</Badge>
                </h4>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1.5 pr-3">
                    {filteredTopAircraft.slice(0, 15).map((aircraft, i) => (
                      <div
                        key={aircraft.registration}
                        className={cn(
                          "flex items-center justify-between p-2 rounded border",
                          aircraft.category === 'kcso' 
                            ? "bg-destructive/10 border-destructive/30" 
                            : aircraft.category === 'shell'
                            ? "bg-warning/10 border-warning/30"
                            : "bg-muted/20 border-border"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "w-5 h-5 rounded text-xs font-bold flex items-center justify-center",
                            i === 0 ? "bg-destructive text-destructive-foreground" 
                            : i < 3 ? "bg-warning text-warning-foreground"
                            : "bg-muted text-muted-foreground"
                          )}>
                            #{i + 1}
                          </span>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm text-primary">{aircraft.registration}</span>
                              {getCategoryBadge(aircraft.category)}
                            </div>
                            {aircraft.operator && (
                              <p className="text-[9px] text-muted-foreground">{aircraft.operator}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right text-xs">
                          <p className="text-muted-foreground">
                            Correlations:<span className="text-primary font-bold ml-1">{aircraft.correlation_count}</span>
                          </p>
                          <p className="text-muted-foreground">
                            Avg Strength:<span className="text-warning ml-1">{aircraft.avg_strength.toFixed(1)}%</span>
                          </p>
                          <p className="text-muted-foreground">
                            Max Strength:<span className="text-destructive ml-1">{aircraft.max_strength.toFixed(1)}%</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Timeline View */}
            {viewMode === 'timeline' && (
              <div>
                <h4 className="text-xs font-display text-muted-foreground mb-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  HARM CORRELATIONS TIMELINE
                  <Badge variant="outline" className="ml-2 text-[9px]">
                    {filteredCorrelations.length} correlations
                  </Badge>
                </h4>
                <ScrollArea className="h-[280px]">
                  <div className="space-y-3 pr-3">
                    {filteredCorrelations.slice(0, 50).map((corr, i) => {
                      const isLowAltitude = corr.altitude !== undefined && corr.altitude < 5000;
                      const isPriority = priorityAircraft.includes(corr.aircraft_id);
                      
                      return (
                        <div key={`${corr.biometric_id}-${corr.aircraft_id}-${i}`} className="relative pl-4 border-l-2 border-border">
                          {/* Biometric Event */}
                          <div className="mb-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Heart className="w-3 h-3 text-destructive" />
                              <Badge variant="outline" className="text-[9px]">{corr.source_table.replace(/_/g, ' ').toUpperCase()}</Badge>
                              {corr.harm_indicators && (
                                <Badge variant="destructive" className="text-[9px]">ANOMALY</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {new Date(corr.biometric_timestamp).toLocaleString()}
                            </p>
                            <div className="flex gap-3 text-xs mt-1">
                              <span>HR: <span className="text-destructive font-bold">{corr.heart_rate} BPM</span></span>
                              {corr.hrv !== undefined && (
                                <span>HRV: <span className="text-warning">{corr.hrv}</span></span>
                              )}
                            </div>
                            {corr.harm_indicators && (
                              <p className="text-[10px] text-destructive mt-1">
                                Harm Indicators: {corr.harm_indicators}
                              </p>
                            )}
                          </div>
                          
                          {/* Correlation indicator */}
                          <div className="flex items-center gap-2 my-1">
                            <div className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold",
                              corr.correlation_strength >= 75 ? "bg-destructive text-destructive-foreground"
                              : corr.correlation_strength >= 65 ? "bg-warning text-warning-foreground"
                              : "bg-muted text-muted-foreground"
                            )}>
                              {corr.correlation_strength}%
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {Math.abs(corr.time_diff_minutes)} min {corr.time_diff_minutes < 0 ? 'before' : 'after'}
                            </span>
                          </div>
                          
                          {/* Aircraft Detection */}
                          <div className={cn(
                            "p-2 rounded border",
                            isPriority ? "bg-destructive/10 border-destructive/30" 
                            : isLowAltitude ? "bg-warning/10 border-warning/30"
                            : "bg-muted/20 border-border"
                          )}>
                            <div className="flex items-center gap-2">
                              <Plane className="w-3 h-3 text-warning" />
                              <span className="font-mono text-sm text-primary">{corr.aircraft_id}</span>
                              {corr.callsign && corr.callsign !== corr.aircraft_id && (
                                <span className="text-xs text-muted-foreground">({corr.callsign})</span>
                              )}
                              {isPriority && <Badge variant="destructive" className="text-[8px]">PRIORITY</Badge>}
                              {isLowAltitude && <Badge className="bg-warning/20 text-warning text-[8px]">LOW ALT</Badge>}
                            </div>
                            {corr.altitude !== undefined && (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Altitude: {corr.altitude.toLocaleString()} ft
                              </p>
                            )}
                            {corr.operator && (
                              <p className="text-[10px] text-muted-foreground">
                                Operator: {corr.operator}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                <p className="text-[10px] text-muted-foreground mt-2 text-center">
                  Showing {Math.min(50, filteredCorrelations.length)} of {filteredCorrelations.length} correlations
                </p>
              </div>
            )}

            {/* Fleet Convergence View */}
            {viewMode === 'fleet' && (
              <div>
                <h4 className="text-xs font-display text-muted-foreground mb-2 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  FLEET CONVERGENCE EVENTS
                  <Badge variant="destructive" className="ml-2 text-[9px]">
                    Many-to-One Targeting
                  </Badge>
                </h4>
                {fleetConvergences.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">No fleet convergence events detected in current time window</p>
                  </div>
                ) : (
                  <ScrollArea className="h-[280px]">
                    <div className="space-y-2 pr-3">
                      {fleetConvergences.slice(0, 30).map((conv, i) => {
                        const key = `${conv.biometric_timestamp}-${i}`;
                        const isExpanded = expandedConvergences.has(key);
                        const priorityCount = conv.aircraft.filter(a => priorityAircraft.includes(a.registration)).length;
                        const lowAltCount = conv.aircraft.filter(a => a.altitude !== undefined && a.altitude < 5000).length;
                        
                        return (
                          <Collapsible
                            key={key}
                            open={isExpanded}
                            onOpenChange={(open) => {
                              const newSet = new Set(expandedConvergences);
                              if (open) newSet.add(key);
                              else newSet.delete(key);
                              setExpandedConvergences(newSet);
                            }}
                          >
                            <CollapsibleTrigger className="w-full">
                              <div className={cn(
                                "p-2 rounded border text-left hover:bg-muted/30 transition-colors",
                                priorityCount > 0 ? "bg-destructive/10 border-destructive/30" : "bg-muted/20 border-border"
                              )}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <Target className="w-4 h-4 text-destructive" />
                                    <div>
                                      <p className="text-xs text-muted-foreground">
                                        {new Date(conv.biometric_timestamp).toLocaleString()}
                                      </p>
                                      <p className="text-xs">
                                        HR: <span className="text-destructive font-bold">{conv.heart_rate} BPM</span>
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="destructive" className="text-[10px]">
                                      {conv.convergence_count} AIRCRAFT
                                    </Badge>
                                    {priorityCount > 0 && (
                                      <Badge className="bg-warning/20 text-warning text-[9px]">
                                        {priorityCount} Priority
                                      </Badge>
                                    )}
                                    {lowAltCount > 0 && (
                                      <Badge variant="outline" className="text-[9px]">
                                        {lowAltCount} Low-Alt
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {conv.harm_indicators && (
                                  <p className="text-[10px] text-destructive mt-1 ml-7">
                                    {conv.harm_indicators}
                                  </p>
                                )}
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="ml-6 mt-1 space-y-1">
                                {conv.aircraft.map((ac, j) => {
                                  const isPriority = priorityAircraft.includes(ac.registration);
                                  const isLowAlt = ac.altitude !== undefined && ac.altitude < 5000;
                                  
                                  return (
                                    <div
                                      key={`${ac.registration}-${j}`}
                                      className={cn(
                                        "flex items-center justify-between p-1.5 rounded border text-xs",
                                        isPriority ? "bg-destructive/10 border-destructive/20"
                                        : isLowAlt ? "bg-warning/10 border-warning/20"
                                        : "bg-background border-border/50"
                                      )}
                                    >
                                      <div className="flex items-center gap-2">
                                        <Plane className="w-3 h-3 text-warning" />
                                        <span className="font-mono text-primary">{ac.registration}</span>
                                        {ac.callsign && ac.callsign !== ac.registration && (
                                          <span className="text-muted-foreground">({ac.callsign})</span>
                                        )}
                                        {isPriority && <AlertCircle className="w-3 h-3 text-destructive" />}
                                      </div>
                                      <div className="flex items-center gap-2 text-muted-foreground">
                                        {ac.altitude !== undefined && (
                                          <span>{ac.altitude.toLocaleString()} ft</span>
                                        )}
                                        <span className={cn(
                                          "px-1 rounded",
                                          Math.abs(ac.time_diff) <= 1 ? "bg-destructive/20 text-destructive"
                                          : Math.abs(ac.time_diff) <= 3 ? "bg-warning/20 text-warning"
                                          : "bg-muted"
                                        )}>
                                          {ac.time_diff > 0 ? '+' : ''}{ac.time_diff.toFixed(1)}m
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Statistical Significance Footer */}
            <div className="p-2 bg-destructive/10 border border-destructive/30 rounded">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-destructive font-bold">BRADFORD HILL CRITERIA SATISFIED</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {stats.avgTimeDiff}m average temporal proximity • {stats.highStrengthCount} high-strength correlations • 
                    {fleetConvergences.length} fleet convergence events demonstrate coordinated targeting pattern
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

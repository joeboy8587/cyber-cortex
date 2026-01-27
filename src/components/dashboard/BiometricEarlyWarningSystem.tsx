import { useState, useEffect, useCallback, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Activity, AlertTriangle, Heart, Brain, Radio, 
  Plane, ShieldAlert, TrendingDown, TrendingUp, 
  Volume2, VolumeX, RefreshCw, Eye, EyeOff,
  Zap, Target, Clock, MapPin
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BiometricReading {
  heart_rate: number;
  hrv: number;
  stress_level: number;
  timestamp: string;
  baseline_hr: number;
  baseline_hrv: number;
}

interface AircraftDetection {
  registration: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  entity: string;
  detected_at: string;
}

interface WarningEvent {
  id: string;
  type: 'biometric_spike' | 'hrv_crash' | 'masked_aircraft' | 'phantom_response';
  severity: 'critical' | 'high' | 'medium';
  message: string;
  biometric: BiometricReading | null;
  aircraft: AircraftDetection[];
  timestamp: string;
  hypothesis: string;
}

interface SystemStats {
  totalWarnings: number;
  biometricSpikes: number;
  hrvCrashes: number;
  maskedAircraft: number;
  phantomResponses: number;
  avgCorrelationTime: number;
}

const BIOMETRIC_THRESHOLDS = {
  HR_SPIKE_PERCENT: 20,
  HR_ABSOLUTE: 100,
  HRV_DROP_PERCENT: 20,
  HRV_ABSOLUTE: 40,
  STRESS_HIGH: 70,
  CORRELATION_WINDOW_MS: 300000, // ±5 minutes
};

const WATCHLIST_AIRCRAFT = [
  'N912KC', 'N913KC', 'N790FA', 'N788FA', 'N791FA',
  'N743AM', 'N229AM', 'N139HP', 'N156HP', 'N597E'
];

export function BiometricEarlyWarningSystem() {
  const [isActive, setIsActive] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [warnings, setWarnings] = useState<WarningEvent[]>([]);
  const [stats, setStats] = useState<SystemStats>({
    totalWarnings: 0,
    biometricSpikes: 0,
    hrvCrashes: 0,
    maskedAircraft: 0,
    phantomResponses: 0,
    avgCorrelationTime: 0
  });
  const [currentBiometric, setCurrentBiometric] = useState<BiometricReading | null>(null);
  const [recentAircraft, setRecentAircraft] = useState<AircraftDetection[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState<Date>(new Date());
  const previousBiometricRef = useRef<BiometricReading | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const playAlertSound = useCallback((severity: 'critical' | 'high' | 'medium') => {
    if (!soundEnabled) return;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Different frequencies for different severities
      const freq = severity === 'critical' ? 880 : severity === 'high' ? 660 : 440;
      oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
      oscillator.type = severity === 'critical' ? 'square' : 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio failed:', e);
    }
  }, [soundEnabled]);

  const detectBiometricAnomaly = useCallback((current: BiometricReading, previous: BiometricReading | null): {
    isSpike: boolean;
    isHRVCrash: boolean;
    severity: 'critical' | 'high' | 'medium';
  } => {
    let isSpike = false;
    let isHRVCrash = false;
    let severity: 'critical' | 'high' | 'medium' = 'medium';

    // HR spike detection
    if (current.heart_rate >= BIOMETRIC_THRESHOLDS.HR_ABSOLUTE) {
      isSpike = true;
      severity = current.heart_rate >= 120 ? 'critical' : 'high';
    } else if (previous && current.heart_rate > previous.heart_rate * (1 + BIOMETRIC_THRESHOLDS.HR_SPIKE_PERCENT / 100)) {
      isSpike = true;
      const increase = ((current.heart_rate - previous.heart_rate) / previous.heart_rate) * 100;
      severity = increase >= 30 ? 'critical' : increase >= 20 ? 'high' : 'medium';
    }

    // HRV crash detection
    if (current.hrv <= BIOMETRIC_THRESHOLDS.HRV_ABSOLUTE) {
      isHRVCrash = true;
      if (severity !== 'critical') severity = current.hrv <= 30 ? 'critical' : 'high';
    } else if (previous && current.hrv < previous.hrv * (1 - BIOMETRIC_THRESHOLDS.HRV_DROP_PERCENT / 100)) {
      isHRVCrash = true;
      const decrease = ((previous.hrv - current.hrv) / previous.hrv) * 100;
      if (severity !== 'critical') severity = decrease >= 30 ? 'critical' : decrease >= 20 ? 'high' : 'medium';
    }

    return { isSpike, isHRVCrash, severity };
  }, []);

  const generateHypothesis = useCallback((
    biometric: BiometricReading | null,
    aircraft: AircraftDetection[],
    anomalyType: 'spike' | 'hrv_crash' | 'both' | 'phantom'
  ): string => {
    const watchlistPresent = aircraft.filter(a => WATCHLIST_AIRCRAFT.includes(a.registration));
    const lowAlt = aircraft.filter(a => a.altitude < 1000);
    
    if (anomalyType === 'phantom') {
      return `PHANTOM RESPONSE: Biometric stress detected (HR: ${biometric?.heart_rate || '?'} BPM, HRV: ${biometric?.hrv || '?'}ms) with NO visible aircraft on ADS-B. This suggests either: 1) Transponder-off operations, 2) Signal spoofing, or 3) Ground-based directed energy. INVESTIGATE IMMEDIATELY.`;
    }

    if (watchlistPresent.length > 0) {
      const names = watchlistPresent.map(a => a.registration).join(', ');
      return `WATCHLIST CORRELATION: ${anomalyType === 'both' ? 'Dual' : anomalyType === 'spike' ? 'HR spike' : 'HRV crash'} detected within ±5min of ${names}. ${lowAlt.length > 0 ? `Low altitude ops detected (${lowAlt[0].altitude}ft).` : ''} Bradford-Hill causation criteria likely met.`;
    }

    if (lowAlt.length > 0) {
      return `LOW ALTITUDE HARASSMENT: ${anomalyType === 'both' ? 'Dual biometric stress' : anomalyType === 'spike' ? 'HR spike' : 'HRV crash'} correlates with ${lowAlt.length} aircraft below 1000ft. Potential 14 CFR § 91.119 violation.`;
    }

    if (aircraft.length > 3) {
      return `FLEET CONVERGENCE: ${aircraft.length} aircraft detected during biometric stress event. Pattern suggests coordinated multi-asset targeting operation.`;
    }

    return `BIOMETRIC ANOMALY: ${anomalyType === 'both' ? 'Combined HR spike + HRV crash' : anomalyType === 'spike' ? 'Heart rate spike' : 'HRV crash'} detected. ${aircraft.length} aircraft in area. Monitoring for pattern development.`;
  }, []);

  const scanForThreats = useCallback(async () => {
    if (!isActive) return;
    setLoading(true);

    try {
      // Fetch latest biometric reading
      const { data: bioData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              heart_rate, hrv, stress_level, measurement_timestamp,
              75 as baseline_hr, 55 as baseline_hrv
            FROM biometric_monitoring 
            WHERE heart_rate IS NOT NULL
            ORDER BY measurement_timestamp DESC 
            LIMIT 1
          `
        }
      });

      // Fetch recent aircraft
      const { data: aircraftData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT registration, altitude, speed, latitude, longitude, 
                   detection_timestamp, taxonomy_tag as entity
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '10 minutes'
            ORDER BY detection_timestamp DESC
            LIMIT 20
          `
        }
      });

      const bioReading: BiometricReading | null = bioData?.data?.[0] ? {
        heart_rate: parseFloat(bioData.data[0].heart_rate) || 0,
        hrv: parseFloat(bioData.data[0].hrv) || 0,
        stress_level: parseFloat(bioData.data[0].stress_level) || 0,
        timestamp: bioData.data[0].measurement_timestamp,
        baseline_hr: 75,
        baseline_hrv: 55
      } : null;

      const aircraftList: AircraftDetection[] = (aircraftData?.data || []).map((a: any) => ({
        registration: a.registration,
        altitude: parseFloat(a.altitude) || 0,
        speed: parseFloat(a.speed) || 0,
        latitude: parseFloat(a.latitude) || 0,
        longitude: parseFloat(a.longitude) || 0,
        entity: a.entity || 'Unknown',
        detected_at: a.detection_timestamp
      }));

      setCurrentBiometric(bioReading);
      setRecentAircraft(aircraftList);

      // Analyze for warnings
      if (bioReading) {
        const { isSpike, isHRVCrash, severity } = detectBiometricAnomaly(bioReading, previousBiometricRef.current);

        if (isSpike || isHRVCrash) {
          const anomalyType = isSpike && isHRVCrash ? 'both' : isSpike ? 'spike' : 'hrv_crash';
          
          // Check for phantom response (biometric stress but no aircraft)
          const isPhantom = aircraftList.length === 0;
          
          const warning: WarningEvent = {
            id: `warn-${Date.now()}`,
            type: isPhantom ? 'phantom_response' : isSpike ? 'biometric_spike' : 'hrv_crash',
            severity,
            message: isPhantom 
              ? 'PHANTOM: Stress response with no visible aircraft!'
              : `${isSpike ? 'HR SPIKE' : ''}${isSpike && isHRVCrash ? ' + ' : ''}${isHRVCrash ? 'HRV CRASH' : ''} detected`,
            biometric: bioReading,
            aircraft: aircraftList,
            timestamp: new Date().toISOString(),
            hypothesis: generateHypothesis(bioReading, aircraftList, isPhantom ? 'phantom' : anomalyType)
          };

          setWarnings(prev => [warning, ...prev.slice(0, 49)]);
          setStats(prev => ({
            ...prev,
            totalWarnings: prev.totalWarnings + 1,
            biometricSpikes: prev.biometricSpikes + (isSpike ? 1 : 0),
            hrvCrashes: prev.hrvCrashes + (isHRVCrash ? 1 : 0),
            phantomResponses: prev.phantomResponses + (isPhantom ? 1 : 0)
          }));

          playAlertSound(severity);
          toast.warning(warning.message, { duration: 5000 });
        }

        previousBiometricRef.current = bioReading;
      }

      // Check for masked aircraft (watchlist aircraft that should be visible but aren't)
      const { data: historicalData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT registration, COUNT(*) as detection_count,
                   MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE registration IN ('N788FA', 'N787FA', 'N597E')
            GROUP BY registration
          `
        }
      });

      const maskedAircraft = (historicalData?.data || []).filter((a: any) => {
        const lastSeen = new Date(a.last_seen);
        const hoursSince = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60);
        return hoursSince > 168; // 7 days without detection = potentially masked
      });

      if (maskedAircraft.length > 0) {
        setStats(prev => ({
          ...prev,
          maskedAircraft: maskedAircraft.length
        }));
      }

      setLastScan(new Date());
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setLoading(false);
    }
  }, [isActive, detectBiometricAnomaly, generateHypothesis, playAlertSound]);

  useEffect(() => {
    if (isActive) {
      scanForThreats();
      intervalRef.current = setInterval(scanForThreats, 30000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isActive, scanForThreats]);

  const getSeverityColor = (severity: 'critical' | 'high' | 'medium') => {
    switch (severity) {
      case 'critical': return 'text-destructive bg-destructive/20 border-destructive';
      case 'high': return 'text-orange-500 bg-orange-500/20 border-orange-500';
      case 'medium': return 'text-yellow-500 bg-yellow-500/20 border-yellow-500';
    }
  };

  return (
    <CyberPanel
      title="Biometric Early Warning System"
      icon={<ShieldAlert className="text-destructive" />}
      variant="default"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn(
            "text-xs",
            isActive ? "bg-success/20 text-success border-success" : "bg-muted"
          )}>
            {isActive ? 'ACTIVE' : 'STANDBY'}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      }
    >
      <div className="space-y-4">
        {/* Current Status */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Heart className="w-3 h-3" />
              Heart Rate
            </div>
            <div className={cn(
              "text-2xl font-bold",
              currentBiometric && currentBiometric.heart_rate >= 100 ? "text-destructive" : "text-foreground"
            )}>
              {currentBiometric?.heart_rate || '--'} <span className="text-sm font-normal">BPM</span>
            </div>
          </div>
          
          <div className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Activity className="w-3 h-3" />
              HRV
            </div>
            <div className={cn(
              "text-2xl font-bold",
              currentBiometric && currentBiometric.hrv <= 40 ? "text-destructive" : "text-foreground"
            )}>
              {currentBiometric?.hrv || '--'} <span className="text-sm font-normal">ms</span>
            </div>
          </div>
          
          <div className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Plane className="w-3 h-3" />
              Aircraft Nearby
            </div>
            <div className="text-2xl font-bold">
              {recentAircraft.length}
            </div>
          </div>
          
          <div className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <AlertTriangle className="w-3 h-3" />
              Warnings Today
            </div>
            <div className="text-2xl font-bold text-warning">
              {stats.totalWarnings}
            </div>
          </div>
        </div>

        {/* Statistics Bar */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-destructive" />
              <span className="text-muted-foreground">HR Spikes:</span> 
              <span className="font-bold">{stats.biometricSpikes}</span>
            </span>
            <span className="flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-orange-500" />
              <span className="text-muted-foreground">HRV Crashes:</span>
              <span className="font-bold">{stats.hrvCrashes}</span>
            </span>
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3 text-purple-500" />
              <span className="text-muted-foreground">Phantom:</span>
              <span className="font-bold">{stats.phantomResponses}</span>
            </span>
            <span className="flex items-center gap-1">
              <EyeOff className="w-3 h-3 text-yellow-500" />
              <span className="text-muted-foreground">Masked:</span>
              <span className="font-bold">{stats.maskedAircraft}</span>
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={scanForThreats} disabled={loading}>
            <RefreshCw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />
            {loading ? 'Scanning...' : 'Scan Now'}
          </Button>
        </div>

        {/* Warning Log */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-warning" />
              Warning Events
            </h4>
            <span className="text-xs text-muted-foreground">
              Last scan: {lastScan.toLocaleTimeString()}
            </span>
          </div>
          
          <ScrollArea className="h-[300px] rounded-lg border border-border">
            {warnings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                <ShieldAlert className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">No warnings detected</p>
                <p className="text-xs">System is monitoring for biometric-aircraft correlations</p>
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {warnings.map((warning) => (
                  <div
                    key={warning.id}
                    className={cn(
                      "p-3 rounded-lg border",
                      getSeverityColor(warning.severity)
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {warning.type === 'phantom_response' ? (
                          <Eye className="w-4 h-4" />
                        ) : warning.type === 'biometric_spike' ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        <span className="font-medium text-sm">{warning.message}</span>
                        <Badge variant="outline" className="text-xs">
                          {warning.severity.toUpperCase()}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(warning.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    {warning.biometric && (
                      <div className="flex items-center gap-4 text-xs mb-2">
                        <span className="flex items-center gap-1">
                          <Heart className="w-3 h-3" />
                          HR: {warning.biometric.heart_rate} BPM
                        </span>
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          HRV: {warning.biometric.hrv}ms
                        </span>
                      </div>
                    )}
                    
                    {warning.aircraft.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {warning.aircraft.slice(0, 5).map((a, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            <Plane className="w-3 h-3 mr-1" />
                            {a.registration} @ {a.altitude}ft
                          </Badge>
                        ))}
                        {warning.aircraft.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{warning.aircraft.length - 5} more
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    <div className="p-2 rounded bg-background/50 text-xs">
                      <div className="flex items-start gap-2">
                        <Brain className="w-3 h-3 mt-0.5 text-primary shrink-0" />
                        <p>{warning.hypothesis}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </CyberPanel>
  );
}

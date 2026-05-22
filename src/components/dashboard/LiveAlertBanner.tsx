import { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle, Plane, X, Volume2, VolumeX, Radio, MapPin, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface FlightAlert {
  id: string;
  registration: string;
  callsign: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  threat_level: 'critical' | 'high' | 'medium';
  taxonomy_tag: string;
  entity: string;
  flagged_reasons: string[];
  detected_at: string;
  dismissed: boolean;
}

interface LiveAlertBannerProps {
  lowAltitudeThreshold?: number;
  autoRefreshInterval?: number;
  soundEnabled?: boolean;
  onAlertClick?: (alert: FlightAlert) => void;
}

// Watchlist for pattern monitoring
const MONITORED_PATTERNS = [
  { pattern: /^N9\d{2}KC$/i, entity: 'KCSO', priority: 'critical' },
  { pattern: /^N\d+HP$/i, entity: 'CHP', priority: 'critical' },
  { pattern: /^N7[89]\dFA$/i, entity: 'ALF IX LLC', priority: 'high' },
  { pattern: /^N\d+FF$/i, entity: 'FF22 LLC', priority: 'high' },
  { pattern: /^N\d+AM$/i, entity: 'Air Methods', priority: 'high' },
  { pattern: /^N8274E$/i, entity: 'Christiansen Aviation', priority: 'critical' },
];

// Law enforcement / state actors — NEVER tag as shell
const LAW_ENFORCEMENT_PATTERNS = [
  /^N\d+HP$/i,        // CHP
  /^N9\d{2}KC$/i,     // KCSO
];
const LAW_ENFORCEMENT_ENTITIES = ['CHP', 'KCSO', 'CALIFORNIA HIGHWAY PATROL', 'KERN COUNTY SHERIFF'];

// Known shell / proxy operators (entity-name match, applied per tail)
const SHELL_OPERATOR_KEYWORDS = ['ALF IX', 'AERO EQUITIES', 'FF22', '9K AIR', 'BEST EQUIPMENT', 'CHRISTIANSEN'];

const isLawEnforcement = (reg: string, entity: string): boolean => {
  if (LAW_ENFORCEMENT_PATTERNS.some(p => p.test(reg))) return true;
  const e = (entity || '').toUpperCase();
  return LAW_ENFORCEMENT_ENTITIES.some(le => e.includes(le));
};

const isShellOperator = (entity: string): boolean => {
  const e = (entity || '').toUpperCase();
  return SHELL_OPERATOR_KEYWORDS.some(k => e.includes(k));
};

const CRITICAL_REGISTRATIONS = ['N912KC', 'N913KC', 'N743AM', 'N139HP', 'N156HP', 'N202HP', 'N8274E'];

export function LiveAlertBanner({
  lowAltitudeThreshold = 1500,
  autoRefreshInterval = 30000,
  soundEnabled: initialSoundEnabled = true,
  onAlertClick
}: LiveAlertBannerProps) {
  const [alerts, setAlerts] = useState<FlightAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(initialSoundEnabled);
  const [expanded, setExpanded] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousAlertsRef = useRef<Set<string>>(new Set());

  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return;
    try {
      // Use Web Audio API for alert sound
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio playback failed:', e);
    }
  }, [soundEnabled]);

  const classifyFlight = useCallback((flight: any): FlightAlert | null => {
    const reg = flight.registration || '';
    const altitude = flight.altitude || 0;
    const reasons: string[] = [];
    let threat_level: 'critical' | 'high' | 'medium' = 'medium';
    let entity = 'Unknown';

    const ownerOperator = flight.ownerOperator || flight.owner_operator || '';
    const shellAutoDetected = Boolean(flight.shellAutoDetected ?? flight.shell_auto_detected);
    const shellDetectionReason = flight.shellDetectionReason || flight.shell_detection_reason || '';

    const lawEnforcement = isLawEnforcement(reg, ownerOperator);

    // Shell company auto-detection — SUPPRESSED for law enforcement to protect credibility
    if (shellAutoDetected && !lawEnforcement) {
      threat_level = 'high';
      reasons.push('SHELL_COMPANY_AUTO_DETECTED');
      if (shellDetectionReason) reasons.push(`SHELL_REASON:${shellDetectionReason}`);
      entity = ownerOperator || 'Shell Company Network';
    }

    // Entity-name shell match (per tail, not per operator)
    if (!lawEnforcement && isShellOperator(ownerOperator)) {
      if (threat_level === 'medium') threat_level = 'high';
      if (!reasons.some(r => r.startsWith('SHELL'))) reasons.push('SHELL_LINKED');
      entity = ownerOperator;
    }

    // Law enforcement tagging — STATE_ACTOR, not shell
    if (lawEnforcement) {
      reasons.push('LAW_ENFORCEMENT');
      reasons.push('STATE_ACTOR');
    }

    // Check critical registrations
    if (CRITICAL_REGISTRATIONS.includes(reg.toUpperCase())) {
      threat_level = 'critical';
      reasons.push('WATCHLIST_CRITICAL');
      const match = MONITORED_PATTERNS.find(p => p.pattern.test(reg));
      entity = ownerOperator || match?.entity || 'Known Threat';
    }

    // Check patterns
    for (const pattern of MONITORED_PATTERNS) {
      if (pattern.pattern.test(reg)) {
        if (pattern.priority === 'critical') threat_level = 'critical';
        else if (pattern.priority === 'high' && threat_level !== 'critical') threat_level = 'high';
        reasons.push(`PATTERN_MATCH:${pattern.entity}`);
        entity = ownerOperator || pattern.entity;
        break;
      }
    }

    // Low altitude check
    if (altitude > 0 && altitude < lowAltitudeThreshold) {
      reasons.push(`LOW_ALT:${altitude}ft`);
      if (altitude < 500) {
        threat_level = 'critical';
        reasons.push('EXTREME_LOW_ALT');
      } else if (altitude < 1000 && threat_level === 'medium') {
        threat_level = 'high';
      }
    }

    // Existing flagged reasons from API
    if (flight.flaggedReasons?.length) {
      reasons.push(...flight.flaggedReasons);
    }
    if (flight.flagged) {
      reasons.push('FLAGGED_BY_SYSTEM');
    }

    // Only return if meets alert criteria
    if (reasons.length === 0) return null;
    if (threat_level === 'medium' && altitude >= lowAltitudeThreshold) return null;

    return {
      id: `${reg}-${flight.detected_at || Date.now()}`,
      registration: reg,
      callsign: flight.callsign || '',
      altitude,
      speed: flight.speed || 0,
      latitude: flight.latitude || 0,
      longitude: flight.longitude || 0,
      threat_level,
      taxonomy_tag: flight.taxonomyTag || flight.taxonomy_tag || 'live',
      entity,
      flagged_reasons: reasons,
      detected_at: flight.detected_at || new Date().toISOString(),
      dismissed: false
    };
  }, [lowAltitudeThreshold]);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch from live API only (DB supplement removed — was causing 150s timeouts)
      const liveResult = await supabase.functions.invoke("opensky-fetch", {
        body: { action: "fetchKernCounty" }
      });

      const allFlights: any[] = [];

      if (liveResult.data?.flights) {
        for (const f of liveResult.data.flights) {
          allFlights.push(f);
        }
      }

      if (allFlights.length === 0) {
        setAlerts([]);
        setLastCheck(new Date());
        return;
      }

      const newAlerts: FlightAlert[] = [];

      for (const flight of allFlights) {
        const alert = classifyFlight(flight);
        if (alert && !alert.dismissed) {
          newAlerts.push(alert);
        }
      }

      // Check for new critical/high alerts to trigger sound
      const newCriticalAlerts = newAlerts.filter(
        a => (a.threat_level === 'critical' || a.threat_level === 'high') && 
             !previousAlertsRef.current.has(a.registration)
      );

      if (newCriticalAlerts.length > 0) {
        playAlertSound();
      }

      // Update previous alerts reference
      previousAlertsRef.current = new Set(newAlerts.map(a => a.registration));

      // Sort by threat level
      newAlerts.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2 };
        return order[a.threat_level] - order[b.threat_level];
      });

      setAlerts(newAlerts);
      setLastCheck(new Date());
    } catch (err) {
      console.error('Alert system error:', err);
    } finally {
      setLoading(false);
    }
  }, [classifyFlight, playAlertSound]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, autoRefreshInterval);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefreshInterval]);

  const dismissAlert = (alertId: string) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  const dismissAll = () => {
    setAlerts([]);
  };

  const criticalCount = alerts.filter(a => a.threat_level === 'critical').length;
  const highCount = alerts.filter(a => a.threat_level === 'high').length;
  // Count UNIQUE tails (not operators) flagged as shell-linked
  const shellTails = new Set(
    alerts
      .filter(a => a.flagged_reasons.some(r => r.startsWith('SHELL')))
      .map(a => a.registration.toUpperCase())
  );
  const shellCount = shellTails.size;

  // Enterprise coordination: multi-shell + state-actor co-occurrence in same scan
  const uniqueShellOperators = new Set(
    alerts
      .filter(a => a.flagged_reasons.some(r => r.startsWith('SHELL')))
      .map(a => (a.entity || '').toUpperCase())
      .filter(Boolean)
  );
  const lawEnforcementPresent = alerts.some(a => a.flagged_reasons.includes('LAW_ENFORCEMENT'));
  const enterpriseCoordination =
    shellTails.size >= 2 && uniqueShellOperators.size >= 2 && lawEnforcementPresent;
  const enterpriseCritical = enterpriseCoordination; // escalates banner to CRITICAL

  if (alerts.length === 0) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-green-500 animate-pulse" />
          <span className="text-sm text-green-500 font-medium">Airspace Clear</span>
          <span className="text-xs text-muted-foreground">
            Last check: {lastCheck.toLocaleTimeString()}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchAlerts} disabled={loading}>
          <Radio className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Main Alert Banner */}
      <div 
        className={cn(
          "rounded-lg border-2 overflow-hidden transition-all",
          criticalCount > 0 
            ? "bg-destructive/20 border-destructive animate-pulse" 
            : "bg-orange-500/20 border-orange-500"
        )}
      >
        {/* Header */}
        {shellCount > 0 && (
          <div className="px-3 py-2 border-b border-primary/30 bg-primary/10">
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="border-primary/40 text-primary">SHELL COMPANY ALERTS</Badge>
              <span className="text-muted-foreground">
                {shellCount} shell-linked aircraft detected in current scan
              </span>
            </div>
          </div>
        )}

        <div 
          className={cn(
            "p-3 flex items-center justify-between cursor-pointer",
            criticalCount > 0 ? "bg-destructive/30" : "bg-orange-500/30"
          )}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className={cn(
              "w-6 h-6",
              criticalCount > 0 ? "text-destructive" : "text-orange-500"
            )} />
            <div>
              <div className="font-bold text-lg flex items-center gap-2">
                {criticalCount > 0 ? 'CRITICAL AIRCRAFT DETECTED' : 'AIRCRAFT ALERT'}
                <Badge variant="destructive" className="animate-pulse">
                  {alerts.length} ACTIVE
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                {criticalCount > 0 && (
                  <Badge variant="destructive" className="text-xs">{criticalCount} Critical</Badge>
                )}
                {highCount > 0 && (
                  <Badge className="bg-orange-500 text-white text-xs">{highCount} High</Badge>
                )}
                {shellCount > 0 && (
                  <Badge variant="outline" className="text-xs border-primary/40 text-primary">{shellCount} Shell</Badge>
                )}
                <span>• Low altitude threshold: {lowAltitudeThreshold}ft</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={(e) => { e.stopPropagation(); setSoundEnabled(!soundEnabled); }}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={(e) => { e.stopPropagation(); dismissAll(); }}
            >
              <X className="w-4 h-4" />
            </Button>
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </div>

        {/* Alert List */}
        {expanded && (
          <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "p-3 rounded-lg border flex items-center justify-between cursor-pointer hover:opacity-90 transition-opacity",
                  alert.threat_level === 'critical' 
                    ? "bg-destructive/10 border-destructive" 
                    : alert.threat_level === 'high'
                    ? "bg-orange-500/10 border-orange-500/50"
                    : "bg-yellow-500/10 border-yellow-500/50"
                )}
                onClick={() => onAlertClick?.(alert)}
              >
                <div className="flex items-center gap-3">
                  <Plane className={cn(
                    "w-5 h-5",
                    alert.threat_level === 'critical' ? "text-destructive" : "text-orange-500"
                  )} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold">{alert.registration}</span>
                      {alert.callsign && (
                        <span className="text-xs text-muted-foreground">{alert.callsign}</span>
                      )}
                      <Badge 
                        variant={alert.threat_level === 'critical' ? 'destructive' : 'outline'}
                        className={cn(
                          alert.threat_level === 'high' && "bg-orange-500 text-white border-orange-500"
                        )}
                      >
                        {alert.threat_level.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {(alert?.altitude ?? 0).toLocaleString()}ft
                      </span>
                      <span>{alert.speed}kts</span>
                      <span className="text-primary">{alert.entity}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(alert.detected_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    {alert.flagged_reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {alert.flagged_reasons.slice(0, 3).map((reason, i) => (
                          <Badge key={i} variant="outline" className="text-xs py-0">
                            {reason}
                          </Badge>
                        ))}
                        {alert.flagged_reasons.length > 3 && (
                          <Badge variant="outline" className="text-xs py-0">
                            +{alert.flagged_reasons.length - 3} more
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={(e) => { e.stopPropagation(); dismissAlert(alert.id); }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className={cn(
          "px-3 py-2 text-xs flex items-center justify-between",
          criticalCount > 0 ? "bg-destructive/20" : "bg-orange-500/20"
        )}>
          <span className="text-muted-foreground">
            Monitoring Kern County airspace • Auto-refresh: {autoRefreshInterval / 1000}s
          </span>
          <Button size="sm" variant="ghost" onClick={fetchAlerts} disabled={loading} className="h-6">
            <Radio className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}

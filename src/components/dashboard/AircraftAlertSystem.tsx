import { useState, useEffect, useCallback, useRef } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Plane,
  Shield,
  Eye,
  Radio,
  Volume2,
  VolumeX,
  RefreshCw,
  Target,
  Skull
} from 'lucide-react';

interface AlertConfig {
  registration: string;
  threat_level: 'CRITICAL' | 'HIGH' | 'SUSPICIOUS' | 'MONITOR';
  operator: string;
  description: string;
}

interface ActiveAlert {
  id: string;
  registration: string;
  timestamp: string;
  altitude?: number;
  latitude?: number;
  longitude?: number;
  callsign?: string;
  threat_level: string;
  operator: string;
  time_since_detection: string;
}

// Priority watchlist based on documented evidence
const WATCHLIST: AlertConfig[] = [
  { registration: 'N912KC', threat_level: 'CRITICAL', operator: 'KCSO', description: 'The Aggressor - Primary harassment asset' },
  { registration: 'N913KC', threat_level: 'CRITICAL', operator: 'KCSO', description: 'The Predator - 96% biometric correlation' },
  { registration: 'N790FA', threat_level: 'CRITICAL', operator: 'ALF IX LLC', description: 'Night operations shell company asset' },
  { registration: 'N788FA', threat_level: 'HIGH', operator: 'ALF IX LLC', description: 'Extreme low altitude ops (~125ft)' },
  { registration: 'N791FA', threat_level: 'HIGH', operator: 'ALF IX LLC', description: 'Coordinated fleet asset' },
  { registration: 'N2464D', threat_level: 'HIGH', operator: 'AERO EQUITIES LLC', description: 'Regional shell company ops' },
  { registration: 'N997SE', threat_level: 'HIGH', operator: 'AERO EQUITIES LLC', description: 'Shell company surveillance' },
  { registration: 'N743AM', threat_level: 'HIGH', operator: 'Air Methods/KCSO', description: 'Medical identity disguise' },
  { registration: 'N229AM', threat_level: 'HIGH', operator: 'Air Methods', description: 'Dual-purpose MEDEVAC abuse' },
  { registration: 'N139HP', threat_level: 'SUSPICIOUS', operator: 'CHP', description: 'Circling patterns over residence' },
  { registration: 'N156HP', threat_level: 'SUSPICIOUS', operator: 'CHP', description: 'Pressure tactic asset' },
  { registration: 'N74FF', threat_level: 'SUSPICIOUS', operator: 'FF22 LLC', description: '469 suspicious patterns flagged' },
  { registration: 'N8274E', threat_level: 'MONITOR', operator: 'Christiansen Aviation', description: 'Bulk stampede participant' },
];

export const AircraftAlertSystem = () => {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [totalDetections, setTotalDetections] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const getThreatColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse';
      case 'HIGH': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'SUSPICIOUS': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      default: return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50';
    }
  };

  const getThreatIcon = (level: string) => {
    switch (level) {
      case 'CRITICAL': return <Skull className="h-4 w-4 text-red-400" />;
      case 'HIGH': return <AlertTriangle className="h-4 w-4 text-orange-400" />;
      case 'SUSPICIOUS': return <Eye className="h-4 w-4 text-yellow-400" />;
      default: return <Radio className="h-4 w-4 text-cyan-400" />;
    }
  };

  const playAlertSound = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [soundEnabled]);

  const checkForAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const watchlistRegs = WATCHLIST.map(w => `'${w.registration}'`).join(',');
      
      // First try recent 24-hour data
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              registration,
              detection_timestamp,
              altitude,
              latitude,
              longitude,
              callsign,
              NOW() - detection_timestamp as time_since
            FROM live_flight_detections_rows
            WHERE registration IN (${watchlistRegs})
              AND detection_timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY detection_timestamp DESC
            LIMIT 100
          `
        }
      });

      if (error) throw new Error(error.message);

      let detections = data?.data || [];
      
      // If no recent data, get historical data with most recent detections
      if (detections.length === 0) {
        const { data: historicalData } = await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                registration,
                detection_timestamp,
                altitude,
                latitude,
                longitude,
                callsign,
                NOW() - detection_timestamp as time_since
              FROM live_flight_detections_rows
              WHERE registration IN (${watchlistRegs})
              ORDER BY detection_timestamp DESC
              LIMIT 100
            `
          }
        });
        detections = historicalData?.data || [];
      }
      
      // Get total watchlist detections ever
      const { data: totalData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT COUNT(*) as total
            FROM live_flight_detections_rows
            WHERE registration IN (${watchlistRegs})
          `
        }
      });
      
      setTotalDetections(parseInt(totalData?.data?.[0]?.total || '0'));

      const activeAlerts: ActiveAlert[] = detections.map((d: any) => {
        const config = WATCHLIST.find(w => w.registration === d.registration);
        const timeSince = d.time_since || '0 seconds';
        
        return {
          id: `${d.registration}-${d.detection_timestamp}`,
          registration: d.registration,
          timestamp: d.detection_timestamp,
          altitude: d.altitude,
          latitude: d.latitude,
          longitude: d.longitude,
          callsign: d.callsign,
          threat_level: config?.threat_level || 'MONITOR',
          operator: config?.operator || 'Unknown',
          time_since_detection: formatTimeSince(timeSince)
        };
      });

      // Check for new critical alerts (only for recent detections within 1 hour)
      const recentAlerts = activeAlerts.filter(a => {
        const timestamp = new Date(a.timestamp);
        return (Date.now() - timestamp.getTime()) < 3600000; // 1 hour in ms
      });
      
      const newCriticalAlerts = recentAlerts.filter(a => 
        a.threat_level === 'CRITICAL' && 
        !alerts.find(existing => existing.id === a.id)
      );

      if (newCriticalAlerts.length > 0) {
        playAlertSound();
        toast({
          title: '🚨 CRITICAL AIRCRAFT DETECTED',
          description: `${newCriticalAlerts[0].registration} (${newCriticalAlerts[0].operator}) detected in monitoring zone`,
          variant: 'destructive'
        });
      }

      setAlerts(activeAlerts);
      setLastCheck(new Date());

    } catch (err) {
      console.error('Alert check failed:', err);
    } finally {
      setLoading(false);
    }
  }, [alerts, playAlertSound, toast]);

  const formatTimeSince = (interval: string): string => {
    // Parse PostgreSQL interval format
    const match = interval.match(/(\d+):(\d+):(\d+)/);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      if (hours > 0) return `${hours}h ${minutes}m ago`;
      if (minutes > 0) return `${minutes}m ago`;
      return 'Just now';
    }
    return interval;
  };

  useEffect(() => {
    checkForAlerts();
    
    if (autoRefresh) {
      const interval = setInterval(checkForAlerts, 30000); // Check every 30 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh, checkForAlerts]);

  const criticalCount = alerts.filter(a => a.threat_level === 'CRITICAL').length;
  const highCount = alerts.filter(a => a.threat_level === 'HIGH').length;

  return (
    <CyberPanel 
      title="AIRCRAFT ALERT SYSTEM" 
      icon={<BellRing className="h-5 w-5" />}
      className="col-span-1"
    >
      {/* Hidden audio element for alerts */}
      <audio ref={audioRef} preload="auto">
        <source src="data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleC8FNYbT4pt2QQc6ndzomXNFFknb6JhyQxQAKpzq5pp3SBw5qun1nmxACTOn6PGYa0AVPK/t9JxoQBE9s+/2mWZAET+27veXZEATP7jv95ZjQRQ/ue/3lWJBFD+57veUYUIVP7nv95RhQhU/ue73k2FDFT+57veSYEQVP7nu95JfRBU/ue73kl5FFT+57veSXUYVP7nu95JdRhU/ue73kVxHFT+47feRW0gVP7jt95FaSBU/uO33kFlJFT+47fePWEoVP7jt949XSxU/uO33j1ZLFT+47fePVUwVP7jt949UTBUAgICAgICAgIA=" type="audio/wav" />
      </audio>

      {/* Status Bar */}
      <div className="flex items-center justify-between mb-4 p-3 bg-background/30 rounded-lg border border-border/30">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Shield className={`h-5 w-5 ${criticalCount > 0 ? 'text-red-400 animate-pulse' : 'text-green-400'}`} />
            <span className="text-sm font-mono">
              {criticalCount > 0 ? 'THREATS DETECTED' : 'MONITORING'}
            </span>
          </div>
          <Badge variant="outline" className="font-mono">
            {WATCHLIST.length} aircraft tracked
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="h-8 w-8"
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
          <div className="flex items-center gap-2">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <span className="text-xs text-muted-foreground">Auto</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={checkForAlerts}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Scan
          </Button>
        </div>
      </div>

      {/* Alert Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-center">
          <div className="text-xl font-mono text-red-400">{criticalCount}</div>
          <div className="text-xs text-muted-foreground">Critical</div>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 text-center">
          <div className="text-xl font-mono text-orange-400">{highCount}</div>
          <div className="text-xs text-muted-foreground">High</div>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-2 text-center">
          <div className="text-xl font-mono text-cyan-400">{alerts.length}</div>
          <div className="text-xs text-muted-foreground">24h Hits</div>
        </div>
        <div className="bg-primary/10 border border-primary/30 rounded p-2 text-center">
          <div className="text-xl font-mono text-primary">{totalDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
      </div>

      {/* Active Alerts */}
      <ScrollArea className="h-64">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="h-8 w-8 mb-2 animate-spin text-primary" />
            <p className="text-sm">Scanning flight database...</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Bell className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No watchlist aircraft in database</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 20).map((alert) => (
              <div 
                key={alert.id}
                className={`p-3 rounded-lg border ${getThreatColor(alert.threat_level)}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {getThreatIcon(alert.threat_level)}
                    <span className="font-mono font-bold">{alert.registration}</span>
                    <Badge variant="outline" className="text-xs">
                      {alert.operator}
                    </Badge>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {alert.time_since_detection}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Target className="h-3 w-3" />
                    {alert.altitude ? `${alert.altitude.toLocaleString()} ft` : 'N/A'}
                  </span>
                  {alert.callsign && (
                    <span className="flex items-center gap-1">
                      <Plane className="h-3 w-3" />
                      {alert.callsign}
                    </span>
                  )}
                  <span className="text-xs opacity-70">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Watchlist Preview */}
      <div className="mt-4 pt-4 border-t border-border/30">
        <div className="text-xs text-muted-foreground mb-2">Priority Watchlist</div>
        <div className="flex flex-wrap gap-1">
          {WATCHLIST.filter(w => w.threat_level === 'CRITICAL').map(w => (
            <Badge key={w.registration} variant="destructive" className="text-xs">
              {w.registration}
            </Badge>
          ))}
          {WATCHLIST.filter(w => w.threat_level === 'HIGH').slice(0, 4).map(w => (
            <Badge key={w.registration} className="text-xs bg-orange-500/20 text-orange-400 border-orange-500/30">
              {w.registration}
            </Badge>
          ))}
        </div>
      </div>

      {lastCheck && (
        <div className="mt-2 text-xs text-muted-foreground text-center">
          Last scan: {lastCheck.toLocaleTimeString()}
        </div>
      )}
    </CyberPanel>
  );
};

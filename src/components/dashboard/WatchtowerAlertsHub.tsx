import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { 
  AlertTriangle, Bell, BellOff, Radio, Radar, Shield, 
  Activity, Eye, EyeOff, RefreshCw, Zap,
  Plane, MapPin, Clock, TrendingUp, Brain, Rocket
} from "lucide-react";
import { useNeonDatabase } from "@/hooks/useNeonDatabase";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Alert {
  id: string;
  type: "critical" | "warning" | "info" | "anomaly" | "ai_hypothesis" | "countermeasure";
  source: string;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
  metadata?: Record<string, unknown>;
}

interface AlertChannel {
  id: string;
  name: string;
  enabled: boolean;
  icon: React.ReactNode;
  alertCount: number;
  lastTriggered?: Date;
}

interface WatchtowerScanResult {
  anomalies: Array<{
    type: string;
    severity: string;
    description: string;
    count: number;
    aircraft?: string[];
  }>;
  leads: Array<{
    priority: string;
    question: string;
  }>;
  aiHypothesis: string | null;
}

export function WatchtowerAlertsHub() {
  const { customQuery, isLoading } = useNeonDatabase();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([
    { id: "xxb_mlat", name: "XXB MLAT Detections", enabled: true, icon: <Radar className="w-4 h-4" />, alertCount: 0 },
    { id: "biometric", name: "Biometric Anomalies", enabled: true, icon: <Activity className="w-4 h-4" />, alertCount: 0 },
    { id: "aircraft", name: "Aircraft Registry", enabled: true, icon: <Plane className="w-4 h-4" />, alertCount: 0 },
    { id: "pattern", name: "Pattern Correlation", enabled: true, icon: <TrendingUp className="w-4 h-4" />, alertCount: 0 },
    { id: "ai_agent", name: "Mistral AI Agent", enabled: true, icon: <Brain className="w-4 h-4" />, alertCount: 0 },
    { id: "countermeasure", name: "Sentinel Countermeasures", enabled: true, icon: <Shield className="w-4 h-4" />, alertCount: 0 },
    { id: "realtime", name: "Real-Time Feed", enabled: true, icon: <Radio className="w-4 h-4" />, alertCount: 0 },
  ]);
  const [isPulsing, setIsPulsing] = useState(true);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aiHypothesis, setAiHypothesis] = useState<string | null>(null);

  const runWatchtowerAgent = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('watchtower-agent', {
        body: { action: 'scan' }
      });

      if (error) throw error;

      const result = data as WatchtowerScanResult;
      const newAlerts: Alert[] = [];

      // Convert anomalies to alerts
      if (result?.anomalies) {
        result.anomalies.forEach((anomaly, index) => {
          newAlerts.push({
            id: `anomaly-${Date.now()}-${index}`,
            type: anomaly.severity === 'critical' ? 'critical' : 
                  anomaly.severity === 'high' ? 'warning' : 'anomaly',
            source: 'Watchtower AI',
            message: `${anomaly.type}: ${anomaly.description}`,
            timestamp: new Date(),
            acknowledged: false,
            metadata: { ...anomaly }
          });
        });
      }

      // Add AI hypothesis as alert
      if (result?.aiHypothesis) {
        setAiHypothesis(result.aiHypothesis);
        newAlerts.push({
          id: `ai-hyp-${Date.now()}`,
          type: 'ai_hypothesis',
          source: 'Mistral AI',
          message: result.aiHypothesis,
          timestamp: new Date(),
          acknowledged: false
        });
      }

      // Add leads as informational alerts
      if (result?.leads) {
        result.leads.forEach((lead, index) => {
          newAlerts.push({
            id: `lead-${Date.now()}-${index}`,
            type: lead.priority === 'critical' ? 'critical' : 'info',
            source: 'Investigative Lead',
            message: lead.question,
            timestamp: new Date(),
            acknowledged: false
          });
        });
      }

      setAlerts(prev => [...newAlerts, ...prev.slice(0, 50)]);
      
      // Update AI Agent channel count
      setChannels(prev => prev.map(ch => 
        ch.id === 'ai_agent' 
          ? { ...ch, alertCount: newAlerts.length, lastTriggered: new Date() }
          : ch
      ));

      if (newAlerts.length > 0) {
        toast.success(`Watchtower Agent: ${newAlerts.length} findings`, {
          description: result.aiHypothesis?.slice(0, 100) || 'Scan complete'
        });
      }

      return result;
    } catch (err) {
      console.error('Watchtower agent error:', err);
      return null;
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    setRefreshing(true);
    try {
      // Fetch ALL anomalies from multiple sources - no time filter to show all data
      const [flightAlerts, biometricAlerts] = await Promise.all([
        customQuery(`
          SELECT id, callsign, taxonomy_tag, detection_timestamp, altitude, speed
          FROM live_flight_detections_rows 
          WHERE taxonomy_tag = 'xxb_mlat' 
          ORDER BY detection_timestamp DESC
          LIMIT 50
        `).catch(() => []),
        customQuery(`
          SELECT id, 
            CASE 
              WHEN heart_rate IS NOT NULL THEN 'Heart Rate'
              WHEN hrv IS NOT NULL THEN 'HRV'
              WHEN stress_level IS NOT NULL THEN 'Stress Level'
              ELSE 'Biometric'
            END as metric_name,
            COALESCE(heart_rate, hrv, stress_level, 0) as value, 
            measurement_timestamp as recorded_at, 
            CASE 
              WHEN heart_rate > 110 THEN 'critical' 
              WHEN heart_rate > 90 THEN 'warning' 
              WHEN hrv < 40 THEN 'critical'
              WHEN hrv < 60 THEN 'warning'
              ELSE 'info' 
            END as severity
          FROM biometric_monitoring 
          ORDER BY measurement_timestamp DESC
          LIMIT 30
        `).catch(() => [])
      ]);

      const newAlerts: Alert[] = [];

      // Process flight alerts
      if (Array.isArray(flightAlerts)) {
        flightAlerts.forEach((f: Record<string, unknown>) => {
          newAlerts.push({
            id: `flight-${f.id}`,
            type: "critical",
            source: "XXB MLAT",
            message: `Ghost aircraft ${f.callsign || 'UNKNOWN'} detected at ${f.altitude}ft`,
            timestamp: new Date(f.detection_timestamp as string),
            acknowledged: false,
            metadata: f
          });
        });
      }

      // Process biometric alerts
      if (Array.isArray(biometricAlerts)) {
        biometricAlerts.forEach((b: Record<string, unknown>) => {
          newAlerts.push({
            id: `bio-${b.id}`,
            type: b.severity === "critical" ? "critical" : "warning",
            source: "Biometric",
            message: `${b.metric_name}: ${b.value} (${b.severity})`,
            timestamp: new Date(b.recorded_at as string),
            acknowledged: false,
            metadata: b
          });
        });
      }

      // Sort by timestamp
      newAlerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      setAlerts(prev => {
        // Merge with existing AI alerts
        const aiAlerts = prev.filter(a => a.source === 'Watchtower AI' || a.source === 'Mistral AI' || a.source === 'Investigative Lead');
        return [...aiAlerts, ...newAlerts].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 100);
      });

      // Update channel counts
      setChannels(prev => prev.map(ch => ({
        ...ch,
        alertCount: ch.id === 'xxb_mlat' ? newAlerts.filter(a => a.source === "XXB MLAT").length :
                    ch.id === 'biometric' ? newAlerts.filter(a => a.source === "Biometric").length :
                    ch.alertCount,
        lastTriggered: newAlerts.find(a => 
          (ch.id === "xxb_mlat" && a.source === "XXB MLAT") ||
          (ch.id === "biometric" && a.source === "Biometric")
        )?.timestamp || ch.lastTriggered
      })));

    } catch (err) {
      console.error("Failed to load alerts:", err);
    } finally {
      setRefreshing(false);
    }
  }, [customQuery]);

  useEffect(() => {
    loadAlerts();
    runWatchtowerAgent(); // Run AI agent on mount
    
    const interval = setInterval(() => {
      loadAlerts();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [loadAlerts, runWatchtowerAgent]);

  const toggleChannel = (channelId: string) => {
    setChannels(prev => prev.map(ch => 
      ch.id === channelId ? { ...ch, enabled: !ch.enabled } : ch
    ));
  };

  const acknowledgeAlert = (alertId: string) => {
    setAlerts(prev => prev.map(a => 
      a.id === alertId ? { ...a, acknowledged: true } : a
    ));
    toast.success("Alert acknowledged");
  };

  const acknowledgeAll = () => {
    setAlerts(prev => prev.map(a => ({ ...a, acknowledged: true })));
    toast.success("All alerts acknowledged");
  };

  const getTypeStyles = (type: Alert["type"]) => {
    switch (type) {
      case "critical": return "bg-destructive/20 text-destructive border-destructive/50";
      case "warning": return "bg-warning/20 text-warning border-warning/50";
      case "anomaly": return "bg-accent/20 text-accent border-accent/50";
      case "ai_hypothesis": return "bg-primary/20 text-primary border-primary/50";
      case "countermeasure": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/50";
      default: return "bg-muted/20 text-muted-foreground border-muted/50";
    }
  };

  const getTypeIcon = (type: Alert["type"]) => {
    switch (type) {
      case "critical": return <AlertTriangle className="w-4 h-4" />;
      case "warning": return <Shield className="w-4 h-4" />;
      case "anomaly": return <Zap className="w-4 h-4" />;
      case "ai_hypothesis": return <Rocket className="w-4 h-4" />;
      case "countermeasure": return <Shield className="w-4 h-4 text-emerald-400" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  const filteredAlerts = alerts.filter(a => 
    (showAcknowledged || !a.acknowledged) &&
    channels.find(ch => 
      (ch.id === 'xxb_mlat' && a.source === 'XXB MLAT') ||
      (ch.id === 'biometric' && a.source === 'Biometric') ||
      (ch.id === 'ai_agent' && (a.source === 'Watchtower AI' || a.source === 'Mistral AI' || a.source === 'Investigative Lead')) ||
      (ch.id === 'countermeasure' && a.source === 'Sentinel Countermeasure') ||
      (ch.id === 'pattern' && a.source === 'Pattern Engine') ||
      ch.enabled
    )?.enabled !== false
  );
  
  const criticalCount = alerts.filter(a => a.type === "critical" && !a.acknowledged).length;

  return (
    <CyberPanel
      title="Watchtower Alerts Hub"
      icon={<Radio className={isPulsing && criticalCount > 0 ? "animate-pulse" : ""} />}
      variant={criticalCount > 0 ? "threat" : "default"}
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={runWatchtowerAgent}
            disabled={refreshing}
            className="h-6 px-2"
            title="Run Mistral AI Agent"
          >
            <Brain className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPulsing(!isPulsing)}
            className="h-6 px-2"
          >
            {isPulsing ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadAlerts}
            disabled={refreshing}
            className="h-6 px-2"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
          <Badge variant="outline" className={criticalCount > 0 ? "bg-destructive/20 text-destructive" : ""}>
            {criticalCount} Active
          </Badge>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* AI Hypothesis Banner */}
        {aiHypothesis && (
          <div className="p-3 rounded-lg border border-primary/30 bg-primary/10">
            <div className="flex items-center gap-2 mb-2">
              <Rocket className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium text-primary">Mistral AI Hypothesis</span>
            </div>
            <p className="text-sm text-muted-foreground">{aiHypothesis}</p>
          </div>
        )}

        {/* Channel Controls */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className={`
                p-2 rounded border cursor-pointer transition-all
                ${channel.enabled 
                  ? "bg-primary/10 border-primary/30 hover:bg-primary/20" 
                  : "bg-muted/50 border-muted hover:bg-muted"}
              `}
              onClick={() => toggleChannel(channel.id)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={channel.enabled ? "text-primary" : "text-muted-foreground"}>
                  {channel.icon}
                </span>
                <Switch
                  checked={channel.enabled}
                  onCheckedChange={() => toggleChannel(channel.id)}
                  className="scale-75"
                />
              </div>
              <p className="text-xs font-medium truncate">{channel.name}</p>
              {channel.alertCount > 0 && (
                <Badge variant="secondary" className="text-[10px] mt-1">
                  {channel.alertCount} alerts
                </Badge>
              )}
            </div>
          ))}
        </div>

        {/* Alert Actions Bar */}
        <div className="flex items-center justify-between border-y border-border py-2">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={showAcknowledged}
                onCheckedChange={setShowAcknowledged}
              />
              Show Acknowledged
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={acknowledgeAll}>
              <Eye className="w-3 h-3 mr-1" />
              Acknowledge All
            </Button>
          </div>
        </div>

        {/* Alerts Feed */}
        <ScrollArea className="h-[300px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Shield className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No active alerts</p>
              <p className="text-xs">All systems nominal</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`
                    p-3 rounded border transition-all
                    ${getTypeStyles(alert.type)}
                    ${alert.acknowledged ? "opacity-50" : ""}
                  `}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {getTypeIcon(alert.type)}
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {alert.source}
                          </Badge>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {alert.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-sm mt-1">{alert.message}</p>
                      </div>
                    </div>
                    {!alert.acknowledged && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="h-6 px-2"
                      >
                        <EyeOff className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Status Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-2">
          <span className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isPulsing ? "bg-success animate-pulse" : "bg-muted"}`} />
            {isPulsing ? "Live monitoring + Mistral AI active" : "Monitoring paused"}
          </span>
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>
    </CyberPanel>
  );
}

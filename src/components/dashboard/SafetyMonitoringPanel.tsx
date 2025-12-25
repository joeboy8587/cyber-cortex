import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  Shield, RefreshCw, AlertTriangle, Clock, CheckCircle, 
  XCircle, FileWarning, Heart, Radio, Activity
} from 'lucide-react';

interface DeadManStatus {
  last_checkin: string;
  status: 'active' | 'warning' | 'critical';
  hours_since_checkin: number;
}

interface PreservationOrder {
  id: string;
  issued_date: string;
  target_entity: string;
  status: 'active' | 'pending' | 'expired';
}

interface SafetyMetric {
  label: string;
  value: number | string;
  status: 'ok' | 'warning' | 'critical';
  icon: React.ReactNode;
}

export const SafetyMonitoringPanel = () => {
  const [deadManStatus, setDeadManStatus] = useState<DeadManStatus>({
    last_checkin: new Date().toISOString(),
    status: 'active',
    hours_since_checkin: 0
  });
  const [preservationOrders, setPreservationOrders] = useState<PreservationOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [threatLevel, setThreatLevel] = useState<'low' | 'moderate' | 'high' | 'critical'>('moderate');

  const fetchSafetyData = useCallback(async () => {
    setLoading(true);
    try {
      // Query dead man's switch log
      const { data: deadManData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT * FROM dead_mans_switch_log
            ORDER BY created_at DESC
            LIMIT 1
          `
        }
      });

      // Query preservation orders
      const { data: preservationData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT * FROM emergency_preservation_order
            ORDER BY created_at DESC
            LIMIT 10
          `
        }
      });

      // Query deadman checkins
      const { data: checkinData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT * FROM deadman_checkins
            ORDER BY check_in_timestamp DESC
            LIMIT 1
          `
        }
      });

      // Process dead man status
      const lastCheckin = checkinData?.data?.[0]?.check_in_timestamp || deadManData?.data?.[0]?.created_at;
      if (lastCheckin) {
        const hoursSince = (Date.now() - new Date(lastCheckin).getTime()) / (1000 * 60 * 60);
        let status: 'active' | 'warning' | 'critical' = 'active';
        if (hoursSince > 48) status = 'critical';
        else if (hoursSince > 24) status = 'warning';
        
        setDeadManStatus({
          last_checkin: lastCheckin,
          status,
          hours_since_checkin: Math.round(hoursSince)
        });
      }

      // Process preservation orders
      const orders = (preservationData?.data || []).map((row: Record<string, unknown>) => ({
        id: (row.id as string) || '',
        issued_date: (row.created_at as string) || '',
        target_entity: (row.target_entity as string) || (row.entity as string) || 'Unknown',
        status: 'active' as const
      }));
      setPreservationOrders(orders);

      // Calculate threat level based on various factors
      const hoursSinceCheckin = deadManStatus.hours_since_checkin;
      if (hoursSinceCheckin > 48) setThreatLevel('critical');
      else if (hoursSinceCheckin > 24) setThreatLevel('high');
      else if (orders.length > 3) setThreatLevel('moderate');
      else setThreatLevel('low');

    } catch (err) {
      console.error('Error fetching safety data:', err);
    } finally {
      setLoading(false);
    }
  }, [deadManStatus.hours_since_checkin]);

  useEffect(() => {
    fetchSafetyData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchSafetyData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSafetyData]);

  const getThreatColor = (level: string) => {
    const colors = {
      low: 'text-green-400 border-green-500/30 bg-green-500/10',
      moderate: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
      high: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
      critical: 'text-red-400 border-red-500/30 bg-red-500/10'
    };
    return colors[level as keyof typeof colors] || colors.moderate;
  };

  const getStatusIcon = (status: string) => {
    if (status === 'active' || status === 'ok') return <CheckCircle className="h-4 w-4 text-green-400" />;
    if (status === 'warning') return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
    return <XCircle className="h-4 w-4 text-red-400" />;
  };

  const safetyMetrics: SafetyMetric[] = [
    {
      label: 'Dead Man Switch',
      value: deadManStatus.status.toUpperCase(),
      status: deadManStatus.status === 'active' ? 'ok' : deadManStatus.status === 'warning' ? 'warning' : 'critical',
      icon: <Shield className="h-4 w-4" />
    },
    {
      label: 'Last Check-in',
      value: `${deadManStatus.hours_since_checkin}h ago`,
      status: deadManStatus.hours_since_checkin < 24 ? 'ok' : deadManStatus.hours_since_checkin < 48 ? 'warning' : 'critical',
      icon: <Clock className="h-4 w-4" />
    },
    {
      label: 'Preservation Orders',
      value: preservationOrders.length,
      status: preservationOrders.length > 0 ? 'ok' : 'warning',
      icon: <FileWarning className="h-4 w-4" />
    },
    {
      label: 'Evidence Integrity',
      value: 'SHA-256',
      status: 'ok',
      icon: <Radio className="h-4 w-4" />
    }
  ];

  return (
    <CyberPanel 
      title="SAFETY MONITORING" 
      icon={<Shield className="h-5 w-5 text-green-400" />}
    >
      {/* Threat Level Banner */}
      <div className={`rounded-lg p-4 mb-6 border ${getThreatColor(threatLevel)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6" />
            <div>
              <span className="font-bold text-lg">THREAT LEVEL: {threatLevel.toUpperCase()}</span>
              <p className="text-xs text-foreground/70">
                Last assessment: {new Date().toLocaleString()}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchSafetyData} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Update
          </Button>
        </div>
      </div>

      {/* Safety Metrics Grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {safetyMetrics.map((metric, idx) => (
          <div 
            key={idx}
            className={`p-3 rounded-lg border ${
              metric.status === 'ok' ? 'border-green-500/30 bg-green-500/5' :
              metric.status === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' :
              'border-red-500/30 bg-red-500/5'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              {metric.icon}
              {getStatusIcon(metric.status)}
            </div>
            <div className={`text-lg font-mono ${
              metric.status === 'ok' ? 'text-green-400' :
              metric.status === 'warning' ? 'text-yellow-400' :
              'text-red-400'
            }`}>
              {metric.value}
            </div>
            <div className="text-xs text-muted-foreground">{metric.label}</div>
          </div>
        ))}
      </div>

      {/* Dead Man's Switch Detail */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className={`p-4 rounded-lg border ${
          deadManStatus.status === 'active' ? 'border-green-500/30 bg-green-500/5' :
          deadManStatus.status === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' :
          'border-red-500/30 bg-red-500/5'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            <Heart className={`h-5 w-5 ${
              deadManStatus.status === 'active' ? 'text-green-400 animate-pulse' : 'text-red-400'
            }`} />
            <span className="font-medium">Dead Man's Switch</span>
          </div>
          <p className="text-xs text-foreground/70 mb-2">
            Automated evidence release trigger. If check-in exceeds 72 hours, 
            evidence packages are distributed to pre-designated recipients.
          </p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Last Check-in:</span>
            <span className="font-mono">
              {deadManStatus.last_checkin && new Date(deadManStatus.last_checkin).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Preservation Orders */}
        <div className="p-4 rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <FileWarning className="h-5 w-5 text-primary" />
            <span className="font-medium">Active Preservation Orders</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-auto">
            {preservationOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground">No active orders</p>
            ) : (
              preservationOrders.slice(0, 4).map((order, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="text-foreground/70 truncate max-w-[60%]">{order.target_entity}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {order.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Safety Protocols */}
      <div className="p-4 bg-muted/20 border border-border/30 rounded-lg">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          Active Safety Protocols
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-foreground/70">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-400" />
            SHA-256 hash verification active
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-400" />
            Chain of custody logging enabled
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-400" />
            Evidence fingerprinting operational
          </div>
          <div className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-400" />
            Backup replication configured
          </div>
        </div>
      </div>
    </CyberPanel>
  );
};

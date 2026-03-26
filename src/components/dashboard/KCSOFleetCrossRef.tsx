import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { 
  Shield, 
  RefreshCw, 
  Database,
  Activity,
  AlertTriangle,
  Target,
  Heart,
  ExternalLink,
  TrendingUp
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { neonQuery } from '@/lib/neonQueryRetry';
import { toast } from 'sonner';

interface FleetAircraft {
  id: string;
  tail_number: string;
  model: string;
  model_citation: string | null;
  frequent_oildale_operation: boolean | null;
  surveillance_capabilities: string | null;
  surveillance_citation: string | null;
}

interface NeonDetection {
  registration: string;
  detections: string;
  first_seen: string;
  last_seen: string;
  avg_altitude: string;
  active_days: string;
}

interface BiometricCorrelation {
  registration: string;
  correlations: string;
  hr_spikes: string;
  stress_events: string;
  avg_strength: string;
}

interface CrossRefData {
  aircraft: FleetAircraft;
  neonData: NeonDetection | null;
  biometricData: BiometricCorrelation | null;
}

export const KCSOFleetCrossRef: React.FC = () => {
  const [crossRefData, setCrossRefData] = useState<CrossRefData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    totalDetections: 0,
    totalCorrelations: 0,
    totalHrSpikes: 0,
    activeDays: 0
  });

  const fetchCrossRef = async () => {
    setLoading(true);
    try {
      // Fetch KCSO fleet from Supabase
      const { data: fleet, error: fleetError } = await supabase
        .from('kcso_fleet')
        .select('*')
        .order('tail_number');

      if (fleetError) throw fleetError;

      // Get tail numbers for Neon query
      const tailNumbers = fleet?.map(a => a.tail_number) || [];
      const tailNumbersStr = tailNumbers.map(t => `'${t}'`).join(',');

      // Fetch detections from Neon
      const { data: neonResponse } = await neonQuery({
        action: 'customQuery',
        query: `SELECT registration, COUNT(*) as detections, 
                MIN(event_timestamp) as first_seen, MAX(event_timestamp) as last_seen, 
                AVG(altitude_ft) as avg_altitude,
                COUNT(DISTINCT DATE(event_timestamp)) as active_days 
                FROM watchtower_unified_master 
                WHERE registration IN (${tailNumbersStr}) GROUP BY registration`
      });

      const { data: bioResponse } = await neonQuery({
        action: 'customQuery',
        query: `SELECT registration, COUNT(*) as correlations, 
                SUM(CASE WHEN hr_spike_detected THEN 1 ELSE 0 END) as hr_spikes, 
                SUM(CASE WHEN stress_increase_detected THEN 1 ELSE 0 END) as stress_events, 
                AVG(correlation_strength) as avg_strength 
                FROM master_biometric_aircraft_correlations 
                WHERE registration IN (${tailNumbersStr}) GROUP BY registration`
      });

      const neonData: NeonDetection[] = neonResponse?.data || [];
      const bioData: BiometricCorrelation[] = bioResponse?.data || [];

      // Merge data
      const merged: CrossRefData[] = (fleet || []).map(aircraft => ({
        aircraft,
        neonData: neonData.find(n => n.registration === aircraft.tail_number) || null,
        biometricData: bioData.find(b => b.registration === aircraft.tail_number) || null
      }));

      // Sort by detection count
      merged.sort((a, b) => {
        const aCount = parseInt(a.neonData?.detections || '0');
        const bCount = parseInt(b.neonData?.detections || '0');
        return bCount - aCount;
      });

      setCrossRefData(merged);

      // Calculate totals
      const totalDetections = neonData.reduce((sum, n) => sum + parseInt(n.detections || '0'), 0);
      const totalCorrelations = bioData.reduce((sum, b) => sum + parseInt(b.correlations || '0'), 0);
      const totalHrSpikes = bioData.reduce((sum, b) => sum + parseInt(b.hr_spikes || '0'), 0);
      const activeDays = Math.max(...neonData.map(n => parseInt(n.active_days || '0')), 0);

      setTotals({ totalDetections, totalCorrelations, totalHrSpikes, activeDays });

      toast.success(`Cross-referenced ${fleet?.length} aircraft with Neon database`);
    } catch (err) {
      console.error('Failed to cross-reference:', err);
      toast.error('Failed to cross-reference data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCrossRef();
  }, []);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  const getDetectionLevel = (count: number): { color: string; label: string } => {
    if (count > 10000) return { color: 'text-destructive', label: 'CRITICAL' };
    if (count > 1000) return { color: 'text-orange-400', label: 'HIGH' };
    if (count > 100) return { color: 'text-yellow-400', label: 'MODERATE' };
    if (count > 0) return { color: 'text-blue-400', label: 'LOW' };
    return { color: 'text-muted-foreground', label: 'NONE' };
  };

  return (
    <CyberPanel 
      title="KCSO Fleet × Neon Cross-Reference" 
      icon={<Database className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-destructive">{totals.totalDetections.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Total Detections</div>
          </div>
          <div className="bg-primary/10 border border-primary/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-primary">{totals.totalCorrelations}</div>
            <div className="text-xs text-muted-foreground">Biometric Links</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-orange-400">{totals.totalHrSpikes}</div>
            <div className="text-xs text-muted-foreground">HR Spikes</div>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-cyan-400">{totals.activeDays}</div>
            <div className="text-xs text-muted-foreground">Active Days</div>
          </div>
        </div>

        {/* Critical Alert */}
        {totals.totalCorrelations > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
              <span className="text-sm font-bold text-destructive">
                BIOMETRIC CORRELATION DETECTED
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.totalCorrelations} documented correlations between KCSO aircraft presence 
              and biometric stress responses. {totals.totalHrSpikes} heart rate spikes logged.
            </p>
          </div>
        )}

        {/* Refresh */}
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={fetchCrossRef} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh Cross-Ref
          </Button>
        </div>

        {/* Cross-Reference Table */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {crossRefData.map((item) => {
              const detections = parseInt(item.neonData?.detections || '0');
              const correlations = parseInt(item.biometricData?.correlations || '0');
              const hrSpikes = parseInt(item.biometricData?.hr_spikes || '0');
              const level = getDetectionLevel(detections);
              const hasNeonData = item.neonData !== null;
              const hasBioData = item.biometricData !== null;

              return (
                <div 
                  key={item.aircraft.id}
                  className={`border rounded-lg p-3 ${
                    hasBioData 
                      ? 'border-destructive/50 bg-destructive/5' 
                      : hasNeonData
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border/30 bg-muted/20'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Shield className={`h-5 w-5 ${hasNeonData ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{item.aircraft.tail_number}</span>
                          {item.aircraft.frequent_oildale_operation && (
                            <Badge variant="destructive" className="text-xs">OILDALE</Badge>
                          )}
                          {hasBioData && (
                            <Badge className="bg-orange-500/20 text-orange-400 text-xs">
                              <Heart className="h-3 w-3 mr-1" />
                              BIO-LINKED
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{item.aircraft.model}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={level.color}>
                      {level.label}
                    </Badge>
                  </div>

                  {hasNeonData && (
                    <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border/30">
                      <div className="text-center">
                        <div className="text-lg font-bold text-primary">
                          {detections.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">Detections</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-cyan-400">
                          {item.neonData?.active_days || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Active Days</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-bold text-yellow-400">
                          {Math.round(parseFloat(item.neonData?.avg_altitude || '0'))}ft
                        </div>
                        <div className="text-xs text-muted-foreground">Avg Alt</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm text-muted-foreground">
                          {formatDate(item.neonData?.first_seen || null)}
                        </div>
                        <div className="text-xs text-muted-foreground">First Seen</div>
                      </div>
                    </div>
                  )}

                  {hasBioData && (
                    <div className="mt-3 pt-3 border-t border-destructive/30">
                      <div className="flex items-center gap-2 mb-2">
                        <Activity className="h-4 w-4 text-destructive" />
                        <span className="text-xs font-semibold text-destructive">
                          Biometric Correlations
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-background/50 rounded p-2 text-center">
                          <div className="font-bold text-primary">{correlations}</div>
                          <div className="text-xs text-muted-foreground">Correlations</div>
                        </div>
                        <div className="bg-background/50 rounded p-2 text-center">
                          <div className="font-bold text-orange-400">{hrSpikes}</div>
                          <div className="text-xs text-muted-foreground">HR Spikes</div>
                        </div>
                        <div className="bg-background/50 rounded p-2 text-center">
                          <div className="font-bold text-green-400">
                            {(parseFloat(item.biometricData?.avg_strength || '0') * 100).toFixed(0)}%
                          </div>
                          <div className="text-xs text-muted-foreground">Avg Strength</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!hasNeonData && (
                    <div className="text-xs text-muted-foreground text-center py-2">
                      No detections in Neon database
                    </div>
                  )}

                  {/* Citation Links */}
                  {item.aircraft.surveillance_citation && (
                    <div className="mt-2 pt-2 border-t border-border/20">
                      <a 
                        href={item.aircraft.surveillance_citation}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View Capabilities Source
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
          Cross-referencing KCSO fleet registry with Neon flight detections & biometric correlations
        </div>
      </div>
    </CyberPanel>
  );
};

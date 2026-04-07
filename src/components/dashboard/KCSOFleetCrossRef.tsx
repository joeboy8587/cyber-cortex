import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Shield, RefreshCw, Database, Activity, AlertTriangle,
  Heart, ExternalLink
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

interface CrossRefData {
  aircraft: FleetAircraft;
  neonData: NeonDetection | null;
  forensicEvents: number;
  watchtowerFlags: number;
}

export const KCSOFleetCrossRef: React.FC = () => {
  const [crossRefData, setCrossRefData] = useState<CrossRefData[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    totalDetections: 0,
    totalForensicEvents: 0,
    totalWatchtowerFlags: 0,
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

      const tailNumbers = fleet?.map(a => a.tail_number) || [];
      const tailNumbersStr = tailNumbers.map(t => `'${t}'`).join(',');

      // Fetch from live_flight_detections_rows (known to have data) and Supabase tables in parallel
      const [neonResponse, forensicResponse, watchtowerResponse] = await Promise.all([
        neonQuery({
          action: 'customQuery',
          query: `SELECT registration, COUNT(*)::text as detections, 
                  MIN(detection_timestamp)::text as first_seen, MAX(detection_timestamp)::text as last_seen, 
                  ROUND(AVG(COALESCE(altitude, 0))::numeric, 0)::text as avg_altitude,
                  COUNT(DISTINCT DATE(detection_timestamp))::text as active_days 
                  FROM live_flight_detections_rows 
                  WHERE registration IN (${tailNumbersStr}) GROUP BY registration`
        }).catch(() => ({ data: [] })),
        supabase.from('master_forensic_events')
          .select('primary_entity_id')
          .or(tailNumbers.map(t => `primary_entity_id.eq.${t}`).join(',')),
        supabase.from('watchtower_autonomous_flags')
          .select('registration')
          .or(tailNumbers.map(t => `registration.eq.${t}`).join(','))
      ]);

      const neonData: NeonDetection[] = Array.isArray(neonResponse?.data) 
        ? neonResponse.data 
        : neonResponse?.data?.data || [];

      // Count forensic events per aircraft
      const forensicCounts = new Map<string, number>();
      (forensicResponse.data || []).forEach((e: any) => {
        const id = e.primary_entity_id;
        forensicCounts.set(id, (forensicCounts.get(id) || 0) + 1);
      });

      // Count watchtower flags per aircraft
      const watchtowerCounts = new Map<string, number>();
      (watchtowerResponse.data || []).forEach((f: any) => {
        const reg = f.registration;
        if (reg) watchtowerCounts.set(reg, (watchtowerCounts.get(reg) || 0) + 1);
      });

      // Merge data
      const merged: CrossRefData[] = (fleet || []).map(aircraft => ({
        aircraft,
        neonData: neonData.find(n => n.registration === aircraft.tail_number) || null,
        forensicEvents: forensicCounts.get(aircraft.tail_number) || 0,
        watchtowerFlags: watchtowerCounts.get(aircraft.tail_number) || 0
      }));

      // Sort by detection count
      merged.sort((a, b) => {
        const aCount = parseInt(a.neonData?.detections || '0') + a.forensicEvents + a.watchtowerFlags;
        const bCount = parseInt(b.neonData?.detections || '0') + b.forensicEvents + b.watchtowerFlags;
        return bCount - aCount;
      });

      setCrossRefData(merged);

      const totalDetections = neonData.reduce((sum, n) => sum + parseInt(n.detections || '0'), 0);
      const totalForensicEvents = Array.from(forensicCounts.values()).reduce((a, b) => a + b, 0);
      const totalWatchtowerFlags = Array.from(watchtowerCounts.values()).reduce((a, b) => a + b, 0);
      const activeDays = Math.max(...neonData.map(n => parseInt(n.active_days || '0')), 0);

      setTotals({ totalDetections, totalForensicEvents, totalWatchtowerFlags, activeDays });
      toast.success(`Cross-referenced ${fleet?.length} aircraft across all databases`);
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
      title="KCSO Fleet × Database Cross-Reference" 
      icon={<Database className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-destructive">{totals.totalDetections.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Flight Detections</div>
          </div>
          <div className="bg-primary/10 border border-primary/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-primary">{totals.totalForensicEvents}</div>
            <div className="text-xs text-muted-foreground">Forensic Events</div>
          </div>
          <div className="bg-orange-500/10 border border-orange-500/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-orange-400">{totals.totalWatchtowerFlags}</div>
            <div className="text-xs text-muted-foreground">Watchtower Flags</div>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded p-2 text-center">
            <div className="text-xl font-bold text-cyan-400">{totals.activeDays}</div>
            <div className="text-xs text-muted-foreground">Active Days</div>
          </div>
        </div>

        {/* Critical Alert */}
        {(totals.totalForensicEvents > 0 || totals.totalWatchtowerFlags > 0) && (
          <div className="bg-destructive/10 border border-destructive/30 rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-destructive animate-pulse" />
              <span className="text-sm font-bold text-destructive">
                EVIDENCE CORRELATION DETECTED
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.totalForensicEvents} forensic events and {totals.totalWatchtowerFlags} watchtower 
              flags documented across KCSO fleet aircraft.
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
              const totalEvidence = detections + item.forensicEvents + item.watchtowerFlags;
              const level = getDetectionLevel(totalEvidence);
              const hasNeonData = item.neonData !== null;
              const hasEvidence = item.forensicEvents > 0 || item.watchtowerFlags > 0;

              return (
                <div 
                  key={item.aircraft.id}
                  className={`border rounded-lg p-3 ${
                    hasEvidence 
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
                          {hasEvidence && (
                            <Badge className="bg-orange-500/20 text-orange-400 text-xs">
                              <Activity className="h-3 w-3 mr-1" />
                              EVIDENCE
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

                  <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border/30">
                    <div className="text-center">
                      <div className="text-lg font-bold text-primary">
                        {detections.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">Flights</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-cyan-400">
                        {item.neonData?.active_days || 0}
                      </div>
                      <div className="text-xs text-muted-foreground">Active Days</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-yellow-400">
                        {hasNeonData ? `${Math.round(parseFloat(item.neonData?.avg_altitude || '0'))}ft` : 'N/A'}
                      </div>
                      <div className="text-xs text-muted-foreground">Avg Alt</div>
                    </div>
                    <div className="text-center">
                      <div className="text-sm text-muted-foreground">
                        {hasNeonData ? formatDate(item.neonData?.first_seen || null) : 'N/A'}
                      </div>
                      <div className="text-xs text-muted-foreground">First Seen</div>
                    </div>
                  </div>

                  {hasEvidence && (
                    <div className="mt-3 pt-3 border-t border-destructive/30">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span className="text-xs font-semibold text-destructive">
                          Evidence Cross-Reference
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-background/50 rounded p-2 text-center">
                          <div className="font-bold text-primary">{item.forensicEvents}</div>
                          <div className="text-xs text-muted-foreground">Forensic Events</div>
                        </div>
                        <div className="bg-background/50 rounded p-2 text-center">
                          <div className="font-bold text-orange-400">{item.watchtowerFlags}</div>
                          <div className="text-xs text-muted-foreground">Watchtower Flags</div>
                        </div>
                      </div>
                    </div>
                  )}

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

        <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
          Cross-referencing KCSO fleet across Neon flights, forensic events & watchtower flags
        </div>
      </div>
    </CyberPanel>
  );
};

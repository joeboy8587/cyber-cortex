import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Network, 
  RefreshCw, 
  Database, 
  Target, 
  AlertTriangle,
  TrendingUp,
  Plane,
  Building2,
  Shield,
  Zap
} from 'lucide-react';

interface AlignmentRecord {
  id: number;
  entity_name: string;
  entity_type: string;
  aircraft_tail: string;
  match_score_to_kcso: number;
  behavior_type: string;
  confirmed_flight_overlap: boolean;
  geofence_radius_km: number;
  biometric_link_score: number;
  risk_tier: string;
  avg_altitude_ft: number;
  loiter_count: number;
  detection_count: number;
  low_altitude_pct: number;
  reference_aircraft: string;
  legal_exposure: string;
  prosecution_priority: string;
  first_detection: string;
  last_detection: string;
}

interface Summary {
  totalRecords: number;
  tier1Probationary: number;
  tier2Watch: number;
  highMatchAlerts: number;
  uniqueEntities: number;
  uniqueAircraft: number;
}

export function ShellBehavioralAlignment() {
  const [alignments, setAlignments] = useState<AlignmentRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [initialized, setInitialized] = useState(true);

  const fetchAlignments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getBehavioralAlignment' }
      });

      if (error) throw error;

      if (data.data?.notInitialized) {
        setInitialized(false);
        setAlignments([]);
        setSummary(null);
      } else {
        setInitialized(true);
        setAlignments(data.data?.alignments || []);
        setSummary(data.data?.summary || null);
      }
    } catch (err) {
      console.error('Error fetching alignments:', err);
      toast.error('Failed to fetch behavioral alignment data');
    } finally {
      setLoading(false);
    }
  }, []);

  const initializeSchema = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'createBehavioralAlignmentTable' }
      });

      if (error) throw error;
      
      toast.success('Schema initialized successfully');
      setInitialized(true);
      await fetchAlignments();
    } catch (err) {
      console.error('Error initializing schema:', err);
      toast.error('Failed to initialize schema');
    } finally {
      setLoading(false);
    }
  };

  const computeAlignments = async () => {
    setComputing(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'computeBehavioralAlignment' }
      });

      if (error) throw error;
      
      const result = data.data;
      toast.success(`Computed ${result?.alignmentRecordsCreated || 0} behavioral alignment records`);
      await fetchAlignments();
    } catch (err) {
      console.error('Error computing alignments:', err);
      toast.error('Failed to compute behavioral alignments');
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    fetchAlignments();
  }, [fetchAlignments]);

  const getTierBadge = (tier: string) => {
    if (tier?.includes('Tier 1')) {
      return <Badge variant="destructive" className="animate-pulse">{tier}</Badge>;
    }
    if (tier?.includes('Tier 2')) {
      return <Badge className="bg-amber-500/80 text-white">{tier}</Badge>;
    }
    return <Badge variant="secondary">{tier}</Badge>;
  };

  const getBehaviorBadge = (behavior: string) => {
    const colors: Record<string, string> = {
      'LOITER_MIMIC': 'bg-red-500/80 text-white',
      'ALTITUDE_ECHO': 'bg-orange-500/80 text-white',
      'PERSISTENT_PRESENCE': 'bg-purple-500/80 text-white',
      'CRITICAL_LOW_ALT': 'bg-red-600/90 text-white animate-pulse',
      'STANDARD': 'bg-muted text-muted-foreground'
    };
    return <Badge className={colors[behavior] || colors['STANDARD']}>{behavior?.replace(/_/g, ' ')}</Badge>;
  };

  const getMatchScoreColor = (score: number) => {
    if (score >= 85) return 'text-red-400';
    if (score >= 70) return 'text-amber-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-muted-foreground';
  };

  return (
    <CyberPanel 
      title="Shell Entity Behavioral Alignment" 
      icon={<Network className="w-5 h-5 text-red-400" />}
      className="col-span-full"
    >
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>RICO Pattern Matching Against KCSO Tier 1 Baseline</span>
        </div>
        <div className="flex items-center gap-2">
          {!initialized && (
            <Button 
              onClick={initializeSchema} 
              disabled={loading}
              variant="outline"
              size="sm"
            >
              <Database className="w-4 h-4 mr-2" />
              Initialize Schema
            </Button>
          )}
          <Button 
            onClick={computeAlignments} 
            disabled={computing || !initialized}
            variant="default"
            size="sm"
          >
            {computing ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            Compute Alignment Scores
          </Button>
          <Button 
            onClick={fetchAlignments} 
            disabled={loading}
            variant="ghost"
            size="sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.totalRecords}</div>
            <div className="text-xs text-muted-foreground">Total Alignments</div>
          </div>
          <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{summary.tier1Probationary}</div>
            <div className="text-xs text-red-400/70">Tier 1 Probationary</div>
          </div>
          <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-400">{summary.tier2Watch}</div>
            <div className="text-xs text-amber-400/70">Tier 2 Watch</div>
          </div>
          <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{summary.highMatchAlerts}</div>
            <div className="text-xs text-purple-400/70">High Match (85%+)</div>
          </div>
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.uniqueEntities}</div>
            <div className="text-xs text-muted-foreground">Unique Entities</div>
          </div>
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.uniqueAircraft}</div>
            <div className="text-xs text-muted-foreground">Unique Aircraft</div>
          </div>
        </div>
      )}

      {/* Alignment Records */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !initialized ? (
        <div className="text-center py-12 text-muted-foreground">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Schema not initialized. Click "Initialize Schema" to create the behavioral alignment table.</p>
        </div>
      ) : alignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No alignment data yet. Click "Compute Alignment Scores" to analyze shell entities.</p>
        </div>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-3">
            {alignments.map((alignment) => (
              <div 
                key={alignment.id || `${alignment.entity_name}-${alignment.aircraft_tail}`}
                className={`border rounded-lg p-4 transition-all ${
                  parseFloat(String(alignment.match_score_to_kcso)) >= 85 
                    ? 'border-red-500/50 bg-red-950/20' 
                    : parseFloat(String(alignment.match_score_to_kcso)) >= 70
                    ? 'border-amber-500/30 bg-amber-950/10'
                    : 'border-border/50 bg-card/30'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Entity Info */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      <span className="font-semibold text-foreground">{alignment.entity_name}</span>
                      <Badge variant="outline" className="text-xs">{alignment.entity_type}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Plane className="w-4 h-4 text-primary" />
                      <span className="font-mono text-primary">{alignment.aircraft_tail}</span>
                      {alignment.confirmed_flight_overlap && (
                        <Badge variant="secondary" className="text-xs">Overlap Confirmed</Badge>
                      )}
                    </div>
                  </div>

                  {/* Match Score */}
                  <div className="text-center min-w-[100px]">
                    <div className={`text-3xl font-bold ${getMatchScoreColor(parseFloat(String(alignment.match_score_to_kcso)))}`}>
                      {parseFloat(String(alignment.match_score_to_kcso)).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">KCSO Match</div>
                    <Progress 
                      value={parseFloat(String(alignment.match_score_to_kcso))} 
                      className="h-1 mt-1"
                    />
                  </div>

                  {/* Biometric Score */}
                  <div className="text-center min-w-[80px]">
                    <div className="text-xl font-semibold text-foreground">
                      {parseFloat(String(alignment.biometric_link_score)).toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">Bio Link</div>
                  </div>

                  {/* Tier & Behavior */}
                  <div className="flex flex-col items-end gap-2">
                    {getTierBadge(alignment.risk_tier)}
                    {getBehaviorBadge(alignment.behavior_type)}
                  </div>
                </div>

                {/* Metrics Row */}
                <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-border/30 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    <span>{alignment.detection_count} detections</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span>{parseFloat(String(alignment.low_altitude_pct)).toFixed(1)}% low-alt</span>
                  </div>
                  <div>
                    Avg Alt: {parseFloat(String(alignment.avg_altitude_ft)).toFixed(0)} ft
                  </div>
                  <div>
                    Loiter: {alignment.loiter_count}
                  </div>
                  <div>
                    Ref: {alignment.reference_aircraft}
                  </div>
                  {alignment.prosecution_priority && (
                    <Badge 
                      variant={alignment.prosecution_priority === 'HIGH' ? 'destructive' : 'outline'}
                      className="text-xs"
                    >
                      {alignment.prosecution_priority}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border/30 text-xs text-muted-foreground">
        <p>
          <strong>Methodology:</strong> Behavioral alignment scores compare shell entity aircraft patterns against 
          KCSO Tier 1 reference assets (N912KC/N913KC). Scores ≥85% indicate operational mimicry warranting 
          Tier 1 Probationary status. Pattern matching evaluates altitude profiles, low-altitude persistence, 
          and biometric correlation windows (±10 min).
        </p>
      </div>
    </CyberPanel>
  );
}

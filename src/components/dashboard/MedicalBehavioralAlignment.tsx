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
  HeartPulse, 
  RefreshCw, 
  Database, 
  Target, 
  AlertTriangle,
  TrendingUp,
  Plane,
  Hospital,
  Shield,
  Zap,
  FileWarning,
  Scale
} from 'lucide-react';

interface MedicalAlignmentRecord {
  id: number;
  operator_name: string;
  operator_type: string;
  aircraft_tail: string;
  match_score_to_kcso: number;
  behavior_type: string;
  medical_mission_logged: boolean;
  loiter_count: number;
  biometric_link_score: number;
  risk_tier: string;
  avg_altitude_ft: number;
  detection_count: number;
  low_altitude_pct: number;
  reference_aircraft: string;
  legal_exposure: string;
  prosecution_priority: string;
  first_detection: string;
  last_detection: string;
  fraud_indicators: string;
}

interface Summary {
  totalRecords: number;
  tier1FraudWatch: number;
  tier2Suspect: number;
  highMatchAlerts: number;
  uniqueOperators: number;
  uniqueAircraft: number;
  zeroMedicalMissions: number;
}

export function MedicalBehavioralAlignment() {
  const [alignments, setAlignments] = useState<MedicalAlignmentRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [initialized, setInitialized] = useState(true);

  const fetchAlignments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getMedicalBehavioralAlignment' }
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
      console.error('Error fetching medical alignments:', err);
      toast.error('Failed to fetch medical behavioral alignment data');
    } finally {
      setLoading(false);
    }
  }, []);

  const initializeSchema = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'createMedicalBehavioralAlignmentTable' }
      });

      if (error) throw error;
      
      toast.success('Medical alignment schema initialized successfully');
      setInitialized(true);
      await fetchAlignments();
    } catch (err) {
      console.error('Error initializing medical schema:', err);
      toast.error('Failed to initialize medical schema');
    } finally {
      setLoading(false);
    }
  };

  const computeAlignments = async () => {
    setComputing(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'computeMedicalBehavioralAlignment' }
      });

      if (error) throw error;
      
      const result = data.data;
      toast.success(`Computed ${result?.alignmentRecordsCreated || 0} medical behavioral alignment records`);
      await fetchAlignments();
    } catch (err) {
      console.error('Error computing medical alignments:', err);
      toast.error('Failed to compute medical behavioral alignments');
    } finally {
      setComputing(false);
    }
  };

  useEffect(() => {
    fetchAlignments();
  }, [fetchAlignments]);

  const getTierBadge = (tier: string) => {
    if (tier?.includes('Tier 1') || tier?.includes('Fraud')) {
      return <Badge variant="destructive" className="animate-pulse">{tier}</Badge>;
    }
    if (tier?.includes('Tier 2') || tier?.includes('Suspect')) {
      return <Badge className="bg-amber-500/80 text-white">{tier}</Badge>;
    }
    return <Badge variant="secondary">{tier}</Badge>;
  };

  const getBehaviorBadge = (behavior: string) => {
    const colors: Record<string, string> = {
      'LOITER_MIMIC': 'bg-red-500/80 text-white',
      'ALTITUDE_ECHO': 'bg-orange-500/80 text-white',
      'SURVEILLANCE_PATTERN': 'bg-purple-500/80 text-white',
      'CRITICAL_LOW_ALT': 'bg-red-600/90 text-white animate-pulse',
      'NO_MEDICAL_MISSION': 'bg-rose-600/90 text-white',
      'MEDEVAC_FRAUD': 'bg-red-700/90 text-white animate-pulse',
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

  const getFraudBadge = (hasMission: boolean) => {
    if (!hasMission) {
      return <Badge variant="destructive" className="text-xs">⚠️ NO MEDICAL MISSION</Badge>;
    }
    return <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">✓ Mission Logged</Badge>;
  };

  return (
    <CyberPanel 
      title="Medical Entity Behavioral Alignment" 
      icon={<HeartPulse className="w-5 h-5 text-rose-400" />}
      className="col-span-full"
    >
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>MEDEVAC/Geneva Pattern Matching Against KCSO Tier 1 Baseline</span>
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
            Compute Medical Alignment
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

      {/* Legal Context Banner */}
      <div className="bg-rose-950/30 border border-rose-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <Scale className="w-5 h-5 text-rose-400 mt-0.5" />
          <div className="text-sm">
            <p className="text-rose-300 font-medium mb-1">Legal Basis for Medical Aircraft Analysis</p>
            <p className="text-rose-200/70">
              Medical aircraft operating under MEDEVAC/humanitarian codes receive protected airspace priority. 
              If their behavior mimics law enforcement surveillance patterns (loitering, low-altitude circles) 
              without logged medical missions, this constitutes potential <strong>False Claims Act violations</strong>, 
              <strong>Geneva Convention breaches</strong>, and <strong>perfidious misuse of humanitarian cover</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-6">
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.totalRecords}</div>
            <div className="text-xs text-muted-foreground">Total Alignments</div>
          </div>
          <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{summary.tier1FraudWatch}</div>
            <div className="text-xs text-red-400/70">Tier 1 Fraud Watch</div>
          </div>
          <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-400">{summary.tier2Suspect}</div>
            <div className="text-xs text-amber-400/70">Tier 2 Suspect</div>
          </div>
          <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{summary.highMatchAlerts}</div>
            <div className="text-xs text-purple-400/70">High Match (85%+)</div>
          </div>
          <div className="bg-rose-950/30 border border-rose-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-rose-400">{summary.zeroMedicalMissions}</div>
            <div className="text-xs text-rose-400/70">0% Medical Missions</div>
          </div>
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.uniqueOperators}</div>
            <div className="text-xs text-muted-foreground">Unique Operators</div>
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
          <p>Schema not initialized. Click "Initialize Schema" to create the medical behavioral alignment table.</p>
        </div>
      ) : alignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No alignment data yet. Click "Compute Medical Alignment" to analyze medical aircraft patterns.</p>
        </div>
      ) : (
        <ScrollArea className="h-[600px]">
          <div className="space-y-3">
            {alignments.map((alignment) => (
              <div 
                key={alignment.id || `${alignment.operator_name}-${alignment.aircraft_tail}`}
                className={`border rounded-lg p-4 transition-all ${
                  parseFloat(String(alignment.match_score_to_kcso)) >= 85 
                    ? 'border-red-500/50 bg-red-950/20' 
                    : parseFloat(String(alignment.match_score_to_kcso)) >= 70
                    ? 'border-amber-500/30 bg-amber-950/10'
                    : 'border-border/50 bg-card/30'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Operator Info */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-2">
                      <Hospital className="w-4 h-4 text-rose-400" />
                      <span className="font-semibold text-foreground">{alignment.operator_name}</span>
                      <Badge variant="outline" className="text-xs">{alignment.operator_type}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Plane className="w-4 h-4 text-primary" />
                      <span className="font-mono text-primary">{alignment.aircraft_tail}</span>
                      {getFraudBadge(alignment.medical_mission_logged)}
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

                {/* Fraud Indicators */}
                {alignment.fraud_indicators && (
                  <div className="mt-3 pt-3 border-t border-rose-500/20">
                    <div className="flex items-start gap-2 text-xs">
                      <FileWarning className="w-4 h-4 text-rose-400 mt-0.5" />
                      <span className="text-rose-300">{alignment.fraud_indicators}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-border/30 text-xs text-muted-foreground">
        <p>
          <strong>Methodology:</strong> Medical behavioral alignment scores compare Air Methods, Mercy Air, and 
          other MEDEVAC operators against KCSO Tier 1 reference assets (N912KC/N913KC). Scores ≥85% with 0% 
          logged medical missions indicate potential False Claims Act violations. Pattern matching evaluates 
          altitude profiles, low-altitude persistence, loitering behavior, and biometric correlation windows (±10 min).
          <span className="text-rose-400 ml-1">Geneva Convention Article 36 prohibits perfidious use of humanitarian emblems.</span>
        </p>
      </div>
    </CyberPanel>
  );
}

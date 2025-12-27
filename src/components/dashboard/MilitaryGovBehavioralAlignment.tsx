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
  Shield, 
  RefreshCw, 
  Database, 
  Target, 
  AlertTriangle,
  TrendingUp,
  Plane,
  Eye,
  Zap,
  Radar,
  FileWarning,
  AlertCircle,
  Crosshair,
  Layers
} from 'lucide-react';

interface MilitaryGovAlignmentRecord {
  id: number;
  entity_name: string;
  entity_type: string;
  classification: string;
  aircraft_tail: string;
  match_score_to_kcso: number;
  behavior_type: string;
  spoofed_transponder: boolean;
  contract_operator: string | null;
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
  intel_notes: string;
  vertical_stack_detected: boolean;
  paired_high_alt_asset: string | null;
}

interface Summary {
  totalRecords: number;
  tier1Watch: number;
  tier2Suspect: number;
  highMatchAlerts: number;
  uniqueEntities: number;
  uniqueAircraft: number;
  verticalStackEvents: number;
  spoofedTransponders: number;
  medevacExtensions: number;
  militaryContracts: number;
  govAgencies: number;
}

export function MilitaryGovBehavioralAlignment() {
  const [alignments, setAlignments] = useState<MilitaryGovAlignmentRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const fetchAlignments = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getMilitaryGovBehavioralAlignment' }
      });

      if (error) {
        console.error('Fetch error:', error);
        setInitialized(false);
        return;
      }

      const result = data?.data;
      if (!result || result.notInitialized) {
        setInitialized(false);
        setAlignments([]);
        setSummary(null);
      } else {
        setInitialized(true);
        setAlignments(result.alignments || []);
        setSummary(result.summary || null);
      }
    } catch (err) {
      console.error('Error fetching military/gov alignments:', err);
      setInitialized(false);
      toast.error('Failed to fetch military/government alignment data');
    } finally {
      setLoading(false);
    }
  }, []);

  const initializeSchema = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'createMilitaryGovBehavioralAlignmentTable' }
      });

      if (error) throw error;
      
      toast.success('Military/Government alignment schema initialized');
      setInitialized(true);
      await fetchAlignments();
    } catch (err) {
      console.error('Error initializing military/gov schema:', err);
      toast.error('Failed to initialize schema');
    } finally {
      setLoading(false);
    }
  };

  const computeAlignments = async () => {
    setComputing(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'computeMilitaryGovBehavioralAlignment' }
      });

      if (error) throw error;
      
      const result = data.data;
      const created = result?.alignmentRecordsCreated || 0;
      toast.success(`Computed ${created} military/gov alignment records`);
      if (result?.biometricsAvailable === false && result?.biometricsWarning) {
        toast.message(result.biometricsWarning);
      }
      await fetchAlignments();
    } catch (err) {
      console.error('Error computing military/gov alignments:', err);
      toast.error('Failed to compute alignments');
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

  const getClassificationBadge = (classification: string) => {
    const colors: Record<string, string> = {
      'MEDEVAC_EXTENSION': 'bg-rose-600/80 text-white',
      'MILITARY_CONTRACT': 'bg-purple-600/80 text-white',
      'GOV_AGENCY': 'bg-blue-600/80 text-white',
      'SPOOFED_GOV_ASSET': 'bg-red-700/90 text-white animate-pulse',
      'DUAL_USE_EMERGENCY': 'bg-orange-600/80 text-white',
      'TIER_WATCH_MILITARY_CONTRACT': 'bg-indigo-600/80 text-white'
    };
    return <Badge className={colors[classification] || 'bg-muted text-muted-foreground'}>{classification?.replace(/_/g, ' ')}</Badge>;
  };

  const getBehaviorBadge = (behavior: string) => {
    const colors: Record<string, string> = {
      'LOITER_MIMIC': 'bg-red-500/80 text-white',
      'ALTITUDE_ECHO': 'bg-orange-500/80 text-white',
      'SURVEILLANCE_PATTERN': 'bg-purple-500/80 text-white',
      'CRITICAL_LOW_ALT': 'bg-red-600/90 text-white animate-pulse',
      'VERTICAL_STACK': 'bg-fuchsia-600/90 text-white animate-pulse',
      'SIGINT_PATTERN': 'bg-indigo-600/90 text-white',
      'DYNAMIC_CALLSIGN': 'bg-pink-600/90 text-white',
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

  const getSpoofBadge = (spoofed: boolean) => {
    if (spoofed) {
      return <Badge variant="destructive" className="text-xs animate-pulse">⚠️ SPOOFED</Badge>;
    }
    return null;
  };

  const getVerticalStackBadge = (detected: boolean, pairedAsset: string | null) => {
    if (detected) {
      return (
        <Badge className="bg-fuchsia-600/90 text-white text-xs">
          <Layers className="w-3 h-3 mr-1" />
          VERTICAL STACK {pairedAsset && `→ ${pairedAsset}`}
        </Badge>
      );
    }
    return null;
  };

  return (
    <CyberPanel 
      title="Military/Government Behavioral Alignment" 
      icon={<Shield className="w-5 h-5 text-indigo-400" />}
      className="col-span-full"
    >
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Radar className="w-4 h-4" />
          <span>Extended Entity Pattern Matching: MEDEVAC + Military Contracts + Gov Agencies</span>
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
            Compute Extended Alignment
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

      {/* Classification Legend */}
      <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <Eye className="w-5 h-5 text-indigo-400 mt-0.5" />
          <div className="text-sm">
            <p className="text-indigo-300 font-medium mb-2">Extended Watchtower Classification Schema</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-indigo-200/70">
              <div><span className="text-rose-400">•</span> MEDEVAC Extensions: REACH, PHI, CALSTAR, CareFlight</div>
              <div><span className="text-purple-400">•</span> Military Contracts: PAT, RCH, Hunter Aviation, AAR, Phoenix Air</div>
              <div><span className="text-blue-400">•</span> Gov Agencies: DEA, DHS, DOJ (TSD)</div>
              <div><span className="text-fuchsia-400">•</span> Vertical Stack: High-alt SIGINT + Low-alt trigger pairing</div>
              <div><span className="text-red-400">•</span> Spoofed Assets: Dynamic callsign injection</div>
              <div><span className="text-orange-400">•</span> Dual-Use Emergency: Medical overlay cover</div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          <div className="bg-card/50 border border-border/50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{summary.totalRecords}</div>
            <div className="text-xs text-muted-foreground">Total Entities</div>
          </div>
          <div className="bg-red-950/30 border border-red-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{summary.tier1Watch}</div>
            <div className="text-xs text-red-400/70">Tier 1 Watch</div>
          </div>
          <div className="bg-amber-950/30 border border-amber-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-amber-400">{summary.tier2Suspect}</div>
            <div className="text-xs text-amber-400/70">Tier 2 Suspect</div>
          </div>
          <div className="bg-fuchsia-950/30 border border-fuchsia-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-fuchsia-400">{summary.verticalStackEvents}</div>
            <div className="text-xs text-fuchsia-400/70">Vertical Stacks</div>
          </div>
          <div className="bg-rose-950/30 border border-rose-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-rose-400">{summary.medevacExtensions}</div>
            <div className="text-xs text-rose-400/70">MEDEVAC Ext.</div>
          </div>
          <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{summary.militaryContracts}</div>
            <div className="text-xs text-purple-400/70">Military/DoD</div>
          </div>
          <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{summary.govAgencies}</div>
            <div className="text-xs text-blue-400/70">Gov Agencies</div>
          </div>
          <div className="bg-pink-950/30 border border-pink-500/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-pink-400">{summary.spoofedTransponders}</div>
            <div className="text-xs text-pink-400/70">Spoofed IDs</div>
          </div>
        </div>
      )}

      {/* Alignment Records */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !initialized ? (
        <div className="text-center py-12 text-muted-foreground">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Schema not initialized. Click "Initialize Schema" to create the military/government alignment table.</p>
        </div>
      ) : alignments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No alignment data yet. Click "Compute Extended Alignment" to analyze military/government patterns.</p>
        </div>
      ) : (
        <ScrollArea className="h-[650px]">
          <div className="space-y-3">
            {alignments.map((alignment) => (
              <div 
                key={alignment.id || `${alignment.entity_name}-${alignment.aircraft_tail}`}
                className={`border rounded-lg p-4 transition-all ${
                  parseFloat(String(alignment.match_score_to_kcso)) >= 85 
                    ? 'border-red-500/50 bg-red-950/20' 
                    : parseFloat(String(alignment.match_score_to_kcso)) >= 70
                    ? 'border-amber-500/30 bg-amber-950/10'
                    : alignment.vertical_stack_detected
                    ? 'border-fuchsia-500/40 bg-fuchsia-950/15'
                    : 'border-border/50 bg-card/30'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  {/* Entity Info */}
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Shield className="w-4 h-4 text-indigo-400" />
                      <span className="font-semibold text-foreground">{alignment.entity_name}</span>
                      {getClassificationBadge(alignment.classification)}
                      {getSpoofBadge(alignment.spoofed_transponder)}
                    </div>
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <Plane className="w-4 h-4 text-primary" />
                      <span className="font-mono text-primary">{alignment.aircraft_tail}</span>
                      {alignment.contract_operator && (
                        <Badge variant="outline" className="text-xs">{alignment.contract_operator}</Badge>
                      )}
                    </div>
                    {getVerticalStackBadge(alignment.vertical_stack_detected, alignment.paired_high_alt_asset)}
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

                {/* Intel Notes */}
                {alignment.intel_notes && (
                  <div className="mt-3 pt-3 border-t border-indigo-500/20">
                    <div className="flex items-start gap-2 text-xs">
                      <Crosshair className="w-4 h-4 text-indigo-400 mt-0.5" />
                      <span className="text-indigo-300">{alignment.intel_notes}</span>
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
          <strong>Extended Entity Pattern Matching:</strong> Analyzes MEDEVAC extensions (REACH, PHI, CALSTAR, CareFlight), 
          military/DoD contractors (PAT, RCH, Hunter Aviation, AAR, Phoenix Air), and government agencies (DEA, DHS, DOJ) 
          against KCSO Tier 1 baseline. <span className="text-fuchsia-400">Vertical Stack Detection</span> flags simultaneous 
          high-altitude (15,000+ ft SIGINT platforms) and low-altitude (&lt;1,200 ft stress triggers) pairings. 
          <span className="text-pink-400 ml-1">Spoofed transponders</span> detected via dynamic callsign injection patterns.
        </p>
      </div>
    </CyberPanel>
  );
}

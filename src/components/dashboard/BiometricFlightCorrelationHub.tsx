import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Heart, Plane, RefreshCw, Loader2, TrendingUp,
  AlertTriangle, Clock, Activity, Stethoscope
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface BiometricCorrelation {
  id: string;
  timestamp: string;
  aircraft_registration: string;
  correlation_strength: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  heart_rate_delta: number;
  stress_index: number;
  altitude_at_detection: number;
  distance_to_target: number;
  bradford_hill_score: number;
  notes: string;
}

interface PhysicianVerifiedECG {
  id: string;
  verification_date: string;
  physician_name: string;
  finding_summary: string;
  linked_aircraft: string;
  severity: string;
}

export function BiometricFlightCorrelationHub() {
  const [correlations, setCorrelations] = useState<BiometricCorrelation[]>([]);
  const [verifiedECGs, setVerifiedECGs] = useState<PhysicianVerifiedECG[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCorrelations: 0,
    criticalCount: 0,
    highCount: 0,
    avgBradfordHill: 0,
    verifiedECGCount: 0
  });
  const [filter, setFilter] = useState<'all' | 'CRITICAL' | 'HIGH'>('all');

  const loadCorrelations = useCallback(async () => {
    setLoading(true);
    try {
      // Load correlations and verified ECGs in parallel
      const [correlationResult, ecgResult, statsResult] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                id, timestamp, aircraft_registration, correlation_strength,
                heart_rate_delta, stress_index, altitude_at_detection,
                distance_to_target, bradford_hill_score, notes
              FROM biometric_correlations_enhanced
              WHERE correlation_strength IN ('CRITICAL', 'HIGH', 'MEDIUM')
              ORDER BY timestamp DESC
              LIMIT 100
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT * FROM physician_verified_ecgs 
              ORDER BY verification_date DESC 
              LIMIT 20
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE correlation_strength = 'CRITICAL') as critical_count,
                COUNT(*) FILTER (WHERE correlation_strength = 'HIGH') as high_count,
                AVG(bradford_hill_score) as avg_bh
              FROM biometric_correlations_enhanced
            `
          }
        })
      ]);

      // Process correlations
      if (correlationResult.data && Array.isArray(correlationResult.data)) {
        setCorrelations(correlationResult.data.map((c: any) => ({
          id: c.id || String(Math.random()),
          timestamp: c.timestamp || new Date().toISOString(),
          aircraft_registration: c.aircraft_registration || 'Unknown',
          correlation_strength: c.correlation_strength || 'MEDIUM',
          heart_rate_delta: parseFloat(c.heart_rate_delta) || 0,
          stress_index: parseFloat(c.stress_index) || 0,
          altitude_at_detection: parseInt(c.altitude_at_detection) || 0,
          distance_to_target: parseFloat(c.distance_to_target) || 0,
          bradford_hill_score: parseFloat(c.bradford_hill_score) || 0,
          notes: c.notes || ''
        })));
      }

      // Process ECGs
      if (ecgResult.data && Array.isArray(ecgResult.data)) {
        setVerifiedECGs(ecgResult.data.map((e: any) => ({
          id: e.id || String(Math.random()),
          verification_date: e.verification_date || e.date || 'Unknown',
          physician_name: e.physician_name || e.physician || 'Dr. Unknown',
          finding_summary: e.finding_summary || e.findings || e.summary || 'No findings',
          linked_aircraft: e.linked_aircraft || e.aircraft || 'N/A',
          severity: e.severity || 'Moderate'
        })));
      }

      // Process stats
      if (statsResult.data && Array.isArray(statsResult.data) && statsResult.data[0]) {
        const s = statsResult.data[0];
        setStats({
          totalCorrelations: parseInt(s.total) || 0,
          criticalCount: parseInt(s.critical_count) || 0,
          highCount: parseInt(s.high_count) || 0,
          avgBradfordHill: parseFloat(s.avg_bh) || 0,
          verifiedECGCount: ecgResult.data?.length || 0
        });
      }

    } catch (error) {
      console.error('Correlation load error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCorrelations();
  }, [loadCorrelations]);

  const getStrengthColor = (strength: string) => {
    switch (strength) {
      case 'CRITICAL': return 'bg-destructive text-destructive-foreground';
      case 'HIGH': return 'bg-orange-500 text-white';
      case 'MEDIUM': return 'bg-yellow-500 text-black';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStrengthBorderColor = (strength: string) => {
    switch (strength) {
      case 'CRITICAL': return 'border-destructive bg-destructive/10';
      case 'HIGH': return 'border-orange-500 bg-orange-500/10';
      case 'MEDIUM': return 'border-yellow-500 bg-yellow-500/10';
      default: return 'border-border bg-muted/20';
    }
  };

  const filteredCorrelations = filter === 'all' 
    ? correlations 
    : correlations.filter(c => c.correlation_strength === filter);

  return (
    <CyberPanel
      title="BIOMETRIC-FLIGHT CORRELATION HUB"
      icon={<Heart className="w-4 h-4 text-red-400" />}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-red-500/50 text-red-400">
            {stats.totalCorrelations.toLocaleString()} Correlations
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={loadCorrelations}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-red-400" />
          </div>
        ) : (
          <>
            {/* Stats Row */}
            <div className="grid grid-cols-5 gap-2">
              <div className="p-2 bg-destructive/10 rounded-lg border border-destructive/30 text-center">
                <p className="text-xl font-bold text-destructive">{stats.criticalCount}</p>
                <p className="text-[10px] text-muted-foreground">Critical</p>
              </div>
              <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/30 text-center">
                <p className="text-xl font-bold text-orange-400">{stats.highCount}</p>
                <p className="text-[10px] text-muted-foreground">High</p>
              </div>
              <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/30 text-center">
                <p className="text-xl font-bold text-blue-400">{stats.avgBradfordHill.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">Avg B-H Score</p>
              </div>
              <div className="p-2 bg-green-500/10 rounded-lg border border-green-500/30 text-center">
                <p className="text-xl font-bold text-green-400">{stats.verifiedECGCount}</p>
                <p className="text-[10px] text-muted-foreground">Verified ECGs</p>
              </div>
              <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/30 text-center">
                <p className="text-xl font-bold text-purple-400">
                  {((stats.criticalCount + stats.highCount) / Math.max(stats.totalCorrelations, 1) * 100).toFixed(0)}%
                </p>
                <p className="text-[10px] text-muted-foreground">High Priority</p>
              </div>
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={filter === 'all' ? 'default' : 'outline'}
                onClick={() => setFilter('all')}
                className="text-xs h-7"
              >
                All ({correlations.length})
              </Button>
              <Button
                size="sm"
                variant={filter === 'CRITICAL' ? 'destructive' : 'outline'}
                onClick={() => setFilter('CRITICAL')}
                className="text-xs h-7"
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Critical
              </Button>
              <Button
                size="sm"
                variant={filter === 'HIGH' ? 'default' : 'outline'}
                onClick={() => setFilter('HIGH')}
                className="text-xs h-7 bg-orange-500 hover:bg-orange-600"
              >
                High
              </Button>
            </div>

            {/* Correlations List */}
            <ScrollArea className="h-[280px]">
              <div className="space-y-2 pr-4">
                {filteredCorrelations.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Heart className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No correlations found</p>
                  </div>
                ) : (
                  filteredCorrelations.map((corr) => (
                    <div
                      key={corr.id}
                      className={`p-3 rounded-lg border ${getStrengthBorderColor(corr.correlation_strength)}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Plane className="w-4 h-4" />
                          <span className="font-mono font-bold">{corr.aircraft_registration}</span>
                          <Badge className={getStrengthColor(corr.correlation_strength)}>
                            {corr.correlation_strength}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(corr.timestamp).toLocaleString()}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div className="flex items-center gap-1">
                          <Heart className="w-3 h-3 text-red-400" />
                          <span>Δ{corr.heart_rate_delta > 0 ? '+' : ''}{corr.heart_rate_delta} BPM</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Activity className="w-3 h-3 text-orange-400" />
                          <span>Stress: {corr.stress_index.toFixed(1)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <TrendingUp className="w-3 h-3 text-blue-400" />
                          <span>B-H: {corr.bradford_hill_score.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span>{corr.altitude_at_detection.toLocaleString()}ft</span>
                        </div>
                      </div>

                      {/* Bradford-Hill Score Bar */}
                      <div className="mt-2">
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                          <span>Bradford-Hill Causation</span>
                          <span>{(corr.bradford_hill_score * 10).toFixed(0)}%</span>
                        </div>
                        <Progress 
                          value={corr.bradford_hill_score * 10} 
                          className="h-1"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>

            {/* Physician Verified ECGs */}
            {verifiedECGs.length > 0 && (
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Stethoscope className="w-4 h-4 text-green-400" />
                  Physician-Verified ECGs ({verifiedECGs.length})
                </h4>
                <div className="space-y-2">
                  {verifiedECGs.slice(0, 3).map((ecg) => (
                    <div
                      key={ecg.id}
                      className="p-2 rounded bg-green-500/10 border border-green-500/30 text-xs"
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{ecg.physician_name}</span>
                        <span className="text-muted-foreground">{ecg.verification_date}</span>
                      </div>
                      <p className="text-muted-foreground mt-1">{ecg.finding_summary}</p>
                      {ecg.linked_aircraft !== 'N/A' && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          <Plane className="w-2 h-2 mr-1" />
                          {ecg.linked_aircraft}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </CyberPanel>
  );
}

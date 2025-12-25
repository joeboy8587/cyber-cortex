import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { 
  Plane, Heart, Activity, RefreshCw, AlertTriangle, 
  TrendingUp, Zap, Clock, Target, Shield, ChevronDown, ChevronUp 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface AircraftCorrelation {
  matrix_id: string;
  icao: string;
  registration: string | null;
  aircraft_type: string | null;
  owner_name: string | null;
  total_encounters: number;
  encounters_with_biometric_data: number;
  correlation_window_seconds: number;
  avg_hr_during_encounters: number | null;
  max_hr_during_encounters: number | null;
  hr_spike_count: number;
  avg_hr_delta: number | null;
  hr_correlation_coefficient: number | null;
  avg_stress_during_encounters: number | null;
  stress_spike_count: number;
  stress_correlation_coefficient: number | null;
  avg_hrv_during_encounters: number | null;
  hrv_drop_count: number;
  hrv_correlation_coefficient: number | null;
  first_encounter: string;
  last_encounter: string;
  harm_level: string;
  combined_harm_score: number;
  confidence_score: number;
  physiological_impact_score: number;
  threat_multiplier: string;
  statistically_significant: boolean;
  clinically_significant: boolean;
  loitering_correlation: boolean;
  low_altitude_correlation: boolean;
  night_operation_correlation: boolean;
  primary_harm_indicator: string;
}

interface CorrelationStats {
  totalAircraft: number;
  totalCorrelations: number;
  significantCorrelations: number;
  avgHarmScore: number;
  criticalThreats: number;
}

export function DirectAircraftCorrelation() {
  const [loading, setLoading] = useState(true);
  const [correlations, setCorrelations] = useState<AircraftCorrelation[]>([]);
  const [stats, setStats] = useState<CorrelationStats>({
    totalAircraft: 0,
    totalCorrelations: 0,
    significantCorrelations: 0,
    avgHarmScore: 0,
    criticalThreats: 0,
  });
  const [expandedAircraft, setExpandedAircraft] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'significant' | 'critical'>('all');

  const fetchCorrelations = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch aircraft-biometric correlation matrix
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT 
              matrix_id,
              icao,
              registration,
              aircraft_type,
              owner_name,
              total_encounters,
              encounters_with_biometric_data,
              correlation_window_seconds,
              avg_hr_during_encounters,
              max_hr_during_encounters,
              hr_spike_count,
              avg_hr_delta,
              hr_correlation_coefficient,
              avg_stress_during_encounters,
              stress_spike_count,
              stress_correlation_coefficient,
              avg_hrv_during_encounters,
              hrv_drop_count,
              hrv_correlation_coefficient,
              first_encounter,
              last_encounter,
              harm_level,
              combined_harm_score,
              confidence_score,
              physiological_impact_score,
              threat_multiplier,
              statistically_significant,
              clinically_significant,
              loitering_correlation,
              low_altitude_correlation,
              night_operation_correlation,
              primary_harm_indicator
            FROM aircraft_biometric_correlation_matrix
            WHERE total_encounters > 0
            ORDER BY 
              combined_harm_score DESC,
              hr_spike_count DESC,
              total_encounters DESC
            LIMIT 50
          `
        }
      });

      if (error) throw error;

      const results = data?.data || [];
      setCorrelations(results);

      // Calculate stats
      const significant = results.filter((r: AircraftCorrelation) => r.statistically_significant);
      const critical = results.filter((r: AircraftCorrelation) => 
        r.harm_level === 'SEVERE' || r.harm_level === 'CRITICAL' || r.combined_harm_score > 50
      );
      const avgHarm = results.length > 0 
        ? results.reduce((sum: number, r: AircraftCorrelation) => sum + (r.combined_harm_score || 0), 0) / results.length 
        : 0;

      setStats({
        totalAircraft: results.length,
        totalCorrelations: results.reduce((sum: number, r: AircraftCorrelation) => sum + (r.total_encounters || 0), 0),
        significantCorrelations: significant.length,
        avgHarmScore: Math.round(avgHarm * 10) / 10,
        criticalThreats: critical.length,
      });

      toast.success(`Loaded ${results.length} aircraft correlations`);
    } catch (err) {
      console.error("Failed to fetch correlations:", err);
      toast.error("Failed to fetch aircraft correlations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCorrelations();
  }, [fetchCorrelations]);

  const getHarmBadge = (level: string, score: number) => {
    const configs: Record<string, { color: string; icon: typeof AlertTriangle }> = {
      'MINIMAL': { color: 'bg-success/20 text-success border-success/30', icon: Shield },
      'LOW': { color: 'bg-muted/20 text-muted-foreground border-muted/30', icon: Shield },
      'MODERATE': { color: 'bg-warning/20 text-warning border-warning/30', icon: AlertTriangle },
      'SEVERE': { color: 'bg-destructive/20 text-destructive border-destructive/30', icon: AlertTriangle },
      'CRITICAL': { color: 'bg-destructive text-destructive-foreground border-destructive', icon: Zap },
    };
    const config = configs[level] || configs['MINIMAL'];
    const Icon = config.icon;
    return (
      <Badge className={cn("text-[10px] px-1.5 py-0.5 border", config.color)}>
        <Icon className="w-2.5 h-2.5 mr-1" />
        {level} ({score})
      </Badge>
    );
  };

  const getCorrelationStrength = (coefficient: number | null) => {
    if (coefficient === null) return { label: 'N/A', color: 'text-muted-foreground' };
    const abs = Math.abs(coefficient);
    if (abs >= 0.7) return { label: 'Strong', color: 'text-destructive' };
    if (abs >= 0.5) return { label: 'Moderate', color: 'text-warning' };
    if (abs >= 0.3) return { label: 'Weak', color: 'text-muted-foreground' };
    return { label: 'Negligible', color: 'text-muted-foreground/50' };
  };

  const filteredCorrelations = correlations.filter(c => {
    if (filter === 'significant') return c.statistically_significant;
    if (filter === 'critical') return c.harm_level === 'SEVERE' || c.harm_level === 'CRITICAL' || c.combined_harm_score > 50;
    return true;
  });

  return (
    <CyberPanel
      title="Direct Aircraft-Biometric Correlations"
      icon={<Target className="w-4 h-4" />}
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={fetchCorrelations}
          disabled={loading}
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-2">
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Plane className="w-4 h-4 mx-auto mb-1 text-primary" />
            <p className="font-display text-lg text-primary">{stats.totalAircraft}</p>
            <p className="text-[10px] text-muted-foreground">Aircraft</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Activity className="w-4 h-4 mx-auto mb-1 text-warning" />
            <p className="font-display text-lg text-warning">{stats.totalCorrelations.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Encounters</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-success" />
            <p className="font-display text-lg text-success">{stats.significantCorrelations}</p>
            <p className="text-[10px] text-muted-foreground">Significant</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Heart className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <p className="font-display text-lg text-destructive">{stats.avgHarmScore}</p>
            <p className="text-[10px] text-muted-foreground">Avg Harm</p>
          </div>
          <div className="text-center p-2 bg-destructive/20 rounded border border-destructive/30">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <p className="font-display text-lg text-destructive glow-red">{stats.criticalThreats}</p>
            <p className="text-[10px] text-muted-foreground">Critical</p>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {(['all', 'significant', 'critical'] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setFilter(f)}
            >
              {f === 'all' && 'All Aircraft'}
              {f === 'significant' && 'Significant Only'}
              {f === 'critical' && 'Critical Threats'}
            </Button>
          ))}
        </div>

        {/* Aircraft List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
            <p className="text-xs">Loading correlation matrix...</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
            {filteredCorrelations.map((aircraft) => (
              <div
                key={aircraft.matrix_id}
                className={cn(
                  "border rounded-lg transition-all",
                  aircraft.harm_level === 'CRITICAL' || aircraft.harm_level === 'SEVERE'
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border bg-muted/10"
                )}
              >
                {/* Aircraft Header */}
                <div
                  className="p-3 cursor-pointer flex items-center justify-between"
                  onClick={() => setExpandedAircraft(
                    expandedAircraft === aircraft.matrix_id ? null : aircraft.matrix_id
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Plane className={cn(
                      "w-5 h-5",
                      aircraft.harm_level === 'CRITICAL' ? "text-destructive" :
                      aircraft.harm_level === 'SEVERE' ? "text-destructive/80" :
                      "text-primary"
                    )} />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">
                          {aircraft.icao}
                        </span>
                        {aircraft.registration && (
                          <span className="text-xs text-muted-foreground">
                            ({aircraft.registration})
                          </span>
                        )}
                      </div>
                      {aircraft.owner_name && (
                        <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {aircraft.owner_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getHarmBadge(aircraft.harm_level, aircraft.combined_harm_score)}
                    <div className="text-right text-xs">
                      <p className="text-muted-foreground">
                        {aircraft.total_encounters} encounters
                      </p>
                      <p className="text-destructive font-medium">
                        {aircraft.hr_spike_count} HR spikes
                      </p>
                    </div>
                    {expandedAircraft === aircraft.matrix_id ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedAircraft === aircraft.matrix_id && (
                  <div className="px-3 pb-3 border-t border-border pt-3 space-y-3">
                    {/* Correlation Metrics */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-[10px] text-muted-foreground mb-1">HR Correlation</p>
                        <p className={cn("font-mono text-sm font-bold", 
                          getCorrelationStrength(aircraft.hr_correlation_coefficient).color
                        )}>
                          {aircraft.hr_correlation_coefficient?.toFixed(3) || 'N/A'}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {getCorrelationStrength(aircraft.hr_correlation_coefficient).label}
                        </p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-[10px] text-muted-foreground mb-1">Stress Correlation</p>
                        <p className={cn("font-mono text-sm font-bold",
                          getCorrelationStrength(aircraft.stress_correlation_coefficient).color
                        )}>
                          {aircraft.stress_correlation_coefficient?.toFixed(3) || 'N/A'}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {getCorrelationStrength(aircraft.stress_correlation_coefficient).label}
                        </p>
                      </div>
                      <div className="p-2 bg-muted/30 rounded text-center">
                        <p className="text-[10px] text-muted-foreground mb-1">HRV Correlation</p>
                        <p className={cn("font-mono text-sm font-bold",
                          getCorrelationStrength(aircraft.hrv_correlation_coefficient).color
                        )}>
                          {aircraft.hrv_correlation_coefficient?.toFixed(3) || 'N/A'}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {getCorrelationStrength(aircraft.hrv_correlation_coefficient).label}
                        </p>
                      </div>
                    </div>

                    {/* Biometric Impact */}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <Heart className="w-3 h-3 text-destructive" />
                        <span className="text-muted-foreground">Avg HR:</span>
                        <span className="font-mono text-foreground">
                          {aircraft.avg_hr_during_encounters?.toFixed(1) || 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Heart className="w-3 h-3 text-destructive" />
                        <span className="text-muted-foreground">Max HR:</span>
                        <span className="font-mono text-foreground">
                          {aircraft.max_hr_during_encounters || 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3 h-3 text-warning" />
                        <span className="text-muted-foreground">Stress:</span>
                        <span className="font-mono text-foreground">
                          {aircraft.avg_stress_during_encounters?.toFixed(1) || 'N/A'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-primary" />
                        <span className="text-muted-foreground">HRV:</span>
                        <span className="font-mono text-foreground">
                          {aircraft.avg_hrv_during_encounters?.toFixed(1) || 'N/A'}
                        </span>
                      </div>
                    </div>

                    {/* Behavioral Flags */}
                    <div className="flex gap-2 flex-wrap">
                      {aircraft.loitering_correlation && (
                        <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                          Loitering Pattern
                        </Badge>
                      )}
                      {aircraft.low_altitude_correlation && (
                        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                          Low Altitude
                        </Badge>
                      )}
                      {aircraft.night_operation_correlation && (
                        <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">
                          Night Operations
                        </Badge>
                      )}
                      {aircraft.statistically_significant && (
                        <Badge variant="outline" className="text-[10px] bg-success/10 text-success border-success/30">
                          Statistically Significant
                        </Badge>
                      )}
                      {aircraft.clinically_significant && (
                        <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-destructive/30">
                          Clinically Significant
                        </Badge>
                      )}
                    </div>

                    {/* Timeline */}
                    <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        First: {new Date(aircraft.first_encounter).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Last: {new Date(aircraft.last_encounter).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3" />
                        Window: {aircraft.correlation_window_seconds}s
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        Threat: ×{aircraft.threat_multiplier}
                      </div>
                    </div>

                    {/* Primary Harm Indicator */}
                    <div className="p-2 bg-destructive/10 border border-destructive/20 rounded">
                      <p className="text-[10px] text-destructive font-bold">
                        PRIMARY HARM INDICATOR: {aircraft.primary_harm_indicator}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Physiological Impact Score: {aircraft.physiological_impact_score} | 
                        Confidence: {(aircraft.confidence_score * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {filteredCorrelations.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No correlations found for selected filter</p>
              </div>
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

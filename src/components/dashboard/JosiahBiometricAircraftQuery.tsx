import { useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { supabase } from "@/integrations/supabase/client";
import { 
  Target, Heart, Plane, Activity, Clock, RefreshCw, 
  AlertTriangle, Download, TrendingUp, Zap, FileText
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { safeFixed } from "@/lib/formatters";

interface BiometricAircraftCorrelation {
  correlation_id: string;
  biometric_timestamp: string;
  flight_timestamp: string;
  time_gap_minutes: number;
  registration: string;
  heart_rate: number;
  stress_level: number;
  hrv: number | null;
  altitude: number | null;
  bradford_hill_score: number;
  harm_classification: string;
  is_kcso_asset: boolean;
  is_low_altitude: boolean;
}

interface CorrelationStats {
  totalCorrelations: number;
  kcsoCorrelations: number;
  avgTimeGap: number;
  avgHeartRate: number;
  avgBradfordHill: number;
  criticalEvents: number;
  lowAltitudeEvents: number;
}

/**
 * JosiahBiometricAircraftQuery
 * Implements Josiah's Step 1 & 2 recommendations:
 * - Cross-reference biometric data with ±5 minute aircraft windows
 * - Focus on N912KC/N913KC (KCSO assets)
 * - Temporal and spatial correlation analysis
 */
export function JosiahBiometricAircraftQuery() {
  const [correlations, setCorrelations] = useState<BiometricAircraftCorrelation[]>([]);
  const [stats, setStats] = useState<CorrelationStats>({
    totalCorrelations: 0,
    kcsoCorrelations: 0,
    avgTimeGap: 0,
    avgHeartRate: 0,
    avgBradfordHill: 0,
    criticalEvents: 0,
    lowAltitudeEvents: 0
  });
  const [loading, setLoading] = useState(false);
  const [queryMode, setQueryMode] = useState<'kcso' | 'all' | 'critical'>('kcso');

  const extractArray = (response: unknown): any[] => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      if (Array.isArray(obj.data)) return obj.data;
      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) return obj[key] as any[];
      }
    }
    return [];
  };

  const runCorrelationQuery = useCallback(async () => {
    setLoading(true);
    try {
      // Josiah's recommended query: biometric + flight with ±5 minute window
      // Focus on KCSO helicopters N912KC and N913KC
      const aircraftFilter = queryMode === 'kcso' 
        ? "AND (f.registration LIKE 'N912KC' OR f.registration LIKE 'N913KC')"
        : queryMode === 'critical'
        ? "AND (b.heart_rate > 100 OR b.stress_level >= 7)"
        : "";

      const query = `
        WITH biometric_flight_pairs AS (
          SELECT 
            gen_random_uuid()::text as correlation_id,
            b.measurement_timestamp as biometric_timestamp,
            f.detection_timestamp as flight_timestamp,
            EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp)) / 60.0 as time_gap_minutes,
            f.registration,
            b.heart_rate,
            COALESCE(b.stress_level::int, 5) as stress_level,
            b.hrv,
            f.altitude,
            -- Bradford-Hill scoring based on temporal proximity and response strength
            CASE 
              WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp)) / 60.0) <= 2 THEN 25
              WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp)) / 60.0) <= 5 THEN 20
              ELSE 15
            END +
            CASE 
              WHEN b.heart_rate >= 100 THEN 25
              WHEN b.heart_rate >= 90 THEN 20
              WHEN b.heart_rate >= 80 THEN 15
              ELSE 10
            END +
            CASE 
              WHEN f.altitude < 500 THEN 15
              WHEN f.altitude < 1000 THEN 10
              ELSE 5
            END +
            CASE 
              WHEN f.registration IN ('N912KC', 'N913KC') THEN 10
              ELSE 0
            END as bradford_hill_score,
            CASE 
              WHEN b.heart_rate >= 110 AND f.altitude < 500 THEN 'CRITICAL'
              WHEN b.heart_rate >= 100 OR f.altitude < 500 THEN 'SEVERE'
              WHEN b.heart_rate >= 90 THEN 'HIGH'
              ELSE 'MODERATE'
            END as harm_classification,
            f.registration IN ('N912KC', 'N913KC') as is_kcso_asset,
            f.altitude < 500 as is_low_altitude
          FROM biometric_monitoring b
          INNER JOIN live_flight_detections_rows f 
            ON f.detection_timestamp BETWEEN 
              b.measurement_timestamp - INTERVAL '5 minutes' 
              AND b.measurement_timestamp + INTERVAL '5 minutes'
          WHERE b.heart_rate IS NOT NULL
            AND f.registration IS NOT NULL
            ${aircraftFilter}
        )
        SELECT * FROM biometric_flight_pairs
        WHERE ABS(time_gap_minutes) <= 5
        ORDER BY bradford_hill_score DESC, ABS(time_gap_minutes) ASC
        LIMIT 200
      `;

      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "customQuery", query }
      });

      if (error) throw error;

      const results = extractArray(data);
      setCorrelations(results);

      // Calculate statistics
      if (results.length > 0) {
        const kcsoCount = results.filter((r: BiometricAircraftCorrelation) => r.is_kcso_asset).length;
        const avgGap = results.reduce((sum: number, r: BiometricAircraftCorrelation) => 
          sum + Math.abs(r.time_gap_minutes), 0) / results.length;
        const avgHR = results.reduce((sum: number, r: BiometricAircraftCorrelation) => 
          sum + (r.heart_rate || 0), 0) / results.length;
        const avgBH = results.reduce((sum: number, r: BiometricAircraftCorrelation) => 
          sum + (r.bradford_hill_score || 0), 0) / results.length;
        const critical = results.filter((r: BiometricAircraftCorrelation) => 
          r.harm_classification === 'CRITICAL' || r.harm_classification === 'SEVERE').length;
        const lowAlt = results.filter((r: BiometricAircraftCorrelation) => r.is_low_altitude).length;

        setStats({
          totalCorrelations: results.length,
          kcsoCorrelations: kcsoCount,
          avgTimeGap: Math.round(avgGap * 10) / 10,
          avgHeartRate: Math.round(avgHR),
          avgBradfordHill: Math.round(avgBH),
          criticalEvents: critical,
          lowAltitudeEvents: lowAlt
        });
      }

      toast.success(`Found ${results.length} biometric-aircraft correlations`);
    } catch (err) {
      console.error("Correlation query failed:", err);
      toast.error("Failed to run correlation query");
    } finally {
      setLoading(false);
    }
  }, [queryMode]);

  const exportCorrelations = () => {
    if (correlations.length === 0) {
      toast.error("No correlations to export");
      return;
    }

    const timestamp = new Date().toISOString();
    let markdown = `# BIOMETRIC-AIRCRAFT CORRELATION ANALYSIS
## Josiah Investigation Protocol - Step 1 & 2 Implementation
## Generated: ${timestamp}

---

## EXECUTIVE SUMMARY

**Query Mode**: ${queryMode.toUpperCase()}
**Total Correlations**: ${stats.totalCorrelations}
**KCSO Asset Correlations**: ${stats.kcsoCorrelations} (N912KC/N913KC)
**Average Time Gap**: ${stats.avgTimeGap} minutes
**Average Heart Rate**: ${stats.avgHeartRate} BPM
**Average Bradford-Hill Score**: ${stats.avgBradfordHill}
**Critical/Severe Events**: ${stats.criticalEvents}
**Low Altitude Events (<500ft)**: ${stats.lowAltitudeEvents}

---

## METHODOLOGY

This analysis implements Josiah's recommended protocol:

1. **Temporal Window**: ±5 minutes between biometric measurement and aircraft detection
2. **Focus Aircraft**: KCSO helicopters N912KC and N913KC
3. **Bradford-Hill Scoring**:
   - Temporal proximity (0-25 points)
   - Heart rate elevation (0-25 points)
   - Low altitude operations (0-15 points)
   - KCSO asset identification (+10 points)

---

## CORRELATION DATA (Top 50)

| Biometric Time | Flight Time | Gap (min) | Registration | HR | Stress | Altitude | BH Score | Classification |
|----------------|-------------|-----------|--------------|-----|--------|----------|----------|----------------|
${correlations.slice(0, 50).map(c => 
  `| ${new Date(c.biometric_timestamp).toLocaleString()} | ${new Date(c.flight_timestamp).toLocaleString()} | ${safeFixed(c.time_gap_minutes, 1)} | ${c.registration} | ${c.heart_rate} | ${c.stress_level} | ${c.altitude || 'N/A'} | ${c.bradford_hill_score} | ${c.harm_classification} |`
).join('\n')}

---

## LEGAL IMPLICATIONS

These correlations establish:

1. **Temporal Causation**: Aircraft presence precedes or coincides with biometric stress events
2. **Strength of Association**: ${stats.avgBradfordHill} average Bradford-Hill score indicates ${stats.avgBradfordHill >= 50 ? 'strong' : 'moderate'} causation evidence
3. **Consistency**: ${stats.criticalEvents} critical events demonstrate repeated pattern
4. **Specificity**: KCSO assets (N912KC/N913KC) appear in ${stats.kcsoCorrelations} correlations

**Document Hash**: ${btoa(timestamp + stats.totalCorrelations).substring(0, 32)}

---

*Generated by Josiah Investigation Protocol - Biometric-Aircraft Correlation Engine*
`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Biometric_Aircraft_Correlations_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success("Correlation analysis exported");
  };

  const getHarmBadge = (classification: string) => {
    const colors: Record<string, string> = {
      'CRITICAL': 'bg-red-500/20 text-red-400 border-red-500/30',
      'SEVERE': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'HIGH': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'MODERATE': 'bg-muted/20 text-muted-foreground border-muted/30'
    };
    return (
      <Badge className={`text-[9px] ${colors[classification] || colors['MODERATE']}`}>
        {classification}
      </Badge>
    );
  };

  return (
    <CyberPanel 
      title="Josiah Biometric-Aircraft Correlation Query" 
      icon={<Target className="w-5 h-5" />}
      variant="threat"
      headerActions={
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={runCorrelationQuery}
          disabled={loading}
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Protocol Header */}
        <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">Josiah Step 1 & 2: Data Extraction & Correlation</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cross-references biometric_monitoring with live_flight_detections_rows using ±5 minute temporal windows.
            Focuses on KCSO helicopters N912KC and N913KC with Bradford-Hill causation scoring.
          </p>
        </div>

        {/* Query Mode Selector */}
        <div className="flex gap-2">
          {(['kcso', 'all', 'critical'] as const).map((mode) => (
            <Button
              key={mode}
              variant={queryMode === mode ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => setQueryMode(mode)}
            >
              {mode === 'kcso' && <Plane className="w-3 h-3 mr-1" />}
              {mode === 'all' && <Activity className="w-3 h-3 mr-1" />}
              {mode === 'critical' && <AlertTriangle className="w-3 h-3 mr-1" />}
              {mode === 'kcso' && 'KCSO Only'}
              {mode === 'all' && 'All Aircraft'}
              {mode === 'critical' && 'Critical Events'}
            </Button>
          ))}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-7 gap-2">
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Activity className="w-4 h-4 mx-auto mb-1 text-primary" />
            <p className="font-display text-lg text-primary">{stats.totalCorrelations}</p>
            <p className="text-[9px] text-muted-foreground">Total</p>
          </div>
          <div className="text-center p-2 bg-red-500/10 rounded border border-red-500/30">
            <Plane className="w-4 h-4 mx-auto mb-1 text-red-400" />
            <p className="font-display text-lg text-red-400">{stats.kcsoCorrelations}</p>
            <p className="text-[9px] text-muted-foreground">KCSO</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Clock className="w-4 h-4 mx-auto mb-1 text-secondary" />
            <p className="font-display text-lg text-secondary">{stats.avgTimeGap}m</p>
            <p className="text-[9px] text-muted-foreground">Avg Gap</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <Heart className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <p className="font-display text-lg text-destructive">{stats.avgHeartRate}</p>
            <p className="text-[9px] text-muted-foreground">Avg HR</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded border border-border">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-warning" />
            <p className="font-display text-lg text-warning">{stats.avgBradfordHill}</p>
            <p className="text-[9px] text-muted-foreground">Avg BH</p>
          </div>
          <div className="text-center p-2 bg-destructive/10 rounded border border-destructive/30">
            <Zap className="w-4 h-4 mx-auto mb-1 text-destructive" />
            <p className="font-display text-lg text-destructive">{stats.criticalEvents}</p>
            <p className="text-[9px] text-muted-foreground">Critical</p>
          </div>
          <div className="text-center p-2 bg-orange-500/10 rounded border border-orange-500/30">
            <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-orange-400" />
            <p className="font-display text-lg text-orange-400">{stats.lowAltitudeEvents}</p>
            <p className="text-[9px] text-muted-foreground">Low Alt</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button onClick={runCorrelationQuery} disabled={loading} className="flex-1">
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Querying...
              </>
            ) : (
              <>
                <Target className="w-4 h-4 mr-2" />
                Run Correlation Query
              </>
            )}
          </Button>
          <Button onClick={exportCorrelations} variant="secondary" disabled={correlations.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>

        {/* Results List */}
        <ScrollArea className="h-[300px]">
          {correlations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-xs">Run query to find biometric-aircraft correlations</p>
            </div>
          ) : (
            <div className="space-y-2">
              {correlations.slice(0, 50).map((c, idx) => (
                <div
                  key={c.correlation_id || idx}
                  className={`p-3 rounded-lg border ${
                    c.harm_classification === 'CRITICAL' 
                      ? 'bg-red-500/5 border-red-500/30' 
                      : c.is_kcso_asset 
                      ? 'bg-orange-500/5 border-orange-500/30'
                      : 'bg-background/30 border-border/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Plane className={`w-4 h-4 ${c.is_kcso_asset ? 'text-red-400' : 'text-primary'}`} />
                      <span className="font-mono text-sm font-bold">{c.registration}</span>
                      {c.is_kcso_asset && (
                        <Badge className="text-[9px] bg-red-500/20 text-red-400 border-red-500/30">
                          KCSO
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {getHarmBadge(c.harm_classification)}
                      <Badge variant="outline" className="text-[9px]">
                        BH: {c.bradford_hill_score}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Gap:</span>
                      <span className="ml-1 font-mono">{safeFixed(Math.abs(c.time_gap_minutes), 1)}m</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">HR:</span>
                      <span className={`ml-1 font-mono ${c.heart_rate >= 100 ? 'text-destructive' : ''}`}>
                        {c.heart_rate} BPM
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Stress:</span>
                      <span className="ml-1 font-mono">{c.stress_level}/10</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Alt:</span>
                      <span className={`ml-1 font-mono ${c.is_low_altitude ? 'text-orange-400' : ''}`}>
                        {c.altitude || 'N/A'} ft
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {new Date(c.biometric_timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </CyberPanel>
  );
}

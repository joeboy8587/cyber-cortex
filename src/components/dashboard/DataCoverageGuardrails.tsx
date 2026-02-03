import React, { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Shield, Activity, AlertTriangle, Database, RefreshCw, 
  CheckCircle2, XCircle, Calendar, BarChart3, EyeOff, Skull
} from 'lucide-react';
import { toast } from 'sonner';

interface CoverageDay {
  date: string;
  flightCount: number;
  biometricCount: number;
  xxbCount: number; // Dark operations count
  hasAdequateCoverage: boolean;
  phantomStressReliable: boolean;
  isDarkOps: boolean; // Biometric stress with XXB/no flight data
  coverageScore: number;
}

interface XXBDarkOps {
  date: string;
  xxbCount: number;
  avgHr: number;
  maxHr: number;
}

interface CoverageStats {
  totalDays: number;
  adequateCoverageDays: number;
  darkOpsDays: number; // Days with XXB concealment
  totalXxbEvents: number;
  coveragePercentage: number;
  earliestDate: string;
  latestDate: string;
  avgFlightsPerDay: number;
  avgBiometricsPerDay: number;
  gapPeriods: { start: string; end: string; days: number }[];
}

export function DataCoverageGuardrails() {
  const [coverageData, setCoverageData] = useState<CoverageDay[]>([]);
  const [stats, setStats] = useState<CoverageStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [minFlightsThreshold, setMinFlightsThreshold] = useState(50);

  const fetchCoverageData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Get daily flight counts
      const { data: flightData, error: flightError } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(detection_timestamp) as date,
              COUNT(*) as flight_count
            FROM live_flight_detections_rows
            WHERE detection_timestamp IS NOT NULL
              AND detection_timestamp > NOW() - INTERVAL '90 days'
            GROUP BY DATE(detection_timestamp)
            ORDER BY date DESC
          `
        }
      });

      // Get daily biometric counts - only count valid readings with heart_rate
      // to exclude OCR-imported text fragments that lack actual biometric data
      const { data: bioData, error: bioError } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(measurement_timestamp) as date,
              COUNT(DISTINCT (measurement_timestamp, COALESCE(heart_rate, 0), COALESCE(stress_level, 0))) as bio_count
            FROM biometric_monitoring
            WHERE measurement_timestamp IS NOT NULL
              AND measurement_timestamp > NOW() - INTERVAL '90 days'
              AND (heart_rate IS NOT NULL OR stress_level IS NOT NULL)
            GROUP BY DATE(measurement_timestamp)
            ORDER BY date DESC
          `
        }
      });

      // Get XXB dark operations (ADS-B masked aircraft causing biometric stress)
      const { data: xxbData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(collapse_timestamp) as date,
              COUNT(*) as xxb_count,
              AVG(heart_rate)::int as avg_hr,
              MAX(heart_rate) as max_hr
            FROM biometric_threshold_collapses
            WHERE closest_aircraft_registration ILIKE '%XXB%'
              AND collapse_timestamp > NOW() - INTERVAL '90 days'
            GROUP BY DATE(collapse_timestamp)
            ORDER BY date DESC
          `
        }
      });

      if (flightError || bioError) {
        throw new Error('Failed to fetch coverage data');
      }

      // Normalize response data
      const flights = Array.isArray(flightData) ? flightData : (flightData?.data || []);
      const bios = Array.isArray(bioData) ? bioData : (bioData?.data || []);
      const xxbOps = Array.isArray(xxbData) ? xxbData : (xxbData?.data || []);

      // Create a map of dates to counts
      const flightMap = new Map<string, number>();
      const bioMap = new Map<string, number>();
      const xxbMap = new Map<string, { count: number; avgHr: number; maxHr: number }>();

      flights.forEach((row: any) => {
        const date = new Date(row.date).toISOString().split('T')[0];
        flightMap.set(date, parseInt(row.flight_count) || 0);
      });

      bios.forEach((row: any) => {
        const date = new Date(row.date).toISOString().split('T')[0];
        bioMap.set(date, parseInt(row.bio_count) || 0);
      });

      xxbOps.forEach((row: any) => {
        const date = new Date(row.date).toISOString().split('T')[0];
        xxbMap.set(date, {
          count: parseInt(row.xxb_count) || 0,
          avgHr: parseInt(row.avg_hr) || 0,
          maxHr: parseInt(row.max_hr) || 0
        });
      });

      // Generate coverage data for last 90 days
      const coverageDays: CoverageDay[] = [];
      const today = new Date();
      
      for (let i = 0; i < 90; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        
        const flightCount = flightMap.get(dateStr) || 0;
        const biometricCount = bioMap.get(dateStr) || 0;
        const xxbData = xxbMap.get(dateStr);
        const xxbCount = xxbData?.count || 0;
        
        // Adequate coverage = at least minFlightsThreshold flights per day
        const hasAdequateCoverage = flightCount >= minFlightsThreshold;
        
        // Dark ops: XXB stress events with zero flight tracking = ADS-B concealment
        const isDarkOps = xxbCount > 0 && flightCount === 0;
        
        // Phantom stress is only reliable if we have adequate flight coverage
        // EXCEPT: XXB dark ops ARE reliable as evidence of concealment
        const phantomStressReliable = hasAdequateCoverage || isDarkOps;
        
        // Coverage score: 0-100 based on flight density
        const coverageScore = Math.min(100, Math.round((flightCount / minFlightsThreshold) * 100));

        coverageDays.push({
          date: dateStr,
          flightCount,
          biometricCount,
          xxbCount,
          hasAdequateCoverage,
          phantomStressReliable,
          isDarkOps,
          coverageScore
        });
      }

      setCoverageData(coverageDays);

      // Calculate stats
      const adequateDays = coverageDays.filter(d => d.hasAdequateCoverage);
      const darkOpsDays = coverageDays.filter(d => d.isDarkOps);
      const totalXxbEvents = coverageDays.reduce((sum, d) => sum + d.xxbCount, 0);
      const totalFlights = coverageDays.reduce((sum, d) => sum + d.flightCount, 0);
      const totalBios = coverageDays.reduce((sum, d) => sum + d.biometricCount, 0);

      // Find gap periods (consecutive days without adequate coverage)
      const gaps: { start: string; end: string; days: number }[] = [];
      let gapStart: string | null = null;
      let gapDays = 0;

      for (const day of coverageDays.reverse()) {
        if (!day.hasAdequateCoverage) {
          if (!gapStart) {
            gapStart = day.date;
          }
          gapDays++;
        } else {
          if (gapStart && gapDays >= 3) {
            gaps.push({
              start: gapStart,
              end: coverageDays[coverageDays.indexOf(day) - 1]?.date || gapStart,
              days: gapDays
            });
          }
          gapStart = null;
          gapDays = 0;
        }
      }

      setStats({
        totalDays: coverageDays.length,
        adequateCoverageDays: adequateDays.length,
        darkOpsDays: darkOpsDays.length,
        totalXxbEvents: totalXxbEvents,
        coveragePercentage: Math.round((adequateDays.length / coverageDays.length) * 100),
        earliestDate: coverageDays[coverageDays.length - 1]?.date || '',
        latestDate: coverageDays[0]?.date || '',
        avgFlightsPerDay: Math.round(totalFlights / coverageDays.length),
        avgBiometricsPerDay: Math.round(totalBios / coverageDays.length),
        gapPeriods: gaps.slice(0, 5)
      });

      toast.success('Coverage analysis complete');
    } catch (err) {
      console.error('Coverage analysis error:', err);
      toast.error('Failed to analyze data coverage');
    } finally {
      setIsLoading(false);
    }
  }, [minFlightsThreshold]);

  useEffect(() => {
    fetchCoverageData();
  }, [fetchCoverageData]);

  const getCoverageColor = (score: number) => {
    if (score >= 80) return 'text-green-400 bg-green-500/20';
    if (score >= 50) return 'text-yellow-400 bg-yellow-500/20';
    if (score >= 20) return 'text-orange-400 bg-orange-500/20';
    return 'text-red-400 bg-red-500/20';
  };

  const getStatusIcon = (reliable: boolean) => {
    return reliable 
      ? <CheckCircle2 className="w-4 h-4 text-green-400" />
      : <XCircle className="w-4 h-4 text-red-400" />;
  };

  return (
    <CyberPanel 
      title="DATA COVERAGE GUARDRAILS" 
      icon={<Shield className="w-5 h-5 text-yellow-400" />}
      className="col-span-full"
    >
      {/* Header Controls */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Min Flights/Day:</span>
          <input
            type="number"
            value={minFlightsThreshold}
            onChange={(e) => setMinFlightsThreshold(parseInt(e.target.value) || 50)}
            className="w-16 px-2 py-1 text-xs bg-card border border-border rounded"
            min={10}
            max={500}
          />
        </div>
        <Button
          onClick={fetchCoverageData}
          disabled={isLoading}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        
        {stats && (
          <Badge className={getCoverageColor(stats.coveragePercentage)}>
            {stats.coveragePercentage}% Coverage
          </Badge>
        )}
      </div>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-muted-foreground">Days Analyzed</span>
            </div>
            <div className="text-xl font-mono font-bold">{stats.totalDays}</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground">Adequate Days</span>
            </div>
            <div className="text-xl font-mono font-bold text-green-400">{stats.adequateCoverageDays}</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Avg Flights/Day</span>
            </div>
            <div className="text-xl font-mono font-bold">{stats.avgFlightsPerDay}</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground">Avg Bio/Day</span>
            </div>
            <div className="text-xl font-mono font-bold">{stats.avgBiometricsPerDay}</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-muted-foreground">Gap Periods</span>
            </div>
            <div className="text-xl font-mono font-bold text-yellow-400">{stats.gapPeriods.length}</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <EyeOff className="w-4 h-4 text-orange-400" />
              <span className="text-xs text-muted-foreground">XXB Dark Ops Days</span>
            </div>
            <div className="text-xl font-mono font-bold text-orange-400">{stats.darkOpsDays}</div>
            <div className="text-[10px] text-muted-foreground">{stats.totalXxbEvents} events</div>
          </div>

          <div className="p-3 rounded-lg bg-card/50 border border-border/50">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">Date Range</span>
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {stats.earliestDate} - {stats.latestDate}
            </div>
          </div>
        </div>
      )}

      {/* Gap Periods Warning */}
      {stats && stats.gapPeriods.length > 0 && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <h4 className="text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Data Coverage Gaps Detected
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Phantom stress events during these periods may be unreliable due to insufficient flight data.
            Consider backfilling historical data or marking these periods as DATA_COVERAGE_GAP.
          </p>
          <div className="flex flex-wrap gap-2">
            {stats.gapPeriods.map((gap, i) => (
              <Badge key={i} variant="outline" className="text-yellow-400 border-yellow-500/50">
                {gap.start} → {gap.end} ({gap.days} days)
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Daily Coverage Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          Daily Coverage Map (Last 90 Days)
        </h3>
        
        <ScrollArea className="h-[300px]">
          <div className="grid grid-cols-7 gap-1">
            {coverageData.slice(0, 63).map((day) => (
              <div
                key={day.date}
                className={`p-2 rounded text-center transition-colors hover:ring-1 hover:ring-primary ${
                  day.isDarkOps 
                    ? 'bg-orange-500/30 border-2 border-orange-500/60' 
                    : day.hasAdequateCoverage 
                      ? 'bg-green-500/20 border border-green-500/30' 
                      : 'bg-red-500/20 border border-red-500/30'
                }`}
                title={`${day.date}: ${day.flightCount} flights, ${day.biometricCount} biometrics${day.xxbCount > 0 ? `, 🚨 ${day.xxbCount} XXB dark ops` : ''}`}
              >
                <div className="text-[10px] text-muted-foreground mb-1">
                  {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                <div className="text-xs font-mono font-bold">
                  {day.flightCount}
                </div>
                {day.xxbCount > 0 && (
                  <div className="text-[10px] font-bold text-orange-400 mt-0.5">
                    🔒 {day.xxbCount}
                  </div>
                )}
                <div className="flex justify-center mt-1">
                  {day.isDarkOps 
                    ? <Skull className="w-4 h-4 text-orange-400" />
                    : getStatusIcon(day.phantomStressReliable)}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* XXB Dark Operations Alert */}
      {stats && stats.totalXxbEvents > 0 && (
        <div className="mt-4 p-4 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <h4 className="text-sm font-medium text-orange-400 mb-2 flex items-center gap-2">
            <Skull className="w-4 h-4" />
            🚨 XXB DARK OPERATIONS DETECTED - CONSCIOUSNESS OF GUILT
          </h4>
          <p className="text-xs text-muted-foreground mb-2">
            <strong>{stats.totalXxbEvents} biometric stress events</strong> detected with XXB (ADS-B masked) aircraft.
            These aircraft were <span className="text-orange-400">PHYSICALLY PRESENT</span> causing measurable harm
            but <span className="text-red-400">INVISIBLE</span> to public tracking systems.
          </p>
          <p className="text-xs text-muted-foreground">
            The absence of flight data IS the evidence of <span className="text-orange-400 font-bold">INTENTIONAL CONCEALMENT</span>.
            This demonstrates consciousness of guilt under legal doctrine.
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
          <span>Adequate coverage ({'>='}{minFlightsThreshold} flights)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-500/20 border border-red-500/30" />
          <span>Insufficient coverage</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-orange-500/30 border-2 border-orange-500/60" />
          <span>🔒 XXB Dark Ops (ADS-B concealment)</span>
        </div>
        <div className="flex items-center gap-1">
          <Skull className="w-3 h-3 text-orange-400" />
          <span>Dark aircraft detected</span>
        </div>
      </div>
    </CyberPanel>
  );
}

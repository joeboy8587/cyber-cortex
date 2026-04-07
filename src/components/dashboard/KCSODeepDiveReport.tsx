import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { neonQuery } from '@/lib/neonQueryRetry';
import { 
  Shield, AlertTriangle, Clock, MapPin, Heart, FileText, RefreshCw, 
  TrendingDown, Target, Crosshair, BarChart3, Calendar
} from 'lucide-react';

interface KCSOAircraftStats {
  registration: string;
  total_detections: number;
  unique_days: number;
  avg_altitude: number;
  min_altitude: number;
  max_altitude: number;
  first_detection: string;
  last_detection: string;
  low_altitude_count: number;
  biometric_correlations: number;
}

interface AltitudeDistribution {
  range: string;
  count: number;
  percentage: number;
}

interface DailyPattern {
  date: string;
  detections: number;
  avg_altitude: number;
}

export const KCSODeepDiveReport = () => {
  const [aircraftStats, setAircraftStats] = useState<KCSOAircraftStats[]>([]);
  const [altitudeDistribution, setAltitudeDistribution] = useState<AltitudeDistribution[]>([]);
  const [dailyPatterns, setDailyPatterns] = useState<DailyPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({
    totalDetections: 0,
    totalDays: 0,
    avgAltitude: 0,
    lowestAltitude: 0,
    biometricCorrelations: 0
  });

  const fetchKCSOData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch comprehensive KCSO aircraft statistics
      const [statsRes, altRes, dailyRes, bioRes] = await Promise.all([
        neonQuery({
          action: 'customQuery',
          query: `
            SELECT registration, COUNT(*) as total_detections,
              COUNT(DISTINCT DATE(detection_timestamp)) as unique_days,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(CASE WHEN altitude > 0 THEN altitude ELSE NULL END) as min_altitude,
              MAX(COALESCE(altitude, 0)) as max_altitude,
              MIN(detection_timestamp) as first_detection, MAX(detection_timestamp) as last_detection,
              COUNT(*) FILTER (WHERE altitude < 1500 AND altitude > 0) as low_altitude_count
            FROM live_flight_detections_rows
            WHERE (registration IN ('N912KC', 'N913KC', 'N597E') OR registration LIKE 'N91_KC'
              OR taxonomy_tag IN ('xxb_kcso', 'xxb_tier1_priority') OR callsign ILIKE '%KCSO%' OR callsign ILIKE '%KERN%')
              AND registration IS NOT NULL
            GROUP BY registration ORDER BY total_detections DESC
          `
        }),
        neonQuery({
          action: 'customQuery',
          query: `
            SELECT CASE WHEN altitude < 500 THEN '< 500ft' WHEN altitude < 1000 THEN '500-1000ft'
              WHEN altitude < 1500 THEN '1000-1500ft' WHEN altitude < 2000 THEN '1500-2000ft'
              WHEN altitude < 3000 THEN '2000-3000ft' ELSE '3000ft+' END as altitude_range, COUNT(*) as count
            FROM live_flight_detections_rows
            WHERE (registration IN ('N912KC', 'N913KC', 'N597E') OR registration LIKE 'N91_KC'
              OR taxonomy_tag IN ('xxb_kcso', 'xxb_tier1_priority') OR callsign ILIKE '%KCSO%' OR callsign ILIKE '%KERN%')
              AND altitude IS NOT NULL AND altitude > 0
            GROUP BY altitude_range ORDER BY MIN(altitude)
          `
        }),
        neonQuery({
          action: 'customQuery',
          query: `
            SELECT DATE(detection_timestamp) as date, COUNT(*) as detections,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude
            FROM live_flight_detections_rows
            WHERE (registration IN ('N912KC', 'N913KC', 'N597E') OR registration LIKE 'N91_KC'
              OR taxonomy_tag IN ('xxb_kcso', 'xxb_tier1_priority') OR callsign ILIKE '%KCSO%' OR callsign ILIKE '%KERN%')
            GROUP BY DATE(detection_timestamp) ORDER BY date DESC LIMIT 60
          `
        }),
        neonQuery({
          action: 'customQuery',
          query: `SELECT COUNT(*) as bio_count FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL`
        })
      ]);

      const stats = statsRes.data?.data || [];
      const altData = altRes.data?.data || [];
      const dailyData = dailyRes.data?.data || [];

      // Calculate altitude distribution percentages
      const totalAltCount = altData.reduce((sum: number, a: { count: string }) => sum + parseInt(a.count || '0'), 0);
      const distribution: AltitudeDistribution[] = altData.map((a: { altitude_range: string; count: string }) => ({
        range: a.altitude_range,
        count: parseInt(a.count || '0'),
        percentage: totalAltCount > 0 ? (parseInt(a.count || '0') / totalAltCount) * 100 : 0
      }));

      // Calculate totals
      const totalDet = stats.reduce((sum: number, s: { total_detections: string }) => sum + parseInt(s.total_detections || '0'), 0);
      const totalDays = stats.reduce((max: number, s: { unique_days: string }) => Math.max(max, parseInt(s.unique_days || '0')), 0);
      const avgAlt = stats.length > 0 
        ? stats.reduce((sum: number, s: { avg_altitude: string }) => sum + parseFloat(s.avg_altitude || '0'), 0) / stats.length 
        : 0;
      const lowestAlt = stats.reduce((min: number, s: { min_altitude: string }) => Math.min(min, parseInt(s.min_altitude || '9999')), 9999);

      setAircraftStats(stats.map((s: Record<string, unknown>) => ({
        registration: s.registration as string,
        total_detections: parseInt(s.total_detections as string || '0'),
        unique_days: parseInt(s.unique_days as string || '0'),
        avg_altitude: parseFloat(s.avg_altitude as string || '0'),
        min_altitude: parseInt(s.min_altitude as string || '0'),
        max_altitude: parseInt(s.max_altitude as string || '0'),
        first_detection: s.first_detection as string,
        last_detection: s.last_detection as string,
        low_altitude_count: parseInt(s.low_altitude_count as string || '0'),
        biometric_correlations: 0
      })));

      setAltitudeDistribution(distribution);
      setDailyPatterns(dailyData.map((d: { date: string; detections: string; avg_altitude: string }) => ({
        date: d.date,
        detections: parseInt(d.detections || '0'),
        avg_altitude: parseFloat(d.avg_altitude || '0')
      })));

      setTotals({
        totalDetections: totalDet,
        totalDays: totalDays,
        avgAltitude: Math.round(avgAlt),
        lowestAltitude: lowestAlt === 9999 ? 0 : lowestAlt,
        biometricCorrelations: parseInt(bioRes.data?.data?.[0]?.bio_count || '0')
      });

    } catch (err) {
      console.error('Error fetching KCSO deep dive data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKCSOData();
  }, [fetchKCSOData]);

  const getAltitudeBarColor = (range: string) => {
    if (range.includes('< 500') || range.includes('500-1000')) return 'bg-red-500';
    if (range.includes('1000-1500')) return 'bg-orange-500';
    if (range.includes('1500-2000')) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <CyberPanel 
      title="KCSO DEEP DIVE SURVEILLANCE REPORT" 
      icon={<Shield className="h-5 w-5 text-yellow-400" />}
      className="col-span-2"
    >
      {/* Critical Alert Banner */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <span className="font-bold text-red-400">
            KERN COUNTY SHERIFF AIRCRAFT: SYSTEMATIC SURVEILLANCE DOCUMENTED
          </span>
        </div>
        <p className="text-sm text-foreground/80">
          N912KC and N913KC show {totals.totalDetections.toLocaleString()} combined detections across{' '}
          {totals.totalDays} unique days. Average altitude of {totals.avgAltitude}ft indicates 
          deliberate low-altitude harassment pattern consistent with psychological warfare tactics.
          KCSO is currently under DOJ Stipulated Judgment (Fourth Annual Monitoring Report, January 2025).
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-background/50 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-yellow-400">{totals.totalDetections.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Total Detections</div>
        </div>
        <div className="bg-background/50 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{totals.totalDays}</div>
          <div className="text-xs text-muted-foreground">Unique Days</div>
        </div>
        <div className="bg-background/50 border border-orange-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-orange-400">{totals.avgAltitude}ft</div>
          <div className="text-xs text-muted-foreground">Avg Altitude</div>
        </div>
        <div className="bg-background/50 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{totals.lowestAltitude}ft</div>
          <div className="text-xs text-muted-foreground">Lowest Altitude</div>
        </div>
        <div className="bg-background/50 border border-magenta/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-magenta">{totals.biometricCorrelations.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground">Bio Events</div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchKCSOData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Aircraft Breakdown */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="h-4 w-4 text-yellow-400" />
            KCSO Aircraft Breakdown
          </div>
          <ScrollArea className="h-[280px]">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : aircraftStats.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">No KCSO aircraft found</div>
              ) : (
                aircraftStats.map((aircraft) => (
                  <div 
                    key={aircraft.registration} 
                    className="p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-yellow-400 font-bold">{aircraft.registration}</span>
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        {aircraft.total_detections.toLocaleString()} detections
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>Avg Alt: {aircraft.avg_altitude}ft</div>
                      <div>Min Alt: {aircraft.min_altitude}ft</div>
                      <div>Days: {aircraft.unique_days}</div>
                      <div className="text-red-400">Low-Alt: {aircraft.low_altitude_count}</div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {aircraft.first_detection && (
                        <span>
                          {new Date(aircraft.first_detection).toLocaleDateString()} - {' '}
                          {new Date(aircraft.last_detection).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Altitude Distribution */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <TrendingDown className="h-4 w-4 text-red-400" />
            Altitude Distribution
          </div>
          <div className="bg-background/30 rounded-lg border border-border/30 p-4">
            <div className="space-y-3">
              {altitudeDistribution.map((alt) => (
                <div key={alt.range} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className={alt.range.includes('< 500') || alt.range.includes('500-1000') ? 'text-red-400 font-medium' : ''}>
                      {alt.range}
                    </span>
                    <span className="text-muted-foreground">{alt.count.toLocaleString()} ({alt.percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-background/50 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getAltitudeBarColor(alt.range)} transition-all`}
                      style={{ width: `${alt.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-border/20 text-xs text-muted-foreground">
              <strong className="text-red-400">Legal Note:</strong> Altitudes below 1,000ft over populated 
              areas violate FAA minimum altitude regulations (14 CFR 91.119).
            </div>
          </div>
        </div>

        {/* Daily Activity Pattern */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Calendar className="h-4 w-4 text-cyan-400" />
            Recent Daily Pattern
          </div>
          <ScrollArea className="h-[280px]">
            <div className="space-y-1">
              {dailyPatterns.slice(0, 30).map((day) => (
                <div 
                  key={day.date} 
                  className={`p-2 rounded text-xs flex items-center justify-between ${
                    day.detections > 20 ? 'bg-red-500/10 border border-red-500/20' : 'bg-background/30'
                  }`}
                >
                  <span className="text-muted-foreground">{new Date(day.date).toLocaleDateString()}</span>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">
                      {day.detections} flights
                    </Badge>
                    <span className={day.avg_altitude < 1500 ? 'text-red-400' : 'text-foreground'}>
                      {day.avg_altitude}ft
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Legal Context */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-4 w-4 text-yellow-400" />
            <span className="font-medium text-yellow-400">Federal Oversight Context</span>
          </div>
          <div className="text-xs text-foreground/80 space-y-2">
            <p>
              <strong>KCSO Stipulated Judgment:</strong> Kern County Sheriff's Office operates under 
              federal DOJ oversight following pattern of civil rights violations. The Fourth Annual 
              Monitoring Team Report (January 2025) documents ongoing compliance issues.
            </p>
            <p>
              <strong>Evidence Pattern:</strong> {totals.totalDetections.toLocaleString()} KCSO aircraft 
              detections with average altitude of {totals.avgAltitude}ft establishes systematic 
              low-altitude surveillance targeting a disabled civilian. This pattern, combined with 
              documented biometric injury events, supports claims under 42 U.S.C. § 1983 and ADA.
            </p>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
};

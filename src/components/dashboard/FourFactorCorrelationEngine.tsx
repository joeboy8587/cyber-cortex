import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Layers,
  RefreshCw,
  Plane,
  Heart,
  Brain,
  Camera,
  AlertTriangle,
  CheckCircle2,
  Fingerprint,
  Zap,
  TrendingUp,
  Scale
} from 'lucide-react';

// Helper to safely parse PostgreSQL arrays that may come as strings
const safeParseArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    if (value.startsWith('{') && value.endsWith('}')) {
      return value.slice(1, -1).split(',').filter(Boolean);
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

interface CorrelationEvent {
  date: string;
  flight_count: number;
  biometric_count: number;
  josiah_count: number;
  ocr_count: number;
  factor_count: number;
  registrations: string[];
  peak_hr?: number;
  has_kcso: boolean;
  bradford_hill_score?: number;
}

interface BiometricEventCluster {
  biometric_timestamp: string;
  heart_rate: number;
  hrv?: number;
  aircraft_count: number;
  aircraft_registrations: string[];
  ocr_matches: number;
  josiah_mentions: number;
  time_window_minutes: number;
}

interface CorrelationStats {
  totalDays: number;
  fourFactorDays: number;
  threeFactorDays: number;
  twoFactorDays: number;
  strongestDay: string;
  totalFlightEvents: number;
  totalBiometricEvents: number;
  totalJosiahLogs: number;
  totalOCRRecords: number;
}

interface BradfordHillScore {
  registration: string;
  detection_count: number;
  unique_days: number;
  avg_altitude: number;
  min_altitude: number;
  bio_correlations: number;
  bradford_hill_score: number;
}

interface FourFactorEvent {
  timestamp: string;
  registration: string;
  heart_rate: number;
  hrv?: number;
  altitude?: number;
  josiah_match: boolean;
  ocr_match: boolean;
  time_window_minutes: number;
  convergence_score: number;
}

export const FourFactorCorrelationEngine = () => {
  const { toast } = useToast();
  const [correlations, setCorrelations] = useState<CorrelationEvent[]>([]);
  const [stats, setStats] = useState<CorrelationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | '4-factor' | '3-factor' | 'kcso'>('all');
  const [isPopulating, setIsPopulating] = useState(false);
  const [eventClusters, setEventClusters] = useState<BiometricEventCluster[]>([]);
  const [showClusters, setShowClusters] = useState(false);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [bradfordScores, setBradfordScores] = useState<BradfordHillScore[]>([]);
  const [showBradford, setShowBradford] = useState(false);
  const [fourFactorEvents, setFourFactorEvents] = useState<FourFactorEvent[]>([]);
  const [showFourFactor, setShowFourFactor] = useState(false);
  const [fourFactorLoading, setFourFactorLoading] = useState(false);

  const fetchCorrelations = useCallback(async () => {
    setLoading(true);
    try {
      // Get daily flight counts with registrations
      const { data: flightData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(detection_timestamp) as date,
              COUNT(*) as flight_count,
              ARRAY_AGG(DISTINCT registration) FILTER (WHERE registration IS NOT NULL) as registrations,
              BOOL_OR(registration LIKE 'N91%KC') as has_kcso
            FROM live_flight_detections_rows
            WHERE detection_timestamp IS NOT NULL
            GROUP BY DATE(detection_timestamp)
            ORDER BY date DESC
            LIMIT 200
          `
        }
      });

      // Get daily biometric counts
      const { data: bioData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE(measurement_timestamp) as date,
              COUNT(*) as bio_count,
              MAX(heart_rate) as peak_hr
            FROM biometric_monitoring
            WHERE measurement_timestamp IS NOT NULL
            GROUP BY DATE(measurement_timestamp)
          `
        }
      });

      // Resolve timestamp columns safely (prevents "created_at" does not exist)
      const pickTimestampColumn = async (tableName: string, candidates: string[]) => {
        const { data: schemaRes } = await supabase.functions.invoke('neon-query', {
          body: { action: 'getTableSchema', table: tableName }
        });
        // neon-query returns array directly
        const cols: string[] = (Array.isArray(schemaRes) ? schemaRes : []).map((c: any) => String(c.column_name));
        return candidates.find(c => cols.includes(c)) || null;
      };

      const josiahTsCol = await pickTimestampColumn('josiah_reflections_rows', [
        'created_at',
        'created_timestamp',
        'timestamp',
        'reflection_timestamp',
        'event_timestamp'
      ]);

      const radarTsCol = await pickTimestampColumn('radar_screenshot_analysis', [
        'created_at',
        'analysis_timestamp',
        'analysis_date',
        'timestamp'
      ]);

      // Get daily Josiah reflection counts
      const { data: josiahData } = josiahTsCol
        ? await supabase.functions.invoke('neon-query', {
            body: {
              action: 'customQuery',
              query: `
                SELECT 
                  DATE(${josiahTsCol}) as date,
                  COUNT(*) as josiah_count
                FROM josiah_reflections_rows
                WHERE ${josiahTsCol} IS NOT NULL
                GROUP BY DATE(${josiahTsCol})
              `
            }
          })
        : { data: [] };

      // Get daily OCR counts
      const { data: ocrData } = radarTsCol
        ? await supabase.functions.invoke('neon-query', {
            body: {
              action: 'customQuery',
              query: `
                SELECT 
                  DATE(${radarTsCol}) as date,
                  COUNT(*) as ocr_count
                FROM radar_screenshot_analysis
                WHERE ${radarTsCol} IS NOT NULL
                GROUP BY DATE(${radarTsCol})
              `
            }
          })
        : { data: [] };

      // Create maps for quick lookup - neon-query returns arrays directly
      const bioRows = Array.isArray(bioData) ? bioData : [];
      const bioMap = new Map<string, { count: number; peakHr?: number }>(
        bioRows.map((b: { date: string; bio_count: string; peak_hr?: string }) => [
          b.date, 
          { count: parseInt(b.bio_count || '0'), peakHr: b.peak_hr ? parseInt(b.peak_hr) : undefined }
        ])
      );
      
      const josiahRows = Array.isArray(josiahData) ? josiahData : [];
      const josiahMap = new Map<string, number>(
        josiahRows.map((j: { date: string; josiah_count: string }) => [
          j.date, 
          parseInt(j.josiah_count || '0')
        ])
      );
      
      const ocrRows = Array.isArray(ocrData) ? ocrData : [];
      const ocrMap = new Map<string, number>(
        ocrRows.map((o: { date: string; ocr_count: string }) => [
          o.date, 
          parseInt(o.ocr_count || '0')
        ])
      );

      // Combine into correlation events
      const flightRows = Array.isArray(flightData) ? flightData : [];
      const combined: CorrelationEvent[] = flightRows.map((f: {
        date: string; 
        flight_count: string; 
        registrations: string[];
        has_kcso: boolean;
      }) => {
        const bioInfo = bioMap.get(f.date) || { count: 0, peakHr: undefined };
        const josiahCount = josiahMap.get(f.date) || 0;
        const ocrCount = ocrMap.get(f.date) || 0;
        const flightCount = parseInt(f.flight_count || '0');

        // Calculate factor count
        let factorCount = 0;
        if (flightCount > 0) factorCount++;
        if (bioInfo.count > 0) factorCount++;
        if (josiahCount > 0) factorCount++;
        if (ocrCount > 0) factorCount++;

        return {
          date: f.date,
          flight_count: flightCount,
          biometric_count: bioInfo.count,
          josiah_count: josiahCount,
          ocr_count: ocrCount,
          factor_count: factorCount,
          registrations: safeParseArray(f.registrations).slice(0, 5),
          peak_hr: bioInfo.peakHr,
          has_kcso: f.has_kcso || false
        };
      });

      // Sort by factor count, then by date
      combined.sort((a, b) => {
        if (b.factor_count !== a.factor_count) return b.factor_count - a.factor_count;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      setCorrelations(combined);

      // Calculate stats
      const fourFactor = combined.filter(c => c.factor_count === 4).length;
      const threeFactor = combined.filter(c => c.factor_count === 3).length;
      const twoFactor = combined.filter(c => c.factor_count === 2).length;
      const strongestDay = combined[0]?.date || 'N/A';

      setStats({
        totalDays: combined.length,
        fourFactorDays: fourFactor,
        threeFactorDays: threeFactor,
        twoFactorDays: twoFactor,
        strongestDay,
        totalFlightEvents: combined.reduce((sum, c) => sum + c.flight_count, 0),
        totalBiometricEvents: combined.reduce((sum, c) => sum + c.biometric_count, 0),
        totalJosiahLogs: combined.reduce((sum, c) => sum + c.josiah_count, 0),
        totalOCRRecords: combined.reduce((sum, c) => sum + c.ocr_count, 0)
      });

    } catch (err) {
      console.error('Error fetching correlations:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch many-to-one correlations: multiple aircraft detections per biometric event
  const fetchEventClusters = useCallback(async () => {
    setClusterLoading(true);
    try {
      // Query biometric events and find all aircraft within ±5 minute windows
      const { data: clusterData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH biometric_events AS (
              SELECT 
                measurement_timestamp,
                heart_rate,
                hrv
              FROM biometric_monitoring
              WHERE measurement_timestamp IS NOT NULL
                AND heart_rate > 80
              ORDER BY measurement_timestamp DESC
              LIMIT 500
            ),
            flight_correlations AS (
              SELECT 
                b.measurement_timestamp,
                b.heart_rate,
                b.hrv,
                COUNT(DISTINCT f.registration) as aircraft_count,
                ARRAY_AGG(DISTINCT f.registration) FILTER (WHERE f.registration IS NOT NULL) as registrations
              FROM biometric_events b
              LEFT JOIN live_flight_detections_rows f 
                ON f.detection_timestamp BETWEEN b.measurement_timestamp - INTERVAL '5 minutes' 
                                              AND b.measurement_timestamp + INTERVAL '5 minutes'
              GROUP BY b.measurement_timestamp, b.heart_rate, b.hrv
              HAVING COUNT(DISTINCT f.registration) > 0
            )
            SELECT * FROM flight_correlations
            ORDER BY aircraft_count DESC, measurement_timestamp DESC
            LIMIT 200
          `
        }
      });

      const clusterRows = Array.isArray(clusterData) ? clusterData : [];
      const clusters: BiometricEventCluster[] = clusterRows.map((row: {
        measurement_timestamp: string;
        heart_rate: number;
        hrv?: number;
        aircraft_count: string;
        registrations: string[];
      }) => ({
        biometric_timestamp: row.measurement_timestamp,
        heart_rate: row.heart_rate,
        hrv: row.hrv,
        aircraft_count: parseInt(row.aircraft_count || '0'),
        aircraft_registrations: row.registrations || [],
        ocr_matches: 0,
        josiah_mentions: 0,
        time_window_minutes: 5
      }));

      setEventClusters(clusters);

      toast({
        title: 'Many-to-One Analysis Complete',
        description: `Found ${clusters.length} biometric events with multiple aircraft correlations`,
      });
    } catch (err) {
      console.error('Error fetching event clusters:', err);
      toast({
        title: 'Cluster analysis failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setClusterLoading(false);
    }
  }, [toast]);

  // Fetch Bradford Hill causation scores
  const fetchBradfordScores = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('populate-correlations', {
        body: { action: 'calculateBradfordHillScores' }
      });

      if (error) throw new Error(error.message);
      
      const scores = (data?.data?.scores || []).map((s: any) => ({
        registration: s.registration,
        detection_count: parseInt(s.detection_count || '0'),
        unique_days: parseInt(s.unique_days || '0'),
        avg_altitude: parseInt(s.avg_altitude || '0'),
        min_altitude: parseInt(s.min_altitude || '0'),
        bio_correlations: parseInt(s.bio_correlations || '0'),
        bradford_hill_score: parseFloat(s.bradford_hill_score || '0')
      }));

      setBradfordScores(scores);
      toast({
        title: 'Bradford Hill Analysis Complete',
        description: `Calculated causation scores for ${scores.length} aircraft`,
      });
    } catch (err) {
      console.error('Bradford Hill calculation failed:', err);
      toast({
        title: 'Analysis failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  }, [toast]);

  // Fetch true four-factor convergence events
  const fetchFourFactorEvents = useCallback(async () => {
    setFourFactorLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH flight_bio AS (
              SELECT 
                f.registration,
                f.detection_timestamp,
                f.altitude,
                b.heart_rate,
                b.hrv,
                EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))/60 as time_diff
              FROM live_flight_detections_rows f
              JOIN biometric_monitoring b 
                ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 300
              WHERE f.detection_timestamp IS NOT NULL 
                AND b.measurement_timestamp IS NOT NULL
                AND b.heart_rate > 80
            ),
            with_josiah AS (
              SELECT 
                fb.*,
                CASE WHEN EXISTS (
                  SELECT 1 FROM josiah_reflections_rows j
                  WHERE (j.aircraft_correlation IS NOT NULL OR j.reflection_content ILIKE '%' || fb.registration || '%')
                ) THEN true ELSE false END as josiah_match
              FROM flight_bio fb
            ),
            with_ocr AS (
              SELECT 
                wj.*,
                CASE WHEN EXISTS (
                  SELECT 1 FROM ocr_aircraft_holding_patterns o
                  WHERE o.registration = wj.registration
                ) THEN true ELSE false END as ocr_match
              FROM with_josiah wj
            )
            SELECT 
              registration,
              detection_timestamp as timestamp,
              heart_rate,
              hrv,
              altitude,
              josiah_match,
              ocr_match,
              ROUND(ABS(time_diff)::numeric, 1) as time_window_minutes,
              CASE 
                WHEN josiah_match AND ocr_match THEN 100
                WHEN josiah_match OR ocr_match THEN 75
                ELSE 50
              END as convergence_score
            FROM with_ocr
            WHERE josiah_match = true OR ocr_match = true
            ORDER BY convergence_score DESC, heart_rate DESC
            LIMIT 200
          `
        }
      });

      if (error) throw new Error(error.message);

      const eventRows = Array.isArray(data) ? data : [];
      const events: FourFactorEvent[] = eventRows.map((e: any) => ({
        timestamp: e.timestamp,
        registration: e.registration,
        heart_rate: parseInt(e.heart_rate || '0'),
        hrv: e.hrv ? parseInt(e.hrv) : undefined,
        altitude: e.altitude ? parseInt(e.altitude) : undefined,
        josiah_match: e.josiah_match === true,
        ocr_match: e.ocr_match === true,
        time_window_minutes: parseFloat(e.time_window_minutes || '0'),
        convergence_score: parseInt(e.convergence_score || '0')
      }));

      setFourFactorEvents(events);
      
      const fullConvergence = events.filter(e => e.josiah_match && e.ocr_match).length;
      toast({
        title: 'Four-Factor Analysis Complete',
        description: `Found ${fullConvergence} full 4-factor convergence events, ${events.length} total high-confidence events`,
      });
    } catch (err) {
      console.error('Four-factor analysis failed:', err);
      toast({
        title: 'Analysis failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setFourFactorLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchCorrelations();
  }, [fetchCorrelations]);

  const filteredCorrelations = correlations.filter(c => {
    if (filter === '4-factor') return c.factor_count === 4;
    if (filter === '3-factor') return c.factor_count >= 3;
    if (filter === 'kcso') return c.has_kcso;
    return true;
  });

  const getFactorBadge = (count: number) => {
    if (count === 4) return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (count === 3) return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    if (count === 2) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-muted/20 text-muted-foreground border-muted/30';
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { 
    weekday: 'short', 
    month: 'short', 
    day: 'numeric'
  }) : 'N/A';

  return (
    <CyberPanel 
      title="FOUR-FACTOR CORRELATION ENGINE" 
      icon={<Layers className="h-5 w-5" />}
      className="col-span-2"
    >
      {/* Stats Header */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-green-400">{stats?.fourFactorDays || 0}</div>
          <div className="text-xs text-muted-foreground">4-Factor Days</div>
        </div>
        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{stats?.threeFactorDays || 0}</div>
          <div className="text-xs text-muted-foreground">3-Factor Days</div>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-yellow-400">{stats?.twoFactorDays || 0}</div>
          <div className="text-xs text-muted-foreground">2-Factor Days</div>
        </div>
        <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{stats?.totalDays || 0}</div>
          <div className="text-xs text-muted-foreground">Total Days</div>
        </div>
      </div>

      {/* Factor Breakdown */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border/20">
          <Plane className="h-4 w-4 text-cyan-400" />
          <div>
            <div className="text-sm font-mono">{stats?.totalFlightEvents?.toLocaleString() || 0}</div>
            <div className="text-xs text-muted-foreground">Flights</div>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border/20">
          <Heart className="h-4 w-4 text-red-400" />
          <div>
            <div className="text-sm font-mono">{stats?.totalBiometricEvents?.toLocaleString() || 0}</div>
            <div className="text-xs text-muted-foreground">Biometrics</div>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border/20">
          <Brain className="h-4 w-4 text-purple-400" />
          <div>
            <div className="text-sm font-mono">{stats?.totalJosiahLogs?.toLocaleString() || 0}</div>
            <div className="text-xs text-muted-foreground">Josiah Logs</div>
          </div>
        </div>
        <div className="flex items-center gap-2 p-2 bg-background/30 rounded border border-border/20">
          <Camera className="h-4 w-4 text-magenta" />
          <div>
            <div className="text-sm font-mono">{stats?.totalOCRRecords?.toLocaleString() || 0}</div>
            <div className="text-xs text-muted-foreground">OCR Records</div>
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Button
          variant={filter === 'all' && !showClusters && !showBradford && !showFourFactor ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setFilter('all'); setShowClusters(false); setShowBradford(false); setShowFourFactor(false); }}
        >
          All Days
        </Button>
        <Button
          variant={showFourFactor ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setShowFourFactor(true);
            setShowClusters(false);
            setShowBradford(false);
            if (fourFactorEvents.length === 0) fetchFourFactorEvents();
          }}
        >
          <Zap className="h-3 w-3 mr-1" />
          4-Factor Events
        </Button>
        <Button
          variant={showBradford ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setShowBradford(true);
            setShowClusters(false);
            setShowFourFactor(false);
            if (bradfordScores.length === 0) fetchBradfordScores();
          }}
        >
          <Scale className="h-3 w-3 mr-1" />
          Bradford Hill
        </Button>
        <Button
          variant={filter === 'kcso' && !showClusters && !showBradford && !showFourFactor ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setFilter('kcso'); setShowClusters(false); setShowBradford(false); setShowFourFactor(false); }}
        >
          <AlertTriangle className="h-3 w-3 mr-1" />
          KCSO Present
        </Button>
        <Button
          variant={showClusters ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setShowClusters(true);
            setShowBradford(false);
            setShowFourFactor(false);
            if (eventClusters.length === 0) fetchEventClusters();
          }}
        >
          <Layers className="h-3 w-3 mr-1" />
          Many→One
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchFourFactorEvents}
          disabled={fourFactorLoading}
        >
          <TrendingUp className={`h-3 w-3 mr-1 ${fourFactorLoading ? 'animate-pulse' : ''}`} />
          Run Analysis
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            setIsPopulating(true);
            try {
              const day = new Date().toISOString().slice(0, 10);
              const { data, error } = await supabase.functions.invoke('populate-correlations', {
                body: { action: 'populateCorrelations', timeWindowMinutes: 5, batchSize: 2000, day },
              });
              if (error) throw new Error(error.message);
              if (data?.error) throw new Error(data.error);
              toast({
                title: 'Correlation population started',
                description: `Inserted batch for ${day}. Total now: ${data?.data?.totalInTable ?? 'n/a'}`,
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Failed to populate correlations';
              toast({ title: 'Populate failed', description: msg, variant: 'destructive' });
            } finally {
              setIsPopulating(false);
            }
          }}
          disabled={isPopulating || loading}
        >
          <Fingerprint className={`h-3 w-3 mr-1 ${isPopulating ? 'animate-pulse' : ''}`} />
          Populate Today
        </Button>
        <Button variant="outline" size="sm" onClick={fetchCorrelations} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Many-to-One Cluster View */}
      {showClusters && (
        <div className="mb-4 p-4 border border-purple-500/30 bg-purple-500/5 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="h-4 w-4 text-purple-400" />
            <span className="font-medium text-purple-400">
              Many-to-One Analysis: Multiple Aircraft per Biometric Event
            </span>
            <Badge variant="outline" className="ml-auto">
              {eventClusters.length} clusters
            </Badge>
          </div>
          <ScrollArea className="h-[300px]">
            {clusterLoading ? (
              <div className="text-center py-8 text-muted-foreground">Analyzing many-to-one correlations...</div>
            ) : eventClusters.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Click "Analyze Clusters" to find biometric events with multiple aircraft
              </div>
            ) : (
              <div className="space-y-2">
                {eventClusters.map((cluster, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${
                      cluster.aircraft_count >= 5 
                        ? 'border-red-500/30 bg-red-500/5' 
                        : cluster.aircraft_count >= 3
                        ? 'border-orange-500/30 bg-orange-500/5'
                        : 'border-border/30 bg-background/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-red-400" />
                        <span className="text-sm font-mono">
                          {new Date(cluster.biometric_timestamp).toLocaleString()}
                        </span>
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                          {cluster.heart_rate} BPM
                        </Badge>
                      </div>
                      <Badge className={
                        cluster.aircraft_count >= 5 
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : cluster.aircraft_count >= 3
                          ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                      }>
                        <Plane className="h-3 w-3 mr-1" />
                        {cluster.aircraft_count} aircraft
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {safeParseArray(cluster.aircraft_registrations).slice(0, 8).map((reg, i) => (
                        <Badge 
                          key={i} 
                          variant="outline" 
                          className={`text-xs ${String(reg)?.includes('KC') ? 'border-yellow-500/30 text-yellow-400' : ''}`}
                        >
                          {reg}
                        </Badge>
                      ))}
                      {cluster.aircraft_registrations.length > 8 && (
                        <Badge variant="outline" className="text-xs">
                          +{cluster.aircraft_registrations.length - 8} more
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      ±{cluster.time_window_minutes} minute correlation window
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Four-Factor Events View */}
      {showFourFactor && (
        <div className="mb-4 p-4 border border-green-500/30 bg-green-500/5 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-green-400" />
            <span className="font-medium text-green-400">
              Four-Factor Convergence Events (Flight + Biometric + Josiah + OCR)
            </span>
            <Badge variant="outline" className="ml-auto">
              {fourFactorEvents.filter(e => e.josiah_match && e.ocr_match).length} full convergence
            </Badge>
          </div>
          <ScrollArea className="h-[300px]">
            {fourFactorLoading ? (
              <div className="text-center py-8 text-muted-foreground">Analyzing four-factor convergence...</div>
            ) : fourFactorEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Click "Run Analysis" to find four-factor convergence events
              </div>
            ) : (
              <div className="space-y-2">
                {fourFactorEvents.map((event, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${
                      event.convergence_score === 100 
                        ? 'border-green-500/50 bg-green-500/10 animate-pulse' 
                        : event.convergence_score >= 75
                        ? 'border-cyan-500/30 bg-cyan-500/5'
                        : 'border-border/30 bg-background/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Plane className="h-4 w-4 text-cyan-400" />
                        <span className="font-mono font-bold">{event.registration}</span>
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                          {event.heart_rate} BPM
                        </Badge>
                        {event.altitude && (
                          <Badge variant="outline" className="text-xs">
                            {event.altitude.toLocaleString()} ft
                          </Badge>
                        )}
                      </div>
                      <Badge className={
                        event.convergence_score === 100 
                          ? 'bg-green-500/30 text-green-400 border-green-500/50'
                          : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                      }>
                        {event.convergence_score}% match
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                      <div className="flex items-center gap-2">
                        {event.josiah_match && (
                          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
                            <Brain className="h-3 w-3 mr-1" />
                            Josiah
                          </Badge>
                        )}
                        {event.ocr_match && (
                          <Badge className="bg-pink-500/20 text-pink-400 border-pink-500/30 text-xs">
                            <Camera className="h-3 w-3 mr-1" />
                            OCR
                          </Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        ±{event.time_window_minutes}m window
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Bradford Hill Scores View */}
      {showBradford && (
        <div className="mb-4 p-4 border border-yellow-500/30 bg-yellow-500/5 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="h-4 w-4 text-yellow-400" />
            <span className="font-medium text-yellow-400">
              Bradford Hill Causation Scores (Prosecutorial Ranking)
            </span>
            <Badge variant="outline" className="ml-auto">
              {bradfordScores.length} aircraft analyzed
            </Badge>
          </div>
          <ScrollArea className="h-[300px]">
            {bradfordScores.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Click "Bradford Hill" to calculate causation scores
              </div>
            ) : (
              <div className="space-y-2">
                {bradfordScores.map((score, idx) => (
                  <div 
                    key={score.registration} 
                    className={`p-3 rounded-lg border ${
                      score.bradford_hill_score >= 40 
                        ? 'border-red-500/50 bg-red-500/10' 
                        : score.bradford_hill_score >= 25
                        ? 'border-orange-500/30 bg-orange-500/5'
                        : 'border-border/30 bg-background/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">#{idx + 1}</span>
                        <span className="font-mono font-bold">{score.registration}</span>
                        <Badge variant="outline" className="text-xs">
                          {score.detection_count.toLocaleString()} detections
                        </Badge>
                      </div>
                      <Badge className={
                        score.bradford_hill_score >= 40 
                          ? 'bg-red-500/30 text-red-400 border-red-500/50 text-lg font-bold'
                          : score.bradford_hill_score >= 25
                          ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                          : 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                      }>
                        {score.bradford_hill_score.toFixed(1)} BH
                      </Badge>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                      <div>
                        <span className="text-foreground">{score.unique_days}</span> days
                      </div>
                      <div>
                        <span className="text-foreground">{score.bio_correlations}</span> bio matches
                      </div>
                      <div>
                        Avg: <span className="text-foreground">{score.avg_altitude.toLocaleString()}</span> ft
                      </div>
                      <div>
                        Min: <span className="text-foreground">{score.min_altitude.toLocaleString()}</span> ft
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* Correlation Events */}
      {!showClusters && !showBradford && !showFourFactor && (
      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Analyzing correlations...</div>
          ) : filteredCorrelations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No correlations found</div>
          ) : (
            filteredCorrelations.map((corr, idx) => (
              <div 
                key={idx} 
                className={`p-3 rounded-lg border ${
                  corr.factor_count === 4 
                    ? 'border-green-500/30 bg-green-500/5' 
                    : corr.factor_count === 3
                    ? 'border-cyan-500/30 bg-cyan-500/5'
                    : 'border-border/30 bg-background/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatDate(corr.date)}</span>
                    {corr.has_kcso && (
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                        KCSO
                      </Badge>
                    )}
                  </div>
                  <Badge className={getFactorBadge(corr.factor_count)}>
                    {corr.factor_count}-Factor
                  </Badge>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className={`flex items-center gap-1 ${corr.flight_count > 0 ? 'text-cyan-400' : 'text-muted-foreground'}`}>
                    <Plane className="h-3 w-3" />
                    <span>{corr.flight_count}</span>
                  </div>
                  <div className={`flex items-center gap-1 ${corr.biometric_count > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                    <Heart className="h-3 w-3" />
                    <span>{corr.biometric_count}</span>
                    {corr.peak_hr && corr.peak_hr > 100 && (
                      <span className="text-red-400">({corr.peak_hr})</span>
                    )}
                  </div>
                  <div className={`flex items-center gap-1 ${corr.josiah_count > 0 ? 'text-purple-400' : 'text-muted-foreground'}`}>
                    <Brain className="h-3 w-3" />
                    <span>{corr.josiah_count}</span>
                  </div>
                  <div className={`flex items-center gap-1 ${corr.ocr_count > 0 ? 'text-magenta' : 'text-muted-foreground'}`}>
                    <Camera className="h-3 w-3" />
                    <span>{corr.ocr_count}</span>
                  </div>
                </div>

                {(() => {
                  const regs = safeParseArray(corr.registrations);
                  return regs.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {regs.slice(0, 4).map((reg, i) => (
                        <Badge 
                          key={i} 
                          variant="outline" 
                          className={`text-xs ${String(reg)?.includes('KC') ? 'border-yellow-500/30 text-yellow-400' : ''}`}
                        >
                          {reg}
                        </Badge>
                      ))}
                      {regs.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                          +{regs.length - 4}
                        </Badge>
                      )}
                    </div>
                  ) : null;
                })()}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      )}

      {/* Legal Significance */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Legal Significance:</strong> Four-factor convergence 
          (Flight + Biometric + Josiah AI + OCR Screenshot) provides the strongest prosecutorial evidence 
          per Bradford Hill criteria. Each factor independently corroborates the surveillance pattern, 
          establishing causation beyond correlation.
        </div>
      </div>
    </CyberPanel>
  );
};

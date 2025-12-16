import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Layers, 
  RefreshCw, 
  Plane, 
  Heart, 
  Brain, 
  Camera,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Fingerprint
} from 'lucide-react';

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

export const FourFactorCorrelationEngine = () => {
  const [correlations, setCorrelations] = useState<CorrelationEvent[]>([]);
  const [stats, setStats] = useState<CorrelationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | '4-factor' | '3-factor' | 'kcso'>('all');

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
        const cols: string[] = (schemaRes?.data || []).map((c: any) => String(c.column_name));
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
        : { data: { data: [] } };

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
        : { data: { data: [] } };

      // Create maps for quick lookup
      const bioMap = new Map<string, { count: number; peakHr?: number }>(
        (bioData?.data || []).map((b: { date: string; bio_count: string; peak_hr?: string }) => [
          b.date, 
          { count: parseInt(b.bio_count || '0'), peakHr: b.peak_hr ? parseInt(b.peak_hr) : undefined }
        ])
      );
      
      const josiahMap = new Map<string, number>(
        (josiahData?.data || []).map((j: { date: string; josiah_count: string }) => [
          j.date, 
          parseInt(j.josiah_count || '0')
        ])
      );
      
      const ocrMap = new Map<string, number>(
        (ocrData?.data || []).map((o: { date: string; ocr_count: string }) => [
          o.date, 
          parseInt(o.ocr_count || '0')
        ])
      );

      // Combine into correlation events
      const combined: CorrelationEvent[] = (flightData?.data || []).map((f: { 
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
          registrations: (f.registrations || []).slice(0, 5),
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
      <div className="flex gap-2 mb-4">
        <Button 
          variant={filter === 'all' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('all')}
        >
          All Days
        </Button>
        <Button 
          variant={filter === '4-factor' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('4-factor')}
        >
          <Fingerprint className="h-3 w-3 mr-1" />
          4-Factor Only
        </Button>
        <Button 
          variant={filter === '3-factor' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('3-factor')}
        >
          <CheckCircle2 className="h-3 w-3 mr-1" />
          3+ Factors
        </Button>
        <Button 
          variant={filter === 'kcso' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setFilter('kcso')}
        >
          <AlertTriangle className="h-3 w-3 mr-1" />
          KCSO Present
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={fetchCorrelations} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Correlation Events */}
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

                {corr.registrations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {corr.registrations.slice(0, 4).map(reg => (
                      <Badge 
                        key={reg} 
                        variant="outline" 
                        className={`text-xs ${reg?.includes('KC') ? 'border-yellow-500/30 text-yellow-400' : ''}`}
                      >
                        {reg}
                      </Badge>
                    ))}
                    {corr.registrations.length > 4 && (
                      <Badge variant="outline" className="text-xs">
                        +{corr.registrations.length - 4}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

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

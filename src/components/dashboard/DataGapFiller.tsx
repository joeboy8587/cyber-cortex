import { useState, useCallback, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  FileSearch,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Camera,
  Database,
  Zap,
  ArrowRight,
  Layers,
  FileImage,
  Link2
} from 'lucide-react';

interface DataGap {
  date: string;
  gap_type: 'FLIGHT_ONLY' | 'BIO_ONLY' | 'TOTAL_GAP' | 'PARTIAL';
  flight_count: number;
  bio_count: number;
  ocr_available: number;
  notion_available: number;
  can_backfill: boolean;
  backfill_sources: string[];
}

interface BackfillResult {
  date: string;
  source: string;
  records_recovered: number;
  status: 'success' | 'partial' | 'failed';
  details: string;
}

interface GapStats {
  totalGapDays: number;
  flightGaps: number;
  bioGaps: number;
  backfillableDays: number;
  ocrCoverage: number;
  notionCoverage: number;
  totalRecoverable: number;
}

export const DataGapFiller = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [gaps, setGaps] = useState<DataGap[]>([]);
  const [backfillResults, setBackfillResults] = useState<BackfillResult[]>([]);
  const [stats, setStats] = useState<GapStats | null>(null);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(0);

  // Analyze gaps in data coverage
  const analyzeGaps = useCallback(async () => {
    setLoading(true);
    try {
      // Get date range of all data
      const { data: dateRange } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              MIN(LEAST(
                (SELECT MIN(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL),
                (SELECT MIN(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL)
              )) as start_date,
              MAX(GREATEST(
                (SELECT MAX(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL),
                (SELECT MAX(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL)
              )) as end_date
          `
        }
      });

      const rangeRows = Array.isArray(dateRange) ? dateRange : [];
      const startDate = rangeRows[0]?.start_date;
      const endDate = rangeRows[0]?.end_date;

      if (!startDate || !endDate) {
        setLoading(false);
        return;
      }

      // Get daily coverage analysis
      const { data: coverageData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH date_series AS (
              SELECT generate_series(
                DATE('${startDate}'),
                DATE('${endDate}'),
                '1 day'::interval
              )::date as date
            ),
            daily_flights AS (
              SELECT 
                DATE(detection_timestamp) as date,
                COUNT(*) as flight_count
              FROM live_flight_detections_rows
              WHERE detection_timestamp IS NOT NULL
              GROUP BY DATE(detection_timestamp)
            ),
            daily_bio AS (
              SELECT 
                DATE(measurement_timestamp) as date,
                COUNT(*) as bio_count
              FROM biometric_monitoring
              WHERE measurement_timestamp IS NOT NULL
              GROUP BY DATE(measurement_timestamp)
            ),
            daily_ocr AS (
              SELECT 
                DATE(COALESCE(created_at, NOW())) as date,
                COUNT(*) as ocr_count
              FROM radar_screenshot_analysis
              GROUP BY DATE(COALESCE(created_at, NOW()))
            ),
            daily_ocr_holding AS (
              SELECT 
                DATE(COALESCE(created_at, NOW())) as date,
                COUNT(*) as holding_count
              FROM ocr_aircraft_holding_patterns
              GROUP BY DATE(COALESCE(created_at, NOW()))
            ),
            daily_josiah AS (
              SELECT 
                DATE(created_at) as date,
                COUNT(*) as josiah_count
              FROM josiah_reflections_rows
              WHERE created_at IS NOT NULL
              GROUP BY DATE(created_at)
            )
            SELECT 
              ds.date,
              COALESCE(f.flight_count, 0) as flight_count,
              COALESCE(b.bio_count, 0) as bio_count,
              COALESCE(o.ocr_count, 0) + COALESCE(oh.holding_count, 0) as ocr_available,
              COALESCE(j.josiah_count, 0) as notion_available
            FROM date_series ds
            LEFT JOIN daily_flights f ON ds.date = f.date
            LEFT JOIN daily_bio b ON ds.date = b.date
            LEFT JOIN daily_ocr o ON ds.date = o.date
            LEFT JOIN daily_ocr_holding oh ON ds.date = oh.date
            LEFT JOIN daily_josiah j ON ds.date = j.date
            WHERE COALESCE(f.flight_count, 0) < 20 
               OR COALESCE(b.bio_count, 0) < 5
            ORDER BY ds.date DESC
            LIMIT 120
          `
        }
      });

      const coverageRows = Array.isArray(coverageData) ? coverageData : [];
      
      const analyzedGaps: DataGap[] = coverageRows.map((row: any) => {
        const flights = parseInt(row.flight_count) || 0;
        const bio = parseInt(row.bio_count) || 0;
        const ocr = parseInt(row.ocr_available) || 0;
        const notion = parseInt(row.notion_available) || 0;

        let gapType: 'FLIGHT_ONLY' | 'BIO_ONLY' | 'TOTAL_GAP' | 'PARTIAL' = 'PARTIAL';
        if (flights === 0 && bio === 0) gapType = 'TOTAL_GAP';
        else if (flights === 0) gapType = 'FLIGHT_ONLY';
        else if (bio === 0) gapType = 'BIO_ONLY';

        const backfillSources: string[] = [];
        if (ocr > 0) backfillSources.push('OCR Screenshots');
        if (notion > 0) backfillSources.push('Josiah/Notion');

        return {
          date: row.date,
          gap_type: gapType,
          flight_count: flights,
          bio_count: bio,
          ocr_available: ocr,
          notion_available: notion,
          can_backfill: ocr > 0 || notion > 0,
          backfill_sources: backfillSources
        };
      });

      setGaps(analyzedGaps);

      // Calculate stats
      const flightGaps = analyzedGaps.filter(g => g.gap_type === 'FLIGHT_ONLY' || g.gap_type === 'TOTAL_GAP').length;
      const bioGaps = analyzedGaps.filter(g => g.gap_type === 'BIO_ONLY' || g.gap_type === 'TOTAL_GAP').length;
      const backfillable = analyzedGaps.filter(g => g.can_backfill).length;
      const ocrDays = analyzedGaps.filter(g => g.ocr_available > 0).length;
      const notionDays = analyzedGaps.filter(g => g.notion_available > 0).length;
      const recoverable = analyzedGaps.reduce((acc, g) => acc + g.ocr_available + g.notion_available, 0);

      setStats({
        totalGapDays: analyzedGaps.length,
        flightGaps,
        bioGaps,
        backfillableDays: backfillable,
        ocrCoverage: ocrDays,
        notionCoverage: notionDays,
        totalRecoverable: recoverable
      });

    } catch (err) {
      console.error('Gap analysis error:', err);
      toast({
        title: 'Analysis Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Backfill gaps using OCR and Notion data
  const runBackfill = useCallback(async () => {
    setIsBackfilling(true);
    setBackfillProgress(0);
    const results: BackfillResult[] = [];

    try {
      const backfillableGaps = gaps.filter(g => g.can_backfill && g.gap_type !== 'PARTIAL');
      const totalGaps = backfillableGaps.length;

      for (let i = 0; i < Math.min(totalGaps, 30); i++) { // Limit to 30 days per run
        const gap = backfillableGaps[i];
        setBackfillProgress(((i + 1) / Math.min(totalGaps, 30)) * 100);

        // Try OCR backfill first
        if (gap.ocr_available > 0) {
          try {
            // Query OCR data for this date and extract flight info
            const { data: ocrData } = await supabase.functions.invoke('neon-query', {
              body: {
                action: 'customQuery',
                query: `
                  SELECT 
                    registration,
                    altitude_mentioned as altitude,
                    location_mentioned as location,
                    analysis_date as timestamp
                  FROM radar_screenshot_analysis
                  WHERE DATE(COALESCE(created_at, analysis_date, NOW())) = '${gap.date}'
                    AND registration IS NOT NULL
                  UNION ALL
                  SELECT 
                    registration,
                    NULL as altitude,
                    NULL as location,
                    created_at as timestamp
                  FROM ocr_aircraft_holding_patterns
                  WHERE DATE(COALESCE(created_at, NOW())) = '${gap.date}'
                    AND registration IS NOT NULL
                  LIMIT 50
                `
              }
            });

            const ocrRows = Array.isArray(ocrData) ? ocrData : [];
            
            if (ocrRows.length > 0) {
              // Insert recovered flight data
              const { data: insertResult } = await supabase.functions.invoke('neon-query', {
                body: {
                  action: 'batchInsert',
                  table: 'live_flight_detections_rows',
                  data: ocrRows.map((row: any) => ({
                    id: `OCR-BACKFILL-${gap.date}-${row.registration}-${Math.random().toString(36).substr(2, 9)}`,
                    registration: row.registration,
                    altitude: row.altitude ? parseInt(row.altitude) : null,
                    detection_timestamp: row.timestamp || `${gap.date}T12:00:00Z`,
                    created_at: new Date().toISOString(),
                    flagged: false,
                    flagged_reasons: `Backfilled from OCR screenshot data`,
                    taxonomy_tag: 'OCR_RECOVERED'
                  }))
                }
              });

              results.push({
                date: gap.date,
                source: 'OCR Screenshots',
                records_recovered: insertResult?.inserted || ocrRows.length,
                status: 'success',
                details: `Recovered ${ocrRows.length} flight records from FlightRadar24 screenshots`
              });
            }
          } catch (ocrErr) {
            results.push({
              date: gap.date,
              source: 'OCR Screenshots',
              records_recovered: 0,
              status: 'failed',
              details: ocrErr instanceof Error ? ocrErr.message : 'OCR backfill failed'
            });
          }
        }

        // Try Notion/Josiah backfill
        if (gap.notion_available > 0) {
          try {
            // Query Josiah reflections that mention aircraft
            const { data: josiahData } = await supabase.functions.invoke('neon-query', {
              body: {
                action: 'customQuery',
                query: `
                  SELECT 
                    reflection_content,
                    created_at,
                    aircraft_correlation
                  FROM josiah_reflections_rows
                  WHERE DATE(created_at) = '${gap.date}'
                    AND (aircraft_correlation IS NOT NULL 
                         OR reflection_content ILIKE '%N9%'
                         OR reflection_content ILIKE '%aircraft%'
                         OR reflection_content ILIKE '%helicopter%')
                  LIMIT 20
                `
              }
            });

            const josiahRows = Array.isArray(josiahData) ? josiahData : [];
            
            // Extract aircraft mentions from reflections
            const aircraftMentions: string[] = [];
            for (const row of josiahRows) {
              const content = row.reflection_content || '';
              // Match N-number patterns
              const matches = content.match(/N\d{1,5}[A-Z]{0,2}/gi) || [];
              aircraftMentions.push(...matches);
              if (row.aircraft_correlation) {
                aircraftMentions.push(row.aircraft_correlation);
              }
            }

            const uniqueAircraft = [...new Set(aircraftMentions)];
            
            if (uniqueAircraft.length > 0) {
              // Insert as flight detections
              const { data: insertResult } = await supabase.functions.invoke('neon-query', {
                body: {
                  action: 'batchInsert',
                  table: 'live_flight_detections_rows',
                  data: uniqueAircraft.map((reg) => ({
                    id: `JOSIAH-BACKFILL-${gap.date}-${reg}-${Math.random().toString(36).substr(2, 9)}`,
                    registration: reg.toUpperCase(),
                    detection_timestamp: `${gap.date}T12:00:00Z`,
                    created_at: new Date().toISOString(),
                    flagged: false,
                    flagged_reasons: `Backfilled from Josiah AI reflection`,
                    taxonomy_tag: 'JOSIAH_RECOVERED'
                  }))
                }
              });

              results.push({
                date: gap.date,
                source: 'Josiah/Notion',
                records_recovered: insertResult?.inserted || uniqueAircraft.length,
                status: 'success',
                details: `Extracted ${uniqueAircraft.length} aircraft mentions from Josiah reflections`
              });
            }
          } catch (josiahErr) {
            results.push({
              date: gap.date,
              source: 'Josiah/Notion',
              records_recovered: 0,
              status: 'failed',
              details: josiahErr instanceof Error ? josiahErr.message : 'Josiah backfill failed'
            });
          }
        }
      }

      setBackfillResults(results);

      const successCount = results.filter(r => r.status === 'success').length;
      const totalRecovered = results.reduce((acc, r) => acc + r.records_recovered, 0);

      toast({
        title: 'Backfill Complete',
        description: `Recovered ${totalRecovered} records across ${successCount} days`,
      });

      // Refresh gap analysis
      await analyzeGaps();

    } catch (err) {
      console.error('Backfill error:', err);
      toast({
        title: 'Backfill Failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsBackfilling(false);
      setBackfillProgress(0);
    }
  }, [gaps, toast, analyzeGaps]);

  useEffect(() => {
    analyzeGaps();
  }, [analyzeGaps]);

  const getGapBadgeStyle = (type: string) => {
    switch (type) {
      case 'TOTAL_GAP': return 'bg-red-500 text-white';
      case 'FLIGHT_ONLY': return 'bg-orange-500 text-white';
      case 'BIO_ONLY': return 'bg-yellow-500 text-black';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <CyberPanel
      title="DATA GAP FILLER"
      icon={<FileSearch className="w-4 h-4 text-cyan-400" />}
      className="col-span-2"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
            {gaps.length} Gap Days
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={analyzeGaps}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-6 gap-2">
            <div className="p-2 bg-red-500/10 rounded-lg border border-red-500/30 text-center">
              <AlertTriangle className="w-4 h-4 mx-auto text-red-400 mb-1" />
              <p className="text-xl font-bold text-red-400">{stats.totalGapDays}</p>
              <p className="text-[10px] text-muted-foreground">Gap Days</p>
            </div>
            <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/30 text-center">
              <Calendar className="w-4 h-4 mx-auto text-orange-400 mb-1" />
              <p className="text-xl font-bold text-orange-400">{stats.flightGaps}</p>
              <p className="text-[10px] text-muted-foreground">Flight Gaps</p>
            </div>
            <div className="p-2 bg-yellow-500/10 rounded-lg border border-yellow-500/30 text-center">
              <Database className="w-4 h-4 mx-auto text-yellow-400 mb-1" />
              <p className="text-xl font-bold text-yellow-400">{stats.bioGaps}</p>
              <p className="text-[10px] text-muted-foreground">Bio Gaps</p>
            </div>
            <div className="p-2 bg-cyan-500/10 rounded-lg border border-cyan-500/30 text-center">
              <Camera className="w-4 h-4 mx-auto text-cyan-400 mb-1" />
              <p className="text-xl font-bold text-cyan-400">{stats.ocrCoverage}</p>
              <p className="text-[10px] text-muted-foreground">OCR Days</p>
            </div>
            <div className="p-2 bg-green-500/10 rounded-lg border border-green-500/30 text-center">
              <CheckCircle2 className="w-4 h-4 mx-auto text-green-400 mb-1" />
              <p className="text-xl font-bold text-green-400">{stats.backfillableDays}</p>
              <p className="text-[10px] text-muted-foreground">Backfillable</p>
            </div>
            <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/30 text-center">
              <Layers className="w-4 h-4 mx-auto text-purple-400 mb-1" />
              <p className="text-xl font-bold text-purple-400">{stats.totalRecoverable}</p>
              <p className="text-[10px] text-muted-foreground">Recoverable</p>
            </div>
          </div>
        )}

        {/* Backfill Button */}
        <div className="space-y-2">
          <Button 
            onClick={runBackfill}
            disabled={isBackfilling || gaps.filter(g => g.can_backfill).length === 0}
            className="w-full bg-cyan-600 hover:bg-cyan-700"
          >
            {isBackfilling ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Backfilling Data Gaps...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Run OCR + Notion Backfill ({gaps.filter(g => g.can_backfill).length} days)
              </>
            )}
          </Button>
          
          {isBackfilling && (
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Backfill Progress</span>
                <span>{backfillProgress.toFixed(0)}%</span>
              </div>
              <Progress value={backfillProgress} className="h-2" />
            </div>
          )}
        </div>

        {/* Backfill Results */}
        {backfillResults.length > 0 && (
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Recent Backfill Results
            </h4>
            <div className="space-y-1 max-h-[100px] overflow-y-auto">
              {backfillResults.slice(0, 5).map((result, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    {result.status === 'success' ? (
                      <CheckCircle2 className="w-3 h-3 text-green-400" />
                    ) : (
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                    )}
                    <span className="font-mono">{result.date}</span>
                    <Badge variant="outline" className="text-[10px]">{result.source}</Badge>
                  </span>
                  <span className="text-green-400">+{result.records_recovered}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Gap List */}
        <ScrollArea className="h-[300px]">
          <div className="space-y-2 pr-4">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
                <p>Analyzing data coverage...</p>
              </div>
            ) : gaps.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-400" />
                <p>No significant data gaps detected!</p>
              </div>
            ) : (
              gaps.map((gap) => (
                <div
                  key={gap.date}
                  className={`p-3 rounded-lg border ${
                    gap.can_backfill 
                      ? 'border-cyan-500/30 bg-cyan-500/5' 
                      : 'border-red-500/30 bg-red-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono font-bold">
                        {new Date(gap.date).toLocaleDateString()}
                      </span>
                      <Badge className={getGapBadgeStyle(gap.gap_type)}>
                        {gap.gap_type.replace('_', ' ')}
                      </Badge>
                    </div>
                    {gap.can_backfill && (
                      <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
                        <Link2 className="w-3 h-3 mr-1" />
                        Backfillable
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                    <div className={`text-center p-1 rounded ${gap.flight_count === 0 ? 'bg-red-500/20' : 'bg-blue-500/10'}`}>
                      <span className="font-bold">{gap.flight_count}</span>
                      <span className="text-muted-foreground block text-[10px]">Flights</span>
                    </div>
                    <div className={`text-center p-1 rounded ${gap.bio_count === 0 ? 'bg-red-500/20' : 'bg-green-500/10'}`}>
                      <span className="font-bold">{gap.bio_count}</span>
                      <span className="text-muted-foreground block text-[10px]">Bio</span>
                    </div>
                    <div className={`text-center p-1 rounded ${gap.ocr_available > 0 ? 'bg-cyan-500/20' : 'bg-muted/20'}`}>
                      <FileImage className="w-3 h-3 mx-auto text-cyan-400" />
                      <span className="font-bold">{gap.ocr_available}</span>
                      <span className="text-muted-foreground block text-[10px]">OCR</span>
                    </div>
                    <div className={`text-center p-1 rounded ${gap.notion_available > 0 ? 'bg-purple-500/20' : 'bg-muted/20'}`}>
                      <span className="font-bold">{gap.notion_available}</span>
                      <span className="text-muted-foreground block text-[10px]">Notion</span>
                    </div>
                  </div>

                  {gap.backfill_sources.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-cyan-400">
                      <ArrowRight className="w-3 h-3" />
                      Can recover from: {gap.backfill_sources.join(', ')}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Info Note */}
        <div className="border-t border-border/30 pt-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Data Recovery:</strong> The system identifies gaps 
          in ADSB flight detection data and attempts to recover records using OCR-extracted 
          FlightRadar24 screenshots and Josiah AI reflections that mention aircraft. 
          Recovered records are tagged with their source for forensic traceability.
        </div>
      </div>
    </CyberPanel>
  );
};

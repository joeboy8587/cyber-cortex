import { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Camera, RefreshCw, Eye, Target, AlertTriangle, Repeat, Image } from 'lucide-react';

interface HoldingPattern {
  registration: string;
  loop_count: number;
  first_seen?: string;
  last_seen?: string;
  avg_altitude?: number;
}

interface ScreenshotOCR {
  id: string;
  registration?: string;
  altitude?: number;
  timestamp?: string;
  extracted_text?: string;
  confidence?: number;
}

interface RadarAnalysis {
  id: string;
  registration?: string;
  altitude_mentioned?: number;
  location_mentioned?: string;
  analysis_date?: string;
}

export const OCREvidencePanel = () => {
  const [holdingPatterns, setHoldingPatterns] = useState<HoldingPattern[]>([]);
  const [screenshotOCR, setScreenshotOCR] = useState<ScreenshotOCR[]>([]);
  const [radarAnalysis, setRadarAnalysis] = useState<RadarAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalHoldingPatterns: 0,
    totalScreenshots: 0,
    totalRadarAnalysis: 0,
    topLoiterer: { registration: '', loops: 0 }
  });

  const fetchOCRData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch holding patterns (loitering evidence)
      const [holdingRes, screenshotRes, radarRes, correlationRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT 
                registration,
                loop_count,
                MIN(created_at) as first_seen,
                MAX(created_at) as last_seen
              FROM ocr_aircraft_holding_patterns
              WHERE registration IS NOT NULL
              GROUP BY registration, loop_count
              ORDER BY loop_count DESC
              LIMIT 50
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT * FROM screenshot_ocr_data
              ORDER BY created_at DESC
              LIMIT 50
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT * FROM radar_screenshot_analysis
              ORDER BY created_at DESC
              LIMIT 50
            `
          }
        }),
        supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              SELECT COUNT(*) as count FROM screenshot_correlations
            `
          }
        })
      ]);

      const patterns = holdingRes.data?.data || [];
      const screenshots = screenshotRes.data?.data || [];
      const radar = radarRes.data?.data || [];

      setHoldingPatterns(patterns);
      setScreenshotOCR(screenshots);
      setRadarAnalysis(radar);

      // Calculate stats
      const topLoiterer = patterns.reduce(
        (max: HoldingPattern, curr: HoldingPattern) => 
          (curr.loop_count || 0) > (max.loop_count || 0) ? curr : max,
        { registration: 'N/A', loop_count: 0 }
      );

      setStats({
        totalHoldingPatterns: patterns.length,
        totalScreenshots: screenshots.length,
        totalRadarAnalysis: radar.length,
        topLoiterer: { 
          registration: topLoiterer.registration || 'N/A', 
          loops: topLoiterer.loop_count || 0 
        }
      });

    } catch (err) {
      console.error('Error fetching OCR data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOCRData();
  }, [fetchOCRData]);

  return (
    <CyberPanel 
      title="OCR VISUAL EVIDENCE" 
      icon={<Camera className="h-5 w-5" />}
      className="col-span-2"
    >
      {/* Stats Header */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-primary">{stats.totalHoldingPatterns}</div>
          <div className="text-xs text-muted-foreground">Holding Patterns</div>
        </div>
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-cyan-400">{stats.totalScreenshots}</div>
          <div className="text-xs text-muted-foreground">OCR Screenshots</div>
        </div>
        <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-magenta">{stats.totalRadarAnalysis}</div>
          <div className="text-xs text-muted-foreground">Radar Analyses</div>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
          <div className="text-2xl font-mono text-red-400">{stats.topLoiterer.loops}</div>
          <div className="text-xs text-muted-foreground">
            {stats.topLoiterer.registration} Loops
          </div>
        </div>
      </div>

      {/* Critical Alert for KCSO Loitering */}
      {stats.topLoiterer.registration?.includes('KC') && stats.topLoiterer.loops > 50 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="font-bold text-red-400">CRITICAL: DOCUMENTED LOITERING PATTERN</span>
          </div>
          <p className="text-sm text-foreground/80">
            <span className="font-mono text-red-400">{stats.topLoiterer.registration}</span> has{' '}
            <span className="font-bold text-red-400">{stats.topLoiterer.loops} documented loitering loops</span>{' '}
            captured via FlightRadar24 OCR. This visual evidence proves deliberate surveillance patterns.
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={fetchOCRData} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Holding Patterns - Loitering Evidence */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Repeat className="h-4 w-4 text-red-400" />
            Aircraft Holding Patterns (Loitering Proof)
          </div>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : holdingPatterns.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">No holding patterns found</div>
              ) : (
                holdingPatterns.map((pattern, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${
                      pattern.loop_count > 50 
                        ? 'border-red-500/30 bg-red-500/5' 
                        : 'border-border/30 bg-background/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-red-400" />
                        <span className="font-mono text-primary font-bold">{pattern.registration}</span>
                      </div>
                      <Badge 
                        className={
                          pattern.loop_count > 50 
                            ? 'bg-red-500/20 text-red-400 border-red-500/30'
                            : pattern.loop_count > 20
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                            : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                        }
                      >
                        <Repeat className="h-3 w-3 mr-1" />
                        {pattern.loop_count} loops
                      </Badge>
                    </div>
                    {pattern.first_seen && (
                      <div className="text-xs text-muted-foreground mt-1">
                        First: {new Date(pattern.first_seen).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Radar Screenshot Analysis */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Image className="h-4 w-4 text-cyan-400" />
            Radar Screenshot Analysis
          </div>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Loading...</div>
              ) : radarAnalysis.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">No radar analyses found</div>
              ) : (
                radarAnalysis.map((analysis, idx) => (
                  <div 
                    key={idx} 
                    className="p-3 rounded-lg border border-border/30 bg-background/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-cyan-400" />
                        <span className="font-mono text-primary">
                          {analysis.registration || 'Unknown'}
                        </span>
                      </div>
                      {analysis.altitude_mentioned && (
                        <Badge variant="outline" className="text-xs">
                          {analysis.altitude_mentioned}ft
                        </Badge>
                      )}
                    </div>
                    {analysis.location_mentioned && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        Location: {analysis.location_mentioned}
                      </div>
                    )}
                    {analysis.analysis_date && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(analysis.analysis_date).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Legal Significance */}
      <div className="mt-6 border-t border-border/30 pt-4">
        <div className="text-xs text-muted-foreground">
          <strong className="text-foreground">Legal Significance:</strong> OCR-extracted data from 
          FlightRadar24 screenshots provides independent visual verification of aircraft presence, 
          loitering patterns, and altitude data. Holding pattern loop counts prove deliberate 
          surveillance orbits rather than transit flights.
        </div>
      </div>
    </CyberPanel>
  );
};

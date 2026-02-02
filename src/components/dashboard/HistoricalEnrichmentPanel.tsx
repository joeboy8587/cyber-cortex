import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Calendar, Database, Activity, Loader2, Play, 
  CheckCircle2, TrendingUp, BarChart3, Zap
} from 'lucide-react';

interface EnrichmentStats {
  total_correlations: number;
  avg_bh_score: number;
  unique_aircraft: number;
  earliest: string;
  latest: string;
  high_confidence: number;
  medium_confidence: number;
  low_confidence: number;
}

interface AnalysisData {
  biometricDays: number;
  flightDays: number;
  existingCorrelations: number;
  biometricData: { date: string; biometric_count: number }[];
  flightData: { date: string; flight_count: number }[];
}

export function HistoricalEnrichmentPanel() {
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [stats, setStats] = useState<EnrichmentStats | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('historical-biometric-enrichment', {
        body: { action: 'stats' }
      });

      if (error) throw error;
      setStats(data.stats);
    } catch (error: any) {
      console.error('Stats error:', error);
    } finally {
      setLoading(false);
    }
  };

  const analyzeHistoricalData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('historical-biometric-enrichment', {
        body: { 
          action: 'analyze',
          startDate: '2021-01-01',
          endDate: '2026-12-31'
        }
      });

      if (error) throw error;
      setAnalysis(data.analysis);
    } catch (error: any) {
      toast({
        title: 'Analysis Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const runEnrichment = async () => {
    setEnriching(true);
    setProgress(0);
    
    try {
      // Run multiple batches
      const batches = 5;
      for (let i = 0; i < batches; i++) {
        const { data, error } = await supabase.functions.invoke('historical-biometric-enrichment', {
          body: { 
            action: 'enrich',
            startDate: '2021-01-01',
            endDate: '2026-12-31',
            batchSize: 100
          }
        });

        if (error) throw error;
        
        setProgress(((i + 1) / batches) * 100);
        
        toast({
          title: `Batch ${i + 1}/${batches} Complete`,
          description: `Created ${data.correlationsCreated} correlations`
        });
      }

      // Refresh stats
      await fetchStats();
      
      toast({
        title: 'Enrichment Complete',
        description: 'Historical biometric correlations have been generated'
      });
    } catch (error: any) {
      toast({
        title: 'Enrichment Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setEnriching(false);
    }
  };

  useEffect(() => {
    fetchStats();
    analyzeHistoricalData();
  }, []);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Historical Biometric Enrichment (2021-2026)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Analysis Summary */}
        {analysis && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium">Biometric Days</span>
              </div>
              <div className="text-2xl font-bold">{analysis.biometricDays}</div>
              <p className="text-xs text-muted-foreground">Days with readings</p>
            </Card>
            <Card className="p-4 bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Flight Days</span>
              </div>
              <div className="text-2xl font-bold">{analysis.flightDays}</div>
              <p className="text-xs text-muted-foreground">Days with detections</p>
            </Card>
            <Card className="p-4 bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Existing Correlations</span>
              </div>
              <div className="text-2xl font-bold">{analysis.existingCorrelations}</div>
              <p className="text-xs text-muted-foreground">Already linked</p>
            </Card>
          </div>
        )}

        {/* Current Stats */}
        {stats && (
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total Correlations</span>
              <Badge>{stats.total_correlations?.toLocaleString() || 0}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Average Bradford-Hill Score</span>
              <Badge variant="secondary">{(stats.avg_bh_score || 0).toFixed(1)}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Unique Aircraft</span>
              <Badge variant="outline">{stats.unique_aircraft || 0}</Badge>
            </div>
            
            {/* Confidence Distribution */}
            <div className="pt-2 border-t border-border">
              <div className="text-xs font-medium mb-2">Confidence Distribution</div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="text-xs">High (70+)</span>
                  </div>
                  <div className="text-lg font-bold">{stats.high_confidence || 0}</div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="text-xs">Medium (50-70)</span>
                  </div>
                  <div className="text-lg font-bold">{stats.medium_confidence || 0}</div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-1 mb-1">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-xs">Low (&lt;50)</span>
                  </div>
                  <div className="text-lg font-bold">{stats.low_confidence || 0}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {enriching && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Enrichment Progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={analyzeHistoricalData}
            disabled={loading || enriching}
            variant="outline"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><BarChart3 className="h-4 w-4 mr-2" /> Analyze Gaps</>
            )}
          </Button>
          <Button
            onClick={runEnrichment}
            disabled={loading || enriching}
          >
            {enriching ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enriching...</>
            ) : (
              <><Zap className="h-4 w-4 mr-2" /> Run Historical Enrichment</>
            )}
          </Button>
        </div>

        {/* Info */}
        <p className="text-xs text-muted-foreground">
          This tool generates Bradford-Hill scored correlations between biometric readings 
          and flight detections from 2021-2024, filling gaps in historical analysis.
        </p>
      </CardContent>
    </Card>
  );
}

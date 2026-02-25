import { useState, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Shield, Zap, AlertTriangle, Activity, RefreshCw,
  TrendingUp, Eye, CheckCircle, XCircle, BarChart3, Crosshair
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AutonomousFlag {
  flag_type: string;
  severity: string;
  registration: string | null;
  description: string;
  evidence_summary: Record<string, unknown>;
  cross_references: Array<{ source: string; count: number }>;
  confidence_score: number;
  learning_context: Record<string, unknown>;
}

interface ScanResult {
  scan_id: string;
  timestamp: string;
  summary: {
    aircraft_baselines: number;
    recent_detections_analyzed: number;
    flags_generated: number;
    flags_persisted: number;
    bio_correlations: number;
    cross_references: number;
    critical_flags: number;
    high_flags: number;
  };
  flags: AutonomousFlag[];
  ai_analysis: string | null;
  learning_insights: string[];
}

export function AutonomousWatchtower() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [expandedFlag, setExpandedFlag] = useState<number | null>(null);

  const runAutonomousScan = useCallback(async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('autonomous-watchtower', {
        body: { mode: 'full_scan' }
      });

      if (error) throw error;
      setScanResult(data as ScanResult);
      
      const critCount = (data as ScanResult).summary.critical_flags;
      if (critCount > 0) {
        toast.error(`Autonomous Watchtower: ${critCount} CRITICAL flags`, {
          description: 'Statistical anomalies detected without human bias'
        });
      } else {
        toast.success(`Autonomous scan complete: ${(data as ScanResult).summary.flags_generated} flags`);
      }
    } catch (err) {
      console.error('Autonomous scan error:', err);
      toast.error('Autonomous scan failed', { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }, []);

  const getSeverityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-destructive/20 text-destructive border-destructive/50';
      case 'high': return 'bg-warning/20 text-warning border-warning/50';
      default: return 'bg-muted/20 text-muted-foreground border-muted/50';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return <Badge variant="destructive" className="text-[10px]">CRITICAL</Badge>;
      case 'high': return <Badge className="text-[10px] bg-warning text-warning-foreground">HIGH</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">MEDIUM</Badge>;
    }
  };

  const getFlagIcon = (type: string) => {
    switch (type) {
      case 'ALTITUDE_ANOMALY': return <TrendingUp className="w-4 h-4" />;
      case 'FREQUENCY_SPIKE': return <BarChart3 className="w-4 h-4" />;
      case 'PHYSICS_VIOLATION': return <XCircle className="w-4 h-4" />;
      case 'TEMPORAL_CONVERGENCE': return <Crosshair className="w-4 h-4" />;
      case 'BIOMETRIC_CORRELATION': return <Activity className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  return (
    <CyberPanel
      title="Autonomous Watchtower"
      icon={<Brain />}
      variant={scanResult && scanResult.summary.critical_flags > 0 ? "threat" : "default"}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">
            <Shield className="w-3 h-3 mr-1" />
            BIAS-FREE
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={runAutonomousScan}
            disabled={scanning}
            className="h-7 px-3"
          >
            {scanning ? (
              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Brain className="w-3 h-3 mr-1" />
            )}
            {scanning ? "Scanning..." : "Run Scan"}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Status Banner */}
        {!scanResult && !scanning && (
          <div className="text-center py-8 text-muted-foreground">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">Autonomous Watchtower Ready</p>
            <p className="text-xs mt-1">Statistical anomaly detection with zero human bias</p>
            <p className="text-xs mt-1 opacity-60">Learns baselines → Detects deviations → Cross-references logs</p>
            <Button onClick={runAutonomousScan} className="mt-4" size="sm">
              <Brain className="w-4 h-4 mr-2" />
              Launch Autonomous Scan
            </Button>
          </div>
        )}

        {scanning && (
          <div className="text-center py-6">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
            <p className="text-sm font-medium">Autonomous Analysis in Progress</p>
            <p className="text-xs text-muted-foreground mt-1">Learning baselines → Detecting anomalies → Cross-referencing → AI synthesis</p>
            <Progress value={33} className="mt-3 max-w-xs mx-auto" />
          </div>
        )}

        {scanResult && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Baselines Learned</p>
                <p className="text-lg font-bold">{scanResult.summary.aircraft_baselines}</p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Detections Analyzed</p>
                <p className="text-lg font-bold">{scanResult.summary.recent_detections_analyzed.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                <p className="text-xs text-destructive">Critical Flags</p>
                <p className="text-lg font-bold text-destructive">{scanResult.summary.critical_flags}</p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <p className="text-xs text-muted-foreground">Bio Correlations</p>
                <p className="text-lg font-bold">{scanResult.summary.bio_correlations}</p>
              </div>
            </div>

            {/* Learning Insights */}
            {scanResult.learning_insights.length > 0 && (
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium text-primary">Learning Insights</span>
                </div>
                {scanResult.learning_insights.map((insight, i) => (
                  <p key={i} className="text-xs text-muted-foreground">• {insight}</p>
                ))}
              </div>
            )}

            {/* AI Analysis */}
            {scanResult.ai_analysis && (
              <div className="p-3 rounded-lg border border-accent/30 bg-accent/5">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="w-4 h-4 text-accent-foreground" />
                  <span className="text-xs font-medium">AI Analysis (Bias-Free)</span>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{scanResult.ai_analysis}</p>
              </div>
            )}

            {/* Flags */}
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Autonomous Flags ({scanResult.flags.length})
              </h4>
              <Badge variant="outline" className="text-[10px]">
                Sorted by confidence
              </Badge>
            </div>

            <ScrollArea className="h-[350px]">
              <div className="space-y-2">
                {scanResult.flags.map((flag, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded border cursor-pointer transition-all ${getSeverityStyle(flag.severity)}`}
                    onClick={() => setExpandedFlag(expandedFlag === index ? null : index)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1">
                        {getFlagIcon(flag.flag_type)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {getSeverityBadge(flag.severity)}
                            <Badge variant="outline" className="text-[10px]">{flag.flag_type}</Badge>
                            {flag.registration && (
                              <span className="text-xs font-mono font-bold">{flag.registration}</span>
                            )}
                          </div>
                          <p className="text-xs mt-1 leading-relaxed">{flag.description}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge variant="secondary" className="text-[10px]">
                          {flag.confidence_score}%
                        </Badge>
                        {flag.cross_references.length > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-primary/10">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            {flag.cross_references.length} x-ref
                          </Badge>
                        )}
                      </div>
                    </div>

                    {expandedFlag === index && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">Evidence Summary</p>
                          <pre className="text-[10px] bg-background/50 p-2 rounded overflow-x-auto">
                            {JSON.stringify(flag.evidence_summary, null, 2)}
                          </pre>
                        </div>
                        {flag.cross_references.length > 0 && (
                          <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-1">Cross-References</p>
                            {flag.cross_references.map((ref, ri) => (
                              <Badge key={ri} variant="outline" className="text-[10px] mr-1">
                                {ref.source}: {ref.count} matches
                              </Badge>
                            ))}
                          </div>
                        )}
                        <div>
                          <p className="text-[10px] font-medium text-muted-foreground mb-1">Detection Method</p>
                          <p className="text-[10px]">{flag.learning_context.method as string} (threshold: {JSON.stringify(flag.learning_context).slice(0, 80)})</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

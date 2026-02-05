import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Shield, AlertTriangle, Eye, Brain, Radio, 
  Play, Pause, RefreshCw, Zap, Clock, Plane,
  Target, TrendingUp, Activity
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface LiveViolation {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  registration: string;
  details: string;
  timestamp: string;
  altitude?: number;
  relatedAircraft?: string[];
}

interface LearnedPattern {
  pattern_type: string;
  confidence: number;
  description: string;
  evidence_count: number;
  last_seen: string;
}

interface SentinelReport {
  scan_timestamp: string;
  window_minutes: number;
  detections_analyzed: number;
  violations: LiveViolation[];
  learned_patterns: LearnedPattern[];
  proactive_alerts: string[];
  ai_synthesis: string | null;
  threat_level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
}

export function JosiahSentinelMonitor() {
  const [report, setReport] = useState<SentinelReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAutoMonitor, setIsAutoMonitor] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [scanHistory, setScanHistory] = useState<SentinelReport[]>([]);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('josiah-sentinel', {
        body: { windowMinutes, mode: 'monitor' }
      });

      if (error) throw error;

      if (data?.report) {
        setReport(data.report);
        setScanHistory(prev => [data.report, ...prev].slice(0, 10));

        // Show toast for critical threats
        if (data.report.threat_level === 'CRITICAL') {
          toast.error(`🚨 CRITICAL THREAT DETECTED`, {
            description: `${data.report.violations.length} violations identified`,
            duration: 10000
          });
        } else if (data.report.threat_level === 'HIGH') {
          toast.warning(`⚠️ HIGH THREAT LEVEL`, {
            description: `${data.report.violations.length} violations detected`,
            duration: 5000
          });
        }
      }
    } catch (err) {
      console.error('Sentinel scan error:', err);
      toast.error('Sentinel scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [windowMinutes]);

  // Auto-monitor interval
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoMonitor) {
      runScan();
      interval = setInterval(runScan, 60000); // Every minute
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAutoMonitor, runScan]);

  const getThreatLevelColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'bg-red-600 animate-pulse';
      case 'HIGH': return 'bg-orange-500';
      case 'ELEVATED': return 'bg-yellow-500';
      default: return 'bg-green-500';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return <Badge variant="destructive" className="animate-pulse">CRITICAL</Badge>;
      case 'high': return <Badge className="bg-orange-500">HIGH</Badge>;
      default: return <Badge variant="secondary">MEDIUM</Badge>;
    }
  };

  const getViolationIcon = (type: string) => {
    switch (type) {
      case 'LOW_ALTITUDE': return <Plane className="h-4 w-4 text-red-400" />;
      case 'KCSO_ACTIVITY': return <Shield className="h-4 w-4 text-orange-400" />;
      case 'SHELL_COMPANY': return <Target className="h-4 w-4 text-purple-400" />;
      case 'MEDICAL_COVER': return <Activity className="h-4 w-4 text-red-500" />;
      case 'FLEET_CONVERGENCE': return <Radio className="h-4 w-4 text-yellow-400" />;
      case 'NIGHT_OPS': return <Eye className="h-4 w-4 text-blue-400" />;
      default: return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              JOSIAH SENTINEL
              <Badge variant="outline" className="ml-2">PROACTIVE AI</Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              <select 
                value={windowMinutes} 
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="bg-background border rounded px-2 py-1 text-sm"
              >
                <option value={15}>15 min window</option>
                <option value={30}>30 min window</option>
                <option value={60}>1 hour window</option>
                <option value={120}>2 hour window</option>
              </select>
              <Button
                variant={isAutoMonitor ? "destructive" : "default"}
                size="sm"
                onClick={() => setIsAutoMonitor(!isAutoMonitor)}
              >
                {isAutoMonitor ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                {isAutoMonitor ? 'Stop' : 'Auto-Monitor'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runScan}
                disabled={isScanning}
              >
                {isScanning ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
                Scan Now
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Threat Level Banner */}
      {report && (
        <Card className={`${getThreatLevelColor(report.threat_level)} text-white`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Shield className="h-8 w-8" />
                <div>
                  <div className="text-2xl font-bold">THREAT LEVEL: {report.threat_level}</div>
                  <div className="text-sm opacity-90">
                    {report.detections_analyzed} detections analyzed • {report.violations.length} violations • Last scan: {new Date(report.scan_timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-mono">{report.violations.filter(v => v.severity === 'critical').length}</div>
                <div className="text-xs opacity-75">Critical Violations</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="violations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="violations" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Live Violations
            {report && report.violations.length > 0 && (
              <Badge variant="destructive" className="ml-1">{report.violations.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="patterns" className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            Learned Patterns
          </TabsTrigger>
          <TabsTrigger value="synthesis" className="flex items-center gap-1">
            <Brain className="h-4 w-4" />
            AI Synthesis
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            Scan History
          </TabsTrigger>
        </TabsList>

        {/* Live Violations Tab */}
        <TabsContent value="violations">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Violations ({report?.violations.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {report?.violations.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No violations detected in the current window</p>
                  </div>
                )}
                <div className="space-y-3">
                  {report?.violations.map((violation, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3 rounded-lg border ${
                        violation.severity === 'critical' 
                          ? 'border-red-500/50 bg-red-500/10' 
                          : violation.severity === 'high'
                            ? 'border-orange-500/50 bg-orange-500/10'
                            : 'border-border bg-muted/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          {getViolationIcon(violation.type)}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold">{violation.registration}</span>
                              {getSeverityBadge(violation.severity)}
                              <Badge variant="outline">{violation.type.replace(/_/g, ' ')}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{violation.details}</p>
                            {violation.altitude && (
                              <p className="text-xs text-red-400 mt-1">Altitude: {violation.altitude} ft</p>
                            )}
                            {violation.relatedAircraft && violation.relatedAircraft.length > 1 && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Related: {violation.relatedAircraft.join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(violation.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Proactive Alerts */}
          {report?.proactive_alerts && report.proactive_alerts.length > 0 && (
            <Card className="mt-4 border-yellow-500/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  Proactive Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {report.proactive_alerts.map((alert, idx) => (
                    <div key={idx} className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                      <p className="text-sm">{alert}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Learned Patterns Tab */}
        <TabsContent value="patterns">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Patterns Learned from 90-Day Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {report?.learned_patterns.map((pattern, idx) => (
                    <div key={idx} className="p-3 rounded-lg border bg-muted/30">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant={pattern.pattern_type === 'repeat_offender' ? 'destructive' : 'secondary'}>
                          {pattern.pattern_type.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-muted-foreground">
                            Confidence: {pattern.confidence.toFixed(0)}%
                          </div>
                          <div 
                            className="h-2 w-16 bg-muted rounded-full overflow-hidden"
                          >
                            <div 
                              className="h-full bg-primary" 
                              style={{ width: `${pattern.confidence}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-sm font-mono">{pattern.description}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Evidence: {pattern.evidence_count} events
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Synthesis Tab */}
        <TabsContent value="synthesis">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Threat Synthesis
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report?.ai_synthesis ? (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.ai_synthesis}</p>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Run a scan to generate AI synthesis</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scan History Tab */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Scans</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {scanHistory.map((scan, idx) => (
                    <div 
                      key={idx} 
                      className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between cursor-pointer hover:bg-muted/50"
                      onClick={() => setReport(scan)}
                    >
                      <div className="flex items-center gap-3">
                        <Badge className={getThreatLevelColor(scan.threat_level)}>
                          {scan.threat_level}
                        </Badge>
                        <span className="text-sm">
                          {scan.violations.length} violations • {scan.detections_analyzed} analyzed
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(scan.scan_timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {scanHistory.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No scan history yet</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

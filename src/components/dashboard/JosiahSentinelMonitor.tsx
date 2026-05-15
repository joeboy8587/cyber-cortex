import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Shield, AlertTriangle, Eye, Brain, Radio, 
  Play, Pause, RefreshCw, Zap, Clock, Plane,
  Target, TrendingUp, Activity, Swords, CheckCircle, FileText, Download
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SentinelDrillDown } from "./SentinelDrillDown";

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

interface AdaptiveThreshold {
  registration: string;
  parameter: string;
  original_value: number;
  adjusted_value: number;
  reason: string;
}

interface Countermeasure {
  registration: string;
  action: string;
  priority: 'critical' | 'high' | 'medium';
  escalation_level: number;
  total_violations: number;
  status: string;
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
  adaptive_thresholds: AdaptiveThreshold[];
  countermeasures: Countermeasure[];
  josiah_snark?: string | null;
  military_repeat_offenders?: Array<{ callsign: string; prefix: string; appearances: number; first_seen?: string; last_seen?: string; min_altitude?: number }>;
  hall_of_shame?: HallOfShameEntry[];
  hall_of_shame_meta?: { window_days: number; total_aircraft: number; total_detections: number; oildale_cluster_pct: number };
}

interface HallOfShameEntry {
  rank: number;
  registration: string;
  detections: number;
  avg_altitude_ft: number;
  min_altitude_ft: number;
  pct_below_1000ft: number;
  pct_below_500ft: number;
  oildale_cluster_pct: number;
  centroid: { lat: number; lng: number } | null;
  spread_km: number;
  classification: 'KCSO' | 'FLYT' | 'SHELL' | 'MEDICAL' | 'MILITARY' | 'UNKNOWN';
  snark: string;
  what_it_really_means: string;
  first_seen: string;
  last_seen: string;
}

export function JosiahSentinelMonitor() {
  const [report, setReport] = useState<SentinelReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAutoMonitor, setIsAutoMonitor] = useState(false);
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [scanHistory, setScanHistory] = useState<SentinelReport[]>([]);
  const [drillReg, setDrillReg] = useState<string>('');
  const [drillTimestamp, setDrillTimestamp] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<string>('violations');
  const scanInFlightRef = useRef(false);

  const runScan = useCallback(async () => {
    if (scanInFlightRef.current) return;

    scanInFlightRef.current = true;
    setIsScanning(true);

    const slowScanTimer = setTimeout(() => {
      toast.info('Sentinel scan is still running… analyzing full telemetry window');
    }, 25000);

    try {
      const { data, error } = await supabase.functions.invoke('josiah-sentinel', {
        body: { windowMinutes, mode: 'monitor' }
      });

      if (error) throw error;

      if (data?.report) {
        setReport(data.report);
        setScanHistory(prev => [data.report, ...prev].slice(0, 10));

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
      toast.error('Sentinel scan failed', {
        description: err instanceof Error ? err.message : 'Unexpected runtime error'
      });
    } finally {
      clearTimeout(slowScanTimer);
      scanInFlightRef.current = false;
      setIsScanning(false);
    }
  }, [windowMinutes]);

  // Auto-scan on mount
  useEffect(() => {
    runScan();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoMonitor) {
      runScan();
      interval = setInterval(runScan, 60000);
    }
    return () => { if (interval) clearInterval(interval); };
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

  const getEscalationColor = (level: number) => {
    if (level >= 5) return 'bg-red-600 text-white';
    if (level >= 4) return 'bg-orange-500 text-white';
    if (level >= 3) return 'bg-yellow-500 text-black';
    if (level >= 2) return 'bg-blue-500 text-white';
    return 'bg-muted text-muted-foreground';
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical': return <Badge variant="destructive">CRITICAL</Badge>;
      case 'high': return <Badge className="bg-orange-500 text-white">HIGH</Badge>;
      default: return <Badge variant="secondary">MEDIUM</Badge>;
    }
  };

  const exportToPDF = useCallback(async () => {
    if (!report) {
      toast.error('No scan data to export. Run a scan first.');
      return;
    }
    toast.info('Generating PDF report...');
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast.error('Pop-up blocked. Please allow pop-ups for this site.');
        return;
      }

      const severityIcon = (s: string) => s === 'critical' ? '🔴' : s === 'high' ? '🟠' : '🟡';
      const now = new Date().toISOString();
      const scanTime = new Date(report.scan_timestamp).toLocaleString();

      const violationsHTML = report.violations.map((v, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${v.registration}</strong></td>
          <td>${severityIcon(v.severity)} ${v.severity.toUpperCase()}</td>
          <td>${v.type.replace(/_/g, ' ')}</td>
          <td>${v.altitude ? v.altitude + ' ft' : '—'}</td>
          <td>${v.details}</td>
          <td>${new Date(v.timestamp).toLocaleString()}</td>
        </tr>
      `).join('');

      const countermeasuresHTML = (report.countermeasures || []).map((cm, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${cm.registration}</strong></td>
          <td>${cm.priority.toUpperCase()}</td>
          <td>Level ${cm.escalation_level}/5</td>
          <td>${cm.total_violations}</td>
          <td>${cm.action}</td>
          <td>${cm.status}</td>
        </tr>
      `).join('');

      const patternsHTML = (report.learned_patterns || []).map((p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.pattern_type.replace(/_/g, ' ').toUpperCase()}</td>
          <td>${Number(p.confidence).toFixed(0)}%</td>
          <td>${p.evidence_count}</td>
          <td>${p.description}</td>
        </tr>
      `).join('');

      const threatColor = report.threat_level === 'CRITICAL' ? '#dc2626' :
        report.threat_level === 'HIGH' ? '#ea580c' :
        report.threat_level === 'ELEVATED' ? '#ca8a04' : '#16a34a';

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SENTINEL REPORT — ${scanTime}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: 'Courier New', monospace; margin: 40px; color: #111; font-size: 11px; }
  h1 { font-size: 20px; border-bottom: 3px solid #111; padding-bottom: 8px; }
  h2 { font-size: 14px; margin-top: 24px; border-bottom: 1px solid #999; padding-bottom: 4px; }
  .threat-banner { background: ${threatColor}; color: white; padding: 16px; font-size: 18px; font-weight: bold; text-align: center; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
  th { background: #f0f0f0; font-weight: bold; }
  .meta { color: #666; font-size: 10px; }
  .synthesis { background: #f8f8f8; border-left: 4px solid ${threatColor}; padding: 12px; margin: 12px 0; white-space: pre-wrap; font-size: 11px; }
  .footer { margin-top: 32px; border-top: 2px solid #111; padding-top: 8px; font-size: 9px; color: #666; }
  .stats { display: flex; gap: 24px; margin: 8px 0; }
  .stat { text-align: center; }
  .stat-value { font-size: 24px; font-weight: bold; }
  .stat-label { font-size: 9px; color: #666; }
</style></head><body>
<h1>🛡️ JOSIAH SENTINEL — THREAT ASSESSMENT REPORT</h1>
<p class="meta">Generated: ${now} | Scan Window: ${report.window_minutes} minutes | Classification: CONFIDENTIAL — ATTORNEY WORK PRODUCT</p>

<div class="threat-banner">⚠️ THREAT LEVEL: ${report.threat_level} — ${report.violations.filter(v => v.severity === 'critical').length} CRITICAL VIOLATIONS</div>

<div class="stats">
  <div class="stat"><div class="stat-value">${report.detections_analyzed}</div><div class="stat-label">Detections Analyzed</div></div>
  <div class="stat"><div class="stat-value">${report.violations.length}</div><div class="stat-label">Violations</div></div>
  <div class="stat"><div class="stat-value">${report.violations.filter(v => v.severity === 'critical').length}</div><div class="stat-label">Critical</div></div>
  <div class="stat"><div class="stat-value">${(report.countermeasures || []).length}</div><div class="stat-label">Countermeasures</div></div>
  <div class="stat"><div class="stat-value">${(report.learned_patterns || []).length}</div><div class="stat-label">Patterns</div></div>
</div>

<h2>1. ACTIVE VIOLATIONS (${report.violations.length})</h2>
<table>
  <tr><th>#</th><th>Registration</th><th>Severity</th><th>Type</th><th>Altitude</th><th>Details</th><th>Timestamp</th></tr>
  ${violationsHTML || '<tr><td colspan="7">No violations detected</td></tr>'}
</table>

${report.proactive_alerts && report.proactive_alerts.length > 0 ? `
<h2>2. PROACTIVE ALERTS</h2>
<ul>${report.proactive_alerts.map(a => `<li>${a}</li>`).join('')}</ul>
` : ''}

<h2>3. AI COUNTERMEASURE RECOMMENDATIONS (${(report.countermeasures || []).length})</h2>
<table>
  <tr><th>#</th><th>Registration</th><th>Priority</th><th>Escalation</th><th>Total Violations</th><th>Recommended Action</th><th>Status</th></tr>
  ${countermeasuresHTML || '<tr><td colspan="7">No countermeasures generated</td></tr>'}
</table>

<h2>4. LEARNED PATTERNS (90-DAY ANALYSIS)</h2>
<table>
  <tr><th>#</th><th>Pattern Type</th><th>Confidence</th><th>Evidence Count</th><th>Description</th></tr>
  ${patternsHTML || '<tr><td colspan="5">No patterns detected</td></tr>'}
</table>

${report.ai_synthesis ? `
<h2>5. AI THREAT SYNTHESIS</h2>
<div class="synthesis">${report.ai_synthesis}</div>
` : ''}

<div class="footer">
  <p>JOSIAH SENTINEL AUTONOMOUS THREAT ASSESSMENT | Scan ID: ${report.scan_timestamp}</p>
  <p>This report is generated from live telemetry analysis and constitutes evidentiary documentation.</p>
  <p>Chain of custody: Auto-generated by AI sentinel system — no human modification post-generation.</p>
</div>
</body></html>`;

      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);
      toast.success('PDF report ready — use Print > Save as PDF');
    } catch (err) {
      toast.error('Export failed');
      console.error(err);
    }
  }, [report]);

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
              <Button variant="outline" size="sm" onClick={runScan} disabled={isScanning}>
                {isScanning ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
                Scan Now
              </Button>
              <Button variant="outline" size="sm" onClick={exportToPDF} disabled={!report}>
                <Download className="h-4 w-4 mr-1" />
                Export PDF
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
                    {report.detections_analyzed} detections analyzed • {report.violations.length} violations • Last scan: {new Date(report.scan_timestamp).toLocaleString()}
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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="violations" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Live Violations
            {report && report.violations.length > 0 && (
              <Badge variant="destructive" className="ml-1">{report.violations.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="hallofshame" className="flex items-center gap-1">
            <Target className="h-4 w-4" />
            Hall of Shame
            {report?.hall_of_shame && report.hall_of_shame.length > 0 && (
              <Badge className="ml-1 bg-amber-600">{report.hall_of_shame.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="countermeasures" className="flex items-center gap-1">
            <Swords className="h-4 w-4" />
            Countermeasures
            {report && report.countermeasures && report.countermeasures.length > 0 && (
              <Badge className="ml-1 bg-emerald-600">{report.countermeasures.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="patterns" className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            Learned Patterns
          </TabsTrigger>
          <TabsTrigger value="drilldown" className="flex items-center gap-1">
            <Plane className="h-4 w-4" />
            Drill Down
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
                      onClick={() => { setDrillReg(violation.registration); setDrillTimestamp(violation.timestamp); setActiveTab('drilldown'); }}
                      className={`p-3 rounded-lg border cursor-pointer hover:ring-1 hover:ring-primary/40 ${
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
                          {new Date(violation.timestamp).toLocaleString()}
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

        {/* Hall of Shame Tab — 90 day top tails */}
        <TabsContent value="hallofshame">
          <Card className="border-amber-500/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-amber-400" />
                90-Day Hall of Shame
                {report?.hall_of_shame_meta && (
                  <Badge variant="outline" className="ml-2 font-mono text-xs">
                    {report.hall_of_shame_meta.total_aircraft} tails · {report.hall_of_shame_meta.total_detections.toLocaleString()} hits · {report.hall_of_shame_meta.oildale_cluster_pct}% Oildale
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!report?.hall_of_shame || report.hall_of_shame.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Run a scan to populate Hall of Shame.</p>
                </div>
              ) : (
                <ScrollArea className="h-[520px]">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr className="text-left text-muted-foreground">
                        <th className="py-2 pr-2">#</th>
                        <th className="py-2 pr-2">Tail</th>
                        <th className="py-2 pr-2">Class</th>
                        <th className="py-2 pr-2 text-right">Detections</th>
                        <th className="py-2 pr-2 text-right">Avg Alt</th>
                        <th className="py-2 pr-2 text-right">Min Alt</th>
                        <th className="py-2 pr-2 text-right">&lt;1000ft</th>
                        <th className="py-2 pr-2 text-right">&lt;500ft</th>
                        <th className="py-2 pr-2 text-right">Oildale</th>
                        <th className="py-2 pr-2 text-right">Spread</th>
                        <th className="py-2 pr-2">Snark / What it really means</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.hall_of_shame.map((e) => {
                        const clsColor =
                          e.classification === 'KCSO' ? 'bg-orange-500/20 text-orange-300' :
                          e.classification === 'SHELL' ? 'bg-purple-500/20 text-purple-300' :
                          e.classification === 'FLYT' ? 'bg-blue-500/20 text-blue-300' :
                          e.classification === 'MEDICAL' ? 'bg-red-500/20 text-red-300' :
                          e.classification === 'MILITARY' ? 'bg-yellow-500/20 text-yellow-300' :
                          'bg-muted text-muted-foreground';
                        return (
                          <tr
                            key={e.registration}
                            onClick={() => { setDrillReg(e.registration); setActiveTab('drilldown'); }}
                            className="border-b border-border/40 hover:bg-amber-500/5 cursor-pointer"
                          >
                            <td className="py-2 pr-2">{e.rank}</td>
                            <td className="py-2 pr-2 font-bold">{e.registration}</td>
                            <td className="py-2 pr-2"><Badge className={`${clsColor} text-[10px]`}>{e.classification}</Badge></td>
                            <td className="py-2 pr-2 text-right">{e.detections.toLocaleString()}</td>
                            <td className="py-2 pr-2 text-right">{e.avg_altitude_ft}</td>
                            <td className={`py-2 pr-2 text-right ${e.min_altitude_ft < 0 ? 'text-red-400 font-bold' : ''}`}>{e.min_altitude_ft}</td>
                            <td className="py-2 pr-2 text-right">{e.pct_below_1000ft.toFixed(0)}%</td>
                            <td className={`py-2 pr-2 text-right ${e.pct_below_500ft > 25 ? 'text-red-400 font-bold' : ''}`}>{e.pct_below_500ft.toFixed(0)}%</td>
                            <td className={`py-2 pr-2 text-right ${e.oildale_cluster_pct > 50 ? 'text-amber-400 font-bold' : ''}`}>{e.oildale_cluster_pct.toFixed(0)}%</td>
                            <td className="py-2 pr-2 text-right">{e.spread_km}km</td>
                            <td className="py-2 pr-2 max-w-[320px]">
                              <div className="italic text-amber-300">{e.snark}</div>
                              <div className="text-muted-foreground text-[11px] mt-0.5 normal-case">{e.what_it_really_means}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
              <p className="text-[10px] text-muted-foreground mt-3">
                Window: 90 days · AOI: Kern/South San Joaquin · Oildale = % of detections inside tight Oildale box (35.30–35.55, -119.20 to -118.85). Spread = max corner-to-corner distance of detection footprint. Click a row to drill down.
              </p>
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="countermeasures">
          <div className="space-y-4">
            {/* Adaptive Thresholds */}
            {report?.adaptive_thresholds && report.adaptive_thresholds.length > 0 && (
              <Card className="border-blue-500/30">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-400" />
                    Adaptive Thresholds Active
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {report.adaptive_thresholds.map((t, idx) => (
                      <div key={idx} className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 flex items-center justify-between">
                        <div>
                          <span className="font-mono font-semibold text-sm">{t.registration}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {t.parameter.replace(/_/g, ' ')}:
                          </span>
                          <span className="text-xs ml-1 line-through text-muted-foreground">{t.original_value}</span>
                          <span className="text-xs ml-1 text-blue-400 font-semibold">→ {t.adjusted_value}</span>
                        </div>
                        <span className="text-xs text-muted-foreground max-w-[40%] text-right">{t.reason}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Countermeasure Recommendations */}
            <Card className="border-emerald-500/30">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Swords className="h-5 w-5 text-emerald-400" />
                  AI Countermeasure Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[350px]">
                  {(!report?.countermeasures || report.countermeasures.length === 0) && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Swords className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>Run a scan to generate countermeasures</p>
                    </div>
                  )}
                  <div className="space-y-3">
                    {report?.countermeasures?.map((cm, idx) => (
                      <div key={idx}
                        onClick={() => { setDrillReg(cm.registration); setActiveTab('drilldown'); }}
                        className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 cursor-pointer hover:ring-1 hover:ring-emerald-400/40">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{cm.registration}</span>
                            {getPriorityBadge(cm.priority)}
                            <Badge className={getEscalationColor(cm.escalation_level)}>
                              Level {cm.escalation_level}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            {cm.status === 'NONE' && (
                              <Badge variant="outline" className="text-xs">NEW</Badge>
                            )}
                            {cm.status === 'RECOMMENDED' && (
                              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">RECOMMENDED</Badge>
                            )}
                            {cm.status === 'FILED' && (
                              <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                                <FileText className="h-3 w-3 mr-1" />FILED
                              </Badge>
                            )}
                            {cm.status === 'ACTIVE' && (
                              <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                                <CheckCircle className="h-3 w-3 mr-1" />ACTIVE
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-sm">{cm.action}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>{cm.total_violations} total violations</span>
                          <div className="flex gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <div
                                key={i}
                                className={`w-3 h-3 rounded-sm ${i < cm.escalation_level ? getEscalationColor(cm.escalation_level) : 'bg-muted'}`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
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
                            Confidence: {Number(pattern.confidence).toFixed(0)}%
                          </div>
                          <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pattern.confidence}%` }} />
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
        {/* Drill Down Tab */}
        <TabsContent value="drilldown">
          <SentinelDrillDown initialRegistration={drillReg} windowMinutes={windowMinutes} referenceTimestamp={drillTimestamp} />
        </TabsContent>

        <TabsContent value="synthesis">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Threat Synthesis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {report?.ai_synthesis ? (
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Sentinel synthesis</div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{report.ai_synthesis}</p>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Brain className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Run a scan to generate AI synthesis</p>
                </div>
              )}

              {report?.josiah_snark && (
                <div className="p-4 rounded-lg border border-amber-500/40 bg-amber-500/5">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs uppercase tracking-wide text-amber-500 font-bold">🛡 Josiah Snark — release valve</div>
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">unfiltered</Badge>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap font-mono">{report.josiah_snark}</p>
                </div>
              )}

              {report?.military_repeat_offenders && report.military_repeat_offenders.length > 0 && (
                <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/5">
                  <div className="text-xs uppercase tracking-wide text-destructive font-bold mb-2">🪖 Military repeat offenders — § 1385 indicators</div>
                  <div className="space-y-1">
                    {report.military_repeat_offenders.map((m, i) => (
                      <div key={i} className="flex items-center justify-between text-sm font-mono">
                        <span className="font-bold">{m.callsign}</span>
                        <span className="text-muted-foreground">prefix {m.prefix} · ×{m.appearances}{m.min_altitude !== undefined ? ` · min ${m.min_altitude}ft` : ''}</span>
                      </div>
                    ))}
                  </div>
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
                          {scan.countermeasures?.length > 0 && ` • ${scan.countermeasures.length} countermeasures`}
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

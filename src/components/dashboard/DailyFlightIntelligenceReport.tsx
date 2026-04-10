import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, AlertTriangle, Plane, Download, RefreshCw,
  FileText, Calendar, Save, Eye, Radio, Loader2, Clock, Database
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface ActiveAircraft {
  registration: string;
  icao: string;
  altitude: number;
  speed: number;
  threat_level: 'CONFIRMED' | 'SUSPICIOUS' | 'MEDIUM' | 'MONITORED';
  notes: string;
  aircraft_type?: string;
  operator?: string;
}

interface Violation {
  type: string;
  registration: string;
  severity: string;
  details: string;
  altitude?: number;
  timestamp: string;
}

interface DailyReport {
  report_id_code: string;
  report_date: string;
  scan_timestamp: string;
  threat_level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
  active_aircraft: ActiveAircraft[];
  violations: Violation[];
  threat_database: ActiveAircraft[];
  pattern_summary: {
    grid_detections: number;
    new_flags: number;
    grid_coverage: string;
    last_alert: string;
    known_threats: number;
  };
  stats: {
    active_flights: number;
    confirmed_threats: number;
    suspicious: number;
    monitored: number;
  };
}

interface SavedReport {
  id: string;
  report_date: string;
  report_id_code: string;
  threat_level: string;
  active_aircraft_count: number;
  confirmed_threats: number;
  created_at: string;
}

export function DailyFlightIntelligenceReport() {
  const [reportDate, setReportDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [activeTab, setActiveTab] = useState('generate');

  useEffect(() => {
    loadSavedReports();
  }, []);

  const loadSavedReports = async () => {
    const { data } = await supabase
      .from('watchtower_daily_reports')
      .select('id, report_date, report_id_code, threat_level, active_aircraft_count, confirmed_threats, created_at')
      .order('report_date', { ascending: false })
      .limit(30);
    if (data) setSavedReports(data);
  };

  const generateReport = async () => {
    setIsGenerating(true);
    try {
      const startTs = `${reportDate}T00:00:00Z`;
      const endTs = `${reportDate}T23:59:59Z`;

      const { data: flightData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT registration, icao_hex, altitude, speed, aircraft_type, operator_name,
                   detected_at, lat, lon, is_flagged, threat_score, callsign
            FROM live_flight_detections_rows 
            WHERE detected_at BETWEEN '${startTs}' AND '${endTs}'
              AND lat BETWEEN 35.25 AND 35.55
              AND lon BETWEEN -119.25 AND -118.85
            ORDER BY detected_at DESC
            LIMIT 5000
          `
        }
      });

      const flights = flightData?.data || flightData || [];

      const { data: threatData } = await supabase
        .from('sentinel_learned_threats')
        .select('*')
        .order('escalation_level', { ascending: false })
        .limit(50);

      const { data: kcsoFleet } = await supabase
        .from('kcso_fleet')
        .select('tail_number, model, surveillance_capabilities');

      const aircraftMap = new Map<string, ActiveAircraft>();
      const kcsoTails = new Set((kcsoFleet || []).map(k => k.tail_number));
      const threatMap = new Map((threatData || []).map(t => [t.registration, t]));

      for (const f of flights) {
        const reg = f.registration || f.callsign || 'UNKNOWN';
        if (aircraftMap.has(reg)) continue;

        let threat_level: ActiveAircraft['threat_level'] = 'MONITORED';
        let notes = '';

        const threat = threatMap.get(reg);
        if (threat) {
          if (threat.escalation_level >= 4) { threat_level = 'CONFIRMED'; notes = threat.ai_threat_profile || threat.threat_type; }
          else if (threat.escalation_level >= 3) { threat_level = 'SUSPICIOUS'; notes = threat.threat_type; }
          else { threat_level = 'MEDIUM'; notes = threat.threat_type; }
        }

        if (kcsoTails.has(reg)) {
          threat_level = 'CONFIRMED';
          notes = `KCSO Fleet Asset - ${notes || 'Confirmed surveillance operations'}`;
        }

        if (f.is_flagged || (f.altitude && f.altitude < 500)) {
          if (threat_level === 'MONITORED') threat_level = 'SUSPICIOUS';
          if (f.altitude < 500) notes = `Low altitude: ${f.altitude}ft. ${notes}`;
        }

        const shellPatterns = ['N786FA', 'N787FA', 'N788FA', 'N789FA', 'N790FA', 'N791FA', 'N85FA', 'N256AA', 'N916GW', 'N916BQ'];
        if (shellPatterns.includes(reg)) {
          threat_level = 'CONFIRMED';
          notes = `Shell company asset (ALF IX LLC/RESIDCO). ${notes}`;
        }

        aircraftMap.set(reg, {
          registration: reg,
          icao: f.icao_hex || 'unknown',
          altitude: f.altitude || 0,
          speed: f.speed || 0,
          threat_level,
          notes: notes || `${f.aircraft_type || 'Unknown type'} - ${f.operator_name || 'Unknown operator'}`,
          aircraft_type: f.aircraft_type,
          operator: f.operator_name
        });
      }

      const activeAircraft = Array.from(aircraftMap.values());
      const confirmed = activeAircraft.filter(a => a.threat_level === 'CONFIRMED');
      const suspicious = activeAircraft.filter(a => a.threat_level === 'SUSPICIOUS');
      const monitored = activeAircraft.filter(a => a.threat_level === 'MONITORED' || a.threat_level === 'MEDIUM');

      const violations: Violation[] = [];
      for (const f of flights) {
        if (f.altitude && f.altitude < 1000 && f.altitude > 0) {
          violations.push({
            type: 'LOW_ALTITUDE',
            registration: f.registration || 'UNKNOWN',
            severity: f.altitude < 500 ? 'critical' : 'high',
            details: `Aircraft at ${f.altitude}ft AGL over residential area (14 CFR §91.119 violation)`,
            altitude: f.altitude,
            timestamp: f.detected_at
          });
        }
      }
      const uniqueViolations = Array.from(
        violations.reduce((map, v) => {
          if (!map.has(v.registration) || v.severity === 'critical') map.set(v.registration, v);
          return map;
        }, new Map<string, Violation>()).values()
      );

      const threatDb: ActiveAircraft[] = (threatData || []).map(t => ({
        registration: t.registration,
        icao: '',
        altitude: Number(t.avg_altitude) || 0,
        speed: 0,
        threat_level: t.escalation_level >= 4 ? 'CONFIRMED' as const :
                      t.escalation_level >= 3 ? 'SUSPICIOUS' as const : 'MEDIUM' as const,
        notes: t.ai_threat_profile || t.threat_type
      }));

      let threatLevel: DailyReport['threat_level'] = 'NORMAL';
      if (confirmed.length >= 3 || uniqueViolations.filter(v => v.severity === 'critical').length >= 2) threatLevel = 'CRITICAL';
      else if (confirmed.length >= 1 || uniqueViolations.length >= 3) threatLevel = 'HIGH';
      else if (suspicious.length >= 2 || uniqueViolations.length >= 1) threatLevel = 'ELEVATED';

      const now = new Date();
      const reportIdCode = `FR-${reportDate.replace(/-/g, '')}-${format(now, 'HHmm')}`;

      const dailyReport: DailyReport = {
        report_id_code: reportIdCode,
        report_date: reportDate,
        scan_timestamp: now.toISOString(),
        threat_level: threatLevel,
        active_aircraft: activeAircraft.sort((a, b) => {
          const order = { CONFIRMED: 0, SUSPICIOUS: 1, MEDIUM: 2, MONITORED: 3 };
          return order[a.threat_level] - order[b.threat_level];
        }),
        violations: uniqueViolations,
        threat_database: threatDb,
        pattern_summary: {
          grid_detections: flights.length,
          new_flags: flights.filter((f: any) => f.is_flagged).length,
          grid_coverage: '50km radius',
          last_alert: uniqueViolations.length > 0 ? 'Live' : 'None',
          known_threats: threatDb.length
        },
        stats: {
          active_flights: activeAircraft.length,
          confirmed_threats: confirmed.length,
          suspicious: suspicious.length,
          monitored: monitored.length
        }
      };

      setReport(dailyReport);
      toast.success(`Report ${reportIdCode} generated: ${activeAircraft.length} aircraft, ${uniqueViolations.length} violations`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveToDatabase = async () => {
    if (!report) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('watchtower_daily_reports').insert({
        report_date: report.report_date,
        report_id_code: report.report_id_code,
        threat_level: report.threat_level,
        active_aircraft_count: report.stats.active_flights,
        confirmed_threats: report.stats.confirmed_threats,
        suspicious_count: report.stats.suspicious,
        monitored_count: report.stats.monitored,
        violations: report.violations as any,
        threat_database: report.threat_database as any,
        active_aircraft: report.active_aircraft as any,
        pattern_summary: report.pattern_summary as any,
        report_html: generateHTML(report),
        sha256_hash: await computeHash(JSON.stringify(report))
      });
      if (error) throw error;
      toast.success(`Report ${report.report_id_code} saved to database`);
      loadSavedReports();
    } catch (err: any) {
      if (err?.code === '23505') toast.error('Report already saved for this date/time');
      else toast.error('Failed to save report');
    } finally {
      setIsSaving(false);
    }
  };

  const computeHash = async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const getThreatColor = (level: string) => {
    switch (level) {
      case 'CONFIRMED': return 'text-red-500 border-red-500/50 bg-red-500/10';
      case 'SUSPICIOUS': return 'text-orange-400 border-orange-400/50 bg-orange-400/10';
      case 'MEDIUM': return 'text-yellow-400 border-yellow-400/50 bg-yellow-400/10';
      default: return 'text-muted-foreground border-border bg-muted/30';
    }
  };

  const getThreatBadge = (level: string) => {
    switch (level) {
      case 'CONFIRMED': return <Badge variant="destructive">CONFIRMED</Badge>;
      case 'SUSPICIOUS': return <Badge className="bg-orange-500 text-white">SUSPICIOUS</Badge>;
      case 'MEDIUM': return <Badge className="bg-yellow-500 text-black">MEDIUM</Badge>;
      default: return <Badge variant="secondary">MONITORED</Badge>;
    }
  };

  const getBannerColor = (level: string) => {
    switch (level) {
      case 'CRITICAL': return 'bg-red-600 animate-pulse';
      case 'HIGH': return 'bg-orange-500';
      case 'ELEVATED': return 'bg-yellow-600';
      default: return 'bg-green-600';
    }
  };

  const generateHTML = (r: DailyReport): string => {
    const threatBannerColor = r.threat_level === 'CRITICAL' ? '#dc2626' :
      r.threat_level === 'HIGH' ? '#ea580c' : r.threat_level === 'ELEVATED' ? '#ca8a04' : '#16a34a';

    const threatColorCSS = (level: string) =>
      level === 'CONFIRMED' ? 'color:#dc2626;font-weight:bold' :
      level === 'SUSPICIOUS' ? 'color:#f97316;font-weight:bold' :
      level === 'MEDIUM' ? 'color:#a3a3a3' : 'color:#737373';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WATCHTOWER FLIGHT INTELLIGENCE REPORT — ${r.report_id_code}</title>
<style>
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } @page { margin: 0.5in; } }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; margin: 0; padding: 32px; color: #222; font-size: 11px; background: #fff; }
  .header { text-align: center; border-bottom: 3px solid #c0392b; padding-bottom: 16px; margin-bottom: 16px; }
  .header h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: 2px; }
  .header .report-id { font-size: 14px; color: #666; }
  .header .meta { font-size: 10px; color: #888; margin-top: 4px; }
  .alert-banner { background: ${threatBannerColor}; color: white; text-align: center; padding: 12px; font-size: 14px; font-weight: bold; margin: 16px 0; letter-spacing: 1px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0; }
  .stat-box { border: 2px solid #ddd; text-align: center; padding: 12px 8px; }
  .stat-box .value { font-size: 28px; font-weight: bold; }
  .stat-box .label { font-size: 10px; color: #666; margin-top: 4px; }
  .section { border: 2px solid #ddd; margin: 16px 0; padding: 16px; }
  .section-title { font-size: 13px; font-weight: bold; margin-bottom: 12px; letter-spacing: 1px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .aircraft-card { border-left: 4px solid #999; padding: 8px 12px; margin: 8px 0; background: #fafafa; }
  .aircraft-card .reg { font-size: 13px; font-weight: bold; }
  .aircraft-card .details { font-size: 10px; color: #555; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { background: #f0f0f0; }
  .footer { margin-top: 24px; border-top: 2px solid #c0392b; padding-top: 8px; text-align: center; font-size: 9px; color: #888; }
  .kv { display: flex; justify-content: space-between; margin: 2px 0; }
  .kv .key { color: #666; }
  .kv .val { font-weight: bold; }
</style></head><body>

<div class="header">
  <h1>🛡️ WATCHTOWER FLIGHT INTELLIGENCE REPORT</h1>
  <div class="report-id">Flight Report ID: ${r.report_id_code}</div>
  <div class="meta">📅 ${new Date(r.scan_timestamp).toLocaleString()} &nbsp;|&nbsp; 📍 Bakersfield Grid (Lat: 35.4196, Long: -119.0187)</div>
  <div class="meta">Watchtower Surveillance Report | Flight Intelligence System</div>
</div>

<div class="alert-banner">🚨 ${r.threat_level === 'CRITICAL' ? 'RED' : r.threat_level} ALERT MODE: ${r.stats.confirmed_threats} CONFIRMED SURVEILLANCE AIRCRAFT ACTIVE 🚨</div>

<div class="stats-grid">
  <div class="stat-box"><div class="value">${r.stats.active_flights}</div><div class="label">Active Flights</div></div>
  <div class="stat-box"><div class="value" style="font-weight:900">${r.stats.confirmed_threats}</div><div class="label">Confirmed Threats</div></div>
  <div class="stat-box"><div class="value">${r.stats.suspicious}</div><div class="label">Suspicious</div></div>
  <div class="stat-box"><div class="value">${r.stats.monitored}</div><div class="label">Monitored</div></div>
</div>

<div class="two-col">
  <div class="section">
    <div class="section-title">📊 PATTERN ANALYSIS SUMMARY</div>
    <div class="kv"><span class="key">Grid Detections:</span><span class="val">${r.pattern_summary.grid_detections.toLocaleString()}</span></div>
    <div class="kv"><span class="key">New Flags:</span><span class="val">${r.pattern_summary.new_flags}</span></div>
    <div class="kv"><span class="key">Grid Coverage:</span><span class="val">${r.pattern_summary.grid_coverage}</span></div>
    <div class="kv"><span class="key">Last Alert:</span><span class="val">${r.pattern_summary.last_alert}</span></div>
    <div class="kv"><span class="key">Known Threats:</span><span class="val">${r.pattern_summary.known_threats}</span></div>
    ${r.threat_level === 'CRITICAL' || r.threat_level === 'HIGH' ? '<p style="color:#dc2626;font-weight:bold;margin-top:8px">⚠️ RED ALERT: Multiple confirmed surveillance aircraft detected</p>' : ''}
  </div>
  <div class="section">
    <div class="section-title">🖥️ SYSTEM STATUS</div>
    <div class="kv"><span class="key">ADS-B Feed:</span><span class="val" style="color:green">Online</span></div>
    <div class="kv"><span class="key">Data Source:</span><span class="val">NeonDB + OpenSky</span></div>
    <div class="kv"><span class="key">Grid Coverage:</span><span class="val">Oildale Sector</span></div>
    <div class="kv"><span class="key">Report Date:</span><span class="val">${r.report_date}</span></div>
    <div class="kv"><span class="key">SHA-256:</span><span class="val" style="font-size:8px;word-break:break-all">Computed on save</span></div>
  </div>
</div>

${r.violations.length > 0 ? `
<div class="section">
  <div class="section-title">🚨 ACTIVE VIOLATIONS (${r.violations.length})</div>
  <table>
    <tr><th>Registration</th><th>Type</th><th>Severity</th><th>Altitude</th><th>Details</th><th>Timestamp</th></tr>
    ${r.violations.map(v => `<tr>
      <td><strong>${v.registration}</strong></td>
      <td>${v.type}</td>
      <td style="${v.severity === 'critical' ? 'color:red;font-weight:bold' : 'color:orange'}">${v.severity.toUpperCase()}</td>
      <td>${v.altitude ? v.altitude + 'ft' : '—'}</td>
      <td>${v.details}</td>
      <td>${new Date(v.timestamp).toLocaleString()}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">✈️ ACTIVE AIRCRAFT (${r.active_aircraft.length} detected)</div>
  ${r.active_aircraft.slice(0, 30).map(a => `
    <div class="aircraft-card" style="border-color:${a.threat_level === 'CONFIRMED' ? '#dc2626' : a.threat_level === 'SUSPICIOUS' ? '#f97316' : '#999'}">
      <div class="reg" style="${threatColorCSS(a.threat_level)}">${a.registration} — ${a.threat_level}</div>
      <div class="details">ICAO: ${a.icao} | Alt: ${a.altitude}ft | Speed: ${a.speed}kts${a.aircraft_type ? ' | Type: ' + a.aircraft_type : ''}</div>
      <div class="details">⚠️ ${a.notes}</div>
    </div>
  `).join('')}
</div>

<div class="section">
  <div class="section-title">🎯 THREAT AIRCRAFT DATABASE (${r.threat_database.length} entries)</div>
  ${r.threat_database.slice(0, 20).map(t => `
    <div class="aircraft-card" style="border-color:${t.threat_level === 'CONFIRMED' ? '#dc2626' : t.threat_level === 'SUSPICIOUS' ? '#f97316' : '#999'}">
      <div class="reg" style="${threatColorCSS(t.threat_level)}">${t.registration} — ${t.threat_level}</div>
      <div class="details">${t.notes}</div>
    </div>
  `).join('')}
</div>

<div class="footer">
  <p>Generated: ${new Date(r.scan_timestamp).toLocaleString()} | Report ID: ${r.report_id_code}</p>
  <p>Watchtower Flight Intelligence System v2.0</p>
  <p>🔒 Classification: OPERATIONAL | Chain of Custody: SHA-256 Anchored</p>
</div>

</body></html>`;
  };

  const exportPDF = () => {
    if (!report) return;
    const html = generateHTML(report);
    const printWindow = window.open('', '_blank');
    if (!printWindow) { toast.error('Pop-up blocked'); return; }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
    toast.success('PDF ready — use Print > Save as PDF');
  };

  const loadSavedReport = async (reportId: string) => {
    const { data } = await supabase
      .from('watchtower_daily_reports')
      .select('*')
      .eq('id', reportId)
      .single();
    if (!data) return;

    if (data.report_html) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(data.report_html);
        printWindow.document.close();
      }
      return;
    }

    const reconstructed: DailyReport = {
      report_id_code: data.report_id_code,
      report_date: data.report_date,
      scan_timestamp: data.created_at,
      threat_level: data.threat_level as DailyReport['threat_level'],
      active_aircraft: (data.active_aircraft as any) || [],
      violations: (data.violations as any) || [],
      threat_database: (data.threat_database as any) || [],
      pattern_summary: (data.pattern_summary as any) || {},
      stats: {
        active_flights: data.active_aircraft_count,
        confirmed_threats: data.confirmed_threats,
        suspicious: data.suspicious_count,
        monitored: data.monitored_count
      }
    };
    setReport(reconstructed);
    setActiveTab('generate');
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="generate" className="flex items-center gap-1">
            <Radio className="h-4 w-4" />
            Generate Report
          </TabsTrigger>
          <TabsTrigger value="archive" className="flex items-center gap-1">
            <Database className="h-4 w-4" />
            Saved Reports ({savedReports.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-primary" />
                WATCHTOWER FLIGHT INTELLIGENCE REPORT
                <Badge variant="outline">v2.0</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Label>Report Date</Label>
                  <Input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="font-mono"
                  />
                </div>
                <Button onClick={generateReport} disabled={isGenerating}>
                  {isGenerating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                  {isGenerating ? 'Generating...' : 'Generate'}
                </Button>
                {report && (
                  <>
                    <Button variant="outline" onClick={exportPDF}>
                      <Download className="h-4 w-4 mr-1" />
                      Export PDF
                    </Button>
                    <Button variant="secondary" onClick={saveToDatabase} disabled={isSaving}>
                      {isSaving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {report && (
            <>
              <Card className={`${getBannerColor(report.threat_level)} text-white`}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-8 w-8" />
                      <div>
                        <div className="text-xl font-bold">
                          🚨 {report.threat_level} ALERT: {report.stats.confirmed_threats} CONFIRMED SURVEILLANCE AIRCRAFT
                        </div>
                        <div className="text-sm opacity-90">
                          Report {report.report_id_code} | {new Date(report.scan_timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: 'Active Flights', value: report.stats.active_flights, icon: Plane },
                  { label: 'Confirmed Threats', value: report.stats.confirmed_threats, icon: AlertTriangle },
                  { label: 'Suspicious', value: report.stats.suspicious, icon: Eye },
                  { label: 'Monitored', value: report.stats.monitored, icon: Shield }
                ].map(({ label, value, icon: Icon }) => (
                  <Card key={label}>
                    <CardContent className="py-4 text-center">
                      <Icon className="h-5 w-5 mx-auto mb-1 text-primary" />
                      <div className="text-3xl font-bold">{value}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">📊 PATTERN ANALYSIS</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Grid Detections:</span><span className="font-mono font-bold">{report.pattern_summary.grid_detections.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">New Flags:</span><span className="font-mono font-bold">{report.pattern_summary.new_flags}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Coverage:</span><span className="font-mono">{report.pattern_summary.grid_coverage}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Known Threats:</span><span className="font-mono font-bold">{report.pattern_summary.known_threats}</span></div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">🖥️ SYSTEM STATUS</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">ADS-B Feed:</span><Badge variant="outline" className="text-green-500 border-green-500/50">Online</Badge></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Data Source:</span><span className="font-mono">NeonDB + OpenSky</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Grid:</span><span className="font-mono">Oildale Sector</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Date:</span><span className="font-mono">{report.report_date}</span></div>
                  </CardContent>
                </Card>
              </div>

              {report.violations.length > 0 && (
                <Card className="border-destructive/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      ACTIVE VIOLATIONS ({report.violations.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {report.violations.map((v, i) => (
                        <div key={i} className={`p-2 rounded border ${v.severity === 'critical' ? 'border-destructive/50 bg-destructive/5' : 'border-orange-500/30 bg-orange-500/5'}`}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{v.registration}</span>
                            <Badge variant={v.severity === 'critical' ? 'destructive' : 'secondary'}>{v.severity.toUpperCase()}</Badge>
                            {v.altitude && <span className="text-xs text-muted-foreground">{v.altitude}ft</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{v.details}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Plane className="h-4 w-4 text-primary" />
                    ACTIVE AIRCRAFT ({report.active_aircraft.length} detected)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-2">
                      {report.active_aircraft.map((a, i) => (
                        <div key={i} className={`p-3 rounded-lg border ${getThreatColor(a.threat_level)}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold">{a.registration}</span>
                              {getThreatBadge(a.threat_level)}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">
                              ICAO: {a.icao} | {a.altitude}ft | {a.speed}kts
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{a.notes}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-destructive" />
                    THREAT AIRCRAFT DATABASE ({report.threat_database.length} entries)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {report.threat_database.map((t, i) => (
                        <div key={i} className={`p-2 rounded border ${getThreatColor(t.threat_level)}`}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{t.registration}</span>
                            {getThreatBadge(t.threat_level)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{t.notes}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="archive">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Saved Reports Archive
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {savedReports.map((sr) => (
                    <div
                      key={sr.id}
                      className="p-3 rounded-lg border bg-muted/30 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => loadSavedReport(sr.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Badge className={getBannerColor(sr.threat_level)}>{sr.threat_level}</Badge>
                        <div>
                          <div className="font-mono font-semibold text-sm">{sr.report_id_code}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <Calendar className="h-3 w-3" />
                            {sr.report_date}
                            <span>•</span>
                            {sr.active_aircraft_count} aircraft
                            <span>•</span>
                            {sr.confirmed_threats} threats
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(sr.created_at).toLocaleDateString()}
                        </span>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                  {savedReports.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No saved reports yet. Generate and save your first report.</p>
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

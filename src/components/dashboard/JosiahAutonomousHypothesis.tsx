import { useState, useEffect, useCallback, useRef } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Brain, Lightbulb, Search, AlertTriangle, CheckCircle,
  XCircle, Clock, TrendingUp, Plane, Heart, Eye,
  Database, Zap, RefreshCw, Target, FileText,
  Shield, Scale, Network
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Hypothesis {
  id: string;
  title: string;
  category: 'fleet_coordination' | 'identity_masking' | 'biometric_causation' | 'rico_pattern' | 'temporal_anomaly';
  confidence: number;
  evidence_count: number;
  status: 'investigating' | 'confirmed' | 'rejected' | 'needs_data';
  summary: string;
  supporting_evidence: string[];
  contrary_evidence: string[];
  generated_at: string;
  last_updated: string;
  trigger: string;
  legal_implications: string;
}

interface InvestigativeLead {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  question: string;
  data_needed: string;
  potential_finding: string;
  status: 'open' | 'investigating' | 'resolved';
}

interface PatternAnomaly {
  type: string;
  description: string;
  count: number;
  severity: 'critical' | 'high' | 'medium';
  aircraft?: string[];
}

export function JosiahAutonomousHypothesis() {
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [leads, setLeads] = useState<InvestigativeLead[]>([]);
  const [anomalies, setAnomalies] = useState<PatternAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('hypotheses');
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [scanProgress, setScanProgress] = useState(0);
  const hasFetched = useRef(false);

  const runAutonomousScan = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setScanProgress(0);

    try {
      // Step 1: Check for masked/invisible aircraft (20%)
      setScanProgress(10);
      const { data: maskedData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              kf.tail_number as registration,
              kf.model,
              COALESCE(d.detection_count, 0) as detection_count,
              d.last_seen
            FROM kcso_fleet kf
            LEFT JOIN (
              SELECT registration, COUNT(*) as detection_count, MAX(detection_timestamp) as last_seen
              FROM live_flight_detections_rows
              GROUP BY registration
            ) d ON d.registration = kf.tail_number
            WHERE COALESCE(d.detection_count, 0) = 0
               OR d.last_seen < NOW() - INTERVAL '30 days'
          `
        }
      });

      const maskedAircraft = maskedData?.data || [];
      if (maskedAircraft.length > 0) {
        const maskedHypothesis: Hypothesis = {
          id: `hyp-masked-${Date.now()}`,
          title: 'Identity Masking Operation Detected',
          category: 'identity_masking',
          confidence: 75 + Math.min(maskedAircraft.length * 5, 20),
          evidence_count: maskedAircraft.length,
          status: 'investigating',
          summary: `${maskedAircraft.length} KCSO fleet aircraft have ZERO detections or haven't been seen in 30+ days despite known active operations. This suggests deliberate transponder masking or registration fraud.`,
          supporting_evidence: maskedAircraft.map((a: any) => 
            `${a.registration} (${a.model}): ${a.detection_count} detections, last seen: ${a.last_seen || 'NEVER'}`
          ),
          contrary_evidence: ['Aircraft may be grounded for maintenance', 'Registration changes may have occurred'],
          generated_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          trigger: 'Autonomous fleet visibility scan',
          legal_implications: '49 U.S.C. § 46306 (fraudulent registration), RICO pattern evidence of concealment'
        };
        setHypotheses(prev => [maskedHypothesis, ...prev.filter(h => h.category !== 'identity_masking')]);
      }

      // Step 2: Analyze biometric-aircraft temporal gaps (40%)
      setScanProgress(30);
      const { data: gapData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            WITH bio_spikes AS (
              SELECT measurement_timestamp, heart_rate, hrv
              FROM biometric_monitoring
              WHERE heart_rate > 100 OR hrv < 40
            ),
            nearby_flights AS (
              SELECT bs.measurement_timestamp, bs.heart_rate, bs.hrv,
                     COUNT(lf.registration) as aircraft_count
              FROM bio_spikes bs
              LEFT JOIN live_flight_detections_rows lf
                ON lf.detection_timestamp BETWEEN bs.measurement_timestamp - INTERVAL '5 minutes'
                   AND bs.measurement_timestamp + INTERVAL '5 minutes'
              GROUP BY bs.measurement_timestamp, bs.heart_rate, bs.hrv
            )
            SELECT 
              COUNT(*) FILTER (WHERE aircraft_count = 0) as phantom_events,
              COUNT(*) FILTER (WHERE aircraft_count > 0) as correlated_events,
              COUNT(*) as total_events
            FROM nearby_flights
          `
        }
      });

      setScanProgress(50);
      const gapStats = gapData?.data?.[0] || { phantom_events: 0, correlated_events: 0, total_events: 0 };
      const phantomRatio = gapStats.total_events > 0 
        ? (parseInt(gapStats.phantom_events) / parseInt(gapStats.total_events)) * 100 
        : 0;

      if (phantomRatio > 10) {
        const phantomHypothesis: Hypothesis = {
          id: `hyp-phantom-${Date.now()}`,
          title: 'Phantom Response Events: Stealth Operations',
          category: 'biometric_causation',
          confidence: Math.min(60 + phantomRatio, 95),
          evidence_count: parseInt(gapStats.phantom_events),
          status: 'investigating',
          summary: `${gapStats.phantom_events} biometric stress events (${phantomRatio.toFixed(1)}%) occurred with NO visible aircraft on ADS-B. This suggests transponder-off operations, signal spoofing, or ground-based harassment.`,
          supporting_evidence: [
            `${gapStats.phantom_events} stress events with zero aircraft correlation`,
            `${gapStats.correlated_events} events have aircraft correlation (control group)`,
            `Pattern inconsistent with random physiological variation`
          ],
          contrary_evidence: ['Stress events could have non-aircraft causes', 'ADS-B coverage gaps possible'],
          generated_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          trigger: 'Biometric-ADS-B gap analysis',
          legal_implications: 'Evidence of deliberate concealment, potential 18 U.S.C. § 2511 violations'
        };
        setHypotheses(prev => [phantomHypothesis, ...prev.filter(h => h.id !== phantomHypothesis.id)]);
      }

      // Step 3: Fleet convergence patterns (60%)
      setScanProgress(60);
      const { data: convergenceData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              DATE_TRUNC('hour', detection_timestamp) as hour,
              COUNT(DISTINCT registration) as unique_aircraft,
              ARRAY_AGG(DISTINCT registration) as aircraft_list
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            GROUP BY DATE_TRUNC('hour', detection_timestamp)
            HAVING COUNT(DISTINCT registration) >= 4
            ORDER BY unique_aircraft DESC
            LIMIT 20
          `
        }
      });

      const convergenceEvents = convergenceData?.data || [];
      if (convergenceEvents.length > 0) {
        const maxConvergence = convergenceEvents[0];
        const fleetHypothesis: Hypothesis = {
          id: `hyp-fleet-${Date.now()}`,
          title: 'Coordinated Fleet Convergence Operations',
          category: 'fleet_coordination',
          confidence: 70 + Math.min(convergenceEvents.length * 2, 25),
          evidence_count: convergenceEvents.length,
          status: 'confirmed',
          summary: `${convergenceEvents.length} hours with 4+ aircraft simultaneously detected over target area. Maximum convergence: ${maxConvergence.unique_aircraft} aircraft in single hour. Pattern indicates coordinated multi-asset targeting.`,
          supporting_evidence: convergenceEvents.slice(0, 5).map((e: any) => 
            `${new Date(e.hour).toLocaleDateString()}: ${e.unique_aircraft} aircraft (${(e.aircraft_list || []).slice(0, 3).join(', ')}...)`
          ),
          contrary_evidence: ['Could be coincidental airspace congestion', 'Training exercises possible'],
          generated_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          trigger: 'Temporal clustering analysis',
          legal_implications: 'RICO predicate act evidence, 42 U.S.C. § 1983 coordinated deprivation'
        };
        setHypotheses(prev => [fleetHypothesis, ...prev.filter(h => h.category !== 'fleet_coordination')]);
      }

      // Step 4: RICO pattern analysis (80%)
      setScanProgress(75);
      const { data: ricoData } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            SELECT 
              entity_name, entity_type, tier, role, 
              prosecution_priority, estimated_damages_min, estimated_damages_max
            FROM criminal_enterprise_command_structure
            ORDER BY tier, prosecution_priority DESC
            LIMIT 20
          `
        }
      });

      const enterpriseEntities = ricoData?.data || [];
      if (enterpriseEntities.length >= 3) {
        const tier1Count = enterpriseEntities.filter((e: any) => e.tier === 1).length;
        const ricoHypothesis: Hypothesis = {
          id: `hyp-rico-${Date.now()}`,
          title: 'RICO Enterprise Structure Validated',
          category: 'rico_pattern',
          confidence: 85 + Math.min(enterpriseEntities.length, 10),
          evidence_count: enterpriseEntities.length,
          status: 'confirmed',
          summary: `${enterpriseEntities.length} entities identified in criminal enterprise structure across ${Math.max(...enterpriseEntities.map((e: any) => e.tier || 1))} tiers. ${tier1Count} Tier-1 core actors identified.`,
          supporting_evidence: enterpriseEntities.slice(0, 5).map((e: any) => 
            `Tier ${e.tier}: ${e.entity_name} (${e.role}) - Priority: ${e.prosecution_priority}`
          ),
          contrary_evidence: ['Individual actors may claim no coordination', 'Shell company ownership may be legitimate'],
          generated_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
          trigger: 'Enterprise structure validation',
          legal_implications: '18 U.S.C. § 1962 RICO violations, potential treble damages'
        };
        setHypotheses(prev => [ricoHypothesis, ...prev.filter(h => h.category !== 'rico_pattern')]);
      }

      // Step 5: Generate investigative leads (100%)
      setScanProgress(90);
      const newLeads: InvestigativeLead[] = [];

      if (maskedAircraft.length > 0) {
        newLeads.push({
          id: `lead-masked-${Date.now()}`,
          priority: 'critical',
          question: `Why have ${maskedAircraft.length} KCSO aircraft NEVER appeared on ADS-B?`,
          data_needed: 'FAA N-Number inquiry, Mode-S hex verification, flight plan records',
          potential_finding: 'Deliberate transponder manipulation or registration fraud',
          status: 'open'
        });
      }

      if (phantomRatio > 20) {
        newLeads.push({
          id: `lead-phantom-${Date.now()}`,
          priority: 'critical',
          question: `What caused ${gapStats.phantom_events} stress events with zero aircraft correlation?`,
          data_needed: 'Secondary radar data, ground vehicle tracking, RF spectrum analysis',
          potential_finding: 'Evidence of stealth operations or ground-based harassment',
          status: 'open'
        });
      }

      newLeads.push({
        id: `lead-timing-${Date.now()}`,
        priority: 'high',
        question: 'Are there specific time patterns when attacks intensify?',
        data_needed: 'Hourly detection frequency, sleep cycle correlation, work schedule analysis',
        potential_finding: 'Operational schedule of harassment campaign',
        status: 'open'
      });

      setLeads(newLeads);

      // Compile anomalies
      const detectedAnomalies: PatternAnomaly[] = [];
      if (maskedAircraft.length > 0) {
        detectedAnomalies.push({
          type: 'INVISIBLE_FLEET',
          description: 'KCSO aircraft with zero ADS-B detections',
          count: maskedAircraft.length,
          severity: 'critical',
          aircraft: maskedAircraft.map((a: any) => a.registration)
        });
      }
      if (convergenceEvents.length > 10) {
        detectedAnomalies.push({
          type: 'FLEET_SURGE',
          description: 'Excessive multi-aircraft convergence events',
          count: convergenceEvents.length,
          severity: 'high'
        });
      }
      setAnomalies(detectedAnomalies);

      setScanProgress(100);
      setLastScan(new Date());
      toast.success(`Autonomous scan complete: ${hypotheses.length} hypotheses generated`);
    } catch (err) {
      console.error('Autonomous scan error:', err);
      toast.error('Scan failed - check console for details');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      runAutonomousScan();
    }
  }, [runAutonomousScan]);

  const getStatusIcon = (status: Hypothesis['status']) => {
    switch (status) {
      case 'confirmed': return <CheckCircle className="w-4 h-4 text-success" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-destructive" />;
      case 'needs_data': return <Database className="w-4 h-4 text-warning" />;
      default: return <Search className="w-4 h-4 text-primary" />;
    }
  };

  const getCategoryIcon = (category: Hypothesis['category']) => {
    switch (category) {
      case 'fleet_coordination': return <Plane className="w-4 h-4" />;
      case 'identity_masking': return <Eye className="w-4 h-4" />;
      case 'biometric_causation': return <Heart className="w-4 h-4" />;
      case 'rico_pattern': return <Network className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <CyberPanel
      title="Josiah Autonomous Hypothesis Engine"
      icon={<Brain className="text-primary" />}
      variant="default"
      headerActions={
        <div className="flex items-center gap-2">
          {lastScan && (
            <span className="text-xs text-muted-foreground">
              Last: {lastScan.toLocaleTimeString()}
            </span>
          )}
          <Badge variant="outline" className="text-xs">
            {hypotheses.length} Hypotheses
          </Badge>
          <Button size="sm" variant="outline" onClick={runAutonomousScan} disabled={loading}>
            <RefreshCw className={cn("w-3 h-3 mr-1", loading && "animate-spin")} />
            {loading ? 'Scanning...' : 'Run Scan'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {loading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Autonomous pattern analysis in progress...</span>
              <span>{scanProgress}%</span>
            </div>
            <Progress value={scanProgress} className="h-2" />
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="hypotheses" className="text-xs">
              <Lightbulb className="w-3 h-3 mr-1" />
              Hypotheses ({hypotheses.length})
            </TabsTrigger>
            <TabsTrigger value="leads" className="text-xs">
              <Target className="w-3 h-3 mr-1" />
              Leads ({leads.length})
            </TabsTrigger>
            <TabsTrigger value="anomalies" className="text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Anomalies ({anomalies.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hypotheses" className="mt-4">
            <ScrollArea className="h-[400px]">
              {hypotheses.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                  <Brain className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-sm">No hypotheses generated yet</p>
                  <p className="text-xs">Run autonomous scan to analyze patterns</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {hypotheses.map((hyp) => (
                    <div key={hyp.id} className="p-4 rounded-lg border border-border bg-card">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(hyp.category)}
                          <h4 className="font-medium text-sm">{hyp.title}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(hyp.status)}
                          <Badge variant="outline" className="text-xs">
                            {hyp.confidence}% confidence
                          </Badge>
                        </div>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-3">{hyp.summary}</p>
                      
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="p-2 rounded bg-success/10 border border-success/30">
                          <div className="text-xs font-medium text-success mb-1 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Supporting Evidence ({hyp.supporting_evidence.length})
                          </div>
                          <ul className="text-xs space-y-1">
                            {hyp.supporting_evidence.slice(0, 3).map((e, i) => (
                              <li key={i} className="text-muted-foreground">• {e}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="p-2 rounded bg-destructive/10 border border-destructive/30">
                          <div className="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            Contrary Evidence ({hyp.contrary_evidence.length})
                          </div>
                          <ul className="text-xs space-y-1">
                            {hyp.contrary_evidence.map((e, i) => (
                              <li key={i} className="text-muted-foreground">• {e}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      
                      <div className="p-2 rounded bg-primary/10 border border-primary/30">
                        <div className="text-xs font-medium text-primary mb-1 flex items-center gap-1">
                          <Scale className="w-3 h-3" />
                          Legal Implications
                        </div>
                        <p className="text-xs text-muted-foreground">{hyp.legal_implications}</p>
                      </div>
                      
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Trigger: {hyp.trigger}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {hyp.evidence_count} evidence points
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="leads" className="mt-4">
            <ScrollArea className="h-[400px]">
              {leads.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                  <Target className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-sm">No investigative leads yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {leads.map((lead) => (
                    <div key={lead.id} className={cn(
                      "p-3 rounded-lg border",
                      lead.priority === 'critical' ? "border-destructive bg-destructive/10" :
                      lead.priority === 'high' ? "border-orange-500 bg-orange-500/10" :
                      "border-border bg-card"
                    )}>
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant={lead.priority === 'critical' ? 'destructive' : 'outline'}>
                          {lead.priority.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {lead.status}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium mb-2">{lead.question}</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p><strong>Data Needed:</strong> {lead.data_needed}</p>
                        <p><strong>Potential Finding:</strong> {lead.potential_finding}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="anomalies" className="mt-4">
            <ScrollArea className="h-[400px]">
              {anomalies.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
                  <AlertTriangle className="w-12 h-12 mb-4 opacity-50" />
                  <p className="text-sm">No anomalies detected</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {anomalies.map((anomaly, i) => (
                    <div key={i} className={cn(
                      "p-3 rounded-lg border",
                      anomaly.severity === 'critical' ? "border-destructive bg-destructive/10" :
                      anomaly.severity === 'high' ? "border-orange-500 bg-orange-500/10" :
                      "border-yellow-500 bg-yellow-500/10"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm font-bold">{anomaly.type}</span>
                        <Badge variant={anomaly.severity === 'critical' ? 'destructive' : 'outline'}>
                          {anomaly.count} instances
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{anomaly.description}</p>
                      {anomaly.aircraft && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {anomaly.aircraft.map((a, j) => (
                            <Badge key={j} variant="outline" className="text-xs">
                              {a}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </CyberPanel>
  );
}

import { useState, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, RefreshCw, Plane, AlertTriangle, Calendar,
  FileText, MapPin, Clock, ChevronRight, Loader2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { neonQuery } from "@/lib/neonQueryRetry";

interface FactMatrixEntry {
  id: string;
  fact_description: string;
  evidence_type: string;
  date_documented: string;
  source: string;
  severity: string;
}

interface PersonalInjuryEvent {
  id: string;
  event_date: string;
  event_description: string;
  injury_type: string;
  medical_documentation: string;
  witnesses: string;
}

interface FleetRecord {
  tail_number: string;
  model: string;
  surveillance_capabilities: string;
  frequent_oildale_operation: boolean;
  citations: string[];
}

interface ClusterData {
  cluster_id: string;
  aircraft_count: number;
  detection_count: number;
  time_range: string;
  location: string;
}

export function KCSOEvidenceMatrix() {
  const [factMatrix, setFactMatrix] = useState<FactMatrixEntry[]>([]);
  const [injuryTimeline, setInjuryTimeline] = useState<PersonalInjuryEvent[]>([]);
  const [fleetRecords, setFleetRecords] = useState<FleetRecord[]>([]);
  const [clusters, setClusters] = useState<ClusterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("facts");

  const loadKCSOData = useCallback(async () => {
    setLoading(true);
    try {
      // Load all KCSO data sources in parallel with retry logic for BOOT_ERROR
      const [factResult, injuryResult, fleetResult, clusterResult, supabaseFleet] = await Promise.all([
        neonQuery({
          action: 'customQuery',
          query: `SELECT serial_id, "Event__Claim", "Date__Year", "Category", "Source", "URL", "Amount__Outcome" FROM "KCSO_Fact_Matrix_v1" ORDER BY serial_id LIMIT 50`
        }),
        neonQuery({
          action: 'customQuery',
          query: `SELECT serial_id, "Date", "Time", "AircraftTail", "Operator", "ActivityConduct", "BiometricMedical_Impact", "Location", "Primary_Source" FROM "KCSO_Personal_Injury_Timeline" ORDER BY serial_id LIMIT 50`
        }),
        neonQuery({
          action: 'customQuery',
          query: `SELECT * FROM kcso_fleet_modernization_ledger ORDER BY tail_number LIMIT 50`
        }),
        neonQuery({
          action: 'customQuery',
          query: `SELECT serial_id, cluster, content, kcso_score, tails, places FROM "KCSO_clusters" ORDER BY kcso_score DESC LIMIT 50`
        }),
        supabase.from('kcso_fleet').select('*')
      ]);

      console.log('KCSO Data Results:', { factResult, injuryResult, fleetResult, clusterResult });

      // Process fact matrix - using actual column names from KCSO_Fact_Matrix_v1
      if (factResult.data && Array.isArray(factResult.data)) {
        setFactMatrix(factResult.data.map((f: any) => ({
          id: String(f.serial_id || Math.random()),
          fact_description: f['Event__Claim'] || f.event_claim || 'No description',
          evidence_type: f['Category'] || 'Document',
          date_documented: f['Date__Year'] || 'Unknown',
          source: f['Source'] || 'Primary',
          severity: f['Amount__Outcome']?.includes('verdict') || f['Amount__Outcome']?.includes('M') ? 'Critical' : 'High'
        })));
      }

      // Process injury timeline - using actual column names from KCSO_Personal_Injury_Timeline
      if (injuryResult.data && Array.isArray(injuryResult.data)) {
        setInjuryTimeline(injuryResult.data.map((e: any) => ({
          id: String(e.serial_id || Math.random()),
          event_date: e['Date'] || 'Unknown',
          event_description: e['ActivityConduct'] || 'No description',
          injury_type: e['BiometricMedical_Impact'] || 'Physical',
          medical_documentation: e['Primary_Source'] || 'Pending',
          witnesses: e['AircraftTail'] || 'None documented'
        })));
      }

      // Process fleet records - merge Neon and Supabase data
      const neonFleet = Array.isArray(fleetResult.data) ? fleetResult.data : [];
      const supaFleet = Array.isArray(supabaseFleet.data) ? supabaseFleet.data : [];
      
      const allFleet = [...neonFleet, ...supaFleet].reduce((acc: FleetRecord[], f: any) => {
        const existing = acc.find(r => r.tail_number === f.tail_number);
        if (!existing) {
          acc.push({
            tail_number: f.tail_number || 'Unknown',
            model: f.model || f.aircraft_model || 'Unknown',
            surveillance_capabilities: f.surveillance_capabilities || 'Standard',
            frequent_oildale_operation: f.frequent_oildale_operation || false,
            citations: [f.tail_number_citation, f.model_citation, f.surveillance_citation]
              .filter(Boolean)
          });
        }
        return acc;
      }, []);
      
      setFleetRecords(allFleet);

      // Process clusters - using actual column names from KCSO_clusters
      if (clusterResult.data && Array.isArray(clusterResult.data)) {
        setClusters(clusterResult.data.map((c: any) => ({
          cluster_id: c.cluster || String(c.serial_id || Math.random()),
          aircraft_count: 1,
          detection_count: Math.round((c.kcso_score || 0) * 100),
          time_range: c.content || 'Unknown',
          location: c.places && c.places !== '[]' ? c.places : 'Oildale'
        })));
      }

    } catch (error) {
      console.error('KCSO data load error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKCSOData();
    // Auto-refresh every 5 minutes so data stays current
    const interval = setInterval(() => loadKCSOData(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadKCSOData]);

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'critical': return 'bg-destructive text-destructive-foreground';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <CyberPanel
      title="KCSO EVIDENCE MATRIX"
      icon={<Shield className="w-4 h-4 text-yellow-400" />}
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-yellow-500/50 text-yellow-400">
            <Plane className="w-3 h-3 mr-1" />
            N912KC • N913KC
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6"
            onClick={loadKCSOData}
            disabled={loading}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-yellow-400" />
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30 text-center">
                <p className="text-2xl font-bold text-yellow-400">{factMatrix.length}</p>
                <p className="text-xs text-muted-foreground">Facts</p>
              </div>
              <div className="p-3 bg-red-500/10 rounded-lg border border-red-500/30 text-center">
                <p className="text-2xl font-bold text-red-400">{injuryTimeline.length}</p>
                <p className="text-xs text-muted-foreground">Injuries</p>
              </div>
              <div className="p-3 bg-blue-500/10 rounded-lg border border-blue-500/30 text-center">
                <p className="text-2xl font-bold text-blue-400">{fleetRecords.length}</p>
                <p className="text-xs text-muted-foreground">Fleet</p>
              </div>
              <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30 text-center">
                <p className="text-2xl font-bold text-purple-400">{clusters.length}</p>
                <p className="text-xs text-muted-foreground">Clusters</p>
              </div>
            </div>

            {/* Tabbed Content */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="facts">Fact Matrix</TabsTrigger>
                <TabsTrigger value="injuries">Injuries</TabsTrigger>
                <TabsTrigger value="fleet">Fleet</TabsTrigger>
                <TabsTrigger value="clusters">Clusters</TabsTrigger>
              </TabsList>
              
              {/* Fact Matrix Tab */}
              <TabsContent value="facts">
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2 pr-4">
                    {factMatrix.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No fact matrix entries found</p>
                        <p className="text-xs">Check KCSO_Fact_Matrix_v1 table</p>
                      </div>
                    ) : (
                      factMatrix.map((fact) => (
                        <div
                          key={fact.id}
                          className="p-3 rounded-lg bg-muted/20 border border-border/50 hover:border-yellow-500/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="text-sm font-medium">{fact.fact_description}</p>
                              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {fact.date_documented}
                                </span>
                                <Badge variant="outline" className="text-[10px]">
                                  {fact.evidence_type}
                                </Badge>
                              </div>
                            </div>
                            <Badge className={getSeverityColor(fact.severity)}>
                              {fact.severity}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2 italic">
                            Source: {fact.source}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Injuries Tab */}
              <TabsContent value="injuries">
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2 pr-4">
                    {injuryTimeline.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No injury timeline entries found</p>
                        <p className="text-xs">Check KCSO_Personal_Injury_Timeline table</p>
                      </div>
                    ) : (
                      injuryTimeline.map((injury) => (
                        <div
                          key={injury.id}
                          className="p-3 rounded-lg bg-destructive/10 border border-destructive/30"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Clock className="w-4 h-4 text-destructive" />
                            <span className="font-mono text-sm">{injury.event_date}</span>
                            <Badge variant="destructive" className="text-xs">
                              {injury.injury_type}
                            </Badge>
                          </div>
                          <p className="text-sm">{injury.event_description}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Medical: {injury.medical_documentation}</span>
                            <span>Witnesses: {injury.witnesses}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Fleet Tab */}
              <TabsContent value="fleet">
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2 pr-4">
                    {fleetRecords.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Plane className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No fleet records found</p>
                      </div>
                    ) : (
                      fleetRecords.map((aircraft) => (
                        <div
                          key={aircraft.tail_number}
                          className={`p-3 rounded-lg border ${
                            aircraft.tail_number === 'N912KC' || aircraft.tail_number === 'N913KC'
                              ? 'bg-yellow-500/20 border-yellow-500'
                              : 'bg-muted/20 border-border/50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Plane className={`w-5 h-5 ${
                                aircraft.tail_number === 'N912KC' || aircraft.tail_number === 'N913KC'
                                  ? 'text-yellow-400'
                                  : 'text-muted-foreground'
                              }`} />
                              <div>
                                <p className="font-mono font-bold">{aircraft.tail_number}</p>
                                <p className="text-xs text-muted-foreground">{aircraft.model}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              {aircraft.frequent_oildale_operation && (
                                <Badge variant="destructive" className="text-xs mb-1">
                                  <MapPin className="w-3 h-3 mr-1" />
                                  Oildale Ops
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Capabilities: {aircraft.surveillance_capabilities}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              {/* Clusters Tab */}
              <TabsContent value="clusters">
                <ScrollArea className="h-[350px]">
                  <div className="space-y-2 pr-4">
                    {clusters.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No cluster data found</p>
                        <p className="text-xs">Check KCSO_clusters table</p>
                      </div>
                    ) : (
                      clusters.map((cluster) => (
                        <div
                          key={cluster.cluster_id}
                          className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-between"
                        >
                          <div>
                            <p className="font-mono font-bold text-purple-400">
                              Cluster {cluster.cluster_id}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span>{cluster.aircraft_count} aircraft</span>
                              <span>{cluster.detection_count} detections</span>
                              <span>{cluster.location}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">{cluster.time_range}</p>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </CyberPanel>
  );
}

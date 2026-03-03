import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Search, Shield, Crosshair, Building2, HeartPulse, Plane, AlertTriangle, Loader2 } from "lucide-react";

interface CohortResult {
  cohort: any[];
  sensorLoitering: any[];
  highAltitude: any[];
  hammerAnvil: any[];
  shellNodes: any[];
  biometricCorrelation: any[];
  faaRegistry: any[];
  meta: {
    scanTimestamp: string;
    targetRegistrations: string[];
    cohortSize: number;
    hammerAnvilEvents: number;
    shellEntities: number;
    loiterSignatures: number;
  };
}

export function C2014CohortScanner() {
  const { toast } = useToast();
  const [results, setResults] = useState<CohortResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const runCohortScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: {
          action: 'c2014CohortScan',
          registrations: ['N528AM','N786FA','N6196P','N256AA','N789FA','N912KC','N913KC','N597E','N791FA','N790FA','N435CA','N436CA','N224AM','N229AM','N230AM']
        }
      });
      if (error) throw error;
      const result = data as CohortResult;
      if ((result as any)?.error) throw new Error((result as any).error);
      if (!result?.meta) throw new Error('No data returned from scan');
      setResults(result);
      toast({ title: "C2014 Cohort Scan Complete", description: `${result.meta.cohortSize || 0} aircraft profiled, ${result.meta.hammerAnvilEvents || 0} coordination events detected` });
    } catch (err) {
      toast({ title: "Scan failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <CyberPanel
      title="C2014 PROCUREMENT COHORT SCANNER"
      icon={<Search className="w-4 h-4" />}
      headerActions={
        <Button onClick={runCohortScan} disabled={scanning} size="sm" className="gap-2">
          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />}
          {scanning ? "Scanning..." : "Initiate Cohort Scan"}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground font-mono">
          Cross-references 2014 procurement timelines, Hammer-Anvil coordination, sensor loitering signatures, shell company nodes, and biometric correlations for the target fleet.
        </p>

        {!results && !scanning && (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">Click "Initiate Cohort Scan" to analyze the C2014 procurement fleet</p>
          </div>
        )}

        {results && (
          <div className="space-y-4">
            {/* Meta Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Fleet Profiled", value: results.meta.cohortSize, icon: Plane },
                { label: "H-A Events", value: results.meta.hammerAnvilEvents, icon: Crosshair },
                { label: "Shell Entities", value: results.meta.shellEntities, icon: Building2 },
                { label: "Loiter Sigs", value: results.meta.loiterSignatures, icon: AlertTriangle },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-muted/30 rounded p-3 border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-3 h-3 text-primary" />
                    <span className="text-[10px] text-muted-foreground uppercase">{label}</span>
                  </div>
                  <span className="text-lg font-bold text-foreground">{value}</span>
                </div>
              ))}
            </div>

            {/* Procurement Cohort */}
            {results.cohort.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-primary mb-2 flex items-center gap-2">
                  <Plane className="w-3 h-3" /> Fleet Procurement Profile
                </h3>
                <div className="overflow-x-auto max-h-[200px] border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['Reg', 'Hex', 'Operator', 'Type', 'Detections', 'Avg Alt', 'Tag', 'Shell'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-mono text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.cohort.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono font-bold text-primary">{r.registration}</td>
                          <td className="px-2 py-1 font-mono text-muted-foreground">{r.hex}</td>
                          <td className="px-2 py-1 max-w-[150px] truncate">{r.owner_operator || '—'}</td>
                          <td className="px-2 py-1">{r.aircraft_type_desc || r.aircraft_type || '—'}</td>
                          <td className="px-2 py-1 font-bold">{r.total_detections}</td>
                          <td className="px-2 py-1">{r.avg_altitude}ft</td>
                          <td className="px-2 py-1">
                            {r.taxonomy_tag && <Badge variant="outline" className="text-[9px]">{r.taxonomy_tag}</Badge>}
                          </td>
                          <td className="px-2 py-1">{r.shell_auto_detected ? '🔴' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Hammer-Anvil Coordination */}
            {results.hammerAnvil.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-destructive mb-2 flex items-center gap-2">
                  <Crosshair className="w-3 h-3" /> Hammer-Anvil Coordination Events ({results.hammerAnvil.length})
                </h3>
                <div className="overflow-x-auto max-h-[200px] border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['Time', 'Aircraft A', 'Alt A', 'Aircraft B', 'Alt B', 'Δ Alt', 'Pattern'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-mono text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.hammerAnvil.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono text-muted-foreground">{new Date(r.time_slot).toLocaleString()}</td>
                          <td className="px-2 py-1 font-mono font-bold text-primary">{r.aircraft_a}</td>
                          <td className="px-2 py-1">{r.alt_a}ft</td>
                          <td className="px-2 py-1 font-mono font-bold text-destructive">{r.aircraft_b}</td>
                          <td className="px-2 py-1">{r.alt_b}ft</td>
                          <td className="px-2 py-1 font-bold">{r.altitude_diff}ft</td>
                          <td className="px-2 py-1">
                            <Badge variant={r.pattern_type === 'HAMMER-ANVIL' ? 'destructive' : 'outline'} className="text-[9px]">
                              {r.pattern_type}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Sensor Loitering */}
            {results.sensorLoitering.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-yellow-500 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" /> Sensor Loitering Signatures ({results.sensorLoitering.length})
                </h3>
                <div className="overflow-x-auto max-h-[180px] border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['Reg', 'Operator', 'Loiter Count', 'Avg Alt', 'Avg Spd', 'Days Active'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-mono text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.sensorLoitering.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono font-bold text-yellow-500">{r.registration}</td>
                          <td className="px-2 py-1 truncate max-w-[120px]">{r.owner_operator || '—'}</td>
                          <td className="px-2 py-1 font-bold">{r.loiter_detections}</td>
                          <td className="px-2 py-1">{r.avg_alt}ft</td>
                          <td className="px-2 py-1">{r.avg_speed}kts</td>
                          <td className="px-2 py-1">{r.loiter_days}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Shell Company Nodes */}
            {results.shellNodes.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-orange-500 mb-2 flex items-center gap-2">
                  <Building2 className="w-3 h-3" /> Shell Company Network Nodes ({results.shellNodes.length})
                </h3>
                <div className="overflow-x-auto max-h-[180px] border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['Reg', 'Operator', 'Detections', 'Days', 'Tag', 'Auto-Flagged'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-mono text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.shellNodes.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono font-bold text-orange-500">{r.registration}</td>
                          <td className="px-2 py-1 truncate max-w-[150px]">{r.owner_operator}</td>
                          <td className="px-2 py-1 font-bold">{r.total_detections}</td>
                          <td className="px-2 py-1">{r.active_days}</td>
                          <td className="px-2 py-1">
                            {r.taxonomy_tag && <Badge variant="outline" className="text-[9px]">{r.taxonomy_tag}</Badge>}
                          </td>
                          <td className="px-2 py-1">{r.shell_auto_detected ? '🔴 YES' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Biometric Correlation */}
            {results.biometricCorrelation.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-red-500 mb-2 flex items-center gap-2">
                  <HeartPulse className="w-3 h-3" /> Biometric Correlations to Target Fleet
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {results.biometricCorrelation.map((r, i) => (
                    <div key={i} className="bg-muted/30 rounded p-2 border border-border">
                      <span className="font-mono text-xs font-bold text-red-500">{r.aircraft_registration}</span>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {r.correlation_count} correlations · avg score: {r.avg_score}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FAA Registry */}
            {results.faaRegistry.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-blue-500 mb-2 flex items-center gap-2">
                  <Shield className="w-3 h-3" /> FAA Registry Cross-Reference
                </h3>
                <div className="overflow-x-auto max-h-[180px] border border-border rounded">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {['N-Number', 'Registrant', 'Make/Model', 'Cert Date', 'Hex', 'State'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-mono text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.faaRegistry.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono font-bold text-blue-500">N{r.n_number}</td>
                          <td className="px-2 py-1 truncate max-w-[150px]">{r.registrant_name}</td>
                          <td className="px-2 py-1">{r.aircraft_manufacturer} {r.aircraft_model}</td>
                          <td className="px-2 py-1 font-mono">{r.certificate_issue_date || '—'}</td>
                          <td className="px-2 py-1 font-mono">{r.mode_s_hex || '—'}</td>
                          <td className="px-2 py-1">{r.registrant_state || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

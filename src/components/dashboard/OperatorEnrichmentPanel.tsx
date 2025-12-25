import { useState, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Users, RefreshCw, AlertTriangle, Loader2, Plane, 
  TrendingUp, Target, Radio, Activity, Shield, Eye
} from 'lucide-react';

interface OperatorRecord {
  registration: string;
  callsign: string;
  icao_code: string;
  appearance_count: number;
  flagged_count: number;
  avg_threat_score: number;
  avg_altitude: number;
  first_seen: string;
  last_seen: string;
  flag_rate_pct: number;
  taxonomy_tag: string;
}

interface XXBAnalysis {
  taxonomy_tag: string;
  total_records: number;
  flagged_count: number;
  avg_threat_score: number;
  avg_altitude: number;
  avg_speed: number;
  unique_aircraft: number;
  flag_rate_pct: number;
  mlat_synthetic_count: number;
  low_altitude_count: number;
  critical_threat_count: number;
}

interface FlaggedAircraft {
  registration: string;
  callsign: string;
  icao_code: string;
  taxonomy_tag: string;
  total_appearances: number;
  flagged_count: number;
  avg_threat: number;
  avg_altitude: number;
  avg_speed: number;
  first_seen: string;
  last_seen: string;
  flag_rate_pct: number;
  threat_pattern: string;
}

interface AnomalousHex {
  icao_code: string;
  registration: string;
  callsign: string;
  occurrence_count: number;
  avg_threat: number;
  hex_status: string;
}

const threatPatternColors: Record<string, string> = {
  'CRITICAL_LOW_ALT': 'bg-red-500/20 text-red-300 border-red-500/30',
  'HIGH_THREAT': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'PERSISTENT_FLAGGING': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'STANDARD': 'bg-gray-500/20 text-gray-300 border-gray-500/30',
};

const hexStatusColors: Record<string, string> = {
  'MLAT_SYNTHETIC': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'TRUNCATED': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'CORRUPTED': 'bg-red-500/20 text-red-300 border-red-500/30',
  'MISSING': 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  'VALID': 'bg-green-500/20 text-green-300 border-green-500/30',
};

export function OperatorEnrichmentPanel() {
  const [operators, setOperators] = useState<OperatorRecord[]>([]);
  const [xxbAnalysis, setXxbAnalysis] = useState<XXBAnalysis[]>([]);
  const [flaggedAircraft, setFlaggedAircraft] = useState<FlaggedAircraft[]>([]);
  const [anomalousHex, setAnomalousHex] = useState<AnomalousHex[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('operators');

  const runOperatorEnrichment = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'operatorEnrichment' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setOperators(data?.data || []);
      toast.success('Operator enrichment complete', {
        description: `Found ${data?.data?.length || 0} operator profiles`
      });
    } catch (err) {
      toast.error('Enrichment failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runXXBAnalysis = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'xxbFlightAnalysis' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setXxbAnalysis(data?.data || []);
      toast.success('XXB analysis complete', {
        description: `Analyzed ${data?.data?.length || 0} taxonomy categories`
      });
    } catch (err) {
      toast.error('XXB analysis failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getTopFlagged = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getTopFlaggedAircraft' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setFlaggedAircraft(data?.data || []);
      toast.success('Top flagged aircraft loaded', {
        description: `Found ${data?.data?.length || 0} flagged aircraft`
      });
    } catch (err) {
      toast.error('Failed to load flagged aircraft', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getAnomalousHex = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getAnomalousHexCodes' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setAnomalousHex(data?.data || []);
      toast.success('Anomalous hex codes analyzed', {
        description: `Found ${data?.data?.length || 0} anomalies`
      });
    } catch (err) {
      toast.error('Hex analysis failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const runAllAnalyses = useCallback(async () => {
    setIsLoading(true);
    toast.loading('Running comprehensive analysis...');
    
    try {
      await Promise.all([
        runOperatorEnrichment(),
        runXXBAnalysis(),
        getTopFlagged(),
        getAnomalousHex()
      ]);
      toast.success('All analyses complete');
    } catch (err) {
      toast.error('Some analyses failed');
    } finally {
      setIsLoading(false);
    }
  }, [runOperatorEnrichment, runXXBAnalysis, getTopFlagged, getAnomalousHex]);

  // Summary stats
  const totalOperators = operators.length;
  const totalFlagged = operators.reduce((acc, o) => acc + (o.flagged_count || 0), 0);
  const avgThreat = operators.length > 0 
    ? operators.reduce((acc, o) => acc + (o.avg_threat_score || 0), 0) / operators.length 
    : 0;

  return (
    <CyberPanel 
      title="OPERATOR ENRICHMENT & XXB ANALYSIS" 
      icon={<Users className="h-5 w-5" />}
      className="col-span-full"
    >
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Plane className="h-4 w-4" />
            <span className="text-xs">Operators</span>
          </div>
          <div className="text-2xl font-bold text-primary">{totalOperators}</div>
        </div>
        <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs">Flagged Events</span>
          </div>
          <div className="text-2xl font-bold text-destructive">{totalFlagged}</div>
        </div>
        <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs">Avg Threat</span>
          </div>
          <div className="text-2xl font-bold text-amber-400">{avgThreat.toFixed(1)}</div>
        </div>
        <div className="p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <Radio className="h-4 w-4" />
            <span className="text-xs">XXB Categories</span>
          </div>
          <div className="text-2xl font-bold text-cyan-400">{xxbAnalysis.length}</div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Button onClick={runAllAnalyses} disabled={isLoading} className="gap-2">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Run All Analyses
        </Button>
        <Button variant="outline" onClick={runOperatorEnrichment} disabled={isLoading} className="gap-2">
          <Users className="h-4 w-4" />
          Operator Enrichment
        </Button>
        <Button variant="outline" onClick={runXXBAnalysis} disabled={isLoading} className="gap-2">
          <Target className="h-4 w-4" />
          XXB Analysis
        </Button>
        <Button variant="outline" onClick={getTopFlagged} disabled={isLoading} className="gap-2">
          <Shield className="h-4 w-4" />
          Top Flagged
        </Button>
        <Button variant="outline" onClick={getAnomalousHex} disabled={isLoading} className="gap-2">
          <Eye className="h-4 w-4" />
          Hex Anomalies
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="operators">Operators</TabsTrigger>
          <TabsTrigger value="xxb">XXB Analysis</TabsTrigger>
          <TabsTrigger value="flagged">Top Flagged</TabsTrigger>
          <TabsTrigger value="anomalies">Hex Anomalies</TabsTrigger>
        </TabsList>

        {/* Operators Tab */}
        <TabsContent value="operators" className="space-y-4">
          {operators.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Click "Operator Enrichment" to analyze aircraft registrations</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration</TableHead>
                    <TableHead>Callsign</TableHead>
                    <TableHead>ICAO Hex</TableHead>
                    <TableHead>Appearances</TableHead>
                    <TableHead>Flagged</TableHead>
                    <TableHead>Flag Rate</TableHead>
                    <TableHead>Avg Threat</TableHead>
                    <TableHead>Taxonomy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operators.map((op, i) => (
                    <TableRow key={`${op.registration}-${i}`}>
                      <TableCell className="font-mono font-bold text-primary">
                        {op.registration || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {op.callsign || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {op.icao_code || '-'}
                      </TableCell>
                      <TableCell>{op.appearance_count}</TableCell>
                      <TableCell>
                        <Badge variant={op.flagged_count > 5 ? 'destructive' : 'secondary'}>
                          {op.flagged_count}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={op.flag_rate_pct || 0} 
                            className="w-16 h-2"
                          />
                          <span className="text-xs">{(op.flag_rate_pct || 0).toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={op.avg_threat_score >= 40 ? 'destructive' : op.avg_threat_score >= 20 ? 'default' : 'secondary'}>
                          {(op.avg_threat_score || 0).toFixed(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 rounded">
                          {op.taxonomy_tag || 'unclassified'}
                        </code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* XXB Analysis Tab */}
        <TabsContent value="xxb" className="space-y-4">
          {xxbAnalysis.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Click "XXB Analysis" to analyze taxonomy distribution</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Taxonomy Tag</TableHead>
                    <TableHead>Total Records</TableHead>
                    <TableHead>Flagged</TableHead>
                    <TableHead>Flag Rate</TableHead>
                    <TableHead>Avg Threat</TableHead>
                    <TableHead>Unique Aircraft</TableHead>
                    <TableHead>MLAT Synthetic</TableHead>
                    <TableHead>Low Alt</TableHead>
                    <TableHead>Critical</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {xxbAnalysis.map((analysis, i) => (
                    <TableRow key={`${analysis.taxonomy_tag}-${i}`}>
                      <TableCell>
                        <code className="font-mono text-primary font-bold">
                          {analysis.taxonomy_tag}
                        </code>
                      </TableCell>
                      <TableCell>{analysis.total_records}</TableCell>
                      <TableCell>
                        <Badge variant={analysis.flagged_count > 100 ? 'destructive' : 'secondary'}>
                          {analysis.flagged_count}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={analysis.flag_rate_pct || 0} 
                            className="w-16 h-2"
                          />
                          <span className="text-xs">{(analysis.flag_rate_pct || 0).toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={analysis.avg_threat_score >= 30 ? 'destructive' : 'secondary'}>
                          {analysis.avg_threat_score || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>{analysis.unique_aircraft}</TableCell>
                      <TableCell>
                        {analysis.mlat_synthetic_count > 0 && (
                          <Badge variant="outline" className="bg-purple-500/20 text-purple-300">
                            {analysis.mlat_synthetic_count}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {analysis.low_altitude_count > 0 && (
                          <Badge variant="outline" className="bg-orange-500/20 text-orange-300">
                            {analysis.low_altitude_count}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {analysis.critical_threat_count > 0 && (
                          <Badge variant="destructive">
                            {analysis.critical_threat_count}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Top Flagged Tab */}
        <TabsContent value="flagged" className="space-y-4">
          {flaggedAircraft.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Click "Top Flagged" to view most-flagged aircraft</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registration</TableHead>
                    <TableHead>Callsign</TableHead>
                    <TableHead>ICAO Hex</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Flagged</TableHead>
                    <TableHead>Flag Rate</TableHead>
                    <TableHead>Avg Threat</TableHead>
                    <TableHead>Pattern</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flaggedAircraft.map((ac, i) => (
                    <TableRow key={`${ac.registration}-${i}`}>
                      <TableCell className="font-mono font-bold text-primary">
                        {ac.registration || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {ac.callsign || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {ac.icao_code || '-'}
                      </TableCell>
                      <TableCell>{ac.total_appearances}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">{ac.flagged_count}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress 
                            value={ac.flag_rate_pct || 0} 
                            className="w-16 h-2"
                          />
                          <span className="text-xs">{(ac.flag_rate_pct || 0).toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={ac.avg_threat >= 40 ? 'destructive' : 'secondary'}>
                          {ac.avg_threat || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={threatPatternColors[ac.threat_pattern] || ''}
                        >
                          {ac.threat_pattern}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* Hex Anomalies Tab */}
        <TabsContent value="anomalies" className="space-y-4">
          {anomalousHex.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Click "Hex Anomalies" to analyze corrupted ICAO codes</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ICAO Hex</TableHead>
                    <TableHead>Registration</TableHead>
                    <TableHead>Callsign</TableHead>
                    <TableHead>Occurrences</TableHead>
                    <TableHead>Avg Threat</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anomalousHex.map((hex, i) => (
                    <TableRow key={`${hex.icao_code}-${i}`}>
                      <TableCell className="font-mono font-bold">
                        <code className={hex.hex_status === 'MLAT_SYNTHETIC' ? 'text-purple-400' : 'text-destructive'}>
                          {hex.icao_code || '(empty)'}
                        </code>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {hex.registration || '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {hex.callsign || '-'}
                      </TableCell>
                      <TableCell>{hex.occurrence_count}</TableCell>
                      <TableCell>
                        <Badge variant={hex.avg_threat >= 25 ? 'destructive' : 'secondary'}>
                          {(hex.avg_threat || 0).toFixed(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={hexStatusColors[hex.hex_status] || ''}
                        >
                          {hex.hex_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

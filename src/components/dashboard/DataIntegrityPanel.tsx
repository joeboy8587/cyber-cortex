import { useState, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Shield, 
  AlertTriangle, 
  Database, 
  RefreshCw, 
  Loader2, 
  CheckCircle2,
  XCircle,
  Activity,
  Lock,
  Unlock,
  Eye,
  Trash2,
  FileWarning
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface InjectionBatch {
  injection_time: string;
  record_count: string;
  unique_callsigns: string;
  xxb_count: string;
  earliest_detection: string;
  latest_detection: string;
}

interface BiometricGap {
  flight_date: string;
  xxb_count: string;
  bio_count: string;
  orphan_xxb: boolean;
}

interface ProvenanceStat {
  provenance_status: string;
  record_count: string;
}

interface AuditResult {
  injectionBatches: InjectionBatch[];
  biometricGaps: BiometricGap[];
  provenanceStats: ProvenanceStat[];
  dec27Analysis: any[];
  summary: {
    totalInjectionBatches: number;
    largestBatch: number;
    orphanXXBDays: number;
    dec27TotalRecords: number;
  };
}

export function DataIntegrityPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [sealingInProgress, setSealingInProgress] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<InjectionBatch | null>(null);
  const [validatedXXB, setValidatedXXB] = useState<any[] | null>(null);
  const [autoTaggerStatus, setAutoTaggerStatus] = useState<any>(null);

  const runProvenanceAudit = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'provenanceAudit' }
      });
      
      if (error) throw error;
      setAuditResult(data?.data);
      toast.success('Provenance audit complete');
    } catch (err) {
      toast.error('Audit failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sealBatch = useCallback(async (batch: InjectionBatch) => {
    setSealingInProgress(true);
    setSelectedBatch(batch);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { 
          action: 'sealSyntheticData',
          injectionTimestamp: batch.injection_time,
          sealLabel: 'SYNTHETIC_DATA_GLITCH'
        }
      });
      
      if (error) throw error;
      toast.success(`Sealed ${data?.data?.sealedCount || 0} records`, {
        description: `Marked as SYNTHETIC_DATA_GLITCH`
      });
      
      // Refresh audit
      runProvenanceAudit();
    } catch (err) {
      toast.error('Seal operation failed', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setSealingInProgress(false);
      setSelectedBatch(null);
    }
  }, [runProvenanceAudit]);

  const fetchValidatedXXB = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'getValidatedXXB', limit: 50 }
      });
      
      if (error) throw error;
      setValidatedXXB(data?.data?.records || []);
      toast.success(`Found ${data?.data?.records?.length || 0} biometric-validated XXB records`);
    } catch (err) {
      toast.error('Failed to fetch validated records');
    }
  }, []);

  const checkAutoTagger = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'disableAutoTagger' }
      });
      
      if (error) throw error;
      setAutoTaggerStatus(data?.data);
      toast.info(data?.data?.message || 'Auto-tagger check complete');
    } catch (err) {
      toast.error('Failed to check auto-tagger');
    }
  }, []);

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  return (
    <CyberPanel 
      title="DATA INTEGRITY WATCHTOWER" 
      icon={<Shield className="h-5 w-5" />}
      className="col-span-full"
    >
      <div className="space-y-4">
        {/* Action Bar */}
        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={runProvenanceAudit} 
            disabled={isLoading}
            className="bg-amber-500/20 border-amber-500/30 hover:bg-amber-500/30"
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running Audit...</>
            ) : (
              <><Shield className="h-4 w-4 mr-2" /> Run Provenance Audit</>
            )}
          </Button>
          
          <Button 
            variant="outline" 
            onClick={fetchValidatedXXB}
            className="bg-green-500/10 border-green-500/30 hover:bg-green-500/20"
          >
            <Activity className="h-4 w-4 mr-2" />
            Show Body-Truth XXB
          </Button>
          
          <Button 
            variant="outline" 
            onClick={checkAutoTagger}
          >
            <Eye className="h-4 w-4 mr-2" />
            Check Ghost Logic
          </Button>
        </div>

        {/* Summary Cards */}
        {auditResult && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
              <div className="text-xs text-red-300 uppercase">Injection Batches</div>
              <div className="text-2xl font-bold text-red-400">{auditResult.summary.totalInjectionBatches}</div>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="text-xs text-amber-300 uppercase">Largest Batch</div>
              <div className="text-2xl font-bold text-amber-400">{auditResult.summary.largestBatch.toLocaleString()}</div>
            </div>
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
              <div className="text-xs text-purple-300 uppercase">Orphan XXB Days</div>
              <div className="text-2xl font-bold text-purple-400">{auditResult.summary.orphanXXBDays}</div>
            </div>
            <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              <div className="text-xs text-cyan-300 uppercase">Dec 27 Records</div>
              <div className="text-2xl font-bold text-cyan-400">{auditResult.summary.dec27TotalRecords.toLocaleString()}</div>
            </div>
          </div>
        )}

        <Tabs defaultValue="batches" className="space-y-4">
          <TabsList className="grid grid-cols-4 w-full max-w-lg">
            <TabsTrigger value="batches">Injection Batches</TabsTrigger>
            <TabsTrigger value="gaps">Biometric Gaps</TabsTrigger>
            <TabsTrigger value="provenance">Provenance</TabsTrigger>
            <TabsTrigger value="validated">Body Truth</TabsTrigger>
          </TabsList>

          <TabsContent value="batches">
            {auditResult?.injectionBatches && auditResult.injectionBatches.length > 0 ? (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Injection Time</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead>XXB Count</TableHead>
                      <TableHead>Callsigns</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditResult.injectionBatches.map((batch, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-xs">
                          {formatTimestamp(batch.injection_time)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="font-mono">
                            {parseInt(batch.record_count).toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-purple-500/20 text-purple-300">
                            {parseInt(batch.xxb_count).toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell>{batch.unique_callsigns}</TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => sealBatch(batch)}
                            disabled={sealingInProgress}
                            className="h-7 text-xs"
                          >
                            {sealingInProgress && selectedBatch === batch ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <><Lock className="h-3 w-3 mr-1" /> Seal</>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Run the provenance audit to detect injection batches</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="gaps">
            {auditResult?.biometricGaps && auditResult.biometricGaps.length > 0 ? (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flight Date</TableHead>
                      <TableHead>XXB Records</TableHead>
                      <TableHead>Biometric Records</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditResult.biometricGaps.map((gap, idx) => (
                      <TableRow key={idx} className={gap.orphan_xxb ? 'bg-red-500/5' : ''}>
                        <TableCell className="font-mono">
                          {new Date(gap.flight_date).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-purple-500/20 text-purple-300">
                            {parseInt(gap.xxb_count).toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={gap.orphan_xxb ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}>
                            {parseInt(gap.bio_count).toLocaleString()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {gap.orphan_xxb ? (
                            <div className="flex items-center gap-1 text-red-400">
                              <XCircle className="h-4 w-4" />
                              <span className="text-xs">ORPHAN (No Body Truth)</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-green-400">
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="text-xs">VALIDATED</span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Run the provenance audit to check biometric correlation gaps</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="provenance">
            {auditResult?.provenanceStats && auditResult.provenanceStats.length > 0 ? (
              <div className="space-y-4">
                {auditResult.provenanceStats.map((stat, idx) => {
                  const count = parseInt(stat.record_count);
                  const maxCount = Math.max(...auditResult.provenanceStats.map(s => parseInt(s.record_count)));
                  const percentage = (count / maxCount) * 100;
                  
                  const getColor = (status: string) => {
                    if (status === 'SYNTHETIC_DATA_GLITCH') return 'bg-red-500';
                    if (status === 'LIVE_INGESTION') return 'bg-green-500';
                    return 'bg-amber-500';
                  };
                  
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className={
                          stat.provenance_status === 'SYNTHETIC_DATA_GLITCH' 
                            ? 'text-red-400' 
                            : stat.provenance_status === 'LIVE_INGESTION'
                            ? 'text-green-400'
                            : 'text-amber-400'
                        }>
                          {stat.provenance_status}
                        </span>
                        <span className="font-mono">{count.toLocaleString()}</span>
                      </div>
                      <Progress value={percentage} className={getColor(stat.provenance_status)} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileWarning className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Run the provenance audit to see data source breakdown</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="validated">
            {validatedXXB && validatedXXB.length > 0 ? (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Registration</TableHead>
                      <TableHead>Callsign</TableHead>
                      <TableHead>Detection Time</TableHead>
                      <TableHead>Heart Rate</TableHead>
                      <TableHead>Time Delta</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validatedXXB.map((record, idx) => (
                      <TableRow key={idx} className="bg-green-500/5">
                        <TableCell className="font-mono font-bold">
                          {record.registration || 'N/A'}
                        </TableCell>
                        <TableCell>{record.callsign || 'N/A'}</TableCell>
                        <TableCell className="text-xs">
                          {formatTimestamp(record.detection_timestamp)}
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-500/20 text-red-300">
                            {record.heart_rate} BPM
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {parseFloat(record.time_delta_minutes).toFixed(1)} min
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-green-500/20 text-green-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            BODY TRUTH
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Click "Show Body-Truth XXB" to load biometric-validated records</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Auto-Tagger Status */}
        {autoTaggerStatus && (
          <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <div className="flex items-center gap-2 mb-2">
              <Unlock className="h-5 w-5 text-cyan-400" />
              <span className="font-medium text-cyan-300">Ghost Logic Status</span>
            </div>
            <p className="text-sm text-cyan-200/80">{autoTaggerStatus.message}</p>
            {autoTaggerStatus.functions?.length > 0 && (
              <div className="mt-2">
                <span className="text-xs text-cyan-400">Found functions:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {autoTaggerStatus.functions.map((f: any, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {f.routine_name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

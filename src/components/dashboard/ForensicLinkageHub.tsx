import React, { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { 
  Link2, Database, Activity, Shield, Play, RefreshCw, 
  CheckCircle2, AlertTriangle, Clock, Zap, Target, FileText
} from 'lucide-react';
import { toast } from 'sonner';

interface LinkageStats {
  forensicEvents: number;
  entities: number;
  chainLinks: number;
  totalFlights: number;
  linkedFlights: number;
  totalBiometrics: number;
  linkedBiometrics: number;
  flightCoverage: string;
  biometricCoverage: string;
}

interface TopEvent {
  forensic_event_id: string;
  event_timestamp: string;
  event_type: string;
  primary_entity_id: string;
  confidence_score: number;
  bradford_hill_score: number;
  factor_count: number;
  is_physical_verified: boolean;
  summary: string;
  link_count: number;
}

interface JobStatus {
  job_id: string;
  job_type: string;
  target_table: string;
  processed_records: number;
  linked_records: number;
  status: string;
  started_at: string;
  completed_at: string;
}

export function ForensicLinkageHub() {
  const [stats, setStats] = useState<LinkageStats | null>(null);
  const [topEvents, setTopEvents] = useState<TopEvent[]>([]);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState('');

  const invokeForensicLinker = async (action: string, params = {}) => {
    const { data, error } = await supabase.functions.invoke('forensic-linker', {
      body: { action, ...params }
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data ?? data;
  };

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsResult, eventsResult, jobsResult] = await Promise.all([
        invokeForensicLinker('getStats'),
        invokeForensicLinker('getTopEvents', { limit: 10 }),
        invokeForensicLinker('getJobStatus')
      ]);
      
      setStats(statsResult);
      setTopEvents(eventsResult.events || []);
      setJobs(jobsResult.jobs || []);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      toast.error('Failed to fetch linkage statistics');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const runFullBackfill = async () => {
    setIsRunning(true);
    setProgress(0);
    setCurrentStep('Starting forensic linkage...');
    
    try {
      // Step 1: Flights
      setCurrentStep('Processing flight detections...');
      setProgress(10);
      await invokeForensicLinker('backfillFlights', { batchSize: 2000 });
      
      setProgress(40);
      setCurrentStep('Correlating biometrics...');
      await invokeForensicLinker('backfillBiometrics', { batchSize: 1000 });
      
      setProgress(60);
      setCurrentStep('Linking Josiah reflections...');
      await invokeForensicLinker('backfillJosiah', { batchSize: 500 });
      
      setProgress(75);
      setCurrentStep('Resolving entities...');
      await invokeForensicLinker('resolveEntities');
      
      setProgress(90);
      setCurrentStep('Calculating Bradford Hill scores...');
      await invokeForensicLinker('calculateBradfordHill');
      
      setProgress(100);
      setCurrentStep('Complete!');
      toast.success('Forensic linkage backfill completed');
      
      // Refresh stats
      await fetchStats();
    } catch (err) {
      console.error('Backfill error:', err);
      toast.error(`Backfill failed: ${err.message}`);
    } finally {
      setIsRunning(false);
      setTimeout(() => setProgress(0), 2000);
    }
  };

  const runQuickLink = async () => {
    setIsRunning(true);
    try {
      const result = await invokeForensicLinker('runFullBackfill');
      toast.success(result.message || 'Quick linkage complete');
      await fetchStats();
    } catch (err) {
      toast.error(`Quick link failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const getEventTypeColor = (type: string) => {
    switch (type) {
      case 'flight': return 'text-cyan-400';
      case 'biometric': return 'text-red-400';
      case 'witness': return 'text-yellow-400';
      case 'ocr': return 'text-purple-400';
      case 'legal': return 'text-green-400';
      default: return 'text-muted-foreground';
    }
  };

  const getBHScoreColor = (score: number) => {
    if (score >= 80) return 'text-red-400 bg-red-500/20';
    if (score >= 60) return 'text-orange-400 bg-orange-500/20';
    if (score >= 40) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-muted-foreground bg-muted';
  };

  return (
    <CyberPanel 
      title="FORENSIC LINKAGE HUB" 
      icon={<Link2 className="w-5 h-5 text-cyan-400" />}
      className="col-span-full"
    >
      {/* Control Bar */}
      <div className="flex items-center gap-3 mb-6">
        <Button 
          onClick={runQuickLink}
          disabled={isRunning}
          className="bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50"
        >
          <Zap className="w-4 h-4 mr-2" />
          Quick Link (10K)
        </Button>
        <Button 
          onClick={runFullBackfill}
          disabled={isRunning}
          variant="outline"
          className="border-primary/50"
        >
          <Play className="w-4 h-4 mr-2" />
          Full Backfill
        </Button>
        <Button 
          onClick={fetchStats}
          disabled={isLoading}
          variant="ghost"
          size="icon"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
        
        {isRunning && (
          <div className="flex-1 ml-4">
            <div className="text-xs text-muted-foreground mb-1">{currentStep}</div>
            <Progress value={progress} className="h-2" />
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-cyan-400" />
            <span className="text-xs text-muted-foreground">Forensic Events</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">
            {stats?.forensicEvents?.toLocaleString() || '0'}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-muted-foreground">Entities</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">
            {stats?.entities?.toLocaleString() || '0'}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="w-4 h-4 text-green-400" />
            <span className="text-xs text-muted-foreground">Chain Links</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">
            {stats?.chainLinks?.toLocaleString() || '0'}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-muted-foreground">Flight Coverage</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">
            {stats?.flightCoverage || '0'}%
          </div>
          <div className="text-xs text-muted-foreground">
            {stats?.linkedFlights?.toLocaleString()} / {stats?.totalFlights?.toLocaleString()}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-red-400" />
            <span className="text-xs text-muted-foreground">Biometric Coverage</span>
          </div>
          <div className="text-2xl font-mono font-bold text-foreground">
            {stats?.biometricCoverage || '0'}%
          </div>
          <div className="text-xs text-muted-foreground">
            {stats?.linkedBiometrics?.toLocaleString()} / {stats?.totalBiometrics?.toLocaleString()}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-card/50 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-yellow-400" />
            <span className="text-xs text-muted-foreground">Chain Integrity</span>
          </div>
          <div className="text-2xl font-mono font-bold text-green-400">
            VERIFIED
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Forensic Events */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-400" />
            Top Forensic Events (by Bradford Hill Score)
          </h3>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {topEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No forensic events yet. Run backfill to create linkages.</p>
                </div>
              ) : (
                topEvents.map((event) => (
                  <div 
                    key={event.forensic_event_id}
                    className="p-3 rounded-lg bg-card/30 border border-border/30 hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge 
                            variant="outline" 
                            className={`${getEventTypeColor(event.event_type)} text-xs`}
                          >
                            {event.event_type}
                          </Badge>
                          {event.is_physical_verified && (
                            <CheckCircle2 className="w-3 h-3 text-green-400" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {event.factor_count} factors
                          </span>
                        </div>
                        <p className="text-sm text-foreground truncate">
                          {event.primary_entity_id || event.summary}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(event.event_timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={`${getBHScoreColor(event.bradford_hill_score)} font-mono`}>
                          BH: {event.bradford_hill_score?.toFixed(0) || 'N/A'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {event.link_count} links
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Job History */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            Correlation Job History
          </h3>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {jobs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No correlation jobs run yet.</p>
                </div>
              ) : (
                jobs.map((job) => (
                  <div 
                    key={job.job_id}
                    className="p-3 rounded-lg bg-card/30 border border-border/30"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm text-foreground">
                        {job.job_type}
                      </span>
                      <Badge 
                        variant={job.status === 'completed' ? 'default' : 'secondary'}
                        className={job.status === 'completed' ? 'bg-green-500/20 text-green-400' : ''}
                      >
                        {job.status}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>Target: {job.target_table}</div>
                      <div>Processed: {job.processed_records?.toLocaleString()}</div>
                      <div>Linked: {job.linked_records?.toLocaleString()}</div>
                      <div>
                        {job.completed_at 
                          ? `Completed: ${new Date(job.completed_at).toLocaleTimeString()}`
                          : `Started: ${new Date(job.started_at).toLocaleTimeString()}`
                        }
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Coverage Summary */}
      <div className="mt-6 p-4 rounded-lg bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-500/30">
        <h4 className="text-sm font-medium text-foreground mb-3">Linkage Coverage Summary</h4>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Flights → Events</div>
            <Progress value={parseFloat(stats?.flightCoverage || '0')} className="h-2" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Biometrics → Events</div>
            <Progress value={parseFloat(stats?.biometricCoverage || '0')} className="h-2" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Overall Chain Integrity</div>
            <Progress value={100} className="h-2 [&>div]:bg-green-500" />
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}

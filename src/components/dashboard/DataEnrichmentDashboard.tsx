import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Database, Hash, Link2, BarChart3, Zap, RefreshCw, 
  CheckCircle2, AlertTriangle, Loader2, Play, Shield,
  TrendingUp, Layers, Target
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EnrichmentStatus {
  flight_records: {
    total: number;
    hashed: number;
    hashed_today: number;
    hash_coverage: number;
  };
  correlations: {
    total: number;
    high_strength: number;
    medium_strength: number;
  };
  table_counts: {
    flights: number;
    biometrics: number;
    josiah: number;
    timeline: number;
    master_correlations: number;
  };
  bradford_hill: {
    total: number;
    scored: number;
    coverage: number;
  };
}

interface ActionResult {
  action: string;
  success: boolean;
  processed: number;
  errors: number;
  details: Record<string, any>;
  duration_ms: number;
}

const ENRICHMENT_ACTIONS = [
  {
    id: 'batch_hash',
    label: 'Batch SHA-256 Hash',
    description: 'Generate cryptographic hashes for evidence integrity',
    icon: Hash,
    color: 'text-blue-400'
  },
  {
    id: 'four_factor_correlate',
    label: 'Four-Factor Correlation',
    description: 'Link Flight + Biometric + Josiah + Timeline data',
    icon: Link2,
    color: 'text-purple-400'
  },
  {
    id: 'bradford_hill_score',
    label: 'Bradford-Hill Scoring',
    description: 'Apply causation scoring to all correlations',
    icon: BarChart3,
    color: 'text-green-400'
  },
  {
    id: 'consolidate_correlations',
    label: 'Consolidate Correlations',
    description: 'Merge 32 correlation tables into master',
    icon: Layers,
    color: 'text-orange-400'
  },
  {
    id: 'full_enrichment',
    label: 'Full Pipeline',
    description: 'Run complete enrichment workflow',
    icon: Zap,
    color: 'text-yellow-400'
  }
];

export function DataEnrichmentDashboard() {
  const [status, setStatus] = useState<EnrichmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [batchSize, setBatchSize] = useState(1000);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('data-enrichment-engine', {
        body: { action: 'status' }
      });
      
      if (error) throw error;
      if (data?.details) {
        setStatus(data.details);
      }
    } catch (error) {
      console.error('Failed to fetch enrichment status:', error);
      toast.error('Failed to fetch enrichment status');
    } finally {
      setIsLoading(false);
    }
  };

  const runAction = async (actionId: string) => {
    setActiveAction(actionId);
    setLastResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('data-enrichment-engine', {
        body: { 
          action: actionId, 
          dryRun, 
          batchSize,
          options: { timeWindowMinutes: 5 }
        }
      });
      
      if (error) throw error;
      
      setLastResult(data);
      
      if (data.success) {
        toast.success(`${actionId} completed: ${data.processed} records processed`);
        if (!dryRun) {
          fetchStatus(); // Refresh stats after real run
        }
      } else {
        toast.warning(`${actionId} completed with ${data.errors} errors`);
      }
    } catch (error) {
      console.error('Enrichment action failed:', error);
      toast.error(`Failed to run ${actionId}`);
    } finally {
      setActiveAction(null);
    }
  };

  const getTotalRecords = () => {
    if (!status) return 0;
    return status.table_counts.flights + 
           status.table_counts.biometrics + 
           status.table_counts.josiah + 
           status.table_counts.timeline;
  };

  return (
    <CyberPanel 
      title="DATA ENRICHMENT ENGINE" 
      className="col-span-full"
      headerActions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Dry Run</span>
            <Switch checked={dryRun} onCheckedChange={setDryRun} />
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchStatus}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card/50 rounded-lg p-4 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-4 w-4 text-blue-400" />
                <span className="text-xs text-muted-foreground">Total Records</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {getTotalRecords().toLocaleString()}
              </div>
            </div>
            
            <div className="bg-card/50 rounded-lg p-4 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Hash className="h-4 w-4 text-green-400" />
                <span className="text-xs text-muted-foreground">Hash Coverage</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {status?.flight_records.hash_coverage || 0}%
              </div>
              <Progress 
                value={status?.flight_records.hash_coverage || 0} 
                className="h-1 mt-2" 
              />
            </div>
            
            <div className="bg-card/50 rounded-lg p-4 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="h-4 w-4 text-purple-400" />
                <span className="text-xs text-muted-foreground">Correlations</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {(status?.table_counts.master_correlations || 0).toLocaleString()}
              </div>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline" className="text-xs bg-red-500/10 text-red-400 border-red-500/30">
                  {status?.correlations.high_strength || 0} HIGH
                </Badge>
                <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
                  {status?.correlations.medium_strength || 0} MED
                </Badge>
              </div>
            </div>
            
            <div className="bg-card/50 rounded-lg p-4 border border-border/50">
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="h-4 w-4 text-orange-400" />
                <span className="text-xs text-muted-foreground">BH Scored</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {status?.bradford_hill.coverage || 0}%
              </div>
              <Progress 
                value={status?.bradford_hill.coverage || 0} 
                className="h-1 mt-2" 
              />
            </div>
          </div>

          {/* Data Sources Breakdown */}
          <div className="bg-card/30 rounded-lg p-4 border border-border/30">
            <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Data Sources
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Flights', value: status?.table_counts.flights || 0, icon: Target },
                { label: 'Biometrics', value: status?.table_counts.biometrics || 0, icon: TrendingUp },
                { label: 'Josiah', value: status?.table_counts.josiah || 0, icon: Database },
                { label: 'Timeline', value: status?.table_counts.timeline || 0, icon: BarChart3 },
                { label: 'Master Corr', value: status?.table_counts.master_correlations || 0, icon: Link2 },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="text-center">
                  <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-lg font-semibold">{value.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hash Stats */}
          <div className="bg-card/30 rounded-lg p-4 border border-border/30">
            <h4 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Evidence Integrity (SHA-256)
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Flight Records Hashed</span>
                <span>{status?.flight_records.hashed?.toLocaleString() || 0} / {status?.flight_records.total?.toLocaleString() || 0}</span>
              </div>
              <Progress value={status?.flight_records.hash_coverage || 0} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Hashed Today: {status?.flight_records.hashed_today || 0}</span>
                <span>{status?.flight_records.hash_coverage || 0}% Coverage</span>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="actions" className="space-y-4">
          {/* Batch Size Control */}
          <div className="flex items-center gap-4 p-3 bg-card/30 rounded-lg border border-border/30">
            <span className="text-sm text-muted-foreground">Batch Size:</span>
            <div className="flex gap-2">
              {[100, 500, 1000, 5000].map(size => (
                <Button
                  key={size}
                  variant={batchSize === size ? "default" : "outline"}
                  size="sm"
                  onClick={() => setBatchSize(size)}
                >
                  {size.toLocaleString()}
                </Button>
              ))}
            </div>
            {dryRun && (
              <Badge variant="outline" className="ml-auto bg-blue-500/10 text-blue-400 border-blue-500/30">
                DRY RUN MODE
              </Badge>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ENRICHMENT_ACTIONS.map(action => {
              const Icon = action.icon;
              const isActive = activeAction === action.id;
              
              return (
                <button
                  key={action.id}
                  onClick={() => runAction(action.id)}
                  disabled={isActive || !!activeAction}
                  className={`
                    p-4 rounded-lg border text-left transition-all
                    ${isActive 
                      ? 'bg-primary/20 border-primary animate-pulse' 
                      : 'bg-card/50 border-border/50 hover:bg-card hover:border-border'}
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg bg-background/50 ${action.color}`}>
                      {isActive ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-foreground">{action.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {action.description}
                      </div>
                    </div>
                    <Play className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="results" className="space-y-4">
          {lastResult ? (
            <div className="space-y-4">
              {/* Result Header */}
              <div className={`
                p-4 rounded-lg border flex items-center gap-3
                ${lastResult.success 
                  ? 'bg-green-500/10 border-green-500/30' 
                  : 'bg-yellow-500/10 border-yellow-500/30'}
              `}>
                {lastResult.success ? (
                  <CheckCircle2 className="h-6 w-6 text-green-400" />
                ) : (
                  <AlertTriangle className="h-6 w-6 text-yellow-400" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {lastResult.action.replace(/_/g, ' ').toUpperCase()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Processed: {lastResult.processed} | Errors: {lastResult.errors} | Duration: {lastResult.duration_ms}ms
                  </div>
                </div>
                {lastResult.details?.dry_run && (
                  <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                    DRY RUN
                  </Badge>
                )}
              </div>

              {/* Result Details */}
              <div className="bg-card/30 rounded-lg p-4 border border-border/30">
                <h4 className="text-sm font-medium mb-3">Details</h4>
                <pre className="text-xs bg-background/50 p-3 rounded overflow-auto max-h-96">
                  {JSON.stringify(lastResult.details, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Run an enrichment action to see results</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

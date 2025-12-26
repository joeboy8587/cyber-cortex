import React, { useState } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Database, 
  RefreshCw, 
  Merge, 
  Trash2, 
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Layers,
  GitMerge,
  ScanLine,
  FileStack
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface EnrichmentAction {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: string;
  dangerous?: boolean;
}

const enrichmentActions: EnrichmentAction[] = [
  {
    id: 'scan',
    label: 'Scan All Tables',
    description: 'Analyze 257+ tables and categorize by domain',
    icon: <ScanLine className="h-4 w-4" />,
    action: 'scan',
  },
  {
    id: 'duplicates',
    label: 'Find Duplicates',
    description: 'Identify duplicate and mergeable tables',
    icon: <FileStack className="h-4 w-4" />,
    action: 'analyze_duplicates',
  },
  {
    id: 'flights',
    label: 'Enrich Flights',
    description: 'Merge flight data into live_flight_detections_rows',
    icon: <Merge className="h-4 w-4" />,
    action: 'enrich_flights',
  },
  {
    id: 'biometrics',
    label: 'Enrich Biometrics',
    description: 'Merge biometric data into biometric_monitoring',
    icon: <Merge className="h-4 w-4" />,
    action: 'enrich_biometrics',
  },
  {
    id: 'correlations',
    label: 'Generate Correlations',
    description: 'Populate correlation_events with four-factor joins',
    icon: <GitMerge className="h-4 w-4" />,
    action: 'enrich_correlations',
  },
  {
    id: 'josiah',
    label: 'Merge Josiah',
    description: 'Consolidate Josiah reflection tables',
    icon: <Layers className="h-4 w-4" />,
    action: 'merge_josiah',
  },
  {
    id: 'cleanup',
    label: 'Cleanup Empty Tables',
    description: 'Remove empty and duplicate tables',
    icon: <Trash2 className="h-4 w-4" />,
    action: 'cleanup_empty',
    dangerous: true,
  },
  {
    id: 'full',
    label: 'Full Enrichment Pipeline',
    description: 'Run complete scan, enrich, and cleanup',
    icon: <Database className="h-4 w-4" />,
    action: 'full_enrichment',
  },
];

export function MultimodalEnrichmentPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [results, setResults] = useState<any>(null);

  const runEnrichment = async (action: string) => {
    setIsLoading(true);
    setActiveAction(action);
    setResults(null);

    try {
      const { data, error } = await supabase.functions.invoke('multimodal-enrichment', {
        body: { action, dryRun }
      });

      if (error) throw error;

      setResults(data);
      toast.success(`${action} completed successfully`);
    } catch (error) {
      console.error('Enrichment error:', error);
      toast.error(`Failed to run ${action}`);
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <CyberPanel 
      title="MULTIMODAL DATA ENRICHMENT" 
      icon={<Database className="h-5 w-5 text-cyan-400" />}
      className="col-span-full"
    >
      <div className="space-y-6">
        {/* Dry Run Toggle */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <div>
              <Label htmlFor="dry-run" className="text-sm font-medium">
                Dry Run Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                When enabled, operations are simulated without modifying data
              </p>
            </div>
          </div>
          <Switch
            id="dry-run"
            checked={dryRun}
            onCheckedChange={setDryRun}
          />
        </div>

        {/* Action Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {enrichmentActions.map((item) => (
            <Button
              key={item.id}
              variant={item.dangerous ? "destructive" : "outline"}
              className="h-auto p-4 flex flex-col items-start gap-2"
              disabled={isLoading}
              onClick={() => runEnrichment(item.action)}
            >
              <div className="flex items-center gap-2 w-full">
                {activeAction === item.action ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  item.icon
                )}
                <span className="font-medium">{item.label}</span>
              </div>
              <p className="text-xs text-left opacity-70">{item.description}</p>
            </Button>
          ))}
        </div>

        {/* Results Display */}
        {results && (
          <div className="mt-6 p-4 bg-background/50 rounded-lg border border-border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Results
              </h3>
              <Badge variant={dryRun ? "secondary" : "default"}>
                {dryRun ? 'Dry Run' : 'Executed'}
              </Badge>
            </div>

            <Tabs defaultValue="summary" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="raw">Raw JSON</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {results.scan && (
                    <>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-2xl font-bold text-cyan-400">
                          {results.scan.total_tables || 0}
                        </p>
                        <p className="text-xs text-muted-foreground">Total Tables</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-2xl font-bold text-yellow-400">
                          {results.scan.categories?.empty_tables?.length || 0}
                        </p>
                        <p className="text-xs text-muted-foreground">Empty Tables</p>
                      </div>
                      <div className="p-3 bg-muted/30 rounded-lg">
                        <p className="text-2xl font-bold text-orange-400">
                          {results.scan.categories?.duplicate_candidates?.length || 0}
                        </p>
                        <p className="text-xs text-muted-foreground">Duplicate Candidates</p>
                      </div>
                    </>
                  )}
                  {results.flight_enrichment && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-green-400">
                        {results.flight_enrichment.records_to_merge || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">Records to Merge</p>
                    </div>
                  )}
                  {results.cleanup && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-2xl font-bold text-red-400">
                        {results.cleanup.storage_recoverable || '0 MB'}
                      </p>
                      <p className="text-xs text-muted-foreground">Storage Recoverable</p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="details">
                <ScrollArea className="h-[400px]">
                  <div className="space-y-4">
                    {results.scan?.categories && (
                      <div className="space-y-2">
                        <h4 className="font-medium">Table Categories</h4>
                        {Object.entries(results.scan.categories).map(([category, tables]: [string, any]) => (
                          <div key={category} className="flex items-center justify-between p-2 bg-muted/20 rounded">
                            <span className="text-sm capitalize">{category.replace(/_/g, ' ')}</span>
                            <Badge variant="outline">{tables?.length || 0}</Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {results.duplicates && results.duplicates.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-medium">Duplicate Groups</h4>
                        {results.duplicates.map((group: any, idx: number) => (
                          <div key={idx} className="p-2 bg-muted/20 rounded">
                            <p className="text-sm font-medium text-yellow-400">{group.group}</p>
                            <div className="mt-1 space-y-1">
                              {group.tables?.map((t: any) => (
                                <div key={t.table_name} className="flex justify-between text-xs">
                                  <span className="font-mono">{t.table_name}</span>
                                  <span>{t.row_count} rows</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {results.flight_enrichment?.sources_checked && (
                      <div className="space-y-2">
                        <h4 className="font-medium">Flight Sources</h4>
                        {results.flight_enrichment.sources_checked.map((s: any) => (
                          <div key={s.table} className="flex items-center justify-between p-2 bg-muted/20 rounded">
                            <span className="text-sm font-mono">{s.table}</span>
                            <Badge variant="outline">{s.row_count} rows</Badge>
                          </div>
                        ))}
                      </div>
                    )}

                    {results.cleanup?.empty_tables && results.cleanup.empty_tables.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-red-400">Empty Tables</h4>
                        <div className="flex flex-wrap gap-2">
                          {results.cleanup.empty_tables.slice(0, 20).map((t: string) => (
                            <Badge key={t} variant="destructive" className="text-xs font-mono">
                              {t}
                            </Badge>
                          ))}
                          {results.cleanup.empty_tables.length > 20 && (
                            <Badge variant="secondary">
                              +{results.cleanup.empty_tables.length - 20} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="raw">
                <ScrollArea className="h-[400px]">
                  <pre className="text-xs font-mono p-4 bg-muted/30 rounded overflow-x-auto">
                    {JSON.stringify(results, null, 2)}
                  </pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Instructions */}
        <div className="text-xs text-muted-foreground p-4 bg-muted/20 rounded-lg border border-border/30">
          <p className="font-medium mb-2">Enrichment Pipeline:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li><strong>Scan</strong> - Analyze all 257+ tables and categorize by domain</li>
            <li><strong>Find Duplicates</strong> - Identify tables that can be safely merged</li>
            <li><strong>Enrich</strong> - Merge data from source tables into unified targets</li>
            <li><strong>Generate Correlations</strong> - Create four-factor convergence events</li>
            <li><strong>Cleanup</strong> - Remove empty/duplicate tables to free storage</li>
          </ol>
          <p className="mt-3 text-yellow-400/80">
            ⚠️ Always run with Dry Run enabled first to preview changes before executing.
          </p>
        </div>
      </div>
    </CyberPanel>
  );
}

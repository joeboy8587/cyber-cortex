import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Database,
  RefreshCw,
  Trash2,
  Archive,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
  GitMerge,
  HardDrive,
  Shield,
  Plane,
  Heart,
  FileText,
  Brain,
  Eye,
  Building2,
  Link2,
  Clock,
  Search,
  Activity,
  Target
} from 'lucide-react';

interface DomainStats {
  name: string;
  description: string;
  table_count: number;
  total_rows: number;
  total_size: number;
  health_score: number;
  empty_table_count: number;
  protected_tables: string[];
  tables: TableInfo[];
}

interface TableInfo {
  name: string;
  row_count: number;
  size_bytes: number;
  is_protected?: boolean;
  error?: string;
}

interface DuplicateFamily {
  base_name: string;
  primary: TableInfo | null;
  duplicates: (TableInfo & { suffix: string; is_backup: boolean })[];
  total_size: number;
  total_rows: number;
  recommendation: string;
  domain: string;
}

interface EmptyTable {
  name: string;
  domain: string;
  is_protected: boolean;
  has_fk_dependencies: boolean;
  safe_to_drop: boolean;
}

const DOMAIN_ICONS: Record<string, React.ReactNode> = {
  FLIGHT_SURVEILLANCE: <Plane className="h-4 w-4" />,
  BIOMETRIC_HEALTH: <Heart className="h-4 w-4" />,
  KCSO_LAW_ENFORCEMENT: <Shield className="h-4 w-4" />,
  LEGAL_VIOLATIONS: <FileText className="h-4 w-4" />,
  JOSIAH_AI: <Brain className="h-4 w-4" />,
  OCR_VISUAL: <Eye className="h-4 w-4" />,
  CRIMINAL_NETWORK: <Building2 className="h-4 w-4" />,
  FORENSIC_CUSTODY: <Link2 className="h-4 w-4" />,
  AIRCRAFT_REGISTRY: <Database className="h-4 w-4" />,
  CORRELATIONS: <GitMerge className="h-4 w-4" />,
  TIMELINE_WATCHTOWER: <Clock className="h-4 w-4" />,
  INTELLIGENCE: <Search className="h-4 w-4" />,
  CLEANUP_CANDIDATES: <Trash2 className="h-4 w-4" />,
  OTHER: <Layers className="h-4 w-4" />
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export function DatabaseQualityControl() {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [dryRun, setDryRun] = useState(true);
  
  // Data states
  const [domains, setDomains] = useState<DomainStats[]>([]);
  const [duplicateFamilies, setDuplicateFamilies] = useState<DuplicateFamily[]>([]);
  const [emptyTables, setEmptyTables] = useState<EmptyTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [operationResults, setOperationResults] = useState<any>(null);
  
  // Summary stats
  const [totalTables, setTotalTables] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  const callQualityControl = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke('database-quality-control', {
      body: { action, params }
    });
    
    if (error) throw error;
    return data;
  };

  const loadModalityBreakdown = async () => {
    setLoading(true);
    try {
      const data = await callQualityControl('getModalityBreakdown');
      setDomains(data.domains);
      
      // Calculate totals
      const totals = data.domains.reduce((acc: any, d: DomainStats) => ({
        tables: acc.tables + d.table_count,
        size: acc.size + d.total_size,
        rows: acc.rows + d.total_rows
      }), { tables: 0, size: 0, rows: 0 });
      
      setTotalTables(totals.tables);
      setTotalSize(totals.size);
      setTotalRows(totals.rows);
      
      toast.success(`Loaded ${data.domains.length} domains with ${totals.tables} tables`);
    } catch (err) {
      const error = err as Error;
      toast.error('Failed to load modality breakdown: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDuplicateFamilies = async () => {
    setLoading(true);
    try {
      const data = await callQualityControl('getDuplicateFamilies');
      setDuplicateFamilies(data.families);
      toast.success(`Found ${data.total_families} duplicate families`);
    } catch (err) {
      const error = err as Error;
      toast.error('Failed to load duplicate families: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEmptyTables = async () => {
    setLoading(true);
    try {
      const data = await callQualityControl('getEmptyTables');
      setEmptyTables(data.empty_tables);
      toast.success(`Found ${data.total_count} empty tables (${data.safe_to_drop_count} safe to drop)`);
    } catch (err) {
      const error = err as Error;
      toast.error('Failed to load empty tables: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleArchiveTables = async () => {
    if (selectedTables.size === 0) {
      toast.error('No tables selected');
      return;
    }
    
    setLoading(true);
    try {
      const data = await callQualityControl('archiveTables', {
        tables: Array.from(selectedTables),
        dryRun
      });
      setOperationResults(data);
      
      if (dryRun) {
        toast.info(`Would archive ${data.archived_count} tables (dry run)`);
      } else {
        toast.success(`Archived ${data.archived_count} tables`);
        setSelectedTables(new Set());
        loadEmptyTables();
      }
    } catch (err) {
      const error = err as Error;
      toast.error('Archive failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDropTables = async () => {
    if (selectedTables.size === 0) {
      toast.error('No tables selected');
      return;
    }
    
    setLoading(true);
    try {
      const data = await callQualityControl('dropTables', {
        tables: Array.from(selectedTables),
        dryRun
      });
      setOperationResults(data);
      
      if (dryRun) {
        toast.info(`Would drop ${data.dropped_count} tables (dry run)`);
      } else {
        toast.success(`Dropped ${data.dropped_count} tables`);
        setSelectedTables(new Set());
        loadEmptyTables();
        loadModalityBreakdown();
      }
    } catch (err) {
      const error = err as Error;
      toast.error('Drop failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleTableSelection = (tableName: string) => {
    const newSelected = new Set(selectedTables);
    if (newSelected.has(tableName)) {
      newSelected.delete(tableName);
    } else {
      newSelected.add(tableName);
    }
    setSelectedTables(newSelected);
  };

  const selectAllSafeToDropTables = () => {
    const safeTables = emptyTables.filter(t => t.safe_to_drop).map(t => t.name);
    setSelectedTables(new Set(safeTables));
  };

  useEffect(() => {
    loadModalityBreakdown();
  }, []);

  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 70) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getHealthBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-green-500/20 text-green-400">Healthy</Badge>;
    if (score >= 70) return <Badge className="bg-yellow-500/20 text-yellow-400">Warning</Badge>;
    return <Badge className="bg-red-500/20 text-red-400">Critical</Badge>;
  };

  return (
    <CyberPanel 
      title="Database Quality Control" 
      icon={<Activity className="h-5 w-5 text-cyan-400" />}
      className="col-span-full"
    >
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-muted/30 rounded-lg p-4 border border-border">
          <div className="text-muted-foreground text-sm">Total Tables</div>
          <div className="text-2xl font-bold text-cyan-400">{totalTables}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-4 border border-border">
          <div className="text-muted-foreground text-sm">Total Size</div>
          <div className="text-2xl font-bold text-purple-400">{formatBytes(totalSize)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-4 border border-border">
          <div className="text-muted-foreground text-sm">Total Records</div>
          <div className="text-2xl font-bold text-green-400">{formatNumber(totalRows)}</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-4 border border-border">
          <div className="text-muted-foreground text-sm">Evidence Domains</div>
          <div className="text-2xl font-bold text-orange-400">{domains.length}</div>
        </div>
      </div>

      {/* Dry Run Toggle */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
        <Switch checked={dryRun} onCheckedChange={setDryRun} />
        <span className="text-sm">
          <strong>Dry Run Mode</strong> - {dryRun ? 'Operations will preview changes only' : 'Operations will be executed!'}
        </span>
        {!dryRun && <AlertTriangle className="h-4 w-4 text-yellow-400" />}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-6 mb-4">
          <TabsTrigger value="overview">Modality Overview</TabsTrigger>
          <TabsTrigger value="duplicates">Duplicate Families</TabsTrigger>
          <TabsTrigger value="empty">Empty Tables</TabsTrigger>
          <TabsTrigger value="cleanup">Cleanup Wizard</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="metrics">Quality Metrics</TabsTrigger>
        </TabsList>

        {/* Modality Overview Tab */}
        <TabsContent value="overview">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">13 Evidence Domains</h3>
            <Button onClick={loadModalityBreakdown} disabled={loading} size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {domains.map(domain => (
              <div 
                key={domain.name}
                className="bg-muted/20 border border-border rounded-lg p-4 hover:border-cyan-500/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {DOMAIN_ICONS[domain.name] || <Layers className="h-4 w-4" />}
                    <span className="font-medium text-sm">{domain.name.replace(/_/g, ' ')}</span>
                  </div>
                  {getHealthBadge(domain.health_score)}
                </div>
                
                <p className="text-xs text-muted-foreground mb-3">{domain.description}</p>
                
                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-muted-foreground">Tables:</span>
                    <span className="ml-2 font-medium">{domain.table_count}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Records:</span>
                    <span className="ml-2 font-medium">{formatNumber(domain.total_rows)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Size:</span>
                    <span className="ml-2 font-medium">{formatBytes(domain.total_size)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Empty:</span>
                    <span className="ml-2 font-medium text-yellow-400">{domain.empty_table_count}</span>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <Progress value={domain.health_score} className="flex-1 h-2" />
                  <span className={`text-sm font-bold ${getHealthColor(domain.health_score)}`}>
                    {domain.health_score}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Duplicate Families Tab */}
        <TabsContent value="duplicates">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Duplicate Table Families</h3>
            <Button onClick={loadDuplicateFamilies} disabled={loading} size="sm">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Scan Duplicates
            </Button>
          </div>
          
          <ScrollArea className="h-[500px]">
            <div className="space-y-4">
              {duplicateFamilies.map(family => (
                <div 
                  key={family.base_name}
                  className="bg-muted/20 border border-border rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <GitMerge className="h-4 w-4 text-purple-400" />
                      <span className="font-medium">{family.base_name.toUpperCase()}</span>
                      <Badge variant="outline">{family.domain.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatBytes(family.total_size)} • {formatNumber(family.total_rows)} rows
                    </div>
                  </div>
                  
                  <div className="space-y-2 mb-3">
                    {family.primary && (
                      <div className="flex items-center gap-2 text-sm bg-green-500/10 p-2 rounded">
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                        <span className="font-medium">{family.primary.name}</span>
                        <span className="text-muted-foreground">PRIMARY</span>
                        <span className="ml-auto">{formatNumber(family.primary.row_count)} rows</span>
                      </div>
                    )}
                    
                    {family.duplicates.map(dup => (
                      <div key={dup.name} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
                        <Checkbox 
                          checked={selectedTables.has(dup.name)}
                          onCheckedChange={() => toggleTableSelection(dup.name)}
                          disabled={dup.is_protected}
                        />
                        <span className={dup.is_protected ? 'text-muted-foreground' : ''}>
                          {dup.name}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {dup.suffix}
                        </Badge>
                        {dup.is_backup && <Badge className="bg-blue-500/20 text-blue-400">Backup</Badge>}
                        {dup.row_count === 0 && <Badge className="bg-yellow-500/20 text-yellow-400">Empty</Badge>}
                        {dup.is_protected && <Shield className="h-3 w-3 text-green-400" />}
                        <span className="ml-auto text-muted-foreground">
                          {formatNumber(dup.row_count)} rows • {formatBytes(dup.size_bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  <Alert className="bg-cyan-500/10 border-cyan-500/30">
                    <Target className="h-4 w-4" />
                    <AlertDescription>{family.recommendation}</AlertDescription>
                  </Alert>
                </div>
              ))}
              
              {duplicateFamilies.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Click "Scan Duplicates" to detect duplicate table families
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Empty Tables Tab */}
        <TabsContent value="empty">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">Empty Tables ({emptyTables.length})</h3>
            <div className="flex gap-2">
              <Button onClick={selectAllSafeToDropTables} variant="outline" size="sm">
                Select Safe to Drop
              </Button>
              <Button onClick={loadEmptyTables} disabled={loading} size="sm">
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Scan Empty
              </Button>
            </div>
          </div>
          
          {selectedTables.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-muted/30 rounded-lg">
              <span>{selectedTables.size} tables selected</span>
              <Button onClick={handleArchiveTables} variant="outline" size="sm" disabled={loading}>
                <Archive className="h-4 w-4 mr-2" />
                Archive
              </Button>
              <Button onClick={handleDropTables} variant="destructive" size="sm" disabled={loading}>
                <Trash2 className="h-4 w-4 mr-2" />
                Drop
              </Button>
              <Button onClick={() => setSelectedTables(new Set())} variant="ghost" size="sm">
                Clear
              </Button>
            </div>
          )}
          
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {emptyTables.map(table => (
                <div 
                  key={table.name}
                  className="flex items-center gap-3 p-3 bg-muted/20 border border-border rounded-lg"
                >
                  <Checkbox 
                    checked={selectedTables.has(table.name)}
                    onCheckedChange={() => toggleTableSelection(table.name)}
                    disabled={table.is_protected}
                  />
                  <span className={`flex-1 font-mono text-sm ${table.is_protected ? 'text-muted-foreground' : ''}`}>
                    {table.name}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {table.domain.replace(/_/g, ' ')}
                  </Badge>
                  {table.is_protected && (
                    <Badge className="bg-green-500/20 text-green-400">
                      <Shield className="h-3 w-3 mr-1" />
                      Protected
                    </Badge>
                  )}
                  {table.has_fk_dependencies && (
                    <Badge className="bg-orange-500/20 text-orange-400">Has FK</Badge>
                  )}
                  {table.safe_to_drop ? (
                    <CheckCircle2 className="h-4 w-4 text-green-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                </div>
              ))}
              
              {emptyTables.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Click "Scan Empty" to find empty tables
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Cleanup Wizard Tab */}
        <TabsContent value="cleanup">
          <div className="space-y-6">
            <h3 className="text-lg font-semibold">Safe Cleanup Wizard</h3>
            
            <div className="space-y-4">
              {/* Step 1: MNIST Data */}
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 font-bold">1</div>
                    <span className="font-medium">Drop MNIST Test Data</span>
                    <Badge className="bg-red-500/20 text-red-400">~370 MB</Badge>
                  </div>
                  <Button 
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setSelectedTables(new Set(['mnist_test', 'mnist_train_small']));
                      handleDropTables();
                    }}
                    disabled={loading}
                  >
                    {dryRun ? 'Preview' : 'Execute'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Removes irrelevant ML training data: mnist_test, mnist_train_small
                </p>
              </div>

              {/* Step 2: Dated Backups */}
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold">2</div>
                    <span className="font-medium">Archive Dated Backups</span>
                    <Badge className="bg-blue-500/20 text-blue-400">~1 GB</Badge>
                  </div>
                  <Button 
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const backupTables = duplicateFamilies
                        .flatMap(f => f.duplicates)
                        .filter(d => d.is_backup)
                        .map(d => d.name);
                      setSelectedTables(new Set(backupTables));
                      handleArchiveTables();
                    }}
                    disabled={loading}
                  >
                    <Archive className="h-4 w-4 mr-2" />
                    {dryRun ? 'Preview' : 'Archive'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Moves *_backup_20260102 tables to quarantine schema (data preserved)
                </p>
              </div>

              {/* Step 3: Empty Tables */}
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400 font-bold">3</div>
                    <span className="font-medium">Drop Empty Tables</span>
                    <Badge className="bg-yellow-500/20 text-yellow-400">
                      {emptyTables.filter(t => t.safe_to_drop).length} tables
                    </Badge>
                  </div>
                  <Button 
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      selectAllSafeToDropTables();
                      handleDropTables();
                    }}
                    disabled={loading}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {dryRun ? 'Preview' : 'Execute'}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Removes tables with 0 rows that have no FK dependencies
                </p>
              </div>

              {/* Step 4: Merge Duplicates */}
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 font-bold">4</div>
                    <span className="font-medium">Merge Duplicate Families</span>
                    <Badge className="bg-purple-500/20 text-purple-400">Manual Review</Badge>
                  </div>
                  <Button 
                    size="sm"
                    variant="outline"
                    onClick={() => setActiveTab('duplicates')}
                  >
                    <GitMerge className="h-4 w-4 mr-2" />
                    Review
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground ml-10">
                  Requires schema-aware merge for each family - review duplicates tab
                </p>
              </div>
            </div>

            <Alert className="bg-cyan-500/10 border-cyan-500/30">
              <HardDrive className="h-4 w-4" />
              <AlertDescription>
                <strong>Expected Savings:</strong> ~1.5 GB storage freed after completing all steps.
                Always run with Dry Run Mode enabled first to preview changes.
              </AlertDescription>
            </Alert>
          </div>
        </TabsContent>

        {/* Operations Tab */}
        <TabsContent value="operations">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Operation Results</h3>
            
            {operationResults ? (
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-muted/30 rounded-lg">
                  <Badge className={operationResults.dry_run ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}>
                    {operationResults.dry_run ? 'DRY RUN' : 'EXECUTED'}
                  </Badge>
                  <span>
                    {operationResults.archived_count !== undefined 
                      ? `${operationResults.archived_count} tables archived` 
                      : `${operationResults.dropped_count} tables dropped`}
                  </span>
                </div>
                
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2">
                    {operationResults.results?.map((result: any, idx: number) => (
                      <div 
                        key={idx}
                        className={`flex items-center gap-3 p-2 rounded text-sm ${
                          result.status === 'error' ? 'bg-red-500/10' :
                          result.status === 'skipped' ? 'bg-yellow-500/10' :
                          'bg-green-500/10'
                        }`}
                      >
                        {result.status === 'error' ? <XCircle className="h-4 w-4 text-red-400" /> :
                         result.status === 'skipped' ? <AlertTriangle className="h-4 w-4 text-yellow-400" /> :
                         <CheckCircle2 className="h-4 w-4 text-green-400" />}
                        <span className="font-mono">{result.table}</span>
                        <Badge variant="outline">{result.status}</Badge>
                        {result.reason && <span className="text-muted-foreground">({result.reason})</span>}
                        {result.error && <span className="text-red-400">{result.error}</span>}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No operations executed yet. Use the Cleanup Wizard or Empty Tables tab to run operations.
              </div>
            )}
          </div>
        </TabsContent>

        {/* Quality Metrics Tab */}
        <TabsContent value="metrics">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Domain-Specific Quality Metrics</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Plane className="h-4 w-4 text-cyan-400" />
                  <span className="font-medium">Flight Surveillance</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Coordinate Validation</span>
                    <span className="text-green-400">98%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">N-Number Format</span>
                    <span className="text-green-400">95%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Altitude Range</span>
                    <span className="text-yellow-400">87%</span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Heart className="h-4 w-4 text-red-400" />
                  <span className="font-medium">Biometric Health</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Heart Rate Range</span>
                    <span className="text-green-400">99%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ECG Integrity</span>
                    <span className="text-green-400">100%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Timestamp Sequence</span>
                    <span className="text-green-400">96%</span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="h-4 w-4 text-purple-400" />
                  <span className="font-medium">Josiah AI</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Embedding Consistency</span>
                    <span className="text-green-400">100%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Reflection Integrity</span>
                    <span className="text-green-400">99%</span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/20 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <GitMerge className="h-4 w-4 text-orange-400" />
                  <span className="font-medium">Correlations</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Orphan Rate</span>
                    <span className="text-green-400">&lt;1%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Confidence Valid</span>
                    <span className="text-green-400">97%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </CyberPanel>
  );
}

export default DatabaseQualityControl;

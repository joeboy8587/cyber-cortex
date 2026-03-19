import { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  Database, 
  FileSearch,
  RefreshCw,
  Clock,
  Layers,
  FileWarning,
  Brain,
  MapPin,
  TrendingUp,
  Activity,
  Target,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';

interface AuditSummary {
  tableCount: number;
  totalRecords: number;
  tablesWithHash: number;
  tablesMissingHash: string[];
  hashCoverage: number;
}

interface OcrAuditResult {
  table: string;
  totalRecords: number;
  nullTimestamps: number;
  registrationIssues: Array<{
    value: string;
    count: number;
    validation: { valid: boolean; corrected?: string; issue?: string };
  }>;
  hasHashColumn: boolean;
  status: 'CLEAN' | 'NEEDS_ATTENTION' | 'ERROR';
  error?: string;
}

interface EvidenceDomain {
  tableCount: number;
  totalRows: number;
  tables: Array<{ name: string; rows: number }>;
}

interface TimelineRange {
  table: string;
  earliest: string;
  latest: string;
  count: number;
}

interface IngestionStats {
  coordinateStats: {
    totalRecords: number;
    validCoordinates: number;
    nullCoordinates: number;
    zeroCoordinates: number;
    kernCountyFlights: number;
    validationRate: number;
  };
  taxonomyDistribution: Array<{ tag: string; count: number; withCoords: number }>;
  recentActivity: Array<{ hour: string; recordsInserted: number; validCoords: number; flaggedCount: number }>;
  flagStats: { flagged: number; unflagged: number; tier1: number; tier2: number; tier3: number; tier4plus: number };
  uniqueIdentifiers: { registrations: number; icaoCodes: number; callsigns: number };
  timestamp: string;
}

export default function DataQualityAudit() {
  const [loading, setLoading] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [ocrAudit, setOcrAudit] = useState<OcrAuditResult[]>([]);
  const [domains, setDomains] = useState<Record<string, EvidenceDomain>>({});
  const [timeline, setTimeline] = useState<TimelineRange[]>([]);
  const [ingestionStats, setIngestionStats] = useState<IngestionStats | null>(null);

  const runAudit = async () => {
    setLoading(true);
    try {
      // Run all audits in parallel including ingestion stats
      const [summaryRes, ocrRes, domainsRes, timelineRes, ingestionRes] = await Promise.all([
        supabase.functions.invoke('data-quality-audit', { body: { action: 'getAuditSummary' } }),
        supabase.functions.invoke('data-quality-audit', { body: { action: 'auditOcrTables' } }),
        supabase.functions.invoke('data-quality-audit', { body: { action: 'getEvidenceDomains' } }),
        supabase.functions.invoke('data-quality-audit', { body: { action: 'getTimelineRange' } }),
        supabase.functions.invoke('neon-query', { body: { action: 'getIngestionStats' } })
      ]);

      if (summaryRes.data?.data) setSummary(summaryRes.data.data);
      if (ocrRes.data?.data) setOcrAudit(Array.isArray(ocrRes.data.data) ? ocrRes.data.data : []);
      if (domainsRes.data?.data) setDomains(domainsRes.data.data);
      if (timelineRes.data?.data) setTimeline(Array.isArray(timelineRes.data.data) ? timelineRes.data.data : []);
      if (ingestionRes.data) {
        const raw = ingestionRes.data?.data || ingestionRes.data;
        setIngestionStats({
          coordinateStats: raw.coordinateStats || { totalRecords: 0, validCoordinates: 0, nullCoordinates: 0, zeroCoordinates: 0, kernCountyFlights: 0, validationRate: 0 },
          taxonomyDistribution: Array.isArray(raw.taxonomyDistribution) ? raw.taxonomyDistribution : [],
          recentActivity: Array.isArray(raw.recentActivity) ? raw.recentActivity : [],
          flagStats: raw.flagStats || { flagged: 0, unflagged: 0, tier1: 0, tier2: 0, tier3: 0, tier4plus: 0 },
          uniqueIdentifiers: raw.uniqueIdentifiers || { registrations: 0, icaoCodes: 0, callsigns: 0 },
          timestamp: raw.timestamp || new Date().toISOString(),
        });
      }

      toast.success('Audit complete');
    } catch (err) {
      toast.error('Audit failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const cleanupNullDetections = async () => {
    setCleaningUp(true);
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', { 
        body: { action: 'cleanupNullDetections' } 
      });
      
      if (error) throw error;
      
      toast.success(`Cleaned up ${data?.deletedCount || 0} invalid records`);
      // Refresh stats after cleanup
      runAudit();
    } catch (err) {
      toast.error('Cleanup failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setCleaningUp(false);
    }
  };

  useEffect(() => {
    runAudit();
  }, []);

  const formatNumber = (n: number) => n?.toLocaleString() || '0';
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : 'N/A';
  const formatDateTime = (d: string) => d ? new Date(d).toLocaleString() : 'N/A';

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CLEAN':
      case 'VERIFIED':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">✓ Clean</Badge>;
      case 'NEEDS_ATTENTION':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">⚠ Needs Review</Badge>;
      case 'ERROR':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">✕ Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getValidationColor = (rate: number) => {
    if (rate >= 95) return 'text-green-400';
    if (rate >= 80) return 'text-yellow-400';
    return 'text-red-400';
  };

  const domainIcons: Record<string, typeof Database> = {
    flight_tracking: Layers,
    biometric: Shield,
    josiah_ai: Brain,
    ocr_screenshots: FileSearch,
    forensic_files: FileWarning,
    legal_violations: AlertTriangle,
    aircraft_registry: Database,
    shell_companies: Database,
    kcso_evidence: Shield,
    coordination_ops: Layers,
    other: Database
  };

  return (
    <CyberPanel 
      title="FORENSIC DATA QUALITY AUDIT" 
      icon={<Shield className="w-5 h-5" />}
      headerActions={
        <Button 
          size="sm" 
          variant="outline" 
          onClick={runAudit}
          disabled={loading}
          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Auditing...' : 'Run Audit'}
        </Button>
      }
    >
      <Tabs defaultValue="ingestion" className="w-full">
        <TabsList className="grid w-full grid-cols-5 bg-background/50">
          <TabsTrigger value="ingestion">Ingestion Stats</TabsTrigger>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ocr">OCR Quality</TabsTrigger>
          <TabsTrigger value="domains">Evidence Domains</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* NEW INGESTION STATS TAB */}
        <TabsContent value="ingestion" className="space-y-4 mt-4">
          {ingestionStats ? (
            <>
              {/* Coordinate Validation Stats */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-background/30 rounded-lg p-4 border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Database className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-muted-foreground">Total Records</span>
                  </div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {formatNumber(ingestionStats.coordinateStats.totalRecords)}
                  </div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-green-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-muted-foreground">Valid Coords</span>
                  </div>
                  <div className="text-2xl font-bold text-green-400">
                    {formatNumber(ingestionStats.coordinateStats.validCoordinates)}
                  </div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-red-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-muted-foreground">Null/Zero</span>
                  </div>
                  <div className="text-2xl font-bold text-red-400">
                    {formatNumber((ingestionStats.coordinateStats.nullCoordinates || 0) + (ingestionStats.coordinateStats.zeroCoordinates || 0))}
                  </div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-purple-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-purple-400" />
                    <span className="text-xs text-muted-foreground">Kern County</span>
                  </div>
                  <div className="text-2xl font-bold text-purple-400">
                    {formatNumber(ingestionStats.coordinateStats.kernCountyFlights)}
                  </div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-yellow-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs text-muted-foreground">Validation Rate</span>
                  </div>
                  <div className={`text-2xl font-bold ${getValidationColor(ingestionStats.coordinateStats.validationRate)}`}>
                    {ingestionStats.coordinateStats.validationRate}%
                  </div>
                </div>
              </div>

              {/* Coordinate Validation Progress */}
              <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Coordinate Validation Rate</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${getValidationColor(ingestionStats.coordinateStats.validationRate)}`}>
                      {ingestionStats.coordinateStats.validationRate}%
                    </span>
                    {(ingestionStats.coordinateStats.nullCoordinates + ingestionStats.coordinateStats.zeroCoordinates) > 0 && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        onClick={cleanupNullDetections}
                        disabled={cleaningUp}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-7"
                      >
                        <Trash2 className={`w-3 h-3 mr-1 ${cleaningUp ? 'animate-spin' : ''}`} />
                        {cleaningUp ? 'Cleaning...' : 'Cleanup Nulls'}
                      </Button>
                    )}
                  </div>
                </div>
                <Progress value={ingestionStats.coordinateStats.validationRate} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Valid: {formatNumber(ingestionStats.coordinateStats.validCoordinates)}</span>
                  <span>Invalid: {formatNumber(ingestionStats.coordinateStats.nullCoordinates + ingestionStats.coordinateStats.zeroCoordinates)}</span>
                </div>
              </div>

              {/* Flagging & Tier Stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    <span className="font-medium">Flagged Aircraft Distribution</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Tier 1 (Critical)</span>
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                        {formatNumber(ingestionStats.flagStats.tier1)}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Tier 2 (High)</span>
                      <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                        {formatNumber(ingestionStats.flagStats.tier2)}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Tier 3 (Medium)</span>
                      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        {formatNumber(ingestionStats.flagStats.tier3)}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Tier 4+ (Normal)</span>
                      <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
                        {formatNumber(ingestionStats.flagStats.tier4plus)}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-cyan-400" />
                    <span className="font-medium">Unique Identifiers</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Unique Registrations</span>
                      <span className="text-cyan-400 font-mono">{formatNumber(ingestionStats.uniqueIdentifiers.registrations)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Unique ICAO Codes</span>
                      <span className="text-cyan-400 font-mono">{formatNumber(ingestionStats.uniqueIdentifiers.icaoCodes)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Unique Callsigns</span>
                      <span className="text-cyan-400 font-mono">{formatNumber(ingestionStats.uniqueIdentifiers.callsigns)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-border/20">
                      <span className="text-sm text-muted-foreground">Flagged Total</span>
                      <span className="text-red-400 font-bold">{formatNumber(ingestionStats.flagStats.flagged)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Taxonomy Distribution */}
              <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <span className="font-medium">XXB Taxonomy Distribution</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                  {ingestionStats.taxonomyDistribution.map((t) => (
                    <div key={t.tag} className="bg-background/20 rounded p-2 border border-border/20">
                      <div className="text-xs text-muted-foreground truncate">{t.tag}</div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-mono text-cyan-400">{formatNumber(t.count)}</span>
                        <span className="text-xs text-green-400">
                          {t.count > 0 ? Math.round(((t.withCoords || 0) / t.count) * 100) : 0}% ✓
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-green-400" />
                  <span className="font-medium">Recent Ingestion Activity (24h)</span>
                </div>
                {ingestionStats.recentActivity.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">No recent activity</div>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {ingestionStats.recentActivity.map((a, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-background/20 rounded text-sm">
                        <span className="text-muted-foreground font-mono text-xs">
                          {formatDateTime(a.hour)}
                        </span>
                        <div className="flex gap-4">
                          <span className="text-cyan-400">
                            +{formatNumber(a.recordsInserted)}
                          </span>
                          <span className="text-green-400">
                            {a.recordsInserted > 0 ? Math.round((a.validCoords / a.recordsInserted) * 100) : 0}% valid
                          </span>
                          <span className="text-red-400">
                            {a.flaggedCount} flagged
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground text-right">
                Last updated: {formatDateTime(ingestionStats.timestamp)}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Loading ingestion statistics...
            </div>
          )}
        </TabsContent>

        <TabsContent value="overview" className="space-y-4 mt-4">
          {summary && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-background/30 rounded-lg p-4 border border-cyan-500/20">
                  <div className="text-2xl font-bold text-cyan-400">{formatNumber(summary.tableCount)}</div>
                  <div className="text-sm text-muted-foreground">Total Tables</div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-green-500/20">
                  <div className="text-2xl font-bold text-green-400">{formatNumber(summary.totalRecords)}</div>
                  <div className="text-sm text-muted-foreground">Total Records</div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-purple-500/20">
                  <div className="text-2xl font-bold text-purple-400">{summary.tablesWithHash}</div>
                  <div className="text-sm text-muted-foreground">Tables with Hash</div>
                </div>
                <div className="bg-background/30 rounded-lg p-4 border border-yellow-500/20">
                  <div className="text-2xl font-bold text-yellow-400">{summary.hashCoverage}%</div>
                  <div className="text-sm text-muted-foreground">Hash Coverage</div>
                </div>
              </div>

              <div className="bg-background/30 rounded-lg p-4 border border-border/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Chain of Custody Coverage</span>
                  <span className="text-sm text-muted-foreground">{summary.hashCoverage}%</span>
                </div>
                <Progress value={summary.hashCoverage} className="h-2" />
              </div>

              {summary.tablesMissingHash.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                    <span className="font-medium text-yellow-400">Tables Missing Hash Column ({summary.tablesMissingHash.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {summary.tablesMissingHash.slice(0, 10).map(t => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                    {summary.tablesMissingHash.length > 10 && (
                      <Badge variant="outline" className="text-xs">+{summary.tablesMissingHash.length - 10} more</Badge>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="ocr" className="space-y-4 mt-4">
          {ocrAudit.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No OCR tables found or audit not run</div>
          ) : (
            ocrAudit.map(audit => (
              <div key={audit.table} className="bg-background/30 rounded-lg p-4 border border-border/30">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileSearch className="w-4 h-4 text-cyan-400" />
                    <span className="font-mono text-sm">{audit.table}</span>
                  </div>
                  {getStatusBadge(audit.status)}
                </div>
                
                {audit.error ? (
                  <div className="text-red-400 text-sm">{audit.error}</div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Records: </span>
                        <span className="text-foreground">{formatNumber(audit.totalRecords)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">NULL Timestamps: </span>
                        <span className={audit.nullTimestamps > 0 ? 'text-yellow-400' : 'text-green-400'}>
                          {formatNumber(audit.nullTimestamps)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Hash Column: </span>
                        <span className={audit.hasHashColumn ? 'text-green-400' : 'text-yellow-400'}>
                          {audit.hasHashColumn ? '✓ Yes' : '✕ No'}
                        </span>
                      </div>
                    </div>

                    {audit.registrationIssues.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/20">
                        <div className="text-xs text-muted-foreground mb-1">Registration Issues:</div>
                        <div className="flex flex-wrap gap-1">
                          {audit.registrationIssues.slice(0, 5).map((issue, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {issue.value || 'NULL'} ({issue.count})
                              {issue.validation.corrected && (
                                <span className="text-green-400 ml-1">→ {issue.validation.corrected}</span>
                              )}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="domains" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(domains)
              .filter(([_, d]) => d.tableCount > 0)
              .sort((a, b) => b[1].totalRows - a[1].totalRows)
              .map(([domain, data]) => {
                const Icon = domainIcons[domain] || Database;
                return (
                  <div key={domain} className="bg-background/30 rounded-lg p-4 border border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4 text-cyan-400" />
                      <span className="font-medium capitalize">{domain.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                      <div>
                        <span className="text-muted-foreground">Tables: </span>
                        <span className="text-cyan-400">{data.tableCount}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Records: </span>
                        <span className="text-green-400">{formatNumber(data.totalRows)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {data.tables.slice(0, 3).map(t => (
                        <Badge key={t.name} variant="outline" className="text-xs">
                          {t.name} ({formatNumber(t.rows)})
                        </Badge>
                      ))}
                      {data.tables.length > 3 && (
                        <Badge variant="outline" className="text-xs">+{data.tables.length - 3}</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4 mt-4">
          <div className="bg-background/30 rounded-lg p-4 border border-border/30">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span className="font-medium">Evidence Timeline Range</span>
            </div>
            
            {timeline.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">Loading timeline data...</div>
            ) : (
              <div className="space-y-3">
                {timeline.map(range => (
                  <div key={range.table} className="flex items-center justify-between p-3 bg-background/20 rounded border border-border/20">
                    <div>
                      <div className="font-mono text-sm">{range.table}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(range.earliest)} → {formatDate(range.latest)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-cyan-400">{formatNumber(range.count)}</div>
                      <div className="text-xs text-muted-foreground">records</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-4 pt-4 border-t border-border/20 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3 h-3 text-green-400" />
          <span>Forensic audit validates data integrity, coordinates, XXB taxonomy, and chain of custody for legal admissibility.</span>
        </div>
      </div>
    </CyberPanel>
  );
}

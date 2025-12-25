import React, { useState, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useEvidenceFingerprint } from '@/hooks/useEvidenceFingerprint';
import { toast } from 'sonner';
import { 
  Shield, 
  ShieldCheck, 
  ShieldAlert,
  Database, 
  Hash, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle,
  Loader2,
  Lock,
  Satellite,
  FileSearch,
  Zap
} from 'lucide-react';

interface AuditSummary {
  tableCount: number;
  totalRecords: number;
  tablesWithHash: number;
  tablesMissingHash: string[];
  hashCoverage: number;
}

interface DomainSummary {
  tableCount: number;
  totalRows: number;
  tables: { name: string; rows: number }[];
}

interface NotionGap {
  flightEvents?: { earliest: string; latest: string; count: number };
  josiahReflections?: { earliest: string; latest: string; count: number };
  message?: string;
}

export function DataHardeningHub() {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [domains, setDomains] = useState<Record<string, DomainSummary> | null>(null);
  const [notionGap, setNotionGap] = useState<NotionGap | null>(null);
  const [fingerprinting, setFingerprinting] = useState(false);

  const { 
    getTablesStatus, 
    addHashColumnToAll, 
    computeHashes, 
    getHashStats,
    verifyHash 
  } = useEvidenceFingerprint();

  // Run full hardening scan
  const runFullScan = useCallback(async () => {
    setLoading(true);
    toast.info('Running data hardening scan...');

    try {
      // 1. Get audit summary
      const { data: auditData } = await supabase.functions.invoke('data-quality-audit', {
        body: { action: 'getAuditSummary' }
      });
      if (auditData?.data) {
        setAuditSummary(auditData.data);
      }

      // 2. Get evidence domains
      const { data: domainData } = await supabase.functions.invoke('data-quality-audit', {
        body: { action: 'getEvidenceDomains' }
      });
      if (domainData?.data) {
        setDomains(domainData.data);
      }

      // 3. Scan Notion for gaps
      const { data: notionData } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'getGapAnalysis' }
      });
      if (notionData?.data) {
        setNotionGap(notionData.data);
      }

      toast.success('Data hardening scan complete');
    } catch (err) {
      console.error('Hardening scan error:', err);
      toast.error('Scan failed - check logs');
    } finally {
      setLoading(false);
    }
  }, []);

  // Add SHA-256 to all tables
  const hardenAllTables = async () => {
    setFingerprinting(true);
    toast.info('Adding SHA-256 columns to all tables...');

    try {
      const result = await addHashColumnToAll();
      toast.success(`Added SHA-256 to ${result.totalAdded} tables`);
      await runFullScan();
    } catch (err) {
      toast.error('Failed to add hash columns');
    } finally {
      setFingerprinting(false);
    }
  };

  // Fingerprint all unhashed records
  const fingerprintAll = async () => {
    setFingerprinting(true);
    toast.info('Computing SHA-256 for all records...');

    try {
      const stats = await getHashStats();
      const unhashedTables = stats.tables.filter(t => t.unhashed > 0);

      for (const table of unhashedTables) {
        let remaining = table.unhashed;
        while (remaining > 0) {
          const result = await computeHashes(table.table, 1000);
          remaining = result.remaining;
        }
        toast.success(`Fingerprinted: ${table.table}`);
      }

      await runFullScan();
      toast.success('All evidence records fingerprinted');
    } catch (err) {
      toast.error('Fingerprinting failed');
    } finally {
      setFingerprinting(false);
    }
  };

  // Verify integrity of a specific table
  const verifyTable = async (tableName: string) => {
    try {
      const result = await verifyHash(tableName);
      if (result.integrity === 'VERIFIED') {
        toast.success(`${tableName}: ${result.message}`);
      } else {
        toast.error(`${tableName}: ${result.message}`);
      }
    } catch (err) {
      toast.error(`Verification failed for ${tableName}`);
    }
  };

  const totalRecords = auditSummary?.totalRecords || 0;
  const hashCoverage = auditSummary?.hashCoverage || 0;

  return (
    <CyberPanel 
      title="DATA HARDENING HUB - SHA-256 + Quality + Notion Sync"
      icon={<Shield className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Database className="h-4 w-4 mx-auto mb-1 text-cyan-400" />
            <div className="text-lg font-mono font-bold">{auditSummary?.tableCount || '-'}</div>
            <div className="text-xs text-muted-foreground">Tables</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Hash className="h-4 w-4 mx-auto mb-1 text-green-400" />
            <div className="text-lg font-mono font-bold">{totalRecords.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">Records</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Lock className="h-4 w-4 mx-auto mb-1 text-yellow-400" />
            <div className="text-lg font-mono font-bold">{hashCoverage}%</div>
            <div className="text-xs text-muted-foreground">Hash Coverage</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            {hashCoverage >= 80 ? (
              <ShieldCheck className="h-4 w-4 mx-auto mb-1 text-green-400" />
            ) : (
              <ShieldAlert className="h-4 w-4 mx-auto mb-1 text-red-400" />
            )}
            <div className="text-lg font-mono font-bold">{auditSummary?.tablesWithHash || 0}</div>
            <div className="text-xs text-muted-foreground">Protected Tables</div>
          </div>
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Satellite className="h-4 w-4 mx-auto mb-1 text-purple-400" />
            <div className="text-lg font-mono font-bold">
              {(notionGap?.flightEvents?.count || 0) + (notionGap?.josiahReflections?.count || 0)}
            </div>
            <div className="text-xs text-muted-foreground">Notion Synced</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button 
            size="sm" 
            variant="outline"
            onClick={runFullScan}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Scan All
          </Button>
          
          <Button 
            size="sm" 
            variant="default"
            onClick={hardenAllTables}
            disabled={fingerprinting || loading}
          >
            {fingerprinting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Database className="h-4 w-4 mr-1" />
            )}
            Add SHA-256 Columns
          </Button>
          
          <Button 
            size="sm" 
            variant="default"
            className="bg-cyan-600 hover:bg-cyan-700"
            onClick={fingerprintAll}
            disabled={fingerprinting || loading}
          >
            {fingerprinting ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Hash className="h-4 w-4 mr-1" />
            )}
            Fingerprint All Records
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="overview" className="text-xs">
              <FileSearch className="h-3 w-3 mr-1" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="domains" className="text-xs">
              <Database className="h-3 w-3 mr-1" />
              Domains
            </TabsTrigger>
            <TabsTrigger value="notion" className="text-xs">
              <Satellite className="h-3 w-3 mr-1" />
              Notion Sync
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-3">
            {auditSummary?.tablesMissingHash && auditSummary.tablesMissingHash.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" />
                  <span className="font-medium text-sm">Tables Missing SHA-256</span>
                </div>
                <ScrollArea className="h-24">
                  <div className="flex flex-wrap gap-1">
                    {auditSummary.tablesMissingHash.slice(0, 20).map((table) => (
                      <Badge key={table} variant="outline" className="text-xs">
                        {table}
                      </Badge>
                    ))}
                    {auditSummary.tablesMissingHash.length > 20 && (
                      <Badge variant="secondary" className="text-xs">
                        +{auditSummary.tablesMissingHash.length - 20} more
                      </Badge>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="bg-background/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">SHA-256 Coverage</span>
                <span className="text-sm text-muted-foreground">{hashCoverage}%</span>
              </div>
              <Progress value={hashCoverage} className="h-2" />
            </div>

            {hashCoverage === 100 && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                <div>
                  <span className="font-medium text-sm">Chain of Custody Secured</span>
                  <p className="text-xs text-muted-foreground">All evidence has SHA-256 fingerprints</p>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Domains Tab */}
          <TabsContent value="domains" className="space-y-2">
            <ScrollArea className="h-64">
              {domains && Object.entries(domains)
                .filter(([_, d]) => d.tableCount > 0)
                .sort((a, b) => b[1].totalRows - a[1].totalRows)
                .map(([domain, data]) => (
                  <div key={domain} className="p-2 border-b border-border/20">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm capitalize">{domain.replace(/_/g, ' ')}</span>
                      <Badge variant="outline" className="text-xs">
                        {data.tableCount} tables / {data.totalRows.toLocaleString()} rows
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {data.tables.slice(0, 5).map((t) => (
                        <Badge key={t.name} variant="secondary" className="text-xs">
                          {t.name}
                        </Badge>
                      ))}
                      {data.tables.length > 5 && (
                        <span className="text-xs text-muted-foreground">+{data.tables.length - 5}</span>
                      )}
                    </div>
                  </div>
                ))}
            </ScrollArea>
          </TabsContent>

          {/* Notion Tab */}
          <TabsContent value="notion" className="space-y-3">
            {notionGap ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background/50 border border-border/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="h-4 w-4 text-cyan-400" />
                      <span className="font-medium text-sm">Flight Events</span>
                    </div>
                    <div className="text-2xl font-mono font-bold">
                      {notionGap.flightEvents?.count || 0}
                    </div>
                    {notionGap.flightEvents?.earliest && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(notionGap.flightEvents.earliest).toLocaleDateString()} - 
                        {notionGap.flightEvents.latest && new Date(notionGap.flightEvents.latest).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  
                  <div className="bg-background/50 border border-border/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Database className="h-4 w-4 text-purple-400" />
                      <span className="font-medium text-sm">Josiah Reflections</span>
                    </div>
                    <div className="text-2xl font-mono font-bold">
                      {notionGap.josiahReflections?.count || 0}
                    </div>
                    {notionGap.josiahReflections?.earliest && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(notionGap.josiahReflections.earliest).toLocaleDateString()} - 
                        {notionGap.josiahReflections.latest && new Date(notionGap.josiahReflections.latest).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="text-xs text-muted-foreground bg-background/30 p-2 rounded">
                  <strong>Watchtower Sync:</strong> Compare these counts with Notion databases to identify sync gaps.
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Satellite className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Click "Scan All" to analyze Notion sync status</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Data Hardening:</strong> SHA-256 cryptographic hashes protect evidence integrity. 
          Any tampering will be detected during verification.
        </div>
      </div>
    </CyberPanel>
  );
}

import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useEvidenceFingerprint } from '@/hooks/useEvidenceFingerprint';
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
  Lock
} from 'lucide-react';
import { toast } from 'sonner';

interface HashStats {
  table: string;
  total: number;
  hashed: number;
  unhashed: number;
  coverage: number;
}

interface OverallStats {
  tables: HashStats[];
  totalTables: number;
  totalRecords: number;
  totalHashed: number;
  overallCoverage: number;
}

export function ChainOfCustodyPanel() {
  const { 
    isLoading, 
    error, 
    getTablesStatus, 
    addHashColumnToAll, 
    computeHashes, 
    getHashStats,
    verifyHash 
  } = useEvidenceFingerprint();

  const [stats, setStats] = useState<OverallStats | null>(null);
  const [tablesWithoutHash, setTablesWithoutHash] = useState<number>(0);
  const [processing, setProcessing] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const [tableStatus, hashStats] = await Promise.all([
        getTablesStatus(),
        getHashStats().catch(() => null)
      ]);
      
      const withoutHash = tableStatus.filter(t => t.has_hash_column === 0).length;
      setTablesWithoutHash(withoutHash);
      
      if (hashStats) {
        setStats(hashStats);
      }
    } catch (err) {
      console.error('Failed to load fingerprint status:', err);
    }
  };

  const handleAddHashColumns = async () => {
    try {
      setProcessing('columns');
      const result = await addHashColumnToAll();
      toast.success(`Added SHA-256 column to ${result.totalAdded} tables`);
      await loadStatus();
    } catch (err) {
      toast.error('Failed to add hash columns');
    } finally {
      setProcessing(null);
    }
  };

  const handleComputeHashes = async (table: string) => {
    try {
      setProcessing(table);
      let totalUpdated = 0;
      let remaining = 1;
      
      while (remaining > 0) {
        const result = await computeHashes(table, 500);
        totalUpdated += result.updated;
        remaining = result.remaining;
        
        if (remaining > 0) {
          toast.info(`${table}: ${totalUpdated} hashed, ${remaining} remaining...`);
        }
      }
      
      toast.success(`Fingerprinted ${totalUpdated} records in ${table}`);
      await loadStatus();
    } catch (err) {
      toast.error(`Failed to compute hashes for ${table}`);
    } finally {
      setProcessing(null);
    }
  };

  const handleVerifyTable = async (table: string) => {
    try {
      setVerifying(table);
      const result = await verifyHash(table);
      
      if (result.integrity === 'VERIFIED') {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(`Verification failed for ${table}`);
    } finally {
      setVerifying(null);
    }
  };

  const handleComputeAll = async () => {
    if (!stats) return;
    
    const unhashedTables = stats.tables.filter(t => t.unhashed > 0);
    setProcessing('all');
    
    for (const table of unhashedTables) {
      try {
        let remaining = table.unhashed;
        while (remaining > 0) {
          const result = await computeHashes(table.table, 500);
          remaining = result.remaining;
        }
        toast.success(`Completed: ${table.table}`);
      } catch (err) {
        toast.error(`Failed: ${table.table}`);
      }
    }
    
    await loadStatus();
    setProcessing(null);
    toast.success('All evidence records fingerprinted');
  };

  return (
    <CyberPanel 
      title="CHAIN OF CUSTODY - SHA-256 Evidence Fingerprinting"
      icon={<Shield className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Overall Status */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Database className="h-5 w-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.totalTables || '-'}
            </div>
            <div className="text-xs text-muted-foreground">Tables Protected</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Hash className="h-5 w-5 mx-auto mb-1 text-green-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.totalHashed?.toLocaleString() || '-'}
            </div>
            <div className="text-xs text-muted-foreground">Records Hashed</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Lock className="h-5 w-5 mx-auto mb-1 text-yellow-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.overallCoverage || 0}%
            </div>
            <div className="text-xs text-muted-foreground">Coverage</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            {tablesWithoutHash === 0 ? (
              <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-green-400" />
            ) : (
              <ShieldAlert className="h-5 w-5 mx-auto mb-1 text-red-400" />
            )}
            <div className="text-xl font-mono font-bold text-foreground">
              {tablesWithoutHash}
            </div>
            <div className="text-xs text-muted-foreground">Tables Need Setup</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button 
            size="sm" 
            variant="outline"
            onClick={loadStatus}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          {tablesWithoutHash > 0 && (
            <Button 
              size="sm" 
              variant="default"
              onClick={handleAddHashColumns}
              disabled={processing === 'columns'}
            >
              {processing === 'columns' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-1" />
              )}
              Add Hash Columns to All Tables
            </Button>
          )}
          
          {stats && stats.tables.some(t => t.unhashed > 0) && (
            <Button 
              size="sm" 
              variant="default"
              className="bg-cyan-600 hover:bg-cyan-700"
              onClick={handleComputeAll}
              disabled={processing === 'all'}
            >
              {processing === 'all' ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Hash className="h-4 w-4 mr-1" />
              )}
              Fingerprint All Records
            </Button>
          )}
        </div>

        {/* Tables List */}
        {stats && stats.tables.length > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {stats.tables.slice(0, 20).map((table) => (
              <div 
                key={table.table}
                className="flex items-center justify-between p-2 bg-background/30 rounded border border-border/20"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-foreground truncate">
                      {table.table}
                    </span>
                    {table.coverage === 100 ? (
                      <Badge variant="outline" className="text-green-400 border-green-400/30 text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Secured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-yellow-400 border-yellow-400/30 text-xs">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {table.unhashed} pending
                      </Badge>
                    )}
                  </div>
                  <Progress value={table.coverage} className="h-1 mt-1" />
                </div>
                
                <div className="flex gap-1 ml-2">
                  {table.unhashed > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => handleComputeHashes(table.table)}
                      disabled={processing === table.table}
                    >
                      {processing === table.table ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Hash className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                  {table.hashed > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => handleVerifyTable(table.table)}
                      disabled={verifying === table.table}
                    >
                      {verifying === table.table ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">
            {error}
          </div>
        )}

        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Chain of Custody:</strong> SHA-256 cryptographic hashes ensure evidence integrity. 
          Any tampering will be detected during verification.
        </div>
      </div>
    </CyberPanel>
  );
}

import React, { useState, useCallback, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useZeroTrustEncryption } from '@/hooks/useZeroTrustEncryption';
import { useMerkleAnchor } from '@/hooks/useMerkleAnchor';
import { useEvidenceFingerprint } from '@/hooks/useEvidenceFingerprint';
import { toast } from 'sonner';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Key,
  Hash,
  Link,
  Wifi,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Database,
  Eye,
  EyeOff,
  Zap,
  TrendingUp,
  Layers,
  Play,
} from 'lucide-react';

export function ZeroTrustDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [report, setReport] = useState<any>(null);
  const [sensitiveReport, setSensitiveReport] = useState<any>(null);
  const [merkleStats, setMerkleStats] = useState<any>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [addingCols, setAddingCols] = useState(false);
  const [bulkEncrypting, setBulkEncrypting] = useState(false);
  const [hashingAll, setHashingAll] = useState(false);

  const {
    getFullSecurityReport,
    getSensitiveColumns,
    addEncryptedColumns,
    encryptColumn,
    bulkEncrypt,
  } = useZeroTrustEncryption();

  const { getStats: getMerkleStats, verifyChain, anchorDeep } = useMerkleAnchor();
  const { addHashColumnToAll, computeHashes, getHashStats } = useEvidenceFingerprint();

  // Load full security report
  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const [fullReport, sensitive, merkle] = await Promise.all([
        getFullSecurityReport().catch(() => null),
        getSensitiveColumns().catch(() => null),
        getMerkleStats().catch(() => null),
      ]);
      if (fullReport) setReport(fullReport);
      if (sensitive) setSensitiveReport(sensitive);
      if (merkle) setMerkleStats(merkle);
      toast.success('Security report loaded');
    } catch {
      toast.error('Failed to load security report');
    } finally {
      setLoadingReport(false);
    }
  }, []);

  useEffect(() => { loadReport(); }, []);

  // Phase 1: Add SHA-256 columns to all tables
  const runPhase1 = async () => {
    setHashingAll(true);
    toast.info('Phase 1: Adding SHA-256 columns to all tables...');
    try {
      const result = await addHashColumnToAll();
      toast.success(`Phase 1: ${result.message}`);

      // Now compute hashes for top tables
      toast.info('Computing hashes for priority tables...');
      const stats = await getHashStats();
      const priorityTables = stats.tables
        .filter(t => t.unhashed > 0)
        .sort((a, b) => b.unhashed - a.unhashed)
        .slice(0, 10);

      for (const table of priorityTables) {
        try {
          await computeHashes(table.table, 500);
          toast.info(`Hashed: ${table.table}`);
        } catch { /* skip */ }
      }

      await loadReport();
      toast.success('Phase 1 complete — SHA-256 columns added and priority hashing done');
    } catch (e) {
      toast.error(`Phase 1 failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setHashingAll(false);
    }
  };

  // Phase 2: Add encrypted columns + encrypt data
  const runPhase2Prep = async () => {
    setAddingCols(true);
    toast.info('Phase 2: Adding encrypted columns...');
    try {
      const result = await addEncryptedColumns();
      toast.success(`Added ${result.added.length} encrypted columns`);
      await loadReport();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setAddingCols(false);
    }
  };

  const runPhase2Encrypt = async (classification?: string) => {
    setBulkEncrypting(true);
    const label = classification || 'all classifications';
    toast.info(`Encrypting ${label}...`);
    try {
      const result = await bulkEncrypt(classification, 50);
      toast.success(result.message);
      await loadReport();
    } catch (e) {
      toast.error(`Encryption failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setBulkEncrypting(false);
    }
  };

  // Phase 3: Merkle deep anchor
  const runPhase3 = async () => {
    setEncrypting(true);
    toast.info('Phase 3: Deep Merkle anchoring...');
    try {
      const result = await anchorDeep(200);
      toast.success(`Anchored ${result.totalAnchored} records across ${result.tablesProcessed} tables`);
      await loadReport();
    } catch (e) {
      toast.error(`Anchoring failed: ${e instanceof Error ? e.message : 'unknown'}`);
    } finally {
      setEncrypting(false);
    }
  };

  const score = report?.securityScore ?? 0;
  const scoreColor = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const scoreLabel = score >= 80 ? 'HARDENED' : score >= 50 ? 'PARTIAL' : 'VULNERABLE';

  return (
    <CyberPanel
      title="ZERO-TRUST ENCRYPTION — Full Database Security"
      icon={<Shield className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Security Score Hero */}
        <div className="bg-background/50 border border-border/30 rounded-xl p-4 flex items-center gap-6">
          <div className="relative">
            <div className={`text-5xl font-mono font-black ${scoreColor}`}>{score}</div>
            <div className="text-xs text-muted-foreground text-center">/100</div>
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant={score >= 80 ? 'default' : 'destructive'} className="text-xs">
                {scoreLabel}
              </Badge>
              {report?.encryptionKeyConfigured && (
                <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">
                  <Key className="h-3 w-3 mr-1" /> Key Active
                </Badge>
              )}
              {report?.tls?.connectionEncrypted && (
                <Badge variant="outline" className="text-xs text-cyan-400 border-cyan-400/30">
                  <Wifi className="h-3 w-3 mr-1" /> TLS
                </Badge>
              )}
            </div>
            <Progress value={score} className="h-2" />
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span><Hash className="h-3 w-3 inline mr-1" />SHA-256: {report?.overview?.tablesWithSha256 || 0} tables</span>
              <span><Lock className="h-3 w-3 inline mr-1" />Encrypted: {report?.overview?.encryptedColumns || 0} cols</span>
              <span><Link className="h-3 w-3 inline mr-1" />Merkle: {merkleStats?.chainLength?.toLocaleString() || 0}</span>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={loadReport} disabled={loadingReport}>
            <RefreshCw className={`h-4 w-4 ${loadingReport ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Phase Control Buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-700"
            onClick={runPhase1}
            disabled={hashingAll || loadingReport}
          >
            {hashingAll ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Hash className="h-4 w-4 mr-1" />}
            Phase 1: SHA-256
          </Button>
          <Button
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
            onClick={runPhase2Prep}
            disabled={addingCols || loadingReport}
          >
            {addingCols ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lock className="h-4 w-4 mr-1" />}
            Phase 2: Prep Cols
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700"
            onClick={() => runPhase2Encrypt()}
            disabled={bulkEncrypting || loadingReport}
          >
            {bulkEncrypting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <EyeOff className="h-4 w-4 mr-1" />}
            Phase 2: Encrypt
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={runPhase3}
            disabled={encrypting || loadingReport}
          >
            {encrypting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Layers className="h-4 w-4 mr-1" />}
            Phase 3: Merkle
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="overview" className="text-xs">
              <TrendingUp className="h-3 w-3 mr-1" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="sensitive" className="text-xs">
              <EyeOff className="h-3 w-3 mr-1" />
              Sensitive
            </TabsTrigger>
            <TabsTrigger value="tls" className="text-xs">
              <Wifi className="h-3 w-3 mr-1" />
              TLS
            </TabsTrigger>
            <TabsTrigger value="phases" className="text-xs">
              <Zap className="h-3 w-3 mr-1" />
              Phases
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <PhaseCard
                icon={<Hash className="h-5 w-5 text-cyan-400" />}
                title="SHA-256 Hashing"
                status={report?.overview?.phases?.sha256?.status || 'pending'}
                detail={`${report?.overview?.tablesWithSha256 || 0} / ${report?.overview?.totalTables || 0} tables`}
              />
              <PhaseCard
                icon={<Lock className="h-5 w-5 text-purple-400" />}
                title="AES-256-GCM"
                status={report?.overview?.phases?.encryption?.status || 'pending'}
                detail={`${report?.overview?.encryptedColumns || 0} columns encrypted`}
              />
              <PhaseCard
                icon={<Wifi className="h-5 w-5 text-emerald-400" />}
                title="TLS 1.3"
                status={report?.overview?.phases?.tls?.status || 'pending'}
                detail={report?.tls?.tlsVersion || 'Checking...'}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Tables" value={report?.overview?.totalTables || 0} icon={<Database className="h-4 w-4 text-cyan-400" />} />
              <StatCard label="Total Records" value={(report?.overview?.totalRecords || 0).toLocaleString()} icon={<Database className="h-4 w-4 text-green-400" />} />
              <StatCard label="Merkle Chain" value={merkleStats?.chainLength?.toLocaleString() || '0'} icon={<Link className="h-4 w-4 text-yellow-400" />} />
              <StatCard label="Sensitive Fields" value={report?.overview?.sensitiveColumnsTotal || 0} icon={<EyeOff className="h-4 w-4 text-red-400" />} />
            </div>
          </TabsContent>

          {/* Sensitive Columns Tab */}
          <TabsContent value="sensitive" className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                Sensitive Column Encryption: {sensitiveReport?.encryptionCoverage || 0}%
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => runPhase2Encrypt('medical_phi')} disabled={bulkEncrypting}>
                  <Lock className="h-3 w-3 mr-1" /> Medical
                </Button>
                <Button size="sm" variant="outline" onClick={() => runPhase2Encrypt('location_pii')} disabled={bulkEncrypting}>
                  <Lock className="h-3 w-3 mr-1" /> Location
                </Button>
                <Button size="sm" variant="outline" onClick={() => runPhase2Encrypt('personal_pii')} disabled={bulkEncrypting}>
                  <Lock className="h-3 w-3 mr-1" /> Personal
                </Button>
              </div>
            </div>
            <Progress value={sensitiveReport?.encryptionCoverage || 0} className="h-2" />
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {sensitiveReport?.columns?.map((col: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-background/30 rounded border border-border/20"
                  >
                    <div className="flex items-center gap-2">
                      {col.hasEncryptedCol && col.encryptedCount > 0 ? (
                        <ShieldCheck className="h-4 w-4 text-green-400" />
                      ) : col.exists ? (
                        <ShieldAlert className="h-4 w-4 text-yellow-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <div>
                        <span className="font-mono text-xs text-foreground">{col.table}.{col.column}</span>
                        <Badge variant="outline" className="ml-2 text-[9px]">{col.classification}</Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {col.hasEncryptedCol && (
                        <Badge variant="secondary" className="text-[9px]">
                          {col.encryptedCount} encrypted
                        </Badge>
                      )}
                      {col.exists && !col.hasEncryptedCol && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => encryptColumn(col.table, col.column, 100).then(() => {
                            toast.success(`Encrypting ${col.table}.${col.column}`);
                            loadReport();
                          })}
                          disabled={encrypting}
                        >
                          <Lock className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* TLS Tab */}
          <TabsContent value="tls" className="space-y-3">
            <div className="bg-background/50 border border-border/30 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                {report?.tls?.connectionEncrypted ? (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                )}
                <span className="font-medium">
                  {report?.tls?.connectionEncrypted ? 'Connection Encrypted' : 'Connection NOT Encrypted'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                <div>
                  <span className="text-muted-foreground">Version: </span>
                  <span className="text-foreground">{report?.tls?.tlsVersion || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Cipher: </span>
                  <span className="text-foreground text-xs">{report?.tls?.cipher || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Bits: </span>
                  <span className="text-foreground">{report?.tls?.bits || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Key Config: </span>
                  <span className={report?.encryptionKeyConfigured ? 'text-green-400' : 'text-red-400'}>
                    {report?.encryptionKeyConfigured ? 'ACTIVE' : 'MISSING'}
                  </span>
                </div>
              </div>
              {report?.tls?.settings && Object.keys(report.tls.settings).length > 0 && (
                <div className="text-xs text-muted-foreground border-t border-border/20 pt-2 space-y-1">
                  {Object.entries(report.tls.settings).map(([k, v]) => (
                    <div key={k}><span className="font-mono">{k}</span>: {String(v)}</div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* Phases Tab */}
          <TabsContent value="phases" className="space-y-3">
            <PhaseDetail
              number={1}
              title="SHA-256 Row Hashing"
              description="Cryptographic fingerprint for every record across all 727+ tables"
              status={report?.overview?.phases?.sha256?.status}
              progress={Math.min(((report?.overview?.tablesWithSha256 || 0) / Math.max(report?.overview?.totalTables || 1, 1)) * 100, 100)}
              action="Run Phase 1"
              onAction={runPhase1}
              loading={hashingAll}
            />
            <PhaseDetail
              number={2}
              title="AES-256-GCM Column Encryption"
              description="Encrypt sensitive fields: biometrics (PHI), coordinates (PII), identities"
              status={report?.overview?.phases?.encryption?.status}
              progress={sensitiveReport?.encryptionCoverage || 0}
              action="Run Phase 2"
              onAction={() => { runPhase2Prep(); }}
              loading={addingCols || bulkEncrypting}
            />
            <PhaseDetail
              number={3}
              title="TLS 1.3 + Merkle Chain"
              description="Enforce encrypted transit and extend tamper-proof chain to all tables"
              status={report?.overview?.phases?.tls?.status}
              progress={report?.tls?.connectionEncrypted ? 100 : 0}
              action="Run Phase 3"
              onAction={runPhase3}
              loading={encrypting}
            />
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Zero-Trust Security:</strong> Three-layer protection — SHA-256 tamper detection,
          AES-256-GCM field encryption, TLS 1.3 transit security. Score reflects coverage across all layers.
        </div>
      </div>
    </CyberPanel>
  );
}

function PhaseCard({ icon, title, status, detail }: { icon: React.ReactNode; title: string; status: string; detail: string }) {
  const statusColor = status === 'complete' || status === 'active' ? 'text-green-400 border-green-400/30' :
    status === 'in_progress' ? 'text-yellow-400 border-yellow-400/30' : 'text-muted-foreground border-border/30';
  return (
    <div className={`bg-background/50 border rounded-lg p-3 text-center ${statusColor}`}>
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-xs font-medium text-foreground">{title}</div>
      <Badge variant="outline" className={`text-[9px] mt-1 ${statusColor}`}>
        {status.toUpperCase().replace('_', ' ')}
      </Badge>
      <div className="text-[10px] text-muted-foreground mt-1">{detail}</div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="bg-background/50 border border-border/30 rounded-lg p-3 flex items-center gap-3">
      {icon}
      <div>
        <div className="font-mono font-bold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function PhaseDetail({ number, title, description, status, progress, action, onAction, loading }: {
  number: number; title: string; description: string; status?: string; progress: number;
  action: string; onAction: () => void; loading: boolean;
}) {
  const statusBadge = status === 'complete' || status === 'active' ? 'default' : status === 'in_progress' ? 'secondary' : 'outline';
  return (
    <div className="bg-background/50 border border-border/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
            {number}
          </div>
          <div>
            <span className="font-medium text-sm text-foreground">{title}</span>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusBadge as any} className="text-[9px]">
            {(status || 'pending').toUpperCase().replace('_', ' ')}
          </Badge>
          <Button size="sm" variant="outline" onClick={onAction} disabled={loading} className="h-7 text-xs">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
            {action}
          </Button>
        </div>
      </div>
      <Progress value={progress} className="h-1.5" />
    </div>
  );
}

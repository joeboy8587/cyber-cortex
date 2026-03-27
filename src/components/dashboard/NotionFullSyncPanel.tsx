import React, { useState, useEffect, useCallback } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Database, RefreshCw, CheckCircle2, AlertTriangle, Clock, Loader2,
  FileText, Shield, Plane, Heart, Brain, Eye, Scale, Users, Zap, Download
} from 'lucide-react';

interface NotionDbConfig {
  id: string;
  name: string;
  neonTable: string;
  syncAction: string;
  icon: React.ReactNode;
  category: 'evidence' | 'flight' | 'biometric' | 'legal' | 'reflection' | 'import';
  notionRecordEstimate: number;
}

interface TableSyncStatus {
  table: string;
  notionDb: string;
  count: number;
  lastUpdated: string | null;
  exists: boolean;
}

interface SyncResult {
  action: string;
  inserted: number;
  updated?: number;
  errors: number;
  message: string;
}

const NOTION_DATABASES: NotionDbConfig[] = [
  { id: 'cf7486ba-2cdd-4773-924e-118c8e64d2f9', name: 'Evidence — File Library', neonTable: 'evidence_files', syncAction: 'syncEvidenceFiles', icon: <FileText className="w-3.5 h-3.5" />, category: 'evidence', notionRecordEstimate: 100 },
  { id: '0c3fd946-a8cc-4dd2-9ea8-1c0c58409a28', name: 'Aircraft Events Log', neonTable: 'flight_events', syncAction: 'syncWTPREvents', icon: <Plane className="w-3.5 h-3.5" />, category: 'flight', notionRecordEstimate: 83047 },
  { id: '29e33a7b-866a-814a-b67a-000b2b1c36eb', name: 'Legal Evidence Matrix', neonTable: 'legal_evidence_matrix', syncAction: 'syncLegalMatrix', icon: <Scale className="w-3.5 h-3.5" />, category: 'legal', notionRecordEstimate: 500 },
  { id: 'eb0962e3-b6c1-4bfc-b511-61e7223f4be0', name: 'LEO/Military Event Log', neonTable: 'leo_military_events', syncAction: 'syncLEOEvents', icon: <Shield className="w-3.5 h-3.5" />, category: 'evidence', notionRecordEstimate: 200 },
  { id: '29e33a7b-866a-8159-bc03-000b3841520b', name: 'Josiah Archive', neonTable: 'josiah_reflections_rows', syncAction: 'syncJosiahReflections', icon: <Brain className="w-3.5 h-3.5" />, category: 'reflection', notionRecordEstimate: 1673 },
  { id: 'ed9a2c91-789a-4f51-9927-0c6604eb54c0', name: 'Physio — Correlation', neonTable: 'biometric_correlations', syncAction: '', icon: <Heart className="w-3.5 h-3.5" />, category: 'biometric', notionRecordEstimate: 5000 },
  { id: 'e4c498a4-139e-4344-958c-4451027e5f96', name: 'WHOOP × Flight Correlations', neonTable: 'biometric_flight_correlations', syncAction: '', icon: <Heart className="w-3.5 h-3.5" />, category: 'biometric', notionRecordEstimate: 2000 },
  { id: '45c28b62-3954-45d6-bd93-46639841bf1c', name: 'Flight Intelligence Reports', neonTable: 'flight_intelligence_reports', syncAction: '', icon: <Eye className="w-3.5 h-3.5" />, category: 'flight', notionRecordEstimate: 384 },
  { id: '7477fa92-eda4-4816-be48-16310e9683ad', name: 'Incident Gallery', neonTable: 'incident_gallery', syncAction: '', icon: <FileText className="w-3.5 h-3.5" />, category: 'evidence', notionRecordEstimate: 150 },
  { id: '1fa24b9b-9ef8-4f18-93ef-c129ab2c7b7b', name: 'Josiah Codex — Approved', neonTable: 'josiah_reflections_rows', syncAction: 'syncJosiahReflections', icon: <Brain className="w-3.5 h-3.5" />, category: 'reflection', notionRecordEstimate: 300 },
];

const CATEGORY_COLORS: Record<string, string> = {
  evidence: 'text-amber-400',
  flight: 'text-blue-400',
  biometric: 'text-red-400',
  legal: 'text-purple-400',
  reflection: 'text-cyan-400',
  import: 'text-green-400',
};

export function NotionFullSyncPanel() {
  const [syncStatuses, setSyncStatuses] = useState<TableSyncStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [tablesCreated, setTablesCreated] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchSyncStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'getSyncStatus' }
      });
      if (error) throw error;
      setSyncStatuses(data?.data?.statuses || []);
      setTablesCreated(true);
      setLastRefresh(new Date().toISOString());
    } catch (err) {
      console.error('Status fetch error:', err);
      toast.error('Failed to fetch sync status');
    } finally {
      setLoading(false);
    }
  }, []);

  const createTables = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('notion-sync', {
        body: { action: 'createNotionTables' }
      });
      if (error) throw error;
      toast.success('Notion integration tables created');
      setTablesCreated(true);
      await fetchSyncStatus();
    } catch (err) {
      console.error('Table creation error:', err);
      toast.error('Failed to create tables');
    } finally {
      setLoading(false);
    }
  };

  const getStatusForDb = (db: NotionDbConfig): TableSyncStatus | undefined => {
    return syncStatuses.find(s => s.table === db.neonTable);
  };

  const getSyncPercentage = (db: NotionDbConfig): number => {
    const status = getStatusForDb(db);
    if (!status || db.notionRecordEstimate === 0) return 0;
    return Math.min(100, Math.round((status.count / db.notionRecordEstimate) * 100));
  };

  const totalNeonRecords = syncStatuses.reduce((sum, s) => sum + s.count, 0);
  const totalNotionEstimate = NOTION_DATABASES.reduce((sum, db) => sum + db.notionRecordEstimate, 0);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  return (
    <CyberPanel
      title="NOTION WATCHTOWER SYNC"
      icon={<Database className="w-4 h-4" />}
      className="xl:col-span-2"
      headerActions={
        <div className="flex items-center gap-2">
          {!tablesCreated && (
            <Button size="sm" variant="outline" onClick={createTables} disabled={loading} className="text-xs">
              <Zap className="w-3 h-3 mr-1" /> Init Tables
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={fetchSyncStatus} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Summary Bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-primary/10 rounded-lg text-center">
            <div className="text-xl font-bold">{NOTION_DATABASES.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Notion DBs</div>
          </div>
          <div className="p-3 bg-cyan-500/10 rounded-lg text-center">
            <div className="text-xl font-bold text-cyan-400">{totalNeonRecords.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Neon Records</div>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-lg text-center">
            <div className="text-xl font-bold text-amber-400">{totalNotionEstimate.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Notion Est.</div>
          </div>
        </div>

        {lastRefresh && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            Last refresh: {new Date(lastRefresh).toLocaleTimeString()}
          </div>
        )}

        {/* Database List */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2 pr-2">
            {NOTION_DATABASES.map((db) => {
              const status = getStatusForDb(db);
              const pct = getSyncPercentage(db);
              const isSyncing = syncing === db.id;
              const hasSyncAction = !!db.syncAction;

              return (
                <div key={db.id} className="p-3 bg-card/50 rounded-lg border border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={CATEGORY_COLORS[db.category]}>{db.icon}</span>
                      <span className="text-sm font-medium truncate max-w-[200px]">{db.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {status?.exists ? (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-400 border-green-500/30">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                          {status.count.toLocaleString()}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-400 border-yellow-500/30">
                          <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                          No Table
                        </Badge>
                      )}
                      {hasSyncAction ? (
                        <Button size="sm" variant="ghost" disabled={isSyncing || !status?.exists} className="h-6 px-2 text-[10px]">
                          {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                        </Button>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Planned</Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>→ {db.neonTable}</span>
                      <span>{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>

                  {status?.lastUpdated && (
                    <div className="text-[10px] text-muted-foreground">
                      Updated: {new Date(status.lastUpdated).toLocaleString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Notion DB ID Reference */}
        <div className="p-2 bg-muted/30 rounded text-[10px] text-muted-foreground font-mono">
          {NOTION_DATABASES.length} databases mapped • SHA-256 chain-of-custody enforced
        </div>
      </div>
    </CyberPanel>
  );
}

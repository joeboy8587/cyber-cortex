import React, { useState, useEffect } from 'react';
import { CyberPanel } from '@/components/ui/cyber-panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useCeramicAnchor } from '@/hooks/useCeramicAnchor';
import { 
  Globe, 
  Link2, 
  ShieldCheck, 
  Database, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Anchor
} from 'lucide-react';
import { toast } from 'sonner';

export function CeramicAnchorPanel() {
  const { 
    isLoading, 
    error, 
    getStatus, 
    getAnchorStats 
  } = useCeramicAnchor();

  const [ceramicStatus, setCeramicStatus] = useState<{
    nodeUrl: string;
    connected: boolean;
    version?: string;
    network?: string;
  } | null>(null);

  const [stats, setStats] = useState<{
    totalRecords: number;
    anchored: number;
    pending: number;
    failed: number;
    coverage: number;
  } | null>(null);

  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStatus = async () => {
    setChecking(true);
    try {
      const [status, anchorStats] = await Promise.all([
        getStatus().catch(() => null),
        getAnchorStats().catch(() => null),
      ]);
      
      if (status) {
        setCeramicStatus(status);
      }
      
      if (anchorStats) {
        setStats(anchorStats);
      }
    } catch (err) {
      console.error('Failed to load Ceramic status:', err);
    } finally {
      setChecking(false);
    }
  };

  const handleRefresh = async () => {
    await loadStatus();
    toast.success('Ceramic status refreshed');
  };

  return (
    <CyberPanel 
      title="CERAMIC NETWORK - Decentralized Evidence Anchoring"
      icon={<Globe className="h-5 w-5" />}
    >
      <div className="space-y-4">
        {/* Network Status */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Globe className="h-5 w-5 mx-auto mb-1 text-purple-400" />
            <div className="text-sm font-medium text-foreground">
              {ceramicStatus?.connected ? (
                <Badge variant="outline" className="text-green-400 border-green-400/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="text-yellow-400 border-yellow-400/30">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Network Status</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Anchor className="h-5 w-5 mx-auto mb-1 text-cyan-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.anchored?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-muted-foreground">Records Anchored</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <Database className="h-5 w-5 mx-auto mb-1 text-yellow-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.pending?.toLocaleString() || '0'}
            </div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </div>
          
          <div className="bg-background/50 border border-border/30 rounded-lg p-3 text-center">
            <ShieldCheck className="h-5 w-5 mx-auto mb-1 text-green-400" />
            <div className="text-xl font-mono font-bold text-foreground">
              {stats?.coverage || 0}%
            </div>
            <div className="text-xs text-muted-foreground">Coverage</div>
          </div>
        </div>

        {/* Progress Bar */}
        {stats && stats.totalRecords > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Anchoring Progress</span>
              <span>{stats.anchored.toLocaleString()} / {stats.totalRecords.toLocaleString()}</span>
            </div>
            <Progress value={stats.coverage} className="h-2" />
          </div>
        )}

        {/* Node Details */}
        {ceramicStatus && (
          <div className="bg-background/30 border border-border/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Node URL</span>
              <code className="text-xs font-mono text-cyan-400">
                {ceramicStatus.nodeUrl}
              </code>
            </div>
            {ceramicStatus.version && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Version</span>
                <span className="text-sm text-foreground">{ceramicStatus.version}</span>
              </div>
            )}
            {ceramicStatus.network && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Network</span>
                <Badge variant="outline" className="text-purple-400 border-purple-400/30">
                  {ceramicStatus.network}
                </Badge>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button 
            size="sm" 
            variant="outline"
            onClick={handleRefresh}
            disabled={isLoading || checking}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${checking ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
          
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => window.open('https://cerscan.com', '_blank')}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Ceramic Explorer
          </Button>
          
          <Button 
            size="sm" 
            variant="default"
            className="bg-purple-600 hover:bg-purple-700"
            disabled={!ceramicStatus?.connected}
          >
            <Link2 className="h-4 w-4 mr-1" />
            Anchor All Pending
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 p-2 rounded">
            {error}
          </div>
        )}

        {/* Info Footer */}
        <div className="text-xs text-muted-foreground border-t border-border/20 pt-2">
          <strong>Decentralized Anchoring:</strong> Evidence records are cryptographically 
          anchored to the Ceramic Network with Ethereum blockchain time proofs, enabling 
          third-party verification without database access.
        </div>
      </div>
    </CyberPanel>
  );
}

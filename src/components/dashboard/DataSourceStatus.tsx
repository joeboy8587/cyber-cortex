import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Database, Radio, Activity, AlertTriangle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useNeonDatabase, DataSourceStatus as DataSourceStatusType } from '@/hooks/useNeonDatabase';
import { formatDistanceToNow } from 'date-fns';

export function DataSourceStatus() {
  const { getDataSourceStatus, ping, connectionStatus, isLoading } = useNeonDatabase();
  const [status, setStatus] = useState<DataSourceStatusType | null>(null);
  const [pingResult, setPingResult] = useState<{ version: string; timestamp: string } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const refresh = useCallback(async () => {
    const [statusData, pingData] = await Promise.all([
      getDataSourceStatus(),
      ping()
    ]);
    setStatus(statusData);
    setPingResult(pingData);
    setLastRefresh(new Date());
  }, [getDataSourceStatus, ping]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [refresh]);

  const getStatusBadge = (lastUpdate: string | null, recentCount: number) => {
    if (!lastUpdate) {
      return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />No Data</Badge>;
    }
    
    const lastDate = new Date(lastUpdate);
    const hoursSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
    
    if (hoursSince < 1 && recentCount > 0) {
      return <Badge className="bg-green-500 text-white gap-1"><CheckCircle className="w-3 h-3" />Live</Badge>;
    } else if (hoursSince < 24) {
      return <Badge className="bg-yellow-500 text-black gap-1"><Clock className="w-3 h-3" />Stale</Badge>;
    } else {
      return <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" />Offline</Badge>;
    }
  };

  const formatLastUpdate = (lastUpdate: string | null) => {
    if (!lastUpdate) return 'Never';
    try {
      return formatDistanceToNow(new Date(lastUpdate), { addSuffix: true });
    } catch {
      return 'Unknown';
    }
  };

  return (
    <Card className="border-primary/30 bg-card/50 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <Badge variant="outline" className="text-xs text-green-400 border-green-500/50">
                <CheckCircle className="w-3 h-3 mr-1" />
                v{pingResult?.version || '?'}
              </Badge>
            ) : connectionStatus === 'disconnected' ? (
              <Badge variant="destructive" className="text-xs">
                <XCircle className="w-3 h-3 mr-1" />
                Offline
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={isLoading}
              className="h-6 w-6 p-0"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Live Flight Detections */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-primary" />
            <div>
              <div className="text-xs font-medium">Live Detections</div>
              <div className="text-xs text-muted-foreground">
                {status?.live_detections.total.toLocaleString() || 0} total
              </div>
            </div>
          </div>
          <div className="text-right">
            {getStatusBadge(status?.live_detections.lastUpdate || null, status?.live_detections.recentCount || 0)}
            <div className="text-xs text-muted-foreground mt-1">
              {formatLastUpdate(status?.live_detections.lastUpdate || null)}
            </div>
          </div>
        </div>

        {/* Surveillance Feed */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-500" />
            <div>
              <div className="text-xs font-medium">Surveillance Feed</div>
              <div className="text-xs text-muted-foreground">
                {status?.surveillance_feed.total.toLocaleString() || 0} curated
              </div>
            </div>
          </div>
          <div className="text-right">
            {getStatusBadge(status?.surveillance_feed.lastUpdate || null, status?.surveillance_feed.recentCount || 0)}
            <div className="text-xs text-muted-foreground mt-1">
              {formatLastUpdate(status?.surveillance_feed.lastUpdate || null)}
            </div>
          </div>
        </div>

        {/* Biometrics */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-red-500" />
            <div>
              <div className="text-xs font-medium">Biometrics</div>
              <div className="text-xs text-muted-foreground">
                {status?.biometrics.total.toLocaleString() || 0} readings
              </div>
            </div>
          </div>
          <div className="text-right">
            {getStatusBadge(status?.biometrics.lastUpdate || null, status?.biometrics.recentCount || 0)}
            <div className="text-xs text-muted-foreground mt-1">
              {formatLastUpdate(status?.biometrics.lastUpdate || null)}
            </div>
          </div>
        </div>

        {/* Last refresh */}
        <div className="text-xs text-center text-muted-foreground pt-2 border-t border-border/50">
          Checked {formatDistanceToNow(lastRefresh, { addSuffix: true })}
        </div>
      </CardContent>
    </Card>
  );
}

export default DataSourceStatus;

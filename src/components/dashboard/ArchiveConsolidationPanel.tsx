import { useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Layers, RefreshCw, Database, CheckCircle, XCircle, Loader2 } from "lucide-react";

interface ViewStatus {
  view: string;
  label: string;
  description: string;
  exists: boolean;
  rowCount: number;
  sourceCount: number;
  sourceTables: string[];
}

export function ArchiveConsolidationPanel() {
  const [statuses, setStatuses] = useState<ViewStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-consolidation", {
        body: { action: "getConsolidationStatus" }
      });
      if (error) throw error;
      setStatuses(data?.data?.views || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const createViews = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-consolidation", {
        body: { action: "createUnifiedViews" }
      });
      if (error) throw error;
      const r = data?.data;
      toast({ title: "Views Created", description: `${r?.created}/${r?.total} unified views built in ${(r?.duration / 1000).toFixed(1)}s` });
      await fetchStatus();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const refreshViews = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("data-consolidation", {
        body: { action: "refreshUnifiedViews" }
      });
      if (error) throw error;
      const r = data?.data;
      const successCount = r?.refreshed?.filter((v: any) => v.success).length || 0;
      toast({ title: "Views Refreshed", description: `${successCount} views refreshed in ${(r?.totalDuration / 1000).toFixed(1)}s` });
      await fetchStatus();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const allExist = statuses.length > 0 && statuses.every(s => s.exists);
  const totalRecords = statuses.reduce((sum, s) => sum + s.rowCount, 0);

  return (
    <CyberPanel
      title="Archive Consolidation Engine"
      icon={<Layers className="w-4 h-4" />}
      headerActions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={fetchStatus} disabled={loading}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Database className="w-3 h-3 mr-1" />}
            Check Status
          </Button>
          <Button size="sm" variant="outline" onClick={createViews} disabled={creating}>
            {creating ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Layers className="w-3 h-3 mr-1" />}
            Create Views
          </Button>
          <Button size="sm" onClick={refreshViews} disabled={refreshing || !allExist}>
            {refreshing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
            Refresh All
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground font-mono">
          Consolidates fragmented tables into 5 unified materialized views. Source tables remain untouched — views are additive.
        </p>

        {statuses.length === 0 && !loading && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Click <strong>Check Status</strong> to see the state of your unified views.
          </div>
        )}

        {totalRecords > 0 && (
          <div className="flex items-center gap-4 p-3 rounded bg-primary/5 border border-primary/20">
            <span className="text-2xl font-bold text-primary">{totalRecords.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground font-mono">TOTAL UNIFIED RECORDS ACROSS ALL DOMAINS</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {statuses.map((s) => (
            <div key={s.view} className="p-3 rounded border border-border bg-card space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{s.label}</span>
                {s.exists ? (
                  <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">
                    <XCircle className="w-3 h-3 mr-1" /> Not Created
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="text-primary">{s.rowCount.toLocaleString()} rows</span>
                <span className="text-muted-foreground">•</span>
                <span className="text-muted-foreground">{s.sourceCount} source tables</span>
              </div>
              {s.sourceTables.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.sourceTables.map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 bg-muted rounded font-mono">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </CyberPanel>
  );
}

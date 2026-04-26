import { useEffect, useState } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Database, Layers, Loader2, Play, RefreshCw, Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Breakdown = { risk_classification: string; cnt: number | string };
type Status = {
  sources?: { unified_view: number; registry: number; public_atc: number; unmasking: number };
  enriched?: { exists: boolean; total: number; breakdown: Breakdown[] };
  profile?: { exists: boolean; total: number; breakdown: Breakdown[] };
};

const RISK_COLORS: Record<string, string> = {
  TIER1_CRITICAL: "bg-red-500/10 text-red-400 border-red-500/30",
  SHELL_COMPANY: "bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/30",
  TIER2_HIGH: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  TIER3_MEDIUM: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  HIGH_THREAT: "bg-red-500/10 text-red-400 border-red-500/30",
  FLAGGED: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  DARK_AIRCRAFT: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  NORMAL: "bg-muted text-muted-foreground border-border",
};

export function UnificationPipelinePanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action: "getUnificationStatus" },
      });
      if (error) throw error;
      setStatus(data);
    } catch (e) {
      toast.error("Failed to fetch unification status");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const run = async (action: "buildEnrichedDetections" | "buildAircraftMasterProfile") => {
    setRunning(action);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: { action, dryRun },
      });
      if (error) throw error;
      setLastResult({ action, ...data });
      if (data?.ok || data?.dryRun) {
        toast.success(`${action} ${dryRun ? "(dry run) " : ""}completed`);
        if (!dryRun) fetchStatus();
      } else {
        toast.error(data?.error || `${action} failed`);
      }
    } catch (e: any) {
      toast.error(e?.message || `${action} failed`);
    } finally {
      setRunning(null);
    }
  };

  return (
    <CyberPanel
      title="DATA UNIFICATION PIPELINE"
      icon={<Layers className="w-4 h-4" />}
      className="col-span-full"
      headerActions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Dry Run</span>
            <Switch checked={dryRun} onCheckedChange={setDryRun} />
          </div>
          <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Source counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Unified Detections (view)", value: status?.sources?.unified_view },
            { label: "Registry Enhanced", value: status?.sources?.registry },
            { label: "Public ADS-B", value: status?.sources?.public_atc },
            { label: "Unmasking Records", value: status?.sources?.unmasking },
          ].map((s) => (
            <div key={s.label} className="bg-card/50 rounded-lg p-3 border border-border/50">
              <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
              <div className="text-xl font-bold">
                {s.value != null ? Number(s.value).toLocaleString() : "—"}
              </div>
            </div>
          ))}
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PipelineCard
            title="Enriched Flight Detections"
            icon={<Database className="h-5 w-5 text-blue-400" />}
            description="Joins unified detections with registry, public ADS-B, and unmasking intel. Adds risk_classification per detection."
            target="enriched_flight_detections"
            exists={!!status?.enriched?.exists}
            total={status?.enriched?.total || 0}
            breakdown={status?.enriched?.breakdown || []}
            running={running === "buildEnrichedDetections"}
            disabled={!!running}
            onRun={() => run("buildEnrichedDetections")}
          />
          <PipelineCard
            title="Aircraft Master Profile"
            icon={<Plane className="h-5 w-5 text-purple-400" />}
            description="One row per aircraft. Aggregates all detections + registry + public sightings + unmasking."
            target="aircraft_master_profile"
            exists={!!status?.profile?.exists}
            total={status?.profile?.total || 0}
            breakdown={status?.profile?.breakdown || []}
            running={running === "buildAircraftMasterProfile"}
            disabled={!!running}
            onRun={() => run("buildAircraftMasterProfile")}
          />
        </div>

        {/* Last result */}
        {lastResult && (
          <div className="bg-card/30 rounded-lg p-3 border border-border/30">
            <div className="text-xs text-muted-foreground mb-2">
              Last run: <span className="text-foreground font-mono">{lastResult.action}</span>
              {lastResult.duration_ms != null && ` · ${lastResult.duration_ms}ms`}
            </div>
            <pre className="text-xs bg-background/50 p-2 rounded overflow-auto max-h-64">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </CyberPanel>
  );
}

function PipelineCard({
  title, icon, description, target, exists, total, breakdown, running, disabled, onRun,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  target: string;
  exists: boolean;
  total: number;
  breakdown: Breakdown[];
  running: boolean;
  disabled: boolean;
  onRun: () => void;
}) {
  return (
    <div className="bg-card/50 rounded-lg p-4 border border-border/50 space-y-3">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-background/50">{icon}</div>
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-1">{description}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-1">→ {target}</div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm">
          {exists ? (
            <>
              <span className="text-muted-foreground">Rows: </span>
              <span className="font-bold">{Number(total).toLocaleString()}</span>
            </>
          ) : (
            <Badge variant="outline" className="text-xs">Not built</Badge>
          )}
        </div>
        <Button size="sm" onClick={onRun} disabled={disabled} className="gap-2">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {running ? "Building…" : exists ? "Rebuild" : "Build"}
        </Button>
      </div>

      {breakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/30">
          {breakdown.map((b) => (
            <Badge
              key={b.risk_classification}
              variant="outline"
              className={`text-[10px] ${RISK_COLORS[b.risk_classification] || RISK_COLORS.NORMAL}`}
            >
              {b.risk_classification}: {Number(b.cnt).toLocaleString()}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

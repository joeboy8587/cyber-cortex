import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plane, Building2, ShieldAlert, FileUp } from "lucide-react";
import { toast } from "sonner";

type Props = { nodeId: string | null };

export function ProfileDrawer({ nodeId }: Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [promoting, setPromoting] = useState(false);

  useEffect(() => {
    if (!nodeId) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: resp, error } = await supabase.functions.invoke("entity-graph-build", {
          body: { action: "profile", nodeId },
        });
        if (error) throw error;
        if (!cancelled) setData(resp);
      } catch (e: any) {
        toast.error(e.message || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nodeId]);

  const promote = async () => {
    if (!data?.node) return;
    setPromoting(true);
    try {
      const n = data.node;
      const summary = buildSummary(n, data);
      const { error } = await supabase.from("watchtower_autonomous_flags").insert({
        flag_type: "NETWORK_HUB",
        severity: Number(n.risk_score) >= 70 ? "critical" : "high",
        registration: n.registration,
        description: summary,
        evidence_summary: {
          node_id: n.node_id, risk_score: n.risk_score, centrality: n.centrality,
          detections: n.detections, flag_count: n.flag_count,
          aoi_min_mi: n.aoi_min_mi, operator: n.operator,
          fleet: (data.fleet || []).map((f: any) => f.registration),
          behavioural_twins: (data.twins || []).map((t: any) => t.registration),
        },
        confidence_score: Math.min(0.99, (Number(n.risk_score) || 0) / 100),
        source_scan_id: "network-intel-profile",
      });
      if (error) throw error;
      toast.success("Profile promoted to the findings register");
    } catch (e: any) {
      toast.error(e.message || "Promotion failed");
    } finally {
      setPromoting(false);
    }
  };

  if (!nodeId) {
    return (
      <Card className="p-6 h-full flex items-center justify-center text-sm text-muted-foreground text-center">
        Select any node in the graph to open its profile.
      </Card>
    );
  }
  if (loading) {
    return <Card className="p-6 h-full flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin" /></Card>;
  }
  if (!data?.node) {
    return <Card className="p-6 h-full text-sm text-muted-foreground">No profile available for this node.</Card>;
  }

  const n = data.node;
  const isOp = n.node_type === "operator";

  return (
    <Card className="p-4 h-full flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            {isOp ? <Building2 className="w-4 h-4 text-amber-400" /> : <Plane className="w-4 h-4 text-primary" />}
            <span className="font-display text-lg tracking-wide">{n.label}</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-1">
            {isOp ? `${n.operator_type || "Registrant"} · ${[n.operator_city, n.operator_state].filter(Boolean).join(", ") || "—"}`
                  : `${n.aircraft_type || "Type unknown"} · HEX ${n.icao_hex || "—"}`}
          </div>
        </div>
        <Badge variant={Number(n.risk_score) >= 70 ? "destructive" : "secondary"} className="font-mono">
          RISK {Number(n.risk_score || 0).toFixed(0)}
        </Badge>
      </div>

      {!isOp && (
        <div className="text-xs bg-muted/30 border border-border rounded p-3 mb-3 leading-relaxed">
          {buildSummary(n, data)}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          ["Detections", Number(n.detections || 0).toLocaleString()],
          ["Days active", n.days_active ?? "—"],
          ["Flags", n.flag_count ?? 0],
          ["Critical flags", n.critical_flags ?? 0],
          ["Closest AOI", n.aoi_min_mi != null ? `${Number(n.aoi_min_mi).toFixed(1)} mi` : "—"],
          ["AOI pings", Number(n.aoi_pings || 0).toLocaleString()],
          ["Night ops", pct(n.night_pct)],
          ["Below 1,000 ft", pct(n.low_alt_pct)],
          ["Sub-stall", pct(n.sub_stall_pct)],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] font-mono uppercase text-muted-foreground">{l}</div>
            <div className="text-sm font-mono">{String(v)}</div>
          </div>
        ))}
      </div>

      <ScrollArea className="flex-1 pr-2">
        {!!data.fleet?.length && (
          <Section title={`Fleet siblings (${data.fleet.length})`}>
            {data.fleet.map((f: any) => (
              <Row key={f.registration} left={f.registration}
                   mid={f.aircraft_type || "—"}
                   right={`risk ${Number(f.risk_score || 0).toFixed(0)}`} />
            ))}
          </Section>
        )}
        {!!data.twins?.length && (
          <Section title="Behavioural twins (learned)">
            {data.twins.map((t: any, i: number) => (
              <Row key={i} left={t.registration || "—"} mid={t.operator || "unresolved"}
                   right={`${(Number(t.similarity) * 100).toFixed(1)}%`} />
            ))}
          </Section>
        )}
        {!!data.neighbors?.length && (
          <Section title="Graph links">
            {data.neighbors.map((nb: any, i: number) => (
              <Row key={i} left={nb.label || nb.other} mid={nb.edge_type}
                   right={nb.detail || `w ${Number(nb.weight).toFixed(0)}`} />
            ))}
          </Section>
        )}
      </ScrollArea>

      <Button size="sm" className="mt-3" onClick={promote} disabled={promoting}>
        {promoting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
        Promote profile to findings register
      </Button>
    </Card>
  );
}

function buildSummary(n: any, data: any) {
  const bits: string[] = [];
  bits.push(`${n.registration || n.label} is registered to ${n.operator || "no FAA registrant of record (ghost / unregistered)"}.`);
  bits.push(`${Number(n.detections || 0).toLocaleString()} detections across ${n.days_active || 0} active days.`);
  if (n.aoi_min_mi != null && Number(n.aoi_min_mi) <= 10)
    bits.push(`Closed to ${Number(n.aoi_min_mi).toFixed(1)} mi of the primary AOI (${Number(n.aoi_pings || 0).toLocaleString()} pings inside 10 mi).`);
  if (Number(n.low_alt_pct) > 0.1) bits.push(`${pct(n.low_alt_pct)} of pings below 1,000 ft.`);
  if (Number(n.sub_stall_pct) > 0.05) bits.push(`${pct(n.sub_stall_pct)} of pings below Cessna stall speed — drone or spoofed telemetry indicator.`);
  if (Number(n.night_pct) > 0.3) bits.push(`${pct(n.night_pct)} night operations.`);
  if (Number(n.flag_count) > 0) bits.push(`${n.flag_count} open findings (${n.critical_flags || 0} critical).`);
  if (data?.fleet?.length > 1) bits.push(`Part of a ${data.fleet.length}-airframe fleet under the same registrant.`);
  if (data?.twins?.length) bits.push(`${data.twins.length} behavioural twins flying the same signature under different ownership.`);
  return bits.join(" ");
}

const pct = (v: any) => v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3" /> {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ left, mid, right }: { left: string; mid: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] font-mono border-b border-border/50 py-1">
      <span className="text-primary truncate max-w-[35%]">{left}</span>
      <span className="text-muted-foreground truncate max-w-[35%]">{mid}</span>
      <span className="truncate max-w-[30%] text-right">{right}</span>
    </div>
  );
}

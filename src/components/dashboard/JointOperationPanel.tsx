import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Radar, ShieldAlert } from "lucide-react";
import { downloadCSV } from "@/lib/csv";

interface JointEvent {
  le_tail: string;
  le_model: string | null;
  le_agency: string | null;
  mil_id: string;
  mil_hex: string;
  mil_callsign: string | null;
  first_seen: string;
  last_seen: string;
  ping_pairs: number;
  min_nm: number;
  avg_nm: number;
  le_min_alt_ft: number | null;
  mil_min_alt_ft: number | null;
  lat: number;
  lng: number;
  confidence: number;
  statute: string;
}

const WINDOWS = [
  { label: "48 h", hours: 48 },
  { label: "7 d", hours: 168 },
  { label: "30 d", hours: 720 },
];

export function JointOperationPanel() {
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(48);
  const [events, setEvents] = useState<JointEvent[] | null>(null);
  const [flagsWritten, setFlagsWritten] = useState(0);

  const runScan = async (h: number) => {
    setHours(h);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("joint-operation-scan", {
        body: { hours: h },
      });
      if (error) throw error;
      const payload = (data as { data?: { events?: JointEvent[]; flags_written?: number } })?.data;
      setEvents(payload?.events ?? []);
      setFlagsWritten(payload?.flags_written ?? 0);
      toast.success(
        `${payload?.events?.length ?? 0} joint-operation events • ${payload?.flags_written ?? 0} flags filed`,
      );
    } catch (e) {
      toast.error(`Scan failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="font-display uppercase tracking-wider text-destructive flex items-center gap-2">
            <ShieldAlert className="h-5 w-5" />
            Military ↔ Law Enforcement Joint Operations
          </CardTitle>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            SIMULTANEOUS CO-PRESENCE (≤10 nm, ±5 min) // 18 U.S.C. § 1385 POSSE COMITATUS SIGNATURE
          </p>
        </div>
        <div className="flex gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w.hours}
              size="sm"
              variant={hours === w.hours ? "default" : "outline"}
              disabled={loading}
              onClick={() => runScan(w.hours)}
            >
              {loading && hours === w.hours ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Radar className="h-3 w-3" />
              )}
              <span className="ml-1">{w.label}</span>
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {events === null && (
          <p className="text-sm text-muted-foreground">
            Run a scan to detect law-enforcement airframes operating in the same airspace, at the same
            moment, as military-registered aircraft. Confirmed events are filed automatically as critical
            autonomous flags.
          </p>
        )}

        {events !== null && (
          <div className="flex items-center gap-3 text-xs font-mono">
            <Badge variant="destructive">{events.length} EVENTS</Badge>
            <Badge variant="outline">{flagsWritten} FLAGS FILED</Badge>
            {events.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  downloadCSV(
                    events as unknown as Record<string, unknown>[],
                    `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_POSSE_JOINTOPS.csv`,
                  )
                }
              >
                Export CSV
              </Button>
            )}
          </div>
        )}

        {events?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No simultaneous military / law-enforcement co-presence in this window.
          </p>
        )}

        <div className="space-y-2">
          {events?.map((e, i) => (
            <div
              key={`${e.le_tail}-${e.mil_hex}-${i}`}
              className="rounded border border-destructive/30 bg-destructive/5 p-3 space-y-1"
            >
              <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                <span className="font-bold text-primary">{e.le_tail}</span>
                <span className="text-muted-foreground">{e.le_model}</span>
                <span className="text-destructive">↔</span>
                <span className="font-bold text-destructive">{e.mil_id}</span>
                <span className="text-muted-foreground">hex {e.mil_hex}</span>
                <Badge variant="destructive" className="ml-auto">
                  {e.min_nm} nm
                </Badge>
                <Badge variant="outline">conf {(e.confidence * 100).toFixed(0)}%</Badge>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {new Date(e.first_seen).toLocaleString()} → {new Date(e.last_seen).toLocaleTimeString()} •{" "}
                {e.ping_pairs} synchronized ping pairs • LE min alt {e.le_min_alt_ft ?? "—"} ft • MIL min alt{" "}
                {e.mil_min_alt_ft ?? "—"} ft • {e.lat.toFixed(4)}, {e.lng.toFixed(4)}
              </div>
              <div className="font-mono text-[11px] text-destructive/80">{e.statute}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

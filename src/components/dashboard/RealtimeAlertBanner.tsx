import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Plane, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LiveAlert {
  registration: string;
  callsign: string | null;
  altitude: number | null;
  speed: number | null;
  detection_timestamp: string;
  severity: "critical" | "high" | "watch";
  reason: string;
}

const WATCHLIST = new Set([
  "N912KC","N913KC","N597E","N790FA","N788FA","N791FA","N787FA",
  "N2464D","N997SE","N743AM","N229AM","N139HP","N156HP","N74FF","N34AK",
]);

// Real-time alert banner: polls last 10 minutes of detections every 30s
// and surfaces watchlist hits, sub-stall flights, and critical low-altitude events.
export const RealtimeAlertBanner = () => {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [idx, setIdx] = useState(0);

  const scan = useCallback(async () => {
    try {
      // Keep the query cheap: narrow time window + small LIMIT to avoid
      // 120s edge function budget on the large detections table.
      const { data, error } = await supabase.functions.invoke("neon-query", {
        body: {
          action: "customQuery",
          query: `
            SELECT registration, callsign, altitude, speed, detection_timestamp
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '3 minutes'
              AND registration IS NOT NULL
            ORDER BY detection_timestamp DESC
            LIMIT 50
          `,
          timeout: 15000,
        },
      });
      if (error || !data?.data) return;

      const seen = new Set<string>();
      const next: LiveAlert[] = [];
      for (const r of data.data as any[]) {
        const reg = (r.registration || "").toUpperCase();
        if (!reg || seen.has(reg)) continue;
        const alt = r.altitude != null ? Number(r.altitude) : null;
        const spd = r.speed != null ? Number(r.speed) : null;
        let severity: LiveAlert["severity"] | null = null;
        let reason = "";

        if (WATCHLIST.has(reg)) {
          severity = "critical";
          reason = "Watchlist asset airborne";
        } else if (alt !== null && alt > 0 && alt < 500) {
          severity = "critical";
          reason = `Critical low altitude (${alt}ft)`;
        } else if (spd !== null && spd > 0 && spd < 48) {
          severity = "high";
          reason = `Sub-stall speed (${spd}kts) — drone/spoof`;
        } else if (alt !== null && alt > 0 && alt < 1000) {
          severity = "high";
          reason = `Low altitude (${alt}ft)`;
        }

        if (severity) {
          seen.add(reg);
          next.push({
            registration: reg,
            callsign: r.callsign,
            altitude: alt,
            speed: spd,
            detection_timestamp: r.detection_timestamp,
            severity,
            reason,
          });
        }
      }
      // critical first
      next.sort((a, b) =>
        a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1
      );
      setAlerts(next.filter((a) => !dismissed.has(a.registration + a.detection_timestamp)));
    } catch {
      /* ignore */
    }
  }, [dismissed]);

  useEffect(() => {
    scan();
    const t = setInterval(scan, 30000);
    return () => clearInterval(t);
  }, [scan]);

  // Rotate through alerts every 5s
  useEffect(() => {
    if (alerts.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % alerts.length), 5000);
    return () => clearInterval(t);
  }, [alerts.length]);

  if (alerts.length === 0) return null;
  const current = alerts[idx % alerts.length];
  const sevClass =
    current.severity === "critical"
      ? "bg-destructive/15 border-destructive/40 text-destructive"
      : current.severity === "high"
      ? "bg-orange-500/15 border-orange-500/40 text-orange-400"
      : "bg-yellow-500/15 border-yellow-500/40 text-yellow-400";
  const Icon = current.severity === "critical" ? AlertTriangle : Radio;

  const dismiss = () => {
    const key = current.registration + current.detection_timestamp;
    setDismissed((d) => new Set(d).add(key));
    setAlerts((a) => a.filter((x) => x.registration + x.detection_timestamp !== key));
  };

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 border-b text-xs font-mono ${sevClass}`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${
          current.severity === "critical" ? "animate-pulse" : ""
        }`}
      />
      <span className="font-bold uppercase tracking-wide shrink-0">
        {current.severity}
      </span>
      <Plane className="h-3 w-3 shrink-0 opacity-70" />
      <span className="font-bold shrink-0">{current.registration}</span>
      {current.callsign && (
        <span className="opacity-70 shrink-0 hidden sm:inline">
          [{current.callsign}]
        </span>
      )}
      <span className="truncate flex-1">{current.reason}</span>
      <span className="opacity-60 shrink-0 hidden md:inline">
        {new Date(current.detection_timestamp).toLocaleTimeString()}
      </span>
      <span className="opacity-60 shrink-0">
        {idx % alerts.length + 1}/{alerts.length}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        className="h-5 w-5 shrink-0"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};

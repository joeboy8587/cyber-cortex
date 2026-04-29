// Detection freshness watchdog — flags any source whose latest record is stale.
// GET / POST -> returns array of { table, last_seen, minutes_stale, status }
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface WatchTarget {
  table: string;
  ts_col: string;
  cast?: string; // optional cast expression for text columns
  threshold_min: number; // stale threshold in minutes
}

const TARGETS: WatchTarget[] = [
  { table: "live_flight_detections_rows", ts_col: "detection_timestamp", threshold_min: 10 },
  { table: "watchtower_alerts", ts_col: "created_at", threshold_min: 30 },
  { table: "sentinel_alerts", ts_col: "created_at", threshold_min: 30 },
  { table: "sentinel_learned_threats", ts_col: "updated_at", threshold_min: 60 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!neonUrl) {
    return new Response(
      JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const sql = postgres(neonUrl, { max: 1, idle_timeout: 5, connect_timeout: 8 });
  const results: any[] = [];

  try {
    for (const t of TARGETS) {
      try {
        const expr = t.cast ? `(${t.ts_col})::${t.cast}` : t.ts_col;
        // 7-day window keeps the query fast even on 4M+ row tables
        const rows = await sql.unsafe(
          `SELECT MAX(${expr}) AS last_seen
           FROM ${t.table}
           WHERE ${expr} > NOW() - INTERVAL '7 days'`,
        );
        const lastSeen = rows[0]?.last_seen ?? null;
        const minutesStale = lastSeen
          ? Math.round((Date.now() - new Date(lastSeen).getTime()) / 60000)
          : null;
        const status = !lastSeen
          ? "DEAD"
          : minutesStale! > t.threshold_min
          ? "STALE"
          : "FRESH";
        results.push({
          table: t.table,
          last_seen: lastSeen,
          minutes_stale: minutesStale,
          threshold_minutes: t.threshold_min,
          status,
        });
      } catch (e) {
        results.push({
          table: t.table,
          status: "ERROR",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } finally {
    try { await sql.end(); } catch { /* ignore */ }
  }

  const summary = {
    fresh: results.filter((r) => r.status === "FRESH").length,
    stale: results.filter((r) => r.status === "STALE").length,
    dead: results.filter((r) => r.status === "DEAD").length,
    errors: results.filter((r) => r.status === "ERROR").length,
  };

  return new Response(
    JSON.stringify({ summary, results, checked_at: new Date().toISOString() }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

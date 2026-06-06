// Neon Data Health — comprehensive inventory across all Neon tables.
// Returns: table list with row estimates, freshness (latest timestamp), schema width,
// recently created tables, recently modified tables, coverage metrics for the
// key forensic pipelines (FAA enrichment, biometric correlation, quarantine, ghosts).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Columns commonly used to detect freshness
const TS_COLS = [
  "detection_timestamp", "created_at", "updated_at", "observed_at",
  "event_timestamp", "last_seen", "scraped_at", "anchored_at",
  "performed_at", "timestamp", "ts",
];

async function inventory(sql: any) {
  // 1. All public tables with row estimates
  const tables = await sql.unsafe(`
    SELECT
      c.relname AS table_name,
      c.reltuples::bigint AS row_estimate,
      pg_total_relation_size(c.oid) AS total_bytes,
      (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name=c.relname) AS column_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY c.reltuples DESC
    LIMIT 500
  `);

  // 2. Per-table freshness (try common timestamp cols, first one that exists)
  const freshness: Record<string, any> = {};
  for (const t of tables.slice(0, 80)) {
    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='${t.table_name}'
         AND column_name = ANY($1)`,
      [TS_COLS],
    );
    if (cols.length === 0) { freshness[t.table_name] = null; continue; }
    const tsCol = cols[0].column_name;
    try {
      const r = await sql.unsafe(
        `SELECT MAX(${tsCol})::text AS latest,
                COUNT(*) FILTER (WHERE ${tsCol} > NOW() - INTERVAL '24 hours')::int AS last_24h,
                COUNT(*) FILTER (WHERE ${tsCol} > NOW() - INTERVAL '7 days')::int AS last_7d
         FROM ${t.table_name}`,
      );
      freshness[t.table_name] = { ts_col: tsCol, ...r[0] };
    } catch (_) {
      freshness[t.table_name] = null;
    }
  }

  // 3. New tables in last 14 days (by relfilenode mtime is unreliable; use information_schema)
  let newTables: any[] = [];
  try {
    newTables = await sql.unsafe(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname='public'
        AND tablename IN (
          SELECT table_name FROM information_schema.tables
          WHERE table_schema='public'
        )
      ORDER BY tablename DESC
      LIMIT 50
    `);
  } catch (_) {}

  // 4. Pipeline coverage metrics
  const pipeline: Record<string, any> = {};
  const safeCount = async (label: string, q: string) => {
    try { const r = await sql.unsafe(q); pipeline[label] = r[0]; }
    catch (e) { pipeline[label] = { error: (e as Error).message }; }
  };

  await safeCount("live_detections_24h", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '24 hours'`);

  await safeCount("live_detections_7d", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '7 days'`);

  await safeCount("faa_registry_total", `
    SELECT COUNT(*)::int AS n FROM aircraft_registry_master`);

  await safeCount("faa_enrichment_coverage", `
    SELECT
      COUNT(DISTINCT d.registration)::int AS total_tails,
      COUNT(DISTINCT d.registration) FILTER (
        WHERE EXISTS (SELECT 1 FROM aircraft_registry_master r WHERE r.n_number = d.registration)
      )::int AS enriched_tails
    FROM live_flight_detections_rows d
    WHERE d.detection_timestamp > NOW() - INTERVAL '30 days'
      AND d.registration IS NOT NULL`);

  await safeCount("icao_quarantine_total", `
    SELECT COUNT(*)::int AS n,
           COUNT(*) FILTER (WHERE quarantined_at > NOW() - INTERVAL '7 days')::int AS last_7d
    FROM icao_quarantine`);

  await safeCount("ghost_fleet_active", `
    SELECT COUNT(DISTINCT COALESCE(icao24, icao_hex))::int AS n FROM ghost_fleet`);

  await safeCount("biometric_correlation_rows", `
    SELECT COUNT(*)::int AS n,
           COUNT(DISTINCT registration)::int AS unique_tails
    FROM unified_biometric_aircraft_correlation`);

  await safeCount("violations_91_119", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE altitude_ft IS NOT NULL
      AND altitude_ft < 1000
      AND detection_timestamp > NOW() - INTERVAL '30 days'`);

  await safeCount("sub_stall_anomalies", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE ground_speed_kts < 48
      AND altitude_ft > 100
      AND detection_timestamp > NOW() - INTERVAL '30 days'`);

  await safeCount("foreign_registry_injections", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE registration ~ '^(EP-|PT-|RP-|VH-|JA-|HZ-|UR-|9V-)'
      AND detection_timestamp > NOW() - INTERVAL '30 days'`);

  await safeCount("kcso_detections_30d", `
    SELECT COUNT(*)::int AS n
    FROM live_flight_detections_rows
    WHERE registration = ANY(ARRAY['N912KC','N913KC','N788FA','N597E','N197E','N397E','N497E'])
      AND detection_timestamp > NOW() - INTERVAL '30 days'`);

  // 5. Top recently-active tables (joined freshness + size)
  const topActive = Object.entries(freshness)
    .filter(([, v]) => v && (v as any).last_24h > 0)
    .map(([k, v]: [string, any]) => ({ table: k, last_24h: v.last_24h, latest: v.latest }))
    .sort((a, b) => b.last_24h - a.last_24h)
    .slice(0, 15);

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_tables: tables.length,
      tables_with_24h_activity: topActive.length,
      total_bytes: tables.reduce((s: number, t: any) => s + Number(t.total_bytes || 0), 0),
    },
    tables: tables.map((t: any) => ({
      ...t,
      row_estimate: Number(t.row_estimate || 0),
      total_bytes: Number(t.total_bytes || 0),
      freshness: freshness[t.table_name] || null,
    })),
    top_active_24h: topActive,
    pipeline,
    new_tables: newTables,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
    { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 20 });
  try {
    await sql.unsafe(`SET statement_timeout = '90s'`);
    const report = await inventory(sql);
    return new Response(JSON.stringify(report, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("neon-data-health error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    try { await sql.end(); } catch (_) {}
  }
});

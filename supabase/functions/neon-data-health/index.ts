// Neon Data Health — fast, budgeted inventory across Neon.
// Design rules (v2):
//  * ONE catalog pass for sizes/rows/columns (pg_class + pg_stat_user_tables) — no per-table loops.
//  * Freshness probes ONLY for a small whitelist of pipeline tables, each with its own timeout.
//  * Hard global budget: return partial results instead of a 504.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUDGET_MS = 60_000;
const PROBE_MS = 6_000;

// Tables we actively care about for freshness, with their timestamp column.
const FRESHNESS_TARGETS: Array<[string, string]> = [
  ["live_flight_detections_rows", "detection_timestamp"],
  ["enriched_detections", "detection_timestamp"],
  ["unified_biometric_aircraft_correlation", "detection_timestamp"],
  ["icao_quarantine", "quarantined_at"],
  ["ghost_fleet", "last_seen"],
  ["aircraft_dossier", "updated_at"],
  ["detection_county_map", "derived_at"],
  ["threat_tiers", "computed_at"],
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) {
    return json({ error: "NEON_DATABASE_URL not configured" }, 500);
  }

  const started = Date.now();
  const left = () => BUDGET_MS - (Date.now() - started);
  const errors: Record<string, string> = {};
  let partial = false;

  const sql = postgres(NEON, { ssl: "require", max: 3, idle_timeout: 20, prepare: false });

  // Run a query on its own reserved connection with a hard statement timeout.
  const run = async (label: string, q: string, ms = PROBE_MS): Promise<any[] | null> => {
    if (left() < 3000) { partial = true; errors[label] = "skipped: budget exhausted"; return null; }
    const budget = Math.min(ms, Math.max(2000, left() - 2000));
    try {
      const reserved = await sql.reserve();
      try {
        await reserved.unsafe(`SET statement_timeout = ${Math.round(budget)}`);
        return (await reserved.unsafe(q)) as unknown as any[];
      } finally { reserved.release(); }
    } catch (e) {
      partial = true;
      errors[label] = String((e as Error).message || e).slice(0, 200);
      return null;
    }
  };

  try {
    // ---------- 1. Single catalog pass ----------
    const catalog = await run("catalog", `
      SELECT
        c.relname                                        AS table_name,
        GREATEST(c.reltuples, 0)::bigint                 AS row_estimate,
        pg_total_relation_size(c.oid)                    AS total_bytes,
        c.relnatts                                       AS column_count,
        s.n_live_tup::bigint                             AS live_tuples,
        s.n_dead_tup::bigint                             AS dead_tuples,
        GREATEST(s.last_analyze, s.last_autoanalyze)::text AS last_analyze,
        GREATEST(s.last_vacuum, s.last_autovacuum)::text   AS last_vacuum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      ORDER BY c.reltuples DESC
      LIMIT 600
    `, 15_000) ?? [];

    const known = new Set(catalog.map((t: any) => t.table_name));

    // ---------- 2. Targeted freshness probes ----------
    const freshness: Record<string, any> = {};
    const targets = FRESHNESS_TARGETS.filter(([t]) => known.has(t));
    const probes = await Promise.all(targets.map(async ([table, col]) => {
      const r = await run(`fresh:${table}`, `
        SELECT MAX(${col})::text AS latest,
               COUNT(*) FILTER (WHERE ${col} > NOW() - INTERVAL '24 hours')::int AS last_24h,
               COUNT(*) FILTER (WHERE ${col} > NOW() - INTERVAL '7 days')::int  AS last_7d
        FROM ${table}
        WHERE ${col} > NOW() - INTERVAL '7 days'
      `, PROBE_MS);
      // The windowed query gives 24h/7d counts fast; grab the true MAX separately (index-only).
      const maxRow = await run(`max:${table}`, `SELECT MAX(${col})::text AS latest FROM ${table}`, PROBE_MS);
      return [table, {
        ts_col: col,
        latest: maxRow?.[0]?.latest ?? r?.[0]?.latest ?? null,
        last_24h: Number(r?.[0]?.last_24h ?? 0),
        last_7d: Number(r?.[0]?.last_7d ?? 0),
      }] as const;
    }));
    for (const [t, v] of probes) freshness[t] = v;

    // ---------- 3. Pipeline coverage (cheap, indexed, windowed) ----------
    const pipeline: Record<string, any> = {};
    const pipe = async (label: string, q: string) => {
      const r = await run(`pipe:${label}`, q, PROBE_MS);
      pipeline[label] = r ? r[0] : { error: errors[`pipe:${label}`] || "timeout" };
    };
    const pipeSlow = async (label: string, q: string) => {
      const r = await run(`pipe:${label}`, q, 15_000);
      pipeline[label] = r ? r[0] : { error: errors[`pipe:${label}`] || "timeout" };
    };

    await pipe("live_detections_24h", `
      SELECT COUNT(*)::int AS n FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '24 hours'`);
    await pipe("live_detections_7d", `
      SELECT COUNT(*)::int AS n FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '7 days'`);
    await pipe("faa_registry_total", `
      SELECT GREATEST(reltuples,0)::int AS n FROM pg_class
      WHERE relname = 'faa_master'`);
    await pipeSlow("faa_enrichment_coverage", `
      WITH tails AS (
        SELECT DISTINCT registration FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '24 hours' AND registration IS NOT NULL
      )
      SELECT COUNT(*)::int AS total_tails,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM faa_master r
               WHERE r.n_number = t.registration OR r.n_number = ltrim(t.registration, 'N')
             ))::int AS enriched_tails
      FROM tails t`);
    await pipe("icao_quarantine_total", `
      SELECT GREATEST(reltuples,0)::int AS n, 0 AS last_7d FROM pg_class WHERE relname='icao_quarantine'`);
    await pipe("ghost_fleet_active", `
      SELECT GREATEST(reltuples,0)::int AS n FROM pg_class WHERE relname='ghost_fleet'`);
    await pipe("biometric_correlation_rows", `
      SELECT GREATEST(reltuples,0)::int AS n, 0 AS unique_tails FROM pg_class
      WHERE relname='unified_biometric_aircraft_correlation'`);
    await pipeSlow("violations_91_119", `
      SELECT COUNT(*)::int AS n FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        AND altitude IS NOT NULL AND altitude < 1000`);
    await pipeSlow("sub_stall_anomalies", `
      SELECT COUNT(*)::int AS n FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        AND speed < 48 AND altitude > 100`);
    await pipe("kcso_detections_30d", `
      SELECT COUNT(*)::int AS n FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        AND registration = ANY(ARRAY['N912KC','N913KC','N788FA','N597E','N197E','N397E','N497E'])`);

    // ---------- 4. Maintenance hygiene ----------
    const staleStats = catalog
      .filter((t: any) => Number(t.row_estimate) > 250_000)
      .map((t: any) => ({
        table: t.table_name,
        rows: Number(t.row_estimate),
        last_analyze: t.last_analyze,
        dead_tuples: Number(t.dead_tuples || 0),
        stale_days: t.last_analyze
          ? Math.floor((Date.now() - new Date(t.last_analyze).getTime()) / 86_400_000)
          : null,
      }))
      .filter((t) => t.stale_days === null || t.stale_days > 7)
      .slice(0, 25);

    const topActive = Object.entries(freshness)
      .filter(([, v]: [string, any]) => v && v.last_24h > 0)
      .map(([k, v]: [string, any]) => ({ table: k, last_24h: v.last_24h, latest: v.latest }))
      .sort((a, b) => b.last_24h - a.last_24h);

    return json({
      generated_at: new Date().toISOString(),
      partial,
      duration_ms: Date.now() - started,
      errors,
      summary: {
        total_tables: catalog.length,
        tables_with_24h_activity: topActive.length,
        total_bytes: catalog.reduce((s: number, t: any) => s + Number(t.total_bytes || 0), 0),
        stale_stats_tables: staleStats.length,
      },
      tables: catalog.map((t: any) => ({
        table_name: t.table_name,
        row_estimate: Number(t.row_estimate || 0),
        total_bytes: Number(t.total_bytes || 0),
        column_count: Number(t.column_count || 0),
        last_analyze: t.last_analyze,
        last_vacuum: t.last_vacuum,
        dead_tuples: Number(t.dead_tuples || 0),
        freshness: freshness[t.table_name] || null,
      })),
      top_active_24h: topActive,
      stale_stats: staleStats,
      pipeline,
      new_tables: [],
    });
  } catch (e) {
    console.error("neon-data-health error:", e);
    return json({ error: (e as Error).message, partial: true, errors }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (_) { /* ignore */ }
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Returns live population-scale stats so prompts and dashboard banners stay in sync with reality.
// Best-effort: any sub-query that fails (table missing, etc.) falls back to a sensible default.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { FALLBACK_STATS, type PopulationScaleStats } from "../_shared/doctrine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// In-memory cache (per isolate) — 1h
let cache: { at: number; stats: PopulationScaleStats } | null = null;
const TTL_MS = 60 * 60 * 1000;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

async function findFirstTable(sql: ReturnType<typeof postgres>, candidates: string[]): Promise<string | null> {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name = ANY(${candidates})
    LIMIT 1
  `;
  return rows[0]?.table_name ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (cache && Date.now() - cache.at < TTL_MS) {
    return new Response(JSON.stringify({ stats: cache.stats, cached: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) {
    return new Response(JSON.stringify({ stats: FALLBACK_STATS, error: "NEON_DATABASE_URL missing" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sql = postgres(url, { ssl: "require", max: 2, idle_timeout: 10, connect_timeout: 8 });
  try {
    const detectionTable = await safe(
      () => findFirstTable(sql, [
        "live_flight_detections", "live_flight_detections_rows",
        "flight_detections", "aircraft_detections", "detections_master",
      ]),
      null as string | null,
    );

    const biometricTable = await safe(
      () => findFirstTable(sql, [
        "biometric_correlations", "biometric_events", "whoop_biometrics",
        "unified_biometric_aircraft_correlation",
      ]),
      null as string | null,
    );

    const lifetime = detectionTable
      ? await safe(async () => {
          const r: any = await sql.unsafe(
            `SELECT COUNT(DISTINCT registration)::int AS c FROM "${detectionTable}" WHERE registration IS NOT NULL`,
          );
          return Number(r[0]?.c ?? 0);
        }, FALLBACK_STATS.unique_aircraft_lifetime)
      : FALLBACK_STATS.unique_aircraft_lifetime;

    const last30 = detectionTable
      ? await safe(async () => {
          const tsCols = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=${detectionTable}
              AND column_name = ANY(ARRAY['detection_timestamp','observed_at','timestamp','time_position','seen_at','created_at'])
          `;
          const ts = (tsCols[0]?.column_name as string | undefined) ?? "created_at";
          const r: any = await sql.unsafe(
            `SELECT COUNT(DISTINCT registration)::int AS c FROM "${detectionTable}"
              WHERE registration IS NOT NULL AND "${ts}" > NOW() - INTERVAL '30 days'`,
          );
          return Number(r[0]?.c ?? 0);
        }, 0)
      : 0;

    const opDays = detectionTable
      ? await safe(async () => {
          const tsCols = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=${detectionTable}
              AND column_name = ANY(ARRAY['detection_timestamp','observed_at','timestamp','seen_at','created_at'])
          `;
          const ts = (tsCols[0]?.column_name as string | undefined) ?? "created_at";
          const r: any = await sql.unsafe(
            `SELECT COUNT(DISTINCT DATE("${ts}"))::int AS c FROM "${detectionTable}" WHERE "${ts}" IS NOT NULL`,
          );
          return Number(r[0]?.c ?? 0);
        }, FALLBACK_STATS.operational_days_continuous)
      : FALLBACK_STATS.operational_days_continuous;

    const biometricCollapses = biometricTable
      ? await safe(async () => {
          const r: any = await sql.unsafe(`SELECT COUNT(*)::int AS c FROM "${biometricTable}"`);
          return Number(r[0]?.c ?? 0);
        }, FALLBACK_STATS.biometric_collapses)
      : FALLBACK_STATS.biometric_collapses;

    const aoiLow = detectionTable
      ? await safe(async () => {
          const r: any = await sql.unsafe(
            `SELECT COUNT(*)::int AS c FROM "${detectionTable}"
              WHERE altitude IS NOT NULL AND altitude < 1500
                AND latitude BETWEEN 35.39 AND 35.49
                AND longitude BETWEEN -119.07 AND -118.97`,
          );
          return Number(r[0]?.c ?? 0);
        }, 0)
      : 0;

    const stats: PopulationScaleStats = {
      unique_aircraft_lifetime: lifetime,
      unique_aircraft_30d: last30,
      operational_days_continuous: opDays,
      dark_period_hours: 0,
      biometric_collapses: biometricCollapses,
      physician_verified_ecgs: FALLBACK_STATS.physician_verified_ecgs, // sourced from manual evidence registry
      aoi_low_altitude_count: aoiLow,
      posse_comitatus_pairs: FALLBACK_STATS.posse_comitatus_pairs,
      fetched_at: new Date().toISOString(),
    };

    cache = { at: Date.now(), stats };
    return new Response(JSON.stringify({ stats, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ stats: FALLBACK_STATS, error: String(e).slice(0, 200) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
});

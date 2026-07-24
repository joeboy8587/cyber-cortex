// ML Feature Store — Phase 1
// Builds per-(icao24, day) feature vectors from live_flight_detections_rows
// joined against FAA registry / policy violations / autonomous flags for labels.
// Persists to Neon table `ml_features_daily` for downstream scoring & training.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!neonUrl) return err("NEON_DATABASE_URL missing", 500);

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "build");
    const days = Math.min(Math.max(Number(body.days) || 7, 1), 30);

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '90000'`).catch(() => {});

    // Ensure feature table exists
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ml_features_daily (
        icao24 text NOT NULL,
        day date NOT NULL,
        pings int, distinct_callsigns int,
        alt_min numeric, alt_max numeric, alt_avg numeric, alt_p10 numeric, alt_p90 numeric, alt_sigma numeric,
        spd_min numeric, spd_max numeric, spd_avg numeric, spd_sigma numeric,
        sub_stall_pct numeric, zero_alt_pct numeric,
        night_pct numeric,
        aoi_min_mi numeric, aoi_avg_mi numeric, in_aoi_pct numeric,
        low_alt_pct numeric,
        faa_matched bool, faa_type text, faa_owner text,
        label_policy int DEFAULT 0,
        label_autoflag int DEFAULT 0,
        label int DEFAULT 0,
        updated_at timestamptz DEFAULT NOW(),
        PRIMARY KEY (icao24, day)
      )
    `);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ml_feat_day ON ml_features_daily(day DESC)`);
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ml_feat_label ON ml_features_daily(label) WHERE label > 0`);

    if (action === "stats") {
      const s = await sql.unsafe(`
        SELECT COUNT(*)::int AS rows,
               COUNT(DISTINCT icao24)::int AS aircraft,
               COUNT(DISTINCT day)::int AS days,
               SUM(label)::int AS labeled,
               MAX(updated_at) AS last_build
        FROM ml_features_daily
      `) as any[];
      return ok({ action, stats: s[0] || {} });
    }

    if (action === "latest") {
      const limit = Math.min(Number(body.limit) || 100, 500);
      const rows = await sql.unsafe(`
        SELECT icao24, day, pings, alt_min, alt_avg, sub_stall_pct, in_aoi_pct,
               night_pct, low_alt_pct, faa_matched, faa_type, label
        FROM ml_features_daily
        ORDER BY day DESC, pings DESC NULLS LAST
        LIMIT ${limit}
      `) as any[];
      return ok({ action, rows });
    }

    // action === "build"
    // Build features for the last N days, upsert into ml_features_daily.
    const built = await sql.unsafe(`
      WITH base AS (
        SELECT icao24, callsign,
               detection_timestamp AS ts,
               DATE(detection_timestamp) AS day,
               latitude, longitude, altitude, speed
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
          AND icao24 IS NOT NULL
      ),
      agg AS (
        SELECT icao24, day,
               COUNT(*)::int AS pings,
               COUNT(DISTINCT callsign)::int AS distinct_callsigns,
               MIN(altitude) AS alt_min, MAX(altitude) AS alt_max,
               AVG(altitude) AS alt_avg,
               percentile_cont(0.10) WITHIN GROUP (ORDER BY altitude) AS alt_p10,
               percentile_cont(0.90) WITHIN GROUP (ORDER BY altitude) AS alt_p90,
               STDDEV_POP(altitude) AS alt_sigma,
               MIN(speed) AS spd_min, MAX(speed) AS spd_max,
               AVG(speed) AS spd_avg, STDDEV_POP(speed) AS spd_sigma,
               AVG(CASE WHEN speed IS NOT NULL AND speed < 48 THEN 1.0 ELSE 0 END) AS sub_stall_pct,
               AVG(CASE WHEN altitude IS NOT NULL AND altitude <= 1 THEN 1.0 ELSE 0 END) AS zero_alt_pct,
               AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END) AS night_pct,
               AVG(CASE WHEN altitude IS NOT NULL AND altitude < 1000 THEN 1.0 ELSE 0 END) AS low_alt_pct,
               MIN(3958.8 * 2 * asin(sqrt(
                 power(sin(radians((latitude-${AOI_LAT})/2)),2) +
                 cos(radians(${AOI_LAT}))*cos(radians(latitude))*
                 power(sin(radians((longitude-${AOI_LNG})/2)),2)))) AS aoi_min_mi,
               AVG(3958.8 * 2 * asin(sqrt(
                 power(sin(radians((latitude-${AOI_LAT})/2)),2) +
                 cos(radians(${AOI_LAT}))*cos(radians(latitude))*
                 power(sin(radians((longitude-${AOI_LNG})/2)),2)))) AS aoi_avg_mi,
               AVG(CASE WHEN 3958.8 * 2 * asin(sqrt(
                 power(sin(radians((latitude-${AOI_LAT})/2)),2) +
                 cos(radians(${AOI_LAT}))*cos(radians(latitude))*
                 power(sin(radians((longitude-${AOI_LNG})/2)),2))) <= 10 THEN 1.0 ELSE 0 END) AS in_aoi_pct
        FROM base
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        GROUP BY icao24, day
        HAVING COUNT(*) >= 3
      )
      INSERT INTO ml_features_daily (
        icao24, day, pings, distinct_callsigns,
        alt_min, alt_max, alt_avg, alt_p10, alt_p90, alt_sigma,
        spd_min, spd_max, spd_avg, spd_sigma,
        sub_stall_pct, zero_alt_pct, night_pct,
        aoi_min_mi, aoi_avg_mi, in_aoi_pct, low_alt_pct,
        updated_at
      )
      SELECT icao24, day, pings, distinct_callsigns,
             alt_min, alt_max, alt_avg, alt_p10, alt_p90, alt_sigma,
             spd_min, spd_max, spd_avg, spd_sigma,
             sub_stall_pct, zero_alt_pct, night_pct,
             aoi_min_mi, aoi_avg_mi, in_aoi_pct, low_alt_pct,
             NOW()
      FROM agg
      ON CONFLICT (icao24, day) DO UPDATE SET
        pings = EXCLUDED.pings,
        distinct_callsigns = EXCLUDED.distinct_callsigns,
        alt_min = EXCLUDED.alt_min, alt_max = EXCLUDED.alt_max, alt_avg = EXCLUDED.alt_avg,
        alt_p10 = EXCLUDED.alt_p10, alt_p90 = EXCLUDED.alt_p90, alt_sigma = EXCLUDED.alt_sigma,
        spd_min = EXCLUDED.spd_min, spd_max = EXCLUDED.spd_max,
        spd_avg = EXCLUDED.spd_avg, spd_sigma = EXCLUDED.spd_sigma,
        sub_stall_pct = EXCLUDED.sub_stall_pct, zero_alt_pct = EXCLUDED.zero_alt_pct,
        night_pct = EXCLUDED.night_pct,
        aoi_min_mi = EXCLUDED.aoi_min_mi, aoi_avg_mi = EXCLUDED.aoi_avg_mi,
        in_aoi_pct = EXCLUDED.in_aoi_pct, low_alt_pct = EXCLUDED.low_alt_pct,
        updated_at = NOW()
      RETURNING 1
    `) as any[];

    // Enrich FAA (best-effort; skip if table absent)
    let faaEnriched = 0;
    try {
      const r = await sql.unsafe(`
        UPDATE ml_features_daily f
        SET faa_matched = TRUE,
            faa_type = LEFT(COALESCE(fr.type_aircraft::text, fr.mfr_mdl_code::text, ''), 60),
            faa_owner = LEFT(COALESCE(fr.name::text, ''), 120)
        FROM faa_registration_master fr
        WHERE lower(fr.mode_s_code_hex) = lower(f.icao24)
          AND f.day >= CURRENT_DATE - INTERVAL '${days} days'
          AND (f.faa_matched IS NULL OR f.faa_matched = FALSE)
        RETURNING 1
      `) as any[];
      faaEnriched = r.length;
    } catch {}

    // Label from policy_violations (public via supabase → also mirrored to neon if present)
    let policyLabeled = 0;
    try {
      const r = await sql.unsafe(`
        UPDATE ml_features_daily f
        SET label_policy = 1
        FROM policy_violations pv
        WHERE lower(pv.icao24) = lower(f.icao24)
          AND DATE(pv.violation_timestamp) = f.day
      `) as any[];
      policyLabeled = r.count ?? 0;
    } catch {}

    // Label from watchtower_autonomous_flags
    let autoLabeled = 0;
    try {
      const r = await sql.unsafe(`
        UPDATE ml_features_daily f
        SET label_autoflag = 1
        FROM watchtower_autonomous_flags wa
        WHERE lower(wa.icao24) = lower(f.icao24)
          AND DATE(wa.detected_at) = f.day
      `) as any[];
      autoLabeled = r.count ?? 0;
    } catch {}

    // Composite label
    await sql.unsafe(`
      UPDATE ml_features_daily
      SET label = GREATEST(label_policy, label_autoflag)
      WHERE day >= CURRENT_DATE - INTERVAL '${days} days'
    `);

    const stats = await sql.unsafe(`
      SELECT COUNT(*)::int AS total_rows,
             COUNT(DISTINCT icao24)::int AS aircraft,
             SUM(label)::int AS labeled_rows,
             MAX(updated_at) AS last_build
      FROM ml_features_daily
    `) as any[];

    return ok({
      action, days,
      built_or_updated: built.length,
      faa_enriched: faaEnriched,
      labeled_policy: policyLabeled,
      labeled_autoflag: autoLabeled,
      stats: stats[0] || {},
    });
  } catch (e: any) {
    return err(String(e?.message || e), 500);
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

function ok(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

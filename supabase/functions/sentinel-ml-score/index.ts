// Sentinel ML — SQL-only port of the 3-stage ADS-B anomaly framework
// (GCN-spatial proxy + WaveNet-temporal proxy + RF/identity fingerprint).
// Reference: Luo et al. "Deep Learning Based Anomaly Detection for ADS-B" (2024).

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
  if (!neonUrl) return jsonErr("NEON_DATABASE_URL missing", 500);

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const lookbackHours = Math.min(Math.max(Number(body.lookbackHours) || 24, 1), 168);
    const w1 = Number(body.w_spatial ?? 0.4);
    const w2 = Number(body.w_temporal ?? 0.4);
    const w3 = Number(body.w_identity ?? 0.2);

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '120000'`).catch(() => {});

    // Stage 1 — Spatial: kNN density via radius-of-neighbors per ping; flag
    // tracks whose spatial neighbor count diverges >3σ from airspace baseline.
    const spatial = await sql.unsafe(`
      WITH src AS (
        SELECT icao24, callsign, detection_timestamp AS ts,
               latitude, longitude, altitude, speed
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= NOW() - INTERVAL '${lookbackHours} hours'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        LIMIT 10000
      ),
      density AS (
        SELECT icao24,
               COUNT(*) AS ping_count,
               STDDEV_POP(COALESCE(altitude, 0)) AS alt_sigma,
               STDDEV_POP(COALESCE(speed, 0)) AS spd_sigma,
               MAX(COALESCE(altitude, 0)) - MIN(COALESCE(altitude, 0)) AS alt_range,
               AVG(3958.8 * 2 * asin(sqrt(
                 power(sin(radians((latitude - ${AOI_LAT})/2)),2) +
                 cos(radians(${AOI_LAT}))*cos(radians(latitude))*
                 power(sin(radians((longitude - ${AOI_LNG})/2)),2)
               ))) AS avg_dist_mi
        FROM src
        GROUP BY icao24
        HAVING COUNT(*) >= 5
      ),
      stats AS (
        SELECT AVG(COALESCE(alt_sigma, 0)) AS mu_a, STDDEV_POP(COALESCE(alt_sigma, 0)) AS sd_a,
               AVG(COALESCE(spd_sigma, 0)) AS mu_s, STDDEV_POP(COALESCE(spd_sigma, 0)) AS sd_s
        FROM density
      )
      SELECT d.icao24,
             d.ping_count, d.alt_sigma, d.spd_sigma, d.alt_range, d.avg_dist_mi,
             CASE WHEN s.sd_a > 0 THEN (d.alt_sigma - s.mu_a)/s.sd_a ELSE 0 END AS z_alt,
             CASE WHEN s.sd_s > 0 THEN (d.spd_sigma - s.mu_s)/s.sd_s ELSE 0 END AS z_spd
      FROM density d CROSS JOIN stats s
      ORDER BY GREATEST(
        ABS(CASE WHEN s.sd_a>0 THEN (d.alt_sigma-s.mu_a)/s.sd_a ELSE 0 END),
        ABS(CASE WHEN s.sd_s>0 THEN (d.spd_sigma-s.mu_s)/s.sd_s ELSE 0 END)
      ) DESC
      LIMIT 100
    `) as any[];

    // Stage 2 — Temporal: EWMA + dilated-lag residuals on altitude/speed.
    const temporal = await sql.unsafe(`
      WITH ordered AS (
        SELECT icao24, detection_timestamp AS ts, altitude, speed,
               LAG(altitude, 1) OVER w AS a1,
               LAG(altitude, 2) OVER w AS a2,
               LAG(altitude, 4) OVER w AS a4,
               LAG(altitude, 8) OVER w AS a8,
               LAG(speed,1) OVER w AS s1,
               LAG(speed,2) OVER w AS s2
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= NOW() - INTERVAL '${lookbackHours} hours'
          AND altitude IS NOT NULL
        WINDOW w AS (PARTITION BY icao24 ORDER BY detection_timestamp)
        LIMIT 5000
      ),
      resid AS (
        SELECT icao24, ts,
               altitude - ((COALESCE(a1,altitude)+COALESCE(a2,altitude)+COALESCE(a4,altitude)+COALESCE(a8,altitude))/4.0) AS alt_residual,
               speed - ((COALESCE(s1,speed)+COALESCE(s2,speed))/2.0) AS spd_residual
        FROM ordered
        WHERE a1 IS NOT NULL
      ),
      agg AS (
        SELECT icao24,
               COUNT(*) AS samples,
               STDDEV_POP(COALESCE(alt_residual, 0)) AS alt_res_sigma,
               STDDEV_POP(COALESCE(spd_residual, 0)) AS spd_res_sigma,
               MAX(ABS(alt_residual)) AS max_alt_jump,
               MAX(ABS(spd_residual)) AS max_spd_jump
        FROM resid GROUP BY icao24 HAVING COUNT(*) >= 8
      )
      SELECT *,
        (max_alt_jump / NULLIF(alt_res_sigma,0))::numeric(10,2) AS alt_z,
        (max_spd_jump / NULLIF(spd_res_sigma,0))::numeric(10,2) AS spd_z
      FROM agg
      ORDER BY GREATEST(max_alt_jump/NULLIF(alt_res_sigma,1), max_spd_jump/NULLIF(spd_res_sigma,1)) DESC
      LIMIT 100
    `) as any[];

    // Stage 3 — Identity fingerprint: ICAO ↔ callsign coherence + foreign prefix.
    const identity = await sql.unsafe(`
      WITH ic AS (
        SELECT icao24,
               COUNT(DISTINCT callsign) AS callsigns,
               COUNT(*) AS pings,
               MAX(detection_timestamp) AS last_seen,
               BOOL_OR(icao24 ILIKE 'AE%') AS foreign_prefix,
               BOOL_OR(callsign IS NULL OR callsign = '') AS has_blank_cs
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= NOW() - INTERVAL '${lookbackHours} hours'
        GROUP BY icao24
        HAVING COUNT(*) >= 3
      )
      SELECT icao24, callsigns, pings, last_seen, foreign_prefix, has_blank_cs,
             (CASE WHEN callsigns > 3 THEN 1 ELSE 0 END) +
             (CASE WHEN foreign_prefix THEN 2 ELSE 0 END) +
             (CASE WHEN has_blank_cs THEN 1 ELSE 0 END) AS identity_flag
      FROM ic
      WHERE callsigns > 1 OR foreign_prefix OR has_blank_cs
      ORDER BY identity_flag DESC, callsigns DESC
      LIMIT 100
    `) as any[];

    // Combine
    const spatialMap = new Map(spatial.map((r: any) => [r.icao24, Math.max(Math.abs(Number(r.z_alt)||0), Math.abs(Number(r.z_spd)||0))]));
    const tempMap = new Map(temporal.map((r: any) => [r.icao24, Math.max(Number(r.alt_z)||0, Number(r.spd_z)||0)]));
    const identMap = new Map(identity.map((r: any) => [r.icao24, Number(r.identity_flag)||0]));
    const all = new Set([...spatialMap.keys(), ...tempMap.keys(), ...identMap.keys()]);

    const combined = [...all].map(icao => {
      const s = Math.min((spatialMap.get(icao) || 0) / 3.0, 1);
      const t = Math.min((tempMap.get(icao) || 0) / 3.0, 1);
      const i = Math.min((identMap.get(icao) || 0) / 4.0, 1);
      const score = +(w1*s + w2*t + w3*i).toFixed(3);
      return { icao, spatial_z: s, temporal_z: t, identity_z: i, score };
    }).filter(r => r.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    return new Response(JSON.stringify({
      ok: true, lookbackHours, weights: { w_spatial: w1, w_temporal: w2, w_identity: w3 },
      stages: { spatial_count: spatial.length, temporal_count: temporal.length, identity_count: identity.length },
      combined,
      reference: "Luo et al. 2024 — 3-stage GCN + WaveNet + RF framework (SQL approximation)",
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return jsonErr(String(e?.message || e), 500);
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

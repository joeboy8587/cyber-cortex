// Aircraft Profile Engine
// Builds one durable dossier per tail number in Neon:
//   • FAA-authoritative identity (v_faa_identity)
//   • behavioural signature (hour-of-day + weekday histograms, altitude/speed
//     bands, loiter score, geographic spread, AOI pressure)
//   • violations pulled from the FAA / Sentinel violation registers
//   • coordination partners from entity_graph_edges (co-presence)
//   • a normalised numeric feature vector + SHA-256 signature hash
// Also exposes GPU workflow actions: exportFeatures (download corpus) and
// importEmbeddings (write vectors back), plus cosine "similar" lookups.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;
const HAV = (lat: string, lng: string) => `
  3958.8 * 2 * asin(sqrt(
    power(sin(radians((${lat} - ${AOI_LAT})/2)), 2) +
    cos(radians(${AOI_LAT})) * cos(radians(${lat})) *
    power(sin(radians((${lng} - ${AOI_LNG})/2)), 2)))`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false },
    max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 110000 },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");
    await ensureSchema(sql);

    if (action === "build") return json(await build(sql, body));
    if (action === "list") return json(await list(sql, body));
    if (action === "profile") return json(await profile(sql, body));
    if (action === "exportFeatures") return json(await exportFeatures(sql, body));
    if (action === "importEmbeddings") return json(await importEmbeddings(sql, body));
    if (action === "similar") return json(await similar(sql, body));
    if (action === "stats") return json(await stats(sql));
    return json({ ok: false, error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

async function ensureSchema(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS aircraft_dossier (
      registration     text PRIMARY KEY,
      icao24           text,
      -- FAA identity (authoritative)
      faa_matched      boolean DEFAULT false,
      operator         text,
      operator_type    text,
      operator_city    text,
      operator_state   text,
      aircraft_type    text,
      year_manufactured int,
      reg_status       text,
      -- activity
      detections       bigint DEFAULT 0,
      days_active      int DEFAULT 0,
      first_seen       timestamptz,
      last_seen        timestamptz,
      callsigns        text[],
      -- behavioural signature
      hour_hist        int[],
      dow_hist         int[],
      alt_min          numeric, alt_p10 numeric, alt_avg numeric, alt_p90 numeric, alt_sigma numeric,
      spd_avg          numeric, spd_sigma numeric,
      night_pct        numeric, low_alt_pct numeric, sub_stall_pct numeric, on_ground_pct numeric,
      loiter_score     numeric,
      geo_spread_mi    numeric,
      centroid_lat     double precision, centroid_lng double precision,
      aoi_min_mi       numeric, aoi_pings bigint DEFAULT 0, aoi_pct numeric,
      -- enforcement
      faa_violations   int DEFAULT 0,
      sentinel_violations int DEFAULT 0,
      violation_types  text[],
      worst_altitude_deficit numeric,
      -- coordination
      partner_count    int DEFAULT 0,
      top_partners     jsonb DEFAULT '[]'::jsonb,
      -- scoring / ML
      feature_vector   double precision[],
      risk_score       numeric DEFAULT 0,
      signature_hash   text,
      window_days      int,
      updated_at       timestamptz DEFAULT NOW()
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_acdoss_risk ON aircraft_dossier(risk_score DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_acdoss_op ON aircraft_dossier(operator)`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS aircraft_dossier_embeddings (
      registration text PRIMARY KEY,
      dims         int NOT NULL,
      vec          double precision[] NOT NULL,
      model        text,
      source       text DEFAULT 'local-gpu',
      neighbors    jsonb DEFAULT '[]'::jsonb,
      updated_at   timestamptz DEFAULT NOW()
    )`);
}

/* ─────────────────────────── build ─────────────────────────── */

async function build(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(body.days) || 90, 1), 365);
  const minPings = Math.min(Math.max(Number(body.minPings) || 5, 1), 500);
  const parts = Math.min(Math.max(Number(body.parts) || 1, 1), 16);
  const part = Math.min(Math.max(Number(body.part) || 0, 0), parts - 1);
  const shard = parts > 1
    ? `AND mod(abs(hashtext(UPPER(TRIM(d.registration)))), ${parts}) = ${part}`
    : "";
  const t0 = Date.now();

  const rows = await sql.unsafe(`
    WITH base AS (
      SELECT UPPER(TRIM(d.registration)) AS reg,
             d.icao24, d.callsign, d.detection_timestamp AS ts,
             d.latitude, d.longitude, d.altitude, d.speed, d.on_ground
      FROM live_flight_detections_rows d
      WHERE d.detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND d.registration IS NOT NULL AND TRIM(d.registration) <> ''
        AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
        ${shard}
    ),
    agg AS (
      SELECT reg,
        MAX(icao24) AS icao24,
        COUNT(*)::bigint AS detections,
        COUNT(DISTINCT DATE(ts))::int AS days_active,
        MIN(ts) AS first_seen, MAX(ts) AS last_seen,
        (ARRAY_AGG(DISTINCT UPPER(TRIM(callsign))) FILTER (WHERE callsign IS NOT NULL AND TRIM(callsign) <> ''))[1:12] AS callsigns,
        MIN(altitude) AS alt_min,
        PERCENTILE_CONT(0.10) WITHIN GROUP (ORDER BY altitude) AS alt_p10,
        AVG(altitude) AS alt_avg,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY altitude) AS alt_p90,
        COALESCE(STDDEV_POP(altitude), 0) AS alt_sigma,
        AVG(speed) AS spd_avg, COALESCE(STDDEV_POP(speed), 0) AS spd_sigma,
        AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END) AS night_pct,
        AVG(CASE WHEN altitude IS NOT NULL AND altitude < 1000 THEN 1.0 ELSE 0 END) AS low_alt_pct,
        AVG(CASE WHEN speed IS NOT NULL AND speed > 0 AND speed < 48 THEN 1.0 ELSE 0 END) AS sub_stall_pct,
        AVG(CASE WHEN on_ground THEN 1.0 ELSE 0 END) AS on_ground_pct,
        AVG(latitude) AS centroid_lat, AVG(longitude) AS centroid_lng,
        69.0 * GREATEST(MAX(latitude) - MIN(latitude), MAX(longitude) - MIN(longitude)) AS geo_spread_mi,
        MIN(${HAV("latitude", "longitude")}) AS aoi_min_mi,
        COUNT(*) FILTER (WHERE ${HAV("latitude", "longitude")} <= 10)::bigint AS aoi_pings,
        AVG(CASE WHEN ${HAV("latitude", "longitude")} <= 10 THEN 1.0 ELSE 0 END) AS aoi_pct
      FROM base GROUP BY reg
      HAVING COUNT(*) >= ${minPings}
    ),
    hours AS (
      SELECT reg, ARRAY_AGG(c ORDER BY h)::int[] AS hour_hist FROM (
        SELECT r.reg AS reg, g.h, COUNT(b.ts)::int AS c
        FROM (SELECT DISTINCT reg FROM base) r
        CROSS JOIN generate_series(0,23) g(h)
        LEFT JOIN base b ON b.reg = r.reg AND EXTRACT(HOUR FROM b.ts) = g.h
        GROUP BY r.reg, g.h
      ) s WHERE reg IS NOT NULL GROUP BY reg
    ),
    dows AS (
      SELECT reg, ARRAY_AGG(c ORDER BY d)::int[] AS dow_hist FROM (
        SELECT r.reg AS reg, g.d, COUNT(b.ts)::int AS c
        FROM (SELECT DISTINCT reg FROM base) r
        CROSS JOIN generate_series(0,6) g(d)
        LEFT JOIN base b ON b.reg = r.reg AND EXTRACT(DOW FROM b.ts) = g.d
        GROUP BY r.reg, g.d
      ) s WHERE reg IS NOT NULL GROUP BY reg
    ),
    faa_v AS (
      SELECT UPPER(TRIM(registration)) AS reg, COUNT(*)::int AS n,
             MAX(altitude_deficit) AS worst_deficit,
             ARRAY_AGG(DISTINCT violation_type) FILTER (WHERE violation_type IS NOT NULL) AS types
      FROM faa_validated_violations
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND registration IS NOT NULL
      GROUP BY 1
    ),
    sen_v AS (
      SELECT UPPER(TRIM(aircraft_registration)) AS reg, COUNT(*)::int AS n,
             ARRAY_AGG(DISTINCT violation_type) FILTER (WHERE violation_type IS NOT NULL) AS types
      FROM sentinel_violations
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND aircraft_registration IS NOT NULL
      GROUP BY 1
    ),
    partners AS (
      SELECT reg, COUNT(*)::int AS partner_count,
             COALESCE(jsonb_agg(jsonb_build_object('registration', peer, 'weight', weight)
                      ORDER BY weight DESC) FILTER (WHERE rn <= 8), '[]'::jsonb) AS top_partners
      FROM (
        SELECT REPLACE(src, 'AC:', '') AS reg, REPLACE(dst, 'AC:', '') AS peer, weight,
               ROW_NUMBER() OVER (PARTITION BY src ORDER BY weight DESC) AS rn
        FROM entity_graph_edges WHERE edge_type = 'copresence' AND src LIKE 'AC:%'
        UNION ALL
        SELECT REPLACE(dst, 'AC:', ''), REPLACE(src, 'AC:', ''), weight,
               ROW_NUMBER() OVER (PARTITION BY dst ORDER BY weight DESC)
        FROM entity_graph_edges WHERE edge_type = 'copresence' AND dst LIKE 'AC:%'
      ) p GROUP BY reg
    )
    INSERT INTO aircraft_dossier (
      registration, icao24, faa_matched, operator, operator_type, operator_city, operator_state,
      aircraft_type, year_manufactured, reg_status,
      detections, days_active, first_seen, last_seen, callsigns,
      hour_hist, dow_hist, alt_min, alt_p10, alt_avg, alt_p90, alt_sigma, spd_avg, spd_sigma,
      night_pct, low_alt_pct, sub_stall_pct, on_ground_pct, loiter_score, geo_spread_mi,
      centroid_lat, centroid_lng, aoi_min_mi, aoi_pings, aoi_pct,
      faa_violations, sentinel_violations, violation_types, worst_altitude_deficit,
      partner_count, top_partners, feature_vector, risk_score, signature_hash, window_days, updated_at)
    SELECT
      a.reg, a.icao24, (f.n_number IS NOT NULL),
      f.registrant_name, f.registrant_type, f.registrant_city, f.registrant_state,
      NULLIF(TRIM(CONCAT_WS(' ', f.aircraft_manufacturer, f.aircraft_model)), ''),
      f.year_manufactured, f.status,
      a.detections, a.days_active, a.first_seen, a.last_seen, a.callsigns,
      h.hour_hist, w.dow_hist,
      a.alt_min, a.alt_p10, a.alt_avg, a.alt_p90, a.alt_sigma, a.spd_avg, a.spd_sigma,
      a.night_pct, a.low_alt_pct, a.sub_stall_pct, a.on_ground_pct,
      -- loiter: many pings inside a tight geographic footprint
      ROUND((LEAST(100, (a.detections::numeric / GREATEST(a.geo_spread_mi::numeric, 1)) * 2))::numeric, 2),
      ROUND(a.geo_spread_mi::numeric, 2), a.centroid_lat, a.centroid_lng,
      ROUND(a.aoi_min_mi::numeric, 2), a.aoi_pings, a.aoi_pct,
      COALESCE(fv.n, 0), COALESCE(sv.n, 0),
      (COALESCE(fv.types, ARRAY[]::text[]) || COALESCE(sv.types, ARRAY[]::text[]))[1:12],
      fv.worst_deficit,
      COALESCE(pt.partner_count, 0), COALESCE(pt.top_partners, '[]'::jsonb),
      ARRAY[
        LEAST(1, a.detections::float8 / 5000), LEAST(1, a.days_active::float8 / 90),
        COALESCE(a.night_pct, 0)::float8, COALESCE(a.low_alt_pct, 0)::float8,
        COALESCE(a.sub_stall_pct, 0)::float8, COALESCE(a.on_ground_pct, 0)::float8,
        LEAST(1, COALESCE(a.alt_avg, 0)::float8 / 40000), LEAST(1, COALESCE(a.alt_sigma, 0)::float8 / 15000),
        LEAST(1, COALESCE(a.spd_avg, 0)::float8 / 550), LEAST(1, COALESCE(a.spd_sigma, 0)::float8 / 200),
        LEAST(1, COALESCE(a.geo_spread_mi, 0)::float8 / 500),
        GREATEST(0, 1 - LEAST(1, COALESCE(a.aoi_min_mi, 999)::float8 / 50)),
        COALESCE(a.aoi_pct, 0)::float8,
        LEAST(1, COALESCE(fv.n, 0)::float8 / 25), LEAST(1, COALESCE(sv.n, 0)::float8 / 25),
        LEAST(1, COALESCE(pt.partner_count, 0)::float8 / 50),
        CASE WHEN f.n_number IS NOT NULL THEN 1 ELSE 0 END::float8,
        LEAST(1, COALESCE(array_length(a.callsigns, 1), 0)::float8 / 6)
      ],
      LEAST(100, ROUND((
          COALESCE(a.low_alt_pct, 0)::numeric * 25 * (1 - COALESCE(a.on_ground_pct, 0)::numeric) +
          COALESCE(a.night_pct, 0)::numeric * 15 * (1 - COALESCE(a.on_ground_pct, 0)::numeric) +
          COALESCE(a.sub_stall_pct, 0)::numeric * 15 * (1 - COALESCE(a.on_ground_pct, 0)::numeric) +
          COALESCE(a.aoi_pct, 0)::numeric * 20 +
          LEAST(15, COALESCE(fv.n, 0)::numeric * 1.5) + LEAST(10, COALESCE(sv.n, 0)::numeric * 1.0) +
          LEAST(10, COALESCE(pt.partner_count, 0)::numeric * 0.4) +
          CASE WHEN f.n_number IS NULL THEN 8 ELSE 0 END)::numeric, 2)),
      encode(sha256(convert_to(
        a.reg || '|' || a.detections::text || '|' || COALESCE(h.hour_hist::text, '') || '|' ||
        COALESCE(ROUND(a.low_alt_pct::numeric, 4)::text, '') || '|' || COALESCE(ROUND(a.night_pct::numeric, 4)::text, '') ||
        '|' || COALESCE(fv.n, 0)::text || '|' || COALESCE(sv.n, 0)::text, 'UTF8')), 'hex'),
      ${days}, NOW()
    FROM agg a
    LEFT JOIN hours h ON h.reg = a.reg
    LEFT JOIN dows  w ON w.reg = a.reg
    LEFT JOIN v_faa_identity f ON f.n_number = a.reg
    LEFT JOIN faa_v fv ON fv.reg = a.reg
    LEFT JOIN sen_v sv ON sv.reg = a.reg
    LEFT JOIN partners pt ON pt.reg = a.reg
    ON CONFLICT (registration) DO UPDATE SET
      icao24 = EXCLUDED.icao24, faa_matched = EXCLUDED.faa_matched,
      operator = EXCLUDED.operator, operator_type = EXCLUDED.operator_type,
      operator_city = EXCLUDED.operator_city, operator_state = EXCLUDED.operator_state,
      aircraft_type = EXCLUDED.aircraft_type, year_manufactured = EXCLUDED.year_manufactured,
      reg_status = EXCLUDED.reg_status, detections = EXCLUDED.detections,
      days_active = EXCLUDED.days_active, first_seen = LEAST(aircraft_dossier.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(aircraft_dossier.last_seen, EXCLUDED.last_seen),
      callsigns = EXCLUDED.callsigns, hour_hist = EXCLUDED.hour_hist, dow_hist = EXCLUDED.dow_hist,
      alt_min = EXCLUDED.alt_min, alt_p10 = EXCLUDED.alt_p10, alt_avg = EXCLUDED.alt_avg,
      alt_p90 = EXCLUDED.alt_p90, alt_sigma = EXCLUDED.alt_sigma, spd_avg = EXCLUDED.spd_avg,
      spd_sigma = EXCLUDED.spd_sigma, night_pct = EXCLUDED.night_pct, low_alt_pct = EXCLUDED.low_alt_pct,
      sub_stall_pct = EXCLUDED.sub_stall_pct, on_ground_pct = EXCLUDED.on_ground_pct,
      loiter_score = EXCLUDED.loiter_score, geo_spread_mi = EXCLUDED.geo_spread_mi,
      centroid_lat = EXCLUDED.centroid_lat, centroid_lng = EXCLUDED.centroid_lng,
      aoi_min_mi = EXCLUDED.aoi_min_mi, aoi_pings = EXCLUDED.aoi_pings, aoi_pct = EXCLUDED.aoi_pct,
      faa_violations = EXCLUDED.faa_violations, sentinel_violations = EXCLUDED.sentinel_violations,
      violation_types = EXCLUDED.violation_types, worst_altitude_deficit = EXCLUDED.worst_altitude_deficit,
      partner_count = EXCLUDED.partner_count, top_partners = EXCLUDED.top_partners,
      feature_vector = EXCLUDED.feature_vector, risk_score = EXCLUDED.risk_score,
      signature_hash = EXCLUDED.signature_hash, window_days = EXCLUDED.window_days, updated_at = NOW()
    RETURNING registration
  `);

  return { ok: true, profiles: rows.length, days, part, parts, ms: Date.now() - t0 };
}

/* ─────────────────────────── reads ─────────────────────────── */

const LIST_COLS = `registration, icao24, operator, operator_type, aircraft_type, faa_matched,
  detections, days_active, first_seen, last_seen, night_pct, low_alt_pct, sub_stall_pct,
  aoi_min_mi, aoi_pings, aoi_pct, loiter_score, faa_violations, sentinel_violations,
  partner_count, risk_score, signature_hash, updated_at`;

async function list(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 500);
  const search = String(body.search || "").trim().toUpperCase();
  const sort = ["risk_score", "detections", "aoi_pings", "faa_violations", "last_seen"]
    .includes(String(body.sort)) ? String(body.sort) : "risk_score";
  const onlyViolators = Boolean(body.onlyViolators);
  const onlyAoi = Boolean(body.onlyAoi);

  const where: string[] = ["1=1"];
  if (search) where.push(`(registration LIKE '%${search.replace(/'/g, "")}%' OR UPPER(COALESCE(operator,'')) LIKE '%${search.replace(/'/g, "")}%')`);
  if (onlyViolators) where.push(`(faa_violations + sentinel_violations) > 0`);
  if (onlyAoi) where.push(`aoi_pings > 0`);

  const rows = await sql.unsafe(
    `SELECT ${LIST_COLS} FROM aircraft_dossier WHERE ${where.join(" AND ")}
     ORDER BY ${sort} DESC NULLS LAST LIMIT ${limit}`);
  return { ok: true, rows };
}

async function profile(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const reg = String(body.registration || "").trim().toUpperCase();
  if (!reg) return { ok: false, error: "registration required" };

  const [p] = await sql.unsafe(`SELECT * FROM aircraft_dossier WHERE registration = '${reg.replace(/'/g, "")}'`);
  if (!p) return { ok: false, error: `No profile for ${reg}. Run "Rebuild profiles" first.` };

  const [violations, fleet, twins] = await Promise.all([
    sql.unsafe(`
      SELECT detection_timestamp AS ts, violation_type, altitude, min_legal_altitude,
             altitude_deficit, nearest_airport, airspace_class, 'FAA' AS source
      FROM faa_validated_violations WHERE UPPER(TRIM(registration)) = '${reg}'
      ORDER BY detection_timestamp DESC LIMIT 25`).catch(() => []),
    p.operator
      ? sql.unsafe(`SELECT registration, aircraft_type, detections, risk_score
                    FROM aircraft_dossier WHERE operator = $tag$${p.operator}$tag$
                      AND registration <> '${reg}' ORDER BY risk_score DESC LIMIT 12`).catch(() => [])
      : Promise.resolve([]),
    sql.unsafe(`SELECT neighbors FROM aircraft_dossier_embeddings WHERE registration = '${reg}'`).catch(() => []),
  ]);

  return {
    ok: true,
    profile: p,
    violations,
    fleet,
    twins: (twins as Array<{ neighbors: unknown }>)[0]?.neighbors ?? [],
  };
}

async function stats(sql: ReturnType<typeof postgres>) {
  const [s] = await sql.unsafe(`
    SELECT COUNT(*)::int AS profiles,
           COUNT(*) FILTER (WHERE faa_matched)::int AS faa_matched,
           COUNT(*) FILTER (WHERE (faa_violations + sentinel_violations) > 0)::int AS violators,
           COUNT(*) FILTER (WHERE aoi_pings > 0)::int AS aoi_actors,
           MAX(updated_at) AS last_build,
           (SELECT COUNT(*)::int FROM aircraft_dossier_embeddings) AS embedded
    FROM aircraft_dossier`);
  return { ok: true, stats: s };
}

/* ───────────────────── GPU embedding workflow ───────────────────── */

async function exportFeatures(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 2000, 1), 20000);
  const rows = await sql.unsafe(`
    SELECT registration, icao24, operator, aircraft_type, feature_vector,
           hour_hist, dow_hist, risk_score, signature_hash,
           CONCAT_WS(' | ',
             'Tail ' || registration,
             'Operator ' || COALESCE(operator, 'UNREGISTERED'),
             'Type ' || COALESCE(aircraft_type, 'unknown'),
             detections || ' detections over ' || days_active || ' active days',
             'night ' || ROUND(COALESCE(night_pct,0)*100) || '%',
             'below 1000ft ' || ROUND(COALESCE(low_alt_pct,0)*100) || '%',
             'sub-stall ' || ROUND(COALESCE(sub_stall_pct,0)*100) || '%',
             'closest AOI ' || COALESCE(aoi_min_mi, 999) || ' mi',
             'FAA violations ' || faa_violations,
             'sentinel violations ' || sentinel_violations,
             'coordination partners ' || partner_count
           ) AS text
    FROM aircraft_dossier
    ORDER BY risk_score DESC NULLS LAST LIMIT ${limit}`);
  return { ok: true, count: rows.length, rows };
}

async function importEmbeddings(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const items = Array.isArray(body.embeddings) ? body.embeddings : [];
  const model = String(body.model || "local-gpu");
  if (!items.length) return { ok: false, error: "embeddings array required" };

  let written = 0;
  for (const raw of items) {
    const it = raw as { registration?: string; vec?: number[]; embedding?: number[] };
    const reg = String(it.registration || "").trim().toUpperCase();
    const vec = (it.vec || it.embedding || []).map(Number).filter((n) => Number.isFinite(n));
    if (!reg || vec.length < 2) continue;
    await sql`
      INSERT INTO aircraft_dossier_embeddings (registration, dims, vec, model, source, updated_at)
      VALUES (${reg}, ${vec.length}, ${vec as unknown as number[]}, ${model}, 'local-gpu', NOW())
      ON CONFLICT (registration) DO UPDATE SET
        dims = EXCLUDED.dims, vec = EXCLUDED.vec, model = EXCLUDED.model, updated_at = NOW()`;
    written++;
  }

  // Recompute nearest behavioural twins for everything sharing the dominant dim.
  await sql.unsafe(`
    WITH d AS (SELECT dims FROM aircraft_dossier_embeddings GROUP BY dims ORDER BY COUNT(*) DESC LIMIT 1),
    n AS (
      SELECT a.registration,
             jsonb_agg(jsonb_build_object('registration', b.registration, 'similarity', ROUND(s.sim::numeric, 4))
                       ORDER BY s.sim DESC) AS neighbors
      FROM aircraft_dossier_embeddings a
      JOIN aircraft_dossier_embeddings b ON b.registration <> a.registration AND b.dims = a.dims
      JOIN d ON d.dims = a.dims
      CROSS JOIN LATERAL (
        SELECT SUM(x*y) / NULLIF(SQRT(SUM(x*x)) * SQRT(SUM(y*y)), 0) AS sim
        FROM unnest(a.vec, b.vec) AS t(x, y)
      ) s
      WHERE s.sim IS NOT NULL
      GROUP BY a.registration
    )
    UPDATE aircraft_dossier_embeddings e
    SET neighbors = (SELECT jsonb_agg(v) FROM (SELECT v FROM jsonb_array_elements(n.neighbors) v LIMIT 8) q)
    FROM n WHERE n.registration = e.registration
  `).catch(() => null);

  return { ok: true, written };
}

async function similar(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const reg = String(body.registration || "").trim().toUpperCase().replace(/'/g, "");
  const k = Math.min(Math.max(Number(body.k) || 10, 1), 50);
  if (!reg) return { ok: false, error: "registration required" };

  const rows = await sql.unsafe(`
    WITH me AS (SELECT vec, dims FROM aircraft_dossier_embeddings WHERE registration = '${reg}')
    SELECT e.registration, p.operator, p.aircraft_type, p.risk_score,
           ROUND((SELECT SUM(x*y) / NULLIF(SQRT(SUM(x*x)) * SQRT(SUM(y*y)), 0)
                  FROM unnest(e.vec, (SELECT vec FROM me)) AS t(x, y))::numeric, 4) AS similarity
    FROM aircraft_dossier_embeddings e
    LEFT JOIN aircraft_dossier p ON p.registration = e.registration
    WHERE e.registration <> '${reg}' AND e.dims = (SELECT dims FROM me)
    ORDER BY similarity DESC NULLS LAST LIMIT ${k}`);
  return { ok: true, rows };
}

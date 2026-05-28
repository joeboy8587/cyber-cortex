// Watchtower 2.2 — Darkness Auditor + Tactical Handoff Detector + N720CA Deep Dive
// Backed by v_faa_enriched_live_detections (FAA-enriched) + live_flight_detections_rows fallback.
// AOI: 120 W Pilot Ave, Oildale — 35.4377286, -119.0252189.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;
const PRIMARY_ZONE_KM = 3.0;
const PRIMARY_ZONE_MI = PRIMARY_ZONE_KM * 0.621371; // ≈ 1.864
const HANDOFF_MIN = 10;
const EVASION_DELTA = 0.4;
const LOOKBACK_DAYS_DEFAULT = 14;

// Haversine SQL fragment producing miles between row(lat,lng) and AOI.
const DIST_MI_SQL = `
  ( 3958.8 * 2 * asin(sqrt(
      power(sin(radians((latitude - ${AOI_LAT})/2)), 2) +
      cos(radians(${AOI_LAT})) * cos(radians(latitude)) *
      power(sin(radians((longitude - ${AOI_LNG})/2)), 2)
  )) )
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "runAll";
    const lookbackDays: number = Math.min(Math.max(Number(body.lookbackDays) || LOOKBACK_DAYS_DEFAULT, 1), 90);
    const targetTail: string = (body.targetTail || "N720CA").toUpperCase();

    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '90000'`).catch(() => {});

    const result: Record<string, unknown> = { action, lookbackDays, generated_at: new Date().toISOString() };

    if (action === "runAll" || action === "darknessAudit") {
      result.darknessAudit = await runDarknessAudit(sql, lookbackDays);
    }
    if (action === "runAll" || action === "tacticalHandoffs") {
      result.tacticalHandoffs = await runTacticalHandoffs(sql, lookbackDays);
    }
    if (action === "runAll" || action === "deepDive") {
      result.deepDive = await runDeepDive(sql, targetTail);
    }
    if (action === "runAll") {
      result.faaEnrichment = await runFaaEnrichmentStatus(sql, lookbackDays);
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("watchtower-22 error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } finally {
    if (sql) { try { await sql.end(); } catch {} }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. DARKNESS RATIO AUDITOR
// Compares night (20:00–06:00 local PT) vs day altitude-mask rates per tail.
// Flag if (night_mask_rate − day_mask_rate) > 0.4 with ≥10 night samples.
// ─────────────────────────────────────────────────────────────────────────────
async function runDarknessAudit(sql: any, lookbackDays: number) {
  const rows = await sql.unsafe(`
    WITH base AS (
      SELECT
        UPPER(registration) AS tail,
        detection_timestamp,
        altitude,
        (altitude IS NULL OR altitude = 0) AS masked,
        CASE
          WHEN EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') >= 20
            OR EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') < 6
          THEN TRUE ELSE FALSE
        END AS is_night
      FROM live_flight_detections_rows
      WHERE registration IS NOT NULL AND registration <> ''
        AND detection_timestamp >= NOW() - INTERVAL '${lookbackDays} days'
    )
    SELECT
      tail,
      COUNT(*) FILTER (WHERE is_night)                       AS night_total,
      COUNT(*) FILTER (WHERE is_night AND masked)            AS night_masked,
      COUNT(*) FILTER (WHERE NOT is_night)                   AS day_total,
      COUNT(*) FILTER (WHERE NOT is_night AND masked)        AS day_masked
    FROM base
    GROUP BY tail
    HAVING COUNT(*) FILTER (WHERE is_night) >= 10
       AND COUNT(*) FILTER (WHERE NOT is_night) >= 10
  `);

  const scored = rows.map((r: any) => {
    const nightRate = r.night_total > 0 ? Number(r.night_masked) / Number(r.night_total) : 0;
    const dayRate = r.day_total > 0 ? Number(r.day_masked) / Number(r.day_total) : 0;
    const delta = nightRate - dayRate;
    return {
      tail: r.tail,
      night_total: Number(r.night_total),
      night_masked: Number(r.night_masked),
      day_total: Number(r.day_total),
      day_masked: Number(r.day_masked),
      night_mask_rate: +nightRate.toFixed(3),
      day_mask_rate: +dayRate.toFixed(3),
      evasion_delta: +delta.toFixed(3),
      classification: delta > EVASION_DELTA
        ? "INTENTIONAL_EVASION_SIGNATURE"
        : delta > 0.2 ? "SUSPICIOUS_NIGHT_MASKING" : "AMBIGUOUS",
    };
  }).filter((r: any) => r.evasion_delta > 0.2)
    .sort((a: any, b: any) => b.evasion_delta - a.evasion_delta);

  return {
    threshold: EVASION_DELTA,
    sample_tails_evaluated: rows.length,
    flagged: scored.length,
    top_offenders: scored.slice(0, 25),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. TACTICAL HANDOFF DETECTOR
// Inside PRIMARY zone (≤1.864 mi from AOI), find pairs where Aircraft A's last
// ping is followed within HANDOFF_MIN minutes by Aircraft B's first ping.
// ─────────────────────────────────────────────────────────────────────────────
async function runTacticalHandoffs(sql: any, lookbackDays: number) {
  const rows = await sql.unsafe(`
    WITH primary_pings AS (
      SELECT
        UPPER(registration) AS tail,
        icao_code,
        detection_timestamp,
        altitude,
        ${DIST_MI_SQL} AS distance_mi
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${lookbackDays} days'
        AND registration IS NOT NULL AND registration <> ''
        AND latitude IS NOT NULL AND longitude IS NOT NULL
    ),
    inside AS (
      SELECT * FROM primary_pings WHERE distance_mi <= ${PRIMARY_ZONE_MI}
    ),
    bookends AS (
      SELECT
        tail,
        MIN(detection_timestamp) AS entry_ts,
        MAX(detection_timestamp) AS exit_ts,
        COUNT(*) AS pings
      FROM inside
      GROUP BY tail, DATE_TRUNC('hour', detection_timestamp)
    )
    SELECT
      a.tail   AS departing_tail,
      b.tail   AS arriving_tail,
      a.exit_ts  AS depart_ts,
      b.entry_ts AS arrive_ts,
      EXTRACT(EPOCH FROM (b.entry_ts - a.exit_ts))::int AS gap_seconds
    FROM bookends a
    JOIN bookends b
      ON b.tail <> a.tail
     AND b.entry_ts > a.exit_ts
     AND b.entry_ts <= a.exit_ts + INTERVAL '${HANDOFF_MIN} minutes'
    ORDER BY a.exit_ts DESC
    LIMIT 200
  `);

  const handoffs = rows.map((r: any) => {
    const gap = Number(r.gap_seconds);
    return {
      departing_tail: r.departing_tail,
      arriving_tail: r.arriving_tail,
      depart_ts: r.depart_ts,
      arrive_ts: r.arrive_ts,
      gap_seconds: gap,
      confidence: +Math.min(0.95, 0.70 + (1 - gap / (HANDOFF_MIN * 60)) * 0.25).toFixed(2),
      type: "TACTICAL_HANDOFF",
    };
  });

  // Aggregate top handoff pairs (relay shifts)
  const pairMap = new Map<string, { pair: string; count: number; avg_gap: number; tails: [string, string] }>();
  handoffs.forEach((h: any) => {
    const k = `${h.departing_tail}→${h.arriving_tail}`;
    const cur = pairMap.get(k);
    if (cur) { cur.count++; cur.avg_gap = (cur.avg_gap * (cur.count - 1) + h.gap_seconds) / cur.count; }
    else pairMap.set(k, { pair: k, count: 1, avg_gap: h.gap_seconds, tails: [h.departing_tail, h.arriving_tail] });
  });
  const topPairs = [...pairMap.values()]
    .sort((a, b) => b.count - a.count).slice(0, 20)
    .map(p => ({ ...p, avg_gap_seconds: Math.round(p.avg_gap) }));

  return {
    primary_zone_mi: PRIMARY_ZONE_MI,
    handoff_window_minutes: HANDOFF_MIN,
    handoffs_found: handoffs.length,
    recent_handoffs: handoffs.slice(0, 50),
    top_relay_pairs: topPairs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TARGET DEEP DIVE (default N720CA)
// Returns leaked-altitude pings, masking pattern by hour, and proximity vs alt.
// ─────────────────────────────────────────────────────────────────────────────
async function runDeepDive(sql: any, tail: string) {
  const [leaked, maskedByHour, proximity, faaIdentity] = await Promise.all([
    sql.unsafe(`
      SELECT
        detection_timestamp, altitude, speed,
        ${DIST_MI_SQL} AS distance_mi,
        icao_code,
        CASE
          WHEN altitude < 1000 THEN 'CRITICAL_LOW_LEVEL'
          WHEN altitude < 2000 THEN 'LOW_LEVEL_SURVEY'
          ELSE 'TRANSIT'
        END AS threat_category
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = '${tail}'
        AND altitude IS NOT NULL AND altitude > 0
      ORDER BY detection_timestamp DESC
      LIMIT 200
    `),
    sql.unsafe(`
      SELECT
        DATE_TRUNC('hour', detection_timestamp) AS hour_block,
        COUNT(*) AS total,
        SUM(CASE WHEN altitude IS NULL OR altitude = 0 THEN 1 ELSE 0 END) AS masked
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = '${tail}'
        AND detection_timestamp >= NOW() - INTERVAL '90 days'
      GROUP BY hour_block
      ORDER BY masked DESC NULLS LAST
      LIMIT 25
    `),
    sql.unsafe(`
      SELECT detection_timestamp, ${DIST_MI_SQL} AS distance_mi, altitude,
             CASE WHEN ${DIST_MI_SQL} > 0 AND altitude IS NOT NULL
                  THEN altitude::float / (${DIST_MI_SQL})
                  ELSE NULL END AS ft_per_mile_ratio
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = '${tail}'
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND altitude IS NOT NULL AND altitude > 0
        AND ${DIST_MI_SQL} < 5.0
      ORDER BY ft_per_mile_ratio ASC NULLS LAST
      LIMIT 50
    `),
    sql.unsafe(`
      SELECT registration, faa_n_number, registrant_name, registrant_city,
             registrant_state, aircraft_manufacturer, aircraft_model,
             identity_status, faa_status
      FROM v_faa_enriched_live_detections
      WHERE registration = '${tail}'
      LIMIT 1
    `).catch(() => []),
  ]);

  const aggressivePings = proximity.filter((p: any) => p.ft_per_mile_ratio !== null && p.ft_per_mile_ratio < 500);

  return {
    tail,
    leaked_altitude_pings: leaked.length,
    leaked_sample: leaked.slice(0, 20),
    night_masking_hot_hours: maskedByHour,
    aggressive_proximity_pings: aggressivePings.length,
    rooftop_geometry_sample: aggressivePings.slice(0, 20),
    faa_identity: faaIdentity[0] || null,
    classification: aggressivePings.length > 0
      ? "TACTICAL_STANDOFF_GEOMETRY_CONFIRMED"
      : "NO_ROOFTOP_GEOMETRY_IN_WINDOW",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FAA ENRICHMENT STATUS — sanity check on the newly imported data
// ─────────────────────────────────────────────────────────────────────────────
async function runFaaEnrichmentStatus(sql: any, lookbackDays: number) {
  try {
    const rows = await sql.unsafe(`
      SELECT
        COUNT(DISTINCT registration)                                              AS distinct_tails,
        COUNT(DISTINCT registration) FILTER (WHERE faa_n_number IS NOT NULL)      AS regs_matched,
        COUNT(DISTINCT registration) FILTER (WHERE identity_status = 'ICAO_FAA_MISMATCH') AS mismatches,
        COUNT(DISTINCT registration) FILTER (WHERE identity_status = 'UNREGISTERED_OR_GHOST') AS ghosts
      FROM v_faa_enriched_live_detections
      WHERE detection_timestamp >= NOW() - INTERVAL '${lookbackDays} days'
    `);
    const r = rows[0] || {};
    return {
      distinct_tails: Number(r.distinct_tails || 0),
      regs_matched: Number(r.regs_matched || 0),
      mismatches: Number(r.mismatches || 0),
      ghosts: Number(r.ghosts || 0),
      match_rate: r.distinct_tails > 0 ? +(Number(r.regs_matched) / Number(r.distinct_tails)).toFixed(3) : 0,
    };
  } catch (e) {
    return { error: (e as Error).message, hint: "Run neon-faa-enrich {action:'build'} first" };
  }
}

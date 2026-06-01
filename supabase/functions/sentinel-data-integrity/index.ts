// Sentinel v3 Wave 1 — Data Integrity Console
// Runs four passes over the Neon detection feed:
//   1. QUARANTINE       — foreign-registry injections + impossible-physics rows
//   2. PERSISTENT_GHOST — zero-foot persistent emitters + hex/callsign rotation
//   3. COMPOUND_THREAT  — one enriched row per tail combining low-alt + drone + night
//   4. SHELL_NETWORK    — auto-appended ownership graph for flagged tails
// Nothing is deleted. Everything stays in the universe table. We just classify.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;
const AOI_RADIUS_MI = 25; // Kern AOI working radius

// Foreign registry prefixes that should NEVER appear on Kern AOI ADS-B feed
const FOREIGN_PREFIXES = ["EP-", "PT-", "RP-", "VH-", "JA-", "HL", "B-", "OE-", "CC-", "LV-"];

// Known shell / proxy ownership clusters (registrant_name substrings → cluster label)
const SHELL_MAP: Array<{ match: string; cluster: string; tier: number }> = [
  { match: "ALF IX",                cluster: "ALF IX (RESIDCO)",          tier: 1 },
  { match: "RESIDCO",               cluster: "ALF IX (RESIDCO)",          tier: 1 },
  { match: "CHRISTIANSEN",          cluster: "Christiansen Aviation",     tier: 2 },
  { match: "JERK ASSETS",           cluster: "Jerk Assets LLC",           tier: 1 },
  { match: "9K AIR",                cluster: "9K Air LLC (Delaware)",     tier: 1 },
  { match: "FF22",                  cluster: "FF22 LLC",                  tier: 2 },
  { match: "BEST EQUIPMENT",        cluster: "Best Equipment Leasing",    tier: 1 },
  { match: "EPIC JET",              cluster: "Epic Jet Center",           tier: 2 },
  { match: "MEADOWS FIELD",         cluster: "Meadows Field tenants",     tier: 3 },
  { match: "KCSO",                  cluster: "Kern County Sheriff",       tier: 1 },
  { match: "SHERIFF",               cluster: "Sheriff (multi-county)",    tier: 2 },
  { match: "WONDERFUL",             cluster: "Wonderful Co (Resnick)",    tier: 2 },
  { match: "TEJON RANCH",           cluster: "Tejon Ranch corridor",      tier: 2 },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const lookbackDays: number = Math.min(Math.max(Number(body.lookbackDays) || 7, 1), 90);
    const action: string = body.action || "runAll";

    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '60000'`).catch(() => {});

    const result: Record<string, unknown> = {
      generated_at: new Date().toISOString(),
      lookback_days: lookbackDays,
      aoi: { lat: AOI_LAT, lng: AOI_LNG, radius_mi: AOI_RADIUS_MI },
    };

    if (action === "runAll" || action === "quarantine") {
      result.quarantine = await runQuarantine(sql, lookbackDays);
    }
    if (action === "runAll" || action === "ghostFleet") {
      result.ghostFleet = await runGhostFleet(sql, lookbackDays);
    }
    if (action === "runAll" || action === "compoundThreats") {
      result.compoundThreats = await runCompoundThreats(sql, lookbackDays);
    }
    if (action === "runAll" || action === "shellNetwork") {
      result.shellNetwork = await runShellNetwork(sql, lookbackDays);
    }

    return new Response(JSON.stringify({ data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sentinel-data-integrity error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (sql) { try { await sql.end(); } catch { /* ignore */ } }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 1. QUARANTINE — foreign-registry + impossible-physics rows
// ────────────────────────────────────────────────────────────────────────────
async function runQuarantine(sql: ReturnType<typeof postgres>, days: number) {
  const out: {
    summary: Record<string, number>;
    foreign_injections: unknown[];
    physics_commercial: unknown[];
    physics_generic: unknown[];
  } = { summary: {}, foreign_injections: [], physics_commercial: [], physics_generic: [] };

  // Foreign-registry prefix scan
  try {
    const orClauses = FOREIGN_PREFIXES.map((p) => `registration ILIKE '${p}%'`).join(" OR ");
    const rows = await sql.unsafe(`
      SELECT registration, icao24, callsign, altitude_baro_ft AS altitude,
             ground_speed_kts AS speed, latitude, longitude, detection_timestamp
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND (${orClauses})
      ORDER BY detection_timestamp DESC
      LIMIT 200
    `);
    out.foreign_injections = rows.map((r: Record<string, unknown>) => ({
      ...r,
      quarantine_reason: "IDENTITY_SPOOF_FOREIGN_INJECTION",
      severity: "CRITICAL",
    }));
  } catch (e) { console.warn("foreign scan failed:", (e as Error).message); }

  // Commercial widebody / 737-class at <1500ft + <250kts inside AOI
  try {
    const rows = await sql.unsafe(`
      SELECT registration, icao24, callsign, altitude_baro_ft AS altitude,
             ground_speed_kts AS speed, latitude, longitude, detection_timestamp
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND altitude_baro_ft BETWEEN 100 AND 1500
        AND ground_speed_kts < 250
        AND (callsign ILIKE 'SWA%' OR callsign ILIKE 'AAL%' OR callsign ILIKE 'UAL%'
             OR callsign ILIKE 'DAL%' OR callsign ILIKE 'JBU%' OR callsign ILIKE 'ASA%')
      ORDER BY detection_timestamp DESC
      LIMIT 200
    `);
    out.physics_commercial = rows.map((r: Record<string, unknown>) => ({
      ...r,
      quarantine_reason: "PHYSICS_VIOLATION_COMMERCIAL",
      severity: "HIGH",
      note: "Commercial carrier callsign reporting GA-class altitude+speed — likely spoofed ID.",
    }));
  } catch (e) { console.warn("physics commercial scan failed:", (e as Error).message); }

  // Generic impossible physics: >600kts under 5000ft
  try {
    const rows = await sql.unsafe(`
      SELECT registration, icao24, callsign, altitude_baro_ft AS altitude,
             ground_speed_kts AS speed, latitude, longitude, detection_timestamp
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND ground_speed_kts > 600 AND altitude_baro_ft < 5000
      ORDER BY detection_timestamp DESC
      LIMIT 200
    `);
    out.physics_generic = rows.map((r: Record<string, unknown>) => ({
      ...r,
      quarantine_reason: "PHYSICS_VIOLATION_GENERIC",
      severity: "HIGH",
    }));
  } catch (e) { console.warn("physics generic scan failed:", (e as Error).message); }

  out.summary = {
    foreign_injections: out.foreign_injections.length,
    physics_commercial: out.physics_commercial.length,
    physics_generic: out.physics_generic.length,
    total: out.foreign_injections.length + out.physics_commercial.length + out.physics_generic.length,
  };
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 2. PERSISTENT GHOST — zero-foot emitters + hex/callsign rotation
// ────────────────────────────────────────────────────────────────────────────
async function runGhostFleet(sql: ReturnType<typeof postgres>, days: number) {
  const ghosts: {
    zero_foot_persistent: unknown[];
    hex_rotation: unknown[];
    summary: Record<string, number>;
  } = { zero_foot_persistent: [], hex_rotation: [], summary: {} };

  try {
    const rows = await sql.unsafe(`
      SELECT registration, COUNT(*) AS detections,
             ROUND(AVG(altitude_baro_ft)::numeric, 1) AS avg_altitude,
             MIN(detection_timestamp) AS first_seen,
             MAX(detection_timestamp) AS last_seen,
             COUNT(DISTINCT icao24) AS hex_count,
             COUNT(DISTINCT callsign) AS callsign_count
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND registration IS NOT NULL
      GROUP BY registration
      HAVING COUNT(*) >= 20
         AND AVG(COALESCE(altitude_baro_ft, 0)) < 50
      ORDER BY detections DESC
      LIMIT 50
    `);
    ghosts.zero_foot_persistent = rows.map((r: Record<string, unknown>) => ({
      ...r,
      tier: "PERSISTENT_GHOST",
      escalation_level: 4,
      referral_track: "FBI / 18 U.S.C. § 32",
      reason: "Average altitude ≈ 0 ft across many detections — likely ground emitter or spoofed phantom.",
    }));
  } catch (e) { console.warn("ghost scan failed:", (e as Error).message); }

  try {
    const rows = await sql.unsafe(`
      SELECT icao24,
             COUNT(DISTINCT callsign) AS distinct_callsigns,
             COUNT(DISTINCT registration) AS distinct_registrations,
             COUNT(*) AS detections,
             MIN(detection_timestamp) AS first_seen,
             MAX(detection_timestamp) AS last_seen
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND icao24 IS NOT NULL
      GROUP BY icao24
      HAVING COUNT(DISTINCT callsign) >= 3
      ORDER BY distinct_callsigns DESC, detections DESC
      LIMIT 50
    `);
    ghosts.hex_rotation = rows.map((r: Record<string, unknown>) => ({
      ...r,
      tier: "HEX_ROTATION_GHOST",
      escalation_level: 3,
      referral_track: "FAA Office of Investigations + FBI",
      reason: "Same ICAO hex paired with 3+ callsigns — identity recycling signature.",
    }));
  } catch (e) { console.warn("hex rotation scan failed:", (e as Error).message); }

  ghosts.summary = {
    zero_foot_persistent: ghosts.zero_foot_persistent.length,
    hex_rotation: ghosts.hex_rotation.length,
    total: ghosts.zero_foot_persistent.length + ghosts.hex_rotation.length,
  };
  return ghosts;
}

// ────────────────────────────────────────────────────────────────────────────
// 3. COMPOUND THREATS — merge low-alt + drone-profile + night-ops per tail
// ────────────────────────────────────────────────────────────────────────────
async function runCompoundThreats(sql: ReturnType<typeof postgres>, days: number) {
  try {
    const rows = await sql.unsafe(`
      WITH base AS (
        SELECT
          registration,
          COUNT(*) AS detections,
          COUNT(*) FILTER (WHERE altitude_baro_ft < 500 AND altitude_baro_ft > 0) AS low_alt_count,
          COUNT(*) FILTER (WHERE ground_speed_kts < 48 AND altitude_baro_ft > 50) AS sub_stall_count,
          COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') BETWEEN 1 AND 4) AS night_count,
          MIN(altitude_baro_ft) FILTER (WHERE altitude_baro_ft > 0) AS min_altitude,
          MIN(ground_speed_kts) AS min_speed,
          MAX(detection_timestamp) AS last_seen
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
          AND registration IS NOT NULL
          AND registration NOT LIKE 'EP-%' AND registration NOT LIKE 'PT-%'
        GROUP BY registration
      )
      SELECT * FROM base
      WHERE ( (low_alt_count > 0)::int
            + (sub_stall_count > 0)::int
            + (night_count > 0)::int ) >= 2
      ORDER BY (low_alt_count + sub_stall_count + night_count) DESC
      LIMIT 100
    `);
    return rows.map((r: Record<string, unknown>) => {
      const factors: string[] = [];
      if (Number(r.low_alt_count) > 0) factors.push("LOW_ALT_<500FT");
      if (Number(r.sub_stall_count) > 0) factors.push("DRONE_PROFILE_SUB_STALL");
      if (Number(r.night_count) > 0) factors.push("NIGHT_OPS_01_04");
      const compoundScore = factors.length * 25 + Math.min(Number(r.low_alt_count) * 2, 50);
      return {
        ...r,
        factor_count: factors.length,
        factors,
        compound_score: compoundScore,
        label: `COMPOUND THREAT [${factors.join(" + ")}]`,
      };
    });
  } catch (e) {
    console.warn("compound scan failed:", (e as Error).message);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 4. SHELL NETWORK — auto-append ownership graph
// ────────────────────────────────────────────────────────────────────────────
async function runShellNetwork(sql: ReturnType<typeof postgres>, days: number) {
  try {
    // Pull all distinct flagged-ish tails with their FAA registrant
    const orClause = SHELL_MAP.map((s) => `UPPER(registrant_name) LIKE '%${s.match}%'`).join(" OR ");
    const rows = await sql.unsafe(`
      SELECT registration, registrant_name,
             COUNT(*) AS detections,
             MIN(detection_timestamp) AS first_seen,
             MAX(detection_timestamp) AS last_seen
      FROM v_faa_enriched_live_detections
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND registrant_name IS NOT NULL
        AND (${orClause})
      GROUP BY registration, registrant_name
      ORDER BY detections DESC
      LIMIT 300
    `);

    // Bucket by cluster
    const clusters: Record<string, {
      cluster: string; tier: number; registrant_examples: Set<string>;
      tails: Array<{ registration: string; detections: number; registrant: string }>;
    }> = {};
    for (const r of rows as Array<Record<string, unknown>>) {
      const name = String(r.registrant_name || "").toUpperCase();
      const hit = SHELL_MAP.find((s) => name.includes(s.match));
      if (!hit) continue;
      if (!clusters[hit.cluster]) {
        clusters[hit.cluster] = {
          cluster: hit.cluster, tier: hit.tier,
          registrant_examples: new Set(), tails: [],
        };
      }
      clusters[hit.cluster].registrant_examples.add(String(r.registrant_name));
      clusters[hit.cluster].tails.push({
        registration: String(r.registration),
        detections: Number(r.detections),
        registrant: String(r.registrant_name),
      });
    }

    return Object.values(clusters)
      .map((c) => ({
        cluster: c.cluster,
        tier: c.tier,
        registrant_examples: Array.from(c.registrant_examples).slice(0, 5),
        unique_tails: c.tails.length,
        total_detections: c.tails.reduce((s, t) => s + t.detections, 0),
        tails: c.tails.slice(0, 25),
      }))
      .sort((a, b) => b.total_detections - a.total_detections);
  } catch (e) {
    console.warn("shell network scan failed:", (e as Error).message);
    return [];
  }
}

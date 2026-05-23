// FAA Registry Enrichment — creates canonical join views between
// faa_aircraft_registry and the detection tables, then returns join-health
// metrics + AM-fleet identity enrichment.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(databaseUrl);
  url.searchParams.set("sslmode", "require");
  const sql = postgres(url.toString(), {
    ssl: { rejectUnauthorized: false },
    max: 2,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    connection: { statement_timeout: 60000 },
    onnotice: () => {},
  });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || "buildAndAudit";

    // ── 1. Build canonical FAA-enriched detection views ────────────────────
    if (action === "buildAndAudit" || action === "build") {
      // View over unified_flight_detections
      await sql.unsafe(`
        CREATE OR REPLACE VIEW v_faa_enriched_detections AS
        SELECT
          d.id                                AS detection_id,
          d.detection_timestamp,
          UPPER(d.registration)               AS registration,
          d.icao_hex,
          d.callsign,
          d.altitude,
          d.speed,
          d.latitude,
          d.longitude,
          d.threat_score,
          d.classification,
          d.is_military,
          d.is_surveillance,
          f.n_number                          AS faa_n_number,
          f.mode_s_hex                        AS faa_mode_s_hex,
          f.registrant_name,
          f.registrant_city,
          f.registrant_state,
          f.registrant_country,
          f.aircraft_manufacturer,
          f.aircraft_model,
          f.type_aircraft,
          f.year_manufactured,
          f.status                            AS faa_status,
          f.certificate_issue_date,
          f.expiration_date,
          CASE
            WHEN f.n_number IS NULL
              THEN 'UNREGISTERED_OR_GHOST'
            WHEN d.icao_hex IS NOT NULL
              AND f.mode_s_hex IS NOT NULL
              AND UPPER(f.mode_s_hex) <> UPPER(d.icao_hex)
              THEN 'ICAO_FAA_MISMATCH'
            ELSE 'IDENTITY_CONFIRMED'
          END                                 AS identity_status
        FROM unified_flight_detections d
        LEFT JOIN faa_aircraft_registry f
          ON UPPER(f.n_number) = UPPER(d.registration)
        WHERE d.registration IS NOT NULL AND d.registration <> ''
      `);

      // View over live_flight_detections_rows (the 3.1M-row hot table)
      await sql.unsafe(`
        CREATE OR REPLACE VIEW v_faa_enriched_live_detections AS
        SELECT
          d.id                                AS detection_id,
          d.detection_timestamp,
          UPPER(d.registration)               AS registration,
          d.icao_code,
          d.icao24,
          d.callsign,
          d.altitude,
          d.speed,
          d.latitude,
          d.longitude,
          d.threat_score,
          d.flagged,
          d.taxonomy_tag,
          d.tier_level,
          f.n_number                          AS faa_n_number,
          f.mode_s_hex                        AS faa_mode_s_hex,
          f.registrant_name,
          f.registrant_city,
          f.registrant_state,
          f.aircraft_manufacturer,
          f.aircraft_model,
          f.type_aircraft,
          f.year_manufactured,
          f.status                            AS faa_status,
          CASE
            WHEN f.n_number IS NULL
              THEN 'UNREGISTERED_OR_GHOST'
            WHEN d.icao_code IS NOT NULL
              AND f.mode_s_hex IS NOT NULL
              AND UPPER(f.mode_s_hex) <> UPPER(d.icao_code)
              THEN 'ICAO_FAA_MISMATCH'
            ELSE 'IDENTITY_CONFIRMED'
          END                                 AS identity_status
        FROM live_flight_detections_rows d
        LEFT JOIN faa_aircraft_registry f
          ON UPPER(f.n_number) = UPPER(d.registration)
        WHERE d.registration IS NOT NULL AND d.registration <> ''
      `);
    }

    // ── 2. Join-health audit ─────────────────────────────────────────────
    const healthUnified = await sql.unsafe(`
      SELECT
        COUNT(DISTINCT registration)                                            AS distinct_regs,
        COUNT(DISTINCT registration) FILTER (WHERE faa_n_number IS NOT NULL)    AS regs_matched,
        COUNT(DISTINCT registration) FILTER (WHERE identity_status = 'ICAO_FAA_MISMATCH') AS mismatches,
        COUNT(DISTINCT registration) FILTER (WHERE identity_status = 'UNREGISTERED_OR_GHOST') AS ghosts
      FROM v_faa_enriched_detections
    `);

    const topUnmatched = await sql.unsafe(`
      SELECT registration, COUNT(*) AS detections
      FROM v_faa_enriched_detections
      WHERE identity_status = 'UNREGISTERED_OR_GHOST'
      GROUP BY registration
      ORDER BY detections DESC
      LIMIT 20
    `);

    // ── 3. AM-fleet identity enrichment report ───────────────────────────
    const amFleet = await sql.unsafe(`
      SELECT
        UPPER(d.registration)                                AS registration,
        MAX(f.registrant_name)                               AS registrant_name,
        MAX(f.registrant_city || ', ' || f.registrant_state) AS registrant_loc,
        MAX(f.aircraft_manufacturer)                         AS manufacturer,
        MAX(f.aircraft_model)                                AS model,
        MAX(f.mode_s_hex)                                    AS faa_hex,
        COUNT(*)                                             AS detections,
        COUNT(DISTINCT d.icao_hex)                           AS distinct_icao
      FROM unified_flight_detections d
      LEFT JOIN faa_aircraft_registry f
        ON UPPER(f.n_number) = UPPER(d.registration)
      WHERE UPPER(d.registration) ~ '^N[0-9]+AM$'
      GROUP BY UPPER(d.registration)
      ORDER BY detections DESC
    `);

    return new Response(
      JSON.stringify({
        ok: true,
        action,
        views_created: ["v_faa_enriched_detections", "v_faa_enriched_live_detections"],
        join_health_unified: healthUnified[0] ?? null,
        top_unmatched: topUnmatched,
        am_fleet_identity: amFleet,
        generated_at: new Date().toISOString(),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const err = e as Error;
    return new Response(
      JSON.stringify({ ok: false, error: err.message, stack: err.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* ignore */ }
  }
});

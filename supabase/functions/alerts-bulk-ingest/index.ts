import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NEON = Deno.env.get("NEON_DATABASE_URL")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { action, batch } = await req.json();
    const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 5 });

    if (action === "init") {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS live_flight_alerts_archive (
          id BIGSERIAL PRIMARY KEY,
          sha256_hash TEXT UNIQUE NOT NULL,
          source_filename TEXT,
          observed_at TIMESTAMPTZ,
          registration TEXT,
          callsign TEXT,
          icao24 TEXT,
          altitude_ft DOUBLE PRECISION,
          speed_kts DOUBLE PRECISION,
          heading_deg DOUBLE PRECISION,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          threat_level TEXT,
          alert_type TEXT,
          violations JSONB DEFAULT '[]'::jsonb,
          historical JSONB DEFAULT '{}'::jsonb,
          raw_text TEXT,
          ingested_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_lfa_observed ON live_flight_alerts_archive(observed_at);
        CREATE INDEX IF NOT EXISTS idx_lfa_reg ON live_flight_alerts_archive(registration);
        CREATE INDEX IF NOT EXISTS idx_lfa_icao ON live_flight_alerts_archive(icao24);
        CREATE INDEX IF NOT EXISTS idx_lfa_threat ON live_flight_alerts_archive(threat_level);
      `);
      await sql.end();
      return new Response(JSON.stringify({ ok: true, action: "init" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "insert") {
      if (!Array.isArray(batch) || batch.length === 0) {
        await sql.end();
        return new Response(JSON.stringify({ error: "empty batch" }), { status: 400, headers: corsHeaders });
      }
      // Build values for bulk insert
      const rows = batch.map((b: any) => ({
        sha256_hash: b.sha256,
        source_filename: b.filename,
        observed_at: b.observed_at,
        registration: b.registration,
        callsign: b.callsign,
        icao24: b.icao24,
        altitude_ft: b.altitude_ft,
        speed_kts: b.speed_kts,
        heading_deg: b.heading_deg,
        latitude: b.latitude,
        longitude: b.longitude,
        threat_level: b.threat_level,
        alert_type: b.alert_type,
        violations: JSON.stringify(b.violations ?? []),
        historical: JSON.stringify(b.historical ?? {}),
        raw_text: b.raw_text,
      }));
      const result = await sql`
        INSERT INTO live_flight_alerts_archive ${sql(rows,
          "sha256_hash","source_filename","observed_at","registration","callsign","icao24",
          "altitude_ft","speed_kts","heading_deg","latitude","longitude",
          "threat_level","alert_type","violations","historical","raw_text"
        )}
        ON CONFLICT (sha256_hash) DO NOTHING
        RETURNING id
      `;
      await sql.end();
      return new Response(JSON.stringify({ ok: true, inserted: result.length, attempted: rows.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "stats") {
      const r = await sql`
        SELECT COUNT(*)::int total,
               COUNT(DISTINCT registration)::int distinct_reg,
               COUNT(*) FILTER (WHERE threat_level='HIGH')::int high,
               COUNT(*) FILTER (WHERE threat_level='CRITICAL')::int critical,
               MIN(observed_at) min_ts, MAX(observed_at) max_ts
        FROM live_flight_alerts_archive`;
      await sql.end();
      return new Response(JSON.stringify(r[0]),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await sql.end();
    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

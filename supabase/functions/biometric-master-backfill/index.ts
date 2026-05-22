// Backfills watchtower_biometrics_master from legacy biometric sources.
// Idempotent: uses NOT EXISTS on (source_table, source_id) so re-runs add only new rows.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const NEON_URL = Deno.env.get("NEON_DATABASE_URL")!;

const SQL_CONFIRMED = `
INSERT INTO watchtower_biometrics_master (
  source_table, source_id, original_correlation_id,
  biometric_timestamp_utc, biometric_timestamp_pdt,
  biometric_source, heart_rate_bpm, hrv_ms, stress_score, stress_level,
  aircraft_timestamp_utc, aircraft_timestamp_pdt,
  aircraft_registration, aircraft_callsign,
  altitude_ft, speed_kts,
  time_offset_minutes, correlation_strength, correlation_method, correlation_confidence,
  threat_level, hr_spike_detected, biometric_severity,
  evidence_hash, sha256_hash, chain_of_custody, raw_payload,
  created_at, updated_at
)
SELECT
  'confirmed_biometric_correlations'::text,
  c.id::text,
  c.id::text,
  c.biometric_timestamp,
  (c.biometric_timestamp::timestamptz) AT TIME ZONE 'America/Los_Angeles',
  'WHOOP'::text,
  NULLIF(c.heart_rate::text,'')::numeric,
  NULLIF(c.hrv_value::text,'')::numeric,
  NULLIF(c.stress_score::text,'')::numeric,
  CASE
    WHEN NULLIF(c.stress_score::text,'')::numeric >= 80 THEN 'high'
    WHEN NULLIF(c.stress_score::text,'')::numeric >= 50 THEN 'medium'
    ELSE 'low'
  END,
  c.aircraft_timestamp,
  (c.aircraft_timestamp::timestamptz) AT TIME ZONE 'America/Los_Angeles',
  c.aircraft_registration,
  c.aircraft_callsign,
  NULLIF(c.aircraft_altitude::text,'')::numeric,
  NULLIF(c.aircraft_speed::text,'')::numeric,
  NULLIF(c.time_offset_minutes::text,'')::numeric,
  NULLIF(c.correlation_score::text,'')::numeric,
  c.correlation_type,
  NULLIF(c.confidence_level::text,'')::numeric,
  c.threat_level,
  (NULLIF(c.heart_rate::text,'')::numeric > 100),
  CASE
    WHEN NULLIF(c.heart_rate::text,'')::numeric > 110 THEN 'critical'
    WHEN NULLIF(c.heart_rate::text,'')::numeric > 100 THEN 'high'
    WHEN NULLIF(c.heart_rate::text,'')::numeric > 90  THEN 'medium'
    ELSE 'low'
  END,
  c.evidence_hash,
  c.sha256_hash,
  'imported_from_confirmed_biometric_correlations'::text,
  jsonb_build_object('analysis_method', c.analysis_method, 'human_verified', c.human_verified::text),
  COALESCE(c.created_at, NOW()),
  NOW()
FROM confirmed_biometric_correlations c
WHERE c.biometric_timestamp IS NOT NULL
  AND NULLIF(c.heart_rate::text,'') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM watchtower_biometrics_master m
    WHERE m.source_table = 'confirmed_biometric_correlations' AND m.source_id = c.id::text
  )
LIMIT $1
`;

const SQL_BIO_UNIFIED = `
INSERT INTO watchtower_biometrics_master (
  source_table, source_id, biometric_timestamp_utc, biometric_timestamp_pdt,
  biometric_source, heart_rate_bpm, hrv_ms, stress_score, stress_level,
  aircraft_registration, biometric_severity, hr_spike_detected,
  sha256_hash, chain_of_custody, raw_payload, created_at, updated_at
)
SELECT
  'biometrics_unified'::text,
  b.id::text,
  b.event_timestamp,
  (b.event_timestamp::timestamptz) AT TIME ZONE 'America/Los_Angeles',
  COALESCE(b.source_table,'unknown'),
  b.heart_rate::numeric,
  b.hrv_rmssd,
  b.stress_level,
  CASE WHEN b.stress_level >= 80 THEN 'high' WHEN b.stress_level >= 50 THEN 'medium' ELSE 'low' END,
  b.aircraft_registration,
  CASE
    WHEN b.heart_rate > 110 THEN 'critical'
    WHEN b.heart_rate > 100 THEN 'high'
    WHEN b.heart_rate > 90  THEN 'medium'
    ELSE 'low'
  END,
  (b.heart_rate > 100),
  b.sha256_hash::text,
  'imported_from_biometrics_unified'::text,
  jsonb_build_object('medical_significance', b.medical_significance, 'severity_score', b.severity_score, 'systolic_bp', b.systolic_bp),
  COALESCE(b.created_at::timestamptz, NOW()),
  NOW()
FROM biometrics_unified b
WHERE b.event_timestamp IS NOT NULL
  AND b.heart_rate IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM watchtower_biometrics_master m
    WHERE m.source_table = 'biometrics_unified' AND m.source_id = b.id::text
  )
LIMIT $1
`;

const SQL_UNIFIED_EVENTS = `
INSERT INTO watchtower_biometrics_master (
  source_table, source_id, biometric_timestamp_utc, biometric_timestamp_pdt,
  biometric_source, heart_rate_bpm, hrv_ms, stress_score, stress_level,
  biometric_severity, hr_spike_detected,
  sha256_hash, chain_of_custody, raw_payload, created_at, updated_at
)
SELECT
  'unified_biometric_events'::text,
  u.id::text,
  u.event_timestamp,
  COALESCE(u.event_timestamp_pdt, (u.event_timestamp::timestamptz) AT TIME ZONE 'America/Los_Angeles'),
  COALESCE(u.source_table,'WHOOP'),
  u.heart_rate,
  u.hrv,
  u.stress_score,
  CASE WHEN u.stress_score >= 80 THEN 'high' WHEN u.stress_score >= 50 THEN 'medium' ELSE 'low' END,
  CASE
    WHEN u.heart_rate > 110 THEN 'critical'
    WHEN u.heart_rate > 100 THEN 'high'
    WHEN u.heart_rate > 90  THEN 'medium'
    ELSE 'low'
  END,
  (u.heart_rate > 100),
  u.sha256_hash,
  'imported_from_unified_biometric_events'::text,
  COALESCE(u.metadata, '{}'::jsonb),
  COALESCE(u.import_timestamp, NOW()),
  NOW()
FROM unified_biometric_events u
WHERE u.event_timestamp IS NOT NULL
  AND u.heart_rate IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM watchtower_biometrics_master m
    WHERE m.source_table = 'unified_biometric_events' AND m.source_id = u.id::text
  )
LIMIT $1
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const body = await req.json().catch(() => ({}));
  const batchSize: number = Math.min(Number(body.batch_size ?? 25000), 50000);
  const sources: string[] = body.sources ?? ["confirmed", "biometrics_unified", "unified_events"];

  const sql = postgres(NEON_URL, { max: 1, idle_timeout: 20, prepare: false });
  const results: Record<string, unknown> = {};

  try {
    const before = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM watchtower_biometrics_master`);
    results.master_rows_before = before[0].n;

    if (sources.includes("confirmed")) {
      const r = await sql.unsafe(SQL_CONFIRMED, [batchSize]);
      results.confirmed_inserted = (r as any).count ?? null;
    }
    if (sources.includes("biometrics_unified")) {
      const r = await sql.unsafe(SQL_BIO_UNIFIED, [batchSize]);
      results.biometrics_unified_inserted = (r as any).count ?? null;
    }
    if (sources.includes("unified_events")) {
      const r = await sql.unsafe(SQL_UNIFIED_EVENTS, [batchSize]);
      results.unified_events_inserted = (r as any).count ?? null;
    }

    const after = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM watchtower_biometrics_master`);
    results.master_rows_after = after[0].n;

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message), results }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

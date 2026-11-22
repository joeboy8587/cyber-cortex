export const CANONICAL_CORRELATION_SOURCE = 'public.unified_biometric_aircraft_correlation_final';

export const normalizeScore = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const scopedRows = `
  SELECT * FROM public.unified_biometric_aircraft_correlation_final
  WHERE aircraft_timestamp_utc IS NOT NULL AND biometric_timestamp_utc IS NOT NULL
    AND aircraft_registration IS NOT NULL
    AND biometric_timestamp_utc BETWEEN aircraft_timestamp_utc - ($1::int * interval '1 minute')
      AND aircraft_timestamp_utc + ($1::int * interval '1 minute')
    AND ($3::date IS NULL OR (aircraft_timestamp_utc >= $3::date AND aircraft_timestamp_utc < $3::date + interval '1 day'))
    AND COALESCE(aircraft_icao_code, '') NOT ILIKE 'ABC%'
    AND COALESCE(source_table, '') NOT IN ('live_flight_detections_rows', 'JOSIAH_SENTINEL', 'LIVE_EVENT_SPOOFING_CHECK')
`;

// Count stored links, not independent observations; every sample retains its original provenance.
export const CANONICAL_READ_QUERY = `
WITH scoped AS MATERIALIZED (${scopedRows}),
summary AS (
  SELECT COUNT(*)::bigint AS count, MIN(aircraft_timestamp_utc) AS first_flight,
    MAX(aircraft_timestamp_utc) AS last_flight, COUNT(bradford_hill_score) AS scored_records FROM scoped
), sources AS (
  SELECT COALESCE(source_schema, 'unknown') || '.' || COALESCE(source_table, 'unknown') AS source, COUNT(*) AS count
  FROM scoped GROUP BY source_schema, source_table
), sample AS (
  SELECT correlation_id, aircraft_registration AS registration, aircraft_callsign AS callsign,
    aircraft_timestamp_utc AS flight_time, biometric_timestamp_utc AS bio_time,
    heart_rate_bpm AS heart_rate, hrv_ms AS hrv, altitude_ft AS altitude,
    source_schema, source_table, original_id, sha256_hash, evidence_hash,
    EXTRACT(EPOCH FROM (aircraft_timestamp_utc - biometric_timestamp_utc))/60 AS time_diff_minutes
  FROM scoped ORDER BY aircraft_timestamp_utc DESC, correlation_id DESC LIMIT $2::int
), scores AS (
  SELECT aircraft_registration AS registration,
    COUNT(DISTINCT (aircraft_timestamp_utc, aircraft_icao_code)) AS detection_count,
    COUNT(DISTINCT (aircraft_timestamp_utc AT TIME ZONE 'America/Los_Angeles')::date) AS unique_days,
    AVG(altitude_ft) AS avg_altitude, MIN(altitude_ft) AS min_altitude,
    COUNT(*) AS bio_correlations, MAX(heart_rate_bpm) AS peak_heart_rate, MIN(hrv_ms) AS min_hrv,
    COUNT(DISTINCT biometric_timestamp_utc) FILTER (WHERE heart_rate_bpm > 100) AS stress_events,
    MAX(bradford_hill_score) AS bradford_hill_score, MIN(bradford_hill_score) AS lowest_stored_score,
    COUNT(bradford_hill_score) AS scored_records,
    MIN(aircraft_timestamp_utc) AS first_flight, MAX(aircraft_timestamp_utc) AS last_flight,
    ARRAY_AGG(DISTINCT COALESCE(source_schema, 'unknown') || '.' || COALESCE(source_table, 'unknown')) AS sources
  FROM scoped GROUP BY aircraft_registration
  ORDER BY MAX(bradford_hill_score) DESC NULLS LAST, COUNT(*) DESC, aircraft_registration LIMIT 100
)
SELECT jsonb_build_object(
  'count', summary.count, 'first_flight', summary.first_flight, 'last_flight', summary.last_flight,
  'scored_records', summary.scored_records,
  'sourceBreakdown', COALESCE((SELECT jsonb_object_agg(source, count) FROM sources), '{}'::jsonb),
  'sample', COALESCE((SELECT jsonb_agg(to_jsonb(sample)) FROM sample), '[]'::jsonb),
  'scores', COALESCE((SELECT jsonb_agg(to_jsonb(scores)) FROM scores), '[]'::jsonb)
) AS result FROM summary LIMIT 1`;

export async function readCanonicalCorrelations(action: string, windowMinutes: number, batchSize: number, day?: string) {
  const key = Deno.env.get('LOVABLE_API_KEY');
  const connectionKey = Deno.env.get('NEON_API_KEY');
  if (!key || !connectionKey) throw new Error('Correlation connection unavailable');
  const response = await fetch('https://connector-gateway.lovable.dev/neon/sql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'X-Connection-Api-Key': connectionKey,
      'Content-Type': 'application/json', 'Neon-Batch-Read-Only': 'true' },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({ queries: [
      { query: "SET LOCAL statement_timeout = '20s'", params: [] },
      { query: CANONICAL_READ_QUERY, params: [windowMinutes, Math.min(batchSize, 100), day ?? null] },
    ] }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error(`Canonical correlation read failed [${response.status}]: ${details}`);
    if (/57014|statement timeout/i.test(details)) throw Object.assign(new Error('Correlation read timed out'), { code: 'ANALYSIS_TIMEOUT' });
    const stale = /password authentication failed|endpoint cannot be found/.test(details);
    const blocked = /The endpoint has been disabled|endpoint is (disabled|temporarily unavailable)/.test(details);
    throw new Error(stale ? 'The correlation database connection needs replacement in Lovable connector settings.'
      : blocked ? 'The correlation database is unavailable; check its endpoint and plan in Neon.'
      : 'Stored correlations could not be retrieved. No new result was produced.');
  }
  const payload = await response.json();
  const data = payload.results?.[1]?.rows?.[0]?.result;
  if (!data || !Array.isArray(data.scores) || !Array.isArray(data.sample)) throw new Error('Incomplete stored correlation response');
  const scores = data.scores.map((row: Record<string, unknown>) => ({ ...row,
    avg_altitude: normalizeScore(row.avg_altitude), min_altitude: normalizeScore(row.min_altitude),
    min_hrv: normalizeScore(row.min_hrv), peak_heart_rate: normalizeScore(row.peak_heart_rate),
    bradford_hill_score: normalizeScore(row.bradford_hill_score),
  }));
  return {
    ...data, scores, count: action === 'calculateBradfordHillScores' ? scores.length : Number(data.count),
    matched_record_count: Number(data.count),
    source: CANONICAL_CORRELATION_SOURCE,
    scope: { day: day ?? null, dateScope: day ? 'Selected UTC day' : 'All retained historical dates',
      firstFlight: data.first_flight, lastFlight: data.last_flight, windowMinutes },
    scoreBasis: 'Highest saved historical Bradford Hill score per aircraft; no new score or causal conclusion calculated',
    sourceStatus: 'Stored historical links; original source labels retained, not newly authenticated observations',
  };
}
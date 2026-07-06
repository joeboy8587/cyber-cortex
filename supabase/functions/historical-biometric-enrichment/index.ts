import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function calculateBradfordHillScore(c: {
  timeGapMinutes: number; heartRateElevation: number; stressLevel: number;
  altitudeFeet: number; repeatOccurrences: number;
}): number {
  let score = 0;
  if (c.timeGapMinutes <= 2) score += 25;
  else if (c.timeGapMinutes <= 5) score += 20;
  else if (c.timeGapMinutes <= 10) score += 15;
  else if (c.timeGapMinutes <= 15) score += 10;
  else if (c.timeGapMinutes <= 30) score += 5;
  if (c.heartRateElevation >= 30) score += 25;
  else if (c.heartRateElevation >= 20) score += 20;
  else if (c.heartRateElevation >= 15) score += 15;
  else if (c.heartRateElevation >= 10) score += 10;
  else if (c.heartRateElevation >= 5) score += 5;
  if (c.stressLevel >= 8) score += 25;
  else if (c.stressLevel >= 6) score += 20;
  else if (c.stressLevel >= 4) score += 15;
  else if (c.stressLevel >= 2) score += 10;
  else score += 5;
  if (c.altitudeFeet <= 500) score += 15;
  else if (c.altitudeFeet <= 1000) score += 12;
  else if (c.altitudeFeet <= 1500) score += 10;
  else if (c.altitudeFeet <= 2000) score += 5;
  if (c.repeatOccurrences >= 10) score += 10;
  else if (c.repeatOccurrences >= 5) score += 7;
  else if (c.repeatOccurrences >= 3) score += 5;
  else if (c.repeatOccurrences >= 2) score += 3;
  return score;
}

// Default to last 90 days to keep Neon queries under statement timeout
function defaultRange(startDate?: string, endDate?: string) {
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function runEnrichBackground(neonUrl: string, startISO: string, endISO: string, batchSize: number) {
  const pool = new Pool(neonUrl, 2, true);
  const client = await pool.connect();
  try {
    await client.queryObject(`SET statement_timeout = '55000'`);

    await client.queryObject(`
      CREATE TABLE IF NOT EXISTS master_biometric_aircraft_correlations (
        id SERIAL PRIMARY KEY,
        biometric_id TEXT, registration TEXT,
        correlation_timestamp TIMESTAMP, biometric_timestamp TIMESTAMP, flight_timestamp TIMESTAMP,
        time_gap_minutes NUMERIC, heart_rate INTEGER, stress_level NUMERIC, altitude_feet NUMERIC,
        bradford_hill_score INTEGER, biometric_source TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const bio = await client.queryObject`
      SELECT id, measurement_timestamp, heart_rate, stress_level, hrv
      FROM biometric_monitoring
      WHERE measurement_timestamp >= ${startISO}
        AND measurement_timestamp < ${endISO}
      ORDER BY measurement_timestamp
      LIMIT ${batchSize}
    `;

    // Pre-compute repeat counts once, in a single query, for all registrations touched
    const repeatMap = new Map<string, number>();

    let created = 0;
    for (const b of bio.rows as any[]) {
      const nearby = await client.queryObject`
        SELECT id, registration, detection_timestamp, altitude, latitude, longitude
        FROM live_flight_detections_rows
        WHERE detection_timestamp BETWEEN
          ${b.measurement_timestamp}::timestamp - INTERVAL '10 minutes'
          AND ${b.measurement_timestamp}::timestamp + INTERVAL '10 minutes'
        LIMIT 20
      `;

      // Bulk-fetch missing repeat counts for this batch of registrations
      const regs = Array.from(new Set((nearby.rows as any[]).map(r => r.registration).filter(Boolean)));
      const missing = regs.filter(r => !repeatMap.has(r));
      if (missing.length) {
        const rc = await client.queryObject<{ registration: string; c: string }>`
          SELECT registration, COUNT(*)::text as c
          FROM live_flight_detections_rows
          WHERE registration = ANY(${missing}::text[])
          GROUP BY registration
        `;
        for (const row of rc.rows) repeatMap.set(row.registration, Number(row.c));
        for (const m of missing) if (!repeatMap.has(m)) repeatMap.set(m, 1);
      }

      for (const f of nearby.rows as any[]) {
        const gap = Math.abs(new Date(f.detection_timestamp).getTime() - new Date(b.measurement_timestamp).getTime()) / 60000;
        const bh = calculateBradfordHillScore({
          timeGapMinutes: gap,
          heartRateElevation: (b.heart_rate || 70) - 70,
          stressLevel: b.stress_level || 5,
          altitudeFeet: f.altitude || 5000,
          repeatOccurrences: repeatMap.get(f.registration) || 1,
        });
        await client.queryObject`
          INSERT INTO master_biometric_aircraft_correlations (
            biometric_id, registration, correlation_timestamp, biometric_timestamp, flight_timestamp,
            time_gap_minutes, heart_rate, stress_level, altitude_feet, bradford_hill_score, biometric_source
          ) VALUES (
            ${b.id}::text, ${f.registration},
            ${b.measurement_timestamp}, ${b.measurement_timestamp}, ${f.detection_timestamp},
            ${gap}, ${b.heart_rate}, ${b.stress_level}, ${f.altitude}, ${bh}, 'whoop'
          )
          ON CONFLICT DO NOTHING
        `;
        created++;
      }
    }
    console.log(`[enrich] window ${startISO}..${endISO} created=${created}`);
  } catch (e) {
    console.error('[enrich] background failure:', e);
  } finally {
    try { client.release(); } catch {}
    try { await pool.end(); } catch {}
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { action, startDate, endDate, batchSize = 100 } = await req.json();
    const neonUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!neonUrl) throw new Error('NEON_DATABASE_URL not configured');
    const { start, end } = defaultRange(startDate, endDate);

    if (action === 'enrich') {
      // Long-running: dispatch to background so we don't hit the edge timeout
      // @ts-ignore EdgeRuntime is available in Supabase edge functions
      EdgeRuntime.waitUntil(runEnrichBackground(neonUrl, start, end, batchSize));
      return new Response(JSON.stringify({
        success: true,
        status: 'processing',
        message: 'Enrichment started in background. Poll action=stats to see progress.',
        window: { start, end }, batchSize,
      }), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const pool = new Pool(neonUrl, 2, true);
    const client = await pool.connect();
    try {
      await client.queryObject(`SET statement_timeout = '25000'`);

      if (action === 'analyze') {
        const biometricStats = await client.queryObject`
          SELECT DATE(measurement_timestamp) as date,
                 COUNT(*)::int as biometric_count,
                 AVG(heart_rate) as avg_hr,
                 AVG(stress_level) as avg_stress
          FROM biometric_monitoring
          WHERE measurement_timestamp >= ${start} AND measurement_timestamp < ${end}
          GROUP BY DATE(measurement_timestamp) ORDER BY date
        `;
        const flightStats = await client.queryObject`
          SELECT DATE(detection_timestamp) as date,
                 COUNT(*)::int as flight_count,
                 COUNT(DISTINCT registration)::int as unique_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= ${start} AND detection_timestamp < ${end}
          GROUP BY DATE(detection_timestamp) ORDER BY date
        `;
        let existingCorrelationsCount = 0;
        try {
          const ec = await client.queryObject<{ count: number }>`
            SELECT COUNT(*)::int as count FROM master_biometric_aircraft_correlations
            WHERE biometric_timestamp >= ${start} AND biometric_timestamp < ${end}
          `;
          existingCorrelationsCount = Number(ec.rows[0]?.count || 0);
        } catch { /* table may not exist */ }

        return new Response(JSON.stringify({
          success: true,
          window: { start, end },
          analysis: {
            biometricDays: biometricStats.rows.length,
            flightDays: flightStats.rows.length,
            existingCorrelations: existingCorrelationsCount,
            biometricData: biometricStats.rows,
            flightData: flightStats.rows,
          },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (action === 'stats') {
        let statsResult: any = {
          total_correlations: 0, avg_bh_score: 0, unique_aircraft: 0,
          earliest: null, latest: null, high_confidence: 0, medium_confidence: 0, low_confidence: 0,
        };
        try {
          const stats = await client.queryObject`
            SELECT COUNT(*)::int as total_correlations,
                   AVG(bradford_hill_score) as avg_bh_score,
                   COUNT(DISTINCT registration)::int as unique_aircraft,
                   MIN(biometric_timestamp) as earliest,
                   MAX(biometric_timestamp) as latest,
                   COUNT(CASE WHEN bradford_hill_score >= 70 THEN 1 END)::int as high_confidence,
                   COUNT(CASE WHEN bradford_hill_score >= 50 AND bradford_hill_score < 70 THEN 1 END)::int as medium_confidence,
                   COUNT(CASE WHEN bradford_hill_score < 50 THEN 1 END)::int as low_confidence
            FROM master_biometric_aircraft_correlations
          `;
          statsResult = stats.rows[0];
        } catch { /* table may not exist */ }

        return new Response(JSON.stringify({ success: true, stats: statsResult }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: 'Unknown action. Use: analyze, enrich, or stats' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } finally {
      client.release();
      try { await pool.end(); } catch {}
    }
  } catch (error: unknown) {
    console.error('Historical enrichment error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Bradford-Hill scoring criteria
function calculateBradfordHillScore(correlation: {
  timeGapMinutes: number;
  heartRateElevation: number;
  stressLevel: number;
  altitudeFeet: number;
  repeatOccurrences: number;
}): number {
  let score = 0;

  // Temporal proximity (0-25 points)
  if (correlation.timeGapMinutes <= 2) score += 25;
  else if (correlation.timeGapMinutes <= 5) score += 20;
  else if (correlation.timeGapMinutes <= 10) score += 15;
  else if (correlation.timeGapMinutes <= 15) score += 10;
  else if (correlation.timeGapMinutes <= 30) score += 5;

  // Biometric response strength (0-25 points)
  if (correlation.heartRateElevation >= 30) score += 25;
  else if (correlation.heartRateElevation >= 20) score += 20;
  else if (correlation.heartRateElevation >= 15) score += 15;
  else if (correlation.heartRateElevation >= 10) score += 10;
  else if (correlation.heartRateElevation >= 5) score += 5;

  // Stress level (0-25 points)
  if (correlation.stressLevel >= 8) score += 25;
  else if (correlation.stressLevel >= 6) score += 20;
  else if (correlation.stressLevel >= 4) score += 15;
  else if (correlation.stressLevel >= 2) score += 10;
  else score += 5;

  // Low altitude operations (0-15 points)
  if (correlation.altitudeFeet <= 500) score += 15;
  else if (correlation.altitudeFeet <= 1000) score += 12;
  else if (correlation.altitudeFeet <= 1500) score += 10;
  else if (correlation.altitudeFeet <= 2000) score += 5;

  // Repeat occurrences (0-10 points)
  if (correlation.repeatOccurrences >= 10) score += 10;
  else if (correlation.repeatOccurrences >= 5) score += 7;
  else if (correlation.repeatOccurrences >= 3) score += 5;
  else if (correlation.repeatOccurrences >= 2) score += 3;

  return score;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, startDate, endDate, batchSize = 100 } = await req.json();
    
    const neonUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!neonUrl) {
      throw new Error('NEON_DATABASE_URL not configured');
    }

    const pool = new Pool(neonUrl, 3, true);
    const client = await pool.connect();

    try {
      if (action === 'analyze') {
        const biometricStats = await client.queryObject`
          SELECT 
            DATE(measurement_timestamp) as date,
            COUNT(*)::int as biometric_count,
            AVG(heart_rate) as avg_hr,
            AVG(stress_level) as avg_stress
          FROM biometric_monitoring
          WHERE measurement_timestamp >= ${startDate || '2021-01-01'}
            AND measurement_timestamp < ${endDate || '2025-01-01'}
          GROUP BY DATE(measurement_timestamp)
          ORDER BY date
        `;

        const flightStats = await client.queryObject`
          SELECT 
            DATE(detection_timestamp) as date,
            COUNT(*)::int as flight_count,
            COUNT(DISTINCT registration)::int as unique_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= ${startDate || '2021-01-01'}
            AND detection_timestamp < ${endDate || '2025-01-01'}
          GROUP BY DATE(detection_timestamp)
          ORDER BY date
        `;

        let existingCorrelationsCount = 0;
        try {
          const existingCorrelations = await client.queryObject<{ count: string }>`
            SELECT COUNT(*)::int as count
            FROM master_biometric_aircraft_correlations
            WHERE biometric_timestamp >= ${startDate || '2021-01-01'}
              AND biometric_timestamp < ${endDate || '2025-01-01'}
          `;
          existingCorrelationsCount = Number(existingCorrelations.rows[0]?.count || 0);
        } catch {
          // Table may not exist yet
        }

        return new Response(JSON.stringify({
          success: true,
          analysis: {
            biometricDays: biometricStats.rows.length,
            flightDays: flightStats.rows.length,
            existingCorrelations: existingCorrelationsCount,
            biometricData: biometricStats.rows,
            flightData: flightStats.rows
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (action === 'enrich') {
        // Ensure table exists with correct schema - add missing columns if needed
        await client.queryObject`
          CREATE TABLE IF NOT EXISTS master_biometric_aircraft_correlations (
            id SERIAL PRIMARY KEY,
            biometric_id TEXT,
            registration TEXT,
            correlation_timestamp TIMESTAMP,
            biometric_timestamp TIMESTAMP,
            flight_timestamp TIMESTAMP,
            time_gap_minutes NUMERIC,
            heart_rate INTEGER,
            stress_level NUMERIC,
            altitude_feet NUMERIC,
            bradford_hill_score INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `;

        // Add columns that may be missing on existing tables
        const alterStatements = [
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS biometric_id TEXT`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS registration TEXT`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS correlation_timestamp TIMESTAMP`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS biometric_timestamp TIMESTAMP`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS flight_timestamp TIMESTAMP`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS time_gap_minutes NUMERIC`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS heart_rate INTEGER`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS stress_level NUMERIC`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS altitude_feet NUMERIC`,
          `ALTER TABLE master_biometric_aircraft_correlations ADD COLUMN IF NOT EXISTS bradford_hill_score INTEGER`,
        ];
        for (const stmt of alterStatements) {
          try { await client.queryObject(stmt); } catch { /* column may already exist */ }
        }

        // Find biometric records to correlate
        const biometricRecords = await client.queryObject`
          SELECT 
            bm.id,
            bm.measurement_timestamp,
            bm.heart_rate,
            bm.stress_level,
            bm.hrv
          FROM biometric_monitoring bm
          WHERE bm.measurement_timestamp >= ${startDate || '2021-01-01'}
            AND bm.measurement_timestamp < ${endDate || '2025-01-01'}
          ORDER BY bm.measurement_timestamp
          LIMIT ${batchSize}
        `;

        let correlationsCreated = 0;
        const correlations = [];

        for (const bio of biometricRecords.rows as any[]) {
          // Find flights within ±10 minute window
          const nearbyFlights = await client.queryObject`
            SELECT 
              id,
              registration,
              detection_timestamp,
              altitude,
              latitude,
              longitude
            FROM live_flight_detections_rows
            WHERE detection_timestamp BETWEEN 
              ${bio.measurement_timestamp}::timestamp - INTERVAL '10 minutes'
              AND ${bio.measurement_timestamp}::timestamp + INTERVAL '10 minutes'
            LIMIT 20
          `;

          for (const flight of nearbyFlights.rows as any[]) {
            const timeGapMs = Math.abs(
              new Date(flight.detection_timestamp).getTime() - 
              new Date(bio.measurement_timestamp).getTime()
            );
            const timeGapMinutes = timeGapMs / (1000 * 60);

            // Get repeat occurrence count for this aircraft
            const repeatCount = await client.queryObject`
              SELECT COUNT(*) as count
              FROM live_flight_detections_rows
              WHERE registration = ${flight.registration}
            `;

            const bhScore = calculateBradfordHillScore({
              timeGapMinutes,
              heartRateElevation: (bio.heart_rate || 70) - 70,
              stressLevel: bio.stress_level || 5,
              altitudeFeet: flight.altitude || 5000,
              repeatOccurrences: parseInt((repeatCount.rows[0] as any)?.count || '1')
            });

            // Insert correlation - include biometric_source to avoid NOT NULL constraint
            await client.queryObject`
              INSERT INTO master_biometric_aircraft_correlations (
                biometric_id, registration,
                correlation_timestamp, biometric_timestamp, flight_timestamp,
                time_gap_minutes, heart_rate, stress_level, altitude_feet,
                bradford_hill_score, biometric_source
              ) VALUES (
                ${bio.id}::text, ${flight.registration},
                ${bio.measurement_timestamp}, ${bio.measurement_timestamp}, ${flight.detection_timestamp},
                ${timeGapMinutes}, ${bio.heart_rate}, ${bio.stress_level}, ${flight.altitude},
                ${bhScore}, 'whoop'
              )
              ON CONFLICT DO NOTHING
            `;

            correlationsCreated++;
            correlations.push({
              biometricId: bio.id,
              registration: flight.registration,
              timeGapMinutes: Math.round(timeGapMinutes * 10) / 10,
              bradfordHillScore: bhScore
            });
          }
        }

        return new Response(JSON.stringify({
          success: true,
          message: `Created ${correlationsCreated} correlations`,
          biometricRecordsProcessed: biometricRecords.rows.length,
          correlationsCreated,
          sampleCorrelations: correlations.slice(0, 10)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (action === 'stats') {
        let statsResult: any = { total_correlations: 0, avg_bh_score: 0, unique_aircraft: 0, earliest: null, latest: null, high_confidence: 0, medium_confidence: 0, low_confidence: 0 };
        try {
          const stats = await client.queryObject`
            SELECT 
              COUNT(*)::int as total_correlations,
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
        } catch {
          // Table may not exist yet
        }

        return new Response(JSON.stringify({
          success: true,
          stats: statsResult
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        error: 'Unknown action. Use: analyze, enrich, or stats'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } finally {
      client.release();
    }

  } catch (error: unknown) {
    console.error('Historical enrichment error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

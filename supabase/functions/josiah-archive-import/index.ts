import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FlightDetection {
  registration?: string;
  icao24?: string;
  altitude?: number;
  latitude?: number;
  longitude?: number;
  timestamp?: string;
  detection_timestamp?: string;
  taxonomy_tag?: string;
  operator?: string;
  callsign?: string;
  on_ground?: boolean;
  velocity?: number;
  heading?: number;
}

interface BiometricRecord {
  heart_rate?: number;
  hrv?: number;
  stress_level?: number;
  timestamp?: string;
  measurement_timestamp?: string;
  source?: string;
}

interface Hypothesis {
  title?: string;
  description?: string;
  evidence?: string[];
  confidence?: number;
  pattern_type?: string;
  aircraft_involved?: string[];
  timestamp?: string;
  legal_citations?: string[];
  threat_level?: number;
}

interface LogEntry {
  timestamp?: string;
  content?: string;
  type?: string;
  aircraft?: string;
  reflection?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  
  if (!NEON_DATABASE_URL) {
    return new Response(
      JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const { action, data } = await req.json();
    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });

    let result: any = { success: false };

    switch (action) {
      case "importFlightDetections": {
        const records = data as FlightDetection[];
        let inserted = 0;
        let skipped = 0;

        for (const record of records) {
          if (!record.registration && !record.icao24) {
            skipped++;
            continue;
          }

          try {
            // Use taxonomy_tag to mark archive imports instead of non-existent source_import column
            await sql`
              INSERT INTO live_flight_detections_rows (
                registration,
                icao_code,
                altitude,
                latitude,
                longitude,
                detection_timestamp,
                taxonomy_tag,
                operator,
                callsign,
                on_ground,
                velocity,
                heading
              ) VALUES (
                ${record.registration || null},
                ${record.icao24 || null},
                ${record.altitude || null},
                ${record.latitude || null},
                ${record.longitude || null},
                ${record.timestamp || record.detection_timestamp || new Date().toISOString()},
                ${'josiah_archive_import'},
                ${record.operator || null},
                ${record.callsign || null},
                ${record.on_ground || false},
                ${record.velocity || null},
                ${record.heading || null}
              )
              ON CONFLICT DO NOTHING
            `;
            inserted++;
          } catch (e) {
            console.error("Insert error:", e);
            skipped++;
          }
        }

        result = { success: true, inserted, skipped, total: records.length };
        break;
      }

      case "importBiometrics": {
        const records = data as BiometricRecord[];
        let inserted = 0;
        let skipped = 0;

        for (const record of records) {
          if (!record.heart_rate && !record.hrv && !record.stress_level) {
            skipped++;
            continue;
          }

          try {
            const isMedicalAlert = Boolean((record.heart_rate && record.heart_rate > 100) || (record.hrv && record.hrv < 40));
            
            await sql`
              INSERT INTO biometric_monitoring (
                heart_rate,
                hrv,
                stress_level,
                measurement_timestamp,
                medical_alert,
                legal_evidence
              ) VALUES (
                ${record.heart_rate || null},
                ${record.hrv || null},
                ${record.stress_level || null},
                ${record.timestamp || record.measurement_timestamp || new Date().toISOString()},
                ${isMedicalAlert},
                ${true}
              )
              ON CONFLICT DO NOTHING
            `;
            inserted++;
          } catch (e) {
            console.error("Biometric insert error:", e);
            skipped++;
          }
        }

        result = { success: true, inserted, skipped, total: records.length };
        break;
      }

      case "importHypotheses": {
        const records = data as Hypothesis[];
        let inserted = 0;
        let skipped = 0;

        // Ensure table exists
        await sql`
          CREATE TABLE IF NOT EXISTS josiah_hypotheses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title TEXT,
            description TEXT,
            evidence JSONB,
            confidence NUMERIC,
            pattern_type TEXT,
            aircraft_involved TEXT[],
            legal_citations TEXT[],
            threat_level INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            source_file TEXT,
            sha256_hash TEXT
          )
        `;

        for (const record of records) {
          if (!record.title && !record.description) {
            skipped++;
            continue;
          }

          try {
            // Generate hash for chain of custody
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(JSON.stringify(record));
            const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const sha256Hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

            await sql`
              INSERT INTO josiah_hypotheses (
                title,
                description,
                evidence,
                confidence,
                pattern_type,
                aircraft_involved,
                legal_citations,
                threat_level,
                sha256_hash
              ) VALUES (
                ${record.title || 'Untitled Hypothesis'},
                ${record.description || null},
                ${JSON.stringify(record.evidence || [])},
                ${record.confidence || null},
                ${record.pattern_type || null},
                ${record.aircraft_involved || []},
                ${record.legal_citations || []},
                ${record.threat_level || null},
                ${sha256Hash}
              )
            `;
            inserted++;
          } catch (e) {
            console.error("Hypothesis insert error:", e);
            skipped++;
          }
        }

        result = { success: true, inserted, skipped, total: records.length };
        break;
      }

      case "importLogs": {
        const records = data as LogEntry[];
        let inserted = 0;
        let skipped = 0;

        for (const record of records) {
          if (!record.content && !record.reflection) {
            skipped++;
            continue;
          }

          try {
            await sql`
              INSERT INTO josiah_reflections_rows (
                reflection_content,
                aircraft_correlation,
                created_at
              ) VALUES (
                ${record.content || record.reflection || ''},
                ${record.aircraft || null},
                ${record.timestamp || new Date().toISOString()}
              )
              ON CONFLICT DO NOTHING
            `;
            inserted++;
          } catch (e) {
            console.error("Log insert error:", e);
            skipped++;
          }
        }

        result = { success: true, inserted, skipped, total: records.length };
        break;
      }

      case "correlateWithExisting": {
        // Run correlation using taxonomy_tag instead of source_import
        const correlations = await sql`
          WITH new_flights AS (
            SELECT * FROM live_flight_detections_rows
            WHERE taxonomy_tag = 'josiah_archive_import'
            AND detection_timestamp IS NOT NULL
          ),
          matching_biometrics AS (
            SELECT 
              f.registration,
              f.detection_timestamp,
              b.heart_rate,
              b.hrv,
              b.measurement_timestamp,
              ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) as time_diff_seconds
            FROM new_flights f
            CROSS JOIN biometric_monitoring b
            WHERE b.measurement_timestamp IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) < 300
          )
          SELECT 
            registration,
            COUNT(*) as correlation_count,
            AVG(heart_rate) as avg_hr,
            MIN(hrv) as min_hrv,
            AVG(time_diff_seconds) as avg_time_diff
          FROM matching_biometrics
          GROUP BY registration
          ORDER BY correlation_count DESC
          LIMIT 50
        `;

        result = { 
          success: true, 
          correlations: correlations.length,
          data: correlations 
        };
        break;
      }

      case "getImportStats": {
        const stats = await sql`
          SELECT 
            (SELECT COUNT(*) FROM live_flight_detections_rows WHERE taxonomy_tag = 'josiah_archive_import') as imported_flights,
            (SELECT COUNT(*) FROM josiah_hypotheses) as hypotheses,
            (SELECT COUNT(DISTINCT registration) FROM live_flight_detections_rows WHERE taxonomy_tag = 'josiah_archive_import') as unique_aircraft
        `;

        result = { success: true, stats: stats[0] };
        break;
      }

      default:
        result = { error: `Unknown action: ${action}` };
    }

    await sql.end();

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Archive import error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

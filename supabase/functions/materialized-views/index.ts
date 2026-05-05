import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: "Database connection not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const { action, view } = await req.json();
    
    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '600000'`).catch(() => {});

    let result;

    switch (action) {
      case "createAll": {
        console.log("Creating all materialized views...");
        
        // Create hourly flight stats view
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_flight_stats_hourly AS
          SELECT 
            date_trunc('hour', detection_timestamp) as hour,
            taxonomy_tag,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_altitude,
            AVG(speed) as avg_speed,
            COUNT(DISTINCT callsign) as unique_callsigns
          FROM live_flight_detections_rows
          WHERE detection_timestamp IS NOT NULL
          GROUP BY date_trunc('hour', detection_timestamp), taxonomy_tag
          ORDER BY hour DESC
        `).catch(e => console.log("mv_flight_stats_hourly:", e.message));
        
        // Create taxonomy summary view
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_taxonomy_summary AS
          SELECT 
            COALESCE(taxonomy_tag, 'unclassified') as taxonomy_tag,
            COUNT(*) as count,
            AVG(altitude) as avg_altitude,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          GROUP BY taxonomy_tag
          ORDER BY count DESC
        `).catch(e => console.log("mv_taxonomy_summary:", e.message));
        
        // Create biometric daily aggregates (match biometric_monitoring schema)
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_biometric_daily AS
          SELECT 
            date_trunc('day', measurement_timestamp) as day,
            COUNT(*) as reading_count,
            AVG(heart_rate) as avg_heart_rate,
            AVG(stress_level) as avg_stress_level,
            COUNT(CASE WHEN medical_alert = true THEN 1 END) as medical_alert_count,
            COUNT(CASE WHEN legal_evidence = true THEN 1 END) as legal_evidence_count
          FROM biometric_monitoring
          WHERE measurement_timestamp IS NOT NULL
          GROUP BY date_trunc('day', measurement_timestamp)
          ORDER BY day DESC
        `).catch(e => console.log("mv_biometric_daily:", e.message));
        
        // Create enterprise network summary (match criminal_enterprise_command_structure schema)
        await sql.unsafe(`
          CREATE MATERIALIZED VIEW IF NOT EXISTS mv_enterprise_network AS
          SELECT 
            COALESCE(role, 'UNSPECIFIED') as role,
            COUNT(*) as member_count,
            COUNT(DISTINCT entity_name) as entity_count
          FROM criminal_enterprise_command_structure
          GROUP BY COALESCE(role, 'UNSPECIFIED')
          ORDER BY member_count DESC
        `).catch(e => console.log("mv_enterprise_network:", e.message));
        
        // Create evidence chain summary - check table existence first
        const ocrExists = await sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ocr_aircraft_holding_patterns')`.catch(() => [{ exists: false }]);
        
        if (ocrExists[0]?.exists) {
          await sql.unsafe(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS mv_evidence_chain AS
            SELECT 
              evidence_type,
              COUNT(*) as count,
              MIN(created_at) as earliest,
              MAX(created_at) as latest
            FROM (
              SELECT 'flight' as evidence_type, detection_timestamp as created_at FROM live_flight_detections_rows
              UNION ALL
              SELECT 'biometric', measurement_timestamp FROM biometric_monitoring
              UNION ALL
              SELECT 'ocr', created_at FROM ocr_aircraft_holding_patterns
            ) combined
            GROUP BY evidence_type
          `).catch(e => console.log("mv_evidence_chain:", e.message));
        } else {
          // Create simpler version without ocr table
          await sql.unsafe(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS mv_evidence_chain AS
            SELECT 
              evidence_type,
              COUNT(*) as count,
              MIN(created_at) as earliest,
              MAX(created_at) as latest
            FROM (
              SELECT 'flight' as evidence_type, detection_timestamp as created_at FROM live_flight_detections_rows
              UNION ALL
              SELECT 'biometric', measurement_timestamp FROM biometric_monitoring
            ) combined
            GROUP BY evidence_type
          `).catch(e => console.log("mv_evidence_chain:", e.message));
        }

        // Create indexes for faster queries
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_mv_flight_hour ON mv_flight_stats_hourly (hour DESC)`).catch(() => {});
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_mv_taxonomy_tag ON mv_taxonomy_summary (taxonomy_tag)`).catch(() => {});
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_mv_bio_day ON mv_biometric_daily (day DESC)`).catch(() => {});

        result = { created: true, message: "All materialized views created successfully" };
        break;
      }

      case "refresh": {
        if (!view) {
          throw new Error("View name is required");
        }
        
        const safeView = view.replace(/[^a-zA-Z0-9_]/g, "");
        console.log(`Refreshing materialized view: ${safeView}`);
        
        // Check if view exists first
        const viewExists = await sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_matviews WHERE matviewname = ${safeView}
          ) as exists
        `;
        
        if (!viewExists[0]?.exists) {
          result = { 
            refreshed: false, 
            view: safeView, 
            error: "View does not exist",
            rowCount: 0
          };
          break;
        }
        
        const startTime = Date.now();
        await sql.unsafe(`REFRESH MATERIALIZED VIEW ${safeView}`);
        const duration = Date.now() - startTime;
        
        // Get row count after refresh
        const countResult = await sql.unsafe(`SELECT COUNT(*) as count FROM ${safeView}`);
        
        result = { 
          refreshed: true, 
          view: safeView, 
          duration,
          rowCount: parseInt(countResult[0]?.count || "0")
        };
        break;
      }

      case "refreshAll": {
        console.log("Refreshing all materialized views...");
        
        // Get list of actually existing materialized views
        const existingViews = await sql`
          SELECT matviewname as name FROM pg_matviews WHERE schemaname = 'public'
        `;
        
        const viewNames = existingViews.map(v => v.name as string);
        console.log(`Found ${viewNames.length} existing materialized views:`, viewNames);
        
        if (viewNames.length === 0) {
          result = { refreshed: [], message: "No materialized views exist. Run createAll first." };
          break;
        }
        
        const results = [];
        for (const v of viewNames) {
          try {
            const startTime = Date.now();
            await sql.unsafe(`REFRESH MATERIALIZED VIEW ${v}`);
            results.push({ view: v, duration: Date.now() - startTime, success: true });
          } catch (e) {
            results.push({ view: v, error: (e as Error).message, success: false });
          }
        }
        
        result = { refreshed: results };
        break;
      }

      case "stats": {
        // Get stats for all materialized views
        const viewStats = await sql`
          SELECT 
            schemaname,
            matviewname as name,
            hasindexes,
            ispopulated
          FROM pg_matviews
          WHERE schemaname = 'public'
          ORDER BY matviewname
        `;
        
        // Get row counts
        const counts = [];
        for (const v of viewStats) {
          try {
            const countResult = await sql.unsafe(`SELECT COUNT(*) as count FROM ${v.name}`);
            counts.push({ name: v.name, count: parseInt(countResult[0]?.count || "0") });
          } catch {
            counts.push({ name: v.name, count: 0 });
          }
        }
        
        result = { views: viewStats, counts };
        break;
      }

      case "drop": {
        if (!view) {
          throw new Error("View name is required");
        }
        const safeView = view.replace(/[^a-zA-Z0-9_]/g, "");
        await sql.unsafe(`DROP MATERIALIZED VIEW IF EXISTS ${safeView}`);
        result = { dropped: true, view: safeView };
        break;
      }

      case "createUnified": {
        // Build the 3 foundation views that collapse 800 tables into 3 query surfaces.
        console.log("Building unified foundation views (spacetime / entities / correlations)...");
        const log: string[] = [];
        const safeRun = async (label: string, q: string) => {
          try { await sql!.unsafe(q); log.push(`✓ ${label}`); }
          catch (e) { log.push(`✗ ${label}: ${(e as Error).message}`); }
        };

        // Discover candidate spacetime tables (have lat/lng + timestamp-ish col)
        const spacetimeTables = await sql`
          SELECT table_name FROM information_schema.columns
          WHERE table_schema='public'
            AND column_name IN ('latitude','lat','geo_lat')
          GROUP BY table_name
          HAVING COUNT(*) >= 1
          LIMIT 200
        `.catch(() => []);

        // mv_spacetime — every record with (ts, lat, lng, entity_id, source_table)
        await safeRun("mv_spacetime", `
          DROP MATERIALIZED VIEW IF EXISTS mv_spacetime CASCADE;
          CREATE MATERIALIZED VIEW mv_spacetime AS
          SELECT 'live_flight_detections_rows'::text AS source_table,
                 detection_timestamp AS ts,
                 latitude::float8 AS lat, longitude::float8 AS lng,
                 COALESCE(registration, icao_code, callsign) AS entity_id,
                 altitude::numeric AS altitude, speed::numeric AS speed,
                 taxonomy_tag AS tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp IS NOT NULL AND latitude IS NOT NULL
          UNION ALL
          SELECT 'biometric_monitoring', measurement_timestamp,
                 NULL::float8, NULL::float8,
                 'SELF'::text,
                 heart_rate::numeric, stress_level::numeric, NULL::text
          FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_mv_st_ts ON mv_spacetime(ts DESC);
          CREATE INDEX IF NOT EXISTS idx_mv_st_entity ON mv_spacetime(entity_id);
          CREATE INDEX IF NOT EXISTS idx_mv_st_geo ON mv_spacetime(lat, lng);
        `);

        // mv_entities — rollup per aircraft / call sign
        await safeRun("mv_entities", `
          DROP MATERIALIZED VIEW IF EXISTS mv_entities CASCADE;
          CREATE MATERIALIZED VIEW mv_entities AS
          SELECT entity_id,
                 COUNT(*)::int AS detections,
                 MIN(ts) AS first_seen, MAX(ts) AS last_seen,
                 ROUND(AVG(altitude)::numeric, 0) AS avg_alt,
                 MIN(altitude)::numeric AS min_alt,
                 ROUND(AVG(speed)::numeric, 0) AS avg_spd,
                 MIN(speed)::numeric AS min_spd,
                 COUNT(*) FILTER (WHERE speed BETWEEN 1 AND 48)::int AS sub_stall_pings,
                 COUNT(*) FILTER (WHERE altitude BETWEEN 1 AND 500)::int AS low_alt_pings,
                 COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ts) BETWEEN 0 AND 5)::int AS night_pings,
                 ARRAY_AGG(DISTINCT source_table) AS sources,
                 ARRAY_AGG(DISTINCT tag) FILTER (WHERE tag IS NOT NULL) AS tags
          FROM mv_spacetime
          WHERE entity_id IS NOT NULL AND entity_id <> 'SELF'
          GROUP BY entity_id;
          CREATE INDEX IF NOT EXISTS idx_mv_ent_id ON mv_entities(entity_id);
          CREATE INDEX IF NOT EXISTS idx_mv_ent_det ON mv_entities(detections DESC);
        `);

        // mv_correlations — pre-joined biometric ↔ aircraft within ±5min
        await safeRun("mv_correlations", `
          DROP MATERIALIZED VIEW IF EXISTS mv_correlations CASCADE;
          CREATE MATERIALIZED VIEW mv_correlations AS
          SELECT b.measurement_timestamp AS bio_ts,
                 b.heart_rate, b.stress_level,
                 f.entity_id AS aircraft, f.altitude, f.speed,
                 f.lat, f.lng, f.source_table,
                 EXTRACT(EPOCH FROM (f.ts - b.measurement_timestamp))::int AS lag_sec
          FROM biometric_monitoring b
          JOIN mv_spacetime f
            ON f.entity_id <> 'SELF'
           AND f.ts BETWEEN b.measurement_timestamp - INTERVAL '5 min'
                        AND b.measurement_timestamp + INTERVAL '5 min'
          WHERE b.measurement_timestamp > NOW() - INTERVAL '120 days'
            AND (b.heart_rate >= 100 OR b.stress_level >= 60);
          CREATE INDEX IF NOT EXISTS idx_mv_corr_ac ON mv_correlations(aircraft);
          CREATE INDEX IF NOT EXISTS idx_mv_corr_ts ON mv_correlations(bio_ts DESC);
        `);

        result = { ok: true, log, spacetime_candidates: spacetimeTables.length };
        break;
      }

      case "createPerformanceIndexes": {
        console.log("Creating performance indexes...");
        
        const indexResults: string[] = [];
        
        const indexes = [
          `CREATE INDEX IF NOT EXISTS idx_flights_timestamp ON live_flight_detections_rows (detection_timestamp DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_flights_registration ON live_flight_detections_rows (registration)`,
          `CREATE INDEX IF NOT EXISTS idx_flights_icao ON live_flight_detections_rows (icao_code)`,
          `CREATE INDEX IF NOT EXISTS idx_flights_taxonomy ON live_flight_detections_rows (taxonomy_tag)`,
          `CREATE INDEX IF NOT EXISTS idx_flights_flagged ON live_flight_detections_rows (flagged) WHERE flagged = true`,
          `CREATE INDEX IF NOT EXISTS idx_flights_geo ON live_flight_detections_rows (latitude, longitude)`,
          `CREATE INDEX IF NOT EXISTS idx_bio_timestamp ON biometric_monitoring (measurement_timestamp DESC)`,
          `CREATE INDEX IF NOT EXISTS idx_bio_heart_rate ON biometric_monitoring (heart_rate)`,
          `CREATE INDEX IF NOT EXISTS idx_bio_stress ON biometric_monitoring (stress_level)`,
          `CREATE INDEX IF NOT EXISTS idx_josiah_created ON josiah_reflections_rows (created_at DESC)`,
        ];

        for (const idxSql of indexes) {
          try {
            await sql.unsafe(idxSql);
            const idxName = idxSql.split(' ')[5];
            indexResults.push(`✓ ${idxName}`);
          } catch (e) {
            indexResults.push(`✗ ${(e as Error).message}`);
          }
        }

        result = { 
          created: indexResults.filter(r => r.startsWith('✓')).length,
          results: indexResults 
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Materialized views error:", err);
    if (sql) {
      try {
        await sql.end();
      } catch {}
    }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

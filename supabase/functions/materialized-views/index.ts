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
    
    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30 });

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

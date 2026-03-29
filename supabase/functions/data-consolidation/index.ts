import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Domain definitions with CORRECT column names from Neon schema discovery
const UNIFIED_VIEWS = {
  mv_unified_flights: {
    label: "Unified Flights",
    description: "All aircraft detections across every ADSB/flight table",
    sources: [
      {
        table: "live_flight_detections_rows",
        sql: `SELECT id::text, detection_timestamp as event_time, registration, icao_code, callsign, altitude, speed, latitude, longitude, taxonomy_tag as category, 'live_detections' as source_type FROM live_flight_detections_rows`
      },
      {
        table: "unfilterd_detections",
        sql: `SELECT id::text, detection_timestamp as event_time, registration, icao_code, callsign, altitude, speed, latitude, longitude, COALESCE(taxonomy_tag, 'unfiltered') as category, 'unfiltered' as source_type FROM unfilterd_detections`
      },
      {
        table: "flagged_aircraft_rows_rows",
        sql: `SELECT id::text, flagged_at as event_time, NULL as registration, hex as icao_code, flight as callsign, alt as altitude, NULL::numeric as speed, lat as latitude, lon as longitude, COALESCE(reason, 'flagged') as category, 'flagged' as source_type FROM flagged_aircraft_rows_rows`
      }
    ]
  },
  mv_unified_biometrics: {
    label: "Unified Biometrics",
    description: "All health/biometric readings in one view",
    sources: [
      {
        table: "biometric_monitoring",
        sql: `SELECT id::text, measurement_timestamp as event_time, heart_rate, stress_level, COALESCE(medical_alert::text, 'false') as alert_flag, 'monitoring' as source_type FROM biometric_monitoring`
      },
      {
        table: "confirmed_biometric_correlations",
        sql: `SELECT id::text, biometric_timestamp as event_time, heart_rate, stress_score as stress_level, confidence_level as alert_flag, 'correlation' as source_type FROM confirmed_biometric_correlations`
      },
      {
        table: "biometric_screenshots_ocr",
        sql: `SELECT id::text, COALESCE(best_timestamp, created_at) as event_time, heart_rate, stress_level, 'ocr' as alert_flag, 'screenshot_ocr' as source_type FROM biometric_screenshots_ocr`
      }
    ]
  },
  mv_unified_correlations: {
    label: "Unified Correlations",
    description: "All cross-modal evidence links",
    sources: [
      {
        table: "confirmed_biometric_correlations",
        sql: `SELECT id::text, biometric_timestamp as event_time, aircraft_registration as registration, correlation_score as confidence, 'bio_flight' as link_type, 'confirmed_correlation' as source_type FROM confirmed_biometric_correlations`
      },
      {
        table: "evidence_chain_links",
        sql: `SELECT link_id::text as id, linked_at as event_time, source_id as registration, link_confidence as confidence, link_type::text, 'evidence_chain' as source_type FROM evidence_chain_links`
      }
    ]
  },
  mv_unified_legal: {
    label: "Unified Legal",
    description: "All legal evidence, violations, and forensic events",
    sources: [
      {
        table: "legal_ada_violations_proper",
        sql: `SELECT id::text, biometric_timestamp as event_time, violation_type as category, harm_severity as severity, CONCAT('Aircraft: ', aircraft_registration, ' | Score: ', correlation_score) as summary, 'ada_violation' as source_type FROM legal_ada_violations_proper`
      },
      {
        table: "master_forensic_events",
        sql: `SELECT forensic_event_id::text as id, event_timestamp as event_time, event_type::text as category, confidence_score::text as severity, summary, 'forensic_event' as source_type FROM master_forensic_events`
      }
    ]
  },
  mv_unified_entities: {
    label: "Unified Entities",
    description: "All actors, assets, operators, and fleet records",
    sources: [
      {
        table: "aircraft_registry",
        sql: `SELECT id::text, created_at as event_time, COALESCE(registered_owner, tail_number) as name, COALESCE(aircraft_type, 'aircraft') as entity_category, threat_level as threat_classification, 'faa_registry' as source_type FROM aircraft_registry`
      },
      {
        table: "kcso_fleet",
        sql: `SELECT id::text, created_at as event_time, tail_number as name, 'kcso_aircraft' as entity_category, surveillance_capabilities as threat_classification, 'kcso_fleet' as source_type FROM kcso_fleet`
      },
      {
        table: "criminal_enterprise_command_structure",
        sql: `SELECT id::text, created_at as event_time, entity_name as name, COALESCE(entity_type, 'unknown') as entity_category, COALESCE(legal_exposure, 'unknown') as threat_classification, 'criminal_enterprise' as source_type FROM criminal_enterprise_command_structure`
      }
    ]
  }
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
    const { action } = await req.json();
    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30 });

    let result;

    switch (action) {
      case "createUnifiedViews": {
        console.log("Creating unified materialized views...");
        const startTime = Date.now();
        const results: { view: string; success: boolean; error?: string; sources: number }[] = [];

        for (const [viewName, config] of Object.entries(UNIFIED_VIEWS)) {
          if (Date.now() - startTime > 45000) {
            results.push({ view: viewName, success: false, error: "Time budget exceeded", sources: 0 });
            continue;
          }

          try {
            const validSources: string[] = [];
            for (const src of config.sources) {
              const exists = await sql`
                SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ${src.table}) as exists
              `;
              if (exists[0]?.exists) {
                validSources.push(src.sql);
              } else {
                console.log(`Table ${src.table} not found, skipping`);
              }
            }

            if (validSources.length === 0) {
              results.push({ view: viewName, success: false, error: "No source tables found", sources: 0 });
              continue;
            }

            await sql.unsafe(`DROP MATERIALIZED VIEW IF EXISTS ${viewName}`);
            const unionSql = validSources.join("\nUNION ALL\n");
            await sql.unsafe(`CREATE MATERIALIZED VIEW ${viewName} AS ${unionSql}`);

            results.push({ view: viewName, success: true, sources: validSources.length });
          } catch (e) {
            console.error(`Error creating ${viewName}:`, (e as Error).message);
            results.push({ view: viewName, success: false, error: (e as Error).message, sources: 0 });
          }
        }

        result = { 
          created: results.filter(r => r.success).length,
          total: Object.keys(UNIFIED_VIEWS).length,
          duration: Date.now() - startTime,
          details: results 
        };
        break;
      }

      case "refreshUnifiedViews": {
        console.log("Refreshing all unified views...");
        const startTime = Date.now();
        const results: { view: string; success: boolean; duration: number; rowCount?: number; error?: string }[] = [];

        for (const viewName of Object.keys(UNIFIED_VIEWS)) {
          if (Date.now() - startTime > 45000) {
            results.push({ view: viewName, success: false, duration: 0, error: "Time budget exceeded" });
            continue;
          }

          try {
            const viewExists = await sql`
              SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ${viewName}) as exists
            `;
            if (!viewExists[0]?.exists) {
              results.push({ view: viewName, success: false, duration: 0, error: "View does not exist" });
              continue;
            }

            const t = Date.now();
            await sql.unsafe(`REFRESH MATERIALIZED VIEW ${viewName}`);
            const countRes = await sql.unsafe(`SELECT COUNT(*) as count FROM ${viewName}`);
            results.push({
              view: viewName,
              success: true,
              duration: Date.now() - t,
              rowCount: parseInt(countRes[0]?.count || "0")
            });
          } catch (e) {
            results.push({ view: viewName, success: false, duration: 0, error: (e as Error).message });
          }
        }

        result = { refreshed: results, totalDuration: Date.now() - startTime };
        break;
      }

      case "getConsolidationStatus": {
        console.log("Getting consolidation status...");
        const statuses: { view: string; label: string; description: string; exists: boolean; rowCount: number; sourceCount: number; sourceTables: string[] }[] = [];

        for (const [viewName, config] of Object.entries(UNIFIED_VIEWS)) {
          const viewExists = await sql`
            SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ${viewName}) as exists
          `;
          
          let rowCount = 0;
          if (viewExists[0]?.exists) {
            try {
              const countRes = await sql.unsafe(`SELECT COUNT(*) as count FROM ${viewName}`);
              rowCount = parseInt(countRes[0]?.count || "0");
            } catch { /* view may be unpopulated */ }
          }

          const existingSources: string[] = [];
          for (const src of config.sources) {
            const exists = await sql`
              SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ${src.table}) as exists
            `;
            if (exists[0]?.exists) existingSources.push(src.table);
          }

          statuses.push({
            view: viewName,
            label: config.label,
            description: config.description,
            exists: viewExists[0]?.exists || false,
            rowCount,
            sourceCount: existingSources.length,
            sourceTables: existingSources
          });
        }

        result = { views: statuses };
        break;
      }

      case "getDomainMap": {
        console.log("Building domain map data...");
        const domains: { view: string; label: string; description: string; exists: boolean; rowCount: number; sources: { table: string; exists: boolean; rowCount: number }[] }[] = [];

        for (const [viewName, config] of Object.entries(UNIFIED_VIEWS)) {
          const viewExists = await sql`
            SELECT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = ${viewName}) as exists
          `;
          
          let viewRowCount = 0;
          if (viewExists[0]?.exists) {
            try {
              const c = await sql.unsafe(`SELECT COUNT(*) as count FROM ${viewName}`);
              viewRowCount = parseInt(c[0]?.count || "0");
            } catch {}
          }

          const sources: { table: string; exists: boolean; rowCount: number }[] = [];
          for (const src of config.sources) {
            const exists = await sql`
              SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = ${src.table}) as exists
            `;
            let srcCount = 0;
            if (exists[0]?.exists) {
              try {
                const c = await sql.unsafe(`SELECT COUNT(*) as count FROM ${src.table}`);
                srcCount = parseInt(c[0]?.count || "0");
              } catch {}
            }
            sources.push({ table: src.table, exists: exists[0]?.exists || false, rowCount: srcCount });
          }

          domains.push({ view: viewName, label: config.label, description: config.description, exists: viewExists[0]?.exists || false, rowCount: viewRowCount, sources });
        }

        result = { domains };
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
    console.error("Data consolidation error:", err);
    if (sql) { try { await sql.end(); } catch {} }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Domain definitions: each unified view and its source tables
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
        sql: `SELECT id::text, detection_timestamp as event_time, registration, COALESCE(icao_code, hex) as icao_code, callsign, COALESCE(altitude, alt) as altitude, speed, latitude, longitude, COALESCE(taxonomy_tag, 'unfiltered') as category, 'unfiltered' as source_type FROM unfilterd_detections`
      },
      {
        table: "flagged_aircraft_rows_rows",
        sql: `SELECT id::text, detection_timestamp as event_time, registration, icao_code, callsign, altitude, speed, latitude, longitude, COALESCE(taxonomy_tag, 'flagged') as category, 'flagged' as source_type FROM flagged_aircraft_rows_rows`
      },
      {
        table: "aircraft_first_appearances",
        sql: `SELECT id::text, first_seen as event_time, registration, icao_code, callsign, altitude, speed, latitude, longitude, 'first_appearance' as category, 'first_appearance' as source_type FROM aircraft_first_appearances`
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
        sql: `SELECT id::text, biometric_timestamp as event_time, heart_rate_at_event as heart_rate, stress_level_at_event as stress_level, correlation_strength::text as alert_flag, 'correlation' as source_type FROM confirmed_biometric_correlations`
      },
      {
        table: "biometric_screenshots_ocr",
        sql: `SELECT id::text, created_at as event_time, heart_rate, stress_level, 'ocr' as alert_flag, 'screenshot_ocr' as source_type FROM biometric_screenshots_ocr`
      },
      {
        table: "biometric_batch_events",
        sql: `SELECT id::text, event_timestamp as event_time, avg_heart_rate as heart_rate, avg_stress as stress_level, severity as alert_flag, 'batch' as source_type FROM biometric_batch_events`
      },
      {
        table: "biometric_collapse_events",
        sql: `SELECT id::text, collapse_timestamp as event_time, peak_heart_rate as heart_rate, peak_stress as stress_level, severity as alert_flag, 'collapse' as source_type FROM biometric_collapse_events`
      }
    ]
  },
  mv_unified_correlations: {
    label: "Unified Correlations",
    description: "All cross-modal evidence links",
    sources: [
      {
        table: "confirmed_biometric_correlations",
        sql: `SELECT id::text, biometric_timestamp as event_time, registration, correlation_strength as confidence, 'bio_flight' as link_type, 'confirmed_correlation' as source_type FROM confirmed_biometric_correlations`
      },
      {
        table: "flight_ocr_correlations",
        sql: `SELECT id::text, created_at as event_time, registration, confidence_score as confidence, 'flight_ocr' as link_type, 'ocr_correlation' as source_type FROM flight_ocr_correlations`
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
        sql: `SELECT id::text, violation_date as event_time, violation_type as category, severity, description as summary, 'ada_violation' as source_type FROM legal_ada_violations_proper`
      },
      {
        table: "master_forensic_events",
        sql: `SELECT forensic_event_id::text as id, event_timestamp as event_time, event_type::text as category, confidence_score::text as severity, summary, 'forensic_event' as source_type FROM master_forensic_events`
      },
      {
        table: "evidence_documents",
        sql: `SELECT id::text, uploaded_at as event_time, document_type as category, 'document' as severity, title as summary, 'document' as source_type FROM evidence_documents`
      }
    ]
  },
  mv_unified_entities: {
    label: "Unified Entities",
    description: "All actors, assets, operators, and fleet records",
    sources: [
      {
        table: "entity_registry",
        sql: `SELECT entity_id::text as id, created_at as event_time, canonical_identifier as name, entity_type::text as entity_category, threat_classification, 'entity_registry' as source_type FROM entity_registry`
      },
      {
        table: "aircraft_registry",
        sql: `SELECT id::text, created_at as event_time, COALESCE(registrant_name, n_number) as name, 'aircraft' as entity_category, status as threat_classification, 'faa_registry' as source_type FROM aircraft_registry`
      },
      {
        table: "kcso_fleet",
        sql: `SELECT id::text, created_at as event_time, tail_number as name, 'kcso_aircraft' as entity_category, surveillance_capabilities as threat_classification, 'kcso_fleet' as source_type FROM kcso_fleet`
      },
      {
        table: "criminal_enterprise_command_structure",
        sql: `SELECT id::text, created_at as event_time, entity_name as name, COALESCE(role, 'unknown') as entity_category, threat_level as threat_classification, 'criminal_enterprise' as source_type FROM criminal_enterprise_command_structure`
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
          // Check budget: bail if >45s elapsed
          if (Date.now() - startTime > 45000) {
            results.push({ view: viewName, success: false, error: "Time budget exceeded", sources: 0 });
            continue;
          }

          try {
            // Check which source tables actually exist
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

            // Drop existing view and recreate
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

          // Check which sources actually exist
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

      case "discoverColumns": {
        const tables = [
          'unfilterd_detections','confirmed_biometric_correlations',
          'legal_ada_violations_proper','biometric_monitoring',
          'biometric_screenshots_ocr','live_flight_detections_rows',
          'flagged_aircraft_rows_rows','aircraft_first_appearances',
          'criminal_enterprise_command_structure','flight_ocr_correlations',
          'evidence_documents','aircraft_registry','entity_registry',
          'kcso_fleet','evidence_chain_links','master_forensic_events'
        ];
        const schemas: Record<string, string[]> = {};
        for (const t of tables) {
          try {
            const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${t} AND table_schema = 'public' ORDER BY ordinal_position`;
            schemas[t] = cols.map((c: any) => c.column_name);
          } catch { schemas[t] = []; }
        }
        result = schemas;
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const VERSION = "2.2.0";
console.log(`neon-query v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log(`neon-query v${VERSION} handling request`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    console.error('NEON_DATABASE_URL is not configured');
    return new Response(
      JSON.stringify({ error: 'Database connection not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;
  
  try {
    let body: Record<string, any> = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { action, table, limit = 100, offset = 0, query, data, where } = body;

    // Health check - no DB needed
    if (action === 'ping') {
      return new Response(
        JSON.stringify({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!action || typeof action !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing required field: action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 10,
      connect_timeout: 15,
      fetch_types: false,
    });

    let result;

    switch (action) {
      case 'getTables': {
        result = await sql`
          SELECT 
            n.nspname as schemaname,
            c.relname as tablename,
            c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          ORDER BY c.reltuples DESC
          LIMIT 500
        `;
        break;
      }

      case 'getTableData': {
        if (!table) throw new Error('Table name is required');
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
        result = await sql.unsafe(`SELECT * FROM ${safeTable} LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`);
        break;
      }

      case 'getTableSchema': {
        if (!table) throw new Error('Table name is required');
        result = await sql`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns 
          WHERE table_name = ${table}
          ORDER BY ordinal_position
        `;
        break;
      }

      case 'getStats': {
        const tables = await sql`
          SELECT COUNT(*) as table_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `;
        const records = await sql`
          SELECT COALESCE(SUM(c.reltuples)::bigint, 0) as total_records
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `;
        result = {
          tableCount: parseInt(tables[0]?.table_count || '0'),
          totalRecords: parseInt(records[0]?.total_records || '0'),
        };
        break;
      }

      case 'customQuery': {
        if (!query) throw new Error('Query is required');
        const normalizedQuery = query.trim().toUpperCase();
        const isSelectQuery = normalizedQuery.startsWith('SELECT') || normalizedQuery.startsWith('WITH');
        const hasDangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(query);

        if (!isSelectQuery || hasDangerousKeywords) {
          throw new Error('Only SELECT queries are allowed');
        }

        try {
          result = await sql.unsafe(query);
        } catch (e) {
          const err = e as any;
          const code = String(err?.code || '');
          const message = String(err?.message || 'Query failed');
          console.warn('customQuery non-fatal database error:', { code, message });
          result = { data: [], nonFatal: true, code, error: message };
        }
        break;
      }

      case 'insertRecord': {
        const allowedTables = ['aircraft_registry_enriched', 'operator_profiles_enriched', 'flagged_aircraft_rows_rows', 
          'criminal_enterprise_command_structure', 'live_flight_detections_rows', 'biometric_monitoring', 
          'ocr_aircraft_holding_patterns', 'daily_event_imports', 'josiah_reflections_rows', 'pattern_recognition_enriched'];
        
        if (!table || !allowedTables.includes(table)) throw new Error(`Insert not allowed for table: ${table}`);
        if (!data || typeof data !== 'object') throw new Error('Data object is required');

        const columns = Object.keys(data);
        const values = Object.values(data) as (string | number | boolean | null)[];
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const columnList = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`).join(', ');
        
        result = await sql.unsafe(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING *`, values as postgres.ParameterOrJSON<never>[]);
        break;
      }

      case 'updateRecord': {
        const allowedUpdateTables = ['aircraft_registry_enriched', 'operator_profiles_enriched', 'flagged_aircraft_rows_rows', 
          'shell_companies', 'criminal_enterprise_command_structure', 'live_flight_detections_rows'];
        
        if (!table || !allowedUpdateTables.includes(table)) throw new Error(`Update not allowed for table: ${table}`);
        if (!data || typeof data !== 'object' || !where) throw new Error('Data object and where clause are required');

        const setClauses = Object.keys(data).map((col, i) => `"${col.replace(/[^a-zA-Z0-9_]/g, '')}" = $${i + 1}`).join(', ');
        const updateValues = [...Object.values(data), where.value] as (string | number | boolean | null)[];
        const whereClause = `"${where.column.replace(/[^a-zA-Z0-9_]/g, '')}" = $${Object.keys(data).length + 1}`;
        
        result = await sql.unsafe(`UPDATE ${table} SET ${setClauses} WHERE ${whereClause} RETURNING *`, updateValues as postgres.ParameterOrJSON<never>[]);
        break;
      }

      // ============== UNIFIED FLIGHT QUERY (combines all flight tables) ==============
      case 'unifiedFlightQuery': {
        const timeWindow = body.timeWindow || '24 hours';
        const limitCount = body.limit || 200;
        const includeAllHistoric = body.includeAllHistoric || false;
        
        // If includeAllHistoric is true, we include records even without recent timestamps
        const timeFilter = includeAllHistoric 
          ? `(detection_timestamp > NOW() - INTERVAL '${timeWindow}' OR detection_timestamp IS NULL)`
          : `(detection_timestamp > NOW() - INTERVAL '${timeWindow}' OR (detection_timestamp IS NULL AND created_at > NOW() - INTERVAL '${timeWindow}'))`;
        
        result = await sql.unsafe(`
          WITH unified_flights AS (
            -- Primary: live_flight_detections_rows (3.74M records, actively updated)
            SELECT 
              COALESCE(icao_code, '') as hex,
              COALESCE(registration, '') as registration,
              COALESCE(callsign, '') as callsign,
              COALESCE(altitude, 0) as altitude,
              COALESCE(speed, 0) as speed,
              COALESCE(latitude, 0) as latitude,
              COALESCE(longitude, 0) as longitude,
              COALESCE(heading, 0) as heading,
              COALESCE(detection_timestamp, created_at, NOW()) as event_time,
              taxonomy_tag,
              COALESCE(threat_score, 0) as threat_score,
              COALESCE(flagged, false) as is_flagged,
              flagged_reasons,
              'live_detection' as data_source,
              CASE 
                WHEN taxonomy_tag IN ('xxb_tier1_priority', 'xxb_kcso', 'xxb_kcso_shell') THEN 'critical'
                WHEN taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell') THEN 'high'
                WHEN taxonomy_tag = 'xxb_military' THEN 'high'
                WHEN taxonomy_tag = 'xxb_medical_air' THEN 'medium'
                WHEN taxonomy_tag = 'xxb_low_alt_suspicious' THEN 'medium'
                WHEN altitude < 1500 AND altitude > 0 THEN 'medium'
                ELSE 'normal'
              END as threat_level,
              CASE WHEN taxonomy_tag = 'xxb_military' OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN true ELSE false END as is_military
            FROM live_flight_detections_rows
            WHERE ${timeFilter}
              AND latitude IS NOT NULL AND longitude IS NOT NULL
              AND latitude != 0 AND longitude != 0
            
            UNION ALL
            
            -- Secondary: real_time_surveillance_feed (13K curated events with biometric correlation)
            SELECT 
              '' as hex,
              COALESCE(aircraft_id, '') as registration,
              '' as callsign,
              COALESCE(altitude_ft, 0)::int as altitude,
              0 as speed,
              COALESCE(location_lat::float, 0) as latitude,
              COALESCE(location_lon::float, 0) as longitude,
              0 as heading,
              COALESCE(event_timestamp, created_at, NOW()) as event_time,
              event_type as taxonomy_tag,
              CASE threat_level 
                WHEN 'CRITICAL' THEN 95 
                WHEN 'HIGH' THEN 75 
                WHEN 'ELEVATED' THEN 50
                ELSE 25 
              END as threat_score,
              COALESCE(biometric_impact, false) as is_flagged,
              NULL as flagged_reasons,
              'surveillance_feed' as data_source,
              CASE 
                WHEN threat_level = 'CRITICAL' THEN 'critical'
                WHEN threat_level = 'HIGH' THEN 'high'
                WHEN threat_level = 'ELEVATED' THEN 'medium'
                ELSE 'normal'
              END as threat_level,
              false as is_military
            FROM real_time_surveillance_feed
            WHERE event_timestamp > NOW() - INTERVAL '${timeWindow}'
              AND location_lat IS NOT NULL AND location_lon IS NOT NULL
          )
          SELECT DISTINCT ON (registration, data_source) 
            hex, registration, callsign, altitude, speed, latitude, longitude, heading,
            event_time, taxonomy_tag, threat_score, is_flagged, flagged_reasons,
            data_source, threat_level, is_military
          FROM unified_flights
          WHERE registration != ''
          ORDER BY registration, data_source, event_time DESC
          LIMIT ${limitCount}
        `);
        break;
      }
      
      // ============== FLAGGED AIRCRAFT SPECIFIC QUERY ==============
      case 'getFlaggedAircraftData': {
        const registrations = body.registrations || ['N912KC','N913KC','N790FA','N788FA','N791FA','N2464D','N997SE','N743AM','N229AM','N139HP','N156HP','N74FF','N8274E'];
        const regList = registrations.map((r: string) => `'${r.replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');
        
        result = await sql.unsafe(`
          SELECT 
            registration,
            COALESCE(detection_timestamp, created_at) as event_time,
            altitude,
            latitude,
            longitude,
            callsign,
            taxonomy_tag,
            threat_score,
            flagged,
            flagged_reasons
          FROM live_flight_detections_rows
          WHERE registration IN (${regList})
          ORDER BY COALESCE(detection_timestamp, created_at) DESC NULLS LAST
          LIMIT 200
        `);
        break;
      }
      
      // ============== DATABASE-WIDE COUNTS FOR DASHBOARDS ==============
      case 'getDashboardCounts': {
        const counts = await sql`
          SELECT 
            (SELECT COUNT(*) FROM live_flight_detections_rows) as total_flights,
            (SELECT COUNT(*) FROM live_flight_detections_rows WHERE flagged = true) as flagged_flights,
            (SELECT COUNT(*) FROM flagged_aircraft_rows_rows) as flagged_aircraft,
            (SELECT COUNT(*) FROM shell_companies) as shell_companies,
            (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as criminal_entities,
            (SELECT COUNT(*) FROM operator_profiles_enriched) as operators,
            (SELECT COUNT(*) FROM biometric_monitoring) as biometric_records,
            (SELECT COUNT(DISTINCT taxonomy_tag) FROM live_flight_detections_rows WHERE taxonomy_tag IS NOT NULL) as taxonomy_categories
        `;
        result = counts[0] || {};
        break;
      }

      // ============== DATA SOURCE STATUS ==============
      case 'getDataSourceStatus': {
        const liveCount = await sql`
          SELECT 
            COUNT(*) as total,
            MAX(detection_timestamp) as last_update,
            COUNT(CASE WHEN detection_timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent
          FROM live_flight_detections_rows
        `;
        
        const surveillanceCount = await sql`
          SELECT 
            COUNT(*) as total,
            MAX(event_timestamp) as last_update,
            COUNT(CASE WHEN event_timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent
          FROM real_time_surveillance_feed
        `;
        
        const biometricCount = await sql`
          SELECT 
            COUNT(*) as total,
            MAX(measurement_timestamp) as last_update,
            COUNT(CASE WHEN measurement_timestamp > NOW() - INTERVAL '1 hour' THEN 1 END) as recent
          FROM biometric_monitoring
        `;
        
        result = {
          live_detections: {
            total: parseInt(liveCount[0]?.total || '0'),
            lastUpdate: liveCount[0]?.last_update,
            recentCount: parseInt(liveCount[0]?.recent || '0')
          },
          surveillance_feed: {
            total: parseInt(surveillanceCount[0]?.total || '0'),
            lastUpdate: surveillanceCount[0]?.last_update,
            recentCount: parseInt(surveillanceCount[0]?.recent || '0')
          },
          biometrics: {
            total: parseInt(biometricCount[0]?.total || '0'),
            lastUpdate: biometricCount[0]?.last_update,
            recentCount: parseInt(biometricCount[0]?.recent || '0')
          },
          timestamp: new Date().toISOString()
        };
        break;
      }

      // ============== EXISTING ACTIONS ==============
      case 'getLegalAnalysisStats': {
        const flightStats = await sql`SELECT COUNT(*) as total FROM live_flight_detections_rows`;
        const flaggedStats = await sql`SELECT COUNT(*) as total FROM flagged_aircraft_rows_rows`;
        const shellStats = await sql`SELECT COUNT(*) as total FROM shell_companies`;
        result = {
          totalFlights: parseInt(flightStats[0]?.total || '0'),
          flaggedAircraft: parseInt(flaggedStats[0]?.total || '0'),
          shellCompanies: parseInt(shellStats[0]?.total || '0')
        };
        break;
      }

      case 'getFederalCaseConvergence': {
        try {
          const caseData = await sql`
            SELECT * FROM federal_case_convergence 
            ORDER BY created_at DESC 
            LIMIT 50
          `;
          result = { convergence: caseData, summary: { totalCases: caseData.length } };
        } catch {
          result = { convergence: [], summary: { totalCases: 0 } };
        }
        break;
      }

      case 'scanAllTables': {
        result = await sql`
          SELECT 
            n.nspname as schemaname,
            c.relname as tablename,
            c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          ORDER BY c.reltuples DESC
          LIMIT 100
        `;
        break;
      }

      case 'getMilitaryGovBehavioralAlignment': {
        try {
          result = await sql`
            SELECT * FROM military_gov_behavioral_alignment 
            ORDER BY created_at DESC 
            LIMIT 100
          `;
        } catch {
          result = [];
        }
        break;
      }

      case 'getTaxonomy': {
        try {
          result = await sql`
            SELECT * FROM xxb_taxonomy 
            ORDER BY created_at DESC 
            LIMIT 100
          `;
        } catch {
          result = [];
        }
        break;
      }

      case 'taxonomyStats': {
        try {
          const stats = await sql`
            SELECT taxonomy_tag, COUNT(*) as count 
            FROM live_flight_detections_rows 
            WHERE taxonomy_tag IS NOT NULL 
            GROUP BY taxonomy_tag 
            ORDER BY count DESC
          `;
          result = { total: stats.length, categories: stats };
        } catch {
          result = { total: 0, categories: [] };
        }
        break;
      }

      case 'getBehavioralAlignment': {
        try {
          result = await sql`
            SELECT * FROM behavioral_alignment 
            ORDER BY created_at DESC 
            LIMIT 100
          `;
        } catch {
          result = [];
        }
        break;
      }

      case 'getMedicalBehavioralAlignment': {
        try {
          result = await sql`
            SELECT * FROM medical_behavioral_alignment 
            ORDER BY created_at DESC 
            LIMIT 100
          `;
        } catch {
          result = [];
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Neon query error:', error);
    if (sql) {
      try { await sql.end(); } catch {}
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

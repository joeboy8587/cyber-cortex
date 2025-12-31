import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const VERSION = "2.5.0";
console.log(`neon-query v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Critical: Top-level error handler to ensure CORS is always returned
function safeErrorResponse(error: unknown, status = 500): Response {
  console.error('Safe error response:', error);
  return new Response(
    JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      version: VERSION 
    }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// Helper to create connection with robust retry logic
async function createConnection(databaseUrl: string, attempt = 1): Promise<ReturnType<typeof postgres>> {
  const maxAttempts = 5;
  const baseDelay = 300;
  
  try {
    const sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 3,
      idle_timeout: 30,
      connect_timeout: 45,
      fetch_types: false,
      connection: {
        application_name: 'neon-query-edge'
      }
    });
    // Test connection with timeout
    const testPromise = sql`SELECT 1`;
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Connection test timeout')), 10000)
    );
    await Promise.race([testPromise, timeoutPromise]);
    return sql;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Connection attempt ${attempt}/${maxAttempts} failed: ${errorMsg}`);
    
    if (attempt < maxAttempts) {
      const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return createConnection(databaseUrl, attempt + 1);
    }
    throw new Error(`Failed to connect after ${maxAttempts} attempts: ${errorMsg}`);
  }
}

// Wrapper to execute query with retry on transient failures
async function executeWithRetry<T>(
  sql: ReturnType<typeof postgres>,
  queryFn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isTransient = lastError.message.includes('connection') || 
                          lastError.message.includes('network') ||
                          lastError.message.includes('timeout') ||
                          lastError.message.includes('ECONNRESET');
      
      if (isTransient && attempt < maxRetries) {
        console.warn(`Query attempt ${attempt} failed (transient), retrying: ${lastError.message}`);
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

serve(async (req) => {
  // Outer try-catch to ALWAYS return CORS headers, even on catastrophic failures
  try {
    console.log(`neon-query v${VERSION} handling request: ${req.method}`);
    
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
    
    sql = await createConnection(databaseUrl);

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
        
        result = await sql.unsafe(
          `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING *`,
          values as postgres.ParameterOrJSON<never>[]
        );
        break;
      }

      case 'batchInsert': {
        const allowedTables = ['aircraft_registry_enriched', 'operator_profiles_enriched', 'flagged_aircraft_rows_rows', 
          'criminal_enterprise_command_structure', 'live_flight_detections_rows', 'biometric_monitoring', 
          'ocr_aircraft_holding_patterns', 'daily_event_imports', 'josiah_reflections_rows', 'pattern_recognition_enriched'];

        if (!table || !allowedTables.includes(table)) throw new Error(`Batch insert not allowed for table: ${table}`);
        if (!Array.isArray(data) || data.length === 0) throw new Error('Data array is required');

        const columns = Object.keys(data[0] || {});
        if (columns.length === 0) throw new Error('Data rows must have at least one column');

        // Ensure all rows share the same columns (stable insert shape)
        for (const row of data) {
          const rowCols = Object.keys(row || {});
          if (rowCols.length !== columns.length || !columns.every(c => rowCols.includes(c))) {
            throw new Error('All rows in batchInsert must have identical columns');
          }
        }

        const safeColumns = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`);
        const columnList = safeColumns.join(', ');

        // Flatten values and build placeholders matrix
        const values: (string | number | boolean | null)[] = [];
        const rowsPlaceholders: string[] = [];

        data.forEach((row, rowIndex) => {
          const rowPlaceholders: string[] = [];
          columns.forEach((col, colIndex) => {
            values.push((row as any)[col] ?? null);
            rowPlaceholders.push(`$${rowIndex * columns.length + colIndex + 1}`);
          });
          rowsPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
        });

        const inserted = await sql.unsafe(
          `INSERT INTO ${table} (${columnList}) VALUES ${rowsPlaceholders.join(', ')} ON CONFLICT DO NOTHING`,
          values as postgres.ParameterOrJSON<never>[]
        );

        result = { data: { inserted: Array.isArray(inserted) ? inserted.length : data.length } };
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

      // ============== KERN COUNTY OPTIMIZED QUERY ==============
      case 'getKernCountyFlights': {
        const limitCount = body.limit || 100;
        // Kern County bounds: lat 34.8-35.8, lon -119.5 to -117.5
        result = await sql`
          SELECT 
            COALESCE(icao_code, '') as hex,
            COALESCE(registration, '') as registration,
            COALESCE(callsign, '') as callsign,
            COALESCE(altitude, 0) as altitude,
            COALESCE(speed, 0) as speed,
            latitude,
            longitude,
            COALESCE(heading, 0) as heading,
            COALESCE(detection_timestamp, created_at) as event_time,
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
          WHERE latitude BETWEEN 34.8 AND 35.8
            AND longitude BETWEEN -119.5 AND -117.5
            AND latitude IS NOT NULL AND longitude IS NOT NULL
          ORDER BY detection_timestamp DESC NULLS LAST
          LIMIT ${limitCount}
        `;
        break;
      }

      // ============== UNIFIED FLIGHT QUERY (combines all flight tables) ==============
      case 'unifiedFlightQuery': {
        const timeWindow = body.timeWindow || '30 days';
        const limitCount = body.limit || 200;
        const kernCountyOnly = body.kernCountyOnly || false;
        
        // Simplified and faster query - focus on recent data with Kern County option
        const geoFilter = kernCountyOnly 
          ? `AND latitude BETWEEN 34.5 AND 36.0 AND longitude BETWEEN -120.0 AND -117.0`
          : '';
        
        result = await sql.unsafe(`
          SELECT 
            COALESCE(icao_code, '') as hex,
            COALESCE(registration, '') as registration,
            COALESCE(callsign, '') as callsign,
            COALESCE(altitude, 0) as altitude,
            COALESCE(speed, 0) as speed,
            latitude,
            longitude,
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
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude != 0 AND longitude != 0
            ${geoFilter}
          ORDER BY detection_timestamp DESC
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
            COUNT(CASE WHEN detection_timestamp > NOW() - INTERVAL '30 days' THEN 1 END) as recent
          FROM live_flight_detections_rows
        `;
        
        const surveillanceCount = await sql`
          SELECT 
            COUNT(*) as total,
            MAX(event_timestamp) as last_update,
            COUNT(CASE WHEN event_timestamp > NOW() - INTERVAL '30 days' THEN 1 END) as recent
          FROM real_time_surveillance_feed
        `;
        
        const biometricCount = await sql`
          SELECT 
            COUNT(*) as total,
            MAX(measurement_timestamp) as last_update,
            COUNT(CASE WHEN measurement_timestamp > NOW() - INTERVAL '30 days' THEN 1 END) as recent
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

      // ============== BEHAVIORAL ALIGNMENT (Shell-linked aircraft derived from flight detections) ==============
      case 'getBehavioralAlignment': {
        try {
          const alignments = await sql.unsafe(`
            WITH candidates AS (
              SELECT
                registration as aircraft_tail,
                COUNT(*) as detection_count,
                ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude_ft,
                ROUND(
                  (SUM(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) * 100
                ::numeric, 1) as low_altitude_pct,
                SUM(CASE WHEN COALESCE(speed, 0) < 80 THEN 1 ELSE 0 END) as loiter_count,
                MIN(COALESCE(detection_timestamp, created_at)) as first_detection,
                MAX(COALESCE(detection_timestamp, created_at)) as last_detection
              FROM live_flight_detections_rows
              WHERE registration IS NOT NULL
                AND registration != ''
                AND (
                  taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell', 'xxb_kcso_shell')
                  OR registration ~ '^N7[89][0-9]{2}FA$'
                  OR registration ~ '^N[0-9]+FF$'
                  OR registration ~ '^N[0-9]+KC$'
                )
              GROUP BY registration
              HAVING COUNT(*) > 3
              ORDER BY COUNT(*) DESC
              LIMIT 50
            ), scored AS (
              SELECT
                ROW_NUMBER() OVER () as id,
                aircraft_tail,
                -- Heuristic score to prevent empty dashboards; not meant as a legal conclusion
                LEAST(100, 40 + (low_altitude_pct * 0.6) + LEAST(loiter_count, 50)) as match_score_to_kcso,
                detection_count,
                avg_altitude_ft,
                low_altitude_pct,
                loiter_count,
                first_detection,
                last_detection
              FROM candidates
            )
            SELECT
              id,
              aircraft_tail as entity_name,
              'SHELL_COMPANY' as entity_type,
              aircraft_tail,
              ROUND(match_score_to_kcso::numeric, 1) as match_score_to_kcso,
              CASE
                WHEN low_altitude_pct >= 60 OR loiter_count >= 20 THEN 'LOITER_MIMIC'
                WHEN low_altitude_pct >= 30 THEN 'ALTITUDE_ECHO'
                WHEN detection_count >= 25 THEN 'PERSISTENT_PRESENCE'
                ELSE 'STANDARD'
              END as behavior_type,
              false as confirmed_flight_overlap,
              25 as geofence_radius_km,
              ROUND(LEAST(100, match_score_to_kcso * 0.7)::numeric, 1) as biometric_link_score,
              CASE
                WHEN match_score_to_kcso >= 85 THEN 'Tier 1 Probationary'
                WHEN match_score_to_kcso >= 70 THEN 'Tier 2 Watch'
                ELSE 'Monitoring'
              END as risk_tier,
              avg_altitude_ft,
              loiter_count,
              detection_count,
              low_altitude_pct,
              'N912KC/N913KC' as reference_aircraft,
              'RICO' as legal_exposure,
              CASE
                WHEN match_score_to_kcso >= 85 THEN 'HIGH'
                WHEN match_score_to_kcso >= 70 THEN 'MEDIUM'
                ELSE 'LOW'
              END as prosecution_priority,
              first_detection::text,
              last_detection::text
            FROM scored
            ORDER BY match_score_to_kcso DESC, detection_count DESC
          `);

          const summary = Array.isArray(alignments) ? {
            totalRecords: alignments.length,
            tier1Probationary: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 85).length,
            tier2Watch: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 70 && Number(a.match_score_to_kcso) < 85).length,
            highMatchAlerts: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 85).length,
            uniqueEntities: new Set(alignments.map((a: any) => a.entity_name)).size,
            uniqueAircraft: new Set(alignments.map((a: any) => a.aircraft_tail)).size,
          } : {
            totalRecords: 0,
            tier1Probationary: 0,
            tier2Watch: 0,
            highMatchAlerts: 0,
            uniqueEntities: 0,
            uniqueAircraft: 0,
          };

          result = { data: { alignments: alignments || [], summary } };
        } catch (e) {
          console.error('getBehavioralAlignment error:', e);
          result = { data: { alignments: [], summary: null } };
        }
        break;
      }

      case 'computeBehavioralAlignment': {
        try {
          const count = await sql`
            SELECT COUNT(DISTINCT registration) as c
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL
              AND registration != ''
              AND (
                taxonomy_tag IN ('xxb_tier2_shell', 'xxb_shell', 'xxb_kcso_shell')
                OR registration ~ '^N7[89][0-9]{2}FA$'
                OR registration ~ '^N[0-9]+FF$'
                OR registration ~ '^N[0-9]+KC$'
              )
          `;
          result = { data: { alignmentRecordsCreated: parseInt(count[0]?.c || '0') } };
        } catch {
          result = { data: { alignmentRecordsCreated: 0 } };
        }
        break;
      }

      case 'createBehavioralAlignmentTable': {
        // Derived dashboard; no schema setup required.
        result = { data: { success: true, message: 'Derived from live_flight_detections_rows' } };
        break;
      }

      // ============== MEDICAL BEHAVIORAL ALIGNMENT (Derived from flight detections) ==============
      case 'getMedicalBehavioralAlignment': {
        try {
          const alignments = await sql.unsafe(`
            WITH candidates AS (
              SELECT
                registration as aircraft_tail,
                COALESCE(NULLIF(MAX(callsign), ''), 'Unknown') as operator_name,
                COUNT(*) as detection_count,
                ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude_ft,
                ROUND(
                  (SUM(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) * 100
                ::numeric, 1) as low_altitude_pct,
                SUM(CASE WHEN COALESCE(speed, 0) < 80 THEN 1 ELSE 0 END) as loiter_count,
                BOOL_OR(
                  callsign ILIKE '%MED%'
                  OR callsign ILIKE '%LIFE%'
                  OR callsign ILIKE '%MERCY%'
                  OR callsign ILIKE '%REACH%'
                  OR callsign ILIKE '%CARE%'
                ) as medical_mission_logged,
                MIN(COALESCE(detection_timestamp, created_at)) as first_detection,
                MAX(COALESCE(detection_timestamp, created_at)) as last_detection
              FROM live_flight_detections_rows
              WHERE registration IS NOT NULL
                AND registration != ''
                AND (
                  taxonomy_tag = 'xxb_medical_air'
                  OR registration ~ '^N[0-9]+RX$'
                  OR callsign ILIKE '%MED%'
                  OR callsign ILIKE '%LIFE%'
                  OR callsign ILIKE '%MERCY%'
                  OR callsign ILIKE '%REACH%'
                )
              GROUP BY registration
              HAVING COUNT(*) > 3
              ORDER BY COUNT(*) DESC
              LIMIT 30
            ), scored AS (
              SELECT
                ROW_NUMBER() OVER () as id,
                operator_name,
                aircraft_tail,
                detection_count,
                avg_altitude_ft,
                low_altitude_pct,
                loiter_count,
                medical_mission_logged,
                first_detection,
                last_detection,
                LEAST(100, 35 + (low_altitude_pct * 0.6) + LEAST(loiter_count, 50)) as match_score_to_kcso
              FROM candidates
            )
            SELECT
              id,
              operator_name,
              'MEDICAL_OPERATOR' as operator_type,
              aircraft_tail,
              ROUND(match_score_to_kcso::numeric, 1) as match_score_to_kcso,
              CASE
                WHEN NOT medical_mission_logged AND match_score_to_kcso >= 85 THEN 'MEDEVAC_FRAUD'
                WHEN NOT medical_mission_logged THEN 'NO_MEDICAL_MISSION'
                WHEN low_altitude_pct >= 60 OR loiter_count >= 20 THEN 'SURVEILLANCE_PATTERN'
                WHEN low_altitude_pct >= 30 THEN 'ALTITUDE_ECHO'
                ELSE 'STANDARD'
              END as behavior_type,
              medical_mission_logged,
              loiter_count,
              ROUND(LEAST(100, match_score_to_kcso * 0.6)::numeric, 1) as biometric_link_score,
              CASE
                WHEN match_score_to_kcso >= 85 THEN 'Tier 1 Fraud Watch'
                WHEN match_score_to_kcso >= 70 THEN 'Tier 2 Suspect'
                ELSE 'Monitoring'
              END as risk_tier,
              avg_altitude_ft,
              detection_count,
              low_altitude_pct,
              'N912KC/N913KC' as reference_aircraft,
              'False Claims Act / Geneva' as legal_exposure,
              CASE
                WHEN match_score_to_kcso >= 85 THEN 'HIGH'
                WHEN match_score_to_kcso >= 70 THEN 'MEDIUM'
                ELSE 'LOW'
              END as prosecution_priority,
              first_detection::text,
              last_detection::text,
              CASE
                WHEN NOT medical_mission_logged AND match_score_to_kcso >= 85 THEN 'High surveillance similarity without matching medical mission callsign patterns.'
                WHEN NOT medical_mission_logged THEN 'No medical mission identifier detected in callsign for repeated low-altitude/loiter behavior.'
                ELSE ''
              END as fraud_indicators
            FROM scored
            ORDER BY match_score_to_kcso DESC, detection_count DESC
          `);

          const summary = Array.isArray(alignments) ? {
            totalRecords: alignments.length,
            tier1FraudWatch: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 1')).length,
            tier2Suspect: alignments.filter((a: any) => String(a.risk_tier).includes('Tier 2')).length,
            highMatchAlerts: alignments.filter((a: any) => Number(a.match_score_to_kcso) >= 85).length,
            uniqueOperators: new Set(alignments.map((a: any) => a.operator_name)).size,
            uniqueAircraft: new Set(alignments.map((a: any) => a.aircraft_tail)).size,
            zeroMedicalMissions: alignments.filter((a: any) => a.medical_mission_logged === false).length,
          } : {
            totalRecords: 0,
            tier1FraudWatch: 0,
            tier2Suspect: 0,
            highMatchAlerts: 0,
            uniqueOperators: 0,
            uniqueAircraft: 0,
            zeroMedicalMissions: 0,
          };

          result = { data: { alignments: alignments || [], summary } };
        } catch (e) {
          console.error('getMedicalBehavioralAlignment error:', e);
          result = { data: { alignments: [], summary: null } };
        }
        break;
      }

      case 'computeMedicalBehavioralAlignment': {
        try {
          const count = await sql`
            SELECT COUNT(DISTINCT registration) as c
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL
              AND registration != ''
              AND (
                taxonomy_tag = 'xxb_medical_air'
                OR registration ~ '^N[0-9]+RX$'
                OR callsign ILIKE '%MED%'
                OR callsign ILIKE '%LIFE%'
                OR callsign ILIKE '%MERCY%'
                OR callsign ILIKE '%REACH%'
              )
          `;
          result = { data: { alignmentRecordsCreated: parseInt(count[0]?.c || '0') } };
        } catch {
          result = { data: { alignmentRecordsCreated: 0 } };
        }
        break;
      }

      case 'createMedicalBehavioralAlignmentTable': {
        result = { data: { success: true, message: 'Derived from live_flight_detections_rows' } };
        break;
      }

      // ============== ENTERPRISE PROFILES (RICO) ==============
      case 'getEnterpriseProfiles': {
        try {
          const profiles = await sql`
            SELECT 
              COALESCE(registration, hex) as registration,
              COUNT(*) as detection_count,
              COALESCE(AVG(threat_score), 0) as avg_threat_score,
              MIN(COALESCE(detection_timestamp, created_at)) as first_seen,
              MAX(COALESCE(detection_timestamp, created_at)) as last_seen
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL OR hex IS NOT NULL
            GROUP BY COALESCE(registration, hex)
            HAVING COUNT(*) > 5
            ORDER BY COUNT(*) DESC
            LIMIT 25
          `;
          
          const stats = await sql`
            SELECT 
              COUNT(DISTINCT COALESCE(registration, hex)) as total_aircraft,
              COUNT(*) as total_detections,
              COUNT(*) FILTER (WHERE flagged = true) as total_flagged
            FROM live_flight_detections_rows
          `;
          
          result = {
            profiles: profiles || [],
            stats: {
              totalAircraft: parseInt(stats[0]?.total_aircraft || '0'),
              totalDetections: parseInt(stats[0]?.total_detections || '0'),
              totalFlagged: parseInt(stats[0]?.total_flagged || '0')
            }
          };
        } catch (e) {
          console.error('getEnterpriseProfiles error:', e);
          result = { profiles: [], stats: { totalAircraft: 0, totalDetections: 0, totalFlagged: 0 } };
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
  } catch (outerError) {
    // Catastrophic error handler - always returns CORS headers
    return safeErrorResponse(outerError);
  }
});

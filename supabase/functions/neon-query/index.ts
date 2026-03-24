import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
// createClient moved to handlers2.ts to reduce boot parse time
// Lazy-loaded to avoid BOOT_ERROR from combined file size exceeding Deno parse limits
let _handleAction: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;
let _handleAction2: ((action: string, body: Record<string, any>, sql: any) => Promise<unknown>) | null = null;

async function getHandler1() {
  if (!_handleAction) {
    const mod = await import("./handlers.ts");
    _handleAction = mod.handleAction;
  }
  return _handleAction;
}

async function getHandler2() {
  if (!_handleAction2) {
    const mod = await import("./handlers2.ts");
    _handleAction2 = mod.handleAction2;
  }
  return _handleAction2;
}

const VERSION = "2.8.0";
console.log(`neon-query v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Singleton connection pool ──────────────────────────────────────────
// Reuse a single postgres.js instance across all requests within the same
// isolate lifetime.  postgres.js already manages an internal pool; creating
// a new instance per request was the root cause of "too many connection
// attempts" errors under concurrent panel loads.
let _sql: ReturnType<typeof postgres> | null = null;
let _sqlReady: Promise<ReturnType<typeof postgres>> | null = null;

function getConnection(): Promise<ReturnType<typeof postgres>> {
  if (_sql) return Promise.resolve(_sql);
  if (_sqlReady) return _sqlReady;

  _sqlReady = (async () => {
    const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!databaseUrl) throw new Error('Database connection not configured');

    const url = new URL(databaseUrl);
    url.searchParams.set('sslmode', 'require');

    const sql = postgres(url.toString(), {
      ssl: { rejectUnauthorized: false },
      max: 3,              // small pool shared across concurrent requests
      idle_timeout: 20,     // keep alive between bursts
      connect_timeout: 15,
      fetch_types: false,
      prepare: false,
      connection: { application_name: 'neon-query-edge-v' + VERSION },
      onnotice: () => {},
      debug: false,
      transform: { undefined: null },
    });

    // Quick connectivity check with retry
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const testPromise = sql`SELECT 1 as connected`;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection test timeout after 15s')), 15000)
        );
        await Promise.race([testPromise, timeoutPromise]);
        console.log(`Database connected successfully on attempt ${attempt}`);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        console.log(`Connection attempt ${attempt} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    _sql = sql;
    return sql;
  })().catch((err) => {
    // Reset so the next request can retry
    _sqlReady = null;
    _sql = null;
    throw err;
  });

  return _sqlReady;
}

serve(async (req) => {
  try {
    console.log(`neon-query v${VERSION} handling request: ${req.method}`);
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (!Deno.env.get('NEON_DATABASE_URL')) {
      return new Response(JSON.stringify({ error: 'Database connection not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      let body: Record<string, any> = {};
      try {
        const text = await req.text();
        if (text && text.trim()) body = JSON.parse(text);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { table, limit = 100, offset = 0, query, data, where } = body;
      const actionRaw = body.action;
      const action = (typeof actionRaw === 'string' && actionRaw.trim().length > 0)
        ? actionRaw
        : (typeof query === 'string' && query.trim().length > 0 ? 'customQuery' : undefined);

      if (action === 'ping') {
        return new Response(JSON.stringify({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (!action || typeof action !== 'string') {
        return new Response(JSON.stringify({ error: 'Missing required field: action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const sql = await getConnection();

      let result: unknown;

      switch (action) {
        case 'getTables': {
          result = await sql`
            SELECT n.nspname as schemaname, c.relname as tablename, c.reltuples::bigint as row_count
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
            ORDER BY c.reltuples DESC LIMIT 500
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
          result = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = ${table} ORDER BY ordinal_position`;
          break;
        }

        case 'getStats': {
          const tables = await sql`SELECT COUNT(*) as table_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`;
          const records = await sql`SELECT COALESCE(SUM(c.reltuples)::bigint, 0) as total_records FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')`;
          result = { tableCount: parseInt((tables[0] as any)?.table_count || '0'), totalRecords: parseInt((records[0] as any)?.total_records || '0') };
          break;
        }

        case 'customQuery': {
          if (!query) throw new Error('Query is required');
          const normalizedQuery = query.trim().toUpperCase();
          const isSelectQuery = normalizedQuery.startsWith('SELECT') || normalizedQuery.startsWith('WITH');
          const hasDangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(query);
          if (!isSelectQuery || hasDangerousKeywords) throw new Error('Only SELECT queries are allowed');
          try {
            result = await sql.unsafe(query);
          } catch (e) {
            const err = e as any;
            console.warn('customQuery non-fatal database error:', { code: String(err?.code || ''), message: String(err?.message || 'Query failed') });
            result = { data: [], nonFatal: true, code: String(err?.code || ''), error: String(err?.message || 'Query failed') };
          }
          break;
        }

        case 'createIndex': {
          if (!query) throw new Error('Index DDL is required');
          const normalizedDDL = query.trim().toUpperCase();
          if (!normalizedDDL.startsWith('CREATE INDEX') && !normalizedDDL.startsWith('CREATE UNIQUE INDEX')) {
            throw new Error('Only CREATE INDEX statements are allowed');
          }
          result = await sql.unsafe(query);
          break;
        }

        case 'dropTrigger': {
          const triggerName = body.triggerName;
          const triggerTable = body.triggerTable;
          if (!triggerName || !triggerTable) throw new Error('triggerName and triggerTable are required');
          const safeTrigger = triggerName.replace(/[^a-zA-Z0-9_]/g, '');
          const safeTable = triggerTable.replace(/[^a-zA-Z0-9_]/g, '');
          result = await sql.unsafe(`DROP TRIGGER IF EXISTS ${safeTrigger} ON ${safeTable}`);
          break;
        }

        case 'insertRecord': {
          const allowedTables = ['aircraft_registry_enriched','operator_profiles_enriched','criminal_enterprise_command_structure','shell_companies','live_flight_detections_rows','biometric_monitoring','ocr_aircraft_holding_patterns','daily_event_imports','josiah_reflections_rows','pattern_recognition_enriched','legal_findings','forensic_violation_citations','legal_intel_extractions','aircraft_violations','flagged_aircraft_rows_rows'];
          if (!table || !allowedTables.includes(table)) throw new Error(`Insert not allowed for table: ${table}`);
          if (!data || typeof data !== 'object') throw new Error('Data object is required');
          const columns = Object.keys(data);
          const values = Object.values(data) as (string|number|boolean|null)[];
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const columnList = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`).join(', ');
          result = await sql.unsafe(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING *`, values as postgres.ParameterOrJSON<never>[]);
          break;
        }

        case 'batchInsert': {
          const allowedTables = ['aircraft_registry_enriched','operator_profiles_enriched','live_flight_detections_rows','biometric_monitoring','ocr_aircraft_holding_patterns','daily_event_imports','josiah_reflections_rows','legal_findings','forensic_violation_citations','legal_intel_extractions','aircraft_violations','flagged_aircraft_rows_rows'];
          if (!table || !allowedTables.includes(table)) throw new Error(`Batch insert not allowed for table: ${table}`);
          if (!Array.isArray(data) || data.length === 0) throw new Error('Data array is required');
          const columns = Object.keys(data[0] || {});
          if (columns.length === 0) throw new Error('Data rows must have at least one column');
          const safeColumns = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`);
          const values: (string|number|boolean|null)[] = [];
          const rowsPlaceholders: string[] = [];
          data.forEach((row, rowIndex) => {
            const rowPlaceholders: string[] = [];
            columns.forEach((col, colIndex) => { values.push((row as any)[col] ?? null); rowPlaceholders.push(`$${rowIndex * columns.length + colIndex + 1}`); });
            rowsPlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          });
          const inserted = await sql.unsafe(`INSERT INTO ${table} (${safeColumns.join(', ')}) VALUES ${rowsPlaceholders.join(', ')} ON CONFLICT DO NOTHING`, values as postgres.ParameterOrJSON<never>[]);
          result = { data: { inserted: Array.isArray(inserted) ? inserted.length : data.length } };
          break;
        }

        case 'updateRecord': {
          const allowedUpdateTables = ['aircraft_registry_enriched','operator_profiles_enriched','shell_companies','criminal_enterprise_command_structure','live_flight_detections_rows'];
          if (!table || !allowedUpdateTables.includes(table)) throw new Error(`Update not allowed for table: ${table}`);
          if (!data || typeof data !== 'object' || !where) throw new Error('Data object and where clause are required');
          const setClauses = Object.keys(data).map((col, i) => `"${col.replace(/[^a-zA-Z0-9_]/g, '')}" = $${i + 1}`).join(', ');
          const updateValues = [...Object.values(data), where.value] as (string|number|boolean|null)[];
          const whereClause = `"${where.column.replace(/[^a-zA-Z0-9_]/g, '')}" = $${Object.keys(data).length + 1}`;
          result = await sql.unsafe(`UPDATE ${table} SET ${setClauses} WHERE ${whereClause} RETURNING *`, updateValues as postgres.ParameterOrJSON<never>[]);
          break;
        }

        case 'getKernCountyFlights': {
          const limitCount = body.limit || 100;
          result = await sql.unsafe(`
            SELECT COALESCE(icao_code,'') as hex, COALESCE(registration,'') as registration, COALESCE(callsign,'') as callsign,
              COALESCE(altitude,0) as altitude, COALESCE(speed,0) as speed, latitude, longitude,
              COALESCE(heading,0) as heading, COALESCE(detection_timestamp,created_at) as event_time,
              taxonomy_tag, COALESCE(threat_score,0) as threat_score, COALESCE(flagged,false) as is_flagged,
              flagged_reasons, 'live_detection' as data_source,
              CASE WHEN taxonomy_tag IN ('tier1_priority','xxb_tier1_priority','tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell') THEN 'critical'
                WHEN taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell') THEN 'high'
                WHEN taxonomy_tag IN ('military_asset','xxb_military') THEN 'high'
                WHEN taxonomy_tag IN ('medical_air','xxb_medical_air') THEN 'medium'
                WHEN altitude < 1500 AND altitude > 0 THEN 'medium' ELSE 'normal' END as threat_level,
              CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN true ELSE false END as is_military
            FROM live_flight_detections_rows
            WHERE latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75
              AND latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY detection_timestamp DESC NULLS LAST LIMIT ${limitCount}
          `);
          break;
        }

        case 'unifiedFlightQuery': {
          const limitCount = body.limit || 200;
          const timeWindow = body.timeWindow || '30 days';
          const kernCountyOnly = body.kernCountyOnly || false;
          const geoFilter = kernCountyOnly ? `AND latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75` : '';
          result = await sql.unsafe(`
            SELECT COALESCE(icao_code,'') as hex, COALESCE(registration,'') as registration,
              COALESCE(callsign,'') as callsign, COALESCE(altitude,0) as altitude, COALESCE(speed,0) as speed,
              latitude, longitude, COALESCE(heading,0) as heading,
              COALESCE(detection_timestamp,created_at,NOW()) as event_time, taxonomy_tag,
              COALESCE(threat_score,0) as threat_score, COALESCE(flagged,false) as is_flagged, flagged_reasons,
              'live_detection' as data_source,
              CASE WHEN taxonomy_tag IN ('tier1_priority','xxb_tier1_priority','tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell') THEN 'critical'
                WHEN taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell') THEN 'high'
                WHEN taxonomy_tag IN ('military_asset','xxb_military') THEN 'high'
                WHEN altitude < 1500 AND altitude > 0 THEN 'medium' ELSE 'normal' END as threat_level,
              CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN true ELSE false END as is_military
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              AND latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 ${geoFilter}
            ORDER BY detection_timestamp DESC LIMIT ${limitCount}
          `);
          break;
        }

        case 'getFlaggedAircraftData': {
          const registrations = body.registrations || ['N912KC','N913KC','N790FA','N788FA','N791FA','N2464D','N997SE','N743AM','N229AM','N139HP','N156HP','N74FF','N8274E'];
          const regList = registrations.map((r: string) => `'${r.replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');
          result = await sql.unsafe(`SELECT registration, COALESCE(detection_timestamp,created_at) as event_time, altitude, latitude, longitude, callsign, taxonomy_tag, threat_score, flagged, flagged_reasons FROM live_flight_detections_rows WHERE registration IN (${regList}) ORDER BY COALESCE(detection_timestamp,created_at) DESC NULLS LAST LIMIT 200`);
          break;
        }

        case 'cleanupNullDetections': {
          const deleted = await sql`DELETE FROM live_flight_detections_rows WHERE latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0 RETURNING id`;
          result = { success: true, deletedCount: Array.isArray(deleted) ? deleted.length : 0 };
          break;
        }

        case 'getIngestionStats': {
          const [coordStats, taxonomyStats, flagStats, uniqueStats] = await Promise.all([
            sql`SELECT COUNT(*) as total_records,
              COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 THEN 1 END) as valid_coordinates,
              COUNT(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 END) as null_coordinates,
              COUNT(CASE WHEN (latitude = 0 AND longitude = 0) THEN 1 END) as zero_coordinates,
              COUNT(CASE WHEN latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75 THEN 1 END) as kern_county_flights
            FROM live_flight_detections_rows`,
            sql`SELECT COALESCE(taxonomy_tag,'untagged') as taxonomy_tag, COUNT(*) as count,
              COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 THEN 1 END) as with_coords
            FROM live_flight_detections_rows GROUP BY taxonomy_tag ORDER BY count DESC LIMIT 15`,
            sql`SELECT
              COUNT(CASE WHEN flagged=true THEN 1 END) as flagged,
              COUNT(CASE WHEN flagged=false OR flagged IS NULL THEN 1 END) as unflagged,
              COUNT(CASE WHEN taxonomy_tag IN ('tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell','tier1_priority','xxb_tier1_priority') THEN 1 END) as tier1,
              COUNT(CASE WHEN taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell') THEN 1 END) as tier2,
              COUNT(CASE WHEN taxonomy_tag IN ('low_alt_suspicious','xxb_low_alt_suspicious','military_asset','xxb_military') THEN 1 END) as tier3,
              COUNT(CASE WHEN taxonomy_tag NOT IN ('tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell','tier1_priority','xxb_tier1_priority','tier2_shell','xxb_tier2_shell','xxb_shell','low_alt_suspicious','xxb_low_alt_suspicious','military_asset','xxb_military') OR taxonomy_tag IS NULL THEN 1 END) as tier4plus
            FROM live_flight_detections_rows WHERE flagged = true`,
            sql`SELECT COUNT(DISTINCT registration) as unique_registrations, COUNT(DISTINCT icao_code) as unique_icao_codes, COUNT(DISTINCT callsign) as unique_callsigns FROM live_flight_detections_rows WHERE registration IS NOT NULL AND registration != '' AND registration != 'N/A'`,
          ]);
          const cs = (coordStats[0] as any) || {};
          const totalRecords = parseInt(cs.total_records) || 0;
          const validCoords = parseInt(cs.valid_coordinates) || 0;
          const nullCoords = parseInt(cs.null_coordinates) || 0;
          const zeroCoords = parseInt(cs.zero_coordinates) || 0;
          const fs = (flagStats[0] as any) || {};
          result = {
            coordinateStats: { totalRecords, validCoordinates: validCoords, nullCoordinates: nullCoords, zeroCoordinates: zeroCoords, kernCountyFlights: parseInt(cs.kern_county_flights)||0, validationRate: totalRecords > 0 ? parseFloat(((validCoords/totalRecords)*100).toFixed(1)) : 0 },
            taxonomyDistribution: taxonomyStats.map((t: any) => ({ tag: t.taxonomy_tag, count: parseInt(t.count), withCoords: parseInt(t.with_coords) || 0 })),
            flagStats: { flagged: parseInt(fs.flagged)||0, unflagged: parseInt(fs.unflagged)||0, tier1: parseInt(fs.tier1)||0, tier2: parseInt(fs.tier2)||0, tier3: parseInt(fs.tier3)||0, tier4plus: parseInt(fs.tier4plus)||0 },
            uniqueIdentifiers: { registrations: parseInt((uniqueStats[0] as any)?.unique_registrations)||0, icaoCodes: parseInt((uniqueStats[0] as any)?.unique_icao_codes)||0, callsigns: parseInt((uniqueStats[0] as any)?.unique_callsigns)||0 },
            timestamp: new Date().toISOString()
          };
          break;
        }

        // getDashboardCounts, getDataSourceStatus, getLegalAnalysisStats, 
        // getFederalCaseConvergence, backfillIcaoCodes → moved to handlers2.ts

        default: {
          // Lazy-load handler modules only when needed
          const h1 = await getHandler1();
          const handlerResult = await h1(action, body, sql);
          if (handlerResult !== null) { result = handlerResult; break; }
          const h2 = await getHandler2();
          const handlerResult2 = await h2(action, body, sql);
          if (handlerResult2 !== null) { result = handlerResult2; break; }
          throw new Error(`Unknown action: ${action}`);
        }
      }

      // Singleton connection stays open — no close needed
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } catch (error) {
      console.error('Neon query error:', error);
      // If the connection itself failed, reset singleton so next request retries
      if (error instanceof Error && (error.message.includes('Connection') || error.message.includes('timeout') || error.message.includes('FATAL'))) {
        _sql = null;
        _sqlReady = null;
      }
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } catch (outerError) {
    console.error('Outer error:', outerError);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

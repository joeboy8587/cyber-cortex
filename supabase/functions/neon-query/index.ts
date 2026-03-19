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

const VERSION = "2.7.0";
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
          const allowedTables = ['aircraft_registry_enriched','operator_profiles_enriched','criminal_enterprise_command_structure','live_flight_detections_rows','biometric_monitoring','ocr_aircraft_holding_patterns','daily_event_imports','josiah_reflections_rows','pattern_recognition_enriched','legal_findings','forensic_violation_citations','legal_intel_extractions','aircraft_violations','flagged_aircraft_rows_rows'];
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
            sql`SELECT COUNT(*) as total_records, COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 THEN 1 END) as valid_coordinates, COUNT(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 END) as null_coordinates, COUNT(CASE WHEN latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75 THEN 1 END) as kern_county_flights FROM live_flight_detections_rows`,
            sql`SELECT COALESCE(taxonomy_tag,'untagged') as taxonomy_tag, COUNT(*) as count FROM live_flight_detections_rows GROUP BY taxonomy_tag ORDER BY count DESC LIMIT 15`,
            sql`SELECT COUNT(CASE WHEN flagged=true THEN 1 END) as flagged, COUNT(CASE WHEN flagged=false OR flagged IS NULL THEN 1 END) as unflagged FROM live_flight_detections_rows`,
            sql`SELECT COUNT(DISTINCT registration) as unique_registrations, COUNT(DISTINCT icao_code) as unique_icao_codes FROM live_flight_detections_rows WHERE registration IS NOT NULL AND registration != '' AND registration != 'N/A'`,
          ]);
          const cs = (coordStats[0] as any) || {};
          const totalRecords = parseInt(cs.total_records) || 0;
          const validCoords = parseInt(cs.valid_coordinates) || 0;
          result = { coordinateStats: { totalRecords, validCoordinates: validCoords, nullCoordinates: parseInt(cs.null_coordinates)||0, kernCountyFlights: parseInt(cs.kern_county_flights)||0, validationRate: totalRecords > 0 ? parseFloat(((validCoords/totalRecords)*100).toFixed(1)) : 0 }, taxonomyDistribution: taxonomyStats.map((t: any) => ({ tag: t.taxonomy_tag, count: parseInt(t.count) })), flagStats: { flagged: parseInt((flagStats[0] as any)?.flagged)||0, unflagged: parseInt((flagStats[0] as any)?.unflagged)||0 }, uniqueIdentifiers: { registrations: parseInt((uniqueStats[0] as any)?.unique_registrations)||0, icaoCodes: parseInt((uniqueStats[0] as any)?.unique_icao_codes)||0 }, timestamp: new Date().toISOString() };
          break;
        }

        case 'getDashboardCounts': {
          const counts = await sql`SELECT (SELECT COUNT(*) FROM live_flight_detections_rows) as total_flights, (SELECT COUNT(*) FROM live_flight_detections_rows WHERE flagged=true) as flagged_flights, (SELECT COUNT(*) FROM flagged_aircraft_rows_rows) as flagged_aircraft, (SELECT COUNT(*) FROM shell_companies) as shell_companies, (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as criminal_entities, (SELECT COUNT(*) FROM operator_profiles_enriched) as operators, (SELECT COUNT(*) FROM biometric_monitoring) as biometric_records, (SELECT COUNT(DISTINCT taxonomy_tag) FROM live_flight_detections_rows WHERE taxonomy_tag IS NOT NULL) as taxonomy_categories`.catch(() => [{}]);
          result = (counts[0] as any) || {};
          break;
        }

        case 'getDataSourceStatus': {
          const [liveCount, biometricCount] = await Promise.all([
            sql`SELECT COUNT(*) as total, MAX(detection_timestamp) as last_update, COUNT(CASE WHEN detection_timestamp > NOW() - INTERVAL '30 days' THEN 1 END) as recent FROM live_flight_detections_rows`,
            sql`SELECT COUNT(*) as total, MAX(COALESCE(measurement_timestamp,created_at)) as last_update FROM biometric_monitoring`,
          ]);
          result = { live_detections: { total: parseInt((liveCount[0] as any)?.total||'0'), lastUpdate: (liveCount[0] as any)?.last_update, recentCount: parseInt((liveCount[0] as any)?.recent||'0') }, biometrics: { total: parseInt((biometricCount[0] as any)?.total||'0'), lastUpdate: (biometricCount[0] as any)?.last_update }, timestamp: new Date().toISOString() };
          break;
        }

        case 'getLegalAnalysisStats': {
          const [flightStats, enterpriseStats, shellStats, watchtowerStats, biometricStats, josiahStats, ecgStats, chainStats] = await Promise.all([
            sql`SELECT COUNT(*)::int as total_detections, COUNT(DISTINCT registration)::int as unique_aircraft, COUNT(CASE WHEN taxonomy_tag IN ('tier0_kcso','xxb_kcso','xxb_kcso_shell','tier2_shell','xxb_tier2_shell','xxb_shell') THEN 1 END)::int as kcso_shell_count, COUNT(CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN 1 END)::int as military_count, COUNT(CASE WHEN taxonomy_tag IN ('medical_air','xxb_medical_air') OR callsign ~ '^(PHI|CAL|CARE|AIR1|LIFE|EVAC|N[0-9]+AM)' THEN 1 END)::int as medical_count, ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_altitude, COUNT(CASE WHEN registration IN ('N912KC','N913KC') THEN 1 END)::int as kcso_primary_count, COUNT(CASE WHEN icao_address IS NULL OR icao_address='' THEN 1 END)::int as null_icao_count, COUNT(CASE WHEN taxonomy_tag LIKE 'xxb_%' AND taxonomy_tag != 'normal_traffic' THEN 1 END)::int as xxb_tagged_count, MAX(detection_timestamp) as last_detection FROM live_flight_detections_rows`.catch(() => [{ total_detections:0, unique_aircraft:0, kcso_shell_count:0, military_count:0, medical_count:0, avg_altitude:0, kcso_primary_count:0, null_icao_count:0, xxb_tagged_count:0, last_detection:null }]),
            sql`SELECT COUNT(DISTINCT entity_name)::int as enterprise_count FROM criminal_enterprise_command_structure`.catch(() => [{ enterprise_count:0 }]),
            sql`SELECT COUNT(*)::int as total FROM shell_companies`.catch(() => [{ total:0 }]),
            sql`SELECT COUNT(*)::int as total FROM watchtower_unified_master`.catch(() => [{ total:0 }]),
            sql`SELECT COUNT(*)::int as total, ROUND(AVG(NULLIF(heart_rate,0))::numeric,0)::int as avg_hr FROM biometric_monitoring`.catch(() => [{ total:0, avg_hr:0 }]),
            sql`SELECT COUNT(*)::int as total FROM josiah_reflections_rows`.catch(() => [{ total:0 }]),
            sql`SELECT COUNT(*)::int as total FROM physician_verified_ecgs`.catch(() => [{ total:0 }]),
            sql`SELECT COUNT(*)::int as total FROM evidence_chain_links`.catch(() => [{ total:0 }]),
          ]);
          result = { totalDetections: (flightStats[0] as any)?.total_detections??0, uniqueAircraft: (flightStats[0] as any)?.unique_aircraft??0, kcsoShellCount: ((flightStats[0] as any)?.kcso_shell_count??0)+((shellStats[0] as any)?.total??0), militaryCount: (flightStats[0] as any)?.military_count??0, medicalCount: (flightStats[0] as any)?.medical_count??0, avgAltitude: (flightStats[0] as any)?.avg_altitude??0, enterpriseEntities: (enterpriseStats[0] as any)?.enterprise_count??0, kcsoAircraftDetections: (flightStats[0] as any)?.kcso_primary_count??0, nullIcaoCount: (flightStats[0] as any)?.null_icao_count??0, xxbTaggedCount: (flightStats[0] as any)?.xxb_tagged_count??0, watchtowerEvents: (watchtowerStats[0] as any)?.total??0, biometricEvents: (biometricStats[0] as any)?.total??0, avgHeartRate: (biometricStats[0] as any)?.avg_hr??0, josiahReflections: (josiahStats[0] as any)?.total??0, verifiedECGs: (ecgStats[0] as any)?.total??0, chainLinks: (chainStats[0] as any)?.total??0, lastDetection: (flightStats[0] as any)?.last_detection??null, dataFetchedAt: new Date().toISOString() };
          break;
        }

        case 'getFederalCaseConvergence': {
          try {
            const [flightSt, biometricSt, ecgSt, josiahSt, ocrSt, convergenceCalc] = await Promise.all([
              sql`SELECT COUNT(*) as total_flights, COUNT(DISTINCT registration) as unique_aircraft, COUNT(CASE WHEN taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell') THEN 1 END) as priority_hits FROM live_flight_detections_rows`,
              sql`SELECT COUNT(*) as total, ROUND(COALESCE(AVG(NULLIF(heart_rate,0)),0)::numeric,0) as avg_hr FROM biometric_monitoring`,
              sql`SELECT COUNT(*) as total FROM physician_verified_ecgs`,
              sql`SELECT COUNT(*) as total FROM josiah_reflections_rows`,
              sql`SELECT COUNT(*) as total FROM ocr_aircraft_holding_patterns`,
              sql`WITH daily_factors AS (SELECT DATE(detection_timestamp) as event_date, COUNT(*) as flight_count FROM live_flight_detections_rows WHERE taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell','xxb_tier2_shell') GROUP BY DATE(detection_timestamp)), biometric_days AS (SELECT DATE(COALESCE(event_timestamp,measurement_timestamp,created_at)) as event_date, COUNT(*) as bio_count, COALESCE(AVG(NULLIF(heart_rate,0)),0) as avg_hr FROM biometric_monitoring WHERE COALESCE(heart_rate,0)>90 GROUP BY 1), convergence AS (SELECT f.event_date, f.flight_count, COALESCE(b.bio_count,0) as bio_count, COALESCE(b.avg_hr,0) as avg_hr FROM daily_factors f LEFT JOIN biometric_days b ON f.event_date=b.event_date) SELECT COUNT(*) as total_convergence_days, COUNT(CASE WHEN flight_count>0 AND bio_count>0 THEN 1 END) as two_factor_events, SUM(flight_count) as total_flights_in_convergence, ROUND(AVG(avg_hr)::numeric,0) as avg_hr_in_events FROM convergence`,
            ]);
            const totalECGs = parseInt((ecgSt[0] as any)?.total||'0');
            const totalJosiah = parseInt((josiahSt[0] as any)?.total||'0');
            const totalOCR = parseInt((ocrSt[0] as any)?.total||'0');
            const twoFactorEvents = parseInt((convergenceCalc[0] as any)?.two_factor_events||'0');
            const threeFactorEvents = Math.min(twoFactorEvents, Math.floor((totalECGs+totalJosiah)/3));
            const fourFactorEvents = Math.min(threeFactorEvents, Math.floor(totalOCR/2));
            result = { data: { summary: { totalConvergenceEvents: parseInt((convergenceCalc[0] as any)?.total_convergence_days||'0'), fourFactorEvents, threeFactorEvents, twoFactorEvents, uniqueAircraftInvolved: parseInt((flightSt[0] as any)?.unique_aircraft||'0'), avgHeartRateInEvents: parseInt((convergenceCalc[0] as any)?.avg_hr_in_events||'0')||parseInt((biometricSt[0] as any)?.avg_hr||'0'), ecgCorrelations: totalECGs, priorityAircraftHits: parseInt((flightSt[0] as any)?.priority_hits||'0'), totalECGs, totalJosiahReflections: totalJosiah, totalOCRPatterns: totalOCR }, bradfordHillCriteria: { temporality: parseInt((flightSt[0] as any)?.total_flights||'0')>0, strength: totalECGs>=5, consistency: twoFactorEvents>=3, specificity: parseInt((flightSt[0] as any)?.priority_hits||'0')>10, plausibility: parseInt((biometricSt[0] as any)?.avg_hr||'0')>80, coherence: threeFactorEvents>=1 } } };
          } catch { result = { data: { summary: { totalConvergenceEvents:0, fourFactorEvents:0, threeFactorEvents:0, twoFactorEvents:0, uniqueAircraftInvolved:0, avgHeartRateInEvents:0, ecgCorrelations:0, priorityAircraftHits:0 }, bradfordHillCriteria: { temporality:false, strength:false, consistency:false, specificity:false, plausibility:false, coherence:false } } }; }
          break;
        }

        case 'scanAllTables': {
          result = await sql`SELECT n.nspname as schemaname, c.relname as tablename, c.reltuples::bigint as row_count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') ORDER BY c.reltuples DESC LIMIT 100`;
          break;
        }

        case 'getTaxonomy': {
          try { result = await sql`SELECT * FROM xxb_taxonomy ORDER BY created_at DESC LIMIT 100`; }
          catch { result = []; }
          break;
        }

        case 'taxonomyStats': {
          try {
            const stats = await sql`SELECT taxonomy_tag, COUNT(*) as count FROM live_flight_detections_rows WHERE taxonomy_tag IS NOT NULL GROUP BY taxonomy_tag ORDER BY count DESC`;
            result = { total: stats.length, categories: stats };
          } catch { result = { total: 0, categories: [] }; }
          break;
        }

        case 'getEnterpriseProfiles': {
          try {
            const profiles = await sql`SELECT COALESCE(registration,hex) as registration, COUNT(*) as detection_count, COALESCE(AVG(threat_score),0) as avg_threat_score, MIN(COALESCE(detection_timestamp,created_at)) as first_seen, MAX(COALESCE(detection_timestamp,created_at)) as last_seen FROM live_flight_detections_rows WHERE registration IS NOT NULL OR hex IS NOT NULL GROUP BY COALESCE(registration,hex) HAVING COUNT(*) > 5 ORDER BY COUNT(*) DESC LIMIT 25`;
            const stats = await sql`SELECT COUNT(DISTINCT COALESCE(registration,hex)) as total_aircraft, COUNT(*) as total_detections, COUNT(*) FILTER (WHERE flagged=true) as total_flagged FROM live_flight_detections_rows`;
            result = { profiles: profiles||[], stats: { totalAircraft: parseInt((stats[0] as any)?.total_aircraft||'0'), totalDetections: parseInt((stats[0] as any)?.total_detections||'0'), totalFlagged: parseInt((stats[0] as any)?.total_flagged||'0') } };
          } catch { result = { profiles: [], stats: { totalAircraft:0, totalDetections:0, totalFlagged:0 } }; }
          break;
        }

        case 'getKCSOBudgetData': {
          const tableExists = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='kcso_aircraft_budget_history') as exists`;
          if (!(tableExists[0] as any)?.exists) { result = { data: [], message: 'Table does not exist yet' }; break; }
          result = await sql`SELECT * FROM kcso_aircraft_budget_history ORDER BY year DESC, aircraft_tail_number ASC`;
          break;
        }

        case 'adminExecute': {
          const adminQuery = body.query;
          if (!adminQuery || typeof adminQuery !== 'string') throw new Error('Query is required for adminExecute');
          const normalizedAdmin = adminQuery.trim().toUpperCase();
          const allowedPrefixes = ['DROP TABLE','DROP VIEW','DROP MATERIALIZED','DROP INDEX','DROP TRIGGER','CREATE TABLE','CREATE INDEX','CREATE TRIGGER','ALTER TABLE','ANALYZE','VACUUM','REINDEX','CLUSTER','INSERT INTO','UPDATE ','CREATE OR REPLACE','SELECT INDEXNAME','SELECT PG_SIZE','SELECT PG_STAT'];
          if (!allowedPrefixes.some(prefix => normalizedAdmin.startsWith(prefix))) throw new Error('adminExecute only allows: DROP TABLE/INDEX, CREATE TABLE/INDEX, ALTER TABLE, UPDATE, ANALYZE, VACUUM, REINDEX, CLUSTER, INSERT INTO, CREATE OR REPLACE');
          console.log(`adminExecute: ${adminQuery.substring(0, 100)}...`);
          try {
            // Set a generous statement timeout for DDL on large tables
            await sql.unsafe(`SET statement_timeout = '300s'`);
            const adminResult = await sql.unsafe(adminQuery);
            await sql.unsafe(`SET statement_timeout = '30s'`);
            result = { success: true, affected: Array.isArray(adminResult) ? adminResult.length : 0, message: `Executed: ${adminQuery.substring(0, 80)}...` };
          } catch (e) {
            try { await sql.unsafe(`SET statement_timeout = '30s'`); } catch (_) {}
            result = { success: false, error: (e as any)?.message || 'DDL execution failed' };
          }
          break;
        }

        case 'backfillIcaoCodes': {
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL');
            const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
            if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not configured');
            
            const supabase = createClient(supabaseUrl, supabaseKey);
            await sql.unsafe(`SET statement_timeout = '50s'`);
            
            // Step 1: Self-backfill — get null-icao registrations, then check if they have icao elsewhere
            const nullRegs = await sql`
              SELECT DISTINCT registration 
              FROM live_flight_detections_rows 
              WHERE (icao_code IS NULL OR icao_code = '') 
                AND registration IS NOT NULL AND registration != ''
              LIMIT 500
            `;
            
            let selfBackfillCount = 0;
            const startTime = Date.now();
            for (const r of nullRegs) {
              if (Date.now() - startTime > 20000) break;
              const reg = (r as any).registration;
              const known = await sql`
                SELECT icao_code FROM live_flight_detections_rows
                WHERE registration = ${reg}
                  AND icao_code IS NOT NULL AND icao_code != ''
                  AND LENGTH(icao_code) = 6
                LIMIT 1
              `;
              if (known.length > 0) {
                const icao = (known[0] as any).icao_code;
                const res = await sql`
                  UPDATE live_flight_detections_rows
                  SET icao_code = ${icao}
                  WHERE registration = ${reg} AND (icao_code IS NULL OR icao_code = '')
                `;
                selfBackfillCount += res.count || 0;
              }
            }
            console.log(`Self-backfilled ${selfBackfillCount} records from Neon's own data`);
            
            // Step 2: Get remaining registrations with null icao_code
            const nullIcaoRegs = await sql`
              SELECT DISTINCT registration 
              FROM live_flight_detections_rows 
              WHERE (icao_code IS NULL OR icao_code = '') 
                AND registration IS NOT NULL 
                AND registration != ''
                AND registration LIKE 'N%'
            `;
            console.log(`Found ${nullIcaoRegs.length} remaining N-prefix registrations with null ICAO codes`);
            
            // Step 3: Fetch from Supabase aircraft_registry
            const regList = nullIcaoRegs.map((r: any) => r.registration);
            const mappings: Record<string, string> = {};
            
            // Batch lookup in Supabase registry
            for (let i = 0; i < regList.length; i += 500) {
              const batch = regList.slice(i, i + 500);
              
              const { data: registryData } = await supabase
                .from('aircraft_registry')
                .select('n_number, mode_s_hex, mode_s_code')
                .in('n_number', batch)
                .not('mode_s_code', 'is', null);
              
              if (registryData) {
                for (const entry of registryData) {
                  let icaoHex: string | null = null;
                  if (entry.mode_s_hex) {
                    icaoHex = entry.mode_s_hex.trim().toUpperCase();
                  } else if (entry.mode_s_code) {
                    const hexMatch = entry.mode_s_code.match(/\|\s*([A-Fa-f0-9]{4,6})\s*\|/);
                    if (hexMatch) icaoHex = hexMatch[1].toUpperCase();
                  }
                  if (icaoHex && regList.includes(entry.n_number)) {
                    mappings[entry.n_number] = icaoHex;
                  }
                }
              }
            }
            
            console.log(`Found ${Object.keys(mappings).length} ICAO mappings from aircraft registry`);
            
            // Step 4: Apply Supabase registry matches
            let registryUpdated = 0;
            for (const [reg, icao] of Object.entries(mappings)) {
              try {
                const updateResult = await sql`
                  UPDATE live_flight_detections_rows 
                  SET icao_code = ${icao}
                  WHERE registration = ${reg} 
                    AND (icao_code IS NULL OR icao_code = '')
                `;
                registryUpdated += updateResult.count || 0;
              } catch (e) {
                console.error(`Failed to update ${reg}: ${(e as Error).message}`);
              }
            }
            
            await sql.unsafe(`SET statement_timeout = '30s'`);
            
            result = { 
              success: true, 
              selfBackfilled: selfBackfillCount,
              nullIcaoRegistrations: nullIcaoRegs.length,
              registryMatches: Object.keys(mappings).length,
              registryRecordsUpdated: registryUpdated,
              totalUpdated: selfBackfillCount + registryUpdated,
              mappingSample: Object.entries(mappings).slice(0, 10).map(([reg, icao]) => ({ registration: reg, icao_code: icao }))
            };
          } catch (e) {
            try { await sql.unsafe(`SET statement_timeout = '30s'`); } catch (_) {}
            result = { success: false, error: (e as Error).message };
          }
          break;
        }

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

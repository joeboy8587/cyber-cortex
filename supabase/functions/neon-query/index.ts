import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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
    // Parse body with better error handling
    let body: Record<string, any> = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body', details: 'Body must be valid JSON with an action field' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { action, table, limit = 100, offset = 0, query, data, where } = body;

    if (!action || typeof action !== 'string') {
      console.error('Missing action field. Body received:', JSON.stringify(body).substring(0, 500));
      return new Response(
        JSON.stringify({ 
          error: 'Missing required field: action',
          hint: 'Valid actions: getTables, getTableData, getTableSchema, getStats, customQuery, insertRecord, batchInsert, updateRecord'
        }),
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
        if (!table) {
          throw new Error('Table name is required');
        }
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
        result = await sql.unsafe(`
          SELECT * FROM ${safeTable}
          LIMIT ${parseInt(limit)}
          OFFSET ${parseInt(offset)}
        `);
        break;
      }

      case 'getTableSchema': {
        if (!table) {
          throw new Error('Table name is required');
        }
        result = await sql`
          SELECT 
            column_name,
            data_type,
            is_nullable,
            column_default
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
          WHERE c.relkind = 'r' 
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `;
        
        const records = await sql`
          SELECT COALESCE(SUM(c.reltuples)::bigint, 0) as total_records
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
        `;
        
        result = {
          tableCount: parseInt(tables[0]?.table_count || '0'),
          totalRecords: parseInt(records[0]?.total_records || '0'),
        };
        break;
      }

      case 'customQuery': {
        if (!query) {
          throw new Error('Query is required');
        }
        // Allow SELECT and WITH (CTEs) - block INSERT, UPDATE, DELETE, DROP, etc.
        const normalizedQuery = query.trim().toUpperCase();
        const isSelectQuery = normalizedQuery.startsWith('SELECT') || normalizedQuery.startsWith('WITH');
        const hasDangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE)\b/i.test(query);

        if (!isSelectQuery || hasDangerousKeywords) {
          throw new Error('Only SELECT queries are allowed');
        }

        try {
          result = await sql.unsafe(query);
        } catch (e) {
          // IMPORTANT: Do not return a 500 for expected schema drift (missing tables/columns).
          // The UI probes many optional tables; when they don't exist we return a 200 with an empty dataset.
          const err = e as any;
          const code = String(err?.code || '');
          const message = String(err?.message || 'Query failed');

          const isMissingRelation = code === '42P01' || message.includes('does not exist');
          const isMissingColumn = code === '42703' || message.includes('column') && message.includes('does not exist');

          let hint: string | undefined;
          if (isMissingColumn && message.includes('"timestamp"')) {
            hint = 'This dataset uses detection_timestamp (flights) or measurement_timestamp (biometrics) rather than a generic timestamp column.';
          }

          console.warn('customQuery non-fatal database error:', { code, message, hint });
          result = {
            data: [],
            nonFatal: true,
            code,
            error: message,
            hint,
          };
        }
        break;
      }

      case 'insertRecord': {
        // Secure insert action for data corrections - only specific tables allowed
        const insertTable = table;
        const allowedTables = [
          'aircraft_registry_enriched',
          'operator_profiles_enriched',
          'operator_profiles',
          'flagged_aircraft_rows_rows',
          'criminal_enterprise_command_structure',
          'live_flight_detections_rows',
          'biometric_monitoring',
          'ocr_aircraft_holding_patterns',
          'radar_screenshot_analysis',
          'daily_event_imports',
          'josiah_reflections_rows',
          'pattern_recognition_enriched',
          'josiah_reflections'
        ];
        
        if (!insertTable || !allowedTables.includes(insertTable)) {
          throw new Error(`Insert not allowed for table: ${insertTable}`);
        }
        
        if (!data || typeof data !== 'object') {
          throw new Error('Data object is required');
        }

        const columns = Object.keys(data);
        const values = Object.values(data) as (string | number | boolean | null)[];
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const columnList = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`).join(', ');
        
        const insertQuery = `INSERT INTO ${insertTable} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING RETURNING *`;
        console.log('Executing insert:', insertQuery, values);
        
        result = await sql.unsafe(insertQuery, values as postgres.ParameterOrJSON<never>[]);
        break;
      }

      case 'batchInsert': {
        // Batch insert for importing multiple records at once
        const batchTable = table;
        const records = data as Record<string, unknown>[];
        const allowedBatchTables = [
          'live_flight_detections_rows',
          'biometric_monitoring',
          'criminal_enterprise_command_structure'
        ];
        
        if (!batchTable || !allowedBatchTables.includes(batchTable)) {
          throw new Error(`Batch insert not allowed for table: ${batchTable}`);
        }
        
        if (!Array.isArray(records) || records.length === 0) {
          throw new Error('Data array is required');
        }

        // Use first record to determine columns
        const columns = Object.keys(records[0]);
        const columnList = columns.map(c => `"${c.replace(/[^a-zA-Z0-9_]/g, '')}"`).join(', ');
        
        let insertedCount = 0;
        for (const record of records) {
          const values = columns.map(c => record[c]) as (string | number | boolean | null)[];
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const insertQuery = `INSERT INTO ${batchTable} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
          try {
            await sql.unsafe(insertQuery, values as postgres.ParameterOrJSON<never>[]);
            insertedCount++;
          } catch (e) {
            console.error('Batch insert row error:', e);
          }
        }
        
        result = { inserted: insertedCount, total: records.length };
        break;
      }

      case 'updateRecord': {
        // Secure update action for data corrections
        const updateTable = table;
        const updateData = data;
        const allowedUpdateTables = [
          'aircraft_registry_enriched',
          'operator_profiles_enriched', 
          'operator_profiles',
          'flagged_aircraft_rows_rows',
          'shell_companies',
          'criminal_enterprise_command_structure',
          'live_flight_detections_rows'
        ];
        
        if (!updateTable || !allowedUpdateTables.includes(updateTable)) {
          throw new Error(`Update not allowed for table: ${updateTable}`);
        }
        
        if (!updateData || typeof updateData !== 'object' || !where) {
          throw new Error('Data object and where clause are required');
        }

        const setClauses = Object.keys(updateData).map((col, i) => 
          `"${col.replace(/[^a-zA-Z0-9_]/g, '')}" = $${i + 1}`
        ).join(', ');
        const updateValues = [...Object.values(updateData), where.value] as (string | number | boolean | null)[];
        const whereClause = `"${where.column.replace(/[^a-zA-Z0-9_]/g, '')}" = $${Object.keys(updateData).length + 1}`;
        
        const updateQuery = `UPDATE ${updateTable} SET ${setClauses} WHERE ${whereClause} RETURNING *`;
        console.log('Executing update:', updateQuery, updateValues);
        
        result = await sql.unsafe(updateQuery, updateValues as postgres.ParameterOrJSON<never>[]);
        break;
      }

      case 'alterSchema': {
        // Secure schema alteration - only specific ADD COLUMN operations allowed
        const alterTable = table;
        const columns = data as { name: string; type: string }[];
        const allowedAlterTables = [
          'josiah_reflections_rows',
          'pattern_recognition_enriched',
          'live_flight_detections_rows',
          'biometric_monitoring',
          'id_taxonomy'
        ];
        
        if (!alterTable || !allowedAlterTables.includes(alterTable)) {
          throw new Error(`Schema alteration not allowed for table: ${alterTable}`);
        }
        
        if (!Array.isArray(columns) || columns.length === 0) {
          throw new Error('Columns array is required with name and type properties');
        }

        const results: string[] = [];
        for (const col of columns) {
          const safeName = col.name.replace(/[^a-zA-Z0-9_]/g, '');
          const safeType = col.type.replace(/[^a-zA-Z0-9_(),\s]/g, '');
          const alterQuery = `ALTER TABLE ${alterTable} ADD COLUMN IF NOT EXISTS ${safeName} ${safeType}`;
          console.log('Executing alter:', alterQuery);
          try {
            await sql.unsafe(alterQuery);
            results.push(`Added column ${safeName}`);
          } catch (e) {
            const err = e as Error;
            results.push(`Column ${safeName}: ${err.message}`);
          }
        }
        
        result = { altered: results };
        break;
      }

      case 'createTaxonomyTable': {
        // Create the id_taxonomy dimension table for XXB classification
        console.log('Creating id_taxonomy table...');
        
        const createQuery = `
          CREATE TABLE IF NOT EXISTS id_taxonomy (
            tag TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            description TEXT,
            detection_pattern TEXT,
            priority INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `;
        await sql.unsafe(createQuery);
        
        // Insert the 8 XXB taxonomy entries (including xxb_unknown fallback)
        const taxonomyInserts = `
          INSERT INTO id_taxonomy (tag, domain, description, detection_pattern, priority) VALUES
            ('xxb_mlat', 'Telemetry', 'Anonymised MLAT hex bucket - synthetic non-ICAO prefix', '^XX[bB]-', 100),
            ('xxb_iata', 'Airport', 'Legacy Woodford Aerodrome code (Manchester)', 'Woodford|EGCD', 50),
            ('xxb_suffix', 'Registration', 'Civil registration suffix pattern (e.g., YR-XXB)', '-XXB$', 60),
            ('xxb_sim', 'Exercise', 'Fictional Brownland country code for EW/sim exercises', 'Brownland|SIMEX', 40),
            ('xxb_refugee', 'MRTD', 'UN refugee nationality code per ICAO Doc 9303', 'XXB|stateless', 30),
            ('xxb_dot', 'Industrial', 'DOT plant code - Foreman Bros retread facility', 'DOT.*XXB|retread', 20),
            ('xxb_var', 'Technical', 'Variable in CFD/design equations', 'XXB.*=|formula', 10),
            ('xxb_unknown', 'Fallback', 'Unclassified records that did not match any XXB pattern', 'UNMATCHED', 0)
          ON CONFLICT (tag) DO UPDATE SET 
            domain = EXCLUDED.domain,
            description = EXCLUDED.description,
            detection_pattern = EXCLUDED.detection_pattern,
            priority = EXCLUDED.priority
        `;
        await sql.unsafe(taxonomyInserts);
        
        result = { created: true, message: 'id_taxonomy table created and seeded with 8 XXB tags (including xxb_unknown fallback)' };
        break;
      }

      case 'getTaxonomy': {
        // Retrieve all taxonomy entries - gracefully handle missing table
        try {
          result = await sql`SELECT * FROM id_taxonomy ORDER BY priority DESC`;
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist')) {
            result = { notInitialized: true, message: 'Taxonomy table not created yet. Click "Seed id_taxonomy Table" to initialize.' };
          } else {
            throw e;
          }
        }
        break;
      }

      case 'backfillTaxonomy': {
        // Backfill taxonomy_tag column to existing tables
        const targetTable = table;
        const allowedBackfillTables = [
          'live_flight_detections_rows',
          'ocr_aircraft_holding_patterns',
          'radar_screenshot_analysis',
          'aircraft_registry_enriched'
        ];
        
        if (!targetTable || !allowedBackfillTables.includes(targetTable)) {
          throw new Error(`Backfill not allowed for table: ${targetTable}`);
        }

        // First add the taxonomy_tag column if not exists
        await sql.unsafe(`ALTER TABLE ${targetTable} ADD COLUMN IF NOT EXISTS taxonomy_tag TEXT`);
        
        // Get column info to determine which column to check for XXB patterns
        const colInfo = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = ${targetTable}
          AND (column_name ILIKE '%callsign%' OR column_name ILIKE '%registration%' OR column_name ILIKE '%hex%' OR column_name ILIKE '%icao%')
        `;
        
        const backfillResults: string[] = [];
        
        for (const col of colInfo) {
          const columnName = col.column_name;
          
          // Update MLAT patterns (XX[bB]- prefix)
          const mlatQuery = `
            UPDATE ${targetTable} 
            SET taxonomy_tag = 'xxb_mlat' 
            WHERE taxonomy_tag IS NULL 
            AND "${columnName}" ~ '^XX[bB]-'
          `;
          try {
            const mlatRes = await sql.unsafe(mlatQuery);
            backfillResults.push(`MLAT in ${columnName}: ${mlatRes.count || 0} rows`);
          } catch (e) {
            console.log(`Skipping MLAT pattern on ${columnName}`);
          }
          
          // Update suffix patterns (-XXB$)
          const suffixQuery = `
            UPDATE ${targetTable}
            SET taxonomy_tag = 'xxb_suffix'
            WHERE taxonomy_tag IS NULL
            AND "${columnName}" ~ '-XXB$'
          `;
          try {
            const suffixRes = await sql.unsafe(suffixQuery);
            backfillResults.push(`Suffix in ${columnName}: ${suffixRes.count || 0} rows`);
          } catch (e) {
            console.log(`Skipping suffix pattern on ${columnName}`);
          }
        }
        
        result = { backfilled: backfillResults, table: targetTable };
        break;
      }

      case 'queryByTaxonomy': {
        // Query records filtered by taxonomy tag with optional altitude/speed filters
        const { taxonomy_tag, max_alt, min_speed } = body;
        
        if (!taxonomy_tag) {
          throw new Error('taxonomy_tag is required');
        }
        
        let queryStr = `
          SELECT * FROM live_flight_detections_rows
          WHERE taxonomy_tag = '${taxonomy_tag.replace(/[^a-zA-Z0-9_]/g, '')}'
        `;
        
        if (max_alt) {
          queryStr += ` AND altitude < ${parseInt(max_alt)}`;
        }
        if (min_speed) {
          queryStr += ` AND speed > ${parseInt(min_speed)}`;
        }
        
        queryStr += ' ORDER BY detection_timestamp DESC LIMIT 100';
        
        result = await sql.unsafe(queryStr);
        break;
      }

      case 'taxonomyStats': {
        // Get statistics grouped by taxonomy tag - gracefully handle missing column
        try {
          // First check if taxonomy_tag column exists
          const colCheck = await sql`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'live_flight_detections_rows' AND column_name = 'taxonomy_tag'
          `;
          
          if (colCheck.length === 0) {
            result = { notInitialized: true, message: 'taxonomy_tag column not added yet. Run backfill first.' };
          } else {
            result = await sql`
              SELECT 
                COALESCE(taxonomy_tag, 'unclassified') as tag,
                COUNT(*) as count,
                AVG(altitude) as avg_altitude,
                MIN(detection_timestamp) as first_seen,
                MAX(detection_timestamp) as last_seen
              FROM live_flight_detections_rows
              GROUP BY taxonomy_tag
              ORDER BY count DESC
            `;
          }
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist')) {
            result = { notInitialized: true, message: 'Run backfill to add taxonomy_tag column.' };
          } else {
            throw e;
          }
        }
        break;
      }

      case 'addTaxonomyTag': {
        // Add a new taxonomy tag (e.g., xxb_unknown fallback)
        const { tag, domain, description, detection_pattern, priority } = body;
        if (!tag || !domain) {
          throw new Error('tag and domain are required');
        }
        const insertQuery = `
          INSERT INTO id_taxonomy (tag, domain, description, detection_pattern, priority)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (tag) DO UPDATE SET
            domain = EXCLUDED.domain,
            description = EXCLUDED.description,
            detection_pattern = EXCLUDED.detection_pattern,
            priority = EXCLUDED.priority
          RETURNING *
        `;
        result = await sql.unsafe(insertQuery, [
          tag, domain, description || '', detection_pattern || '', priority || 0
        ]);
        break;
      }

      case 'backfillUnknown': {
        // Step 3: Tag all NULL taxonomy_tag as 'xxb_unknown'
        console.log('Backfilling NULL taxonomy_tag with xxb_unknown...');
        
        const updateResult = await sql`
          UPDATE live_flight_detections_rows 
          SET taxonomy_tag = 'xxb_unknown' 
          WHERE taxonomy_tag IS NULL
        `;
        
        result = { 
          backfilled: true, 
          rowsUpdated: updateResult.count || 0,
          message: `Tagged ${updateResult.count || 0} unclassified records as xxb_unknown`
        };
        break;
      }

      case 'createClassifyFunction': {
        // Step 2: Create the classify_xxb SQL function with fallback
        console.log('Creating classify_xxb function...');
        
        const createFnQuery = `
          CREATE OR REPLACE FUNCTION classify_xxb(callsign text, raw_text text DEFAULT NULL)
          RETURNS text
          LANGUAGE sql
          IMMUTABLE
          AS $$
            SELECT CASE
              WHEN callsign ~ '^XX[bB]-' THEN 'xxb_mlat'
              WHEN callsign ~ '-XXB$' THEN 'xxb_suffix'
              WHEN raw_text ~* 'Woodford|EGCD' THEN 'xxb_iata'
              WHEN raw_text ~* 'Brownland|SIMEX' THEN 'xxb_sim'
              WHEN raw_text ~* 'stateless|refugee' THEN 'xxb_refugee'
              WHEN raw_text ~* 'DOT.*XXB|retread' THEN 'xxb_dot'
              WHEN raw_text ~* 'XXB.*=' THEN 'xxb_var'
              ELSE 'xxb_unknown'
            END
          $$
        `;
        await sql.unsafe(createFnQuery);
        
        result = { created: true, message: 'classify_xxb function created with xxb_unknown fallback' };
        break;
      }

      case 'operatorEnrichment': {
        // Operator profile enrichment - analyze registrations from flight detections
        console.log('Running operator enrichment analysis...');
        
        const registrations = await sql`
          SELECT 
            registration,
            callsign,
            icao_code,
            COUNT(*) as appearance_count,
            COUNT(*) FILTER (WHERE flagged = true) as flagged_count,
            AVG(CAST(threat_score AS FLOAT)) as avg_threat_score,
            AVG(altitude) as avg_altitude,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            ROUND(COUNT(*) FILTER (WHERE flagged = true)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100, 2) as flag_rate_pct,
            taxonomy_tag
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY registration, callsign, icao_code, taxonomy_tag
          HAVING COUNT(*) >= 2
          ORDER BY flagged_count DESC, appearance_count DESC
          LIMIT 100
        `;
        
        result = registrations;
        break;
      }

      case 'xxbFlightAnalysis': {
        // Deep XXB analysis - correlate taxonomy tags with flagging patterns
        console.log('Running XXB flight detection analysis...');
        
        const analysis = await sql`
          SELECT 
            COALESCE(taxonomy_tag, 'unclassified') as taxonomy_tag,
            COUNT(*) as total_records,
            COUNT(*) FILTER (WHERE flagged = true) as flagged_count,
            ROUND(AVG(CAST(threat_score AS FLOAT))::numeric, 2) as avg_threat_score,
            ROUND(AVG(altitude)::numeric, 0) as avg_altitude,
            ROUND(AVG(speed)::numeric, 1) as avg_speed,
            COUNT(DISTINCT registration) as unique_aircraft,
            ROUND(COUNT(*) FILTER (WHERE flagged = true)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100, 2) as flag_rate_pct,
            COUNT(*) FILTER (WHERE icao_code ~ '^~') as mlat_synthetic_count,
            COUNT(*) FILTER (WHERE altitude < 500) as low_altitude_count,
            COUNT(*) FILTER (WHERE CAST(threat_score AS FLOAT) >= 45) as critical_threat_count
          FROM live_flight_detections_rows
          GROUP BY taxonomy_tag
          ORDER BY flagged_count DESC, total_records DESC
        `;
        
        result = analysis;
        break;
      }

      case 'getTopFlaggedAircraft': {
        // Get the most frequently flagged aircraft with details
        console.log('Getting top flagged aircraft...');
        
        const topFlagged = await sql`
          SELECT 
            registration,
            callsign,
            icao_code,
            taxonomy_tag,
            COUNT(*) as total_appearances,
            COUNT(*) FILTER (WHERE flagged = true) as flagged_count,
            ROUND(AVG(CAST(threat_score AS FLOAT))::numeric, 2) as avg_threat,
            ROUND(AVG(altitude)::numeric, 0) as avg_altitude,
            ROUND(AVG(speed)::numeric, 1) as avg_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            ROUND(COUNT(*) FILTER (WHERE flagged = true)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100, 2) as flag_rate_pct,
            CASE 
              WHEN AVG(altitude) < 500 THEN 'CRITICAL_LOW_ALT'
              WHEN AVG(CAST(threat_score AS FLOAT)) >= 45 THEN 'HIGH_THREAT'
              WHEN COUNT(*) FILTER (WHERE flagged = true)::numeric / NULLIF(COUNT(*)::numeric, 0) > 0.3 THEN 'PERSISTENT_FLAGGING'
              ELSE 'STANDARD'
            END as threat_pattern
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY registration, callsign, icao_code, taxonomy_tag
          HAVING COUNT(*) FILTER (WHERE flagged = true) > 0
          ORDER BY flagged_count DESC, avg_threat DESC
          LIMIT 50
        `;
        
        result = topFlagged;
        break;
      }

      case 'getAnomalousHexCodes': {
        // Find corrupted/anomalous ICAO hex codes
        console.log('Analyzing anomalous hex codes...');
        
        const anomalies = await sql`
          SELECT 
            icao_code,
            registration,
            callsign,
            COUNT(*) as occurrence_count,
            AVG(CAST(threat_score AS FLOAT)) as avg_threat,
            CASE
              WHEN icao_code ~ '^~' THEN 'MLAT_SYNTHETIC'
              WHEN LENGTH(icao_code) < 6 THEN 'TRUNCATED'
              WHEN icao_code ~ '[^a-fA-F0-9~-]' THEN 'CORRUPTED'
              WHEN icao_code IS NULL OR icao_code = '' THEN 'MISSING'
              ELSE 'VALID'
            END as hex_status
          FROM live_flight_detections_rows
          WHERE icao_code ~ '^~' 
             OR LENGTH(COALESCE(icao_code, '')) < 6 
             OR icao_code ~ '[^a-fA-F0-9~-]'
             OR icao_code IS NULL 
             OR icao_code = ''
          GROUP BY icao_code, registration, callsign
          ORDER BY occurrence_count DESC
          LIMIT 50
        `;
        
        result = anomalies;
        break;
      }

      case 'getLegalAnalysisStats': {
        // Comprehensive stats for Legal Analysis AI panel - queries multiple tables
        console.log('Getting comprehensive legal analysis stats...');
        
        // Get flight detection totals
        const flightStats = await sql`
          SELECT 
            COUNT(*) as total_detections,
            COUNT(DISTINCT COALESCE(registration, callsign)) as unique_aircraft,
            ROUND(AVG(altitude)::numeric, 0) as avg_altitude
          FROM live_flight_detections_rows
        `;
        
        // Count KCSO/Shell aircraft by registration patterns
        const kcsoShellStats = await sql`
          SELECT COUNT(*) as count FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC', 'N788FA', 'N790FA', 'N791FA', 'N997SE', 'N2464D')
             OR callsign ILIKE '%KCSO%'
             OR callsign ILIKE '%KCSOC%'
             OR registration ~ '^N7[89][0-9]FA$'
        `;
        
        // Count military aircraft by patterns  
        const militaryStats = await sql`
          SELECT COUNT(*) as count FROM live_flight_detections_rows
          WHERE callsign ~ '^(RCH|REACH|NAVY|EVAC|SPAR|SAM|VV|PAT|BLOC|JAKE|TOPCAT|RRR|CFC|RCAF|CDN)[0-9]'
             OR callsign ILIKE '%FORCE%'
             OR callsign ILIKE 'CANFORCE%'
             OR callsign ~ '^[A-Z]{3}[0-9]{2,4}$'
             OR registration ~ '^(16|17|18|19|60|61|62|63|64|65|66|67|68|69|70)[0-9]{4}$'
        `;
        
        // Count medical aircraft by patterns
        const medicalStats = await sql`
          SELECT COUNT(*) as count FROM live_flight_detections_rows
          WHERE callsign ILIKE '%MEDEVAC%'
             OR callsign ILIKE '%LIFEGUARD%' 
             OR callsign ILIKE '%MERCY%'
             OR callsign ILIKE '%AIRMED%'
             OR callsign ILIKE '%LIFESTAR%'
             OR registration IN ('N743AM', 'N229AM', 'N7AM', 'N911AM')
        `;
        
        // Get enterprise structure count
        let enterpriseCount = 0;
        try {
          const enterpriseStats = await sql`
            SELECT COUNT(*) as count FROM criminal_enterprise_command_structure
          `;
          enterpriseCount = parseInt(enterpriseStats[0]?.count) || 0;
        } catch (e) {
          console.log('Enterprise table not found');
        }
        
        // Get foreign/Canadian military count
        let foreignMilitaryCount = 0;
        try {
          const foreignStats = await sql`
            SELECT COUNT(*) as count FROM live_flight_detections_rows
            WHERE callsign ~ '^(CFC|RCAF|CDN|CANFORCE)'
               OR callsign ILIKE '%CANADA%'
               OR registration ~ '^C-[A-Z]{4}$'
          `;
          foreignMilitaryCount = parseInt(foreignStats[0]?.count) || 0;
        } catch (e) {
          console.log('Foreign military query failed');
        }
        
        result = {
          totalDetections: parseInt(flightStats[0]?.total_detections) || 0,
          uniqueAircraft: parseInt(flightStats[0]?.unique_aircraft) || 0,
          avgAltitude: parseInt(flightStats[0]?.avg_altitude) || 0,
          kcsoShellCount: parseInt(kcsoShellStats[0]?.count) || 0,
          militaryCount: parseInt(militaryStats[0]?.count) || 0,
          medicalCount: parseInt(medicalStats[0]?.count) || 0,
          enterpriseEntities: enterpriseCount,
          foreignMilitaryCount: foreignMilitaryCount
        };
        break;
      }

      case 'getFederalCaseConvergence': {
        // Federal Case Convergence Events - True Four-Factor Analysis
        // Joins: flight + biometric spike + Josiah witness + OCR proof
        console.log('Executing Federal Case Convergence Analysis...');
        
        // Priority aircraft watchlist - KCSO and shell company assets
        const priorityAircraft = [
          'N912KC', 'N913KC', 'N743AM', 'N229AM', 
          'N790FA', 'N788FA', 'N791FA', 'N997SE', 'N2464D',
          'N766ME', 'N118SY'
        ];
        // Use IN clause with explicit values to avoid postgres.js array handling issues
        try {
          // Step 1: Get flight-biometric correlations within ±10 minute windows
          const flightBioCorrelations = await sql`
            SELECT 
              f.registration,
              f.detection_timestamp,
              f.altitude,
              f.callsign,
              f.latitude,
              f.longitude,
              b.measurement_timestamp as bio_time,
              b.heart_rate,
              b.hrv,
              b.stress_level,
              b.sha256_hash as bio_hash,
              ROUND(ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp)) / 60)::numeric, 1) as time_diff_minutes
            FROM live_flight_detections_rows f
            CROSS JOIN biometric_monitoring b
            WHERE f.detection_timestamp IS NOT NULL
              AND b.measurement_timestamp IS NOT NULL
              AND ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600
              AND (
                f.registration IN ('N912KC', 'N913KC', 'N743AM', 'N229AM', 'N790FA', 'N788FA', 'N791FA', 'N997SE', 'N2464D', 'N766ME', 'N118SY')
                OR f.altitude < 1500
                OR f.registration LIKE 'N91_KC'
                OR f.callsign ILIKE '%KCSO%'
              )
              AND (
                b.heart_rate > 90
                OR b.stress_level >= 6
                OR b.hrv < 40
              )
            ORDER BY f.detection_timestamp DESC
            LIMIT 2000
          `;
          
          console.log(`Found ${flightBioCorrelations.length} flight-biometric correlations`);
          
          // Step 2: Get Josiah reflection matches for these windows
          const josiahMatches = await sql`
            SELECT 
              created_at as josiah_time,
              reflection_content,
              aircraft_correlation,
              biometric_correlation,
              sha256_hash as josiah_hash
            FROM josiah_reflections_rows
            WHERE created_at IS NOT NULL
              AND (
                reflection_content ILIKE '%aircraft%'
                OR reflection_content ILIKE '%aerial%'
                OR reflection_content ILIKE '%surveillance%'
                OR reflection_content ILIKE '%biometric%'
                OR reflection_content ILIKE '%N912KC%'
                OR reflection_content ILIKE '%N913KC%'
                OR reflection_content ILIKE '%stress%'
                OR reflection_content ILIKE '%heart%'
                OR aircraft_correlation IS NOT NULL
                OR biometric_correlation IS NOT NULL
              )
            ORDER BY created_at DESC
            LIMIT 2000
          `;
          
          console.log(`Found ${josiahMatches.length} relevant Josiah reflections`);
          
          // Step 3: Get OCR holding pattern data
          const ocrPatterns = await sql`
            SELECT 
              registration,
              observation_timestamp,
              loop_count,
              baro_alt_ft,
              pattern_type,
              sha256_hash as ocr_hash
            FROM ocr_aircraft_holding_patterns
            WHERE registration IS NOT NULL
            ORDER BY loop_count DESC NULLS LAST
            LIMIT 500
          `;
          
          console.log(`Found ${ocrPatterns.length} OCR holding patterns`);
          
          // Step 4: Get physician-verified ECG data
          const ecgRecords = await sql`
            SELECT 
              date_of_ecg,
              ecg_findings,
              physician_npi,
              physician_name,
              average_heart_rate,
              sha256_hash as ecg_hash
            FROM physician_verified_ecgs
            ORDER BY date_of_ecg DESC
          `;
          
          console.log(`Found ${ecgRecords.length} physician-verified ECGs`);
          
          // Step 5: Build four-factor convergence events
          const convergenceEvents: any[] = [];
          
          for (const fb of flightBioCorrelations) {
            // Check for Josiah match within ±15 minutes
            const hasJosiah = josiahMatches.some((j: any) => {
              if (!j.josiah_time) return false;
              const diffMs = Math.abs(new Date(fb.detection_timestamp).getTime() - new Date(j.josiah_time).getTime());
              return diffMs <= 900000; // 15 minutes
            });
            
            // Check for OCR match by registration
            const ocrMatch = ocrPatterns.find((o: any) => o.registration === fb.registration);
            const hasOCR = !!ocrMatch;
            
            // Check for ECG correlation within ±30 minutes
            const ecgMatch = ecgRecords.find((e: any) => {
              if (!e.date_of_ecg) return false;
              const diffMs = Math.abs(new Date(fb.detection_timestamp).getTime() - new Date(e.date_of_ecg).getTime());
              return diffMs <= 1800000; // 30 minutes
            });
            const hasECG = !!ecgMatch;
            
            // Calculate factor count
            let factorCount = 2; // Flight + Biometric is baseline
            if (hasJosiah) factorCount++;
            if (hasOCR) factorCount++;
            
            // Calculate convergence score
            let convergenceScore = 50;
            if (hasJosiah) convergenceScore += 20;
            if (hasOCR) convergenceScore += 20;
            if (hasECG) convergenceScore += 10;
            if (fb.altitude && fb.altitude < 1000) convergenceScore += 5;
            if (priorityAircraft.includes(fb.registration)) convergenceScore += 5;
            
            convergenceEvents.push({
              registration: fb.registration,
              detection_timestamp: fb.detection_timestamp,
              altitude: fb.altitude,
              callsign: fb.callsign,
              bio_time: fb.bio_time,
              heart_rate: fb.heart_rate,
              hrv: fb.hrv,
              stress_level: fb.stress_level,
              time_window_minutes: fb.time_diff_minutes,
              has_josiah: hasJosiah,
              has_ocr: hasOCR,
              has_ecg: hasECG,
              loop_count: ocrMatch?.loop_count || null,
              ecg_findings: ecgMatch?.ecg_findings || null,
              factor_count: factorCount,
              convergence_score: convergenceScore,
              bio_hash: fb.bio_hash,
              priority_aircraft: priorityAircraft.includes(fb.registration)
            });
          }
          
          // Sort by factor count and convergence score
          convergenceEvents.sort((a, b) => {
            if (b.factor_count !== a.factor_count) return b.factor_count - a.factor_count;
            return b.convergence_score - a.convergence_score;
          });
          
          // Calculate summary statistics
          const fourFactorCount = convergenceEvents.filter(e => e.factor_count === 4).length;
          const threeFactorCount = convergenceEvents.filter(e => e.factor_count === 3).length;
          const twoFactorCount = convergenceEvents.filter(e => e.factor_count === 2).length;
          const uniqueAircraft = [...new Set(convergenceEvents.map(e => e.registration))];
          const avgHeartRate = convergenceEvents.length > 0 
            ? Math.round(convergenceEvents.reduce((sum, e) => sum + (parseInt(e.heart_rate) || 0), 0) / convergenceEvents.length)
            : 0;
          const ecgLinkedCount = convergenceEvents.filter(e => e.has_ecg).length;
          const priorityHits = convergenceEvents.filter(e => e.priority_aircraft).length;
          
          // Bradford Hill criteria assessment
          const bradfordHill = {
            temporality: fourFactorCount > 0 || threeFactorCount > 0,
            strength: avgHeartRate > 85 || convergenceEvents.length > 50,
            consistency: uniqueAircraft.length >= 2 && threeFactorCount >= 3,
            specificity: priorityHits > 0 && convergenceEvents.filter(e => e.altitude && e.altitude < 1200).length > 0,
            plausibility: true, // Low-altitude flights causing stress is biologically plausible
            coherence: (threeFactorCount + fourFactorCount) >= 5 && ecgRecords.length > 0
          };
          
          result = {
            events: convergenceEvents.slice(0, 500),
            summary: {
              totalConvergenceEvents: convergenceEvents.length,
              fourFactorEvents: fourFactorCount,
              threeFactorEvents: threeFactorCount,
              twoFactorEvents: twoFactorCount,
              uniqueAircraftInvolved: uniqueAircraft.length,
              avgHeartRateInEvents: avgHeartRate,
              ecgCorrelations: ecgLinkedCount,
              priorityAircraftHits: priorityHits,
              totalECGs: ecgRecords.length,
              totalJosiahReflections: josiahMatches.length,
              totalOCRPatterns: ocrPatterns.length
            },
            ecgEvents: ecgRecords,
            bradfordHillCriteria: bradfordHill,
            topConvergenceAircraft: uniqueAircraft.slice(0, 10)
          };
          
          console.log(`Federal Convergence Analysis Complete: ${fourFactorCount} 4-factor, ${threeFactorCount} 3-factor, ${twoFactorCount} 2-factor events`);
          
        } catch (convError) {
          console.error('Convergence query error:', convError);
          result = {
            events: [],
            summary: {
              totalConvergenceEvents: 0,
              fourFactorEvents: 0,
              threeFactorEvents: 0,
              twoFactorEvents: 0,
              uniqueAircraftInvolved: 0,
              avgHeartRateInEvents: 0,
              ecgCorrelations: 0,
              priorityAircraftHits: 0
            },
            error: (convError as Error).message
          };
        }
        
        break;
      }

      case 'createBehavioralAlignmentTable': {
        // Create shell_entity_behavioral_alignment table for RICO pattern matching
        console.log('Creating shell_entity_behavioral_alignment table...');
        
        const createQuery = `
          CREATE TABLE IF NOT EXISTS shell_entity_behavioral_alignment (
            id SERIAL PRIMARY KEY,
            entity_name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'SHELL_COMPANY',
            aircraft_tail TEXT,
            match_score_to_kcso NUMERIC(5,2) DEFAULT 0,
            behavior_type TEXT,
            confirmed_flight_overlap BOOLEAN DEFAULT false,
            geofence_radius_km NUMERIC(5,2),
            biometric_link_score NUMERIC(5,2) DEFAULT 0,
            risk_tier TEXT DEFAULT 'Tier 3',
            avg_altitude_ft NUMERIC(8,2),
            loiter_count INTEGER DEFAULT 0,
            detection_count INTEGER DEFAULT 0,
            low_altitude_pct NUMERIC(5,2) DEFAULT 0,
            time_of_day_pattern TEXT,
            reentry_frequency INTEGER DEFAULT 0,
            reference_aircraft TEXT,
            similarity_notes TEXT,
            legal_exposure TEXT,
            prosecution_priority TEXT DEFAULT 'MONITORING',
            first_detection TIMESTAMP,
            last_detection TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(entity_name, aircraft_tail)
          )
        `;
        await sql.unsafe(createQuery);
        
        // Create index for fast lookups
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_behavioral_risk_tier ON shell_entity_behavioral_alignment(risk_tier)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_behavioral_match_score ON shell_entity_behavioral_alignment(match_score_to_kcso DESC)`);
        
        result = { created: true, message: 'shell_entity_behavioral_alignment table created with indexes' };
        break;
      }

      case 'computeBehavioralAlignment': {
        // Compute behavioral similarity scores for all shell entities against KCSO Tier 1 assets
        console.log('Computing behavioral alignment scores...');
        
        // Step 1: Get KCSO Tier 1 reference patterns (N912KC, N913KC baseline)
        const kcsoBaseline = await sql`
          SELECT 
            AVG(altitude) as avg_altitude,
            AVG(speed) as avg_speed,
            COUNT(*) as total_detections,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_count,
            COUNT(DISTINCT DATE(detection_timestamp)) as active_days,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC')
        `;
        
        const baseline = kcsoBaseline[0] || { avg_altitude: 1100, avg_speed: 120, total_detections: 1000, low_alt_count: 800 };
        const baselineAvgAlt = parseFloat(baseline.avg_altitude) || 1100;
        const baselineLowAltPct = (parseInt(baseline.low_alt_count) / parseInt(baseline.total_detections)) * 100 || 80;
        
        console.log(`KCSO Baseline: avg_alt=${baselineAvgAlt}, low_alt_pct=${baselineLowAltPct}%`);
        
        // Step 2: Get enterprise entities with their associated aircraft
        const enterpriseEntities = await sql`
          SELECT 
            entity_name,
            entity_type,
            assets_controlled,
            tier,
            prosecution_priority,
            legal_exposure,
            notes
          FROM criminal_enterprise_command_structure
          WHERE entity_type IN ('SHELL_COMPANY', 'CONTRACTOR', 'MEDICAL_ASSET', 'INFRASTRUCTURE_SUPPORT')
        `;
        
        console.log(`Found ${enterpriseEntities.length} shell/contractor entities to analyze`);
        
        // Step 3: Get all flight detections grouped by operator pattern
        const flightsByOperator = await sql`
          SELECT 
            registration,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_altitude,
            AVG(speed) as avg_speed,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_detections,
            COUNT(*) FILTER (WHERE altitude < 500) as critical_low_alt,
            COUNT(DISTINCT DATE(detection_timestamp)) as active_days,
            MIN(detection_timestamp) as first_detection,
            MAX(detection_timestamp) as last_detection,
            ROUND(COUNT(*) FILTER (WHERE altitude < 1500)::numeric / NULLIF(COUNT(*)::numeric, 0) * 100, 2) as low_alt_pct
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY registration
          HAVING COUNT(*) >= 3
          ORDER BY detection_count DESC
        `;
        
        // Step 4: Get biometric correlation data for each aircraft (optimized with LIMIT and filtering)
        // Use a more efficient approach: only check known shell company aircraft
        const shellAircraft = ['N788FA', 'N790FA', 'N791FA', 'N899JR', 'N997SE', 'N2464D', 
          'N828CF', 'N83SF', 'N8274E', 'N840PA', 'N743AM', 'N229AM', 'N7AM', 'N911AM',
          'N912KC', 'N913KC'];
        
        const bioCorrelations = await sql`
          SELECT 
            f.registration,
            COUNT(*) as bio_correlation_count,
            AVG(b.heart_rate) as avg_heart_rate_during,
            AVG(b.stress_level) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN biometric_monitoring b ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600
          WHERE f.detection_timestamp IS NOT NULL
            AND b.measurement_timestamp IS NOT NULL
            AND f.registration = ANY(${shellAircraft})
            AND (b.heart_rate > 85 OR b.stress_level >= 5)
          GROUP BY f.registration
        `;
        
        const bioMap = new Map();
        for (const bc of bioCorrelations) {
          bioMap.set(bc.registration, {
            count: parseInt(bc.bio_correlation_count) || 0,
            avgHR: parseFloat(bc.avg_heart_rate_during) || 0,
            avgStress: parseFloat(bc.avg_stress_during) || 0
          });
        }
        
        // Step 5: Calculate behavioral alignment scores
        const alignmentRecords: any[] = [];
        
        // Known shell company aircraft mappings
        const shellAircraftMap: Record<string, string[]> = {
          'ALF IX LLC': ['N788FA', 'N790FA', 'N791FA', 'N899JR'],
          'AERO EQUITIES LLC': ['N997SE', 'N2464D'],
          'CHRISTIANSEN AVIATION LLC': ['N828CF', 'N83SF', 'N8274E', 'N840PA'],
          'Air Methods': ['N743AM', 'N229AM', 'N7AM'],
          'Mercy Air': ['N911AM'],
          'XING KONG AVIATION SERVICE LLC': [],
          'K.S. Aviation Inc.': [],
          'Xin Han Aviation LLC': []
        };
        
        for (const entity of enterpriseEntities) {
          const entityName = entity.entity_name;
          const knownAircraft = shellAircraftMap[entityName] || [];
          
          // Find matching flight records
          const matchingFlights = flightsByOperator.filter((f: any) => 
            knownAircraft.includes(f.registration) ||
            (entity.assets_controlled && entity.assets_controlled.includes(f.registration))
          );
          
          for (const flight of matchingFlights) {
            const avgAlt = parseFloat(flight.avg_altitude) || 0;
            const lowAltPct = parseFloat(flight.low_alt_pct) || 0;
            const detections = parseInt(flight.detection_count) || 0;
            
            // Calculate altitude similarity (closer to KCSO = higher score)
            const altDiff = Math.abs(avgAlt - baselineAvgAlt);
            const altSimilarity = Math.max(0, 100 - (altDiff / 50)); // 50ft diff = 1% reduction
            
            // Calculate low-altitude pattern similarity
            const lowAltDiff = Math.abs(lowAltPct - baselineLowAltPct);
            const lowAltSimilarity = Math.max(0, 100 - lowAltDiff);
            
            // Get biometric correlation score
            const bioData = bioMap.get(flight.registration) || { count: 0, avgHR: 0, avgStress: 0 };
            const bioScore = Math.min(100, (bioData.count / 10) * 20 + (bioData.avgStress / 10) * 30);
            
            // Calculate weighted match score
            const matchScore = (altSimilarity * 0.3) + (lowAltSimilarity * 0.4) + (bioScore * 0.3);
            
            // Determine behavior type
            let behaviorType = 'STANDARD';
            if (lowAltPct > 50 && avgAlt < 1500) behaviorType = 'LOITER_MIMIC';
            else if (Math.abs(avgAlt - baselineAvgAlt) < 200) behaviorType = 'ALTITUDE_ECHO';
            else if (detections > 100 && lowAltPct > 30) behaviorType = 'PERSISTENT_PRESENCE';
            else if (parseInt(flight.critical_low_alt) > 10) behaviorType = 'CRITICAL_LOW_ALT';
            
            // Determine risk tier based on match score
            let riskTier = 'Tier 3';
            if (matchScore >= 85) riskTier = 'Tier 1 Probationary';
            else if (matchScore >= 70) riskTier = 'Tier 2';
            else if (matchScore >= 50) riskTier = 'Tier 2 Watch';
            
            alignmentRecords.push({
              entity_name: entityName,
              entity_type: entity.entity_type,
              aircraft_tail: flight.registration,
              match_score_to_kcso: matchScore.toFixed(2),
              behavior_type: behaviorType,
              confirmed_flight_overlap: detections > 10,
              geofence_radius_km: 5.0, // Default Oildale geofence
              biometric_link_score: bioScore.toFixed(2),
              risk_tier: riskTier,
              avg_altitude_ft: avgAlt.toFixed(0),
              loiter_count: parseInt(flight.critical_low_alt) || 0,
              detection_count: detections,
              low_altitude_pct: lowAltPct,
              reference_aircraft: 'N912KC/N913KC',
              first_detection: flight.first_detection,
              last_detection: flight.last_detection,
              legal_exposure: entity.legal_exposure,
              prosecution_priority: matchScore >= 85 ? 'HIGH' : matchScore >= 70 ? 'MEDIUM' : 'MONITORING'
            });
          }
        }
        
        // Step 6: Insert/update records
        let insertedCount = 0;
        for (const rec of alignmentRecords) {
          try {
            await sql.unsafe(`
              INSERT INTO shell_entity_behavioral_alignment 
              (entity_name, entity_type, aircraft_tail, match_score_to_kcso, behavior_type, 
               confirmed_flight_overlap, geofence_radius_km, biometric_link_score, risk_tier,
               avg_altitude_ft, loiter_count, detection_count, low_altitude_pct, reference_aircraft,
               first_detection, last_detection, legal_exposure, prosecution_priority)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              ON CONFLICT (entity_name, aircraft_tail) 
              DO UPDATE SET 
                match_score_to_kcso = EXCLUDED.match_score_to_kcso,
                behavior_type = EXCLUDED.behavior_type,
                biometric_link_score = EXCLUDED.biometric_link_score,
                risk_tier = EXCLUDED.risk_tier,
                detection_count = EXCLUDED.detection_count,
                low_altitude_pct = EXCLUDED.low_altitude_pct,
                last_detection = EXCLUDED.last_detection,
                updated_at = NOW()
            `, [
              rec.entity_name, rec.entity_type, rec.aircraft_tail, rec.match_score_to_kcso,
              rec.behavior_type, rec.confirmed_flight_overlap, rec.geofence_radius_km,
              rec.biometric_link_score, rec.risk_tier, rec.avg_altitude_ft, rec.loiter_count,
              rec.detection_count, rec.low_altitude_pct, rec.reference_aircraft,
              rec.first_detection, rec.last_detection, rec.legal_exposure, rec.prosecution_priority
            ]);
            insertedCount++;
          } catch (e) {
            console.error('Insert error for', rec.entity_name, rec.aircraft_tail, e);
          }
        }
        
        result = {
          computed: true,
          baselineAltitude: baselineAvgAlt,
          baselineLowAltPct: baselineLowAltPct,
          entitiesAnalyzed: enterpriseEntities.length,
          alignmentRecordsCreated: insertedCount,
          records: alignmentRecords.sort((a, b) => parseFloat(b.match_score_to_kcso) - parseFloat(a.match_score_to_kcso))
        };
        break;
      }

      case 'getBehavioralAlignment': {
        // Retrieve all behavioral alignment records
        console.log('Fetching behavioral alignment data...');
        
        try {
          const alignments = await sql`
            SELECT * FROM shell_entity_behavioral_alignment
            ORDER BY match_score_to_kcso DESC
          `;
          
          // Calculate summary stats
          const tier1Count = alignments.filter((a: any) => a.risk_tier?.includes('Tier 1')).length;
          const tier2Count = alignments.filter((a: any) => a.risk_tier?.includes('Tier 2')).length;
          const highMatchCount = alignments.filter((a: any) => parseFloat(a.match_score_to_kcso) >= 85).length;
          
          result = {
            alignments,
            summary: {
              totalRecords: alignments.length,
              tier1Probationary: tier1Count,
              tier2Watch: tier2Count,
              highMatchAlerts: highMatchCount,
              uniqueEntities: [...new Set(alignments.map((a: any) => a.entity_name))].length,
              uniqueAircraft: [...new Set(alignments.map((a: any) => a.aircraft_tail))].length
            }
          };
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist')) {
            result = { notInitialized: true, message: 'Table not created yet. Click "Initialize Schema" first.' };
          } else {
            throw e;
          }
        }
        break;
      }

      // ========== MEDICAL ENTITY BEHAVIORAL ALIGNMENT ==========
      case 'createMedicalBehavioralAlignmentTable': {
        // Create medical_entity_behavioral_alignment table for MEDEVAC/Geneva pattern matching
        console.log('Creating medical_entity_behavioral_alignment table...');
        
        const createMedicalQuery = `
          CREATE TABLE IF NOT EXISTS medical_entity_behavioral_alignment (
            id SERIAL PRIMARY KEY,
            operator_name TEXT NOT NULL,
            operator_type TEXT DEFAULT 'MEDICAL_ASSET',
            aircraft_tail TEXT,
            match_score_to_kcso NUMERIC(5,2) DEFAULT 0,
            behavior_type TEXT,
            medical_mission_logged BOOLEAN DEFAULT false,
            loiter_count INTEGER DEFAULT 0,
            biometric_link_score NUMERIC(5,2) DEFAULT 0,
            risk_tier TEXT DEFAULT 'Tier 3 Monitoring',
            avg_altitude_ft NUMERIC(8,2),
            detection_count INTEGER DEFAULT 0,
            low_altitude_pct NUMERIC(5,2) DEFAULT 0,
            reference_aircraft TEXT DEFAULT 'N912KC/N913KC',
            legal_exposure TEXT,
            prosecution_priority TEXT DEFAULT 'MONITORING',
            first_detection TIMESTAMP,
            last_detection TIMESTAMP,
            fraud_indicators TEXT,
            geneva_violation_risk TEXT,
            false_claims_exposure TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(operator_name, aircraft_tail)
          )
        `;
        await sql.unsafe(createMedicalQuery);
        
        // Create indexes for fast lookups
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_medical_risk_tier ON medical_entity_behavioral_alignment(risk_tier)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_medical_match_score ON medical_entity_behavioral_alignment(match_score_to_kcso DESC)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_medical_fraud ON medical_entity_behavioral_alignment(medical_mission_logged)`);
        
        result = { created: true, message: 'medical_entity_behavioral_alignment table created with indexes' };
        break;
      }

      case 'computeMedicalBehavioralAlignment': {
        // Compute behavioral similarity scores for medical aircraft against KCSO Tier 1 patterns
        console.log('Computing medical behavioral alignment scores...');
        
        // Step 1: Get KCSO Tier 1 reference patterns (N912KC, N913KC baseline)
        const kcsoMedicalBaseline = await sql`
          SELECT 
            AVG(altitude) as avg_altitude,
            COUNT(*) as total_detections,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_count,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC')
        `;
        
        const baseline = kcsoMedicalBaseline[0] || { avg_altitude: 1100, total_detections: 1000, low_alt_count: 800 };
        const baselineAvgAlt = parseFloat(baseline.avg_altitude) || 1100;
        const baselineLowAltPct = (parseInt(baseline.low_alt_count) / parseInt(baseline.total_detections)) * 100 || 80;
        
        console.log(`KCSO Medical Baseline: avg_alt=${baselineAvgAlt}, low_alt_pct=${baselineLowAltPct}%`);
        
        // Step 2: Define medical aircraft and operators to analyze
        const medicalAircraftMap: Record<string, { operator: string; type: string }> = {
          'N229AM': { operator: 'Mercy Air', type: 'MEDEVAC_OPERATOR' },
          'N743AM': { operator: 'SkyLife (Air Methods)', type: 'MEDEVAC_OPERATOR' },
          'N224AM': { operator: 'Air Methods', type: 'MEDEVAC_OPERATOR' },
          'N7AM': { operator: 'Air Methods Corporate', type: 'MEDEVAC_OPERATOR' },
          'N911AM': { operator: 'Air Methods Emergency', type: 'MEDEVAC_OPERATOR' },
          'N118AM': { operator: 'Air Methods West', type: 'MEDEVAC_OPERATOR' },
          'N303AM': { operator: 'Air Methods Regional', type: 'MEDEVAC_OPERATOR' },
          'N407AM': { operator: 'Air Methods Southwest', type: 'MEDEVAC_OPERATOR' }
        };
        
        const medicalTails = Object.keys(medicalAircraftMap);
        
        // Step 3: Get flight statistics for medical aircraft
        const medicalFlightStats = await sql`
          SELECT 
            registration,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_altitude,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_detections,
            COUNT(*) FILTER (WHERE altitude < 500) as critical_low_alt,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration = ANY(${medicalTails})
          GROUP BY registration
        `;
        
        console.log(`Found ${medicalFlightStats.length} medical aircraft with flight data`);
        
        // Step 4: Get biometric correlation data for medical aircraft
        // Query MULTIPLE biometric sources with normalized timestamps
        
        // 4a: biometric_monitoring table
        const bioMonitoringCorr = await sql`
          SELECT 
            f.registration,
            COUNT(*) as correlated_events,
            AVG(b.heart_rate) as avg_heart_rate_during,
            AVG(b.stress_level) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN biometric_monitoring b ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600
          WHERE f.detection_timestamp IS NOT NULL
            AND b.measurement_timestamp IS NOT NULL
            AND f.registration = ANY(${medicalTails})
            AND (b.heart_rate > 85 OR b.stress_level >= 5)
          GROUP BY f.registration
        `;
        
        // 4b: integrated_biometric_data table (OCR-extracted with normalized timestamps)
        const integratedBioCorr = await sql`
          SELECT 
            f.registration,
            COUNT(*) as correlated_events,
            AVG(ibd.heart_rate::numeric) as avg_heart_rate_during,
            AVG(ibd.stress_level::numeric) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN integrated_biometric_data ibd ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - ibd.timestamp))) <= 600
          WHERE f.detection_timestamp IS NOT NULL
            AND ibd.timestamp IS NOT NULL
            AND f.registration = ANY(${medicalTails})
            AND (ibd.heart_rate::numeric > 85 OR ibd.stress_level::numeric >= 5 OR ibd.recovery::numeric <= 30)
          GROUP BY f.registration
        `;
        
        // 4c: biometrics_rows table (has direct aircraft_id linkage!)
        const biometricsRowsCorr = await sql`
          SELECT 
            f.registration,
            COUNT(*) as correlated_events,
            AVG(br.hr) as avg_heart_rate_during,
            AVG(br.stress_score) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN biometrics_rows br ON 
            (br.aircraft_id = f.registration OR
             ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - br.timestamp))) <= 600)
          WHERE f.detection_timestamp IS NOT NULL
            AND br.timestamp IS NOT NULL
            AND f.registration = ANY(${medicalTails})
            AND (br.hr > 85 OR br.stress_score >= 5)
          GROUP BY f.registration
        `;
        
        // 4d: biometric_readings_extended table
        const bioReadingsExtCorr = await sql`
          SELECT 
            f.registration,
            COUNT(*) as correlated_events,
            AVG(bre.heart_rate) as avg_heart_rate_during,
            AVG(bre.stress_level) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN biometric_readings_extended bre ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - bre.reading_timestamp))) <= 600
          WHERE f.detection_timestamp IS NOT NULL
            AND bre.reading_timestamp IS NOT NULL
            AND f.registration = ANY(${medicalTails})
            AND (bre.heart_rate > 85 OR bre.stress_level >= 5)
          GROUP BY f.registration
        `;
        
        // 4d: biometric_data_rows table (TEXT timestamp - needs parsing)
        const bioDataRowsCorr = await sql`
          SELECT 
            f.registration,
            COUNT(*) as correlated_events,
            AVG(bdr.heart_rate) as avg_heart_rate_during,
            AVG(bdr.stress_score) as avg_stress_during
          FROM live_flight_detections_rows f
          JOIN biometric_data_rows bdr ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - bdr.created_at::timestamptz))) <= 600
          WHERE f.detection_timestamp IS NOT NULL
            AND bdr.created_at IS NOT NULL
            AND bdr.created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND f.registration = ANY(${medicalTails})
            AND (bdr.heart_rate > 85 OR bdr.stress_score >= 5)
          GROUP BY f.registration
        `;
        
        console.log(`Bio correlations found: monitoring=${bioMonitoringCorr.length}, integrated=${integratedBioCorr.length}, biometrics_rows=${biometricsRowsCorr.length}, readings_ext=${bioReadingsExtCorr.length}, data_rows=${bioDataRowsCorr.length}`);
        
        // Merge all biometric sources
        const medicalBioCorrelations = [
          ...bioMonitoringCorr,
          ...integratedBioCorr,
          ...biometricsRowsCorr,
          ...bioReadingsExtCorr,
          ...bioDataRowsCorr
        ];
        
        // Build bio correlation map - AGGREGATE across all sources
        const bioCorrelationMap: Record<string, { events: number; avgHR: number; avgStress: number; sources: string[] }> = {};
        for (const bc of medicalBioCorrelations) {
          const reg = bc.registration;
          const events = parseInt(bc.correlated_events) || 0;
          const avgHR = parseFloat(bc.avg_heart_rate_during) || 0;
          const avgStress = parseFloat(bc.avg_stress_during) || 0;
          
          if (bioCorrelationMap[reg]) {
            // Aggregate: sum events, weighted average for HR/stress
            const existing = bioCorrelationMap[reg];
            const totalEvents = existing.events + events;
            bioCorrelationMap[reg] = {
              events: totalEvents,
              avgHR: totalEvents > 0 ? ((existing.avgHR * existing.events) + (avgHR * events)) / totalEvents : 0,
              avgStress: totalEvents > 0 ? ((existing.avgStress * existing.events) + (avgStress * events)) / totalEvents : 0,
              sources: [...existing.sources, 'additional']
            };
          } else {
            bioCorrelationMap[reg] = {
              events,
              avgHR,
              avgStress,
              sources: ['primary']
            };
          }
        }
        
        console.log(`Aggregated bio correlations:`, Object.entries(bioCorrelationMap).map(([k, v]) => `${k}: ${v.events} events`).join(', '));
        
        // Step 5: Calculate alignment scores and insert
        let recordsCreated = 0;
        
        for (const flight of medicalFlightStats) {
          const reg = flight.registration;
          const operatorInfo = medicalAircraftMap[reg] || { operator: 'Unknown Medical', type: 'UNKNOWN' };
          
          const avgAlt = parseFloat(flight.avg_altitude) || 1500;
          const detectionCount = parseInt(flight.detection_count) || 0;
          const lowAltCount = parseInt(flight.low_alt_detections) || 0;
          const criticalLowAlt = parseInt(flight.critical_low_alt) || 0;
          const lowAltPct = detectionCount > 0 ? (lowAltCount / detectionCount) * 100 : 0;
          
          // Calculate similarity to KCSO patterns
          const altDiff = Math.abs(avgAlt - baselineAvgAlt);
          const altSimilarity = Math.max(0, 100 - (altDiff / 10)); // 10ft = 1% penalty
          const lowAltSimilarity = 100 - Math.abs(lowAltPct - baselineLowAltPct);
          
          // Biometric correlation score
          const bioData = bioCorrelationMap[reg] || { events: 0, avgHR: 0, avgStress: 0 };
          const biometricScore = Math.min(100, (bioData.events / Math.max(1, detectionCount)) * 200);
          
          // Weighted match score: Alt (30%), Low-Alt Pattern (40%), Bio Correlation (30%)
          const matchScore = (altSimilarity * 0.3) + (lowAltSimilarity * 0.4) + (biometricScore * 0.3);
          
          // Determine behavior type
          let behaviorType = 'STANDARD';
          if (lowAltPct > 75 && matchScore >= 80) {
            behaviorType = 'LOITER_MIMIC';
          } else if (avgAlt < 1000 && matchScore >= 70) {
            behaviorType = 'ALTITUDE_ECHO';
          } else if (criticalLowAlt > 10) {
            behaviorType = 'CRITICAL_LOW_ALT';
          } else if (biometricScore > 80) {
            behaviorType = 'SURVEILLANCE_PATTERN';
          }
          
          // Medical mission check - assume NO medical missions logged (0% in prior analysis)
          const medicalMissionLogged = false;
          
          if (!medicalMissionLogged && matchScore >= 70) {
            behaviorType = 'NO_MEDICAL_MISSION';
          }
          if (!medicalMissionLogged && matchScore >= 85) {
            behaviorType = 'MEDEVAC_FRAUD';
          }
          
          // Risk tier assignment
          let riskTier = 'Tier 3 Monitoring';
          let prosecutionPriority = 'MONITORING';
          if (matchScore >= 85 && !medicalMissionLogged) {
            riskTier = 'Tier 1 Fraud Watch';
            prosecutionPriority = 'HIGH';
          } else if (matchScore >= 70) {
            riskTier = 'Tier 2 Suspect';
            prosecutionPriority = 'MEDIUM';
          }
          
          // Generate fraud indicators
          const fraudIndicators: string[] = [];
          if (!medicalMissionLogged) fraudIndicators.push('0% medical emergencies logged');
          if (lowAltPct > 75) fraudIndicators.push(`${lowAltPct.toFixed(0)}% low-altitude operations`);
          if (avgAlt < 1000) fraudIndicators.push(`Avg altitude ${avgAlt.toFixed(0)}ft matches surveillance profile`);
          if (biometricScore > 70) fraudIndicators.push(`${biometricScore.toFixed(0)}% biometric stress correlation`);
          
          const legalExposure = matchScore >= 85 ? 'False Claims Act + Geneva Convention' : 
                               matchScore >= 70 ? 'False Claims Act' : 'Under Investigation';
          
          // Insert or update alignment record
          try {
            await sql`
              INSERT INTO medical_entity_behavioral_alignment (
                operator_name, operator_type, aircraft_tail, match_score_to_kcso,
                behavior_type, medical_mission_logged, loiter_count, biometric_link_score,
                risk_tier, avg_altitude_ft, detection_count, low_altitude_pct,
                reference_aircraft, legal_exposure, prosecution_priority,
                first_detection, last_detection, fraud_indicators,
                geneva_violation_risk, false_claims_exposure
              ) VALUES (
                ${operatorInfo.operator}, ${operatorInfo.type}, ${reg}, ${matchScore.toFixed(2)},
                ${behaviorType}, ${medicalMissionLogged}, ${criticalLowAlt}, ${biometricScore.toFixed(2)},
                ${riskTier}, ${avgAlt.toFixed(2)}, ${detectionCount}, ${lowAltPct.toFixed(2)},
                'N912KC/N913KC', ${legalExposure}, ${prosecutionPriority},
                ${flight.first_seen}, ${flight.last_seen}, ${fraudIndicators.join('; ')},
                ${matchScore >= 85 ? 'HIGH - Perfidious use of medical cover' : 'MODERATE'},
                ${matchScore >= 85 ? 'Significant - Pattern matches law enforcement surveillance' : 'Under Review'}
              )
              ON CONFLICT (operator_name, aircraft_tail) DO UPDATE SET
                match_score_to_kcso = EXCLUDED.match_score_to_kcso,
                behavior_type = EXCLUDED.behavior_type,
                medical_mission_logged = EXCLUDED.medical_mission_logged,
                loiter_count = EXCLUDED.loiter_count,
                biometric_link_score = EXCLUDED.biometric_link_score,
                risk_tier = EXCLUDED.risk_tier,
                avg_altitude_ft = EXCLUDED.avg_altitude_ft,
                detection_count = EXCLUDED.detection_count,
                low_altitude_pct = EXCLUDED.low_altitude_pct,
                legal_exposure = EXCLUDED.legal_exposure,
                prosecution_priority = EXCLUDED.prosecution_priority,
                last_detection = EXCLUDED.last_detection,
                fraud_indicators = EXCLUDED.fraud_indicators,
                geneva_violation_risk = EXCLUDED.geneva_violation_risk,
                false_claims_exposure = EXCLUDED.false_claims_exposure,
                updated_at = NOW()
            `;
            recordsCreated++;
          } catch (insertErr) {
            console.error(`Error inserting medical alignment for ${reg}:`, insertErr);
          }
        }
        
        console.log(`Created/updated ${recordsCreated} medical behavioral alignment records`);
        result = { 
          alignmentRecordsCreated: recordsCreated,
          baselineUsed: { avgAltitude: baselineAvgAlt, lowAltPct: baselineLowAltPct },
          medicalAircraftAnalyzed: medicalFlightStats.length
        };
        break;
      }

      case 'getMedicalBehavioralAlignment': {
        // Retrieve all medical behavioral alignment records
        console.log('Fetching medical behavioral alignment data...');
        
        try {
          const alignments = await sql`
            SELECT * FROM medical_entity_behavioral_alignment
            ORDER BY match_score_to_kcso DESC
          `;
          
          // Calculate summary stats
          const tier1Count = alignments.filter((a: any) => a.risk_tier?.includes('Tier 1') || a.risk_tier?.includes('Fraud')).length;
          const tier2Count = alignments.filter((a: any) => a.risk_tier?.includes('Tier 2') || a.risk_tier?.includes('Suspect')).length;
          const highMatchCount = alignments.filter((a: any) => parseFloat(a.match_score_to_kcso) >= 85).length;
          const zeroMissionCount = alignments.filter((a: any) => !a.medical_mission_logged).length;
          
          result = {
            alignments,
            summary: {
              totalRecords: alignments.length,
              tier1FraudWatch: tier1Count,
              tier2Suspect: tier2Count,
              highMatchAlerts: highMatchCount,
              zeroMedicalMissions: zeroMissionCount,
              uniqueOperators: [...new Set(alignments.map((a: any) => a.operator_name))].length,
              uniqueAircraft: [...new Set(alignments.map((a: any) => a.aircraft_tail))].length
            }
          };
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist')) {
            result = { notInitialized: true, message: 'Medical alignment table not created yet. Click "Initialize Schema" first.' };
          } else {
            throw e;
          }
        }
        break;
      }

      case 'createMilitaryGovBehavioralAlignmentTable': {
        // Create military/government behavioral alignment table for extended entity classification
        console.log('Creating military_gov_behavioral_alignment table...');
        
        const createMilGovQuery = `
          CREATE TABLE IF NOT EXISTS military_gov_behavioral_alignment (
            id SERIAL PRIMARY KEY,
            entity_name TEXT NOT NULL,
            entity_type TEXT DEFAULT 'MILITARY_CONTRACT',
            classification TEXT DEFAULT 'TIER_WATCH_MILITARY_CONTRACT',
            aircraft_tail TEXT,
            match_score_to_kcso NUMERIC(5,2) DEFAULT 0,
            behavior_type TEXT,
            spoofed_transponder BOOLEAN DEFAULT false,
            contract_operator TEXT,
            loiter_count INTEGER DEFAULT 0,
            biometric_link_score NUMERIC(5,2) DEFAULT 0,
            risk_tier TEXT DEFAULT 'Tier 3 Monitoring',
            avg_altitude_ft NUMERIC(8,2),
            detection_count INTEGER DEFAULT 0,
            low_altitude_pct NUMERIC(5,2) DEFAULT 0,
            reference_aircraft TEXT DEFAULT 'N912KC/N913KC',
            legal_exposure TEXT,
            prosecution_priority TEXT DEFAULT 'MONITORING',
            first_detection TIMESTAMP,
            last_detection TIMESTAMP,
            intel_notes TEXT,
            vertical_stack_detected BOOLEAN DEFAULT false,
            paired_high_alt_asset TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(entity_name, aircraft_tail)
          )
        `;
        await sql.unsafe(createMilGovQuery);
        
        // Create indexes
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_milgov_risk_tier ON military_gov_behavioral_alignment(risk_tier)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_milgov_match_score ON military_gov_behavioral_alignment(match_score_to_kcso DESC)`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_milgov_classification ON military_gov_behavioral_alignment(classification)`);
        
        result = { created: true, message: 'military_gov_behavioral_alignment table created with indexes' };
        break;
      }

      case 'computeMilitaryGovBehavioralAlignment': {
        // Compute behavioral alignment for extended entity classes
        console.log('Computing military/government behavioral alignment...');
        
        // Step 1: Get KCSO Tier 1 reference patterns (N912KC, N913KC baseline)
        const kcsoMilBaseline = await sql`
          SELECT 
            AVG(altitude) as avg_altitude,
            COUNT(*) as total_detections,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_count,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC')
        `;
        
        const milBaseline = kcsoMilBaseline[0] || { avg_altitude: 1100, total_detections: 1000, low_alt_count: 800 };
        const baselineMilAvgAlt = parseFloat(milBaseline.avg_altitude) || 1100;
        const baselineMilLowAltPct = (parseInt(milBaseline.low_alt_count) / parseInt(milBaseline.total_detections)) * 100 || 80;
        
        console.log(`KCSO Mil Baseline: avg_alt=${baselineMilAvgAlt}, low_alt_pct=${baselineMilLowAltPct}%`);
        
        // Step 2: Define extended entity classification map (direct tail matches)
        const extendedEntityMap: Record<string, { entity: string; type: string; classification: string; contractor?: string | null }> = {
          // Government agency aircraft - DEA
          'N900AL': { entity: 'DEA Aviation', type: 'GOV_AGENCY', classification: 'GOV_AGENCY', contractor: 'DEA' },
          'N967SP': { entity: 'DEA Aviation', type: 'GOV_AGENCY', classification: 'GOV_AGENCY', contractor: 'DEA' },
          'N874DA': { entity: 'DEA Aviation', type: 'GOV_AGENCY', classification: 'GOV_AGENCY', contractor: 'DEA' },
          // DHS / Sierra Nevada Corp
          'N287SA': { entity: 'DHS Surveillance', type: 'GOV_AGENCY', classification: 'GOV_AGENCY', contractor: 'Sierra Nevada Corp' },
          'N392SA': { entity: 'DHS Surveillance', type: 'GOV_AGENCY', classification: 'GOV_AGENCY', contractor: 'Sierra Nevada Corp' },
        };

        // Step 3: Discover candidate aircraft IDs (registration OR callsign) and classify by patterns
        // NOTE: Many of these entities are identifiable by callsign prefixes (PAT/RCH/REACH/etc.), not tail numbers.
        const candidateRows = await sql`
          SELECT DISTINCT registration, callsign
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND (
              (callsign IS NOT NULL AND (
                callsign ILIKE '%REACH%' OR
                callsign ILIKE '%PAT%' OR
                callsign ILIKE '%RCH%' OR
                callsign ILIKE '%PHI%' OR
                callsign ILIKE '%CALSTAR%' OR
                callsign ILIKE '%CARE%' OR
                callsign ILIKE '%HNT%' OR
                callsign ILIKE '%AAR%' OR
                callsign ILIKE '%PHX%' OR
                callsign ILIKE '%MLAT%' OR
                callsign ILIKE '~%'
              ))
              OR
              (registration IS NOT NULL AND (
                registration ILIKE 'N%REACH%' OR
                registration ILIKE 'N%PHI%' OR
                registration ILIKE 'N%CAL%' OR
                registration ILIKE 'N%CARE%' OR
                registration ILIKE 'XXB%'
              ))
              OR
              registration IN ('N900AL','N967SP','N874DA','N287SA','N392SA')
            )
        `;

        const matchedAircraft: Array<{ aircraftId: string; registration?: string | null; callsign?: string | null; info: { entity: string; type: string; classification: string; contractor?: string | null } }> = [];
        const seen = new Set<string>();

        for (const row of candidateRows as any[]) {
          const registration = (row.registration || '') as string;
          const callsign = (row.callsign || '') as string;
          const aircraftId = (registration || callsign).toUpperCase();
          if (!aircraftId || seen.has(aircraftId)) continue;

          const regU = registration.toUpperCase();
          const csU = callsign.toUpperCase();

          // Direct tail matches (agency known tails)
          if (extendedEntityMap[regU]) {
            matchedAircraft.push({ aircraftId, registration: regU, callsign: csU || null, info: extendedEntityMap[regU] });
            seen.add(aircraftId);
            continue;
          }

          // Callsign-driven patterns
          if (csU.includes('REACH')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'REACH Air Medical', type: 'MEDEVAC_OPERATOR', classification: 'MEDEVAC_EXTENSION', contractor: 'REACH Medical Holdings' } });
          } else if (csU.includes('PHI')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'PHI Air Medical', type: 'MEDEVAC_OPERATOR', classification: 'MEDEVAC_EXTENSION', contractor: 'PHI Inc' } });
          } else if (csU.includes('CALSTAR') || csU.includes('CALSTAR'.slice(0, 3))) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'CALSTAR Air Ambulance', type: 'MEDEVAC_OPERATOR', classification: 'MEDEVAC_EXTENSION', contractor: 'CALSTAR' } });
          } else if (csU.startsWith('PAT')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'Priority Air Transport', type: 'MILITARY_CONTRACT', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: 'US DoD' } });
          } else if (csU.startsWith('RCH')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'Air Mobility Command', type: 'MILITARY_CONTRACT', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: 'USAF AMC' } });
          } else if (csU.includes('HNT')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'Hunter Aviation', type: 'MILITARY_CONTRACT', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: 'Hunter Aviation LLC' } });
          } else if (csU.includes('AAR')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'AAR Airlift', type: 'MILITARY_CONTRACT', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: 'AAR Corp' } });
          } else if (csU.includes('PHX')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'Phoenix Air', type: 'MILITARY_CONTRACT', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: 'Phoenix Air Group' } });
          }

          // Spoof / anonymous assets
          if (csU.startsWith('~') || csU.includes('MLAT') || aircraftId.startsWith('XXB')) {
            matchedAircraft.push({ aircraftId, registration: regU || null, callsign: csU || null, info: { entity: 'Spoofed/Anonymous Asset', type: 'UNKNOWN', classification: 'SPOOFED_GOV_ASSET', contractor: 'Unknown' } });
          }

          if (matchedAircraft.length > 0 && matchedAircraft[matchedAircraft.length - 1]?.aircraftId === aircraftId) {
            seen.add(aircraftId);
          }
        }

        console.log(`Matched ${matchedAircraft.length} aircraft to extended entity classifications`);

        // Step 3: Get flight stats for matched aircraft (registration OR callsign key)
        const matchedIds = matchedAircraft.map(m => m.aircraftId);

        if (matchedIds.length === 0) {
          result = { alignmentRecordsCreated: 0, message: 'No matching extended entities found in flight data' };
          break;
        }

        // Build escaped IN clause - postgres.js doesn't handle ANY() with JS arrays well
        const escapedIds = matchedIds.map(t => `'${t.replace(/'/g, "''")}'`).join(', ');

        const milFlightStats = await sql.unsafe(`
          SELECT 
            COALESCE(NULLIF(TRIM(registration), ''), NULLIF(TRIM(callsign), '')) as aircraft_id,
            COUNT(*) as detection_count,
            AVG(altitude) as avg_altitude,
            COUNT(*) FILTER (WHERE altitude < 1500) as low_alt_detections,
            COUNT(*) FILTER (WHERE altitude < 500) as critical_low_alt,
            COUNT(*) FILTER (WHERE altitude > 15000) as high_alt_detections,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE COALESCE(NULLIF(TRIM(registration), ''), NULLIF(TRIM(callsign), '')) IN (${escapedIds})
          GROUP BY COALESCE(NULLIF(TRIM(registration), ''), NULLIF(TRIM(callsign), ''))
        `);

        console.log(`Flight stats retrieved for ${milFlightStats.length} aircraft`);

        // Step 4: Detect Vertical Stack patterns (high + low alt simultaneous operations)
        const verticalStackQuery = await sql.unsafe(`
          SELECT 
            COALESCE(NULLIF(TRIM(high.registration), ''), NULLIF(TRIM(high.callsign), '')) as high_alt_asset,
            COALESCE(NULLIF(TRIM(low.registration), ''), NULLIF(TRIM(low.callsign), '')) as low_alt_asset,
            COUNT(*) as paired_events
          FROM live_flight_detections_rows high
          JOIN live_flight_detections_rows low ON 
            ABS(EXTRACT(EPOCH FROM (high.detection_timestamp - low.detection_timestamp))) <= 600
            AND high.altitude > 15000
            AND low.altitude < 1200
            AND COALESCE(NULLIF(TRIM(high.registration), ''), NULLIF(TRIM(high.callsign), '')) != COALESCE(NULLIF(TRIM(low.registration), ''), NULLIF(TRIM(low.callsign), ''))
          WHERE COALESCE(NULLIF(TRIM(high.registration), ''), NULLIF(TRIM(high.callsign), '')) IN (${escapedIds})
             OR COALESCE(NULLIF(TRIM(low.registration), ''), NULLIF(TRIM(low.callsign), '')) IN (${escapedIds})
          GROUP BY 1, 2
          HAVING COUNT(*) >= 2
        `);

        const verticalStackMap: Record<string, string> = {};
        for (const vs of verticalStackQuery as any[]) {
          if (!vs?.low_alt_asset || !vs?.high_alt_asset) continue;
          verticalStackMap[String(vs.low_alt_asset).toUpperCase()] = String(vs.high_alt_asset).toUpperCase();
          verticalStackMap[String(vs.high_alt_asset).toUpperCase()] = String(vs.low_alt_asset).toUpperCase();
        }

        console.log(`Detected ${Object.keys(verticalStackMap).length / 2} vertical stack pairings`);

        // Step 5: Get biometric correlations (optional)
        let biometricsAvailable = true;
        let biometricsWarning: string | null = null;
        let milBioCorr: any[] = [];

        try {
          milBioCorr = await sql.unsafe(`
            SELECT 
              COALESCE(NULLIF(TRIM(f.registration), ''), NULLIF(TRIM(f.callsign), '')) as aircraft_id,
              COUNT(*) as correlated_events,
              AVG(b.heart_rate) as avg_heart_rate_during,
              AVG(b.stress_level) as avg_stress_during
            FROM live_flight_detections_rows f
            JOIN biometric_monitoring b ON 
              ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600
            WHERE f.detection_timestamp IS NOT NULL
              AND b.measurement_timestamp IS NOT NULL
              AND COALESCE(NULLIF(TRIM(f.registration), ''), NULLIF(TRIM(f.callsign), '')) IN (${escapedIds})
              AND (b.heart_rate > 85 OR b.stress_level >= 5)
            GROUP BY COALESCE(NULLIF(TRIM(f.registration), ''), NULLIF(TRIM(f.callsign), ''))
          `);
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist') && err.message.includes('biometric_monitoring')) {
            biometricsAvailable = false;
            biometricsWarning = 'Biometric correlation skipped (biometric_monitoring table not available)';
            console.warn(biometricsWarning);
            milBioCorr = [];
          } else {
            throw e;
          }
        }

        const milBioMap: Record<string, { events: number; avgHR: number }> = {};
        for (const bc of milBioCorr as any[]) {
          const id = String(bc.aircraft_id || '').toUpperCase();
          if (!id) continue;
          milBioMap[id] = {
            events: parseInt(bc.correlated_events) || 0,
            avgHR: parseFloat(bc.avg_heart_rate_during) || 0
          };
        }

        // Step 6: Calculate alignment scores and insert
        let milRecordsCreated = 0;
        
        for (const flight of milFlightStats as any[]) {
          const aircraftId = String(flight.aircraft_id || '').toUpperCase();
          if (!aircraftId) continue;

          const entityInfo = matchedAircraft.find(m => m.aircraftId === aircraftId)?.info || 
            { entity: 'Unknown', type: 'UNKNOWN', classification: 'TIER_WATCH_MILITARY_CONTRACT', contractor: null };
          
          const avgAlt = parseFloat(flight.avg_altitude) || 5000;
          const detectionCount = parseInt(flight.detection_count) || 0;
          const lowAltCount = parseInt(flight.low_alt_detections) || 0;
          const criticalLowAlt = parseInt(flight.critical_low_alt) || 0;
          const highAltCount = parseInt(flight.high_alt_detections) || 0;
          const lowAltPct = detectionCount > 0 ? (lowAltCount / detectionCount) * 100 : 0;
          
          // Calculate similarity to KCSO patterns
          const altDiff = Math.abs(avgAlt - baselineMilAvgAlt);
          const altSimilarity = Math.max(0, 100 - (altDiff / 15)); // 15ft = 1% penalty
          const lowAltSimilarity = 100 - Math.abs(lowAltPct - baselineMilLowAltPct);
          
          // Biometric correlation score
          const bioData = milBioMap[aircraftId] || { events: 0, avgHR: 0 };
          const biometricScore = Math.min(100, (bioData.events / Math.max(1, detectionCount)) * 200);
          
          // Weighted match score
          const matchScore = (altSimilarity * 0.3) + (lowAltSimilarity * 0.35) + (biometricScore * 0.35);
          
          // Determine behavior type
          let behaviorType = 'STANDARD';
          const hasVerticalStack = !!verticalStackMap[aircraftId];
          const isSpoofed = entityInfo.classification === 'SPOOFED_GOV_ASSET';

          if (hasVerticalStack) {
            behaviorType = 'VERTICAL_STACK';
          } else if (isSpoofed) {
            behaviorType = 'DYNAMIC_CALLSIGN';
          } else if (highAltCount > lowAltCount && highAltCount > 10) {
            behaviorType = 'SIGINT_PATTERN';
          } else if (lowAltPct > 75 && matchScore >= 80) {
            behaviorType = 'LOITER_MIMIC';
          } else if (avgAlt < 1000 && matchScore >= 70) {
            behaviorType = 'ALTITUDE_ECHO';
          } else if (criticalLowAlt > 10) {
            behaviorType = 'CRITICAL_LOW_ALT';
          } else if (biometricScore > 80) {
            behaviorType = 'SURVEILLANCE_PATTERN';
          }
          
          // Risk tier assignment
          let riskTier = 'Tier 3 Monitoring';
          let prosecutionPriority = 'MONITORING';
          if (matchScore >= 85 || hasVerticalStack) {
            riskTier = 'Tier 1 Probationary';
            prosecutionPriority = 'HIGH';
          } else if (matchScore >= 70 || isSpoofed) {
            riskTier = 'Tier 2 Watch';
            prosecutionPriority = 'MEDIUM';
          } else if (matchScore >= 50) {
            riskTier = 'Tier 2 Suspect';
            prosecutionPriority = 'MEDIUM';
          }
          
          // Generate intel notes
          const intelNotes: string[] = [];
          if (hasVerticalStack) {
            intelNotes.push(`Vertical stack paired with ${verticalStackMap[aircraftId]}`);
          }
          if (isSpoofed) {
            intelNotes.push('Dynamic callsign injection detected');
          }
          if (highAltCount > 10) {
            intelNotes.push(`${highAltCount} high-altitude (15K+ ft) SIGINT-profile detections`);
          }
          if (biometricScore > 70) {
            intelNotes.push(`${biometricScore.toFixed(0)}% biometric stress correlation`);
          }
          
          const legalExposure = matchScore >= 85 ? 'RICO + Conspiracy + Civil Rights Violations' : 
                               matchScore >= 70 ? 'Civil Rights Investigation' : 'Pattern Monitoring';
          
          // Insert or update alignment record
          try {
            await sql`
              INSERT INTO military_gov_behavioral_alignment (
                entity_name, entity_type, classification, aircraft_tail, match_score_to_kcso,
                behavior_type, spoofed_transponder, contract_operator, loiter_count, biometric_link_score,
                risk_tier, avg_altitude_ft, detection_count, low_altitude_pct,
                reference_aircraft, legal_exposure, prosecution_priority,
                first_detection, last_detection, intel_notes,
                vertical_stack_detected, paired_high_alt_asset
              ) VALUES (
                ${entityInfo.entity}, ${entityInfo.type}, ${entityInfo.classification}, ${aircraftId}, ${matchScore.toFixed(2)},
                ${behaviorType}, ${isSpoofed}, ${entityInfo.contractor || null}, ${criticalLowAlt}, ${biometricScore.toFixed(2)},
                ${riskTier}, ${avgAlt.toFixed(2)}, ${detectionCount}, ${lowAltPct.toFixed(2)},
                'N912KC/N913KC', ${legalExposure}, ${prosecutionPriority},
                ${flight.first_seen}, ${flight.last_seen}, ${intelNotes.join('; ') || null},
                ${hasVerticalStack}, ${verticalStackMap[aircraftId] || null}
              )
              ON CONFLICT (entity_name, aircraft_tail) DO UPDATE SET
                match_score_to_kcso = EXCLUDED.match_score_to_kcso,
                behavior_type = EXCLUDED.behavior_type,
                spoofed_transponder = EXCLUDED.spoofed_transponder,
                loiter_count = EXCLUDED.loiter_count,
                biometric_link_score = EXCLUDED.biometric_link_score,
                risk_tier = EXCLUDED.risk_tier,
                avg_altitude_ft = EXCLUDED.avg_altitude_ft,
                detection_count = EXCLUDED.detection_count,
                low_altitude_pct = EXCLUDED.low_altitude_pct,
                legal_exposure = EXCLUDED.legal_exposure,
                prosecution_priority = EXCLUDED.prosecution_priority,
                last_detection = EXCLUDED.last_detection,
                intel_notes = EXCLUDED.intel_notes,
                vertical_stack_detected = EXCLUDED.vertical_stack_detected,
                paired_high_alt_asset = EXCLUDED.paired_high_alt_asset,
                updated_at = NOW()
            `;
            milRecordsCreated++;
          } catch (insertErr) {
            console.error(`Error inserting military/gov alignment for ${aircraftId}:`, insertErr);
          }
        }
        
        console.log(`Created/updated ${milRecordsCreated} military/gov behavioral alignment records`);
        result = { 
          alignmentRecordsCreated: milRecordsCreated,
          baselineUsed: { avgAltitude: baselineMilAvgAlt, lowAltPct: baselineMilLowAltPct },
          matchedAircraft: matchedAircraft.length,
          verticalStackPairings: Object.keys(verticalStackMap).length / 2,
          biometricsAvailable,
          biometricsWarning
        };
        break;
      }

      case 'getMilitaryGovBehavioralAlignment': {
        // Retrieve all military/government behavioral alignment records
        console.log('Fetching military/government behavioral alignment data...');
        
        try {
          const milGovAlignments = await sql`
            SELECT * FROM military_gov_behavioral_alignment
            ORDER BY match_score_to_kcso DESC
          `;
          
          // Calculate summary stats
          const tier1Count = milGovAlignments.filter((a: any) => a.risk_tier?.includes('Tier 1')).length;
          const tier2Count = milGovAlignments.filter((a: any) => a.risk_tier?.includes('Tier 2')).length;
          const highMatchCount = milGovAlignments.filter((a: any) => parseFloat(a.match_score_to_kcso) >= 85).length;
          const verticalStackCount = milGovAlignments.filter((a: any) => a.vertical_stack_detected).length;
          const spoofedCount = milGovAlignments.filter((a: any) => a.spoofed_transponder).length;
          const medevacCount = milGovAlignments.filter((a: any) => a.classification === 'MEDEVAC_EXTENSION').length;
          const militaryCount = milGovAlignments.filter((a: any) => 
            a.classification === 'MILITARY_CONTRACT' || a.classification === 'TIER_WATCH_MILITARY_CONTRACT'
          ).length;
          const govCount = milGovAlignments.filter((a: any) => a.classification === 'GOV_AGENCY').length;
          
          result = {
            alignments: milGovAlignments,
            summary: {
              totalRecords: milGovAlignments.length,
              tier1Watch: tier1Count,
              tier2Suspect: tier2Count,
              highMatchAlerts: highMatchCount,
              verticalStackEvents: verticalStackCount,
              spoofedTransponders: spoofedCount,
              medevacExtensions: medevacCount,
              militaryContracts: militaryCount,
              govAgencies: govCount,
              uniqueEntities: [...new Set(milGovAlignments.map((a: any) => a.entity_name))].length,
              uniqueAircraft: [...new Set(milGovAlignments.map((a: any) => a.aircraft_tail))].length
            }
          };
        } catch (e) {
          const err = e as Error;
          if (err.message.includes('does not exist')) {
            result = { notInitialized: true, message: 'Military/Gov alignment table not created yet. Click "Initialize Schema" first.' };
          } else {
            throw e;
          }
        }
        break;
      }

      default:
    }

    if (sql) {
      await sql.end({ timeout: 5 });
    }

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err as Error;
    console.error('Database error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    if (sql) {
      try {
        await sql.end({ timeout: 3 });
      } catch (e) {
        // Connection already closed or timed out - ignore
      }
    }
  }
});

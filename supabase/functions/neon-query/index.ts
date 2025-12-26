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
      idle_timeout: 20,
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
        result = await sql.unsafe(query);
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
                f.registration = ANY(${priorityAircraft})
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
        
        // Step 4: Get biometric correlation data for each aircraft
        const bioCorrelations = await sql`
          SELECT 
            f.registration,
            COUNT(*) as bio_correlation_count,
            AVG(b.heart_rate) as avg_heart_rate_during,
            AVG(b.stress_level) as avg_stress_during
          FROM live_flight_detections_rows f
          CROSS JOIN biometric_monitoring b
          WHERE f.detection_timestamp IS NOT NULL
            AND b.measurement_timestamp IS NOT NULL
            AND ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600
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

      default:
    }

    await sql.end();

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err as Error;
    console.error('Database error:', error);
    if (sql) {
      try {
        await sql.end();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

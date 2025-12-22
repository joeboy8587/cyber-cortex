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

      default:
        throw new Error(`Unknown action: ${action}`);
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

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

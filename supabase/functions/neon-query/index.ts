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
    const body = await req.json().catch(() => ({}));
    const { action, table, limit = 100, offset = 0, query, data, where } = (body ?? {}) as Record<string, any>;

    if (!action || typeof action !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing required field: action' }),
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
          'flagged_aircraft_rows_rows'
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
        
        const insertQuery = `INSERT INTO ${insertTable} (${columnList}) VALUES (${placeholders}) RETURNING *`;
        console.log('Executing insert:', insertQuery, values);
        
        result = await sql.unsafe(insertQuery, values as postgres.ParameterOrJSON<never>[]);
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
          'shell_companies'
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

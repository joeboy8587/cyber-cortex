import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Compute SHA-256 hash of a string
async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: 'Database connection not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;
  
  try {
    const { action, table, batchSize = 1000 } = await req.json();
    
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 30,
    });

    let result;

    switch (action) {
      case 'getTablesStatus': {
        // Get all tables and check if they have sha256_hash column
        result = await sql`
          SELECT 
            t.table_schema as schemaname,
            t.table_name as tablename,
            (SELECT COUNT(*)::bigint FROM information_schema.columns c 
             WHERE c.table_name = t.table_name 
             AND c.table_schema = t.table_schema 
             AND c.column_name = 'sha256_hash') as has_hash_column,
            pg_class.reltuples::bigint as row_count
          FROM information_schema.tables t
          JOIN pg_class ON pg_class.relname = t.table_name
          JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
            AND pg_namespace.nspname = t.table_schema
          WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND t.table_type = 'BASE TABLE'
          ORDER BY pg_class.reltuples DESC
          LIMIT 500
        `;
        break;
      }

      case 'addHashColumn': {
        if (!table) throw new Error('Table name required');
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
        
        // Check if column already exists
        const exists = await sql`
          SELECT COUNT(*) as count FROM information_schema.columns 
          WHERE table_name = ${safeTable} AND column_name = 'sha256_hash'
        `;
        
        if (parseInt(exists[0].count) > 0) {
          result = { message: `Column sha256_hash already exists in ${safeTable}`, existed: true };
        } else {
          await sql.unsafe(`ALTER TABLE ${safeTable} ADD COLUMN sha256_hash TEXT`);
          await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256 ON ${safeTable}(sha256_hash)`);
          result = { message: `Added sha256_hash column to ${safeTable}`, created: true };
        }
        break;
      }

      case 'addHashColumnToAll': {
        // Get all tables without hash column
        const tablesWithoutHash = await sql`
          SELECT DISTINCT t.table_name
          FROM information_schema.tables t
          LEFT JOIN information_schema.columns c 
            ON c.table_name = t.table_name AND c.column_name = 'sha256_hash'
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.column_name IS NULL
          ORDER BY t.table_name
        `;
        
        const added: string[] = [];
        const failed: { table: string; error: string }[] = [];
        
        for (const row of tablesWithoutHash) {
          try {
            const safeTable = row.table_name.replace(/[^a-zA-Z0-9_]/g, '');
            await sql.unsafe(`ALTER TABLE ${safeTable} ADD COLUMN sha256_hash TEXT`);
            await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256 ON ${safeTable}(sha256_hash)`);
            added.push(row.table_name);
          } catch (e) {
            failed.push({ table: row.table_name, error: (e as Error).message });
          }
        }
        
        result = { 
          added, 
          failed, 
          totalAdded: added.length,
          totalFailed: failed.length,
          message: `Added sha256_hash column to ${added.length} tables`
        };
        break;
      }

      case 'computeHashes': {
        if (!table) throw new Error('Table name required');
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
        
        // Get columns for this table (excluding sha256_hash itself)
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        
        if (columns.length === 0) {
          throw new Error(`Table ${safeTable} not found or has no columns`);
        }
        
        // Get rows without hash (limited batch)
        const columnList = columns.map(c => c.column_name).join(', ');
        const rows = await sql.unsafe(`
          SELECT * FROM ${safeTable} 
          WHERE sha256_hash IS NULL 
          LIMIT ${batchSize}
        `);
        
        let updated = 0;
        for (const row of rows) {
          // Create deterministic string from row data
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null) return 'NULL';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');
          
          const hash = await computeSHA256(dataString);
          
          // Find primary key column(s)
          const pkResult = await sql`
            SELECT a.attname
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
            WHERE i.indrelid = ${safeTable}::regclass AND i.indisprimary
          `;
          
          if (pkResult.length > 0) {
            const pkCol = pkResult[0].attname;
            await sql.unsafe(`UPDATE ${safeTable} SET sha256_hash = '${hash}' WHERE ${pkCol} = $1`, [row[pkCol]]);
            updated++;
          }
        }
        
        // Get remaining count
        const remaining = await sql.unsafe(`SELECT COUNT(*) as count FROM ${safeTable} WHERE sha256_hash IS NULL`);
        
        result = { 
          table: safeTable,
          updated, 
          remaining: parseInt(remaining[0].count),
          message: `Computed ${updated} hashes for ${safeTable}`
        };
        break;
      }

      case 'getHashStats': {
        // Get hash coverage statistics for all tables
        const tables = await sql`
          SELECT table_name FROM information_schema.columns 
          WHERE column_name = 'sha256_hash' AND table_schema = 'public'
        `;
        
        const stats = [];
        for (const t of tables) {
          try {
            const safeTable = t.table_name.replace(/[^a-zA-Z0-9_]/g, '');
            const countResult = await sql.unsafe(`
              SELECT 
                COUNT(*) as total,
                COUNT(sha256_hash) as hashed,
                COUNT(*) - COUNT(sha256_hash) as unhashed
              FROM ${safeTable}
            `);
            stats.push({
              table: t.table_name,
              total: parseInt(countResult[0].total),
              hashed: parseInt(countResult[0].hashed),
              unhashed: parseInt(countResult[0].unhashed),
              coverage: countResult[0].total > 0 
                ? Math.round((countResult[0].hashed / countResult[0].total) * 100) 
                : 100
            });
          } catch (e) {
            console.error(`Error getting stats for ${t.table_name}:`, e);
          }
        }
        
        result = {
          tables: stats.sort((a, b) => b.unhashed - a.unhashed),
          totalTables: stats.length,
          totalRecords: stats.reduce((sum, s) => sum + s.total, 0),
          totalHashed: stats.reduce((sum, s) => sum + s.hashed, 0),
          overallCoverage: Math.round(
            (stats.reduce((sum, s) => sum + s.hashed, 0) / 
             Math.max(1, stats.reduce((sum, s) => sum + s.total, 0))) * 100
          )
        };
        break;
      }

      case 'verifyHash': {
        if (!table) throw new Error('Table name required');
        const safeTable = table.replace(/[^a-zA-Z0-9_]/g, '');
        
        // Get columns
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        
        // Get sample of hashed rows to verify
        const rows = await sql.unsafe(`
          SELECT * FROM ${safeTable} 
          WHERE sha256_hash IS NOT NULL 
          LIMIT 100
        `);
        
        let verified = 0;
        let failed = 0;
        const failures: { id: unknown; stored: string; computed: string }[] = [];
        
        for (const row of rows) {
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null) return 'NULL';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');
          
          const computedHash = await computeSHA256(dataString);
          
          if (computedHash === row.sha256_hash) {
            verified++;
          } else {
            failed++;
            if (failures.length < 10) {
              failures.push({ 
                id: row.id || row[columns[0].column_name],
                stored: row.sha256_hash,
                computed: computedHash
              });
            }
          }
        }
        
        result = {
          table: safeTable,
          verified,
          failed,
          failures,
          integrity: failed === 0 ? 'VERIFIED' : 'COMPROMISED',
          message: failed === 0 
            ? `All ${verified} sampled records verified - chain of custody intact`
            : `WARNING: ${failed} records failed verification - possible tampering detected`
        };
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
    console.error('Fingerprint error:', error);
    if (sql) {
      try { await sql.end(); } catch (e) { console.error('Error closing connection:', e); }
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

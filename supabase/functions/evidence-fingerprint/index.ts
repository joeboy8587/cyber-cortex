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

// Sanitize table name to prevent SQL injection
function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    console.error('[evidence-fingerprint] NEON_DATABASE_URL not configured');
    return new Response(
      JSON.stringify({ error: 'Database connection not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;
  
  try {
    const body = await req.json();
    const { action, table, batchSize = 500 } = body;
    
    console.log(`[evidence-fingerprint] Action: ${action}, Table: ${table || 'N/A'}`);
    
    // Optimized connection settings for stability
    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60,
    });

    let result;

    switch (action) {
      case 'getTablesStatus': {
        result = await sql`
          SELECT 
            t.table_schema as schemaname,
            t.table_name as tablename,
            (SELECT COUNT(*)::int FROM information_schema.columns c 
             WHERE c.table_name = t.table_name 
             AND c.table_schema = t.table_schema 
             AND c.column_name = 'sha256_hash') as has_hash_column,
            COALESCE(pg_class.reltuples::bigint, 0) as row_count
          FROM information_schema.tables t
          LEFT JOIN pg_class ON pg_class.relname = t.table_name
          LEFT JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace 
            AND pg_namespace.nspname = t.table_schema
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
          ORDER BY COALESCE(pg_class.reltuples, 0) DESC
          LIMIT 200
        `;
        console.log(`[evidence-fingerprint] Found ${result.length} tables`);
        break;
      }

      case 'addHashColumn': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        
        const exists = await sql`
          SELECT COUNT(*)::int as count FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} AND column_name = 'sha256_hash'
        `;
        
        if (exists[0].count > 0) {
          result = { message: `Column sha256_hash already exists in ${safeTable}`, existed: true };
        } else {
          await sql.unsafe(`ALTER TABLE public."${safeTable}" ADD COLUMN IF NOT EXISTS sha256_hash TEXT`);
          await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256 ON public."${safeTable}"(sha256_hash)`);
          await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256_null ON public."${safeTable}"(sha256_hash) WHERE sha256_hash IS NULL`);
          result = { message: `Added sha256_hash column to ${safeTable}`, created: true };
        }
        console.log(`[evidence-fingerprint] ${result.message}`);
        break;
      }

      case 'addHashColumnToAll': {
        const tablesWithoutHash = await sql`
          SELECT DISTINCT t.table_name
          FROM information_schema.tables t
          LEFT JOIN information_schema.columns c 
            ON c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'sha256_hash'
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.column_name IS NULL
          ORDER BY t.table_name
          LIMIT 100
        `;
        
        const added: string[] = [];
        const failed: { table: string; error: string }[] = [];
        
        for (const row of tablesWithoutHash) {
          try {
            const safeTable = sanitizeTableName(row.table_name);
            await sql.unsafe(`ALTER TABLE public."${safeTable}" ADD COLUMN IF NOT EXISTS sha256_hash TEXT`);
            await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256 ON public."${safeTable}"(sha256_hash)`);
            await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256_null ON public."${safeTable}"(sha256_hash) WHERE sha256_hash IS NULL`);
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
        console.log(`[evidence-fingerprint] ${result.message}`);
        break;
      }

      case 'computeHashes': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        const limit = Math.min(batchSize, 500); // Cap batch size for stability
        
        // Get columns for this table (excluding sha256_hash itself)
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        
        if (columns.length === 0) {
          throw new Error(`Table ${safeTable} not found or has no columns`);
        }

        // Find primary key column
        const pkResult = await sql`
          SELECT a.attname as pk_column
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = ${`public.${safeTable}`}::regclass AND i.indisprimary
          LIMIT 1
        `;
        
        const pkColumn = pkResult.length > 0 ? pkResult[0].pk_column : null;
        if (!pkColumn) {
          // Skip tables without primary keys gracefully
          console.log(`[evidence-fingerprint] Skipping ${safeTable} - no primary key`);
          result = {
            table: safeTable,
            updated: 0,
            remaining: 0,
            message: `Skipped ${safeTable} - no primary key (backup/staging table)`,
            hasMore: false,
            skipped: true,
            reason: 'no_primary_key'
          };
          break;
        }
        
        // Get rows without hash (limited batch)
        const rows = await sql.unsafe(`
          SELECT * FROM public."${safeTable}" 
          WHERE sha256_hash IS NULL 
          LIMIT ${limit}
        `);
        
        let updated = 0;
        for (const row of rows) {
          // Create deterministic string from row data
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null || val === undefined) return 'NULL';
            if (val instanceof Date) return val.toISOString();
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');
          
          const hash = await computeSHA256(dataString);
          
          await sql.unsafe(
            `UPDATE public."${safeTable}" SET sha256_hash = $1 WHERE "${pkColumn}" = $2`,
            [hash, row[pkColumn]]
          );
          updated++;
        }
        
        // Get remaining count
        const remaining = await sql.unsafe(`SELECT COUNT(*)::int as count FROM public."${safeTable}" WHERE sha256_hash IS NULL`);
        
        result = { 
          table: safeTable,
          updated, 
          remaining: remaining[0].count,
          message: `Computed ${updated} hashes for ${safeTable}`,
          hasMore: remaining[0].count > 0
        };
        console.log(`[evidence-fingerprint] ${result.message}, ${result.remaining} remaining`);
        break;
      }

      case 'getHashStats': {
        const tables = await sql`
          SELECT table_name FROM information_schema.columns 
          WHERE column_name = 'sha256_hash' AND table_schema = 'public'
          ORDER BY table_name
        `;
        
        const stats = [];
        for (const t of tables) {
          try {
            const safeTable = sanitizeTableName(t.table_name);
            const countResult = await sql.unsafe(`
              SELECT 
                COUNT(*)::int as total,
                COUNT(sha256_hash)::int as hashed,
                (COUNT(*) - COUNT(sha256_hash))::int as unhashed
              FROM public."${safeTable}"
            `);
            const row = countResult[0];
            stats.push({
              table: t.table_name,
              total: row.total,
              hashed: row.hashed,
              unhashed: row.unhashed,
              coverage: row.total > 0 ? Math.round((row.hashed / row.total) * 100) : 100
            });
          } catch (e) {
            console.error(`[evidence-fingerprint] Error getting stats for ${t.table_name}:`, e);
          }
        }
        
        const totalRecords = stats.reduce((sum, s) => sum + s.total, 0);
        const totalHashed = stats.reduce((sum, s) => sum + s.hashed, 0);
        
        result = {
          tables: stats.sort((a, b) => b.unhashed - a.unhashed),
          totalTables: stats.length,
          totalRecords,
          totalHashed,
          overallCoverage: totalRecords > 0 ? Math.round((totalHashed / totalRecords) * 100) : 100
        };
        console.log(`[evidence-fingerprint] Stats: ${result.totalTables} tables, ${result.overallCoverage}% coverage`);
        break;
      }

      case 'verifyHash': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        
        if (columns.length === 0) {
          throw new Error(`Table ${safeTable} not found`);
        }
        
        // Get sample of hashed rows to verify
        const rows = await sql.unsafe(`
          SELECT * FROM public."${safeTable}" 
          WHERE sha256_hash IS NOT NULL 
          ORDER BY RANDOM()
          LIMIT 100
        `);
        
        let verified = 0;
        let failed = 0;
        const failures: { id: unknown; stored: string; computed: string }[] = [];
        
        for (const row of rows) {
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null || val === undefined) return 'NULL';
            if (val instanceof Date) return val.toISOString();
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');
          
          const computedHash = await computeSHA256(dataString);
          
          if (computedHash === row.sha256_hash) {
            verified++;
          } else {
            failed++;
            if (failures.length < 5) {
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
          sampleSize: rows.length,
          integrity: failed === 0 ? 'VERIFIED' : 'COMPROMISED',
          message: failed === 0 
            ? `All ${verified} sampled records verified - chain of custody intact`
            : `WARNING: ${failed} records failed verification - possible tampering detected`
        };
        console.log(`[evidence-fingerprint] Verify ${safeTable}: ${result.integrity}`);
        break;
      }

      case 'createAutoHashTrigger': {
        // Create a function and trigger to auto-hash new records
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        
        // Get columns for building the hash
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        
        if (columns.length === 0) {
          throw new Error(`Table ${safeTable} not found`);
        }
        
        const colList = columns.map(c => `COALESCE(NEW."${c.column_name}"::text, 'NULL')`).join(` || '|' || `);
        
        // Create trigger function
        await sql.unsafe(`
          CREATE OR REPLACE FUNCTION public.auto_hash_${safeTable}()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW.sha256_hash := encode(sha256((${colList})::bytea), 'hex');
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        
        // Drop existing trigger if any
        await sql.unsafe(`DROP TRIGGER IF EXISTS trg_auto_hash_${safeTable} ON public."${safeTable}"`);
        
        // Create trigger
        await sql.unsafe(`
          CREATE TRIGGER trg_auto_hash_${safeTable}
          BEFORE INSERT OR UPDATE ON public."${safeTable}"
          FOR EACH ROW
          WHEN (NEW.sha256_hash IS NULL)
          EXECUTE FUNCTION public.auto_hash_${safeTable}();
        `);
        
        result = {
          table: safeTable,
          message: `Auto-hash trigger created for ${safeTable}`,
          triggerName: `trg_auto_hash_${safeTable}`,
          functionName: `auto_hash_${safeTable}`
        };
        console.log(`[evidence-fingerprint] ${result.message}`);
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
    console.error('[evidence-fingerprint] Error:', error.message);
    if (sql) {
      try { await sql.end(); } catch (e) { /* ignore */ }
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

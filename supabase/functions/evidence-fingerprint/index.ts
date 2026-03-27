import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

async function computeSHA256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeTableName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '');
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
    const body = await req.json();
    const { action, table, batchSize = 500, offset = 0 } = body;
    console.log(`[evidence-fingerprint] Action: ${action}, Table: ${table || 'N/A'}`);

    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      max_lifetime: 60,
    });

    let result;

    switch (action) {
      case 'getTablesStatus': {
        // Use a single efficient query to get all tables + hash column status
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
          LIMIT 500
        `;
        console.log(`[evidence-fingerprint] Found ${result.length} tables`);
        break;
      }

      case 'addHashColumn': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        await sql.unsafe(`ALTER TABLE public."${safeTable}" ADD COLUMN IF NOT EXISTS sha256_hash TEXT`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_${safeTable}_sha256 ON public."${safeTable}"(sha256_hash)`);
        result = { message: `Added sha256_hash column to ${safeTable}`, created: true };
        break;
      }

      case 'addHashColumnToAll': {
        // Process in batches with offset for pagination
        const batchLimit = Math.min(batchSize || 50, 50); // Max 50 per call to avoid timeout
        const tablesWithoutHash = await sql`
          SELECT DISTINCT t.table_name
          FROM information_schema.tables t
          LEFT JOIN information_schema.columns c 
            ON c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'sha256_hash'
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.column_name IS NULL
          ORDER BY t.table_name
          LIMIT ${batchLimit} OFFSET ${offset}
        `;

        // Also get total remaining count
        const totalRemaining = await sql`
          SELECT COUNT(DISTINCT t.table_name)::int as count
          FROM information_schema.tables t
          LEFT JOIN information_schema.columns c 
            ON c.table_name = t.table_name AND c.table_schema = 'public' AND c.column_name = 'sha256_hash'
          WHERE t.table_schema = 'public'
            AND t.table_type = 'BASE TABLE'
            AND c.column_name IS NULL
        `;

        const added: string[] = [];
        const failed: { table: string; error: string }[] = [];

        for (const row of tablesWithoutHash) {
          try {
            const safeTable = sanitizeTableName(row.table_name);
            await sql.unsafe(`ALTER TABLE public."${safeTable}" ADD COLUMN IF NOT EXISTS sha256_hash TEXT`);
            // Skip index creation for speed - can be done later
            added.push(row.table_name);
          } catch (e) {
            failed.push({ table: row.table_name, error: (e as Error).message });
          }
        }

        const remaining = (totalRemaining[0]?.count || 0) - added.length;
        result = {
          added,
          failed,
          totalAdded: added.length,
          totalFailed: failed.length,
          remaining: Math.max(0, remaining),
          hasMore: remaining > 0,
          message: `Added sha256_hash column to ${added.length} tables (${Math.max(0, remaining)} remaining)`
        };
        console.log(`[evidence-fingerprint] ${result.message}`);
        break;
      }

      case 'computeHashes': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        const limit = Math.min(batchSize, 500);

        // Get columns
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} 
          AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        if (columns.length === 0) throw new Error(`Table ${safeTable} not found`);

        // Find primary key
        const pkResult = await sql`
          SELECT a.attname as pk_column
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = ${`public.${safeTable}`}::regclass AND i.indisprimary
          LIMIT 1
        `;

        const pkColumn = pkResult.length > 0 ? pkResult[0].pk_column : null;
        if (!pkColumn) {
          result = { table: safeTable, updated: 0, remaining: 0, message: `Skipped ${safeTable} - no primary key`, hasMore: false, skipped: true, reason: 'no_primary_key' };
          break;
        }

        // Get unhashed rows
        const rows = await sql.unsafe(`SELECT * FROM public."${safeTable}" WHERE sha256_hash IS NULL LIMIT ${limit}`);

        let updated = 0;
        for (const row of rows) {
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null || val === undefined) return 'NULL';
            if (val instanceof Date) return val.toISOString();
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');

          const hash = await computeSHA256(dataString);
          await sql.unsafe(`UPDATE public."${safeTable}" SET sha256_hash = $1 WHERE "${pkColumn}" = $2`, [hash, row[pkColumn]]);
          updated++;
        }

        const remaining = await sql.unsafe(`SELECT COUNT(*)::int as count FROM public."${safeTable}" WHERE sha256_hash IS NULL`);
        result = { table: safeTable, updated, remaining: remaining[0].count, message: `Computed ${updated} hashes for ${safeTable}`, hasMore: remaining[0].count > 0 };
        break;
      }

      case 'getHashStats': {
        // Use a single batch query instead of per-table queries to avoid timeout
        const stats = await sql.unsafe(`
          WITH hash_tables AS (
            SELECT DISTINCT table_name 
            FROM information_schema.columns 
            WHERE column_name = 'sha256_hash' AND table_schema = 'public'
          ),
          table_stats AS (
            SELECT 
              ht.table_name,
              COALESCE(pc.reltuples::bigint, 0) as estimated_total
            FROM hash_tables ht
            LEFT JOIN pg_class pc ON pc.relname = ht.table_name
            LEFT JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
          )
          SELECT 
            table_name as table,
            estimated_total as total,
            0 as hashed,
            estimated_total as unhashed,
            0 as coverage
          FROM table_stats
          ORDER BY estimated_total DESC
        `);

        // For top 20 tables by size, get actual counts (avoid timeout on 900+ tables)
        const topTables = stats.slice(0, 20);
        for (const t of topTables) {
          try {
            const safeTable = sanitizeTableName(t.table);
            const countResult = await sql.unsafe(`
              SELECT COUNT(*)::int as total, COUNT(sha256_hash)::int as hashed
              FROM public."${safeTable}"
            `);
            t.total = countResult[0].total;
            t.hashed = countResult[0].hashed;
            t.unhashed = t.total - t.hashed;
            t.coverage = t.total > 0 ? Math.round((t.hashed / t.total) * 100) : 100;
          } catch { /* skip problematic tables */ }
        }

        const totalTables = stats.length;
        const totalRecords = stats.reduce((sum: number, s: any) => sum + Number(s.total || 0), 0);
        const totalHashed = stats.reduce((sum: number, s: any) => sum + Number(s.hashed || 0), 0);

        result = {
          tables: stats.sort((a: any, b: any) => (b.unhashed || 0) - (a.unhashed || 0)),
          totalTables,
          totalRecords,
          totalHashed,
          overallCoverage: totalRecords > 0 ? Math.round((totalHashed / totalRecords) * 100) : 0
        };
        console.log(`[evidence-fingerprint] Stats: ${totalTables} tables, ${result.overallCoverage}% coverage`);
        break;
      }

      case 'computeHashesBulk': {
        // Batch hash multiple tables in one call
        const tablesToHash = body.tables || [];
        const perTableLimit = Math.min(body.perTableLimit || 200, 500);
        const results: any[] = [];

        for (const tableName of tablesToHash.slice(0, 5)) { // Max 5 tables per call
          const safeTable = sanitizeTableName(tableName);
          try {
            const pkResult = await sql`
              SELECT a.attname as pk_column
              FROM pg_index i
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
              WHERE i.indrelid = ${`public.${safeTable}`}::regclass AND i.indisprimary
              LIMIT 1
            `;
            if (pkResult.length === 0) { results.push({ table: safeTable, skipped: true, reason: 'no_pk' }); continue; }
            const pkColumn = pkResult[0].pk_column;

            const columns = await sql`
              SELECT column_name FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = ${safeTable} AND column_name != 'sha256_hash'
              ORDER BY ordinal_position
            `;

            const rows = await sql.unsafe(`SELECT * FROM public."${safeTable}" WHERE sha256_hash IS NULL LIMIT ${perTableLimit}`);
            let updated = 0;
            for (const row of rows) {
              const dataString = columns.map(c => {
                const val = row[c.column_name];
                if (val === null || val === undefined) return 'NULL';
                if (val instanceof Date) return val.toISOString();
                if (typeof val === 'object') return JSON.stringify(val);
                return String(val);
              }).join('|');
              const hash = await computeSHA256(dataString);
              await sql.unsafe(`UPDATE public."${safeTable}" SET sha256_hash = $1 WHERE "${pkColumn}" = $2`, [hash, row[pkColumn]]);
              updated++;
            }
            results.push({ table: safeTable, updated, total: rows.length });
          } catch (e) {
            results.push({ table: safeTable, error: (e as Error).message });
          }
        }

        result = { results, message: `Processed ${results.length} tables` };
        break;
      }

      case 'verifyHash': {
        if (!table) throw new Error('Table name required');
        const safeTable = sanitizeTableName(table);
        const columns = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = 'public' AND table_name = ${safeTable} AND column_name != 'sha256_hash'
          ORDER BY ordinal_position
        `;
        if (columns.length === 0) throw new Error(`Table ${safeTable} not found`);

        const rows = await sql.unsafe(`SELECT * FROM public."${safeTable}" WHERE sha256_hash IS NOT NULL ORDER BY RANDOM() LIMIT 100`);
        let verified = 0, failed = 0;
        const failures: any[] = [];

        for (const row of rows) {
          const dataString = columns.map(c => {
            const val = row[c.column_name];
            if (val === null || val === undefined) return 'NULL';
            if (val instanceof Date) return val.toISOString();
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          }).join('|');
          const computedHash = await computeSHA256(dataString);
          if (computedHash === row.sha256_hash) { verified++; } else {
            failed++;
            if (failures.length < 5) failures.push({ id: row.id || row[columns[0].column_name], stored: row.sha256_hash, computed: computedHash });
          }
        }

        result = { table: safeTable, verified, failed, failures, sampleSize: rows.length, integrity: failed === 0 ? 'VERIFIED' : 'COMPROMISED' };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();
    return new Response(JSON.stringify({ data: result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('[evidence-fingerprint] Error:', error.message);
    if (sql) { try { await sql.end(); } catch { /* */ } }
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

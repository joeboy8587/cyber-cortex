import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

let _pool: any = null;
async function getNeonPool(neonUrl: string) {
  if (!_pool) {
    const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    _pool = new Pool(neonUrl, 2, true);
  }
  return _pool;
}

async function neonQuery(neonUrl: string, sql: string, params: unknown[] = []) {
  const pool = await getNeonPool(neonUrl);
  const conn = await pool.connect();
  try {
    const result = await conn.queryObject(sql, params);
    return result.rows;
  } finally {
    conn.release();
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status >= 400 ? data : { data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const neonUrl = Deno.env.get("NEON_DATABASE_URL")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { action, table, batchSize = 500 } = body;

    switch (action) {
      case "anchor":
        return await handleAnchor(supabase, neonUrl, table, batchSize);
      case "anchorBatch":
        return await handleAnchorBatch(supabase, neonUrl, batchSize);
      case "anchorDeep":
        return await handleAnchorDeep(supabase, neonUrl, body);
      case "verify":
        return await handleVerify(supabase, batchSize);
      case "stats":
        return await handleStats(supabase);
      case "neonCoverage":
        return await handleNeonCoverage(supabase, neonUrl);
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("merkle-anchor error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────

async function getLastChainHash(supabase: any): Promise<string> {
  const { data, error } = await supabase
    .from("evidence_merkle_ledger")
    .select("chain_hash")
    .order("sequence_number", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return "GENESIS";
  return data.chain_hash;
}

// Get existing source_ids for a table (paginated past 1000 limit)
async function getExistingIds(supabase: any, tableName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from("evidence_merkle_ledger")
      .select("source_id")
      .eq("source_table", tableName)
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    data.forEach((e: any) => ids.add(e.source_id));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

// Get counts per table from ledger (paginated)
async function getLedgerCountsByTable(supabase: any): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from("evidence_merkle_ledger")
      .select("source_table")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    data.forEach((r: any) => {
      counts[r.source_table] = (counts[r.source_table] || 0) + 1;
    });
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return counts;
}

async function insertLedgerBatch(supabase: any, entries: any[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const { error } = await supabase.from("evidence_merkle_ledger").insert(batch);
    if (error) throw new Error(`Ledger insert failed: ${error.message}`);
    inserted += batch.length;
  }
  return inserted;
}

// ─── ANCHOR SINGLE TABLE ─────────────────────────────────────────────
async function handleAnchor(supabase: any, neonUrl: string, table: string, batchSize: number) {
  if (!table) return json({ error: "table parameter required" }, 400);

  const existingIds = await getExistingIds(supabase, table);

  const cols = await neonQuery(neonUrl,
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' AND column_name = 'sha256_hash'`,
    [table]
  );
  const hasHash = (cols as any[]).length > 0;

  let rows: any[];
  if (hasHash) {
    rows = await neonQuery(neonUrl,
      `SELECT id::text AS id, sha256_hash FROM ${table} WHERE sha256_hash IS NOT NULL LIMIT $1`,
      [batchSize + existingIds.size]
    );
  } else {
    rows = await neonQuery(neonUrl,
      `SELECT id::text AS id, row_to_json(t.*)::text AS row_json FROM ${table} t LIMIT $1`,
      [batchSize + existingIds.size]
    );
    for (const row of rows) {
      row.sha256_hash = await sha256(row.row_json);
      delete row.row_json;
    }
  }

  const newRows = rows.filter((r: any) => !existingIds.has(r.id));
  const toAnchor = newRows.slice(0, batchSize);

  if (toAnchor.length === 0) {
    return json({ anchored: 0, table, message: `All records in ${table} already anchored` });
  }

  let previousHash = await getLastChainHash(supabase);
  const batchId = crypto.randomUUID();
  const entries = [];

  for (const row of toAnchor) {
    const chainHash = await sha256(row.sha256_hash + previousHash);
    entries.push({
      source_table: table,
      source_id: row.id,
      record_hash: row.sha256_hash,
      previous_chain_hash: previousHash,
      chain_hash: chainHash,
      batch_id: batchId,
    });
    previousHash = chainHash;
  }

  const totalInserted = await insertLedgerBatch(supabase, entries);
  return json({ anchored: totalInserted, table, batchId, lastChainHash: previousHash });
}

// ─── ANCHOR BATCH (hashed tables only) ───────────────────────────────
async function handleAnchorBatch(supabase: any, neonUrl: string, batchSize: number) {
  const tables = await neonQuery(neonUrl,
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'sha256_hash' AND table_schema = 'public'
     ORDER BY table_name`
  );

  const results = [];
  let totalAnchored = 0;
  const startTime = Date.now();

  for (const t of tables) {
    if (Date.now() - startTime > 45000) {
      results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" });
      break;
    }

    const tableName = (t as any).table_name;
    try {
      const existingIds = await getExistingIds(supabase, tableName);
      const allRows = await neonQuery(neonUrl,
        `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT $1`,
        [batchSize]
      );

      const newRows = (allRows as any[]).filter((r) => !existingIds.has(r.id));
      if (newRows.length === 0) {
        results.push({ table: tableName, anchored: 0, status: "up-to-date" });
        continue;
      }

      const toAnchor = newRows.slice(0, batchSize);
      let previousHash = await getLastChainHash(supabase);
      const batchId = crypto.randomUUID();
      const entries = [];

      for (const row of toAnchor) {
        const chainHash = await sha256(row.sha256_hash + previousHash);
        entries.push({
          source_table: tableName,
          source_id: row.id,
          record_hash: row.sha256_hash,
          previous_chain_hash: previousHash,
          chain_hash: chainHash,
          batch_id: batchId,
        });
        previousHash = chainHash;
      }

      await insertLedgerBatch(supabase, entries);
      totalAnchored += entries.length;
      results.push({ table: tableName, anchored: entries.length, status: "anchored" });
    } catch (err) {
      results.push({ table: tableName, anchored: 0, status: "error", error: err.message });
    }
  }

  return json({ totalAnchored, tables: results });
}

// ─── DEEP ANCHOR (all tables, background processing) ────────────────
async function handleAnchorDeep(supabase: any, neonUrl: string, body: any) {
  const { batchSize = 500, tableFilter } = body;

  // Get ALL public tables
  const allTables = await neonQuery(neonUrl,
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );

  const results: any[] = [];
  let totalAnchored = 0;
  const startTime = Date.now();

  for (const t of allTables) {
    // 45s safety for edge function wall-clock
    if (Date.now() - startTime > 45000) {
      results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" });
      break;
    }

    const tableName = (t as any).tablename;
    if (tableFilter && tableName !== tableFilter) continue;
    if (tableName.startsWith('pg_') || tableName.startsWith('_')) continue;

    try {
      // Check for id column
      const idCheck = await neonQuery(neonUrl,
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id' AND table_schema = 'public'`,
        [tableName]
      );
      if ((idCheck as any[]).length === 0) continue;

      const existingIds = await getExistingIds(supabase, tableName);

      // Check for sha256_hash
      const hashCol = await neonQuery(neonUrl,
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = 'sha256_hash' AND table_schema = 'public'`,
        [tableName]
      );
      const hasHash = (hashCol as any[]).length > 0;

      // Fetch rows — NO cap at 100, use full batchSize
      let rows: any[];
      if (hasHash) {
        rows = await neonQuery(neonUrl,
          `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT $1`,
          [batchSize + existingIds.size]
        );
      } else {
        rows = await neonQuery(neonUrl,
          `SELECT id::text AS id, md5(row_to_json(t.*)::text) AS sha256_hash FROM ${tableName} t LIMIT $1`,
          [batchSize + existingIds.size]
        );
      }

      const newRows = rows.filter((r: any) => !existingIds.has(r.id));
      const toAnchor = newRows.slice(0, batchSize);

      if (toAnchor.length === 0) {
        results.push({ table: tableName, anchored: 0, status: "up-to-date", total: existingIds.size });
        continue;
      }

      let previousHash = await getLastChainHash(supabase);
      const batchId = crypto.randomUUID();
      const entries = [];

      for (const row of toAnchor) {
        const recordHash = hasHash ? row.sha256_hash : await sha256(row.sha256_hash);
        const chainHash = await sha256(recordHash + previousHash);
        entries.push({
          source_table: tableName,
          source_id: row.id,
          record_hash: recordHash,
          previous_chain_hash: previousHash,
          chain_hash: chainHash,
          batch_id: batchId,
        });
        previousHash = chainHash;
      }

      await insertLedgerBatch(supabase, entries);
      totalAnchored += entries.length;
      results.push({ table: tableName, anchored: entries.length, status: "anchored", remaining: newRows.length - toAnchor.length });
    } catch (err) {
      results.push({ table: tableName, anchored: 0, status: "error", error: err.message });
    }
  }

  return json({ totalAnchored, tablesProcessed: results.length, tables: results });
}

// ─── VERIFY ──────────────────────────────────────────────────────────
async function handleVerify(supabase: any, limit: number) {
  const { data: entries, error } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, record_hash, previous_chain_hash, chain_hash, source_table, source_id")
    .order("sequence_number", { ascending: true })
    .limit(limit || 1000);

  if (error) throw new Error(`Failed to read ledger: ${error.message}`);
  if (!entries || entries.length === 0) {
    return json({ verified: 0, failed: 0, total: 0, integrity: "EMPTY", failures: [], message: "No entries in ledger" });
  }

  const failures: any[] = [];
  let verified = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedHash = await sha256(entry.record_hash + entry.previous_chain_hash);

    if (expectedHash !== entry.chain_hash) {
      failures.push({
        sequence_number: entry.sequence_number,
        source_table: entry.source_table,
        source_id: entry.source_id,
        expected: expectedHash,
        actual: entry.chain_hash,
      });
    } else {
      verified++;
    }

    if (i > 0 && entry.previous_chain_hash !== entries[i - 1].chain_hash) {
      failures.push({
        sequence_number: entry.sequence_number,
        source_table: entry.source_table,
        source_id: entry.source_id,
        issue: "Chain link broken",
      });
    }
  }

  const integrity = failures.length === 0 ? "VERIFIED" : "COMPROMISED";

  return json({
    verified,
    failed: failures.length,
    total: entries.length,
    integrity,
    failures: failures.slice(0, 10),
    message: integrity === "VERIFIED"
      ? `All ${verified} chain entries verified — no tampering detected`
      : `ALERT: ${failures.length} chain integrity failures detected`,
  });
}

// ─── STATS ───────────────────────────────────────────────────────────
async function handleStats(supabase: any) {
  const { count: totalEntries } = await supabase
    .from("evidence_merkle_ledger")
    .select("*", { count: "exact", head: true });

  // Paginate to get all table counts
  const tableCounts = await getLedgerCountsByTable(supabase);

  const { data: lastEntry } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, chain_hash, anchored_at, source_table")
    .order("sequence_number", { ascending: false })
    .limit(1)
    .single();

  const { data: firstEntry } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, anchored_at")
    .order("sequence_number", { ascending: true })
    .limit(1)
    .single();

  return json({
    totalEntries: totalEntries || 0,
    uniqueTables: Object.keys(tableCounts).length,
    tableCounts,
    lastEntry: lastEntry || null,
    firstEntry: firstEntry || null,
    chainLength: totalEntries || 0,
  });
}

// ─── NEON COVERAGE ───────────────────────────────────────────────────
async function handleNeonCoverage(supabase: any, neonUrl: string) {
  // Get all public tables with row counts
  const tables = await neonQuery(neonUrl,
    `SELECT relname AS table_name, n_live_tup AS row_count
     FROM pg_stat_user_tables
     WHERE schemaname = 'public'
     ORDER BY n_live_tup DESC`
  );

  // Paginate ALL ledger entries to get accurate counts
  const anchoredCounts = await getLedgerCountsByTable(supabase);

  // Check which tables have sha256_hash and id columns
  const hashTables = await neonQuery(neonUrl,
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'sha256_hash' AND table_schema = 'public'`
  );
  const hashSet = new Set((hashTables as any[]).map((t) => t.table_name));

  const idTables = await neonQuery(neonUrl,
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'id' AND table_schema = 'public'`
  );
  const idSet = new Set((idTables as any[]).map((t) => t.table_name));

  const coverage = (tables as any[]).map((t) => ({
    table: t.table_name,
    totalRows: Number(t.row_count),
    anchored: anchoredCounts[t.table_name] || 0,
    hasSha256: hashSet.has(t.table_name),
    hasId: idSet.has(t.table_name),
    coverage: t.row_count > 0
      ? Math.round(((anchoredCounts[t.table_name] || 0) / Number(t.row_count)) * 100)
      : 0,
  }));

  const totalRows = coverage.reduce((sum, t) => sum + t.totalRows, 0);
  const totalAnchored = coverage.reduce((sum, t) => sum + t.anchored, 0);
  const anchorableTables = coverage.filter((t) => t.hasId).length;

  return json({
    totalNeonTables: coverage.length,
    anchorableTables,
    totalRows,
    totalAnchored,
    overallCoverage: totalRows > 0 ? Math.round((totalAnchored / totalRows) * 100) : 0,
    tables: coverage.slice(0, 50),
  });
}

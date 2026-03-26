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

async function neonQuery(neonUrl: string, sql: string, params: unknown[] = []) {
  const url = new URL(neonUrl);
  const apiUrl = `https://${url.hostname}/sql`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": neonUrl,
    },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Neon query failed (${response.status}): ${text}`);
  }
  const result = await response.json();
  if (result.rows) return result.rows;
  if (Array.isArray(result) && result.length > 0 && result[0].rows) return result[0].rows;
  return result;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status >= 400 ? data : { data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const neonUrl = Deno.env.get("NEON_DATABASE_URL")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { action, table, batchSize = 500 } = body;

    console.log(`merkle-anchor: action=${action}`);

    switch (action) {
      case "anchor": return await handleAnchor(supabase, neonUrl, table, batchSize);
      case "anchorBatch": return await handleAnchorBatch(supabase, neonUrl, batchSize);
      case "anchorDeep": return await handleAnchorDeep(supabase, neonUrl, body);
      case "verify": return await handleVerify(supabase, batchSize);
      case "stats": return await handleStats(supabase);
      case "neonCoverage": return await handleNeonCoverage(supabase, neonUrl);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("merkle-anchor error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────

async function getLastChainHash(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("evidence_merkle_ledger")
    .select("chain_hash")
    .order("sequence_number", { ascending: false })
    .limit(1)
    .single();
  if (!data) return "GENESIS";
  return data.chain_hash;
}

async function getExistingIds(supabase: any, tableName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("evidence_merkle_ledger")
      .select("source_id")
      .eq("source_table", tableName)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    data.forEach((e: any) => ids.add(e.source_id));
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function getLedgerCountsByTable(supabase: any): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("evidence_merkle_ledger")
      .select("source_table")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    data.forEach((r: any) => { counts[r.source_table] = (counts[r.source_table] || 0) + 1; });
    if (data.length < 1000) break;
    from += 1000;
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

// Pre-fetch all schema info in one query to avoid per-table lookups
async function getTableSchema(neonUrl: string): Promise<Map<string, { hasId: boolean; hasSha256: boolean }>> {
  const cols = await neonQuery(neonUrl,
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name IN ('id', 'sha256_hash')
     ORDER BY table_name`
  );
  const schema = new Map<string, { hasId: boolean; hasSha256: boolean }>();
  for (const c of cols as any[]) {
    if (!schema.has(c.table_name)) schema.set(c.table_name, { hasId: false, hasSha256: false });
    const entry = schema.get(c.table_name)!;
    if (c.column_name === 'id') entry.hasId = true;
    if (c.column_name === 'sha256_hash') entry.hasSha256 = true;
  }
  return schema;
}

// ─── ANCHOR SINGLE TABLE ─────────────────────────────────────────────
async function handleAnchor(supabase: any, neonUrl: string, table: string, batchSize: number) {
  if (!table) return json({ error: "table parameter required" }, 400);
  const existingIds = await getExistingIds(supabase, table);
  const schema = await getTableSchema(neonUrl);
  const info = schema.get(table);
  const hasHash = info?.hasSha256 ?? false;

  let rows: any[];
  if (hasHash) {
    rows = await neonQuery(neonUrl,
      `SELECT id::text AS id, sha256_hash FROM ${table} WHERE sha256_hash IS NOT NULL LIMIT ${batchSize + existingIds.size}`
    );
  } else {
    rows = await neonQuery(neonUrl,
      `SELECT id::text AS id, row_to_json(t.*)::text AS row_json FROM ${table} t LIMIT ${batchSize + existingIds.size}`
    );
    for (const row of rows) {
      row.sha256_hash = await sha256(row.row_json);
      delete row.row_json;
    }
  }

  const newRows = rows.filter((r: any) => !existingIds.has(r.id));
  const toAnchor = newRows.slice(0, batchSize);
  if (toAnchor.length === 0) return json({ anchored: 0, table, message: `All records already anchored` });

  let previousHash = await getLastChainHash(supabase);
  const batchId = crypto.randomUUID();
  const entries = [];
  for (const row of toAnchor) {
    const chainHash = await sha256(row.sha256_hash + previousHash);
    entries.push({ source_table: table, source_id: row.id, record_hash: row.sha256_hash, previous_chain_hash: previousHash, chain_hash: chainHash, batch_id: batchId });
    previousHash = chainHash;
  }
  const totalInserted = await insertLedgerBatch(supabase, entries);
  return json({ anchored: totalInserted, table, batchId, lastChainHash: previousHash });
}

// ─── ANCHOR BATCH (hashed tables only) ───────────────────────────────
async function handleAnchorBatch(supabase: any, neonUrl: string, batchSize: number) {
  const schema = await getTableSchema(neonUrl);
  const hashTables = [...schema.entries()].filter(([, v]) => v.hasSha256 && v.hasId).map(([k]) => k).sort();

  const results = [];
  let totalAnchored = 0;
  const startTime = Date.now();

  for (const tableName of hashTables) {
    if (Date.now() - startTime > 45000) { results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" }); break; }
    try {
      const existingIds = await getExistingIds(supabase, tableName);
      const allRows = await neonQuery(neonUrl, `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT ${batchSize}`);
      const newRows = (allRows as any[]).filter((r) => !existingIds.has(r.id));
      if (newRows.length === 0) { results.push({ table: tableName, anchored: 0, status: "up-to-date" }); continue; }

      const toAnchor = newRows.slice(0, batchSize);
      let previousHash = await getLastChainHash(supabase);
      const batchId = crypto.randomUUID();
      const entries = [];
      for (const row of toAnchor) {
        const chainHash = await sha256(row.sha256_hash + previousHash);
        entries.push({ source_table: tableName, source_id: row.id, record_hash: row.sha256_hash, previous_chain_hash: previousHash, chain_hash: chainHash, batch_id: batchId });
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

// ─── DEEP ANCHOR — optimized with pre-fetched schema ────────────────
async function handleAnchorDeep(supabase: any, neonUrl: string, body: any) {
  const { batchSize = 200, tableFilter } = body;

  // Pre-fetch all schema info in ONE query
  const schema = await getTableSchema(neonUrl);
  
  // Get all public tables with row counts
  const allTables = await neonQuery(neonUrl,
    `SELECT relname AS tablename, n_live_tup AS row_count 
     FROM pg_stat_user_tables WHERE schemaname = 'public' 
     ORDER BY n_live_tup DESC`
  );

  console.log(`anchorDeep: ${(allTables as any[]).length} tables, filter=${tableFilter || 'none'}, batchSize=${batchSize}`);

  const results: any[] = [];
  let totalAnchored = 0;
  const startTime = Date.now();
  let tablesProcessed = 0;

  for (const t of allTables) {
    if (Date.now() - startTime > 40000) {
      results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" });
      break;
    }

    const tableName = (t as any).tablename;
    if (tableFilter && tableName !== tableFilter) continue;
    if (tableName.startsWith('pg_') || tableName.startsWith('_')) continue;

    const info = schema.get(tableName);
    if (!info?.hasId) continue; // Skip tables without id column

    tablesProcessed++;

    try {
      const existingIds = await getExistingIds(supabase, tableName);
      const hasHash = info.hasSha256;

      // Skip tables that likely have too many existing records relative to batch
      const rowCount = Number((t as any).row_count || 0);
      if (existingIds.size >= rowCount && rowCount > 0) {
        results.push({ table: tableName, anchored: 0, status: "up-to-date", total: existingIds.size });
        continue;
      }

      let rows: any[];
      const fetchLimit = Math.min(batchSize + existingIds.size, batchSize + 1000); // cap fetch
      if (hasHash) {
        rows = await neonQuery(neonUrl,
          `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT ${fetchLimit}`
        );
      } else {
        rows = await neonQuery(neonUrl,
          `SELECT id::text AS id, md5(row_to_json(t.*)::text) AS sha256_hash FROM ${tableName} t LIMIT ${fetchLimit}`
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
        entries.push({ source_table: tableName, source_id: row.id, record_hash: recordHash, previous_chain_hash: previousHash, chain_hash: chainHash, batch_id: batchId });
        previousHash = chainHash;
      }

      await insertLedgerBatch(supabase, entries);
      totalAnchored += entries.length;
      results.push({ table: tableName, anchored: entries.length, status: "anchored", remaining: newRows.length - toAnchor.length });
      console.log(`anchored: ${tableName} +${entries.length}`);
    } catch (err) {
      console.error(`error: ${tableName}: ${err.message}`);
      results.push({ table: tableName, anchored: 0, status: "error", error: err.message });
    }
  }

  return json({ totalAnchored, tablesProcessed, tables: results });
}

// ─── VERIFY ──────────────────────────────────────────────────────────
async function handleVerify(supabase: any, limit: number) {
  const { data: entries, error } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, record_hash, previous_chain_hash, chain_hash, source_table, source_id")
    .order("sequence_number", { ascending: true })
    .limit(limit || 1000);

  if (error) throw new Error(`Failed to read ledger: ${error.message}`);
  if (!entries || entries.length === 0) return json({ verified: 0, failed: 0, total: 0, integrity: "EMPTY", failures: [], message: "No entries" });

  const failures: any[] = [];
  let verified = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedHash = await sha256(entry.record_hash + entry.previous_chain_hash);
    if (expectedHash !== entry.chain_hash) {
      failures.push({ sequence_number: entry.sequence_number, source_table: entry.source_table, source_id: entry.source_id, expected: expectedHash, actual: entry.chain_hash });
    } else { verified++; }
    if (i > 0 && entry.previous_chain_hash !== entries[i - 1].chain_hash) {
      failures.push({ sequence_number: entry.sequence_number, source_table: entry.source_table, source_id: entry.source_id, issue: "Chain link broken" });
    }
  }
  const integrity = failures.length === 0 ? "VERIFIED" : "COMPROMISED";
  return json({ verified, failed: failures.length, total: entries.length, integrity, failures: failures.slice(0, 10),
    message: integrity === "VERIFIED" ? `All ${verified} entries verified — no tampering` : `ALERT: ${failures.length} integrity failures` });
}

// ─── STATS ───────────────────────────────────────────────────────────
async function handleStats(supabase: any) {
  const { count: totalEntries } = await supabase.from("evidence_merkle_ledger").select("*", { count: "exact", head: true });
  const tableCounts = await getLedgerCountsByTable(supabase);
  const { data: lastEntry } = await supabase.from("evidence_merkle_ledger").select("sequence_number, chain_hash, anchored_at, source_table").order("sequence_number", { ascending: false }).limit(1).single();
  const { data: firstEntry } = await supabase.from("evidence_merkle_ledger").select("sequence_number, anchored_at").order("sequence_number", { ascending: true }).limit(1).single();
  return json({ totalEntries: totalEntries || 0, uniqueTables: Object.keys(tableCounts).length, tableCounts, lastEntry, firstEntry, chainLength: totalEntries || 0 });
}

// ─── NEON COVERAGE ───────────────────────────────────────────────────
async function handleNeonCoverage(supabase: any, neonUrl: string) {
  const tables = await neonQuery(neonUrl,
    `SELECT relname AS table_name, n_live_tup AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`
  );
  const anchoredCounts = await getLedgerCountsByTable(supabase);
  const schema = await getTableSchema(neonUrl);

  const coverage = (tables as any[]).map((t) => {
    const info = schema.get(t.table_name);
    return {
      table: t.table_name,
      totalRows: Number(t.row_count),
      anchored: anchoredCounts[t.table_name] || 0,
      hasSha256: info?.hasSha256 ?? false,
      hasId: info?.hasId ?? false,
      coverage: t.row_count > 0 ? Math.round(((anchoredCounts[t.table_name] || 0) / Number(t.row_count)) * 100) : 0,
    };
  });

  const totalRows = coverage.reduce((sum, t) => sum + t.totalRows, 0);
  const totalAnchored = coverage.reduce((sum, t) => sum + t.anchored, 0);
  const anchorableTables = coverage.filter((t) => t.hasId).length;
  const overallCoverage = totalRows > 0 ? Number(((totalAnchored / totalRows) * 100).toFixed(4)) : 0;

  return json({ totalNeonTables: coverage.length, anchorableTables, totalRows, totalAnchored, overallCoverage, tables: coverage.slice(0, 50) });
}

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
  const response = await fetch(`https://${url.hostname}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": neonUrl },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!response.ok) throw new Error(`Neon query failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  if (result.rows) return result.rows;
  if (Array.isArray(result) && result[0]?.rows) return result[0].rows;
  return result;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status >= 400 ? data : { data }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const neonUrl = Deno.env.get("NEON_DATABASE_URL")!;
    const body = await req.json();
    const { action, table, batchSize = 500 } = body;
    console.log(`merkle: ${action}`);
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
    console.error("merkle error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────

async function getLastChainHash(supabase: any): Promise<string> {
  const { data } = await supabase.from("evidence_merkle_ledger").select("chain_hash").order("sequence_number", { ascending: false }).limit(1).single();
  return data?.chain_hash || "GENESIS";
}

// Fetch ALL existing source_table+source_id pairs from ledger in one pass
async function getAllExistingIds(supabase: any): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  let from = 0;
  while (true) {
    const { data } = await supabase.from("evidence_merkle_ledger").select("source_table, source_id").range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (!map.has(r.source_table)) map.set(r.source_table, new Set());
      map.get(r.source_table)!.add(r.source_id);
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return map;
}

async function getExistingIdsForTable(supabase: any, tableName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  while (true) {
    const { data } = await supabase.from("evidence_merkle_ledger").select("source_id").eq("source_table", tableName).range(from, from + 999);
    if (!data || data.length === 0) break;
    data.forEach((e: any) => ids.add(e.source_id));
    if (data.length < 1000) break;
    from += 1000;
  }
  return ids;
}

async function getLedgerCounts(supabase: any): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let from = 0;
  while (true) {
    const { data } = await supabase.from("evidence_merkle_ledger").select("source_table").range(from, from + 999);
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
    const { error } = await supabase.from("evidence_merkle_ledger").insert(entries.slice(i, i + 100));
    if (error) throw new Error(`Insert failed: ${error.message}`);
    inserted += entries.slice(i, i + 100).length;
  }
  return inserted;
}

async function getTableSchema(neonUrl: string): Promise<Map<string, { hasId: boolean; hasSha256: boolean }>> {
  const cols = await neonQuery(neonUrl,
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('id', 'sha256_hash')`
  );
  const schema = new Map<string, { hasId: boolean; hasSha256: boolean }>();
  for (const c of cols as any[]) {
    if (!schema.has(c.table_name)) schema.set(c.table_name, { hasId: false, hasSha256: false });
    const e = schema.get(c.table_name)!;
    if (c.column_name === 'id') e.hasId = true;
    if (c.column_name === 'sha256_hash') e.hasSha256 = true;
  }
  return schema;
}

// ─── ANCHOR SINGLE TABLE ─────────────────────────────────────────────
async function handleAnchor(supabase: any, neonUrl: string, table: string, batchSize: number) {
  if (!table) return json({ error: "table required" }, 400);
  const existingIds = await getExistingIdsForTable(supabase, table);
  const schema = await getTableSchema(neonUrl);
  const hasHash = schema.get(table)?.hasSha256 ?? false;

  let rows: any[];
  if (hasHash) {
    rows = await neonQuery(neonUrl, `SELECT id::text AS id, sha256_hash FROM ${table} WHERE sha256_hash IS NOT NULL LIMIT ${batchSize + existingIds.size}`);
  } else {
    rows = await neonQuery(neonUrl, `SELECT id::text AS id, row_to_json(t.*)::text AS row_json FROM ${table} t LIMIT ${batchSize + existingIds.size}`);
    for (const row of rows) { row.sha256_hash = await sha256(row.row_json); delete row.row_json; }
  }

  const toAnchor = rows.filter((r: any) => !existingIds.has(r.id)).slice(0, batchSize);
  if (toAnchor.length === 0) return json({ anchored: 0, table, message: "Already anchored" });

  let prev = await getLastChainHash(supabase);
  const batchId = crypto.randomUUID();
  const entries = [];
  for (const row of toAnchor) {
    const ch = await sha256(row.sha256_hash + prev);
    entries.push({ source_table: table, source_id: row.id, record_hash: row.sha256_hash, previous_chain_hash: prev, chain_hash: ch, batch_id: batchId });
    prev = ch;
  }
  return json({ anchored: await insertLedgerBatch(supabase, entries), table, batchId, lastChainHash: prev });
}

// ─── ANCHOR BATCH (hashed tables only) ───────────────────────────────
async function handleAnchorBatch(supabase: any, neonUrl: string, batchSize: number) {
  const schema = await getTableSchema(neonUrl);
  const existingMap = await getAllExistingIds(supabase);
  const hashTables = [...schema.entries()].filter(([, v]) => v.hasSha256 && v.hasId).map(([k]) => k).sort();

  const results = [];
  let totalAnchored = 0;
  const t0 = Date.now();

  for (const tableName of hashTables) {
    if (Date.now() - t0 > 40000) { results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" }); break; }
    try {
      const existing = existingMap.get(tableName) || new Set();
      const allRows = await neonQuery(neonUrl, `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT ${batchSize}`);
      const toAnchor = (allRows as any[]).filter(r => !existing.has(r.id)).slice(0, batchSize);
      if (toAnchor.length === 0) { results.push({ table: tableName, anchored: 0, status: "up-to-date" }); continue; }

      let prev = await getLastChainHash(supabase);
      const batchId = crypto.randomUUID();
      const entries = [];
      for (const row of toAnchor) {
        const ch = await sha256(row.sha256_hash + prev);
        entries.push({ source_table: tableName, source_id: row.id, record_hash: row.sha256_hash, previous_chain_hash: prev, chain_hash: ch, batch_id: batchId });
        prev = ch;
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

// ─── DEEP ANCHOR — single pass, pre-fetched schema + IDs ────────────
async function handleAnchorDeep(supabase: any, neonUrl: string, body: any) {
  const { batchSize = 200, tableFilter, maxTables = 20 } = body;

  // Two parallel pre-fetches: schema + existing IDs
  const [schema, existingMap, allTables] = await Promise.all([
    getTableSchema(neonUrl),
    getAllExistingIds(supabase),
    neonQuery(neonUrl, `SELECT relname AS tablename, n_live_tup AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`),
  ]);

  console.log(`anchorDeep: ${(allTables as any[]).length} tables, filter=${tableFilter || 'none'}`);

  const results: any[] = [];
  let totalAnchored = 0;
  const t0 = Date.now();
  let tablesAnchored = 0;

  for (const t of allTables as any[]) {
    if (Date.now() - t0 > 40000) { results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" }); break; }
    if (tablesAnchored >= maxTables) { results.push({ table: "MAX_TABLES", anchored: 0, status: "limit_reached" }); break; }

    const tableName = t.tablename;
    if (tableFilter && tableName !== tableFilter) continue;
    if (tableName.startsWith('pg_') || tableName.startsWith('_')) continue;

    const info = schema.get(tableName);
    if (!info?.hasId) continue;

    const existing = existingMap.get(tableName) || new Set();
    const rowCount = Number(t.row_count || 0);
    
    // Skip if fully anchored (approximate via pg_stat)
    if (existing.size >= rowCount && rowCount > 0) {
      results.push({ table: tableName, anchored: 0, status: "up-to-date", total: existing.size });
      continue;
    }

    try {
      const fetchLimit = Math.min(batchSize + existing.size, 2000);
      let rows: any[];
      if (info.hasSha256) {
        rows = await neonQuery(neonUrl, `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT ${fetchLimit}`);
      } else {
        rows = await neonQuery(neonUrl, `SELECT id::text AS id, md5(row_to_json(t.*)::text) AS sha256_hash FROM ${tableName} t LIMIT ${fetchLimit}`);
      }

      const toAnchor = rows.filter((r: any) => !existing.has(r.id)).slice(0, batchSize);
      if (toAnchor.length === 0) { results.push({ table: tableName, anchored: 0, status: "up-to-date", total: existing.size }); continue; }

      let prev = await getLastChainHash(supabase);
      const batchId = crypto.randomUUID();
      const entries = [];
      for (const row of toAnchor) {
        const recordHash = info.hasSha256 ? row.sha256_hash : await sha256(row.sha256_hash);
        const ch = await sha256(recordHash + prev);
        entries.push({ source_table: tableName, source_id: row.id, record_hash: recordHash, previous_chain_hash: prev, chain_hash: ch, batch_id: batchId });
        prev = ch;
      }

      await insertLedgerBatch(supabase, entries);
      totalAnchored += entries.length;
      tablesAnchored++;
      results.push({ table: tableName, anchored: entries.length, status: "anchored", remaining: rows.filter((r: any) => !existing.has(r.id)).length - toAnchor.length });
      console.log(`+${entries.length} ${tableName}`);
    } catch (err) {
      console.error(`err ${tableName}: ${err.message}`);
      results.push({ table: tableName, anchored: 0, status: "error", error: err.message });
    }
  }

  return json({ totalAnchored, tablesProcessed: results.length, tables: results });
}

// ─── VERIFY ──────────────────────────────────────────────────────────
async function handleVerify(supabase: any, limit: number) {
  const { data: entries, error } = await supabase.from("evidence_merkle_ledger")
    .select("sequence_number, record_hash, previous_chain_hash, chain_hash, source_table, source_id")
    .order("sequence_number", { ascending: true }).limit(limit || 1000);
  if (error) throw new Error(`Read failed: ${error.message}`);
  if (!entries?.length) return json({ verified: 0, failed: 0, total: 0, integrity: "EMPTY", failures: [], message: "No entries" });

  const failures: any[] = [];
  let verified = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const expected = await sha256(e.record_hash + e.previous_chain_hash);
    if (expected !== e.chain_hash) failures.push({ sequence_number: e.sequence_number, source_table: e.source_table, source_id: e.source_id });
    else verified++;
    if (i > 0 && e.previous_chain_hash !== entries[i-1].chain_hash) failures.push({ sequence_number: e.sequence_number, issue: "broken link" });
  }
  const integrity = failures.length === 0 ? "VERIFIED" : "COMPROMISED";
  return json({ verified, failed: failures.length, total: entries.length, integrity, failures: failures.slice(0, 10),
    message: integrity === "VERIFIED" ? `${verified} entries verified` : `${failures.length} failures` });
}

// ─── STATS ───────────────────────────────────────────────────────────
async function handleStats(supabase: any) {
  const [{ count }, tableCounts, { data: lastEntry }, { data: firstEntry }] = await Promise.all([
    supabase.from("evidence_merkle_ledger").select("*", { count: "exact", head: true }),
    getLedgerCounts(supabase),
    supabase.from("evidence_merkle_ledger").select("sequence_number, chain_hash, anchored_at, source_table").order("sequence_number", { ascending: false }).limit(1).single(),
    supabase.from("evidence_merkle_ledger").select("sequence_number, anchored_at").order("sequence_number", { ascending: true }).limit(1).single(),
  ]);
  return json({ totalEntries: count || 0, uniqueTables: Object.keys(tableCounts).length, tableCounts, lastEntry, firstEntry, chainLength: count || 0 });
}

// ─── NEON COVERAGE ───────────────────────────────────────────────────
async function handleNeonCoverage(supabase: any, neonUrl: string) {
  const [tables, anchoredCounts, schema] = await Promise.all([
    neonQuery(neonUrl, `SELECT relname AS table_name, n_live_tup AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`),
    getLedgerCounts(supabase),
    getTableSchema(neonUrl),
  ]);

  const coverage = (tables as any[]).map(t => {
    const info = schema.get(t.table_name);
    const rows = Number(t.row_count);
    const anch = anchoredCounts[t.table_name] || 0;
    return { table: t.table_name, totalRows: rows, anchored: anch, hasSha256: info?.hasSha256 ?? false, hasId: info?.hasId ?? false, coverage: rows > 0 ? Math.round((anch / rows) * 100) : 0 };
  });

  const totalRows = coverage.reduce((s, t) => s + t.totalRows, 0);
  const totalAnchored = coverage.reduce((s, t) => s + t.anchored, 0);
  return json({ totalNeonTables: coverage.length, anchorableTables: coverage.filter(t => t.hasId).length, totalRows, totalAnchored,
    overallCoverage: totalRows > 0 ? Number(((totalAnchored / totalRows) * 100).toFixed(4)) : 0, tables: coverage.slice(0, 50) });
}

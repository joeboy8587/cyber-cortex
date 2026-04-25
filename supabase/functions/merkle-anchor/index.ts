import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function neonQuery(neonUrl: string, sql: string, params: unknown[] = []) {
  const url = new URL(neonUrl);
  const response = await fetch(`https://${url.hostname}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": neonUrl },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!response.ok) throw new Error(`Neon ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return result.rows ?? (Array.isArray(result) && result[0]?.rows ? result[0].rows : result);
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
      case "anchorDeep": return await handleAnchorDeep(supabase, neonUrl, body);
      case "anchorBatch": return await handleAnchorDeep(supabase, neonUrl, { ...body, hashOnly: true });
      case "verify": return await handleVerify(supabase, batchSize);
      case "stats": return await handleStats(supabase);
      case "neonCoverage": return await handleNeonCoverage(supabase, neonUrl);
      default: return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    console.error("merkle error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

async function getLastChainHash(supabase: any): Promise<string> {
  const { data } = await supabase.from("evidence_merkle_ledger").select("chain_hash").order("sequence_number", { ascending: false }).limit(1).single();
  return data?.chain_hash || "GENESIS";
}

// FAST: Use Neon to query ledger counts by running a count query on Supabase
// Instead of paginating, just get the total count per source_table
async function getLedgerCountsFast(supabase: any): Promise<Record<string, number>> {
  // Get distinct source_tables first (fast, small result)
  const tables = new Set<string>();
  let from = 0;
  // Just get unique table names from first page - won't be more than ~200 unique tables
  while (true) {
    const { data } = await supabase.from("evidence_merkle_ledger").select("source_table").range(from, from + 999);
    if (!data || data.length === 0) break;
    data.forEach((r: any) => tables.add(r.source_table));
    if (data.length < 1000) break;
    from += 1000;
  }
  
  // For each unique table, get exact count (fast with eq filter)
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count } = await supabase.from("evidence_merkle_ledger").select("*", { count: "exact", head: true }).eq("source_table", t);
    counts[t] = count || 0;
  }
  return counts;
}

async function getExistingIds(supabase: any, tableName: string): Promise<Set<string>> {
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

async function insertLedgerBatch(supabase: any, entries: any[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const { error } = await supabase.from("evidence_merkle_ledger").insert(batch);
    if (error) throw new Error(`Insert: ${error.message}`);
    n += batch.length;
  }
  return n;
}

async function getTableSchema(neonUrl: string) {
  const cols = await neonQuery(neonUrl,
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('id', 'sha256_hash')`
  );
  const m = new Map<string, { hasId: boolean; hasSha256: boolean }>();
  for (const c of cols as any[]) {
    if (!m.has(c.table_name)) m.set(c.table_name, { hasId: false, hasSha256: false });
    const e = m.get(c.table_name)!;
    if (c.column_name === 'id') e.hasId = true;
    if (c.column_name === 'sha256_hash') e.hasSha256 = true;
  }
  return m;
}

async function anchorOneTable(supabase: any, neonUrl: string, tableName: string, batchSize: number, info: { hasId: boolean; hasSha256: boolean }) {
  const existingIds = await getExistingIds(supabase, tableName);
  const fetchLimit = Math.min(batchSize + existingIds.size, 2000);
  
  let rows: any[];
  if (info.hasSha256) {
    rows = await neonQuery(neonUrl, `SELECT id::text AS id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT ${fetchLimit}`);
  } else {
    rows = await neonQuery(neonUrl, `SELECT id::text AS id, md5(row_to_json(t.*)::text) AS sha256_hash FROM ${tableName} t LIMIT ${fetchLimit}`);
  }

  const newRows = rows.filter((r: any) => !existingIds.has(r.id));
  const toAnchor = newRows.slice(0, batchSize);
  if (!toAnchor.length) return { anchored: 0, remaining: 0 };

  let prev = await getLastChainHash(supabase);
  const bid = crypto.randomUUID();
  const entries = [];
  for (const row of toAnchor) {
    const rh = info.hasSha256 ? row.sha256_hash : await sha256(row.sha256_hash);
    const ch = await sha256(rh + prev);
    entries.push({ source_table: tableName, source_id: row.id, record_hash: rh, previous_chain_hash: prev, chain_hash: ch, batch_id: bid });
    prev = ch;
  }
  await insertLedgerBatch(supabase, entries);
  return { anchored: entries.length, remaining: newRows.length - toAnchor.length };
}

// ─── ANCHOR SINGLE TABLE ─────────────────────────────────────────────
async function handleAnchor(supabase: any, neonUrl: string, table: string, batchSize: number) {
  if (!table) return json({ error: "table required" }, 400);
  const schema = await getTableSchema(neonUrl);
  const info = schema.get(table);
  if (!info?.hasId) return json({ error: "Table has no id column" }, 400);
  const result = await anchorOneTable(supabase, neonUrl, table, batchSize, info);
  return json({ ...result, table });
}

// ─── DEEP ANCHOR ────────────────────────────────────────────────────
async function handleAnchorDeep(supabase: any, neonUrl: string, body: any) {
  const { batchSize = 200, tableFilter, maxTables = 5, hashOnly = false } = body;
  const t0 = Date.now();

  // Parallel fetch schema + tables
  const [schema, allTables] = await Promise.all([
    getTableSchema(neonUrl),
    neonQuery(neonUrl, `SELECT relname AS tablename, n_live_tup AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`),
  ]);
  console.log(`init: ${Date.now() - t0}ms, tables=${(allTables as any[]).length}`);

  const candidates = (allTables as any[]).filter(t => {
    const name = t.tablename;
    if (name.startsWith('pg_') || name.startsWith('_')) return false;
    if (tableFilter && name !== tableFilter) return false;
    const info = schema.get(name);
    if (!info?.hasId) return false;
    if (hashOnly && !info.hasSha256) return false;
    return true;
  });

  const results: any[] = [];
  let totalAnchored = 0;
  let done = 0;

  for (const t of candidates) {
    if (Date.now() - t0 > 40000 || done >= maxTables) {
      if (Date.now() - t0 > 40000) results.push({ table: "TIMEOUT", anchored: 0, status: "time_limit_reached" });
      break;
    }

    const tableName = t.tablename;
    const info = schema.get(tableName)!;

    try {
      const r = await anchorOneTable(supabase, neonUrl, tableName, batchSize, info);
      if (r.anchored > 0) {
        done++;
        totalAnchored += r.anchored;
        results.push({ table: tableName, anchored: r.anchored, status: "anchored", remaining: r.remaining });
        console.log(`+${r.anchored} ${tableName} (${Date.now() - t0}ms)`);
      } else {
        results.push({ table: tableName, anchored: 0, status: "up-to-date" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`err ${tableName}: ${msg}`);
      results.push({ table: tableName, anchored: 0, status: "error", error: msg });
    }
  }

  return json({ totalAnchored, tablesProcessed: results.length, tables: results });
}

// ─── VERIFY ──────────────────────────────────────────────────────────
async function handleVerify(supabase: any, limit: number) {
  const { data: entries, error } = await supabase.from("evidence_merkle_ledger")
    .select("sequence_number, record_hash, previous_chain_hash, chain_hash, source_table, source_id")
    .order("sequence_number", { ascending: true }).limit(limit || 1000);
  if (error) throw new Error(error.message);
  if (!entries?.length) return json({ verified: 0, failed: 0, total: 0, integrity: "EMPTY", failures: [], message: "No entries" });

  const failures: any[] = [];
  let verified = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (await sha256(e.record_hash + e.previous_chain_hash) !== e.chain_hash) failures.push({ seq: e.sequence_number, table: e.source_table });
    else verified++;
    if (i > 0 && e.previous_chain_hash !== entries[i-1].chain_hash) failures.push({ seq: e.sequence_number, issue: "broken" });
  }
  const integrity = failures.length === 0 ? "VERIFIED" : "COMPROMISED";
  return json({ verified, failed: failures.length, total: entries.length, integrity, failures: failures.slice(0, 10),
    message: integrity === "VERIFIED" ? `${verified} entries verified — no tampering` : `${failures.length} failures detected` });
}

// ─── STATS ───────────────────────────────────────────────────────────
async function handleStats(supabase: any) {
  const { count } = await supabase.from("evidence_merkle_ledger").select("*", { count: "exact", head: true });
  const tableCounts = await getLedgerCountsFast(supabase);
  const { data: lastEntry } = await supabase.from("evidence_merkle_ledger").select("sequence_number, chain_hash, anchored_at, source_table").order("sequence_number", { ascending: false }).limit(1).single();
  const { data: firstEntry } = await supabase.from("evidence_merkle_ledger").select("sequence_number, anchored_at").order("sequence_number", { ascending: true }).limit(1).single();
  return json({ totalEntries: count || 0, uniqueTables: Object.keys(tableCounts).length, tableCounts, lastEntry, firstEntry, chainLength: count || 0 });
}

// ─── NEON COVERAGE ───────────────────────────────────────────────────
async function handleNeonCoverage(supabase: any, neonUrl: string) {
  const [tables, anchoredCounts, schema] = await Promise.all([
    neonQuery(neonUrl, `SELECT relname AS table_name, n_live_tup AS row_count FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY n_live_tup DESC`),
    getLedgerCountsFast(supabase),
    getTableSchema(neonUrl),
  ]);

  const coverage = (tables as any[]).map(t => {
    const info = schema.get(t.table_name);
    const rows = Number(t.row_count), anch = anchoredCounts[t.table_name] || 0;
    return { table: t.table_name, totalRows: rows, anchored: anch, hasSha256: info?.hasSha256 ?? false, hasId: info?.hasId ?? false, coverage: rows > 0 ? Math.round((anch / rows) * 100) : 0 };
  });

  const totalRows = coverage.reduce((s, t) => s + t.totalRows, 0);
  const totalAnchored = coverage.reduce((s, t) => s + t.anchored, 0);
  return json({ totalNeonTables: coverage.length, anchorableTables: coverage.filter(t => t.hasId).length, totalRows, totalAnchored,
    overallCoverage: totalRows > 0 ? Number(((totalAnchored / totalRows) * 100).toFixed(4)) : 0, tables: coverage.slice(0, 50) });
}

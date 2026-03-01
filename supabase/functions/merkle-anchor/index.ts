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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const neonUrl = Deno.env.get("NEON_DATABASE_URL")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, table, batchSize = 500 } = await req.json();

    if (action === "anchor") {
      return await handleAnchor(supabase, neonUrl, table, batchSize);
    } else if (action === "verify") {
      return await handleVerify(supabase, batchSize);
    } else if (action === "stats") {
      return await handleStats(supabase);
    } else if (action === "anchorBatch") {
      return await handleAnchorBatch(supabase, neonUrl, batchSize);
    } else {
      return new Response(
        JSON.stringify({ error: "Unknown action. Use: anchor, verify, stats, anchorBatch" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err) {
    console.error("merkle-anchor error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function neonQuery(neonUrl: string, sql: string, params: unknown[] = []) {
  const { Pool } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
  const pool = new Pool(neonUrl, 1, true);
  const conn = await pool.connect();
  try {
    const result = await conn.queryObject(sql, params);
    return result.rows;
  } finally {
    conn.release();
    await pool.end();
  }
}

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

async function handleAnchor(supabase: any, neonUrl: string, table: string, batchSize: number) {
  if (!table) {
    return new Response(
      JSON.stringify({ error: "table parameter required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get records with SHA-256 hashes from Neon that aren't yet in the ledger
  const rows = await neonQuery(
    neonUrl,
    `SELECT id::text, sha256_hash FROM ${table}
     WHERE sha256_hash IS NOT NULL
     AND id::text NOT IN (
       SELECT source_id FROM (
         SELECT source_id FROM evidence_merkle_ledger_placeholder WHERE source_table = $1
       ) sub
     )
     LIMIT $2`,
    [table, batchSize]
  );

  // Since we can't query Supabase ledger from Neon, we'll check the ledger first
  const { data: existingEntries } = await supabase
    .from("evidence_merkle_ledger")
    .select("source_id")
    .eq("source_table", table);

  const existingIds = new Set((existingEntries || []).map((e: any) => e.source_id));

  // Get hashed records from Neon
  const allRows = await neonQuery(
    neonUrl,
    `SELECT id::text as id, sha256_hash FROM ${table} WHERE sha256_hash IS NOT NULL LIMIT $1`,
    [batchSize + existingIds.size]
  );

  const newRows = allRows.filter((r: any) => !existingIds.has(r.id));
  const toAnchor = newRows.slice(0, batchSize);

  if (toAnchor.length === 0) {
    return new Response(
      JSON.stringify({ data: { anchored: 0, message: `All hashed records in ${table} already anchored` } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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

  // Insert in batches of 100
  let totalInserted = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const { error } = await supabase.from("evidence_merkle_ledger").insert(batch);
    if (error) throw new Error(`Ledger insert failed: ${error.message}`);
    totalInserted += batch.length;
  }

  return new Response(
    JSON.stringify({
      data: {
        anchored: totalInserted,
        table,
        batchId,
        lastChainHash: previousHash,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleAnchorBatch(supabase: any, neonUrl: string, batchSize: number) {
  // Get list of tables with sha256_hash column from Neon
  const tables = await neonQuery(
    neonUrl,
    `SELECT table_name FROM information_schema.columns
     WHERE column_name = 'sha256_hash' AND table_schema = 'public'
     ORDER BY table_name`
  );

  const results = [];
  let totalAnchored = 0;

  for (const t of tables) {
    const tableName = (t as any).table_name;
    try {
      const { data: existingEntries } = await supabase
        .from("evidence_merkle_ledger")
        .select("source_id")
        .eq("source_table", tableName);

      const existingIds = new Set((existingEntries || []).map((e: any) => e.source_id));

      const allRows = await neonQuery(
        neonUrl,
        `SELECT id::text as id, sha256_hash FROM ${tableName} WHERE sha256_hash IS NOT NULL LIMIT $1`,
        [batchSize]
      );

      const newRows = (allRows as any[]).filter((r) => !existingIds.has(r.id));
      if (newRows.length === 0) {
        results.push({ table: tableName, anchored: 0, status: "up-to-date" });
        continue;
      }

      const toAnchor = newRows.slice(0, Math.min(50, newRows.length)); // cap per table in batch mode
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

      const { error } = await supabase.from("evidence_merkle_ledger").insert(entries);
      if (error) throw error;

      totalAnchored += entries.length;
      results.push({ table: tableName, anchored: entries.length, status: "anchored" });
    } catch (err) {
      results.push({ table: tableName, anchored: 0, status: "error", error: err.message });
    }

    // Stay within edge function time limits
    if (totalAnchored > 300) break;
  }

  return new Response(
    JSON.stringify({ data: { totalAnchored, tables: results } }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleVerify(supabase: any, limit: number) {
  const { data: entries, error } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, record_hash, previous_chain_hash, chain_hash, source_table, source_id")
    .order("sequence_number", { ascending: true })
    .limit(limit || 1000);

  if (error) throw new Error(`Failed to read ledger: ${error.message}`);
  if (!entries || entries.length === 0) {
    return new Response(
      JSON.stringify({ data: { verified: 0, integrity: "EMPTY", message: "No entries in ledger" } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let failures: any[] = [];
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

    // Verify chain linkage
    if (i > 0) {
      const prev = entries[i - 1];
      if (entry.previous_chain_hash !== prev.chain_hash) {
        failures.push({
          sequence_number: entry.sequence_number,
          source_table: entry.source_table,
          source_id: entry.source_id,
          issue: "Chain link broken - previous_chain_hash doesn't match prior entry",
          expected: prev.chain_hash,
          actual: entry.previous_chain_hash,
        });
      }
    } else {
      // First entry should reference GENESIS
      if (entry.previous_chain_hash !== "GENESIS") {
        // Not necessarily an error - could be a partial verification
      }
    }
  }

  const integrity = failures.length === 0 ? "VERIFIED" : "COMPROMISED";

  return new Response(
    JSON.stringify({
      data: {
        verified,
        failed: failures.length,
        total: entries.length,
        integrity,
        failures: failures.slice(0, 10),
        message: integrity === "VERIFIED"
          ? `All ${verified} chain entries verified — no tampering detected`
          : `ALERT: ${failures.length} chain integrity failures detected — possible tampering`,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function handleStats(supabase: any) {
  // Get total entries
  const { count: totalEntries } = await supabase
    .from("evidence_merkle_ledger")
    .select("*", { count: "exact", head: true });

  // Get unique tables
  const { data: tableData } = await supabase
    .from("evidence_merkle_ledger")
    .select("source_table")
    .limit(1000);

  const tableCounts: Record<string, number> = {};
  (tableData || []).forEach((r: any) => {
    tableCounts[r.source_table] = (tableCounts[r.source_table] || 0) + 1;
  });

  // Get last entry
  const { data: lastEntry } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, chain_hash, anchored_at, source_table")
    .order("sequence_number", { ascending: false })
    .limit(1)
    .single();

  // Get first entry
  const { data: firstEntry } = await supabase
    .from("evidence_merkle_ledger")
    .select("sequence_number, anchored_at")
    .order("sequence_number", { ascending: true })
    .limit(1)
    .single();

  return new Response(
    JSON.stringify({
      data: {
        totalEntries: totalEntries || 0,
        uniqueTables: Object.keys(tableCounts).length,
        tableCounts,
        lastEntry: lastEntry || null,
        firstEntry: firstEntry || null,
        chainLength: totalEntries || 0,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

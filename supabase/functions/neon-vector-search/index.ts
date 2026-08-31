// Watchtower Vector Store search (Neon / pgvector) — replaces the retired Pinecone panel.
// The stored vectors are 384-dim local-GPU embeddings (all-MiniLM-L6-v2), which no hosted
// API can reproduce. So we search in two stages, entirely inside Neon:
//   1. LEXICAL SEED  — full-text rank the query against each store's text column.
//   2. VECTOR EXPAND — take the best seed row's own embedding and pull its nearest
//      neighbours with pgvector (<=>), which stays inside the same embedding space.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NEON_URL = Deno.env.get("NEON_DATABASE_URL") ?? Deno.env.get("DATABASE_URL") ?? "";

interface StoreDef {
  key: string;
  table: string;
  textCol: string;
  vecCol: string;
  idCol: string;
  label: string;
}

const STORES: StoreDef[] = [
  { key: "josiah_unified_embeddings", table: "josiah_unified_embeddings", textCol: "cleaned_text", vecCol: "embedding", idCol: "id", label: "Josiah Unified Corpus" },
  { key: "stella_embeddings", table: "stella_embeddings", textCol: "content", vecCol: "embedding", idCol: "id", label: "Stella Document Store" },
  { key: "table_vec_embeddings", table: "table_vec_embeddings", textCol: "text_content", vecCol: "embedding", idCol: "id", label: "Table Vector Index" },
  { key: "vector_master_registry", table: "vector_master_registry", textCol: "content_text", vecCol: "embedding_vector", idCol: "id", label: "Vector Master Registry" },
];

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${tag} timed out after ${ms}ms`)), ms)),
  ]);
}

async function searchStore(sql: any, store: StoreDef, query: string, topK: number) {
  const { table, textCol, vecCol, idCol } = store;

  // Stage 1: lexical seed
  const seeds = await sql.unsafe(
    `SELECT ${idCol}::text AS id,
            left(${textCol}, 900) AS snippet,
            source_table,
            ts_rank(to_tsvector('english', coalesce(${textCol},'')), websearch_to_tsquery('english', $1)) AS rank
       FROM ${table}
      WHERE ${textCol} IS NOT NULL
        AND ${vecCol} IS NOT NULL
        AND to_tsvector('english', coalesce(${textCol},'')) @@ websearch_to_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT 5`,
    [query],
  );

  if (seeds.length === 0) {
    return { store: store.key, label: store.label, seed_matches: 0, matches: [] };
  }

  // Stage 2: vector expansion from the strongest seed
  const seedId = seeds[0].id;
  const neighbours = await sql.unsafe(
    `WITH seed AS (SELECT ${vecCol} AS v FROM ${table} WHERE ${idCol}::text = $1)
     SELECT t.${idCol}::text AS id,
            left(t.${textCol}, 900) AS snippet,
            t.source_table,
            1 - (t.${vecCol} <=> seed.v) AS similarity
       FROM ${table} t, seed
      WHERE t.${vecCol} IS NOT NULL
      ORDER BY t.${vecCol} <=> seed.v
      LIMIT $2`,
    [seedId, topK],
  );

  const seen = new Set<string>();
  const matches = [
    ...seeds.map((s: any) => ({
      id: s.id,
      snippet: s.snippet,
      source_table: s.source_table,
      score: Number(s.rank) || 0,
      match_type: "keyword",
    })),
    ...neighbours.map((n: any) => ({
      id: n.id,
      snippet: n.snippet,
      source_table: n.source_table,
      score: Number(n.similarity) || 0,
      match_type: "semantic",
    })),
  ].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));

  return { store: store.key, label: store.label, seed_matches: seeds.length, matches: matches.slice(0, topK) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let sql: any = null;
  try {
    if (!NEON_URL) throw new Error("NEON_DATABASE_URL not configured");
    const { action = "search", query, top_k = 8, stores } = await req.json();

    sql = postgres(NEON_URL, { max: 2, idle_timeout: 20, connect_timeout: 10, prepare: false });

    if (action === "list_stores") {
      const rows = await withTimeout(
        sql.unsafe(
          `SELECT c.relname AS table, a.attname AS col,
                  format_type(a.atttypid, a.atttypmod) AS dim,
                  c.reltuples::bigint AS est_rows
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public'
              AND c.relname = ANY($1)
              AND format_type(a.atttypid, a.atttypmod) LIKE 'vector%'`,
          [STORES.map((s) => s.table)],
        ),
        15000,
        "list_stores",
      );
      const byTable = new Map(rows.map((r: any) => [`${r.table}.${r.col}`, r]));
      const out = STORES.map((s) => {
        const meta: any = byTable.get(`${s.table}.${s.vecCol}`);
        return {
          key: s.key,
          label: s.label,
          table: s.table,
          dimension: meta?.dim ?? "unknown",
          est_rows: Number(meta?.est_rows ?? 0),
        };
      });
      return new Response(JSON.stringify({ stores: out }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "search") {
      if (!query || typeof query !== "string") throw new Error("query required");
      const targets = Array.isArray(stores) && stores.length
        ? STORES.filter((s) => stores.includes(s.key))
        : STORES;

      const settled = await Promise.allSettled(
        targets.map((s) =>
          withTimeout(searchStore(sql, s, query.slice(0, 500), Math.min(Number(top_k) || 8, 20)), 25000, s.key),
        ),
      );

      const results = settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value)
        .filter((r) => r.matches.length > 0);
      const errors = settled
        .filter((r) => r.status === "rejected")
        .map((r) => ({ error: (r as PromiseRejectedResult).reason?.message ?? "unknown error" }));

      return new Response(
        JSON.stringify({
          results,
          errors,
          stores_searched: targets.length,
          total_matches: results.reduce((n, r) => n + r.matches.length, 0),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error("neon-vector-search error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch { /* ignore */ }
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SearchRequest {
  action: "search" | "multi_search" | "embed" | "batch_embed" | "stats" | "vector_census";
  query?: string;
  limit?: number;
  content_type?: string;
  table?: string;
  text_field?: string;
  id_field?: string;
  batch_size?: number;
  tables?: string[];
}

// Top vector tables by size/importance for multi-search
const TOP_VECTOR_TABLES = [
  "canonical_forensic_events_vectors",
  "master_unified_evidence_vectors",
  "live_flight_detections_rows_vectors",
  "watchtower_unified_master_vectors",
  "josiah_document_index_vectors",
  "case_evidence_links_vectors",
  "unified_biometric_batch_events_vectors",
  "biometric_threshold_collapses_vectors",
  "KCSO_Fact_Matrix_v1_vectors",
  "KCSO_Personal_Injury_Timeline_vectors",
  "KCSO_clusters_vectors",
  "shell_companies_vectors",
  "criminal_enterprise_command_structure_vectors",
  "legal_ada_violations_proper_vectors",
  "aircraft_identity_master_vectors",
  "md_legal_intelligence_vectors",
];

// Category mapping for vector tables
function categorizeTable(tableName: string): string {
  if (/flight|aircraft|adsb|detection|tracking/i.test(tableName)) return "surveillance";
  if (/biometric|health|ecg|heart|collapse/i.test(tableName)) return "biometric";
  if (/kcso|sheriff/i.test(tableName)) return "kcso";
  if (/legal|ada|rico|nuremberg|violation/i.test(tableName)) return "legal";
  if (/shell|enterprise|operator|company/i.test(tableName)) return "enterprise";
  if (/josiah|reflection|memory|witness/i.test(tableName)) return "josiah";
  if (/custody|forensic|merkle|hash/i.test(tableName)) return "custody";
  if (/timeline|event|unified/i.test(tableName)) return "timeline";
  if (/watchtower|sentinel|alert/i.test(tableName)) return "watchtower";
  if (/md_|document|screenshot|ocr/i.test(tableName)) return "document";
  return "other";
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: text.slice(0, 8000),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

function formatVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SearchRequest = await req.json();
    const { action, query, limit = 10, content_type, table, text_field, id_field, batch_size = 50, tables } = body;

    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!OPENAI_API_KEY && action !== "stats" && action !== "vector_census") {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured for embeddings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });

    try {
      switch (action) {
        case "vector_census": {
          // Get all vector tables with row counts
          const vectorTables = await sql`
            SELECT 
              c.relname as table_name,
              c.reltuples::bigint as approx_rows,
              pg_total_relation_size(c.oid) as size_bytes
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' 
              AND n.nspname = 'public'
              AND c.relname LIKE '%_vectors'
            ORDER BY c.reltuples DESC
          `;

          const totalVectors = vectorTables.reduce((sum: number, t: any) => sum + Number(t.approx_rows || 0), 0);
          const totalSize = vectorTables.reduce((sum: number, t: any) => sum + Number(t.size_bytes || 0), 0);

          // Group by category
          const byCategory: Record<string, { count: number; tables: number; topTables: string[] }> = {};
          for (const t of vectorTables) {
            const cat = categorizeTable(t.table_name);
            if (!byCategory[cat]) byCategory[cat] = { count: 0, tables: 0, topTables: [] };
            byCategory[cat].count += Number(t.approx_rows || 0);
            byCategory[cat].tables += 1;
            if (byCategory[cat].topTables.length < 3) byCategory[cat].topTables.push(t.table_name);
          }

          return new Response(
            JSON.stringify({
              total_vector_tables: vectorTables.length,
              total_vectors: totalVectors,
              total_size_gb: (totalSize / 1073741824).toFixed(2),
              by_category: byCategory,
              top_20: vectorTables.slice(0, 20).map((t: any) => ({
                table: t.table_name,
                rows: Number(t.approx_rows),
                size_mb: (Number(t.size_bytes) / 1048576).toFixed(1),
                category: categorizeTable(t.table_name),
              })),
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "stats": {
          const stats = await sql`
            SELECT 
              source_table,
              content_type,
              COUNT(*) as count
            FROM josiah_unified_embeddings
            WHERE embedding_vector IS NOT NULL
            GROUP BY source_table, content_type
            ORDER BY count DESC
          `;

          const totalEmbeddings = await sql`
            SELECT COUNT(*) as total FROM josiah_unified_embeddings WHERE embedding_vector IS NOT NULL
          `;

          return new Response(
            JSON.stringify({ 
              total: parseInt(totalEmbeddings[0]?.total || "0"),
              by_source: stats,
              vector_dimension: 1536
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "multi_search": {
          if (!query) {
            return new Response(
              JSON.stringify({ error: "Query is required for multi_search" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const queryEmbedding = await generateEmbedding(query, OPENAI_API_KEY!);
          const vectorStr = formatVector(queryEmbedding);
          const searchLimit = Math.min(limit || 5, 10);
          
          // Determine which tables to search
          const targetTables = tables && tables.length > 0 ? tables : TOP_VECTOR_TABLES;
          
          // Verify which tables actually exist
          const existingTables = await sql`
            SELECT tablename FROM pg_tables 
            WHERE schemaname = 'public' 
              AND tablename = ANY(${targetTables})
          `;
          const validTables = existingTables.map((t: any) => t.tablename);

          if (validTables.length === 0) {
            return new Response(
              JSON.stringify({ query, results: [], tables_searched: 0 }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Build UNION ALL query across vector tables (top results from each)
          const unionParts = validTables.map((t: string) => {
            const safeTable = t.replace(/[^a-zA-Z0-9_]/g, "");
            return `(SELECT 
              '${safeTable}' as source_table,
              source_id,
              text_content,
              1 - (embedding <=> '${vectorStr}'::vector) as similarity
            FROM "${safeTable}"
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> '${vectorStr}'::vector
            LIMIT ${searchLimit})`;
          });

          // Execute in chunks to avoid query size limits
          const chunkSize = 8;
          const allResults: any[] = [];
          
          for (let i = 0; i < unionParts.length; i += chunkSize) {
            const chunk = unionParts.slice(i, i + chunkSize);
            const unionQuery = chunk.join(" UNION ALL ");
            try {
              const chunkResults = await sql.unsafe(`
                SELECT * FROM (${unionQuery}) combined
                ORDER BY similarity DESC
                LIMIT ${searchLimit * 2}
              `);
              allResults.push(...chunkResults);
            } catch (e) {
              console.error(`Chunk ${i} error:`, (e as Error).message);
            }
          }

          // Sort all results by similarity and take top N
          allResults.sort((a, b) => Number(b.similarity) - Number(a.similarity));
          const topResults = allResults.slice(0, limit || 20);

          // Also search josiah_unified_embeddings for coverage
          let legacyResults: any[] = [];
          try {
            legacyResults = await sql.unsafe(`
              SELECT 
                source_table,
                source_id,
                original_text as text_content,
                content_type,
                1 - (embedding_vector <=> '${vectorStr}'::vector) as similarity
              FROM josiah_unified_embeddings
              WHERE embedding_vector IS NOT NULL
              ORDER BY embedding_vector <=> '${vectorStr}'::vector
              LIMIT ${searchLimit}
            `);
          } catch (e) {
            console.error("Legacy embeddings search error:", e);
          }

          // Merge and deduplicate
          const merged = [...topResults, ...legacyResults]
            .sort((a, b) => Number(b.similarity) - Number(a.similarity))
            .slice(0, limit || 20);

          // Add category info
          const enrichedResults = merged.map((r: any) => ({
            source_table: r.source_table,
            source_id: r.source_id,
            text_content: String(r.text_content || "").slice(0, 500),
            similarity: Number(r.similarity).toFixed(4),
            category: categorizeTable(r.source_table),
            content_type: r.content_type || null,
          }));

          return new Response(
            JSON.stringify({
              query,
              results: enrichedResults,
              tables_searched: validTables.length,
              total_results: enrichedResults.length,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "search": {
          if (!query) {
            return new Response(
              JSON.stringify({ error: "Query is required for search" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const queryEmbedding = await generateEmbedding(query, OPENAI_API_KEY!);
          const vectorStr = formatVector(queryEmbedding);

          let results;
          if (content_type) {
            results = await sql.unsafe(`
              SELECT 
                id, source_table, source_id, content_type, original_text, metadata,
                1 - (embedding_vector <=> '${vectorStr}'::vector) as similarity
              FROM josiah_unified_embeddings
              WHERE embedding_vector IS NOT NULL AND content_type = $1
              ORDER BY embedding_vector <=> '${vectorStr}'::vector
              LIMIT $2
            `, [content_type, limit]);
          } else {
            results = await sql.unsafe(`
              SELECT 
                id, source_table, source_id, content_type, original_text, metadata,
                1 - (embedding_vector <=> '${vectorStr}'::vector) as similarity
              FROM josiah_unified_embeddings
              WHERE embedding_vector IS NOT NULL
              ORDER BY embedding_vector <=> '${vectorStr}'::vector
              LIMIT $1
            `, [limit]);
          }

          return new Response(
            JSON.stringify({ query, results, count: results.length }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "embed": {
          if (!query) {
            return new Response(
              JSON.stringify({ error: "Text (query) is required for embedding" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          const embedding = await generateEmbedding(query, OPENAI_API_KEY!);
          return new Response(
            JSON.stringify({ 
              text: query.slice(0, 100) + "...",
              embedding_dimension: embedding.length,
              embedding_preview: embedding.slice(0, 5)
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "batch_embed": {
          if (!table || !text_field) {
            return new Response(
              JSON.stringify({ error: "table and text_field are required for batch_embed" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
          const safeTextField = text_field.replace(/[^a-zA-Z0-9_]/g, "");
          const safeIdField = (id_field || "id").replace(/[^a-zA-Z0-9_]/g, "");

          const records = await sql.unsafe(`
            SELECT t.${safeIdField} as record_id, t.${safeTextField} as text_content
            FROM ${safeTable} t
            LEFT JOIN josiah_unified_embeddings e 
              ON e.source_table = '${safeTable}' 
              AND e.source_id = t.${safeIdField}::text
            WHERE e.id IS NULL
              AND t.${safeTextField} IS NOT NULL
              AND LENGTH(t.${safeTextField}) > 10
            LIMIT ${batch_size}
          `);

          if (records.length === 0) {
            return new Response(
              JSON.stringify({ message: "No new records to embed", table: safeTable, embedded: 0 }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          let embedded = 0;
          const errors: string[] = [];

          for (const record of records) {
            try {
              const text = String(record.text_content).slice(0, 8000);
              const embedding = await generateEmbedding(text, OPENAI_API_KEY!);
              const vectorStr = formatVector(embedding);

              await sql.unsafe(`
                INSERT INTO josiah_unified_embeddings 
                  (source_table, source_id, content_type, original_text, cleaned_text, embedding_vector, created_at)
                VALUES ($1, $2, $3, $4, $5, '${vectorStr}'::vector, NOW())
                ON CONFLICT DO NOTHING
              `, [safeTable, String(record.record_id), safeTable.toUpperCase(), text.slice(0, 2000), text.slice(0, 2000)]);

              embedded++;
              await new Promise(r => setTimeout(r, 100));
            } catch (e) {
              errors.push(`Record ${record.record_id}: ${(e as Error).message}`);
            }
          }

          return new Response(
            JSON.stringify({ table: safeTable, processed: records.length, embedded, errors: errors.length > 0 ? errors.slice(0, 5) : undefined }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        default:
          return new Response(
            JSON.stringify({ error: `Unknown action: ${action}. Use: search, multi_search, embed, batch_embed, stats, vector_census` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
      }
    } finally {
      await sql.end();
    }
  } catch (err) {
    console.error("Semantic search error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

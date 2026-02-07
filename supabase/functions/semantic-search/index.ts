import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SearchRequest {
  action: "search" | "embed" | "batch_embed" | "stats";
  query?: string;
  limit?: number;
  content_type?: string;
  table?: string;
  text_field?: string;
  id_field?: string;
  batch_size?: number;
}

// Generate embedding using OpenAI API
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: text.slice(0, 8000), // Limit input size
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Format embedding array for Postgres vector type
function formatVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: SearchRequest = await req.json();
    const { action, query, limit = 10, content_type, table, text_field, id_field, batch_size = 50 } = body;

    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!OPENAI_API_KEY && action !== "stats") {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured for embeddings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });

    try {
      switch (action) {
        case "stats": {
          // Get embedding statistics
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
              vector_dimension: 1536 // text-embedding-ada-002 dimension
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

          // Generate embedding for the search query
          const queryEmbedding = await generateEmbedding(query, OPENAI_API_KEY!);
          const vectorStr = formatVector(queryEmbedding);

          // Perform semantic search using cosine distance
          let results;
          if (content_type) {
            results = await sql.unsafe(`
              SELECT 
                id,
                source_table,
                source_id,
                content_type,
                original_text,
                metadata,
                1 - (embedding_vector <=> '${vectorStr}'::vector) as similarity
              FROM josiah_unified_embeddings
              WHERE embedding_vector IS NOT NULL
                AND content_type = $1
              ORDER BY embedding_vector <=> '${vectorStr}'::vector
              LIMIT $2
            `, [content_type, limit]);
          } else {
            results = await sql.unsafe(`
              SELECT 
                id,
                source_table,
                source_id,
                content_type,
                original_text,
                metadata,
                1 - (embedding_vector <=> '${vectorStr}'::vector) as similarity
              FROM josiah_unified_embeddings
              WHERE embedding_vector IS NOT NULL
              ORDER BY embedding_vector <=> '${vectorStr}'::vector
              LIMIT $1
            `, [limit]);
          }

          return new Response(
            JSON.stringify({ 
              query,
              results,
              count: results.length
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        case "embed": {
          // Embed a single text and optionally store it
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
          // Generate embeddings for records from a specific table
          if (!table || !text_field) {
            return new Response(
              JSON.stringify({ error: "table and text_field are required for batch_embed" }),
              { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "");
          const safeTextField = text_field.replace(/[^a-zA-Z0-9_]/g, "");
          const safeIdField = (id_field || "id").replace(/[^a-zA-Z0-9_]/g, "");

          // Get records that don't have embeddings yet
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
              JSON.stringify({ 
                message: "No new records to embed",
                table: safeTable,
                embedded: 0
              }),
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

              // Rate limit to avoid hitting OpenAI limits
              await new Promise(r => setTimeout(r, 100));
            } catch (e) {
              errors.push(`Record ${record.record_id}: ${(e as Error).message}`);
            }
          }

          return new Response(
            JSON.stringify({ 
              table: safeTable,
              processed: records.length,
              embedded,
              errors: errors.length > 0 ? errors.slice(0, 5) : undefined
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        default:
          return new Response(
            JSON.stringify({ error: `Unknown action: ${action}. Use: search, embed, batch_embed, stats` }),
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

// Josiah RAG recall: embed query → semantic search → return top chunks for context injection
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query, match_count = 8, similarity_threshold = 0.45 } = await req.json();
    if (!query || typeof query !== "string") throw new Error("query required");

    // Embed
    const er = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: query.slice(0, 8000) }),
    });
    if (!er.ok) throw new Error(`embed ${er.status}: ${await er.text()}`);
    const ej = await er.json();
    const embedding = ej.data[0].embedding;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase.rpc("match_rag_chunks", {
      query_embedding: embedding,
      match_count: Math.min(match_count, 20),
      similarity_threshold,
    });
    if (error) throw error;

    const matches = data || [];
    const context = matches.length === 0
      ? ""
      : matches.map((m: any, i: number) =>
          `[${i + 1}] ${m.document_title} (similarity ${m.similarity.toFixed(2)})\n${m.content}`
        ).join("\n\n---\n\n");

    return new Response(JSON.stringify({ matches, context, count: matches.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("rag-query error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message, matches: [], context: "" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

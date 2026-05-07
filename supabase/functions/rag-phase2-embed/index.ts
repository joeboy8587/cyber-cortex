// Phase 2: embed a page of chunks for a single document. Idempotent. Re-call until {done:true}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  return (await res.json()).data.map((d: any) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { document_id, page_size = 64, max_pages = 3 } = await req.json();
    if (!document_id) throw new Error("document_id required");

    let totalEmbedded = 0;
    let pages = 0;
    while (pages < max_pages) {
      const { data: pending, error } = await supabase
        .from("rag_chunks")
        .select("id, content")
        .eq("document_id", document_id)
        .is("embedding", null)
        .order("chunk_index", { ascending: true })
        .limit(page_size);
      if (error) throw new Error(`select: ${error.message}`);
      if (!pending || pending.length === 0) break;

      const vecs = await embed(pending.map(p => p.content));
      // Update each row (Supabase has no bulk update for varying values; do parallel updates)
      await Promise.all(vecs.map((v, idx) =>
        supabase.from("rag_chunks").update({ embedding: v }).eq("id", pending[idx].id)
      ));
      totalEmbedded += pending.length;
      pages++;
      if (pending.length < page_size) break;
    }

    const { count: remaining } = await supabase
      .from("rag_chunks").select("*", { count: "exact", head: true })
      .eq("document_id", document_id).is("embedding", null);

    const done = (remaining ?? 0) === 0;
    if (done) {
      await supabase.from("rag_documents").update({
        status: "analyzing", status_message: "embeddings complete; entities pending",
      }).eq("id", document_id);
    } else {
      await supabase.from("rag_documents").update({
        status_message: `embedding: ${remaining} chunks remaining`,
      }).eq("id", document_id);
    }

    return new Response(JSON.stringify({ success: true, embedded_this_call: totalEmbedded, remaining, done }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

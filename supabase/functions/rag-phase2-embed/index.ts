// Phase 2: embed pending chunks for one document (paged). Bare fetch.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE = Deno.env.get("LOVABLE_API_KEY")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PG = `${SB_URL}/rest/v1`;
const H = { "Content-Type": "application/json", apikey: SK, Authorization: `Bearer ${SK}` };

async function embed(texts: string[]): Promise<number[][]> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text()}`);
  return (await r.json()).data.map((d: any) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id, page_size = 32, max_pages = 4 } = await req.json();
    if (!document_id) throw new Error("document_id required");

    let totalEmbedded = 0, pages = 0;
    while (pages < max_pages) {
      const r = await fetch(
        `${PG}/rag_chunks?document_id=eq.${document_id}&embedding=is.null&select=id,content&order=chunk_index.asc&limit=${page_size}`,
        { headers: H },
      );
      if (!r.ok) throw new Error(`select ${r.status}: ${await r.text()}`);
      const pending = await r.json() as Array<{ id: string; content: string }>;
      if (!pending.length) break;

      const vecs = await embed(pending.map(p => p.content));
      // Per-row updates
      for (let i = 0; i < pending.length; i++) {
        const u = await fetch(`${PG}/rag_chunks?id=eq.${pending[i].id}`, {
          method: "PATCH", headers: H,
          body: JSON.stringify({ embedding: vecs[i] }),
        });
        if (!u.ok) throw new Error(`update ${u.status}`);
      }
      totalEmbedded += pending.length;
      pages++;
      if (pending.length < page_size) break;
    }

    const cr = await fetch(
      `${PG}/rag_chunks?document_id=eq.${document_id}&embedding=is.null&select=id`,
      { headers: { ...H, Prefer: "count=exact", "Range-Unit": "items", Range: "0-0" } },
    );
    const cl = cr.headers.get("content-range") || "0/0";
    const remaining = parseInt(cl.split("/")[1] || "0", 10);
    const done = remaining === 0;

    await fetch(`${PG}/rag_documents?id=eq.${document_id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify(done
        ? { status: "analyzing", status_message: "embeddings complete" }
        : { status_message: `embedding: ${remaining} remaining` }),
    });

    return new Response(JSON.stringify({ success: true, embedded_this_call: totalEmbedded, remaining, done }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// Lean, low-memory ingest: no SDK, raw PostgREST fetch. Driven in small batches by the caller.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.data.map((d: { embedding: number[] }) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    if (action === "create_doc") {
      const { title, filename, sha256_hash, document_type = "master_dossier", tags = [], preview = "", file_size = 0 } = body;
      const dup = await rest(`rag_documents?sha256_hash=eq.${encodeURIComponent(sha256_hash)}&select=id`);
      if (Array.isArray(dup) && dup.length) return json({ document_id: dup[0].id, duplicate: true });
      const rows = await rest("rag_documents", {
        method: "POST",
        prefer: "return=representation",
        body: JSON.stringify([{
          title, filename,
          storage_path: `inline://${sha256_hash}`,
          document_type, tags, sha256_hash,
          file_size, mime_type: "text/plain",
          status: "embedding",
          raw_text_preview: String(preview).slice(0, 2000),
        }]),
      });
      return json({ document_id: rows[0].id, duplicate: false });
    }

    if (action === "add_chunks") {
      const { document_id, start_index, chunks } = body as { document_id: string; start_index: number; chunks: string[] };
      if (!document_id || !Array.isArray(chunks) || chunks.length === 0) return json({ error: "document_id and chunks required" }, 400);
      if (chunks.length > 16) return json({ error: "max 16 chunks per call" }, 400);
      const vecs = await embed(chunks);
      const payload = chunks.map((c, i) => ({
        document_id,
        chunk_index: start_index + i,
        content: c,
        token_estimate: Math.ceil(c.length / 4),
        embedding: JSON.stringify(vecs[i]),
      }));
      await rest("rag_chunks", { method: "POST", prefer: "return=minimal", body: JSON.stringify(payload) });
      return json({ inserted: payload.length });
    }

    if (action === "finish") {
      const { document_id, chunk_count, status_message } = body;
      await rest(`rag_documents?id=eq.${document_id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify({ status: "ready", chunk_count, status_message: status_message ?? `${chunk_count} chunks` }),
      });
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

// Phase 1: dedup, create rag_documents, insert chunks (no embeddings). Bare fetch to PostgREST.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PG = `${SB_URL}/rest/v1`;
const H = { "Content-Type": "application/json", apikey: SK, Authorization: `Bearer ${SK}` };

function chunkText(text: string, size = 1500, overlap = 150): string[] {
  const c = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (c.length <= size) return [c];
  const out: string[] = [];
  let i = 0;
  while (i < c.length) {
    const end = Math.min(i + size, c.length);
    let slice = c.slice(i, end);
    if (end < c.length) {
      const lb = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (lb > size * 0.5) slice = slice.slice(0, lb + 1);
    }
    out.push(slice.trim());
    i += slice.length - overlap;
    if (i <= 0) i = end;
  }
  return out.filter(c => c.length > 30);
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { title, filename, content, document_type = "legal_research", tags = [] } = await req.json();
    if (!content || !title) throw new Error("title and content required");
    const hash = await sha256hex(content);

    // Dedup
    const dupRes = await fetch(`${PG}/rag_documents?sha256_hash=eq.${hash}&select=id,status,chunk_count`, { headers: H });
    const dup = await dupRes.json();
    if (Array.isArray(dup) && dup.length) {
      return new Response(JSON.stringify({ skipped: true, document_id: dup[0].id, reason: "duplicate" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chunks = chunkText(content);
    if (!chunks.length) throw new Error("no chunks");

    const docRes = await fetch(`${PG}/rag_documents`, {
      method: "POST", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        title, filename, storage_path: `inline://${hash}`,
        document_type, tags, sha256_hash: hash,
        file_size: content.length,
        mime_type: filename?.endsWith(".pdf") ? "application/pdf" : "text/markdown",
        status: "embedding", status_message: `phase1: ${chunks.length} chunks pending embed`,
        chunk_count: chunks.length,
        raw_text_preview: content.slice(0, 2000),
      }),
    });
    if (!docRes.ok) throw new Error(`doc insert ${docRes.status}: ${await docRes.text()}`);
    const documentId = (await docRes.json())[0].id;

    // Insert chunks in batches
    for (let i = 0; i < chunks.length; i += 200) {
      const batch = chunks.slice(i, i + 200).map((c, j) => ({
        document_id: documentId, chunk_index: i + j, content: c,
        token_estimate: Math.ceil(c.length / 4),
      }));
      const r = await fetch(`${PG}/rag_chunks`, { method: "POST", headers: H, body: JSON.stringify(batch) });
      if (!r.ok) throw new Error(`chunk batch ${i}: ${r.status} ${await r.text()}`);
    }

    // Mirror to evidence_documents (best-effort)
    await fetch(`${PG}/evidence_documents`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        title, filename, content: content.slice(0, 500000),
        file_size: content.length, document_type,
        tags: [...tags, "rag", "josiah_knowledge"], sha256_hash: hash,
      }),
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true, document_id: documentId, chunks: chunks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

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
    const body = await req.json();
    const title: string = body.title;
    const filename: string = body.filename;
    let content: string | null = body.content;
    const document_type: string = body.document_type || "legal_research";
    const tags: string[] = body.tags || [];
    if (!content || !title) throw new Error("title and content required");
    const hash = await sha256hex(content);
    const fileSize = content.length;
    const preview = content.slice(0, 2000);
    const mirrorContent = content.slice(0, 200000);

    // Dedup
    const dupRes = await fetch(`${PG}/rag_documents?sha256_hash=eq.${hash}&select=id`, { headers: H });
    const dup = await dupRes.json();
    if (Array.isArray(dup) && dup.length) {
      content = null;
      return new Response(JSON.stringify({ skipped: true, document_id: dup[0].id, reason: "duplicate" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chunks = chunkText(content);
    content = null; // free original
    if (!chunks.length) throw new Error("no chunks");

    const docRes = await fetch(`${PG}/rag_documents`, {
      method: "POST", headers: { ...H, Prefer: "return=representation" },
      body: JSON.stringify({
        title, filename, storage_path: `inline://${hash}`,
        document_type, tags, sha256_hash: hash,
        file_size: fileSize,
        mime_type: filename?.endsWith(".pdf") ? "application/pdf" : "text/markdown",
        status: "embedding", status_message: `phase1: ${chunks.length} chunks pending embed`,
        chunk_count: chunks.length,
        raw_text_preview: preview,
      }),
    });
    if (!docRes.ok) throw new Error(`doc insert ${docRes.status}: ${await docRes.text()}`);
    const documentId = (await docRes.json())[0].id;

    // Insert chunks in small batches
    for (let i = 0; i < chunks.length; i += 50) {
      const batch = [];
      const end = Math.min(i + 50, chunks.length);
      for (let j = i; j < end; j++) {
        batch.push({
          document_id: documentId, chunk_index: j, content: chunks[j],
          token_estimate: Math.ceil(chunks[j].length / 4),
        });
      }
      const r = await fetch(`${PG}/rag_chunks`, { method: "POST", headers: H, body: JSON.stringify(batch) });
      if (!r.ok) throw new Error(`chunk batch ${i}: ${r.status} ${await r.text()}`);
    }

    // Mirror to evidence_documents (best-effort, capped)
    await fetch(`${PG}/evidence_documents`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        title, filename, content: mirrorContent,
        file_size: fileSize, document_type,
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

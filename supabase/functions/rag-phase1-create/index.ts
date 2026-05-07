// Phase 1: dedup, create rag_documents row, chunk, insert rag_chunks WITHOUT embeddings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { title, filename, content, document_type = "legal_research", tags = [] } = await req.json();
    if (!content || !title) throw new Error("title and content required");

    const hash = await sha256hex(content);

    const { data: existing } = await supabase.from("rag_documents")
      .select("id,status,chunk_count").eq("sha256_hash", hash).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ skipped: true, document_id: existing.id, status: existing.status, chunks: existing.chunk_count, reason: "duplicate sha256" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunks");

    const { data: doc, error: dErr } = await supabase.from("rag_documents").insert({
      title, filename,
      storage_path: `inline://${hash}`,
      document_type, tags,
      sha256_hash: hash,
      file_size: content.length,
      mime_type: filename?.endsWith(".pdf") ? "application/pdf" : "text/markdown",
      status: "embedding",
      status_message: `phase1 done; ${chunks.length} chunks pending embed`,
      chunk_count: chunks.length,
      raw_text_preview: content.slice(0, 2000),
    }).select("id").single();
    if (dErr) throw new Error(`doc insert: ${dErr.message}`);

    const documentId = doc.id;
    const rows = chunks.map((c, i) => ({
      document_id: documentId, chunk_index: i, content: c,
      token_estimate: Math.ceil(c.length / 4), embedding: null,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("rag_chunks").insert(rows.slice(i, i + 200));
      if (error) throw new Error(`chunks: ${error.message}`);
    }

    // Mirror raw doc immediately so case files see it even if later phases fail
    await supabase.from("evidence_documents").insert({
      title, filename, content: content.slice(0, 500000),
      file_size: content.length, document_type,
      tags: [...tags, "rag", "josiah_knowledge"], sha256_hash: hash,
    });

    return new Response(JSON.stringify({ success: true, document_id: documentId, chunks: chunks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

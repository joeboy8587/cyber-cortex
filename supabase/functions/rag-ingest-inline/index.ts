// Bulk RAG ingest: accept text+title+filename inline, dedup by sha256, chunk+embed+extract+auto-promote.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTO_PROMOTE = 0.85;

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

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  return (await res.json()).data.map((d: any) => d.embedding);
}

async function extractEntities(fullText: string): Promise<any[]> {
  const sample = fullText.slice(0, 12000);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Extract investigative entities for federal RICO/Posse Comitatus prosecution. Focus on aircraft (N-numbers/ICAO), shells, persons, agencies, dates, locations, money, factual claims, legal violations. Return only items genuinely present, honest 0.0-1.0 confidence." },
        { role: "user", content: `Document:\n${sample}` },
      ],
      tools: [{
        type: "function", function: {
          name: "submit_extractions",
          parameters: {
            type: "object",
            properties: {
              extractions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    extraction_type: { type: "string", enum: ["aircraft","shell","person","agency","date","location","money","claim","violation","entity"] },
                    label: { type: "string" }, value: { type: "string" }, context: { type: "string" },
                    confidence: { type: "number" }
                  },
                  required: ["extraction_type","label","confidence"]
                }
              }
            }, required: ["extractions"]
          }
        }
      }],
      tool_choice: { type: "function", function: { name: "submit_extractions" } },
    }),
  });
  if (!res.ok) return [];
  const j = await res.json();
  try {
    const args = JSON.parse(j.choices[0].message.tool_calls[0].function.arguments);
    return args.extractions || [];
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { title, filename, content, document_type = "legal_research", tags = [] } = await req.json();
    if (!content || !title) throw new Error("title and content required");

    const hash = await sha256hex(content);

    // Strict dedup
    const { data: existing } = await supabase.from("rag_documents")
      .select("id,status").eq("sha256_hash", hash).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ skipped: true, document_id: existing.id, reason: "duplicate sha256" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Create document row (storage_path is required NOT NULL in table — use a synthetic path)
    const { data: doc, error: dErr } = await supabase.from("rag_documents").insert({
      title, filename,
      storage_path: `inline://${hash}`,
      document_type, tags,
      sha256_hash: hash,
      file_size: content.length,
      mime_type: filename.endsWith(".pdf") ? "application/pdf" : "text/markdown",
      status: "embedding",
      raw_text_preview: content.slice(0, 2000),
    }).select("id").single();
    if (dErr) throw new Error(`doc insert: ${dErr.message}`);

    const documentId = doc.id;
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error("no chunks");

    // Embed batched
    const rows: any[] = [];
    for (let i = 0; i < chunks.length; i += 64) {
      const batch = chunks.slice(i, i + 64);
      const vecs = await embed(batch);
      vecs.forEach((v, j) => rows.push({
        document_id: documentId, chunk_index: i + j, content: batch[j],
        token_estimate: Math.ceil(batch[j].length / 4), embedding: v,
      }));
    }

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from("rag_chunks").insert(rows.slice(i, i + 100));
      if (error) throw new Error(`chunks: ${error.message}`);
    }

    // Entities
    const ext = await extractEntities(content);
    let promoted = 0;
    for (const e of ext) {
      const conf = Math.max(0, Math.min(1, Number(e.confidence) || 0));
      const isHigh = conf >= AUTO_PROMOTE;
      let promoted_to: string | null = null;
      if (isHigh && ["claim","violation","aircraft","shell"].includes(e.extraction_type)) {
        const { data: f } = await supabase.from("watchtower_autonomous_flags").insert({
          flag_type: `rag_${e.extraction_type}`,
          severity: e.extraction_type === "violation" ? "high" : "medium",
          registration: e.extraction_type === "aircraft" ? e.label : null,
          description: `[${title}] ${e.label}: ${e.context || ""}`.slice(0, 1000),
          confidence_score: conf,
          evidence_summary: { source_document_id: documentId, extraction: e },
          source_scan_id: `rag:${documentId}`,
        }).select("id").single();
        if (f) { promoted_to = `watchtower_autonomous_flags:${f.id}`; promoted++; }
      }
      await supabase.from("rag_extractions").insert({
        document_id: documentId, extraction_type: e.extraction_type,
        label: String(e.label).slice(0, 500),
        value: e.value ? String(e.value).slice(0, 1000) : null,
        context: String(e.context || "").slice(0, 2000),
        confidence: conf, status: isHigh ? "auto_promoted" : "pending",
        promoted_to, promoted_at: isHigh ? new Date().toISOString() : null,
      });
    }

    await supabase.from("rag_documents").update({
      status: "ready", chunk_count: rows.length,
      status_message: `${rows.length} chunks, ${ext.length} extractions (${promoted} auto-promoted)`,
      extraction_summary: { total_extractions: ext.length, auto_promoted: promoted },
    }).eq("id", documentId);

    // Mirror into evidence_documents
    await supabase.from("evidence_documents").insert({
      title, filename, content: content.slice(0, 500000),
      file_size: content.length, document_type,
      tags: [...tags, "rag", "josiah_knowledge"], sha256_hash: hash,
    });

    return new Response(JSON.stringify({
      success: true, document_id: documentId, chunks: rows.length,
      extractions: ext.length, auto_promoted: promoted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

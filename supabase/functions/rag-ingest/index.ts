// Josiah RAG ingestion: parse → chunk → embed → auto-extract → high-conf auto-promote
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { partitionWithUnstructured, unstructuredSupports } from "../_shared/unstructured.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTO_PROMOTE_THRESHOLD = 0.85;

function chunkText(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= size) return clean.length > 0 ? [clean] : [];
  const chunks: string[] = [];
  let i = 0;
  // Guaranteed-terminating walk: the cursor always advances by at least
  // (size - overlap) characters, so no input can loop forever.
  const step = Math.max(1, size - overlap);
  while (i < clean.length) {
    const end = Math.min(i + size, clean.length);
    let slice = clean.slice(i, end);
    if (end < clean.length) {
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "));
      if (lastBreak > size * 0.5) slice = slice.slice(0, lastBreak + 1);
    }
    chunks.push(slice.trim());
    i += Math.max(step, slice.length - overlap);
  }
  return chunks.filter((c) => c.length > 30);
}


async function parsePdf(bytes: Uint8Array): Promise<string> {
  // Use unpdf — Deno-compatible, no native canvas dependency
  const { extractText } = await import("https://esm.sh/unpdf@0.12.1");
  const { text } = await extractText(bytes, { mergePages: true });
  const full = Array.isArray(text) ? text.join("\n\n") : String(text || "");
  // Cap to keep within embedding/token budgets
  return full.slice(0, 400000);
}

async function embed(texts: string[]): Promise<number[][]> {
  // Lovable AI Gateway exposes OpenAI-compatible embeddings via openai/text-embedding-3-small (1536 dim)
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.data.map((d: any) => d.embedding);
}

async function extractEntities(fullText: string): Promise<any[]> {
  const sample = fullText.slice(0, 12000);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You extract investigative entities from documents for a federal RICO/Posse Comitatus prosecution. Focus on aircraft (N-numbers, callsigns, ICAO hex), shell companies, named individuals, government agencies (KCSO, FAA, DOD), dates/timestamps, locations, monetary amounts, claims of fact, and explicit legal violations. Return only items genuinely present and assign honest 0.0–1.0 confidence." },
        { role: "user", content: `Extract investigative entities/claims from this document. Return JSON via tool call.\n\nDOCUMENT:\n${sample}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "submit_extractions",
          description: "Submit extracted entities and factual claims",
          parameters: {
            type: "object",
            properties: {
              extractions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    extraction_type: { type: "string", enum: ["aircraft", "shell", "person", "agency", "date", "location", "money", "claim", "violation", "entity"] },
                    label: { type: "string", description: "Short identifier (e.g. N912KC, KCSO, 2024-12-27)" },
                    value: { type: "string", description: "Normalized value if different from label" },
                    context: { type: "string", description: "Surrounding sentence or paragraph from the document" },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                  },
                  required: ["extraction_type", "label", "context", "confidence"],
                },
              },
            },
            required: ["extractions"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_extractions" } },
    }),
  });
  if (!res.ok) {
    console.error("extract error", res.status, await res.text());
    return [];
  }
  const j = await res.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return [];
  try { return JSON.parse(args).extractions || []; } catch { return []; }
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

const TERMINAL = ["ready", "failed"];
const STUCK_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let documentId: string | null = null;

  try {
    const body = await req.json().catch(() => ({} as any));
    const action = body?.action;

    // ---- Pipeline health / repair actions -------------------------------
    if (action === "status" || action === "repair_stuck") {
      const stuckMinutes = Number(body?.stuck_minutes) > 0 ? Number(body.stuck_minutes) : STUCK_MINUTES;
      const cutoff = new Date(Date.now() - stuckMinutes * 60_000).toISOString();
      const { data: docs, error } = await supabase
        .from("rag_documents")
        .select("id,title,status,status_message,updated_at,chunk_count")
        .order("updated_at", { ascending: true });
      if (error) throw error;

      const all = docs ?? [];
      const counts: Record<string, number> = {};
      for (const d of all) counts[d.status] = (counts[d.status] || 0) + 1;
      const stuck = all.filter((d) => !TERMINAL.includes(d.status) && d.updated_at < cutoff);

      if (action === "status") {
        return new Response(JSON.stringify({ counts, total: all.length, stuck }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // repair_stuck — re-run the pipeline STRICTLY ONE DOCUMENT AT A TIME.
      // Parallel dispatch blew the worker memory limit and tripped the
      // Unstructured 1-request/second job limit, so keep it serial.
      const limit = Math.min(Number(body?.limit) || 3, 5);
      const batch = stuck.slice(0, limit);
      const startedAt = Date.now();
      const done: any[] = [];

      for (const d of batch) {
        if (Date.now() - startedAt > 100_000) break; // stay inside the 150s request limit
        // Clear half-written chunks so the re-run starts clean.
        await supabase.from("rag_chunks").delete().eq("document_id", d.id);
        await supabase.from("rag_documents")
          .update({ status: "queued", status_message: "Re-queued by pipeline repair", chunk_count: 0 })
          .eq("id", d.id);
        const ac = new AbortController();
        const cap = setTimeout(() => ac.abort(), Math.max(15_000, 100_000 - (Date.now() - startedAt)));
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/rag-ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ document_id: d.id }),
            signal: ac.signal,
          });
          done.push({ id: d.id, title: d.title, was: d.status, ok: res.ok });
        } catch (e) {
          // Aborted runs keep processing on their own worker; report as in progress.
          console.error("repair run detached", d.id, e);
          done.push({ id: d.id, title: d.title, was: d.status, ok: true, still_running: true });
        } finally {
          clearTimeout(cap);
        }
        // Respect the Unstructured 1 req/sec job-submission limit.
        await new Promise((r) => setTimeout(r, 1500));
      }


      return new Response(JSON.stringify({
        ok: true,
        counts,
        stuck_total: stuck.length,
        requeued: done,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    }

    documentId = body?.document_id;
    if (!documentId) throw new Error("document_id required");


    const { data: doc, error: docErr } = await supabase
      .from("rag_documents").select("*").eq("id", documentId).single();
    if (docErr || !doc) throw new Error("document not found");

    const update = (patch: any) => supabase.from("rag_documents").update(patch).eq("id", documentId);

    await update({ status: "parsing", status_message: "Downloading file" });

    const { data: fileBlob, error: dlErr } = await supabase.storage
      .from("rag-uploads").download(doc.storage_path);
    if (dlErr || !fileBlob) throw new Error(`download: ${dlErr?.message}`);

    const buf = await fileBlob.arrayBuffer();
    const hash = await sha256(buf);
    const bytes = new Uint8Array(buf);

    let text = "";
    let parser = "text";
    const ext = (doc.filename.split(".").pop() || "").toLowerCase();
    const mime = (doc.mime_type || "").toLowerCase();
    const hasUnstructured = !!Deno.env.get("UNSTRUCTURED_API_KEY");

    if (hasUnstructured && unstructuredSupports(doc.filename, doc.mime_type)) {
      try {
        await update({ status: "parsing", status_message: "Unstructured: partitioning + OCR" });
        const res = await partitionWithUnstructured(bytes, doc.filename, doc.mime_type);
        text = res.text;
        parser = `unstructured:${res.strategy}`;
        await update({
          status: "parsing",
          status_message: `Unstructured: ${res.elementCount} elements, ${res.tableCount} tables${res.ocr ? " (OCR)" : ""}`,
        });
      } catch (e) {
        console.error("unstructured failed, falling back", e);
      }
    }

    if (!text || text.trim().length < 20) {
      if (ext === "pdf" || mime.includes("pdf")) {
        await update({ status: "parsing", status_message: "Extracting PDF text (fallback)" });
        text = await parsePdf(bytes);
        parser = "unpdf";
      } else if (!mime.startsWith("image/")) {
        text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        parser = "text";
      }
    }

    if (!text || text.trim().length < 20) throw new Error("no extractable text");
    console.log(`[rag-ingest] parsed ${doc.filename} via ${parser} (${text.length} chars)`);


    await update({
      status: "chunking",
      status_message: "Splitting into chunks",
      sha256_hash: hash,
      raw_text_preview: text.slice(0, 2000),
    });

    console.log(`[rag-ingest] chunking start mem=${JSON.stringify(Deno.memoryUsage())}`);
    const chunks = chunkText(text.slice(0, 200000));
    console.log(`[rag-ingest] chunking done: ${chunks.length} chunks mem=${JSON.stringify(Deno.memoryUsage())}`);
    if (chunks.length === 0) throw new Error("no chunks produced");

    await update({ status: "embedding", status_message: `Embedding ${chunks.length} chunks` });


    // Embed AND insert in small waves so vectors are never all held in memory
    // at once (large documents previously blew the worker memory limit).
    let inserted = 0;
    for (let i = 0; i < chunks.length; i += 24) {
      const batch = chunks.slice(i, i + 24);
      const vecs = await embed(batch);
      const rows = vecs.map((v, j) => ({
        document_id: documentId,
        chunk_index: i + j,
        content: batch[j],
        token_estimate: Math.ceil(batch[j].length / 4),
        embedding: v,
      }));
      const { error } = await supabase.from("rag_chunks").insert(rows);
      if (error) throw new Error(`chunks insert: ${error.message}`);
      inserted += rows.length;
      rows.length = 0;
      vecs.length = 0;
      if (i % 120 === 0) {
        await update({ status: "embedding", status_message: `Embedded ${inserted}/${chunks.length} chunks` });
      }
    }
    const allRows = { length: inserted };

    await update({ status: "analyzing", status_message: "Extracting entities", chunk_count: inserted });


    const extractions = await extractEntities(text);
    let autoPromoted = 0;

    for (const ex of extractions) {
      const conf = Math.max(0, Math.min(1, Number(ex.confidence) || 0));
      const isHigh = conf >= AUTO_PROMOTE_THRESHOLD;
      const status = isHigh ? "auto_promoted" : "pending";
      let promoted_to: string | null = null;

      if (isHigh) {
        // Promote a flag for high-confidence claim/violation/aircraft entries
        if (["claim", "violation", "aircraft", "shell"].includes(ex.extraction_type)) {
          const { data: flag } = await supabase.from("watchtower_autonomous_flags").insert({
            flag_type: `rag_${ex.extraction_type}`,
            severity: ex.extraction_type === "violation" ? "high" : "medium",
            registration: ex.extraction_type === "aircraft" ? ex.label : null,
            description: `[Doc: ${doc.title}] ${ex.label}: ${ex.context}`.slice(0, 1000),
            confidence_score: conf,
            evidence_summary: { source_document_id: documentId, extraction: ex },
            source_scan_id: `rag:${documentId}`,
          }).select("id").single();
          if (flag) promoted_to = `watchtower_autonomous_flags:${flag.id}`;
          autoPromoted++;
        }
      }

      await supabase.from("rag_extractions").insert({
        document_id: documentId,
        extraction_type: ex.extraction_type,
        label: String(ex.label).slice(0, 500),
        value: ex.value ? String(ex.value).slice(0, 1000) : null,
        context: String(ex.context || "").slice(0, 2000),
        confidence: conf,
        status,
        promoted_to,
        promoted_at: isHigh ? new Date().toISOString() : null,
      });
    }

    // Mirror into evidence_documents for case-file visibility
    await supabase.from("evidence_documents").insert({
      title: doc.title,
      filename: doc.filename,
      content: text.slice(0, 500000),
      file_size: doc.file_size,
      document_type: doc.document_type || "rag_ingested",
      tags: [...(doc.tags || []), "rag", "josiah_knowledge"],
      sha256_hash: hash,
    });

    await update({
      status: "ready",
      status_message: `Ingested ${allRows.length} chunks, ${extractions.length} extractions (${autoPromoted} auto-promoted)`,
      extraction_summary: {
        total_extractions: extractions.length,
        auto_promoted: autoPromoted,
        by_type: extractions.reduce((acc: any, e: any) => {
          acc[e.extraction_type] = (acc[e.extraction_type] || 0) + 1; return acc;
        }, {}),
      },
    });

    return new Response(JSON.stringify({
      success: true,
      document_id: documentId,
      chunks: allRows.length,
      extractions: extractions.length,
      auto_promoted: autoPromoted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("rag-ingest error:", err);
    if (documentId) {
      await supabase.from("rag_documents").update({
        status: "failed", status_message: (err as Error).message?.slice(0, 500),
      }).eq("id", documentId);
    }
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

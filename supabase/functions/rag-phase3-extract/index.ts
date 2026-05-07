// Phase 3: extract entities + auto-promote high-confidence flags. Finalizes status=ready.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTO_PROMOTE = 0.85;

async function extractEntities(title: string, fullText: string): Promise<any[]> {
  const sample = fullText.slice(0, 12000);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Extract investigative entities for federal RICO/Posse Comitatus prosecution. Focus on aircraft (N-numbers/ICAO), shells, persons, agencies, dates, locations, money, factual claims, legal violations. Return only items genuinely present, honest 0.0-1.0 confidence." },
        { role: "user", content: `Document: ${title}\n\n${sample}` },
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
    return JSON.parse(j.choices[0].message.tool_calls[0].function.arguments).extractions || [];
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id required");

    const { data: doc } = await supabase.from("rag_documents")
      .select("id,title,raw_text_preview,chunk_count").eq("id", document_id).single();
    if (!doc) throw new Error("doc not found");

    // Reconstruct enough text from first chunks to feed extraction
    const { data: chunks } = await supabase.from("rag_chunks")
      .select("content").eq("document_id", document_id)
      .order("chunk_index", { ascending: true }).limit(10);
    const fullText = (chunks || []).map(c => c.content).join("\n\n") || doc.raw_text_preview || "";

    const ext = await extractEntities(doc.title, fullText);
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
          description: `[${doc.title}] ${e.label}: ${e.context || ""}`.slice(0, 1000),
          confidence_score: conf,
          evidence_summary: { source_document_id: document_id, extraction: e },
          source_scan_id: `rag:${document_id}`,
        }).select("id").single();
        if (f) { promoted_to = `watchtower_autonomous_flags:${f.id}`; promoted++; }
      }
      await supabase.from("rag_extractions").insert({
        document_id, extraction_type: e.extraction_type,
        label: String(e.label).slice(0, 500),
        value: e.value ? String(e.value).slice(0, 1000) : null,
        context: String(e.context || "").slice(0, 2000),
        confidence: conf, status: isHigh ? "auto_promoted" : "pending",
        promoted_to, promoted_at: isHigh ? new Date().toISOString() : null,
      });
    }

    await supabase.from("rag_documents").update({
      status: "ready",
      status_message: `${doc.chunk_count} chunks, ${ext.length} extractions (${promoted} auto-promoted)`,
      extraction_summary: { total_extractions: ext.length, auto_promoted: promoted },
    }).eq("id", document_id);

    return new Response(JSON.stringify({ success: true, document_id, extractions: ext.length, auto_promoted: promoted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

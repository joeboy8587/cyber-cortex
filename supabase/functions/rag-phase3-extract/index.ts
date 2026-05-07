// Phase 3: extract entities + auto-promote. Bare fetch.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const LOVABLE = Deno.env.get("LOVABLE_API_KEY")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PG = `${SB_URL}/rest/v1`;
const H = { "Content-Type": "application/json", apikey: SK, Authorization: `Bearer ${SK}` };
const AUTO = 0.85;

async function extract(title: string, text: string): Promise<any[]> {
  const sample = text.slice(0, 12000);
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Extract investigative entities for federal RICO/Posse Comitatus prosecution. Aircraft (N-numbers/ICAO), shells, persons, agencies, dates, locations, money, factual claims, legal violations. Honest 0.0-1.0 confidence." },
        { role: "user", content: `Document: ${title}\n\n${sample}` },
      ],
      tools: [{ type: "function", function: {
        name: "submit_extractions",
        parameters: {
          type: "object",
          properties: { extractions: { type: "array", items: {
            type: "object",
            properties: {
              extraction_type: { type: "string", enum: ["aircraft","shell","person","agency","date","location","money","claim","violation","entity"] },
              label: { type: "string" }, value: { type: "string" }, context: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["extraction_type","label","confidence"],
          }}},
          required: ["extractions"],
        },
      }}],
      tool_choice: { type: "function", function: { name: "submit_extractions" } },
    }),
  });
  if (!r.ok) return [];
  const j = await r.json();
  try { return JSON.parse(j.choices[0].message.tool_calls[0].function.arguments).extractions || []; }
  catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id required");

    const dr = await fetch(`${PG}/rag_documents?id=eq.${document_id}&select=id,title,raw_text_preview,chunk_count`, { headers: H });
    const docs = await dr.json();
    if (!Array.isArray(docs) || !docs.length) throw new Error("doc not found");
    const doc = docs[0];

    const cr = await fetch(`${PG}/rag_chunks?document_id=eq.${document_id}&select=content&order=chunk_index.asc&limit=10`, { headers: H });
    const chunks = await cr.json() as Array<{ content: string }>;
    const fullText = chunks.map(c => c.content).join("\n\n") || doc.raw_text_preview || "";

    const ext = await extract(doc.title, fullText);
    let promoted = 0;

    for (const e of ext) {
      const conf = Math.max(0, Math.min(1, Number(e.confidence) || 0));
      const isHigh = conf >= AUTO;
      let promoted_to: string | null = null;

      if (isHigh && ["claim","violation","aircraft","shell"].includes(e.extraction_type)) {
        const fr = await fetch(`${PG}/watchtower_autonomous_flags`, {
          method: "POST", headers: { ...H, Prefer: "return=representation" },
          body: JSON.stringify({
            flag_type: `rag_${e.extraction_type}`,
            severity: e.extraction_type === "violation" ? "high" : "medium",
            registration: e.extraction_type === "aircraft" ? e.label : null,
            description: `[${doc.title}] ${e.label}: ${e.context || ""}`.slice(0, 1000),
            confidence_score: conf,
            evidence_summary: { source_document_id: document_id, extraction: e },
            source_scan_id: `rag:${document_id}`,
          }),
        });
        if (fr.ok) {
          const f = (await fr.json())[0];
          promoted_to = `watchtower_autonomous_flags:${f.id}`;
          promoted++;
        }
      }

      await fetch(`${PG}/rag_extractions`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          document_id, extraction_type: e.extraction_type,
          label: String(e.label).slice(0, 500),
          value: e.value ? String(e.value).slice(0, 1000) : null,
          context: String(e.context || "").slice(0, 2000),
          confidence: conf, status: isHigh ? "auto_promoted" : "pending",
          promoted_to, promoted_at: isHigh ? new Date().toISOString() : null,
        }),
      });
    }

    await fetch(`${PG}/rag_documents?id=eq.${document_id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({
        status: "ready",
        status_message: `${doc.chunk_count} chunks, ${ext.length} extractions (${promoted} auto-promoted)`,
        extraction_summary: { total_extractions: ext.length, auto_promoted: promoted },
      }),
    });

    return new Response(JSON.stringify({ success: true, document_id, extractions: ext.length, auto_promoted: promoted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

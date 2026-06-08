// Phase 2 — Corpus Reasoner
// Runs 4 parallel embedding queries (operator, regulations, doctrine, precedent)
// against rag_chunks and synthesizes a grounded brief for a given detection.
// Outputs hashed to reasoning_outputs for chain-of-custody.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LENSES = [
  { key: "operator", template: (s: string) => `operator history, fleet ownership, shell company affiliation for ${s}` },
  { key: "regulations", template: (s: string) => `FAA regulations, 14 CFR § 91.119, transponder Part 91 violations relevant to ${s}` },
  { key: "doctrine", template: (s: string) => `Posse Comitatus, Fourth Amendment, RICO, surveillance doctrine concerning ${s}` },
  { key: "precedent", template: (s: string) => `prior detections, precedent patterns, similar incidents to ${s}` },
];

async function embed(text: string): Promise<number[]> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text.slice(0, 8000) }),
  });
  if (!r.ok) throw new Error(`embed ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { detection_ref, subject, match_count = 4 } = await req.json();
    if (!subject || typeof subject !== "string") throw new Error("subject required (e.g. 'N913WN 1000ft 223kts over Oildale')");

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 4 parallel embeddings
    const queries = LENSES.map(l => l.template(subject));
    const embeddings = await Promise.all(queries.map(embed));

    // 4 parallel pgvector searches
    const lensResults = await Promise.all(
      embeddings.map(async (emb, i) => {
        const { data, error } = await supabase.rpc("match_rag_chunks", {
          query_embedding: emb,
          match_count: Math.min(match_count, 6),
          similarity_threshold: 0.35,
        });
        if (error) return { lens: LENSES[i].key, matches: [], error: error.message };
        return {
          lens: LENSES[i].key,
          matches: (data || []).map((m: any) => ({
            title: m.document_title,
            similarity: Number(m.similarity).toFixed(3),
            content: String(m.content || "").slice(0, 600),
          })),
        };
      })
    );

    // Compose grounded brief (deterministic, no LLM rewriting — preserve provenance)
    const sections = lensResults.map(lr => {
      if (!lr.matches?.length) return `### ${lr.lens.toUpperCase()}\n_no corpus matches_`;
      return `### ${lr.lens.toUpperCase()}\n` + lr.matches.map((m: any, i: number) =>
        `[${i + 1}] ${m.title} (sim ${m.similarity})\n${m.content}`
      ).join("\n\n");
    });

    const brief = `# GROUNDED CONTEXT BRIEF\nSubject: ${subject}\n\n${sections.join("\n\n---\n\n")}`;
    const content_hash = await sha256(brief);

    const total_matches = lensResults.reduce((s, l) => s + (l.matches?.length || 0), 0);

    // Audit log
    await supabase.from("reasoning_outputs").insert({
      module: "corpus-reasoner",
      detection_ref: detection_ref || subject.slice(0, 120),
      content_hash,
      payload: { subject, lenses: lensResults, total_matches },
    });

    return new Response(JSON.stringify({
      subject,
      detection_ref: detection_ref || null,
      lenses: lensResults,
      total_matches,
      brief,
      content_hash,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("corpus-reasoner error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

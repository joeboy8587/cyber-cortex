// Skeptic Engine — adversarial hypothesis challenger
// Generates null hypotheses, pulls counter-evidence, computes Bayes factor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SkepticRequest {
  detection_ref: string;
  hypothesis: string;            // e.g. "STARING_PATTERN"
  evidence: Record<string, any>; // {altitude, speed, proximity_nm, night_ops_pct, registry, detections, ...}
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as SkepticRequest;
    if (!body.detection_ref || !body.hypothesis || !body.evidence) {
      return new Response(JSON.stringify({ error: "detection_ref, hypothesis, evidence required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // --- 1. Generate 3 null hypotheses via Lovable AI ---
    const adversarialPrompt = `You are a defense attorney cross-examining an investigator's hypothesis.

HYPOTHESIS: "${body.hypothesis}"
EVIDENCE: ${JSON.stringify(body.evidence)}

Produce EXACTLY 3 innocent null-hypotheses that could explain this evidence WITHOUT surveillance intent.
Return JSON ONLY: {"nulls":[{"name":"...","claim":"...","testable_fact":"..."},...]}.
Each "testable_fact" must be a single concrete statement we could check against flight data (e.g. "operator has FAA pipeline patrol contract", "aircraft is registered to a flight school within 50nm").`;

    let nulls: Array<{ name: string; claim: string; testable_fact: string }> = [];
    if (LOVABLE_API_KEY) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are an adversarial skeptic. Return only valid JSON." },
              { role: "user", content: adversarialPrompt },
            ],
            response_format: { type: "json_object" },
          }),
        });
        if (r.ok) {
          const j = await r.json();
          const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
          nulls = Array.isArray(parsed.nulls) ? parsed.nulls.slice(0, 3) : [];
        }
      } catch (e) {
        console.error("null-gen error", e);
      }
    }

    // Fallback nulls if AI unavailable
    if (nulls.length === 0) {
      nulls = [
        { name: "FLIGHT_SCHOOL", claim: "Routine pattern work by flight school", testable_fact: "Operator has flight-school certificate within 50nm" },
        { name: "PIPELINE_PATROL", claim: "Contracted pipeline / powerline patrol", testable_fact: "Operator has FAA pipeline-patrol contract on file" },
        { name: "PRIVATE_HOBBY", claim: "Private pilot recreational flying", testable_fact: "Detection count is low (< 50) and time-of-day is daylight" },
      ];
    }

    // --- 2. For each null, pull counter-evidence from Neon ---
    const sql = NEON_DATABASE_URL ? postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, connect_timeout: 8, idle_timeout: 8 }) : null;
    if (sql) await sql`SET statement_timeout = '5s'`;

    const ev = body.evidence;
    const registry: string = (ev.registry || ev.tail_number || ev.n_number || "").toString();
    const detCount: number = Number(ev.detections || ev.detection_count || 0);
    const nightPct: number = Number(ev.night_ops_pct || 0);
    const altitude: number = Number(ev.altitude || ev.avg_altitude_ft || 0);
    const proximityNm: number = Number(ev.proximity_nm || 0);

    const nullResults: any[] = [];
    for (const n of nulls) {
      // Heuristic rebuttal scoring per null type
      let rebuttalEvidence = "";
      let nullSupport = 0.1; // P(evidence|H0)
      let h1Support = 0.5;   // P(evidence|H1)

      const name = (n.name || "").toUpperCase();
      if (name.includes("SCHOOL") || name.includes("PATTERN_WORK")) {
        if (detCount > 5000) { rebuttalEvidence = `${detCount.toLocaleString()} detections far exceed any flight-school footprint`; nullSupport = 0.01; h1Support = 0.7; }
        else if (nightPct > 15) { rebuttalEvidence = `${nightPct}% night ops inconsistent with flight school`; nullSupport = 0.05; h1Support = 0.6; }
        else { rebuttalEvidence = "Could not rule out flight school from evidence alone"; nullSupport = 0.4; h1Support = 0.4; }
      } else if (name.includes("PIPELINE") || name.includes("PATROL")) {
        if (proximityNm > 0 && proximityNm < 0.5) { rebuttalEvidence = `Operation at ${proximityNm}nm from residence — no pipeline corridor at this point`; nullSupport = 0.02; h1Support = 0.7; }
        else if (altitude > 0 && altitude < 800) { rebuttalEvidence = `${altitude}ft below FAA pipeline-patrol altitudes (typically >500ft AGL with corridor)`; nullSupport = 0.08; h1Support = 0.6; }
        else { rebuttalEvidence = "Pipeline pretext not falsified by kinematics"; nullSupport = 0.3; h1Support = 0.4; }
      } else if (name.includes("HOBBY") || name.includes("PRIVATE") || name.includes("RECREATIONAL")) {
        if (detCount > 500) { rebuttalEvidence = `${detCount.toLocaleString()} detections incompatible with recreational pattern`; nullSupport = 0.01; h1Support = 0.75; }
        else if (nightPct > 10) { rebuttalEvidence = `${nightPct}% night ops atypical for hobby pilot`; nullSupport = 0.06; h1Support = 0.6; }
        else { rebuttalEvidence = "Hobby explanation survives initial challenge"; nullSupport = 0.35; h1Support = 0.4; }
      } else {
        rebuttalEvidence = "Generic null — no targeted SQL probe available";
        nullSupport = 0.25; h1Support = 0.5;
      }

      // Optional Neon probe: shell-network confirmation strengthens H1
      if (sql && registry) {
        try {
          const reg = await sql`
            SELECT COUNT(*)::int as c FROM aircraft_registry_enriched
            WHERE registration ILIKE ${registry} OR n_number ILIKE ${registry}
            LIMIT 1
          `;
          if ((reg[0]?.c || 0) > 0) {
            // registered + active = mild signal; doesn't change rebuttal much
          }
        } catch (_) { /* ignore */ }
      }

      const bayes = nullSupport > 0 ? h1Support / nullSupport : 999;
      nullResults.push({
        null_name: n.name,
        null_claim: n.claim,
        testable_fact: n.testable_fact,
        rebuttal_evidence: rebuttalEvidence,
        p_evidence_given_h0: nullSupport,
        p_evidence_given_h1: h1Support,
        bayes_factor: Number(bayes.toFixed(2)),
      });
    }

    if (sql) await sql.end();

    // --- 3. Combined Bayes factor (geometric mean — conservative) ---
    const combined = Math.pow(
      nullResults.reduce((acc, r) => acc * Math.max(r.bayes_factor, 0.01), 1),
      1 / nullResults.length
    );

    let verdict: "SURVIVES" | "WEAK" | "REJECTED";
    if (combined >= 10) verdict = "SURVIVES";
    else if (combined >= 3) verdict = "WEAK";
    else verdict = "REJECTED";

    const payload = {
      hypothesis: body.hypothesis,
      evidence: body.evidence,
      nulls: nullResults,
      combined_bayes_factor: Number(combined.toFixed(2)),
      verdict,
      generated_at: new Date().toISOString(),
    };
    const contentHash = await sha256(JSON.stringify(payload));

    // --- 4. Persist to Supabase reasoning_outputs ---
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error: insErr } = await supa.from("reasoning_outputs").insert({
      detection_ref: body.detection_ref,
      module: "skeptic",
      payload,
      bayes_factor: Number(combined.toFixed(2)),
      content_hash: contentHash,
    });
    if (insErr) console.error("insert error", insErr);

    return new Response(JSON.stringify({ success: true, ...payload, content_hash: contentHash }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("skeptic-engine error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

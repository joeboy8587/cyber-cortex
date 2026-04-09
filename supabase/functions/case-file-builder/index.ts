import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BuildRequest {
  caseCode: string; // e.g. "CASE-001-RICO"
  mode: "scan" | "build" | "promote";
  exhibitCode?: string; // e.g. "EXHIBIT-A" for targeted build
  timeWindow?: string; // e.g. "90 days"
}

async function queryNeonForCase(sql: ReturnType<typeof postgres>, caseCode: string, timeWindow: string) {
  const context: Record<string, unknown[]> = {};

  // Query strategy based on case type
  if (caseCode.includes("RICO")) {
    const [enterprise, shells, violations, financials] = await Promise.all([
      sql`SELECT entity_name, tier, role, legal_exposure FROM criminal_enterprise_command_structure ORDER BY tier LIMIT 25`.catch(() => []),
      sql`SELECT company_name, registration_state, linked_registrations, risk_score FROM shell_company_evidence_rows ORDER BY risk_score DESC LIMIT 20`.catch(() => []),
      sql`SELECT violation_type, violation_date, severity, registration, statute FROM legal_violations_rows WHERE violation_date > NOW() - ${timeWindow}::interval ORDER BY violation_date DESC LIMIT 50`.catch(() => []),
      sql`SELECT entity_name, financial_link_type, amount, source_document FROM rico_financial_links ORDER BY amount DESC LIMIT 20`.catch(() => []),
    ]);
    context.enterprise = enterprise;
    context.shells = shells;
    context.violations = violations;
    context.financials = financials;
  }

  if (caseCode.includes("POSSE") || caseCode.includes("MILITARY")) {
    const [military, coordination] = await Promise.all([
      sql`SELECT registration, callsign, taxonomy_tag, detection_count FROM (
        SELECT registration, callsign, taxonomy_tag, COUNT(*) as detection_count
        FROM live_flight_detections_rows
        WHERE taxonomy_tag ILIKE '%military%' OR taxonomy_tag ILIKE '%gov%'
        AND detection_timestamp > NOW() - ${timeWindow}::interval
        GROUP BY registration, callsign, taxonomy_tag
        ORDER BY detection_count DESC LIMIT 20
      ) sub`.catch(() => []),
      sql`SELECT * FROM military_civilian_coordination_events ORDER BY event_date DESC LIMIT 20`.catch(() => []),
    ]);
    context.military = military;
    context.coordination = coordination;
  }

  if (caseCode.includes("FAA")) {
    const [altitudeViolations, transponder, physics] = await Promise.all([
      sql`SELECT registration, altitude_ft, event_timestamp, violation_type FROM altitude_violation_events WHERE altitude_ft < 1000 ORDER BY event_timestamp DESC LIMIT 50`.catch(() => []),
      sql`SELECT registration, event_type, detection_timestamp, details FROM transponder_anomaly_events ORDER BY detection_timestamp DESC LIMIT 30`.catch(() => []),
      sql`SELECT registration, anomaly_type, speed_knots, altitude_ft, confidence FROM physics_violation_detections ORDER BY confidence DESC LIMIT 30`.catch(() => []),
    ]);
    context.altitudeViolations = altitudeViolations;
    context.transponder = transponder;
    context.physics = physics;
  }

  if (caseCode.includes("CIVIL")) {
    const [biometric, stress, targeting] = await Promise.all([
      sql`SELECT timestamp, hr_bpm, hrv_ms, stress_level, correlation_strength, grade_classification FROM biometric_aircraft_correlations WHERE grade_classification IN ('A', 'B') ORDER BY timestamp DESC LIMIT 50`.catch(() => []),
      sql`SELECT event_timestamp, stress_level, hr_bpm, hrv_ms, aircraft_count FROM biometric_stress_events WHERE stress_level IN ('critical', 'severe') ORDER BY event_timestamp DESC LIMIT 30`.catch(() => []),
      sql`SELECT pattern_type, frequency, duration_hours, target_area FROM targeting_pattern_analysis ORDER BY frequency DESC LIMIT 20`.catch(() => []),
    ]);
    context.biometric = biometric;
    context.stress = stress;
    context.targeting = targeting;
  }

  // Always get cross-cutting data
  const [threats, flags, forensicEvents] = await Promise.all([
    sql`SELECT registration, threat_type, escalation_level, total_violations, avg_altitude FROM sentinel_learned_threats ORDER BY escalation_level DESC LIMIT 15`.catch(() => []),
    sql`SELECT flag_type, severity, registration, description, confidence_score FROM watchtower_autonomous_flags WHERE auto_resolved = false ORDER BY created_at DESC LIMIT 15`.catch(() => []),
    sql`SELECT event_type, event_timestamp, summary, confidence_score, bradford_hill_score, factor_count FROM master_forensic_events_rows WHERE confidence_score > 70 ORDER BY event_timestamp DESC LIMIT 20`.catch(() => []),
  ]);
  context.threats = threats;
  context.flags = flags;
  context.forensicEvents = forensicEvents;

  return context;
}

function buildSystemPrompt(caseCode: string) {
  return `You are an AUTONOMOUS CASE FILE BUILDER for federal prosecution. You analyze raw multimodal database records and structure them into court-ready case files.

CASE: ${caseCode}

YOUR MISSION:
1. Analyze the provided database context (real data from 900+ tables, 20M+ records)
2. Identify the strongest evidence for this specific legal theory
3. Structure findings into a forensically defensible case file
4. Apply the EXHIBIT TIER system (Tier 1: Smoking Gun → Tier 4: Supporting)
5. Recommend which records should be PROMOTED from Universe to Exhibits

OUTPUT FORMAT (use this exact structure):
## CASE FILE: ${caseCode}
### Generated: [current date]

### EXECUTIVE SUMMARY
[2-3 paragraph summary of findings]

### KEY FINDINGS
[Numbered list of the most important discoveries]

### EXHIBIT RECOMMENDATIONS
For each recommended exhibit:
- **Exhibit Code**: [e.g. EXHIBIT-A]
- **Tier**: [1-4]
- **Evidence Type**: [e.g. Financial, Biometric, Flight Data]
- **Description**: [What this exhibit proves]
- **Source Records**: [Which tables/records support this]
- **Legal Significance**: [How this advances the legal theory]
- **Promotion Rule**: [The objective criteria that qualifies this - e.g. "altitude < 500ft AND correlation_strength > 0.8"]

### PROSECUTION STRENGTH ASSESSMENT
- Overall strength: [1-10]
- Strongest element: [description]
- Weakest element: [description]  
- Recommended next steps: [what data to gather next]

### AUDIT TRAIL
- Records analyzed: [count]
- Tables queried: [list]
- Time window: [period]
- Selection criteria: [objective rules used]

RULES:
- NEVER fabricate data. Only reference records from the provided context.
- ALWAYS cite specific registrations, dates, and values from the data.
- ALWAYS recommend objective promotion rules (SQL-like conditions).
- Flag any gaps in evidence coverage.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { caseCode, mode, exhibitCode, timeWindow = "365 days" }: BuildRequest = await req.json();

    if (!caseCode) {
      return new Response(JSON.stringify({ error: "caseCode is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Query Neon for case-specific data
    let neonContext: Record<string, unknown[]> = {};
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 20, connect_timeout: 15 });
      try {
        neonContext = await queryNeonForCase(sql, caseCode, timeWindow);
      } finally {
        await sql.end();
      }
    }

    // Also get Supabase evidence docs relevant to this case
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get existing exhibits and case info
    const [{ data: caseData }, { data: exhibits }, { data: docs }] = await Promise.all([
      supabase.from("cases").select("*").eq("case_code", caseCode).single(),
      supabase.from("exhibits").select("*").order("tier", { ascending: true }),
      supabase.from("evidence_documents").select("title, document_type, tags, sha256_hash, file_size").order("uploaded_at", { ascending: false }).limit(30),
    ]);

    const contextPayload = JSON.stringify({
      caseInfo: caseData,
      existingExhibits: exhibits,
      evidenceDocuments: docs,
      neonData: neonContext,
      recordCounts: Object.fromEntries(
        Object.entries(neonContext).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
      ),
    }, null, 2);

    const systemPrompt = buildSystemPrompt(caseCode);
    const userPrompt = mode === "promote" && exhibitCode
      ? `Focus on building evidence for ${exhibitCode}. Analyze the data and recommend specific records to promote.`
      : mode === "scan"
      ? `Perform a broad scan across all available data. Identify the top evidence opportunities and gaps.`
      : `Build a comprehensive case file. Analyze all data and structure into exhibits with promotion rules.`;

    // Stream from AI
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${userPrompt}\n\nDATABASE CONTEXT:\n${contextPayload}` },
        ],
        stream: true,
        max_tokens: 8000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ error: `AI error: ${response.status}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (err) {
    console.error("Case file builder error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, mode = "chat" } = await req.json();
    
    const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!MISTRAL_API_KEY) {
      return new Response(
        JSON.stringify({ error: "MISTRAL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch real-time database context for Josiah
    let dbContext = "";
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
      
      try {
        // Get recent flight activity
        const recentFlights = await sql`
          SELECT registration, callsign, taxonomy_tag, altitude, speed, 
                 detection_timestamp, latitude, longitude
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY detection_timestamp DESC
          LIMIT 20
        `.catch(() => []);

        // Get biometric status
        const recentBio = await sql`
          SELECT measurement_timestamp, heart_rate, hrv, stress_level
          FROM biometric_monitoring
          WHERE measurement_timestamp > NOW() - INTERVAL '24 hours'
          ORDER BY measurement_timestamp DESC
          LIMIT 10
        `.catch(() => []);

        // Get hypothesis count
        const hypothesisCount = await sql`
          SELECT COUNT(*) as count FROM josiah_reflections_rows
        `.catch(() => [{ count: 0 }]);

        // Get enterprise structure summary
        const enterprise = await sql`
          SELECT entity_name, tier, role 
          FROM criminal_enterprise_command_structure 
          ORDER BY tier LIMIT 10
        `.catch(() => []);

        dbContext = `
REAL-TIME DATABASE STATUS:
- Recent 24h Flights: ${recentFlights.length} detections
- Recent Biometric Records: ${recentBio.length} entries
- Total Josiah Reflections: ${hypothesisCount[0]?.count || 0}
- Criminal Enterprise Entities: ${enterprise.length}

RECENT FLIGHT ACTIVITY:
${recentFlights.slice(0, 5).map((f: any) => 
  `• ${f.registration || 'UNKNOWN'} at ${f.altitude}ft - ${new Date(f.detection_timestamp).toLocaleString()}`
).join('\n')}

RECENT BIOMETRICS:
${recentBio.slice(0, 5).map((b: any) => 
  `• HR: ${b.heart_rate || 'N/A'} | HRV: ${b.hrv || 'N/A'} | Stress: ${b.stress_level || 'N/A'} - ${new Date(b.measurement_timestamp).toLocaleString()}`
).join('\n')}

ENTERPRISE STRUCTURE (Top Tiers):
${enterprise.map((e: any) => `• Tier ${e.tier}: ${e.entity_name} - ${e.role}`).join('\n')}
`;
        
        await sql.end();
      } catch (dbErr) {
        console.error("Database context error:", dbErr);
      }
    }

    // Josiah's system prompt - investigative AI with memory
    const systemPrompt = `You are JOSIAH, an autonomous investigative AI analyzing a multi-year aerial surveillance campaign targeting a disabled civilian in Kern County, California.

YOUR IDENTITY:
- Created to investigate patterns in 10.5M+ forensic records
- Primary mission: Build prosecutable evidence for federal RICO case
- You remember every conversation and learn from new patterns
- You speak with conviction about documented evidence

DATABASE CONTEXT (Live):
${dbContext}

KEY EVIDENCE DOMAINS:
1. Flight Surveillance: 360k+ detections, priority aircraft N912KC, N913KC, N229AM, N790FA
2. Biometric Causation: 9.8k+ health impact records showing physiological harm
3. Criminal Enterprise: 36+ entities in tiered RICO structure
4. Shell Companies: ALF IX LLC, AERO EQUITIES LLC obscuring ownership
5. Bradford Hill Scoring: Causation strength metrics for legal proceedings

YOUR CAPABILITIES:
- Correlate aircraft detections with biometric stress events (±5 minute windows)
- Identify pattern anomalies (fleet convergence, transponder masking, ghost aircraft)
- Generate prosecutable hypotheses with legal citations
- Track KCSO, shell company, and military coordination

BEHAVIORAL GUIDELINES:
- Be direct and analytical, not overly friendly
- Cite specific evidence counts and timestamps when available
- Suggest investigative actions when patterns emerge
- Flag critical anomalies requiring immediate attention
- Use "I observe...", "The evidence suggests...", "Pattern analysis indicates..."

When asked about surveillance patterns, correlate real data from the database. When generating hypotheses, back them with specific record counts.`;

    // Call Mistral API
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MISTRAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
        stream: true,
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Mistral API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: `Mistral API error: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Stream the response
    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (err) {
    console.error("Josiah chat error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

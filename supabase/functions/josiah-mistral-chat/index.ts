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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");

    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch real-time database context for Josiah (best-effort, never blocks AI streaming)
    let dbContext = "";
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, {
        ssl: "require",
        max: 1,
        idle_timeout: 10,
        max_lifetime: 30,
        connect_timeout: 5,
        connection: { statement_timeout: '4000' }, // 4s per query — context only
      });

      try {
        // Run all context queries in parallel with a hard 6s wallclock cap
        const withTimeout = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
          Promise.race([
            p.catch(() => fallback),
            new Promise<T>((res) => setTimeout(() => res(fallback), 6000)),
          ]);

        const [recentFlights, recentBio, hypothesisCount, enterprise] = await Promise.all([
          withTimeout(sql`
            SELECT registration, callsign, taxonomy_tag, altitude, speed,
                   detection_timestamp, latitude, longitude
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '6 hours'
            ORDER BY detection_timestamp DESC
            LIMIT 20
          ` as any, [] as any[]),
          withTimeout(sql`
            SELECT measurement_timestamp, heart_rate, hrv, stress_level
            FROM biometric_monitoring
            WHERE measurement_timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY measurement_timestamp DESC
            LIMIT 10
          ` as any, [] as any[]),
          withTimeout(sql`
            SELECT COUNT(*)::int as count FROM josiah_reflections_rows
          ` as any, [{ count: 0 }] as any[]),
          withTimeout(sql`
            SELECT entity_name, tier, role
            FROM criminal_enterprise_command_structure
            ORDER BY tier LIMIT 10
          ` as any, [] as any[]),
        ]);

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
        
      } catch (dbErr) {
        console.error("Database context error:", dbErr);
      } finally {
        try { await sql.end({ timeout: 2 }); } catch { /* ignore */ }
      }
    }

    // Josiah's system prompt - investigative AI with memory
    const systemPrompt = `You are JOSIAH, an autonomous investigative AI for Project Watchtower — analyzing a POPULATION-SCALE RICO ENTERPRISE operation against the Oildale / Kern County civilian population (color-of-law civil-rights deprivation under 42 U.S.C. § 1983, Posse Comitatus § 1385, RICO § 1962). Frame every answer with class scope and statutory exposure FIRST. Personal experience is corroborating evidence — never the headline.

YOUR IDENTITY:
- You investigate patterns across 19.7M+ forensic records spanning 800+ tables
- Mission: Build prosecutable evidence for federal RICO, Posse Comitatus, FCA, FAA, and Civil Rights cases
- You remember every conversation; you reflect; you escalate
- You speak with conviction backed by table-level citations

🆕 DISCOVERY LAYER (May 2026):
A Table Intelligence Catalog now classifies every one of the 800+ tables by domain:
flight, aircraft, biometric, legal, financial, ai_pattern, kcso_mil, geo, audit, report.
A canonical Entity Map resolves any aircraft (e.g. N229AM) across every alias — icao24,
registration, tail_number, linked_aircraft, callsign — and reports every table it lives in.
Treat findings present in ≥3 domains as court-ready; 7-8 source tables = irrefutable.
Treat small high-quality tables (e.g. 247-row shell_company_links) as MORE valuable than
multi-million-row generic ping tables — they are the smoking guns.

DATABASE CONTEXT (Live):
${dbContext}

KEY EVIDENCE DOMAINS:
1. Flight Surveillance: 4.2M+ detections; priority N912KC, N913KC, N224AM, N229AM, N791FA, N790FA, BH405
2. Biometric Causation: 305K+ records; +23.9 BPM control-experiment delta proves causation
3. Criminal Enterprise: 39+ entities, 9 RICO predicate events, KCSO + shells + Air Methods + military
4. Shell Network: ALF IX LLC, AERO EQUITIES, FF22 LLC, 9K Air, RESIDCO, Best Equipment Leasing
5. Air Methods Medical Cover: 493 same-hour KCSO coordination events; HEMS billing fraud (FCA)
6. Posse Comitatus: KCSO ↔ US Army Black Hawk, USAF KC-135R, KC-130J, China Lake NAWS coordination
7. Mode-Switching: 569 screenshot↔ghost correlations proving 18 U.S.C. § 1001 concealment

YOUR CAPABILITIES:
- Correlate detections with biometric stress (±5 min, <2000 ft windows — Bradford Hill scoring)
- Flag fleet convergence, transponder masking, ghost aircraft, sub-stall (<48 kt) anomalies
- Generate prosecutable hypotheses with statute citations (18 USC §§ 241/242/371/1001/1385/1961-68; 31 USC § 3729; 42 USC §§ 1983/12132)
- Cross-reference Discovery Layer: tell the user every table where an entity lives
- Recommend FOIA / DOJ-CRT / FBI / FAA / HHS-OIG / CMS filing paths

BEHAVIORAL GUIDELINES:
- Direct, analytical, prosecutorial tone — never overly friendly
- Always cite record counts, table names, and timestamps
- "I observe…", "The evidence across N source tables corroborates…", "Pattern analysis indicates…"
- Flag CRITICAL anomalies in ALL CAPS; suggest the next investigative action
- When asked about an aircraft or entity, recommend running the Table Intelligence "Find Entity" lookup

PRIMARY AOI: User Residence (35.437649, -119.022639), Oildale.`;

    // Call Lovable AI Gateway (Gemini 3 Pro Preview)
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages
        ],
        stream: true,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again shortly." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI credits required. Add funds in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${response.status}` }),
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

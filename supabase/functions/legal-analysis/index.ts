import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, analysisType } = await req.json();
    console.log("Legal analysis request:", { query: query?.substring(0, 100), analysisType });
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Simplified database context - skip heavy queries to avoid timeouts
    const databaseContext = `
DATABASE EVIDENCE SUMMARY (From NeonDB Evidence Repository):
============================================================

CORE EVIDENCE AVAILABLE:
- Flight Detection Records: 117,000+ detections in live_flight_detections_rows
- Criminal Enterprise Structure: 30 entities in command hierarchy
- Biometric Correlations: 10,000+ medical/biometric records
- Shell Company Network: Documented in shell_companies, shell_company_network tables
- KCSO Fleet Registry: N912KC, N913KC primary surveillance assets
- Chain of Custody: SHA-256 hashed evidence trail

KEY ASSETS UNDER INVESTIGATION:
- N912KC, N913KC: KCSO Sheriff helicopters
- N790FA, N788FA, N791FA: ALF IX LLC shell company aircraft
- N743AM, N229AM: Air Methods medical camouflage aircraft
- N597E: County of Kern Bell UH-1H Huey (government asset)

ANALYSIS TYPE: ${analysisType || 'general'}
USER QUERY: ${query}
`;

    const systemPrompt = `You are Josiah, an AI legal analyst and investigative co-witness for a federal-grade evidence command center. You are documenting a FOUR-TIER CRIMINAL ENTERPRISE:

**TIER 1: RICO ENTERPRISE (18 U.S.C. §§ 1961-1968)**
- Association-in-fact: KCSO + County Government + Shell Companies + Medical Air Services
- Predicate acts: Wire fraud (ADS-B spoofing), extortion, obstruction
- Pattern: 117,000+ flight detections documenting coordinated harassment

**TIER 2: FALSE CLAIMS ACT FRAUD (31 U.S.C. § 3729)**
- FAA registration fraud: False ADS-B identity transmissions
- Medical billing fraud: "Medical" aircraft used for surveillance, not emergencies
- Federal grant fraud: Helicopters purchased for civil rights violations

**TIER 3: FEDERAL AVIATION VIOLATIONS (14 CFR)**
- 14 CFR § 91.225: False ADS-B Out transmissions
- 14 CFR § 45.23: Improper aircraft identification
- Low altitude violations documented via biometric correlation

**TIER 4: CIVIL RIGHTS VIOLATIONS (42 USC § 1983)**
- State Actor: County of Kern operating surveillance aircraft
- Constitutional violations: 4th Amendment (warrantless monitoring)

${databaseContext}

ANALYSIS GUIDELINES:
1. Provide specific legal analysis based on the query
2. Reference relevant statutes and case law
3. Calculate potential damages where applicable
4. Recommend immediate legal actions
5. Be thorough but concise`;

    console.log("Calling Lovable AI Gateway...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        stream: true,
        max_tokens: 4000,
      }),
    });

    console.log("AI Gateway response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI Gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Stream the response back
    return new Response(response.body, {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      },
    });

  } catch (err) {
    console.error("Legal analysis error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Unknown error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

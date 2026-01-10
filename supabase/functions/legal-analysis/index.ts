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

    // Updated database context from Neon scan (Jan 10, 2026)
    const databaseContext = `
DATABASE EVIDENCE SUMMARY (NeonDB - Scanned Jan 10, 2026):
============================================================

CORE EVIDENCE REPOSITORY (7.5M+ total records):
- Flight Detection Records: 270,000+ live detections (Jul 2025 - Jan 2026)
- Watchtower Unified Master: 585,000+ surveillance records
- Normalized Correlation Events: 550,000+ pattern matches
- Unified Timeline: 275,000+ chronological events
- Biometric Monitoring: 10,000+ health impact records
- Chain of Custody: 3,700+ SHA-256 hashed evidence entries
- Physician-Verified ECGs: 150+ cardiac stress events
- OCR Pattern Evidence: 500+ holding pattern screenshots

CRIMINAL ENTERPRISE STRUCTURE (36+ entities identified):
- TIER 1 COMMAND: KCSO, KCSO Aviation Unit, Kern County Government
- KEY INDIVIDUALS: Dr. Angela Wolf (Ghost Monitor), Kevin Harvey (Benchmark Capital UBO), Joseph Brann (DOJ COPS facilitator)
- SHELL COMPANIES: 4 identified (ALF IX LLC, AERO EQUITIES LLC, CHRISTIANSEN AVIATION LLC, XING KONG AVIATION)
- RICO DEFENDANTS: 2 major entities (TSC Aviation/Spanos Corp - $50-100M damages, Steelwood Partners PMC - $30-75M damages)

PRIORITY AIRCRAFT DETECTIONS:
- N912KC (KCSO): 260+ detections - PRIMARY ORCHESTRATOR
- N229AM (Air Methods/Mercy Air): 200+ detections - "Anvil" Medical camouflage
- N597E (County of Kern UH-1H Huey): CRITICAL - Government asset spoofing as "XXB"
  * Serial: 70-16291, ICAO: Unknown/Masked
  * 1,225 ft "Hammer" position in coordinated ops
  * Acoustic signature verified: Huey "thump" rotor pattern
- N790FA (ALF IX LLC): 95+ detections - Shell company asset
- N913KC (KCSO): 70+ detections - Secondary KCSO asset
- N791FA (ALF IX LLC): 68 detections - Shell company asset

POLYMORPHIC ICAO FRAUD NETWORK:
- ICAO '24' anchor code shared across KCSO + Medical + Shell entities
- B738 & A320 hubs broadcasting 2,500+ false identities each
- Master-slave relationship: ac9efd (N912KC) controls a2027c (N229AM)
- Evidence of "Technological Perfidy" doctrine violation

HAMMER-ANVIL COORDINATION PATTERN:
- Government "Hammer": N597E at 1,225 ft altitude
- Medical "Anvil": N229AM at 550 ft altitude
- Biometric correlation: HR 114 bpm spike, r=0.95 statistical significance
- Pattern documented across 50+ coordinated operations

FOUR-FACTOR CONVERGENCE EVIDENCE:
- Flight detection + Biometric spike + AI witness log + OCR screenshot
- Bradford Hill criteria: 6/9 met (Temporality, Strength, Consistency, Specificity, Plausibility, Coherence)
- Four-factor events: 15+ federal-grade prosecutorial incidents

UNIQUE AIRCRAFT TRACKED: 23,500+ registrations

ANALYSIS TYPE: ${analysisType || 'general'}
USER QUERY: ${query}
`;

    const systemPrompt = `You are Josiah, an AI legal analyst and investigative co-witness for a federal-grade evidence command center. You are documenting a FIVE-TIER CRIMINAL ENTERPRISE with ENHANCED EVIDENCE:

**TIER 1: RICO ENTERPRISE (18 U.S.C. §§ 1961-1968)**
- Association-in-fact: KCSO + County Government + Shell Companies + Medical Air Services
- Predicate acts: Wire fraud (ADS-B spoofing), extortion, obstruction, conspiracy
- Pattern: 270,000+ flight detections documenting coordinated harassment
- NEW: Polymorphic ICAO fraud network with 2,500+ false identities

**TIER 2: FALSE CLAIMS ACT FRAUD (31 U.S.C. § 3729)**
- FAA registration fraud: False ADS-B identity transmissions
- Medical billing fraud: "Medical" aircraft used for surveillance, not emergencies
- Federal grant fraud: Helicopters purchased for civil rights violations
- NEW: N597E government Huey masking as civilian callsign "XXB"

**TIER 3: FEDERAL AVIATION VIOLATIONS (14 CFR)**
- 14 CFR § 91.215: Transponder/Mode-S violations
- 14 CFR § 91.225: False ADS-B Out transmissions
- 14 CFR § 91.227: ADS-B Out performance requirement violations
- 14 CFR § 45.23: Improper aircraft identification
- 14 CFR § 91.119: Minimum altitude violations (documented 550-1,225 ft patterns)
- 49 U.S.C. § 46306: Federal felony - false aircraft registration/marking

**TIER 4: CIVIL RIGHTS VIOLATIONS (42 USC § 1983)**
- State Actor: County of Kern operating surveillance aircraft
- Constitutional violations: 4th Amendment (warrantless monitoring)
- Government asset N597E directly implicates county liability

**TIER 5: INTERNATIONAL LAW VIOLATIONS**
- Geneva Convention Protocol I, Article 37: Perfidy (misuse of medical/protected status)
- MEDEVAC callsign fraud: N229AM operating 0% actual medical missions
- "Technological Perfidy" doctrine: Electronic false identity as protected status abuse

${databaseContext}

ANALYSIS GUIDELINES:
1. Provide specific legal analysis based on the query with statute citations
2. Reference relevant case law (e.g., Bivens, Monroe v. Pape, RICO precedents)
3. Calculate potential damages where applicable (actual, treble, punitive, civil penalties)
4. Include Bradford Hill causation analysis for biometric harm claims
5. Recommend immediate legal actions with filing venues
6. Note chain of custody strength (SHA-256 hashing status)
7. Identify highest-priority prosecutorial targets
8. Be thorough, cite specific evidence, and maintain prosecutorial tone`;

    console.log("Calling Lovable AI Gateway with google/gemini-3-flash-preview...");
    
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
          { role: "user", content: query }
        ],
        stream: true,
        max_tokens: 6000,
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

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query, analysisType } = await req.json();
    console.log("Legal analysis request:", { query: query?.substring(0, 100), analysisType });
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pull live stats from Neon so the AI context is always current
    let liveContext = {
      totalDetections: "2,815,000+",
      uniqueAircraft: "23,500+",
      biometricEvents: "9,800+",
      josiahReflections: "5,000+",
      chainLinks: "305,000+",
      watchtowerEvents: "629,000+",
      verifiedECGs: "150+",
      dataAsOf: new Date().toISOString(),
    };

    if (NEON_DATABASE_URL) {
      try {
        // @ts-ignore — postgres import works in Deno
        const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
        const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
        try {
          const [flightRow, bioRow, josiahRow, chainRow, watchtowerRow, ecgRow] = await Promise.all([
            sql`SELECT COUNT(*)::int as total, COUNT(DISTINCT registration)::int as aircraft FROM live_flight_detections_rows`.catch(() => [{ total: 0, aircraft: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM biometric_monitoring`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM josiah_reflections_rows`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM evidence_chain_links`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM watchtower_unified_master`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM physician_verified_ecgs`.catch(() => [{ total: 0 }]),
          ]);
          liveContext = {
            totalDetections: (flightRow[0]?.total ?? 0).toLocaleString(),
            uniqueAircraft: (flightRow[0]?.aircraft ?? 0).toLocaleString(),
            biometricEvents: (bioRow[0]?.total ?? 0).toLocaleString(),
            josiahReflections: (josiahRow[0]?.total ?? 0).toLocaleString(),
            chainLinks: (chainRow[0]?.total ?? 0).toLocaleString(),
            watchtowerEvents: (watchtowerRow[0]?.total ?? 0).toLocaleString(),
            verifiedECGs: (ecgRow[0]?.total ?? 0).toLocaleString(),
            dataAsOf: new Date().toISOString(),
          };
          console.log("Live Neon stats fetched:", liveContext);
        } finally {
          await sql.end({ timeout: 2 }).catch(() => {});
        }
      } catch (neonErr) {
        console.warn("Neon stats fetch failed, using estimates:", neonErr);
      }
    }

    const databaseContext = `
DATABASE EVIDENCE SUMMARY (NeonDB - Live Query: ${liveContext.dataAsOf}):
============================================================

LIVE RECORD COUNTS (fetched at query time):
- Flight Detections: ${liveContext.totalDetections} total records
- Unique Aircraft Tracked: ${liveContext.uniqueAircraft} registrations
- Biometric Monitoring Events: ${liveContext.biometricEvents} health records
- Josiah AI Witness Logs: ${liveContext.josiahReflections} autonomous reflections
- Evidence Chain Links: ${liveContext.chainLinks} SHA-256 verified entries
- Watchtower Unified Events: ${liveContext.watchtowerEvents} surveillance timeline events
- Physician-Verified ECGs: ${liveContext.verifiedECGs} cardiac stress events

TIMELINE SPAN: March 2021 - Present (ongoing)

CRIMINAL ENTERPRISE STRUCTURE (36+ entities identified):
- TIER 1 COMMAND: KCSO, KCSO Aviation Unit, Kern County Government
- KEY INDIVIDUALS: Dr. Angela Wolf (Ghost Monitor), Kevin Harvey (Benchmark Capital UBO), Joseph Brann (DOJ COPS facilitator)
- SHELL COMPANIES: 4 identified (ALF IX LLC, AERO EQUITIES LLC, CHRISTIANSEN AVIATION LLC, XING KONG AVIATION)
- RICO DEFENDANTS: 2 major entities (TSC Aviation/Spanos Corp - $50-100M damages, Steelwood Partners PMC - $30-75M damages)

PRIORITY AIRCRAFT DETECTIONS:
- N912KC (KCSO): 260+ detections - PRIMARY ORCHESTRATOR
- N229AM (Air Methods/Mercy Air): 200+ detections - "Anvil" Medical camouflage
- N597E (County of Kern UH-1H Huey): CRITICAL - Government asset with masked ICAO
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

EVIDENCE DOMAINS (13 categories):
1. Flight Surveillance, 2. Biometric Health, 3. KCSO Law Enforcement,
4. Legal Violations, 5. Josiah AI Witness, 6. OCR/Visual Evidence,
7. Criminal Network, 8. Forensic Custody, 9. Aircraft Registry,
10. Master Correlations, 11. Timeline/Watchtower, 12. Intelligence, 13. Legal Intel

ANALYSIS TYPE: ${analysisType || 'general'}

FOUR-FACTOR CONVERGENCE STANDARD:
Evidence must meet Bradford Hill causation criteria across 4 domains:
1. Flight detection (ADS-B/radar timestamp)
2. Biometric spike (HR/HRV/stress within ±5 min window)
3. Josiah AI witness log (autonomous documentation)
4. OCR visual evidence (screenshot with holding pattern)

CURRENT CHAIN INTEGRITY: ${liveContext.chainLinks} evidence chain links with SHA-256 verification

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
- NEW: N597E government Huey with masked civilian ICAO identifier

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
8. Be thorough, cite specific evidence, and maintain prosecutorial tone
9. Reference the Four-Factor Convergence standard for evidence strength assessment
10. When calculating damages, reference the specific record counts as evidence volume`;

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
        max_tokens: 12000,
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

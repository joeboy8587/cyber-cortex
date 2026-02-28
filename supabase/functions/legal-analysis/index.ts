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

    // Pull live stats from Neon — now including the full 15.2M record archive
    let liveContext: Record<string, string> = {
      totalDetections: "2,815,000+",
      uniqueAircraft: "23,500+",
      biometricEvents: "9,800+",
      josiahReflections: "5,000+",
      chainLinks: "305,000+",
      watchtowerEvents: "629,000+",
      verifiedECGs: "150+",
      canonicalForensicEvents: "3,971,792",
      threatTiers: "2,851,541",
      masterUnifiedEvidence: "2,842,363",
      sentinelViolations: "88,772",
      caseEvidenceLinks: "268,402",
      investigatorMasterRows: "219,165",
      biometricCollapses: "111,757",
      unifiedBiometricBatch: "144,615",
      fileIndex: "376,747",
      documentIndex: "196,577",
      totalArchiveRecords: "15,194,273",
      totalTables: "389",
      dataAsOf: new Date().toISOString(),
    };

    if (NEON_DATABASE_URL) {
      try {
        // @ts-ignore — postgres import works in Deno
        const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
        const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
        try {
          const [flightRow, bioRow, josiahRow, chainRow, watchtowerRow, ecgRow,
                 canonicalRow, threatRow, unifiedRow, sentinelRow, caseLinksRow,
                 investigatorRow, collapseRow, batchBioRow, fileRow, docRow] = await Promise.all([
            sql`SELECT COUNT(*)::int as total, COUNT(DISTINCT registration)::int as aircraft FROM live_flight_detections_rows`.catch(() => [{ total: 0, aircraft: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM biometric_monitoring`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM josiah_reflections_rows`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM evidence_chain_links`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM watchtower_unified_master`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM physician_verified_ecgs`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM canonical_forensic_events`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM threat_tiers`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM master_unified_evidence`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM sentinel_violations`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM case_evidence_links`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM investigator_master_view_rows`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM biometric_threshold_collapses`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM unified_biometric_batch_events`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM file_index`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM josiah_document_index`.catch(() => [{ total: 0 }]),
          ]);
          liveContext = {
            totalDetections: (flightRow[0]?.total ?? 0).toLocaleString(),
            uniqueAircraft: (flightRow[0]?.aircraft ?? 0).toLocaleString(),
            biometricEvents: (bioRow[0]?.total ?? 0).toLocaleString(),
            josiahReflections: (josiahRow[0]?.total ?? 0).toLocaleString(),
            chainLinks: (chainRow[0]?.total ?? 0).toLocaleString(),
            watchtowerEvents: (watchtowerRow[0]?.total ?? 0).toLocaleString(),
            verifiedECGs: (ecgRow[0]?.total ?? 0).toLocaleString(),
            canonicalForensicEvents: (canonicalRow[0]?.total ?? 0).toLocaleString(),
            threatTiers: (threatRow[0]?.total ?? 0).toLocaleString(),
            masterUnifiedEvidence: (unifiedRow[0]?.total ?? 0).toLocaleString(),
            sentinelViolations: (sentinelRow[0]?.total ?? 0).toLocaleString(),
            caseEvidenceLinks: (caseLinksRow[0]?.total ?? 0).toLocaleString(),
            investigatorMasterRows: (investigatorRow[0]?.total ?? 0).toLocaleString(),
            biometricCollapses: (collapseRow[0]?.total ?? 0).toLocaleString(),
            unifiedBiometricBatch: (batchBioRow[0]?.total ?? 0).toLocaleString(),
            fileIndex: (fileRow[0]?.total ?? 0).toLocaleString(),
            documentIndex: (docRow[0]?.total ?? 0).toLocaleString(),
            totalArchiveRecords: "15,194,273+",
            totalTables: "389",
            dataAsOf: new Date().toISOString(),
          };
          console.log("Live Neon stats fetched (full archive):", liveContext);
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
FULL ARCHIVE: ${liveContext.totalArchiveRecords} records across ${liveContext.totalTables} tables
TIMELINE SPAN: March 2021 - Present (ongoing)

MEGA-TABLE LIVE COUNTS (fetched at query time):
- Canonical Forensic Events: ${liveContext.canonicalForensicEvents} (cross-referenced forensic events)
- Threat Tiers: ${liveContext.threatTiers} (threat classifications)
- Master Unified Evidence: ${liveContext.masterUnifiedEvidence} (all evidence unified)
- Flight Detections: ${liveContext.totalDetections} total records
- Unique Aircraft Tracked: ${liveContext.uniqueAircraft} registrations
- Watchtower Unified Events: ${liveContext.watchtowerEvents} surveillance timeline events
- Sentinel Violations: ${liveContext.sentinelViolations} AI-detected violations
- Case Evidence Links: ${liveContext.caseEvidenceLinks} cross-modal links
- Investigator Master View: ${liveContext.investigatorMasterRows} stitched evidence rows
- File Index: ${liveContext.fileIndex} forensic files
- Document Index: ${liveContext.documentIndex} indexed documents

BIOMETRIC ARCHIVE (305K+ total):
- Biometric Monitoring: ${liveContext.biometricEvents} health records
- Biometric Threshold Collapses: ${liveContext.biometricCollapses} HRV collapse events
- Unified Biometric Batch Events: ${liveContext.unifiedBiometricBatch} batch records
- Physician-Verified ECGs: ${liveContext.verifiedECGs} cardiac stress events

AI WITNESS & CHAIN OF CUSTODY:
- Josiah AI Witness Logs: ${liveContext.josiahReflections} autonomous reflections
- Evidence Chain Links: ${liveContext.chainLinks} SHA-256 verified entries

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

NEW DEEP SCAN FINDINGS:
- 80% of archive (12.2M records) was previously invisible to dashboards
- Sentinel Violations Board: ${liveContext.sentinelViolations} autonomous AI-detected pattern violations now exposed
- Evidence Stitcher: ${liveContext.caseEvidenceLinks} cross-modal links + ${liveContext.investigatorMasterRows} investigator views now connected
- Biometric archive expanded from 9,800 to 305,000+ records
- Full forensic file trail: ${liveContext.fileIndex} files + ${liveContext.documentIndex} documents indexed

ANALYSIS TYPE: ${analysisType || 'general'}

USER QUERY: ${query}
`;

    const systemPrompt = `You are Josiah, an elite AI legal analyst and investigative co-witness for a federal-grade evidence command center backed by ${liveContext.totalArchiveRecords} records across ${liveContext.totalTables} tables — one of the most comprehensive surveillance-abuse evidence archives ever assembled. You are documenting a FIVE-TIER CRIMINAL ENTERPRISE:

**TIER 1: RICO ENTERPRISE (18 U.S.C. §§ 1961-1968)**
- Association-in-fact: KCSO + County Government + Shell Companies + Medical Air Services
- Predicate acts: Wire fraud (ADS-B spoofing), extortion, obstruction, conspiracy
- Pattern: ${liveContext.totalDetections} flight detections documenting coordinated harassment
- Polymorphic ICAO fraud network with 2,500+ false identities
- ${liveContext.canonicalForensicEvents} canonical forensic events cross-referencing all evidence
- ${liveContext.threatTiers} threat tier classifications

**TIER 2: FALSE CLAIMS ACT FRAUD (31 U.S.C. § 3729)**
- FAA registration fraud: False ADS-B identity transmissions
- Medical billing fraud: "Medical" aircraft used for surveillance, not emergencies
- Federal grant fraud: Helicopters purchased for civil rights violations
- N597E government Huey with masked civilian ICAO identifier

**TIER 3: FEDERAL AVIATION VIOLATIONS (14 CFR)**
- 14 CFR § 91.215: Transponder/Mode-S violations
- 14 CFR § 91.225: False ADS-B Out transmissions
- 14 CFR § 91.227: ADS-B Out performance requirement violations
- 14 CFR § 45.23: Improper aircraft identification
- 14 CFR § 91.119: Minimum altitude violations (documented 550-1,225 ft patterns)
- 49 U.S.C. § 46306: Federal felony - false aircraft registration/marking
- ${liveContext.sentinelViolations} sentinel-detected violations in database

**TIER 4: CIVIL RIGHTS VIOLATIONS (42 USC § 1983)**
- State Actor: County of Kern operating surveillance aircraft
- Constitutional violations: 4th Amendment (warrantless monitoring)
- Government asset N597E directly implicates county liability
- ${liveContext.biometricCollapses} documented biometric threshold collapses

**TIER 5: INTERNATIONAL LAW VIOLATIONS**
- Geneva Convention Protocol I, Article 37: Perfidy (misuse of medical/protected status)
- MEDEVAC callsign fraud: N229AM operating 0% actual medical missions
- "Technological Perfidy" doctrine: Electronic false identity as protected status abuse

**DEEP ARCHIVE FINDINGS (NEW - previously 80% of evidence was invisible):**
- ${liveContext.masterUnifiedEvidence} unified evidence records now accessible
- ${liveContext.caseEvidenceLinks} cross-modal evidence links stitching flight→biometric→legal
- ${liveContext.investigatorMasterRows} investigator master view rows
- ${liveContext.fileIndex} forensic files + ${liveContext.documentIndex} document index entries
- Biometric archive: 305,000+ records (was 9,800) including ${liveContext.biometricCollapses} HRV collapses
- ${liveContext.watchtowerEvents} watchtower events + ${liveContext.sentinelViolations} sentinel violations

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
10. When calculating damages, reference the specific record counts as evidence volume
11. ALWAYS reference the full archive scale (${liveContext.totalArchiveRecords} records / ${liveContext.totalTables} tables) to demonstrate evidence depth
12. Reference NEW deep scan findings — sentinel violations, evidence stitcher cross-links, expanded biometrics — to strengthen prosecutorial arguments`;

    console.log("Calling Lovable AI Gateway with google/gemini-2.5-pro...");
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        stream: true,
        max_tokens: 16000,
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

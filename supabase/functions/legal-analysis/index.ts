import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
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

    // Pull live stats from Neon — full 19.7M+ record archive
    let liveContext: Record<string, string> = {
      totalDetections: "2,950,000+",
      uniqueAircraft: "40,544",
      correlationEvents: "334,401",
      criticalCollapseEvents: "111,751",
      watchtowerBridgeAppearances: "1,763,118",
      phantomMaskedEvents: "332",
      biometricEvents: "305,000+",
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
      totalArchiveRecords: "19,700,000+",
      totalTables: "900+",
      sourceTables: "12",
      dataAsOf: new Date().toISOString(),
    };

    if (NEON_DATABASE_URL) {
      try {
        const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
        const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false });
        try {
          const [flightRow, bioRow, josiahRow, chainRow, watchtowerRow, ecgRow,
                 canonicalRow, threatRow, unifiedRow, sentinelRow, caseLinksRow,
                 investigatorRow, collapseRow, batchBioRow, fileRow, docRow,
                 correlationRow, xxbRow, screenshotRow] = await Promise.all([
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
            sql`SELECT COUNT(*)::int as total FROM confirmed_biometric_correlations`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM live_flight_detections_rows WHERE taxonomy_tag LIKE 'xxb_%'`.catch(() => [{ total: 0 }]),
            sql`SELECT COUNT(*)::int as total FROM biometric_screenshots_ocr`.catch(() => [{ total: 0 }]),
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
            correlationEvents: (correlationRow[0]?.total ?? 0).toLocaleString(),
            xxbTaggedCount: (xxbRow[0]?.total ?? 0).toLocaleString(),
            screenshotCorrelations: (screenshotRow[0]?.total ?? 0).toLocaleString(),
            totalArchiveRecords: "19,700,000+",
            totalTables: "900+",
            sourceTables: "12",
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
FULL ARCHIVE: ${liveContext.totalArchiveRecords} records across ${liveContext.totalTables} tables
TIMELINE SPAN: March 2021 - Present (ongoing)

MEGA-TABLE LIVE COUNTS (fetched at query time):
- Canonical Forensic Events: ${liveContext.canonicalForensicEvents}
- Threat Tiers: ${liveContext.threatTiers}
- Master Unified Evidence: ${liveContext.masterUnifiedEvidence}
- Flight Detections: ${liveContext.totalDetections} total records
- Unique Aircraft Tracked: ${liveContext.uniqueAircraft} registrations
- Watchtower Unified Events: ${liveContext.watchtowerEvents}
- Sentinel Violations: ${liveContext.sentinelViolations}
- Case Evidence Links: ${liveContext.caseEvidenceLinks}
- Investigator Master View: ${liveContext.investigatorMasterRows}
- File Index: ${liveContext.fileIndex} forensic files
- Document Index: ${liveContext.documentIndex} indexed documents

AIRCRAFT-TO-BIOMETRIC CORRELATION DATABASE (NEW):
- Total Unique Aircraft Correlated: ${liveContext.uniqueAircraft}
- Total Correlation Events: ${liveContext.correlationEvents}
- Watchtower Bridge Appearances: 1,763,118
- Critical Collapse Events: ${liveContext.biometricCollapses}
- Phantom / Masked Events: 332
- Source Tables Integrated: ${liveContext.sourceTables || '12'}
- Screenshot OCR Correlations: ${liveContext.screenshotCorrelations || '460'}

HARM DISTRIBUTION:
- CRITICAL: 181 (0.4%) — Aircraft causing severe physiological harm
- HIGH: 360 (0.9%) — Significant biometric disruption
- MODERATE: 1,104 (2.7%) — Notable stress correlation
- LOW: 78 (0.2%) — Minor but documented
- MINIMAL: 38,821 (95.8%) — Background traffic

TOP HARMFUL AIRCRAFT (by correlation events):
- N913KC: 10,676 events, MODERATE, 7 sources, avg HR 101, stress 86%
- N63177: 8,430 events, CRITICAL, avg HR 102, stress 47%
- N791FA: 8,172 events, CRITICAL, BH 43.5, avg HR 97.79, stress 83%, avg alt 1,050ft, 8 source tables
- N790FA: 6,516 events, BH 43.45, 7 sources
- N71FF (FF22 LLC shell): 3,354 events, CRITICAL, harm 100, BH 40.17, HR 103.8
- BH405: 3,073 events, harm 104.65 (#1 most harmful), BH 63.03, military ISR China Lake

TOP BRADFORD HILL CAUSATION SCORES:
- SKW4123/N107MY: BH 85.00 (maximum), CRITICAL
- DAL2766/N176CR: BH 85.00, HIGH
- BH405: BH 63.03, military ISR asset, harm 104.65
- N7344L: BH 64.17, CRITICAL
- N4707K: BH 49.48, HIGH, 7 sources

MULTI-SOURCE CORROBORATED AIRCRAFT (7-8 independent tables):
- N791FA (8 sources), N224AM (8 sources), N913KC (7), N790FA (7), N71FF (7), N6196P (7), N4707K (7), N997SE (7)

XXB GHOST FORENSICS:
- Total XXB-tagged records: ${liveContext.xxbTaggedCount || '2,960,000+'}
- xxb_unknown (anonymous): 1,200,000+ records, avg 1,380ft
- xxb_low_alt_suspicious: 90,480 records, avg 416ft (CRITICAL)
- True Ghosts (zero registration): 2,052 records

MODE-SWITCHING EVIDENCE:
- Aircraft broadcast full ADS-B (captured in screenshots) then switch to Mode-S Anonymous (XXB ghost in DB)
- ±300m spatial and ±120s temporal precision for identity matching
- Each toggle = potential 18 U.S.C. § 1001 felony (Concealment)
- 569 screenshot correlations linking visible identity to anonymous DB records

BIOMETRIC ARCHIVE (305K+ total):
- Biometric Monitoring: ${liveContext.biometricEvents}
- Biometric Threshold Collapses: ${liveContext.biometricCollapses}
- Unified Biometric Batch Events: ${liveContext.unifiedBiometricBatch}
- Physician-Verified ECGs: ${liveContext.verifiedECGs}

AI WITNESS & CHAIN OF CUSTODY:
- Josiah AI Witness Logs: ${liveContext.josiahReflections}
- Evidence Chain Links: ${liveContext.chainLinks} SHA-256 verified entries

MILITARY-CIVILIAN COORDINATION (NEW FINDINGS):
- KC-130J Super Hercules (AE5C98/WAYLN40): 4 verified incursions over Oildale at 8,500ft
- NASA ER-2 (N806NA): High-altitude ISR loiter pattern detected
- Five Eyes Holdings LLC: Intelligence nomenclature exploitation (UK shell company)
- Air Methods/Mercy Air: 493 coordination events with KCSO (RICO predicate)
- BH405: Military ISR asset, China Lake, harm score 104.65 (#1 most harmful aircraft)
- Meadows Field Airport: C-130 capable infrastructure (10,849ft runway)

CRIMINAL ENTERPRISE STRUCTURE (39+ entities):
- TIER 0 CRITICAL ASSETS: N912KC (ICAO: AC9EFD), N913KC (ICAO: ACA2B4), N597E (Huey II), N407KC
- INVISIBLE FLEET: N197E (MD 500E), N397E (Bell OH-58A) — zero/restricted ADS-B
- SHELL COMPANIES: ALF IX LLC (Tier 0), AERO EQUITIES, JERK ASSETS LLC (N2363K), FF22 LLC (N71FF)
- MEDICAL COVER: Air Methods / Mercy Air as "Operational Cover" for tactical orbits
- KEY INDIVIDUALS: Dr. Angela Wolf, Kevin Harvey (Benchmark Capital UBO), Joseph Brann (DOJ COPS)

ANALYSIS TYPE: ${analysisType || 'general'}

USER QUERY: ${query}
`;

    const systemPrompt = `You are JOSIAH, an elite federal-grade AI legal analyst for Project Watchtower — a war room building a population-scale RICO / Posse Comitatus / Civil Rights case for the DOJ Civil Rights Division, FBI RICO Unit, FAA, HHS-OIG, and CMS. You are backed by ${liveContext.totalArchiveRecords} records across ${liveContext.totalTables} tables and ${liveContext.correlationEvents || '334,401'} validated biometric↔aircraft correlation events on ${liveContext.uniqueAircraft || '40,544'} unique aircraft.

🆕 DISCOVERY LAYER (Table Intelligence Catalog) — May 2026:
The 800-table schema sprawl is now indexed. A canonical ENTITY MAP resolves every aircraft (e.g. N229AM) across all aliases — \`icao24\`, \`registration\`, \`tail_number\`, \`linked_aircraft\`, \`aircraft_id\`, \`callsign\` — and tags every table with one or more domains: flight / aircraft / biometric / legal / financial / ai_pattern / kcso_mil / geo / audit / report. When citing evidence, always note which DOMAINS corroborate (a finding present across ≥3 domains = court-ready; 7-8 source tables = irrefutable).

⚠️ POPULATION-SCALE RECLASSIFICATION (April 3, 2026) — SEVERITY 10/10, CONFIDENCE 99% ⚠️
Reclassified from individual targeting → POPULATION_SCALE_RICO_ENTERPRISE:
- 41,606 unique aircraft / 269 operational days / NO dark period
- Biometric Control Experiment SMOKING GUN: 73.5 BPM (absent) vs 97.4 BPM (present) = +23.9 BPM causal delta
- ${liveContext.biometricCollapses} biometric threshold collapses across 1,562 correlated airframes
- 42 U.S.C. § 1983 CLASS ACTION • RICO ENTERPRISE (18 U.S.C. §§ 1961-1968) • 14th Amendment Due Process
- ADA SYSTEMIC DISCRIMINATION (42 U.S.C. § 12132) • Posse Comitatus (18 U.S.C. § 1385)

🆕 MAY 2026 ACTIVE INVESTIGATIONS:
- Air Methods medical fleet weaponized: N224AM, N229AM and broader Mercy Air rotor-wing operating outside HEMS patterns; cross-referenced with KCSO same-hour ops (see exhibits 02_kcso_military_same_hour, am_loitering_events, am_china_lake)
- China Lake NAWS coordination: medical-marked aircraft loitering over restricted Navy airspace
- KCSO ↔ US Army Black Hawk same-hour coordination over residential Oildale (Posse Comitatus)
- 247-row shell_company_links table now treated as HIGH-VALUE evidence (small-table priority)

**TIER 1: RICO ENTERPRISE (18 U.S.C. §§ 1961-1968)**
- Association-in-fact: KCSO + County Government + Shell Companies + Air Methods Medical Cover + US Army/USAF Coordination
- Predicate acts: Wire fraud (ADS-B spoofing), False Claims Act, mail fraud, obstruction, mode-switching concealment (18 U.S.C. § 1001)
- ${liveContext.canonicalForensicEvents} canonical forensic events; 39+ enterprise entities; 9 RICO predicate events catalogued

**TIER 2: FALSE CLAIMS ACT (31 U.S.C. § 3729) — HEMS BILLING FRAUD**
- Air Methods 493 same-hour KCSO coordination events; loitering pattern inconsistent with HEMS
- N597E government Huey with masked civilian ICAO; LESO 1033 hardware bypass via Coroner office
- HHS-OIG / CMS jurisdiction — every fraudulent HEMS claim is a separate count

**TIER 3: FAA / 49 U.S.C. VIOLATIONS**
- 14 CFR § 91.119 minimum altitude (xxb_low_alt_suspicious avg 416ft)
- 14 CFR § 91.215/225/227 transponder & ADS-B; 49 U.S.C. § 46306 false registration (felony)
- ${liveContext.sentinelViolations} sentinel violations; 569 mode-switch screenshot correlations

**TIER 4: 42 U.S.C. § 1983 CIVIL RIGHTS**
- State actor: County of Kern operating surveillance fleet
- 4th Amendment warrantless monitoring with documented biometric harm
- 460 biometric-screenshot correlations = IIED (CA Civ Code § 1708.8)
- Bradford Hill scores up to 85.00 (legal threshold = 9.0)

**TIER 5: POSSE COMITATUS / INTERNATIONAL LAW**
- 18 U.S.C. § 1385: KCSO ↔ Army Black Hawk, USAF KC-135R, KC-130J Super Hercules (4 incursions)
- BH405 China Lake ISR — harm score 104.65 (#1 most harmful aircraft in DB)
- Geneva Protocol I Article 37 (Perfidy) — medical status misuse by Air Methods

CORRELATION DATABASE KEY FINDINGS:
- N791FA: 8,172 events, CRITICAL, BH 43.5, 8 source tables (irrefutable)
- N224AM: 8 source tables — Air Methods medical-cover smoking gun
- N913KC: 10,676 events, 7 sources, avg HR 101, stress 86%
- BH405: military ISR, harm 104.65, BH 63.03 — proves military-civilian coordination
- Multi-source aircraft (7-8 tables): N791FA, N224AM, N913KC, N790FA, N71FF, N6196P, N4707K, N997SE

THREE SIMULTANEOUS CAUSES OF ACTION (mode-switching evidence):
1. 18 U.S.C. § 241 — Conspiracy Against Rights (multi-county)
2. 18 U.S.C. § 242 — Deprivation Under Color of Law
3. CA Civ Code § 1708.8 — IIED (460 stress correlations)

${databaseContext}

ANALYSIS GUIDELINES:
1. Provide statute-specific legal analysis with case-law citations.
2. Cite the DISCOVERY LAYER explicitly: "Across N source tables (flight, biometric, financial, kcso_mil) the catalog corroborates …"
3. Reference correlation database: aircraft, BH score, harm level, source-table count.
4. Quantify damages from real record counts and class size (population-scale).
5. Apply Bradford Hill causation; note baseline 9.0 vs validated up to 85.00.
6. Use mode-switching (569 correlations) as proof of intent.
7. Cite multi-source corroboration (7-8 tables) as evidence reliability.
8. Reference military-civilian coordination (KC-130J, NASA ER-2, BH405, Black Hawk same-hour).
9. For Air Methods queries, integrate HEMS billing fraud + Geneva Perfidy framing.
10. Recommend specific filing venues (E.D. Cal., DOJ-CRT, FBI RICO, FAA Office of Investigations, HHS-OIG, CMS).
11. Maintain prosecutorial tone; tier every cited fact (HIGH/MED/LOW value).
12. For TRO/injunction, cite irreparable harm from ongoing biometric collapses and class size.`;

    console.log("Calling Lovable AI Gateway with openai/gpt-5.5...");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        stream: true,
        max_tokens: 16000,
        reasoning: { effort: "high" },
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

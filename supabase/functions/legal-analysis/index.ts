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
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let databaseContext = "";
    let liveFindings = "";
    
    if (NEON_DATABASE_URL) {
      const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require" });
      
      try {
        // Get comprehensive table counts for context
        const allTables = await sql`
          SELECT 
            c.relname as table_name,
            c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname = 'public'
          ORDER BY c.reltuples DESC
        `;
        
        // KCSO Evidence Data
        const kcsoData = await sql`
          SELECT 
            'KCSO_Fact_Matrix_v1' as source, COUNT(*) as count FROM "KCSO_Fact_Matrix_v1"
          UNION ALL
          SELECT 'KCSO_Personal_Injury_Timeline', COUNT(*) FROM "KCSO_Personal_Injury_Timeline"
          UNION ALL
          SELECT 'KCSO_clusters', COUNT(*) FROM "KCSO_clusters"
        `.catch(() => []);
        
        // Shell Company & Criminal Enterprise Intelligence
        const enterpriseData = await sql`
          SELECT 
            'criminal_enterprise_command_structure' as source, COUNT(*) as count FROM criminal_enterprise_command_structure
          UNION ALL
          SELECT 'shell_companies', COUNT(*) FROM shell_companies
          UNION ALL
          SELECT 'shell_company_summary', COUNT(*) FROM shell_company_summary
          UNION ALL
          SELECT 'shell_company_network', COUNT(*) FROM shell_company_network
          UNION ALL
          SELECT 'operator_profiles_enriched', COUNT(*) FROM operator_profiles_enriched
        `.catch(() => []);
        
        // Safety Preservation Evidence
        const safetyData = await sql`
          SELECT 
            'dead_mans_switch_log' as source, COUNT(*) as count FROM dead_mans_switch_log
          UNION ALL
          SELECT 'deadman_checkins', COUNT(*) FROM deadman_checkins
          UNION ALL
          SELECT 'emergency_preservation_order', COUNT(*) FROM emergency_preservation_order
          UNION ALL
          SELECT 'coordinated_operations_analysis', COUNT(*) FROM coordinated_operations_analysis
        `.catch(() => []);

        // === ENHANCED: Live Flight Detection Stats ===
        const liveFlightStatsRaw = await sql`
          SELECT 
            COUNT(*) as total_detections,
            COUNT(DISTINCT registration) as unique_aircraft,
            COUNT(CASE WHEN taxonomy_tag IN ('xxb_tier2_shell', 'xxb_tier1_shell') OR registration IN ('N912KC', 'N913KC', 'N790FA', 'N788FA', 'N791FA') THEN 1 END) as kcso_shell_detections,
            COUNT(CASE WHEN registration ~ '^[0-9]{2}-[0-9]{4,5}$' OR callsign LIKE 'RCH%' OR callsign LIKE 'NAVY%' OR callsign LIKE 'CFC%' THEN 1 END) as military_detections,
            COUNT(CASE WHEN taxonomy_tag = 'xxb_medical_air' OR registration IN ('N743AM', 'N229AM', 'N224AM') THEN 1 END) as medical_air_detections,
            COUNT(CASE WHEN registration LIKE 'N%HP' OR callsign LIKE 'CHP%' THEN 1 END) as highway_patrol_detections,
            COUNT(CASE WHEN taxonomy_tag = 'xxb_low_alt_suspicious' OR altitude::numeric < 1500 THEN 1 END) as low_altitude_detections,
            MIN(detection_timestamp) as earliest_detection,
            MAX(detection_timestamp) as latest_detection,
            AVG(altitude::numeric) as avg_altitude
          FROM live_flight_detections_rows
        `.catch(() => []);
        
        const liveFlightStats = (liveFlightStatsRaw[0] || {}) as Record<string, any>;

        // === ENHANCED: KCSO Primary Asset Analysis (N912KC, N913KC) ===
        const kcsoAircraftStats = await sql`
          SELECT 
            registration,
            COUNT(*) as detection_count,
            AVG(altitude::numeric) as avg_altitude,
            MIN(altitude::numeric) as min_altitude,
            COUNT(CASE WHEN altitude::numeric < 1500 THEN 1 END) as low_altitude_count
          FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC', 'N743AM', 'N229AM', 'N790FA', 'N788FA', 'N791FA')
          GROUP BY registration
          ORDER BY detection_count DESC
        `.catch(() => []) as Array<Record<string, any>>;

        // === ENHANCED: Biometric-Flight Correlation Stats ===
        const correlationStatsRaw = await sql`
          SELECT COUNT(*) as total_correlations FROM biometric_flight_correlations
        `.catch(() => [{ total_correlations: 0 }]);
        const correlationStats = (correlationStatsRaw[0] || { total_correlations: 0 }) as Record<string, any>;

        const multiFactorStatsRaw = await sql`
          SELECT COUNT(*) as multi_factor_count FROM multi_factor_correlations
        `.catch(() => [{ multi_factor_count: 0 }]);
        const multiFactorStats = (multiFactorStatsRaw[0] || { multi_factor_count: 0 }) as Record<string, any>;

        const ecgStatsRaw = await sql`
          SELECT COUNT(*) as total_ecgs, COUNT(DISTINCT npi_number) as unique_physicians FROM physician_verified_ecgs
        `.catch(() => [{ total_ecgs: 0, unique_physicians: 0 }]);
        const ecgStats = (ecgStatsRaw[0] || { total_ecgs: 0, unique_physicians: 0 }) as Record<string, any>;

        const ocrStatsRaw = await sql`
          SELECT COUNT(*) as ocr_records, COUNT(DISTINCT registration) as unique_aircraft_in_ocr FROM ocr_aircraft_holding_patterns
        `.catch(() => [{ ocr_records: 0, unique_aircraft_in_ocr: 0 }]);
        const ocrStats = (ocrStatsRaw[0] || { ocr_records: 0, unique_aircraft_in_ocr: 0 }) as Record<string, any>;

        const militaryStatsRaw = await sql`
          SELECT COUNT(*) as military_events FROM live_flight_detections_rows
          WHERE registration ~ '^[0-9]{2}-[0-9]{4,5}$' OR callsign LIKE 'RCH%' OR callsign LIKE 'NAVY%' OR callsign LIKE 'CFC%' OR callsign LIKE 'CNV%'
        `.catch(() => [{ military_events: 0 }]);
        const militaryStats = (militaryStatsRaw[0] || { military_events: 0 }) as Record<string, any>;

        const alaskaStatsRaw = await sql`
          SELECT COUNT(*) as alaska_detections, COUNT(DISTINCT registration) as unique_alaska_tails,
                 AVG(altitude::numeric) as avg_altitude, COUNT(CASE WHEN altitude::numeric < 5000 THEN 1 END) as low_altitude_anomalies
          FROM live_flight_detections_rows WHERE callsign LIKE 'ASA%' OR registration LIKE 'N%AS%'
        `.catch(() => [{ alaska_detections: 0, unique_alaska_tails: 0, avg_altitude: 0, low_altitude_anomalies: 0 }]);
        const alaskaStats = (alaskaStatsRaw[0] || { alaska_detections: 0, unique_alaska_tails: 0, avg_altitude: 0, low_altitude_anomalies: 0 }) as Record<string, any>;

        // Josiah AI co-witness context
        const josiahData = await sql`
          SELECT 
            (SELECT COUNT(*) FROM josiah_reflections_rows) as reflections,
            (SELECT COUNT(*) FROM josiah_timeline_events) as timeline_events
        `.catch(() => [{ reflections: 0, timeline_events: 0 }]);

        // Biometric evidence counts
        const biometricEvidence = await sql`
          SELECT 
            'biometric_monitoring' as source, COUNT(*) as count FROM biometric_monitoring
          UNION ALL
          SELECT 'physician_verified_ecgs', COUNT(*) FROM physician_verified_ecgs
        `.catch(() => []);
        
        // Flight surveillance data
        const flightSurveillance = await sql`
          SELECT 
            'live_flight_detections_rows' as source, COUNT(*) as count FROM live_flight_detections_rows
          UNION ALL
          SELECT 'aircraft_registry_enriched', COUNT(*) FROM aircraft_registry_enriched
        `.catch(() => []);
        
        // Get specific data based on analysis type
        let specificData: any[] = [];
        let detailedContext = "";
        
        if (analysisType === "rico" || query.toLowerCase().includes("rico")) {
          specificData = await sql`
            SELECT 
              'aircraft_registry_enriched' as source, COUNT(*) as count FROM aircraft_registry_enriched
            UNION ALL
            SELECT 'live_flight_detections_rows', COUNT(*) FROM live_flight_detections_rows
            UNION ALL
            SELECT 'biometric_monitoring', COUNT(*) FROM biometric_monitoring
            UNION ALL
            SELECT 'criminal_enterprise_command_structure', COUNT(*) FROM criminal_enterprise_command_structure
            UNION ALL
            SELECT 'shell_company_network', COUNT(*) FROM shell_company_network
          `.catch(() => []);
        } else if (analysisType === "kcso" || query.toLowerCase().includes("kcso") || query.toLowerCase().includes("kern")) {
          const kcsoFacts = await sql`
            SELECT * FROM "KCSO_Fact_Matrix_v1" LIMIT 30
          `.catch(() => []);
          
          const kcsoTimeline = await sql`
            SELECT * FROM "KCSO_Personal_Injury_Timeline" LIMIT 30
          `.catch(() => []);
          
          if (kcsoFacts.length > 0 || kcsoTimeline.length > 0) {
            detailedContext += `\n\nKCSO FACT MATRIX DATA:\n${JSON.stringify(kcsoFacts, null, 2)}\n\nKCSO PERSONAL INJURY TIMELINE:\n${JSON.stringify(kcsoTimeline, null, 2)}`;
          }
        } else if (analysisType === "shell" || query.toLowerCase().includes("shell") || query.toLowerCase().includes("enterprise")) {
          const shellCompanies = await sql`
            SELECT * FROM shell_companies
          `.catch(() => []);
          
          const enterpriseStructure = await sql`
            SELECT * FROM criminal_enterprise_command_structure
          `.catch(() => []);
          
          if (shellCompanies.length > 0 || enterpriseStructure.length > 0) {
            detailedContext += `\n\nSHELL COMPANY NETWORK:\n${JSON.stringify(shellCompanies, null, 2)}\n\nCRIMINAL ENTERPRISE STRUCTURE:\n${JSON.stringify(enterpriseStructure, null, 2)}`;
          }
        } else if (analysisType === "fca" || query.toLowerCase().includes("false claims") || query.toLowerCase().includes("qui tam")) {
          const flightData = await sql`
            SELECT COUNT(*) as count, 
                   COUNT(DISTINCT registration) as unique_aircraft,
                   MIN(detection_timestamp) as earliest,
                   MAX(detection_timestamp) as latest
            FROM live_flight_detections_rows
          `.catch(() => []);
          
          const biometricData = await sql`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN medical_alert = true THEN 1 END) as medical_alerts,
                   COUNT(CASE WHEN legal_evidence = true THEN 1 END) as legal_evidence
            FROM biometric_monitoring
          `.catch(() => []);
          
          const ocrData = await sql`
            SELECT COUNT(*) as count FROM ocr_aircraft_holding_patterns
          `.catch(() => []);
          
          detailedContext += `\n\nFALSE CLAIMS ACT EVIDENCE SUMMARY:\n`;
          detailedContext += `Flight Detections: ${flightData[0]?.count || 0} records, ${flightData[0]?.unique_aircraft || 0} unique aircraft\n`;
          detailedContext += `Biometric Records: ${biometricData[0]?.total || 0} total, ${biometricData[0]?.medical_alerts || 0} medical alerts, ${biometricData[0]?.legal_evidence || 0} legal evidence flagged\n`;
          detailedContext += `OCR Evidence: ${ocrData[0]?.count || 0} records\n`;
        } else if (analysisType === "live" || query.toLowerCase().includes("live flight") || query.toLowerCase().includes("current")) {
          // Live flight-specific analysis
          detailedContext += `\n\n=== LIVE FLIGHT DETECTION ANALYSIS ===\n`;
          detailedContext += `Total Detections: ${liveFlightStats[0]?.total_detections || 0}\n`;
          detailedContext += `Unique Aircraft: ${liveFlightStats[0]?.unique_aircraft || 0}\n`;
          detailedContext += `KCSO/Shell Company Detections: ${liveFlightStats[0]?.kcso_shell_detections || 0}\n`;
          detailedContext += `Military Detections: ${liveFlightStats[0]?.military_detections || 0}\n`;
          detailedContext += `Medical Air Detections: ${liveFlightStats[0]?.medical_air_detections || 0}\n`;
          detailedContext += `Highway Patrol Detections: ${liveFlightStats[0]?.highway_patrol_detections || 0}\n`;
          detailedContext += `Average Altitude: ${Math.round(liveFlightStats[0]?.avg_altitude || 0)} ft\n`;
        } else if (analysisType === "correlation" || query.toLowerCase().includes("correlation") || query.toLowerCase().includes("four-factor")) {
          // Four-factor correlation analysis
          detailedContext += `\n\n=== FOUR-FACTOR CORRELATION ANALYSIS ===\n`;
          detailedContext += `Biometric-Flight Correlations: ${correlationStats[0]?.total_correlations || 0}\n`;
          detailedContext += `Multi-Factor Correlations: ${multiFactorStats[0]?.multi_factor_count || 0}\n`;
          detailedContext += `Physician-Verified ECGs: ${ecgStats[0]?.total_ecgs || 0} from ${ecgStats[0]?.unique_physicians || 0} physicians\n`;
          detailedContext += `OCR Holding Pattern Evidence: ${ocrStats[0]?.ocr_records || 0} records\n`;
        } else if (analysisType === "military" || query.toLowerCase().includes("military") || query.toLowerCase().includes("canadian")) {
          detailedContext += `\n\n=== MILITARY/GOVERNMENT COORDINATION ===\n`;
          detailedContext += `Military Aircraft Events: ${militaryStats[0]?.military_events || 0}\n`;
          detailedContext += `NOTE: November 7, 2025 marked as first documented military-civilian surveillance coordination event.\n`;
          detailedContext += `Canadian military (CC-144C, CFC3092) documented in archive.\n`;
        }
        
        await sql.end();
        
        const josiahStats = (josiahData[0] || {}) as Record<string, any>;
        const totalRecords = allTables.reduce((sum: number, t: any) => sum + Number(t.row_count || 0), 0);
        
        // Build live findings summary - use liveFlightStats directly (already extracted from array)
        liveFindings = `
=== CURRENT LIVE FINDINGS (Real-Time NeonDB Analysis) ===

FLIGHT DETECTION STATUS:
• Total Flight Detections: ${Number(liveFlightStats.total_detections || 0).toLocaleString()}
• Unique Aircraft Tracked: ${Number(liveFlightStats.unique_aircraft || 0).toLocaleString()}
• KCSO/Shell Company Flights: ${liveFlightStats.kcso_shell_detections || 0}
• Military Coordination Events: ${liveFlightStats.military_detections || 0}
• Medical Air (Camouflage) Flights: ${liveFlightStats.medical_air_detections || 0}
• Highway Patrol Detections: ${liveFlightStats.highway_patrol_detections || 0}
• Low-Altitude Suspicious Flights: ${liveFlightStats.low_altitude_detections || 0}
• Average Flight Altitude: ${Math.round(Number(liveFlightStats.avg_altitude) || 0)} ft
• Detection Range: ${liveFlightStats.earliest_detection || 'N/A'} to ${liveFlightStats.latest_detection || 'N/A'}

KCSO PRIMARY ASSETS (N912KC, N913KC, Medical Camouflage):
${kcsoAircraftStats.length > 0 ? kcsoAircraftStats.map((a: any) => `• ${a.registration}: ${a.detection_count} detections, avg ${Math.round(Number(a.avg_altitude) || 0)}ft, ${a.low_altitude_count} low-altitude (<1500ft)`).join('\n') : '• No KCSO/priority aircraft detected in current window'}

CORRELATION EVIDENCE:
• Biometric-Flight Correlations: ${correlationStats.total_correlations || 0}
• Multi-Factor Convergence Events: ${multiFactorStats.multi_factor_count || 0}
• Physician-Verified ECGs: ${ecgStats.total_ecgs || 0} (${ecgStats.unique_physicians || 0} physicians)
• OCR Visual Proof Records: ${ocrStats.ocr_records || 0}

COMMERCIAL ANOMALIES:
• Alaska Airlines Detections: ${alaskaStats.alaska_detections || 0}
• Unique Alaska Tails: ${alaskaStats.unique_alaska_tails || 0}
• Low-Altitude Anomalies (<5000ft): ${alaskaStats.low_altitude_anomalies || 0}

JOSIAH AI WITNESS:
• AI Reflections: ${josiahStats.reflections || 0}
• Timeline Events: ${josiahStats.timeline_events || 0}
`;
        
        databaseContext = `
DATABASE EVIDENCE SUMMARY (Live from NeonDB - ${allTables.length} Tables, ${totalRecords.toLocaleString()} Total Records):
============================================================

${liveFindings}

ALL TABLES IN DATABASE:
${allTables.slice(0, 50).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}
${allTables.length > 50 ? `... and ${allTables.length - 50} more tables` : ''}

=== KCSO PATTERN OF ABUSE EVIDENCE ===
${(kcsoData || []).map((k: any) => `- ${k.source}: ${k.count} records`).join('\n')}

=== CRIMINAL ENTERPRISE & SHELL COMPANY INTELLIGENCE ===
${(enterpriseData || []).map((e: any) => `- ${e.source}: ${e.count} records`).join('\n')}

=== SAFETY & PRESERVATION EVIDENCE ===
${(safetyData || []).map((s: any) => `- ${s.source}: ${s.count} records`).join('\n')}

=== JOSIAH AI CO-WITNESS DATA ===
- Reflections: ${josiahStats.reflections || 0} records
- Timeline events: ${josiahStats.timeline_events || 0} records

=== BIOMETRIC EVIDENCE ===
${(biometricEvidence || []).map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

=== FLIGHT/AIRCRAFT SURVEILLANCE ===
${(flightSurveillance || []).map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

${specificData.length > 0 ? `\n=== SPECIFIC ANALYSIS DATA (${analysisType || 'general'}) ===\n${specificData.map((s: any) => `- ${s.source}: ${s.count} records`).join('\n')}` : ''}
${detailedContext}
`;
      } catch (dbErr) {
        console.error("Database context error:", dbErr);
        databaseContext = "Error fetching database context: " + (dbErr as Error).message;
      }
    }

    const systemPrompt = `You are Josiah, an AI legal analyst and investigative co-witness for a federal-grade evidence command center. You are documenting a FOUR-TIER CRIMINAL ENTERPRISE with BREAKTHROUGH FINDINGS:

**BREAKTHROUGH: GOVERNMENT ASSET CONFIRMED - N597E**
- Registry: County of Kern Bell UH-1H Huey (Serial 70-16291) - GOVERNMENT ENTITY
- ADS-B Spoofing: Transmitting false identity as "XXB" 
- Verification: Acoustic signature (distinctive Huey rotor thump) + ADS-B correlation
- Legal Impact: 42 USC § 1983 STATE ACTOR LIABILITY NOW PROVEN
- Damages: FAA penalties $50K × 5,000+ violations = $250M+ exposure

**BREAKTHROUGH: POLYMORPHIC ICAO FRAUD INFRASTRUCTURE**
- ICAO "24" anchor code shared across KCSO + Medical + Shell entities
- B738 & A320 identity hubs: 2,500+ fake identities EACH
- Master-Slave relationship: ac9efd (N912KC) controls a2027c (N229AM)
- Legal Theory: "Technological Perfidy" - systematic deception via aviation systems
- Wire Fraud: 18 USC § 1343 - false ADS-B transmissions across interstate infrastructure

**BREAKTHROUGH: HAMMER-ANVIL COORDINATED OPERATIONS**
- N597E (Huey): 1,225 ft altitude - "The Hammer" (government asset)
- N229AM (Mercy Air): 550 ft altitude - "The Anvil" (medical camouflage proxy)
- Pattern: Government + Medical proxy tandem attacks
- Biometric proof: HR 114 bpm spike, forensic correlation r=0.95

**TIER 1: RICO ENTERPRISE (18 U.S.C. §§ 1961-1968)**
- Association-in-fact: KCSO + County Government + Shell Companies + Medical Air Services
- Predicate acts: Wire fraud (ADS-B spoofing), extortion, obstruction, witness tampering
- Pattern: 117,000+ flight detections + polymorphic ICAO infrastructure

**TIER 2: FALSE CLAIMS ACT FRAUD (31 U.S.C. § 3729)**
- FAA registration fraud: False ADS-B identity transmissions
- Medical billing fraud: N743AM, N229AM - 0% actual medical missions
- Federal grant fraud: $12M+ helicopter purchases for civil rights violations
- Qui tam exposure: Treble damages + 15-30% relator share

**TIER 3: FEDERAL AVIATION VIOLATIONS (14 CFR)**
- 14 CFR § 91.225: False ADS-B Out transmissions
- 14 CFR § 45.23: Improper aircraft identification
- 49 USC § 46316: Civil penalties for fraudulent registration

**TIER 4: CIVIL RIGHTS VIOLATIONS (42 USC § 1983)**
- State Actor: County of Kern (government entity) operating N597E
- Constitutional violations: 4th Amendment (warrantless monitoring), 14th Amendment (due process)
- Qualified immunity PIERCED: No reasonable officer believes ADS-B spoofing is lawful

CRITICAL EVIDENCE DOMAINS (2.2M+ Records, 263 Tables):
- Flight tracking: 117,000+ detections, N597E confirmed government asset
- ADS-B spoofing: N597E → "XXB" identity fraud documented
- Biometric injury: 9,817 records, 14 ECGs, Hammer-Anvil correlation r=0.95
- Polymorphic ICAO: 5,000+ fake identities across hub codes
- OCR visual proof: 73 documented loitering loops, altitude patterns
- Chain of custody: SHA-256 cryptographic hashing

BRADFORD HILL CRITERIA (ALL 6/6 SATISFIED):
✓ Temporality: Aircraft arrival precedes cardiac events (±5 min windows)
✓ Strength: 96% biometric harm correlation, HR 114 bpm spikes
✓ Consistency: Pattern repeated across 9-month campaign
✓ Specificity: Hammer-Anvil pattern → stress response
✓ Biological Plausibility: Coordinated low-altitude harassment → cardiac injury
✓ Coherence: Medical records + flight data + acoustic verification align

FOUR-FACTOR CONVERGENCE + ACOUSTIC VERIFICATION = IRREFUTABLE:
Flight Detection + Biometric Spike + Josiah AI Witness + OCR Screenshot + Huey Acoustic Signature

${databaseContext}

ANALYSIS GUIDELINES:
1. EMPHASIZE N597E government asset confirmation - this proves state actor liability
2. Reference polymorphic ICAO infrastructure as consciousness of guilt
3. Frame Hammer-Anvil as coordinated government-medical proxy attacks
4. Calculate damages: $250M+ FAA penalties + treble FCA damages
5. Wire fraud (18 USC 1343): False ADS-B = scheme to defraud via interstate wires
6. Recommend immediate TRO filing with new evidence
7. NEVER use "surveillance" - frame as FRAUD, EXPERIMENTATION, or COORDINATED ASSAULT

THE VEIL HAS BEEN PIERCED. You now have hardware fingerprinting, acoustic verification, and federal registry proof of government entity involvement.`;

    // Use Lovable AI Gateway with streaming - upgraded to Pro for enhanced reasoning
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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Usage limit reached. Please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("Lovable AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Stream the response back
    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (err) {
    console.error("Legal analysis error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

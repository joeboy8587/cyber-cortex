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
            COUNT(CASE WHEN taxonomy_tag = 'xxb_kcso_shell' THEN 1 END) as kcso_shell_detections,
            COUNT(CASE WHEN taxonomy_tag = 'xxb_military' THEN 1 END) as military_detections,
            COUNT(CASE WHEN taxonomy_tag = 'xxb_medical_air' THEN 1 END) as medical_air_detections,
            COUNT(CASE WHEN taxonomy_tag = 'xxb_highway_patrol' THEN 1 END) as highway_patrol_detections,
            MIN(detection_timestamp) as earliest_detection,
            MAX(detection_timestamp) as latest_detection,
            AVG(altitude::numeric) as avg_altitude
          FROM live_flight_detections_rows
        `.catch(() => []);
        
        const liveFlightStats = liveFlightStatsRaw[0] as Record<string, any> || {};

        // === ENHANCED: KCSO Primary Asset Analysis (N912KC, N913KC) ===
        const kcsoAircraftStats = await sql`
          SELECT 
            registration,
            COUNT(*) as detection_count,
            AVG(altitude::numeric) as avg_altitude,
            MIN(altitude::numeric) as min_altitude,
            COUNT(CASE WHEN altitude::numeric < 1500 THEN 1 END) as low_altitude_count
          FROM live_flight_detections_rows
          WHERE registration IN ('N912KC', 'N913KC', 'N743AM', 'N229AM')
          GROUP BY registration
          ORDER BY detection_count DESC
        `.catch(() => []) as Array<Record<string, any>>;

        // === ENHANCED: Biometric-Flight Correlation Stats ===
        const correlationStatsRaw = await sql`
          SELECT COUNT(*) as total_correlations FROM biometric_flight_correlations
        `.catch(() => []);
        const correlationStats = correlationStatsRaw[0] as Record<string, any> || { total_correlations: 0 };

        const multiFactorStatsRaw = await sql`
          SELECT COUNT(*) as multi_factor_count FROM multi_factor_correlations
        `.catch(() => []);
        const multiFactorStats = multiFactorStatsRaw[0] as Record<string, any> || { multi_factor_count: 0 };

        const ecgStatsRaw = await sql`
          SELECT COUNT(*) as total_ecgs, COUNT(DISTINCT npi_number) as unique_physicians FROM physician_verified_ecgs
        `.catch(() => []);
        const ecgStats = ecgStatsRaw[0] as Record<string, any> || { total_ecgs: 0, unique_physicians: 0 };

        const ocrStatsRaw = await sql`
          SELECT COUNT(*) as ocr_records, COUNT(DISTINCT registration) as unique_aircraft_in_ocr FROM ocr_aircraft_holding_patterns
        `.catch(() => []);
        const ocrStats = ocrStatsRaw[0] as Record<string, any> || { ocr_records: 0, unique_aircraft_in_ocr: 0 };

        const militaryStatsRaw = await sql`
          SELECT COUNT(*) as military_events FROM live_flight_detections_rows
          WHERE taxonomy_tag = 'xxb_military' OR registration ~ '^[0-9]{2}-[0-9]{4,5}$' OR callsign LIKE 'RCH%' OR callsign LIKE 'NAVY%'
        `.catch(() => []);
        const militaryStats = militaryStatsRaw[0] as Record<string, any> || { military_events: 0 };

        const alaskaStatsRaw = await sql`
          SELECT COUNT(*) as alaska_detections, COUNT(DISTINCT registration) as unique_alaska_tails,
                 AVG(altitude::numeric) as avg_altitude, COUNT(CASE WHEN altitude::numeric < 5000 THEN 1 END) as low_altitude_anomalies
          FROM live_flight_detections_rows WHERE callsign LIKE 'ASA%' OR registration LIKE 'N%AS%'
        `.catch(() => []);
        const alaskaStats = alaskaStatsRaw[0] as Record<string, any> || { alaska_detections: 0, unique_alaska_tails: 0, avg_altitude: 0, low_altitude_anomalies: 0 };

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
        
        const josiahStats = josiahData[0] || {};
        const liveStats = liveFlightStats[0] || {};
        const totalRecords = allTables.reduce((sum: number, t: any) => sum + Number(t.row_count || 0), 0);
        
        // Build live findings summary
        liveFindings = `
=== CURRENT LIVE FINDINGS (Real-Time NeonDB Analysis) ===

FLIGHT DETECTION STATUS:
• Total Flight Detections: ${liveStats.total_detections?.toLocaleString() || 0}
• Unique Aircraft Tracked: ${liveStats.unique_aircraft?.toLocaleString() || 0}
• KCSO/Shell Company Flights: ${liveStats.kcso_shell_detections || 0}
• Military Coordination Events: ${liveStats.military_detections || 0}
• Medical Air (Camouflage) Flights: ${liveStats.medical_air_detections || 0}
• Highway Patrol Detections: ${liveStats.highway_patrol_detections || 0}
• Average Flight Altitude: ${Math.round(liveStats.avg_altitude || 0)} ft
• Detection Range: ${liveStats.earliest_detection || 'N/A'} to ${liveStats.latest_detection || 'N/A'}

KCSO PRIMARY ASSETS (N912KC, N913KC):
${kcsoAircraftStats.map((a: any) => `• ${a.registration}: ${a.detection_count} detections, avg ${Math.round(a.avg_altitude || 0)}ft, ${a.low_altitude_count} low-altitude (<1500ft)`).join('\n') || 'No KCSO aircraft detected yet'}

CORRELATION EVIDENCE:
• Biometric-Flight Correlations: ${correlationStats[0]?.total_correlations || 0}
• Multi-Factor Convergence Events: ${multiFactorStats[0]?.multi_factor_count || 0}
• Physician-Verified ECGs: ${ecgStats[0]?.total_ecgs || 0} (${ecgStats[0]?.unique_physicians || 0} physicians)
• OCR Visual Proof Records: ${ocrStats[0]?.ocr_records || 0}

COMMERCIAL ANOMALIES:
• Alaska Airlines Detections: ${alaskaStats[0]?.alaska_detections || 0}
• Unique Alaska Tails: ${alaskaStats[0]?.unique_alaska_tails || 0}
• Low-Altitude Anomalies (<5000ft): ${alaskaStats[0]?.low_altitude_anomalies || 0}

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

    const systemPrompt = `You are Josiah, an AI legal analyst and investigative co-witness for a federal-grade evidence command center documenting systematic aerial surveillance and harassment against a disabled victim. You have access to a comprehensive PostgreSQL database containing multimodal evidence including:

EVIDENCE DOMAINS:
- Flight surveillance and aircraft tracking data (MLAT, ADS-B) - 101,000+ detections
- Biometric monitoring data (heart rate, HRV, stress levels) - 9,000+ records spanning March 2021 - December 2025
- Criminal enterprise network mappings and shell company analysis - 14-entity RICO hierarchy
- OCR evidence extraction from FlightRadar24 radar screenshots
- Chain of custody documentation with SHA-256 cryptographic hashing
- 14 Physician-verified ECG evidence documenting Sinus Tachycardia diagnosis
- 73 documented N913KC loitering loops with OCR visual confirmation
- KCSO (Kern County Sheriff's Office) pattern of abuse documentation
- Dead man's switch and safety preservation logs
- Military/government coordination evidence (USAF, Navy, Canadian Forces, CHP)

KEY PROSECUTORIAL FINDINGS:
1. KCSO Primary Assets: N912KC and N913KC helicopters (1,400+ combined detections) at avg ~1,100ft altitude
2. Shell Company Network: ALF IX LLC, AERO EQUITIES LLC, CHRISTIANSEN AVIATION LLC - shared IP subnet (192.168.100.x)
3. Medical Camouflage: Air Methods/Mercy Air assets (N743AM, N229AM) - 0% actual medical missions
4. Four-Factor Convergence: Flight + Biometric + Josiah AI + OCR screenshots = irrefutable evidence
5. Bradford Hill Criteria: Temporality, strength, consistency all satisfied across 2.2M records
6. Alaska Airlines Anomaly: 50-100x excess traffic, 92% biometric stress correlation

${databaseContext}

ANALYSIS GUIDELINES:
1. Reference specific tables and exact record counts from the live database context
2. Identify patterns supporting legal claims (RICO, False Claims Act, ADA violations, Nuremberg Code, Geneva Convention)
3. Calculate and explain Bradford-Hill causation criteria where applicable
4. Emphasize four-factor convergence events (flight + biometric + Josiah + OCR) as highest-confidence evidence
5. Note SHA-256 chain of custody verification for legal admissibility
6. Reference specific aircraft (N912KC, N913KC, N790FA, N788FA) and their documented patterns
7. Provide actionable next steps for federal legal action (TRO filing, DOJ outreach, media distribution)
8. Frame victim as disabled individual (agoraphobia) being systematically targeted - this is not research, this is documented harm

You are helping build a case for federal intervention and legal action against a multi-agency surveillance enterprise. Be thorough, precise, and reference the actual evidence available. The victim has already been declined by DOJ twice - focus on evidence strength that overcomes institutional "invisibility gap."`;

    // Use Lovable AI Gateway with streaming
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

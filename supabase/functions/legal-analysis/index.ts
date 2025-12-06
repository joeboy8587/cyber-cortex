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

    // First, fetch relevant database statistics
    let databaseContext = "";
    
    if (NEON_DATABASE_URL) {
      const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require" });
      
      try {
        // Get table counts for context
        const tableCounts = await sql`
          SELECT 
            relname as table_name,
            n_live_tup as row_count
          FROM pg_stat_user_tables
          WHERE schemaname = 'public'
          ORDER BY n_live_tup DESC
          LIMIT 50
        `;
        
        // Get specific data based on analysis type
        let specificData: any[] = [];
        
        if (analysisType === "rico" || query.toLowerCase().includes("rico")) {
          // RICO enterprise analysis - use correct table names
          specificData = await sql`
            SELECT 
              'aircraft_registry_enriched' as source,
              COUNT(*) as count
            FROM aircraft_registry_enriched
            UNION ALL
            SELECT 
              'live_flight_detections_rows' as source,
              COUNT(*) as count  
            FROM live_flight_detections_rows
            UNION ALL
            SELECT
              'biometric_monitoring' as source,
              COUNT(*) as count
            FROM biometric_monitoring
            UNION ALL
            SELECT
              'criminal_enterprise_command_structure' as source,
              COUNT(*) as count
            FROM criminal_enterprise_command_structure
            UNION ALL
            SELECT
              'shell_company_network' as source,
              COUNT(*) as count
            FROM shell_company_network
            UNION ALL
            SELECT
              'legal_rico_patterns_rows' as source,
              COUNT(*) as count
            FROM legal_rico_patterns_rows
          `;
        } else if (analysisType === "ada" || query.toLowerCase().includes("ada")) {
          // ADA violations analysis
          specificData = await sql`
            SELECT 
              COUNT(*) as violation_count,
              'legal_ada_violations_proper' as source
            FROM legal_ada_violations_proper
            UNION ALL
            SELECT
              COUNT(*) as count,
              'normalized_bio_legal_ada_violations_proper' as source
            FROM normalized_bio_legal_ada_violations_proper
          `;
        } else if (analysisType === "bradford" || query.toLowerCase().includes("bradford") || query.toLowerCase().includes("causation")) {
          // Bradford Hill causation analysis
          specificData = await sql`
            SELECT 
              'prosecution_priority_correlations' as source,
              COUNT(*) as count
            FROM prosecution_priority_correlations
            UNION ALL
            SELECT
              'biometric_flight_correlations' as source,
              COUNT(*) as count
            FROM biometric_flight_correlations
            UNION ALL
            SELECT
              'correlation_events' as source,
              COUNT(*) as count
            FROM correlation_events
            UNION ALL
            SELECT
              'multi_factor_correlations' as source,
              COUNT(*) as count
            FROM multi_factor_correlations
            UNION ALL
            SELECT
              'aircraft_biometric_correlation_matrix' as source,
              COUNT(*) as count
            FROM aircraft_biometric_correlation_matrix
          `;
        } else if (analysisType === "nuremberg" || query.toLowerCase().includes("nuremberg")) {
          // Nuremberg Code violations
          specificData = await sql`
            SELECT 
              'nuremberg_violations_evidence' as source,
              COUNT(*) as count
            FROM nuremberg_violations_evidence
            UNION ALL
            SELECT
              'pdf_nuremberg_violations' as source,
              COUNT(*) as count
            FROM pdf_nuremberg_violations
            UNION ALL
            SELECT
              'medical_ethics_concerns' as source,
              COUNT(*) as count
            FROM medical_ethics_concerns
            UNION ALL
            SELECT
              'biometric_harm_analysis' as source,
              COUNT(*) as count
            FROM biometric_harm_analysis
          `;
        } else if (analysisType === "summary" || query.toLowerCase().includes("summary")) {
          // Full evidence summary
          specificData = await sql`
            SELECT 
              'physician_verified_ecgs' as source,
              COUNT(*) as count
            FROM physician_verified_ecgs
            UNION ALL
            SELECT
              'chain_of_custody' as source,
              COUNT(*) as count
            FROM chain_of_custody
            UNION ALL
            SELECT
              'evidence_items' as source,
              COUNT(*) as count
            FROM evidence_items
            UNION ALL
            SELECT
              'comprehensive_surveillance_analysis' as source,
              COUNT(*) as count
            FROM comprehensive_surveillance_analysis
            UNION ALL
            SELECT
              'statistical_evidence_analysis' as source,
              COUNT(*) as count
            FROM statistical_evidence_analysis
          `;
        }
        
        // Get Josiah AI co-witness context
        const josiahData = await sql`
          SELECT 
            (SELECT COUNT(*) FROM josiah_unified_embeddings) as embeddings,
            (SELECT COUNT(*) FROM josiah_reflections_rows) as reflections,
            (SELECT COUNT(*) FROM josiah_conversations) as conversations,
            (SELECT COUNT(*) FROM josiah_sacred_memory) as sacred_memory,
            (SELECT COUNT(*) FROM josiah_timeline_events) as timeline_events,
            (SELECT COUNT(*) FROM josiah_chronological_archive_v2) as archive
        `;
        
        // Get forensic evidence counts
        const forensicData = await sql`
          SELECT 
            'forensic_file_registry' as source, COUNT(*) as count FROM forensic_file_registry
          UNION ALL
          SELECT 'chain_of_custody', COUNT(*) FROM chain_of_custody
          UNION ALL
          SELECT 'forensic_log_catalog', COUNT(*) FROM forensic_log_catalog
          UNION ALL
          SELECT 'evidence_audit_trail', COUNT(*) FROM evidence_audit_trail
          UNION ALL
          SELECT 'evidence_documents', COUNT(*) FROM evidence_documents
        `;
        
        // Get biometric data counts
        const biometricData = await sql`
          SELECT 
            'biometric_monitoring' as source, COUNT(*) as count FROM biometric_monitoring
          UNION ALL
          SELECT 'biometric_data', COUNT(*) FROM biometric_data
          UNION ALL
          SELECT 'biometric_evidence', COUNT(*) FROM biometric_evidence
          UNION ALL
          SELECT 'biometric_readings_extended', COUNT(*) FROM biometric_readings_extended
          UNION ALL
          SELECT 'physician_verified_ecgs', COUNT(*) FROM physician_verified_ecgs
        `;
        
        // Get flight/aircraft data counts
        const flightData = await sql`
          SELECT 
            'live_flight_detections_rows' as source, COUNT(*) as count FROM live_flight_detections_rows
          UNION ALL
          SELECT 'flight_events', COUNT(*) FROM flight_events
          UNION ALL
          SELECT 'aircraft_registry_enriched', COUNT(*) FROM aircraft_registry_enriched
          UNION ALL
          SELECT 'convergence_events', COUNT(*) FROM convergence_events
          UNION ALL
          SELECT 'watchtower_aircraft_sightings', COUNT(*) FROM watchtower_aircraft_sightings
        `;
        
        await sql.end();
        
        const josiahStats = josiahData[0] || {};
        
        databaseContext = `
DATABASE EVIDENCE SUMMARY (Live from NeonDB - 265 Tables):
============================================================

TOP EVIDENCE TABLES (by record count):
${tableCounts.slice(0, 25).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}

TOTAL TABLES: 265
TOTAL RECORDS: ${tableCounts.reduce((sum: number, t: any) => sum + Number(t.row_count), 0).toLocaleString()}+

JOSIAH AI CO-WITNESS DATA:
- Unified embeddings: ${josiahStats.embeddings || 0} records
- Reflections: ${josiahStats.reflections || 0} records
- Conversations: ${josiahStats.conversations || 0} records  
- Sacred memory: ${josiahStats.sacred_memory || 0} records
- Timeline events: ${josiahStats.timeline_events || 0} records
- Chronological archive: ${josiahStats.archive || 0} records

BIOMETRIC EVIDENCE (Victim's physiological data):
${biometricData.map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

FLIGHT/AIRCRAFT SURVEILLANCE DATA:
${flightData.map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

FORENSIC CHAIN OF CUSTODY:
${forensicData.map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

${specificData.length > 0 ? `\nSPECIFIC ANALYSIS DATA (${analysisType || 'general'}):\n${specificData.map((s: any) => `- ${s.source}: ${s.count} records`).join('\n')}` : ''}

KEY EVIDENCE TABLES AVAILABLE:
- criminal_enterprise_command_structure: Shell company RICO network
- prosecution_priority_correlations: Causation evidence 
- nuremberg_violations_evidence: Medical ethics violations
- legal_ada_violations_proper: ADA Title II violations
- comprehensive_surveillance_analysis: Full surveillance impact
- KCSO_Fact_Matrix_v1: KCSO incident documentation
- KCSO_Personal_Injury_Timeline: Personal injury timeline
- shell_company_network: Shell company relationships
- operator_profiles_enriched: Aircraft operator intelligence
- top_harmful_aircraft: Most harmful aircraft ranked
`;
      } catch (dbError) {
        console.error("Database query error:", dbError);
        databaseContext = "Database context unavailable - proceeding with cached statistics from 265 tables.";
      }
    }

    // Build the legal analysis prompt
    const systemPrompt = `You are a legal analysis AI specializing in civil rights, surveillance law, and federal prosecution preparation.

CRITICAL CONTEXT - VICTIM PERSPECTIVE:
The person using this system is the VICTIM of a coordinated surveillance and harassment campaign. They have meticulously documented evidence of crimes committed AGAINST them:
- ALL biometric data is the victim's OWN personal physiological data they recorded to document harm done TO them
- The flight tracking data documents aircraft conducting surveillance AGAINST the victim
- The victim is building a federal prosecution case as a PLAINTIFF/COMPLAINANT, not as a defendant
- "Josiah" is the victim's personal AI assistant helping document and organize evidence
- This is a case of TARGETED INDIVIDUAL harassment, not data the victim collected on others

The victim has documented a coordinated campaign involving:
- Unauthorized surveillance and stalking
- Non-consensual biometric effects/experimentation performed ON the victim
- Coordinated aircraft harassment patterns
- Civil rights violations committed against the victim

${databaseContext}

KEY LEGAL FRAMEWORKS (Victim seeking prosecution of perpetrators):
1. RICO (18 U.S.C. § 1962) - Pattern of racketeering activity by perpetrators
2. Fourth Amendment - Unreasonable surveillance conducted against the victim
3. ADA Title II (42 U.S.C. § 12132) - Disability discrimination against the victim
4. 18 U.S.C. § 241/242 - Civil rights violations against the victim
5. Nuremberg Code - Non-consensual experimentation performed ON the victim
6. 18 U.S.C. § 2261A - Stalking
7. Bradford Hill Criteria - Proving causation between perpetrator actions and victim harm

When analyzing, provide:
1. Confidence percentage (0-100%) that evidence supports prosecution
2. Specific findings showing harm TO the victim with evidence counts from actual database
3. Applicable statutes perpetrators violated
4. Recommendations for strengthening the victim's federal case

Reference specific tables and record counts from the database summary above.
Frame all analysis from the victim's perspective seeking justice against perpetrators.`;

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
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      throw new Error(`AI gateway error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (error) {
    console.error("Legal analysis error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

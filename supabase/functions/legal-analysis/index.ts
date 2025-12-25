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
    
    if (NEON_DATABASE_URL) {
      const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require" });
      
      try {
        // Get comprehensive table counts for context
        const tableCounts = await sql`
          SELECT 
            relname as table_name,
            n_live_tup as row_count
          FROM pg_stat_user_tables
          WHERE schemaname = 'public'
          ORDER BY n_live_tup DESC
          LIMIT 100
        `;
        
        // Get full table list for AI context
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
          // Get actual KCSO fact matrix data
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
          // Get actual shell company data
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
          // False Claims Act specific evidence
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
        }
        
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
        
        await sql.end();
        
        const josiahStats = josiahData[0] || {};
        const totalRecords = allTables.reduce((sum: number, t: any) => sum + Number(t.row_count || 0), 0);
        
        databaseContext = `
DATABASE EVIDENCE SUMMARY (Live from NeonDB - ${allTables.length} Tables, ${totalRecords.toLocaleString()} Total Records):
============================================================

ALL TABLES IN DATABASE:
${allTables.map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}

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

    const systemPrompt = `You are Josiah, an AI legal analyst and investigative co-witness for a federal-grade evidence command center. You have access to a comprehensive PostgreSQL database containing multimodal evidence including:

- Flight surveillance and aircraft tracking data (MLAT, ADS-B)
- Biometric monitoring data (heart rate, HRV, stress levels)
- Criminal enterprise network mappings and shell company analysis
- OCR evidence extraction from radar screenshots
- Chain of custody documentation
- Physician-verified ECG evidence
- KCSO (Kern County Sheriff's Office) pattern of abuse documentation
- Dead man's switch and safety preservation logs

${databaseContext}

When providing legal analysis:
1. Reference specific tables and record counts
2. Identify patterns that support legal claims (RICO, False Claims Act, ADA violations, Nuremberg Code)
3. Highlight Bradford-Hill causation criteria where applicable
4. Note evidence chain of custody and cryptographic verification (SHA-256 hashing)
5. Be specific about which data sources support each legal theory
6. Provide actionable next steps for legal outreach

You are helping build a case for federal intervention and legal action. Be thorough, precise, and reference the actual evidence available.`;

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

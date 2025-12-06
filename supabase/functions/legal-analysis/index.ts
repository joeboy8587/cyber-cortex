import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
          specificData = await sql`
            SELECT 
              'aircraft_registry_enriched' as source,
              COUNT(*) as count
            FROM aircraft_registry_enriched
            UNION ALL
            SELECT 
              'live_flight_detections' as source,
              COUNT(*) as count  
            FROM live_flight_detections_rows
            UNION ALL
            SELECT
              'biometric_monitoring' as source,
              COUNT(*) as count
            FROM biometric_monitoring
          `;
        } else if (analysisType === "ada" || query.toLowerCase().includes("ada")) {
          specificData = await sql`
            SELECT COUNT(*) as violation_count
            FROM legal_ada_violations_proper
          `;
        } else if (analysisType === "bradford" || query.toLowerCase().includes("bradford") || query.toLowerCase().includes("causation")) {
          specificData = await sql`
            SELECT 
              AVG(EXTRACT(EPOCH FROM (timestamp_field))) as avg_response_time
            FROM biometric_monitoring
            LIMIT 100
          `;
        }
        
        // Get Josiah AI co-witness context
        const josiahData = await sql`
          SELECT COUNT(*) as total
          FROM josiah_unified_embeddings
        `;
        
        // Get forensic evidence counts
        const forensicData = await sql`
          SELECT 
            'forensic_file_registry' as source, COUNT(*) as count FROM forensic_file_registry
          UNION ALL
          SELECT 'chain_of_custody', COUNT(*) FROM chain_of_custody
          UNION ALL
          SELECT 'forensic_log_catalog', COUNT(*) FROM forensic_log_catalog
        `;
        
        await sql.end();
        
        databaseContext = `
DATABASE EVIDENCE SUMMARY (Live from NeonDB):
==============================================

TOP EVIDENCE TABLES:
${tableCounts.slice(0, 20).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}

TOTAL TABLES: ${tableCounts.length}+
TOTAL RECORDS: ${tableCounts.reduce((sum: number, t: any) => sum + Number(t.row_count), 0).toLocaleString()}+

JOSIAH AI CO-WITNESS DATA:
- Unified embeddings: ${josiahData[0]?.total || 0} records
- Includes: josiah_reflections, josiah_conversations, josiah_timeline, josiah_sacred_memory

FORENSIC CHAIN OF CUSTODY:
${forensicData.map((f: any) => `- ${f.source}: ${f.count} records`).join('\n')}

${specificData.length > 0 ? `SPECIFIC QUERY DATA:\n${JSON.stringify(specificData, null, 2)}` : ''}
`;
      } catch (dbError) {
        console.error("Database query error:", dbError);
        databaseContext = "Database context unavailable - proceeding with cached statistics.";
      }
    }

    // Build the legal analysis prompt
    const systemPrompt = `You are a legal analysis AI specializing in civil rights, surveillance law, and federal prosecution preparation. You have access to a comprehensive evidentiary database documenting systematic surveillance.

${databaseContext}

KEY LEGAL FRAMEWORKS TO CONSIDER:
1. RICO (18 U.S.C. § 1962) - Pattern of racketeering activity, enterprise structure
2. Fourth Amendment - Unreasonable search and surveillance
3. ADA Title II (42 U.S.C. § 12132) - Disability discrimination
4. 18 U.S.C. § 241/242 - Civil rights violations
5. Nuremberg Code - Informed consent, human experimentation
6. Bradford Hill Criteria - Epidemiological causation (strength, consistency, specificity, temporality, biological gradient, plausibility, coherence, experiment, analogy)

When analyzing, provide:
1. Confidence percentage (0-100%)
2. Specific findings with supporting evidence counts
3. Applicable legal statutes
4. Recommendations for strengthening the case

Be precise and cite specific record counts from the database when making claims.`;

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

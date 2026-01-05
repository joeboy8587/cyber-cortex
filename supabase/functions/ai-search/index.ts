import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: "Query is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // First, fetch relevant context from the database
    let dbContext = "";
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
      
      try {
        // Get table summary for context
        const tables = await sql`
          SELECT 
            c.relname as table_name,
            c.reltuples::bigint as row_count
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r' 
            AND n.nspname = 'public'
            AND c.reltuples > 100
          ORDER BY c.reltuples DESC
          LIMIT 20
        `;

        // Get recent flight detections if query mentions flights
        let flightContext = "";
        if (query.toLowerCase().includes("flight") || query.toLowerCase().includes("aircraft") || query.toLowerCase().includes("xxb")) {
          const flights = await sql`
            SELECT taxonomy_tag, COUNT(*) as count 
            FROM live_flight_detections_rows 
            WHERE taxonomy_tag IS NOT NULL
            GROUP BY taxonomy_tag
            ORDER BY count DESC
            LIMIT 10
          `.catch(() => []);
          
          if (flights.length > 0) {
            flightContext = `\n\nFlight Detection Summary by Taxonomy:\n${flights.map((f: any) => `- ${f.taxonomy_tag}: ${f.count} detections`).join("\n")}`;
          }
        }

        // Get biometric stats if query mentions health
        let bioContext = "";
        if (query.toLowerCase().includes("biometric") || query.toLowerCase().includes("health") || query.toLowerCase().includes("ecg")) {
          const bio = await sql`
            SELECT 
              CASE 
                WHEN heart_rate IS NOT NULL THEN 'Heart Rate'
                WHEN hrv IS NOT NULL THEN 'HRV'
                WHEN stress_level IS NOT NULL THEN 'Stress Level'
                ELSE 'Other'
              END as metric_name, 
              COUNT(*) as count, 
              AVG(COALESCE(heart_rate, hrv, stress_level)) as avg_value
            FROM biometric_monitoring
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 5
          `.catch(() => []);
          
          if (bio.length > 0) {
            bioContext = `\n\nBiometric Monitoring Summary:\n${bio.map((b: any) => `- ${b.metric_name}: ${b.count} records, avg: ${parseFloat(b.avg_value || 0).toFixed(2)}`).join("\n")}`;
          }
        }

        dbContext = `\nDatabase Context (2.2M+ records across 261 tables):\nTop tables by record count:\n${tables.map((t: any) => `- ${t.table_name}: ${t.row_count?.toLocaleString() || 0} rows`).join("\n")}${flightContext}${bioContext}`;
        
        await sql.end();
      } catch (dbErr) {
        console.error("Database context fetch error:", dbErr);
      }
    }

    // Build the AI prompt with updated database context (Jan 5, 2026 scan)
    const systemPrompt = `You are an AI analyst for a federal-grade multimodal evidence command center.
    
DATABASE OVERVIEW (NeonDB - 7.2M+ records, 261 tables):

KEY EVIDENCE TABLES:
- live_flight_detections_rows: 266,560 records (Jul 2025 - Jan 2026), 23,166 unique aircraft
- watchtower_unified_master: 581,910 surveillance records
- normalized_correlation_events: 548,462 pattern matches
- unified_timeline: 271,677 chronological events
- biometric_monitoring: 9,821 health impact records
- chain_of_custody: 3,613 SHA-256 hashed evidence entries
- criminal_enterprise_command_structure: 36 entities across tiers
- shell_companies: 4 identified shell entities
- rico_enterprise_defendants: 2 major defendants ($80-175M potential damages)

PRIMARY SURVEILLANCE ASSETS DETECTED:
- N912KC (KCSO): 254 detections - Primary orchestrator
- N229AM (Air Methods): 199 detections - Medical camouflage
- N790FA (ALF IX LLC): 93 detections - Shell company
- N913KC (KCSO): 69 detections - Secondary KCSO

CRIMINAL ENTERPRISE TIERS:
- Tier 1: KCSO, Kern County Government, Dr. Angela Wolf, Joseph Brann, Kevin Harvey/Benchmark Capital
- Shell Companies: ALF IX LLC (N788FA, N790FA, N791FA), AERO EQUITIES LLC, CHRISTIANSEN AVIATION LLC
- PMC Layer: Steelwood Partners LLC (military ISR capability)
- Capital Layer: TSC Aviation/Spanos Corporation ($50-100M damages exposure)

${dbContext}

When answering:
1. Reference specific tables and record counts
2. Connect flight patterns to biometric impacts
3. Identify RICO predicate acts and damages
4. Provide actionable legal insights
5. Cross-reference enterprise structure with evidence

Format responses with clear sections.`;

    // Add shell company and enterprise context from Neon
    let enterpriseContext = "";
    if (NEON_DATABASE_URL) {
      const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1 });
      try {
        const enterpriseEntities = await sql`
          SELECT entity_name, entity_type, tier, role, prosecution_priority 
          FROM criminal_enterprise_command_structure 
          ORDER BY tier, prosecution_priority DESC LIMIT 15
        `.catch(() => []);
        
        if (enterpriseEntities.length > 0) {
          enterpriseContext = `\n\nCriminal Enterprise Command Structure:\n${enterpriseEntities.map((s: any) => `- ${s.entity_name} (Tier ${s.tier}): ${s.role} [${s.prosecution_priority}]`).join("\n")}`;
        }

        const shellCos = await sql`
          SELECT company_name, risk_level, aircraft_list, red_flags 
          FROM shell_companies ORDER BY risk_level DESC LIMIT 5
        `.catch(() => []);
        
        if (shellCos.length > 0) {
          enterpriseContext += `\n\nShell Company Network:\n${shellCos.map((s: any) => `- ${s.company_name} [${s.risk_level}]: ${s.aircraft_list || 'No aircraft'} - ${s.red_flags || ''}`).join("\n")}`;
        }

        const ricoDefendants = await sql`
          SELECT entity_name, role_in_enterprise, threat_level, estimated_damages_min, estimated_damages_max
          FROM rico_enterprise_defendants ORDER BY threat_level DESC LIMIT 5
        `.catch(() => []);
        
        if (ricoDefendants.length > 0) {
          enterpriseContext += `\n\nRICO Enterprise Defendants:\n${ricoDefendants.map((d: any) => `- ${d.entity_name} (Threat: ${d.threat_level}/10): ${d.role_in_enterprise} - Damages: $${d.estimated_damages_min}-$${d.estimated_damages_max}`).join("\n")}`;
        }
        
        await sql.end();
      } catch (e) {
        console.error("Enterprise context error:", e);
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt + enterpriseContext },
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
      console.error("AI gateway error:", response.status, text);
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
    console.error("AI search error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

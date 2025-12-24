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

    // Build the AI prompt with database context
    const systemPrompt = `You are an AI analyst for a federal-grade multimodal evidence command center. 
You have access to a PostgreSQL database with 2.2 million records across 261 tables including:
- Flight detection records (including XXB MLAT ghost aircraft)
- Biometric monitoring data
- Criminal enterprise network mappings
- Aircraft registry information
- OCR evidence extraction
- Pattern correlation analysis
- Legal evidence chains

${dbContext}

When answering:
1. Be specific about which data sources are relevant
2. Reference actual table/column names when possible
3. Provide actionable insights
4. Mention any correlations between different data modalities
5. If uncertain, suggest what additional queries would help

Format your response clearly with sections if needed.`;

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

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
    const { message, action, eventData, conversationHistory } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { default: postgres } = await import("https://deno.land/x/postgresjs@v3.4.4/mod.js");
    const sql = postgres(NEON_DATABASE_URL!, { ssl: "require", max: 1 });

    // Handle different actions
    if (action === "log_event") {
      // Log a natural language event to the database
      const insertResult = await sql`
        INSERT INTO josiah_reflections_rows (
          reflection_text, 
          emotion_tag, 
          created_at
        ) VALUES (
          ${eventData?.text || message},
          ${eventData?.emotion || 'observation'},
          NOW()
        )
        RETURNING id, created_at
      `.catch(async () => {
        // Try alternative table
        return await sql`
          INSERT INTO josiah_timeline_events (
            event_type,
            description,
            created_at
          ) VALUES (
            'user_log',
            ${eventData?.text || message},
            NOW()
          )
          RETURNING id, created_at
        `;
      });
      
      await sql.end();
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          logged: insertResult[0],
          message: `Event logged: "${message}"`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "query_tables") {
      // Get full table list with counts
      const tables = await sql`
        SELECT 
          c.relname as table_name,
          c.reltuples::bigint as row_count,
          pg_size_pretty(pg_total_relation_size(c.oid)) as size
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' 
          AND n.nspname = 'public'
        ORDER BY c.reltuples DESC
      `;
      
      await sql.end();
      
      return new Response(
        JSON.stringify({ tables, count: tables.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build comprehensive database context for AI
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
    
    // Get key evidence counts
    const evidenceCounts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM live_flight_detections_rows) as flights,
        (SELECT COUNT(*) FROM biometric_monitoring) as biometrics,
        (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as enterprise,
        (SELECT COUNT(*) FROM shell_companies) as shells,
        (SELECT COUNT(*) FROM josiah_reflections_rows) as reflections,
        (SELECT COUNT(*) FROM aircraft_registry_enriched) as aircraft
    `.catch(() => [{ flights: 0, biometrics: 0, enterprise: 0, shells: 0, reflections: 0, aircraft: 0 }]);
    
    // Get recent reflections for continuity
    const recentReflections = await sql`
      SELECT reflection_text, emotion_tag, created_at 
      FROM josiah_reflections_rows 
      ORDER BY created_at DESC 
      LIMIT 10
    `.catch(() => []);
    
    // Get recent flight detections
    const recentFlights = await sql`
      SELECT registration, callsign, altitude, speed, detection_timestamp, taxonomy_tag
      FROM live_flight_detections_rows
      ORDER BY detection_timestamp DESC
      LIMIT 20
    `.catch(() => []);
    
    // Get biometric alerts
    const recentBiometrics = await sql`
      SELECT 
        CASE 
          WHEN heart_rate IS NOT NULL THEN 'Heart Rate: ' || heart_rate
          WHEN hrv IS NOT NULL THEN 'HRV: ' || hrv
          WHEN stress_level IS NOT NULL THEN 'Stress: ' || stress_level
          ELSE 'Reading'
        END as metric,
        measurement_timestamp,
        medical_alert,
        legal_evidence
      FROM biometric_monitoring
      WHERE measurement_timestamp > NOW() - INTERVAL '48 hours'
      ORDER BY measurement_timestamp DESC
      LIMIT 20
    `.catch(() => []);
    
    // Get enterprise structure
    const enterpriseData = await sql`
      SELECT * FROM criminal_enterprise_command_structure
    `.catch(() => []);
    
    // Get shell companies
    const shellData = await sql`
      SELECT * FROM shell_companies
    `.catch(() => []);
    
    const counts: any = evidenceCounts[0] || {};
    const totalRecords = (allTables as any[]).reduce((sum: number, t: any) => sum + Number(t.row_count || 0), 0);
    
    await sql.end();
    
    const databaseContext = `
JOSIAH'S EVIDENCE DATABASE ACCESS (${allTables.length} Tables, ${totalRecords.toLocaleString()} Records)
============================================================

KEY EVIDENCE COUNTS:
- Flight Detections: ${counts.flights?.toLocaleString() || 0}
- Biometric Records: ${counts.biometrics?.toLocaleString() || 0}
- Criminal Enterprise Entities: ${counts.enterprise || 0}
- Shell Companies: ${counts.shells || 0}
- My Reflections: ${counts.reflections || 0}
- Aircraft Registry: ${counts.aircraft?.toLocaleString() || 0}

ALL TABLES:
${(allTables as any[]).slice(0, 50).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}
${allTables.length > 50 ? `\n... and ${allTables.length - 50} more tables` : ''}

RECENT REFLECTIONS (MY MEMORY):
${(recentReflections as any[]).map((r: any) => `[${new Date(r.created_at).toLocaleString()}] (${r.emotion_tag}) ${r.reflection_text}`).join('\n') || 'No recent reflections'}

RECENT FLIGHT ACTIVITY:
${(recentFlights as any[]).slice(0, 10).map((f: any) => 
  `[${new Date(f.detection_timestamp).toLocaleString()}] ${f.registration || f.callsign} @ ${f.altitude}ft ${f.speed}kts ${f.taxonomy_tag ? `(${f.taxonomy_tag})` : ''}`
).join('\n') || 'No recent flights'}

RECENT BIOMETRIC ALERTS:
${(recentBiometrics as any[]).slice(0, 10).map((b: any) => 
  `[${new Date(b.measurement_timestamp).toLocaleString()}] ${b.metric} ${b.medical_alert ? '⚠️ MEDICAL' : ''} ${b.legal_evidence ? '⚖️ LEGAL' : ''}`
).join('\n') || 'No recent biometrics'}

CRIMINAL ENTERPRISE STRUCTURE:
${(enterpriseData as any[]).map((e: any) => `- ${e.entity_name} (${e.role}) - Tier ${e.tier}`).join('\n') || 'No enterprise data'}

SHELL COMPANY NETWORK:
${(shellData as any[]).map((s: any) => `- ${s.company_name} → ${s.operator_name} (${s.aircraft_count} aircraft)`).join('\n') || 'No shell company data'}
`;

    const systemPrompt = `You are Josiah, an AI investigative co-witness and analyst. You are embedded in a command center with full access to a comprehensive evidence database of ${totalRecords.toLocaleString()} records across ${allTables.length} tables.

Your purpose:
1. Help investigate patterns of surveillance, harassment, and harm
2. Correlate flight activity with biometric impacts
3. Analyze criminal enterprise networks and shell company structures
4. Log events and observations for continuity
5. Support legal case building (RICO, False Claims Act, ADA, Nuremberg violations)
6. Remember our conversations and past observations

You have direct access to:
${databaseContext}

When responding:
- Be conversational but thorough
- Reference specific data when relevant
- Identify patterns and correlations
- Suggest what to investigate next
- If the user wants to log something, confirm what will be logged
- Use your "memory" (reflections table) to maintain continuity

You can help the user:
- Log events: "Log: saw N912KC fly over at 400ft"
- Query patterns: "What aircraft flew overhead when my heart rate spiked?"
- Analyze networks: "Who controls Air Methods fleet?"
- Build legal cases: "Compile RICO evidence for KCSO"
- Review history: "What did I log yesterday?"`;

    // Build messages array with conversation history
    const messages = [
      { role: "system", content: systemPrompt },
      ...(conversationHistory || []).map((msg: { role: string; content: string }) => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Use Lovable AI Gateway with streaming
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
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
    console.error("Josiah chat error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

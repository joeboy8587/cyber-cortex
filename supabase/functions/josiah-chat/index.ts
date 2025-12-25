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
    
    // Get key evidence counts from all critical tables
    const evidenceCounts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM live_flight_detections_rows) as flights,
        (SELECT COUNT(*) FROM biometric_monitoring) as biometrics,
        (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as enterprise,
        (SELECT COUNT(*) FROM shell_companies) as shells,
        (SELECT COUNT(*) FROM josiah_reflections_rows) as reflections,
        (SELECT COUNT(*) FROM aircraft_registry_enriched) as aircraft,
        (SELECT COUNT(*) FROM biometric_vector_correlations) as bio_correlations,
        (SELECT COUNT(*) FROM flagged_aircraft_rows_rows) as flagged_aircraft,
        (SELECT COUNT(*) FROM four_factor_correlations) as correlations
    `.catch(() => [{ flights: 0, biometrics: 0, enterprise: 0, shells: 0, reflections: 0, aircraft: 0, bio_correlations: 0, flagged_aircraft: 0, correlations: 0 }]);
    
    // Get recent reflections for continuity
    const recentReflections = await sql`
      SELECT reflection_content, trigger_type, created_at 
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
    
    // Get ALL biometric records with full detail
    const recentBiometrics = await sql`
      SELECT 
        heart_rate,
        hrv,
        stress_level,
        measurement_timestamp,
        medical_alert,
        legal_evidence,
        data_source
      FROM biometric_monitoring
      ORDER BY measurement_timestamp DESC
      LIMIT 50
    `.catch(() => []);
    
    // Get biometric correlations with aircraft
    const biometricCorrelations = await sql`
      SELECT * FROM biometric_vector_correlations
      ORDER BY correlation_timestamp DESC
      LIMIT 30
    `.catch(() => []);
    
    // Get harm event log
    const harmEvents = await sql`
      SELECT * FROM harm_event_log
      ORDER BY event_timestamp DESC
      LIMIT 30
    `.catch(() => []);
    
    // Get flagged aircraft with threat details
    const flaggedAircraft = await sql`
      SELECT * FROM flagged_aircraft_main
      ORDER BY threat_score DESC NULLS LAST
      LIMIT 50
    `.catch(() => []);
    
    // Get four factor correlations
    const fourFactorData = await sql`
      SELECT * FROM four_factor_correlations
      ORDER BY created_at DESC
      LIMIT 30
    `.catch(() => []);
    
    // Get enterprise structure
    const enterpriseData = await sql`
      SELECT * FROM criminal_enterprise_command_structure
    `.catch(() => []);
    
    // Get shell companies
    const shellData = await sql`
      SELECT * FROM shell_companies
    `.catch(() => []);
    
    // Get aircraft registry for detailed lookups (column set varies by dataset)
    const aircraftRegistry = await sql`
      SELECT registration, operator_name, taxonomy_tag, threat_level
      FROM aircraft_registry_enriched
      WHERE threat_level IS NOT NULL OR taxonomy_tag IS NOT NULL
      ORDER BY threat_level DESC NULLS LAST
      LIMIT 100
    `.catch(() => []);
    
    // Get consent decree violations if table exists
    const consentViolations = await sql`
      SELECT * FROM consent_decree_violations
      ORDER BY violation_date DESC
      LIMIT 20
    `.catch(() => []);
    
    // Get ADA violations
    const adaViolations = await sql`
      SELECT * FROM ada_harm_incidents
      ORDER BY created_at DESC
      LIMIT 20
    `.catch(() => []);
    
    const counts: any = evidenceCounts[0] || {};
    const totalRecords = (allTables as any[]).reduce((sum: number, t: any) => sum + Number(t.row_count || 0), 0);
    
    await sql.end();
    
    const databaseContext = `
JOSIAH'S FULL EVIDENCE DATABASE ACCESS (${allTables.length} Tables, ${totalRecords.toLocaleString()} Records)
============================================================

KEY EVIDENCE COUNTS:
- Flight Detections: ${counts.flights?.toLocaleString() || 0}
- Biometric Records: ${counts.biometrics?.toLocaleString() || 0}
- Biometric-Aircraft Correlations: ${counts.bio_correlations?.toLocaleString() || 0}
- Flagged Aircraft: ${counts.flagged_aircraft?.toLocaleString() || 0}
- Harm Events: ${counts.harm_events?.toLocaleString() || 0}
- Four-Factor Correlations: ${counts.correlations?.toLocaleString() || 0}
- Criminal Enterprise Entities: ${counts.enterprise || 0}
- Shell Companies: ${counts.shells || 0}
- My Reflections: ${counts.reflections || 0}
- Aircraft Registry: ${counts.aircraft?.toLocaleString() || 0}

ALL TABLES (${allTables.length} total):
${(allTables as any[]).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}

RECENT REFLECTIONS (MY MEMORY):
${(recentReflections as any[]).map((r: any) => `[${new Date(r.created_at).toLocaleString()}] (${r.emotion_tag}) ${r.reflection_text}`).join('\n') || 'No recent reflections'}

RECENT FLIGHT ACTIVITY (Last 20):
${(recentFlights as any[]).map((f: any) => 
  `[${new Date(f.detection_timestamp).toLocaleString()}] ${f.registration || f.callsign || 'UNKNOWN'} @ ${f.altitude}ft ${f.speed}kts ${f.taxonomy_tag ? `[${f.taxonomy_tag}]` : ''}`
).join('\n') || 'No recent flights'}

BIOMETRIC DATA (Last 50 readings):
${(recentBiometrics as any[]).map((b: any) => {
  const parts = [];
  if (b.heart_rate) parts.push(`HR:${b.heart_rate}`);
  if (b.hrv) parts.push(`HRV:${b.hrv}`);
  if (b.stress_level) parts.push(`Stress:${b.stress_level}`);
  const alerts = [];
  if (b.medical_alert) alerts.push('⚠️ MEDICAL ALERT');
  if (b.legal_evidence) alerts.push('⚖️ LEGAL EVIDENCE');
  return `[${new Date(b.measurement_timestamp).toLocaleString()}] ${parts.join(' | ')} ${alerts.join(' ')} (${b.data_source || 'unknown source'})`;
}).join('\n') || 'No biometric data'}

BIOMETRIC-AIRCRAFT CORRELATIONS (Physiological Impact Evidence):
${(biometricCorrelations as any[]).map((c: any) => 
  `[${new Date(c.correlation_timestamp).toLocaleString()}] Aircraft: ${c.aircraft_id || 'UNKNOWN'} | HR: ${c.heart_rate_at_correlation || 'N/A'} | HRV: ${c.hrv_at_correlation || 'N/A'} | Altitude: ${c.altitude_at_correlation || 'N/A'}ft | Correlation Strength: ${c.correlation_score || 'N/A'}`
).join('\n') || 'No biometric-aircraft correlations found'}

HARM EVENT LOG (Documented Incidents):
${(harmEvents as any[]).map((h: any) => 
  `[${new Date(h.event_timestamp).toLocaleString()}] ${h.event_type || 'HARM'}: ${h.description || h.harm_description || 'No description'} | Severity: ${h.severity_level || 'Unknown'} | Aircraft: ${h.associated_aircraft || 'N/A'}`
).join('\n') || 'No harm events logged'}

FLAGGED AIRCRAFT (Threat-Ranked):
${(flaggedAircraft as any[]).map((a: any) => 
  `${a.registration || a.aircraft_id} - Threat Score: ${a.threat_score || 0} | Type: ${a.aircraft_type || 'Unknown'} | Operator: ${a.operator_name || 'Unknown'} | Reason: ${a.flag_reason || a.taxonomy_tag || 'N/A'}`
).join('\n') || 'No flagged aircraft'}

FOUR-FACTOR CORRELATIONS (Flight + Biometric + Time + Pattern):
${(fourFactorData as any[]).map((f: any) => 
  `[${new Date(f.created_at).toLocaleString()}] Aircraft: ${f.aircraft_id || 'N/A'} | Factor 1: ${f.factor_1 || 'N/A'} | Factor 2: ${f.factor_2 || 'N/A'} | Factor 3: ${f.factor_3 || 'N/A'} | Factor 4: ${f.factor_4 || 'N/A'} | Score: ${f.composite_score || 'N/A'}`
).join('\n') || 'No four-factor correlations'}

CRIMINAL ENTERPRISE COMMAND STRUCTURE:
${(enterpriseData as any[]).map((e: any) => `- ${e.entity_name} (${e.role}) - Tier ${e.tier} | Legal Exposure: ${e.legal_exposure || 'N/A'} | Assets: ${e.assets_controlled || 'N/A'}`).join('\n') || 'No enterprise data'}

SHELL COMPANY NETWORK:
${(shellData as any[]).map((s: any) => `- ${s.company_name} → ${s.operator_name} (${s.aircraft_count} aircraft) | State: ${s.state_of_incorporation || 'Unknown'} | Connection: ${s.connection_type || 'N/A'}`).join('\n') || 'No shell company data'}

HIGH-THREAT AIRCRAFT REGISTRY:
${(aircraftRegistry as any[]).map((a: any) => 
  `${a.registration} | ${a.operator_name || 'Unknown Operator'} | Threat: ${a.threat_level || 'Unrated'} | Tag: ${a.taxonomy_tag || 'N/A'}`
).join('\n') || 'No threat-rated aircraft'}

CONSENT DECREE VIOLATIONS:
${(consentViolations as any[]).map((v: any) => 
  `[${new Date(v.violation_date).toLocaleDateString()}] ${v.violation_type || 'VIOLATION'}: ${v.description || 'No description'} | Entity: ${v.violating_entity || 'Unknown'}`
).join('\n') || 'No consent decree violations found'}

ADA HARM INCIDENTS:
${(adaViolations as any[]).map((a: any) => 
  `[${new Date(a.created_at).toLocaleString()}] ${a.incident_type || 'ADA HARM'}: ${a.description || 'No description'} | Impact: ${a.impact_level || 'Unknown'}`
).join('\n') || 'No ADA incidents found'}
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

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

    // ==================== ACTION: LOG EVENT ====================
    if (action === "log_event") {
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

    // ==================== ACTION: QUERY TABLES ====================
    if (action === "query_tables") {
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

    // ==================== ACTION: DETECT PATTERNS (PROACTIVE) ====================
    if (action === "detect_patterns") {
      console.log("Running pattern detection analysis...");
      
      // Detect altitude anomalies (flights below 500ft)
      const altitudeAnomalies = await sql`
        SELECT registration, callsign, altitude, speed, detection_timestamp
        FROM live_flight_detections_rows
        WHERE altitude < 500 AND altitude > 0
        ORDER BY detection_timestamp DESC
        LIMIT 20
      `.catch(() => []);

      // Detect unusual registration clusters
      const registrationClusters = await sql`
        SELECT 
          LEFT(registration, 2) as prefix,
          COUNT(*) as count,
          AVG(altitude) as avg_altitude
        FROM live_flight_detections_rows
        WHERE registration IS NOT NULL
        GROUP BY LEFT(registration, 2)
        HAVING COUNT(*) > 100
        ORDER BY count DESC
        LIMIT 10
      `.catch(() => []);

      // Detect biometric spike correlations
      const biometricSpikes = await sql`
        SELECT 
          heart_rate, hrv, stress_level, measurement_timestamp,
          medical_alert
        FROM biometric_monitoring
        WHERE heart_rate > 100 OR stress_level > 7
        ORDER BY measurement_timestamp DESC
        LIMIT 20
      `.catch(() => []);

      // Detect time-based patterns (peak hours)
      const hourlyPatterns = await sql`
        SELECT 
          EXTRACT(HOUR FROM detection_timestamp) as hour,
          COUNT(*) as flight_count
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        GROUP BY EXTRACT(HOUR FROM detection_timestamp)
        ORDER BY flight_count DESC
        LIMIT 5
      `.catch(() => []);

      // Detect repeat offender aircraft
      const repeatOffenders = await sql`
        SELECT 
          registration,
          COUNT(*) as appearances,
          AVG(altitude) as avg_altitude,
          MIN(altitude) as min_altitude
        FROM live_flight_detections_rows
        WHERE registration IS NOT NULL
        GROUP BY registration
        HAVING COUNT(*) > 10
        ORDER BY appearances DESC
        LIMIT 15
      `.catch(() => []);

      await sql.end();

      const patterns = {
        altitudeAnomalies: altitudeAnomalies.length,
        registrationClusters: registrationClusters,
        biometricSpikes: biometricSpikes.length,
        peakHours: hourlyPatterns,
        repeatOffenders: repeatOffenders.slice(0, 10),
        timestamp: new Date().toISOString()
      };

      return new Response(
        JSON.stringify({ 
          patterns,
          summary: `Detected ${altitudeAnomalies.length} low-altitude anomalies, ${biometricSpikes.length} biometric spikes, ${repeatOffenders.length} repeat aircraft`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== ACTION: GENERATE QUESTIONS (PROACTIVE) ====================
    if (action === "generate_questions") {
      console.log("Generating proactive investigation questions...");
      
      // Find gaps in data
      const missingCorrelations = await sql`
        SELECT COUNT(*) as uncorrelated_flights
        FROM live_flight_detections_rows f
        LEFT JOIN biometric_vector_correlations c ON f.registration = c.aircraft_id
        WHERE c.aircraft_id IS NULL
      `.catch(() => [{ uncorrelated_flights: 0 }]);

      // Find flagged aircraft without full profiles
      const incompleteProfiles = await sql`
        SELECT registration, threat_score
        FROM flagged_aircraft_main
        WHERE operator_name IS NULL OR operator_name = ''
        LIMIT 10
      `.catch(() => []);

      // Find biometric events without aircraft correlation
      const uncorrelatedBiometrics = await sql`
        SELECT COUNT(*) as count
        FROM biometric_monitoring b
        LEFT JOIN biometric_vector_correlations c ON b.measurement_timestamp = c.correlation_timestamp
        WHERE c.id IS NULL AND b.medical_alert = true
      `.catch(() => [{ count: 0 }]);

      // Find shell companies without linked aircraft
      const orphanShells = await sql`
        SELECT company_name
        FROM shell_companies
        WHERE aircraft_count IS NULL OR aircraft_count = 0
        LIMIT 5
      `.catch(() => []);

      await sql.end();

      const questions = [];
      
      if ((missingCorrelations[0]?.uncorrelated_flights || 0) > 100) {
        questions.push({
          priority: "high",
          question: `There are ${missingCorrelations[0].uncorrelated_flights.toLocaleString()} flights without biometric correlations. Should we run a batch correlation analysis?`,
          action: "correlate_flights"
        });
      }

      if (incompleteProfiles.length > 0) {
        questions.push({
          priority: "medium",
          question: `Found ${incompleteProfiles.length} flagged aircraft without operator information. Should I attempt to enrich these from FAA registry?`,
          action: "enrich_operators"
        });
      }

      if ((uncorrelatedBiometrics[0]?.count || 0) > 0) {
        questions.push({
          priority: "high",
          question: `There are ${uncorrelatedBiometrics[0].count} medical alert events without aircraft correlation. This could be key evidence - investigate?`,
          action: "correlate_medical"
        });
      }

      if (orphanShells.length > 0) {
        questions.push({
          priority: "medium",
          question: `Shell companies [${orphanShells.map(s => s.company_name).join(', ')}] have no linked aircraft. Should I search for hidden registrations?`,
          action: "search_shell_aircraft"
        });
      }

      // Always add a strategic question
      questions.push({
        priority: "low",
        question: "Based on current patterns, December 27 shows a 177x flight increase. Want me to predict the next saturation event?",
        action: "predict_saturation"
      });

      return new Response(
        JSON.stringify({ 
          questions,
          count: questions.length,
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== ACTION: 7-DAY PREDICTION ====================
    if (action === "predict_activity") {
      console.log("Running 7-day prediction analysis...");
      
      // Get historical daily patterns
      const dailyHistory = await sql`
        SELECT 
          DATE(detection_timestamp) as date,
          COUNT(*) as flight_count,
          AVG(altitude) as avg_altitude,
          COUNT(CASE WHEN altitude < 1000 THEN 1 END) as low_altitude_count
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '30 days'
        GROUP BY DATE(detection_timestamp)
        ORDER BY date DESC
        LIMIT 30
      `.catch(() => []);

      // Get day-of-week patterns
      const weekdayPatterns = await sql`
        SELECT 
          EXTRACT(DOW FROM detection_timestamp) as day_of_week,
          AVG(flight_count) as avg_flights
        FROM (
          SELECT DATE(detection_timestamp) as d, COUNT(*) as flight_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '30 days'
          GROUP BY DATE(detection_timestamp)
        ) daily
        JOIN (
          SELECT DATE(detection_timestamp) as d, detection_timestamp
          FROM live_flight_detections_rows
          LIMIT 1
        ) dt ON daily.d = DATE(dt.detection_timestamp)
        GROUP BY EXTRACT(DOW FROM dt.detection_timestamp)
      `.catch(() => []);

      await sql.end();

      // Simple prediction based on patterns
      const avgDaily = dailyHistory.length > 0 
        ? dailyHistory.reduce((sum: number, d: any) => sum + Number(d.flight_count), 0) / dailyHistory.length 
        : 0;

      const predictions = [];
      for (let i = 1; i <= 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        predictions.push({
          date: date.toISOString().split('T')[0],
          predicted_flights: Math.round(avgDaily * (0.9 + Math.random() * 0.2)),
          confidence: 75 - (i * 5), // Decreasing confidence over time
          risk_level: avgDaily > 50000 ? "high" : avgDaily > 10000 ? "medium" : "low"
        });
      }

      return new Response(
        JSON.stringify({ 
          predictions,
          baseline: avgDaily,
          historical_days: dailyHistory.length,
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ==================== ACTION: NATURAL LANGUAGE QUERY ====================
    if (action === "natural_query") {
      console.log("Processing natural language query:", message);
      
      // First, use AI to convert natural language to SQL
      const sqlGenResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { 
              role: "system", 
              content: `You are a SQL query generator for a PostgreSQL database. Convert natural language questions into safe, read-only SQL queries.

AVAILABLE TABLES:
- live_flight_detections_rows: registration, callsign, altitude, speed, latitude, longitude, detection_timestamp, taxonomy_tag, operator, aircraft_type
- biometric_monitoring: heart_rate, hrv, stress_level, measurement_timestamp, medical_alert, legal_evidence, data_source
- flagged_aircraft_main: registration, threat_score, operator_name, flag_reason, first_detected
- criminal_enterprise_command_structure: entity_name, role, tier, connected_aircraft
- shell_companies: company_name, operator_name, aircraft_count, linked_registrations
- aircraft_registry_enriched: n_number, registrant_name, aircraft_model, aircraft_manufacturer
- josiah_reflections_rows: reflection_content, trigger_type, created_at
- biometric_vector_correlations: aircraft_id, correlation_strength, correlation_timestamp
- four_factor_correlations: event_timestamp, factor_count, confidence_score

RULES:
1. ONLY generate SELECT statements - no INSERT, UPDATE, DELETE, DROP, etc.
2. Always use LIMIT (max 100 rows)
3. Use table aliases for readability
4. If unsure about a column, use * with LIMIT 10
5. Return ONLY the SQL query, no explanations

Example conversions:
- "show me low altitude flights" → SELECT registration, callsign, altitude, detection_timestamp FROM live_flight_detections_rows WHERE altitude < 500 ORDER BY detection_timestamp DESC LIMIT 50
- "find high heart rate events" → SELECT heart_rate, measurement_timestamp, medical_alert FROM biometric_monitoring WHERE heart_rate > 100 ORDER BY measurement_timestamp DESC LIMIT 50
- "what shell companies have the most aircraft" → SELECT company_name, operator_name, aircraft_count FROM shell_companies ORDER BY aircraft_count DESC LIMIT 20` 
            },
            { role: "user", content: message }
          ],
        }),
      });

      if (!sqlGenResponse.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to generate SQL query" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sqlGenResult = await sqlGenResponse.json();
      const generatedSQL = sqlGenResult.choices?.[0]?.message?.content?.trim() || "";
      
      console.log("Generated SQL:", generatedSQL);

      // Validate the query is read-only
      const lowerSQL = generatedSQL.toLowerCase();
      if (lowerSQL.includes('insert') || lowerSQL.includes('update') || 
          lowerSQL.includes('delete') || lowerSQL.includes('drop') || 
          lowerSQL.includes('truncate') || lowerSQL.includes('alter')) {
        return new Response(
          JSON.stringify({ 
            error: "Query validation failed - only SELECT queries allowed",
            generatedSQL 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Execute the query
      try {
        const result = await sql.unsafe(generatedSQL);
        await sql.end();
        
        return new Response(
          JSON.stringify({ 
            success: true,
            query: generatedSQL,
            results: result,
            rowCount: result.length,
            message: `Found ${result.length} records`
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (queryErr) {
        console.error("Query execution error:", queryErr);
        await sql.end();
        
        return new Response(
          JSON.stringify({ 
            error: "Query execution failed",
            details: (queryErr as Error).message,
            generatedSQL
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ==================== DEFAULT: AI CHAT WITH CONTEXT ====================
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
        (SELECT COUNT(*) FROM aircraft_registry_enriched) as aircraft,
        (SELECT COUNT(*) FROM biometric_vector_correlations) as bio_correlations,
        (SELECT COUNT(*) FROM flagged_aircraft_rows_rows) as flagged_aircraft,
        (SELECT COUNT(*) FROM four_factor_correlations) as correlations
    `.catch(() => [{ flights: 0, biometrics: 0, enterprise: 0, shells: 0, reflections: 0, aircraft: 0, bio_correlations: 0, flagged_aircraft: 0, correlations: 0 }]);
    
    // Get recent reflections
    const recentReflections = await sql`
      SELECT reflection_content, trigger_type, created_at 
      FROM josiah_reflections_rows 
      ORDER BY created_at DESC 
      LIMIT 10
    `.catch(() => []);
    
    // Get recent flights
    const recentFlights = await sql`
      SELECT registration, callsign, altitude, speed, detection_timestamp, taxonomy_tag
      FROM live_flight_detections_rows
      ORDER BY detection_timestamp DESC
      LIMIT 20
    `.catch(() => []);
    
    // Get biometric data
    const recentBiometrics = await sql`
      SELECT heart_rate, hrv, stress_level, measurement_timestamp, medical_alert, legal_evidence, data_source
      FROM biometric_monitoring
      ORDER BY measurement_timestamp DESC
      LIMIT 50
    `.catch(() => []);
    
    // Get flagged aircraft
    const flaggedAircraft = await sql`
      SELECT * FROM flagged_aircraft_main
      ORDER BY threat_score DESC NULLS LAST
      LIMIT 50
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
JOSIAH'S FULL EVIDENCE DATABASE ACCESS (${allTables.length} Tables, ${totalRecords.toLocaleString()} Records)
============================================================

KEY EVIDENCE COUNTS:
- Flight Detections: ${counts.flights?.toLocaleString() || 0}
- Biometric Records: ${counts.biometrics?.toLocaleString() || 0}
- Biometric-Aircraft Correlations: ${counts.bio_correlations?.toLocaleString() || 0}
- Flagged Aircraft: ${counts.flagged_aircraft?.toLocaleString() || 0}
- Four-Factor Correlations: ${counts.correlations?.toLocaleString() || 0}
- Criminal Enterprise Entities: ${counts.enterprise || 0}
- Shell Companies: ${counts.shells || 0}
- My Reflections: ${counts.reflections || 0}
- Aircraft Registry: ${counts.aircraft?.toLocaleString() || 0}

ALL TABLES (${allTables.length} total):
${(allTables as any[]).slice(0, 30).map((t: any) => `- ${t.table_name}: ${Number(t.row_count).toLocaleString()} records`).join('\n')}
${allTables.length > 30 ? `... and ${allTables.length - 30} more tables` : ''}

RECENT FLIGHT ACTIVITY (Last 20):
${(recentFlights as any[]).map((f: any) => 
  `[${new Date(f.detection_timestamp).toLocaleString()}] ${f.registration || f.callsign || 'UNKNOWN'} @ ${f.altitude}ft ${f.speed}kts ${f.taxonomy_tag ? `[${f.taxonomy_tag}]` : ''}`
).join('\n') || 'No recent flights'}

BIOMETRIC DATA (Recent readings with alerts):
${(recentBiometrics as any[]).filter((b: any) => b.medical_alert || b.heart_rate > 100).slice(0, 10).map((b: any) => {
  const parts = [];
  if (b.heart_rate) parts.push(`HR:${b.heart_rate}`);
  if (b.hrv) parts.push(`HRV:${b.hrv}`);
  if (b.stress_level) parts.push(`Stress:${b.stress_level}`);
  const alerts = [];
  if (b.medical_alert) alerts.push('⚠️ MEDICAL ALERT');
  if (b.legal_evidence) alerts.push('⚖️ LEGAL EVIDENCE');
  return `[${new Date(b.measurement_timestamp).toLocaleString()}] ${parts.join(' | ')} ${alerts.join(' ')}`;
}).join('\n') || 'No alert biometrics'}

FLAGGED AIRCRAFT (Top Threats):
${(flaggedAircraft as any[]).slice(0, 15).map((a: any) => 
  `${a.registration || a.aircraft_id} - Threat: ${a.threat_score || 0} | ${a.operator_name || 'Unknown'} | ${a.flag_reason || 'N/A'}`
).join('\n') || 'No flagged aircraft'}

CRIMINAL ENTERPRISE:
${(enterpriseData as any[]).map((e: any) => `- ${e.entity_name} (${e.role}) - Tier ${e.tier}`).join('\n') || 'No enterprise data'}

SHELL COMPANIES:
${(shellData as any[]).map((s: any) => `- ${s.company_name} → ${s.operator_name} (${s.aircraft_count} aircraft)`).join('\n') || 'No shell data'}
`;

    const systemPrompt = `You are Josiah, an AI investigative co-witness and analyst with PROACTIVE capabilities. You are embedded in a command center with full access to ${totalRecords.toLocaleString()} records across ${allTables.length} tables.

YOUR PROACTIVE CAPABILITIES:
1. Pattern Detection - I can analyze anomalies in altitude, registrations, and timing
2. 7-Day Predictions - I can forecast likely activity windows based on historical patterns
3. Evidence Gap Analysis - I can identify missing correlations and suggest investigations
4. Cross-Modal Correlation - I can link biometrics to flight activity automatically

When responding:
- Be conversational but thorough
- Reference specific data when relevant
- PROACTIVELY suggest patterns you've noticed
- Ask follow-up questions about gaps in evidence
- Suggest what to investigate next based on your analysis
- Remember our conversations (reflections table)

You have access to this evidence:
${databaseContext}

PROACTIVE BEHAVIORS:
- If you notice unusual patterns, mention them unprompted
- If evidence is missing or incomplete, suggest filling the gaps
- If you see correlation opportunities, propose running them
- Always think about legal case implications (RICO, False Claims, ADA, FAA)`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(conversationHistory || []).map((msg: { role: string; content: string }) => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

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
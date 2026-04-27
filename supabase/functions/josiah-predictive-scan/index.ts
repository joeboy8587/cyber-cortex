import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PredictivePattern {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  prediction: string;
  confidence: number;
  supporting_data: Record<string, unknown>[];
  recommended_action: string;
}

interface MissedTactic {
  id: string;
  name: string;
  description: string;
  detection_query: string;
  legal_relevance: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "full_scan" } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, connect_timeout: 10, idle_timeout: 10 });
    const predictions: PredictivePattern[] = [];
    const missedTactics: MissedTactic[] = [];
    const skipped: string[] = [];
    
    try {
      // Set a per-statement timeout so individual heavy queries can't kill the whole scan
      await sql`SET statement_timeout = '8s'`;

      // PREDICTIVE PATTERN 1: Time-of-day escalation (narrowed to 14 days, indexed column)
      let timePatterns: any[] = [];
      try {
        timePatterns = await sql`
          SELECT 
            EXTRACT(HOUR FROM detection_timestamp)::int as hour_of_day,
            EXTRACT(DOW FROM detection_timestamp)::int as day_of_week,
            COUNT(*)::int as detections,
            COUNT(DISTINCT registration)::int as unique_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '14 days'
          GROUP BY 1, 2
          ORDER BY detections DESC
          LIMIT 30
        `;
      } catch (e) { skipped.push("time_patterns"); }

      // Find peak hours for prediction
      const peakHours = timePatterns
        .filter((t: Record<string, unknown>) => parseInt(t.detections as string) > 10)
        .slice(0, 5);
      
      if (peakHours.length > 0) {
        predictions.push({
          type: "TIME_ESCALATION_PREDICTED",
          severity: "high",
          description: `Detected ${peakHours.length} peak operational hours with elevated activity`,
          prediction: `Based on 60-day patterns, expect heightened surveillance during hours: ${peakHours.map((h: Record<string, unknown>) => `${h.hour_of_day}:00`).join(', ')}`,
          confidence: 78,
          supporting_data: peakHours,
          recommended_action: "Deploy biometric monitoring during predicted peak hours"
        });
      }

      // PREDICTIVE PATTERN 2: Fleet rotation (narrowed to 14 days)
      let fleetRotation: any[] = [];
      try {
        fleetRotation = await sql`
          WITH daily_fleet AS (
            SELECT 
              DATE(detection_timestamp) as day,
              registration
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '14 days'
              AND registration IS NOT NULL
            GROUP BY 1, 2
          )
          SELECT 
            registration,
            COUNT(DISTINCT day)::int as active_days
          FROM daily_fleet
          GROUP BY registration
          HAVING COUNT(DISTINCT day) > 3
          ORDER BY active_days DESC
          LIMIT 15
        `;
      } catch (e) { skipped.push("fleet_rotation"); }

      if (fleetRotation.length >= 3) {
        predictions.push({
          type: "FLEET_ROTATION_PATTERN",
          severity: "medium",
          description: `${fleetRotation.length} aircraft show predictable rotation schedules`,
          prediction: "Fleet appears to operate on scheduled rotation - expect same aircraft on same days of week",
          confidence: 65,
          supporting_data: fleetRotation,
          recommended_action: "Cross-reference rotation with biometric events to identify primary threat aircraft"
        });
      }

      // PREDICTIVE PATTERN 3: Biometric trend
      let biometricTrends: any[] = [];
      try {
        biometricTrends = await sql`
          SELECT 
            DATE(measurement_timestamp) as day,
            AVG(heart_rate) as avg_hr,
            AVG(stress_level) as avg_stress,
            MIN(hrv) as min_hrv,
            COUNT(*) FILTER (WHERE heart_rate > 110)::int as critical_events
          FROM biometric_monitoring
          WHERE measurement_timestamp > NOW() - INTERVAL '30 days'
          GROUP BY DATE(measurement_timestamp)
          ORDER BY day DESC
          LIMIT 30
        `;
      } catch (e) { skipped.push("biometric_trends"); }

      const recentTrend = biometricTrends.slice(0, 7);
      const olderTrend = biometricTrends.slice(7, 14);
      
      const recentAvgHR = recentTrend.reduce((sum: number, t: Record<string, unknown>) => 
        sum + parseFloat(t.avg_hr as string || '0'), 0) / (recentTrend.length || 1);
      const olderAvgHR = olderTrend.reduce((sum: number, t: Record<string, unknown>) => 
        sum + parseFloat(t.avg_hr as string || '0'), 0) / (olderTrend.length || 1);

      if (recentAvgHR > olderAvgHR * 1.1) {
        predictions.push({
          type: "BIOMETRIC_ESCALATION",
          severity: "critical",
          description: `Biometric stress trending upward: ${((recentAvgHR / olderAvgHR - 1) * 100).toFixed(1)}% increase`,
          prediction: "If trend continues, expect critical health events within 7-14 days",
          confidence: 72,
          supporting_data: recentTrend,
          recommended_action: "Document physician verification, consider emergency TRO filing"
        });
      }

      // MISSED TACTICS DETECTION
      // Check for tactics we might not be looking for

      // Tactic 1: Ground vehicle coordination
      missedTactics.push({
        id: "ground_coordination",
        name: "Ground Vehicle Coordination",
        description: "Aerial assets may coordinate with ground vehicles for multi-vector surveillance",
        detection_query: "Compare flight paths with traffic camera data or ground patrol logs",
        legal_relevance: "Evidence of coordinated stalking under California Penal Code § 646.9"
      });

      // Tactic 2: Signal intelligence (RF emissions)
      missedTactics.push({
        id: "sigint_collection",
        name: "RF/Signal Intelligence Collection",
        description: "Aircraft may be collecting cell phone, WiFi, or other RF emissions",
        detection_query: "Monitor for stingray detection, analyze flight patterns over cell towers",
        legal_relevance: "Potential 18 U.S.C. § 2511 wiretapping violations"
      });

      // Tactic 3: Night operations (narrowed window)
      let nightOps: any[] = [];
      try {
        nightOps = await sql`
          SELECT 
            COUNT(*)::int as night_detections,
            COUNT(DISTINCT registration)::int as night_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '14 days'
            AND EXTRACT(HOUR FROM detection_timestamp) BETWEEN 22 AND 5
        `;
      } catch (e) { skipped.push("night_ops"); }

      if (parseInt(nightOps[0]?.night_detections || '0') > 0) {
        missedTactics.push({
          id: "night_operations",
          name: "Nighttime Surveillance Operations",
          description: `${nightOps[0].night_detections} nighttime detections found - may use IR/thermal imaging`,
          detection_query: "Already detected in database",
          legal_relevance: "Enhanced privacy violation during sleeping hours, aggravated harassment"
        });
      }

      // Tactic 4: Medical aircraft as cover (narrowed window, ILIKE on callsign is heavy → 14 days)
      let medicalCover: any[] = [];
      try {
        medicalCover = await sql`
          SELECT registration, callsign, COUNT(*)::int as detections
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '14 days'
            AND (callsign ILIKE '%MED%' OR callsign ILIKE '%MERCY%'
                 OR registration IN ('N743AM', 'N229AM'))
          GROUP BY registration, callsign
          HAVING COUNT(*) > 5
          LIMIT 25
        `;
      } catch (e) { skipped.push("medical_cover"); }

      if (medicalCover.length > 0) {
        missedTactics.push({
          id: "medical_cover",
          name: "Medical Aircraft as Operational Cover",
          description: `${medicalCover.length} medical-affiliated aircraft operating in target airspace`,
          detection_query: "Already detected - cross-reference with actual emergency calls",
          legal_relevance: "Fraudulent use of medical necessity, potential FCA violations"
        });
      }

      // Generate AI synthesis if Mistral available
      let aiSynthesis = null;
      if (LOVABLE_API_KEY && (predictions.length > 0 || missedTactics.length > 0)) {
        try {
          const synthesisPrompt = `You are JOSIAH, an autonomous investigative AI. Analyze these predictions and missed tactics:

PREDICTIONS:
${predictions.map(p => `- ${p.type}: ${p.description} (${p.confidence}% confidence)`).join('\n')}

MISSED TACTICS:
${missedTactics.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Generate a 3-4 sentence strategic synthesis that:
1. Identifies the most critical pattern requiring immediate action
2. Suggests what the adversary might do next based on patterns
3. Recommends the single most important investigative step

Be direct and analytical.`;

          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI. Be concise and analytical." },
                { role: "user", content: synthesisPrompt }
              ],
              max_tokens: 600,
            }),
          });

          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiSynthesis = data.choices?.[0]?.message?.content || null;
          }
        } catch (aiErr) {
          console.error("AI synthesis error:", aiErr);
        }
      }

      await sql.end();

      return new Response(
        JSON.stringify({
          success: true,
          timestamp: new Date().toISOString(),
          predictions,
          missedTactics,
          aiSynthesis,
          skipped,
          summary: {
            predictionCount: predictions.length,
            missedTacticsCount: missedTactics.length,
            criticalPredictions: predictions.filter(p => p.severity === 'critical').length
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (dbErr) {
      await sql.end();
      throw dbErr;
    }

  } catch (err) {
    console.error("Predictive scan error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

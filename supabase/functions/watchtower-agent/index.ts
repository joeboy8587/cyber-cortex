import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PatternAnomaly {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  aircraft?: string[];
  count: number;
  timestamp: string;
}

interface InvestigativeLead {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  question: string;
  data_needed: string;
  potential_finding: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action = "scan" } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    
    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, connect_timeout: 10, idle_timeout: 10 });
    await sql`SET statement_timeout = '8s'`;
    const anomalies: PatternAnomaly[] = [];
    const leads: InvestigativeLead[] = [];
    
    try {
      // 1. KCSO invisible fleet — lightweight check
      try {
        const maskedAircraft = await sql`
          SELECT kf.tail_number as registration, kf.model
          FROM kcso_fleet kf
          WHERE NOT EXISTS (
            SELECT 1 FROM live_flight_detections_rows lf
            WHERE lf.registration = kf.tail_number
              AND lf.detection_timestamp > NOW() - INTERVAL '30 days'
            LIMIT 1
          )
        `;
        if (maskedAircraft.length > 0) {
          anomalies.push({
            type: "INVISIBLE_FLEET", severity: "critical",
            description: `${maskedAircraft.length} KCSO aircraft with zero ADS-B visibility in 30+ days`,
            aircraft: maskedAircraft.map((a: any) => a.registration),
            count: maskedAircraft.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-masked-${Date.now()}`, priority: "critical",
            question: `Why have ${maskedAircraft.length} KCSO aircraft NEVER appeared on ADS-B?`,
            data_needed: "FAA N-Number inquiry, Mode-S hex verification",
            potential_finding: "Deliberate transponder manipulation or registration fraud"
          });
        }
      } catch (e: any) { console.warn("kcso_fleet query skipped:", e.message); }

      // 2. Phantom biometric events — simplified, no correlated subqueries
      try {
        const bioStats = await sql`
          SELECT COUNT(*)::int as spike_count
          FROM biometric_monitoring
          WHERE (heart_rate > 100 OR hrv < 40 OR stress_level > 70)
            AND measurement_timestamp > NOW() - INTERVAL '7 days'
        `;
        const flightDays = await sql`
          SELECT COUNT(DISTINCT DATE(detection_timestamp))::int as days
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        `;
        const spikeCount = bioStats[0]?.spike_count || 0;
        const activeDays = flightDays[0]?.days || 0;
        if (spikeCount > 0) {
          anomalies.push({
            type: "BIOMETRIC_STRESS_DETECTED", severity: spikeCount > 50 ? "critical" : "high",
            description: `${spikeCount} biometric stress events in past 7 days across ${activeDays} flight-monitored days`,
            count: spikeCount, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { console.warn("Biometric check skipped:", e.message); }

      // 3. ICAO Recycling — 7-day window
      try {
        const recyclingCheck = await sql`
          SELECT icao_code, COUNT(DISTINCT registration)::int as reg_count
          FROM live_flight_detections_rows
          WHERE icao_code IS NOT NULL AND icao_code != ''
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND detection_timestamp > NOW() - INTERVAL '7 days'
          GROUP BY icao_code
          HAVING COUNT(DISTINCT registration) >= 10
          ORDER BY COUNT(DISTINCT registration) DESC
          LIMIT 10
        `;
        if (recyclingCheck.length > 0) {
          const worst = recyclingCheck[0];
          anomalies.push({
            type: "ICAO_RECYCLING_CATASTROPHIC", severity: "critical",
            description: `${recyclingCheck.length} ICAO hex codes recycled across 10+ registrations — worst: ${worst.icao_code} with ${worst.reg_count} registrations`,
            count: recyclingCheck.reduce((s: number, r: any) => s + r.reg_count, 0),
            timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-recycling-${Date.now()}`, priority: "critical",
            question: `Is ${worst.icao_code} (${worst.reg_count} registrations) an identity manufacturing system?`,
            data_needed: "FAA Mode-S hex assignment records",
            potential_finding: "Industrial-scale identity laundering or automated hex rotation"
          });
        }
      } catch (e: any) { console.warn("ICAO recycling check:", e.message); }

      // 4. Military Dual-Hex — 7-day window
      try {
        const dualHex = await sql`
          SELECT icao_code, registration, COUNT(*)::int as det
          FROM live_flight_detections_rows
          WHERE (icao_code LIKE 'AE%' OR icao_code LIKE 'AF%')
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND registration NOT LIKE '%-%'
            AND detection_timestamp > NOW() - INTERVAL '7 days'
          GROUP BY icao_code, registration
          ORDER BY det DESC
          LIMIT 20
        `;
        if (dualHex.length > 0) {
          anomalies.push({
            type: "MILITARY_DUAL_HEX", severity: "critical",
            description: `${dualHex.length} military-to-civilian identity spoofs detected (AE/AF hex → civilian N-number)`,
            aircraft: dualHex.map((r: any) => r.registration),
            count: dualHex.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-dualhex-${Date.now()}`, priority: "critical",
            question: `Are ${dualHex.length} military hex spoofs coordinated Posse Comitatus violations?`,
            data_needed: "Military flight plan records, DoD airframe registry",
            potential_finding: "Military conducting domestic law enforcement under civilian cover"
          });
        }
      } catch (e: any) { console.warn("Dual-hex check:", e.message); }

      // 5. Fleet convergence — 3-day window, sampled
      try {
        const convergenceEvents = await sql`
          SELECT DATE_TRUNC('hour', detection_timestamp) as hour,
                 COUNT(DISTINCT registration)::int as unique_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '3 days'
            AND registration IS NOT NULL AND registration != ''
          GROUP BY DATE_TRUNC('hour', detection_timestamp)
          HAVING COUNT(DISTINCT registration) >= 4
          ORDER BY unique_aircraft DESC
          LIMIT 10
        `;
        if (convergenceEvents.length > 0) {
          anomalies.push({
            type: "FLEET_CONVERGENCE", severity: "high",
            description: `${convergenceEvents.length} hours with 4+ aircraft simultaneously over target in past 3 days`,
            count: convergenceEvents.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { console.warn("Convergence check:", e.message); }

      // 6. Low altitude — 3-day window
      try {
        const lowAlt = await sql`
          SELECT registration, COUNT(*)::int as detection_count,
                 AVG(altitude::numeric)::int as avg_altitude
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '3 days'
            AND registration IS NOT NULL AND registration != ''
            AND altitude IS NOT NULL AND altitude::numeric > 0
          GROUP BY registration
          HAVING AVG(altitude::numeric) < 2000 AND COUNT(*) >= 3
          ORDER BY AVG(altitude::numeric) ASC
          LIMIT 30
        `;
        if (lowAlt.length > 0) {
          anomalies.push({
            type: "LOW_ALTITUDE_PATTERN", severity: "critical",
            description: `${lowAlt.length} aircraft operating at <2000ft avg in past 3 days`,
            aircraft: lowAlt.map((a: any) => a.registration),
            count: lowAlt.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-lowalt-${Date.now()}`, priority: "high",
            question: `Which of the ${lowAlt.length} low-altitude aircraft correlate with biometric stress?`,
            data_needed: "Cross-reference low-altitude windows with biometric stress spikes",
            potential_finding: "Data-driven identification of harassment aircraft"
          });
        }
      } catch (e: any) { console.warn("Low altitude check:", e.message); }

      // Always generate baseline leads
      leads.push({
        id: `lead-timing-${Date.now()}`, priority: "high",
        question: "Are there specific time patterns when surveillance intensifies?",
        data_needed: "Hourly detection frequency, sleep cycle correlation",
        potential_finding: "Operational schedule of harassment campaign"
      });

      // AI hypothesis
      let aiHypothesis = null;
      if (LOVABLE_API_KEY && anomalies.length > 0) {
        try {
          const analysisPrompt = `Analyze these surveillance anomalies and generate a prosecutable hypothesis:\n\n${anomalies.map(a => `- ${a.type}: ${a.description}`).join('\n')}\n\nGenerate 2-3 sentences connecting anomalies to coordinated surveillance, referencing RICO/42 USC 1983.`;
          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI. Be concise." },
                { role: "user", content: analysisPrompt }
              ],
              max_tokens: 300,
            }),
          });
          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiHypothesis = data.choices?.[0]?.message?.content || null;
          } else {
            await aiResponse.text();
          }
        } catch (aiErr) { console.error("AI hypothesis error:", aiErr); }
      }

      await sql.end();

      return new Response(
        JSON.stringify({
          success: true, timestamp: new Date().toISOString(),
          anomalies, leads, aiHypothesis,
          summary: {
            anomalyCount: anomalies.length, leadCount: leads.length,
            criticalCount: anomalies.filter(a => a.severity === 'critical').length
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (dbErr) {
      await sql.end();
      throw dbErr;
    }

  } catch (err) {
    console.error("Watchtower agent error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

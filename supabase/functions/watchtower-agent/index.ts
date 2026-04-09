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
    await sql`SET statement_timeout = '6s'`;
    const anomalies: PatternAnomaly[] = [];
    const leads: InvestigativeLead[] = [];
    const skipped: string[] = [];
    
    try {
      // Use fast row estimate instead of COUNT(*)
      let totalFlightEstimate = 0;
      try {
        const est = await sql`
          SELECT reltuples::bigint as estimate
          FROM pg_class WHERE relname = 'live_flight_detections_rows'
        `;
        totalFlightEstimate = parseInt(est[0]?.estimate || '0');
      } catch (e: any) { skipped.push("row_estimate"); }

      // 1. Use aircraft_profiles_enriched (35K rows) for threat analysis — FAST
      try {
        const threatAircraft = await sql`
          SELECT registration, threat_tier, repeat_offender_score, total_detections,
                 avg_altitude, operator_name
          FROM aircraft_profiles_enriched
          WHERE threat_tier IN ('CRITICAL', 'HIGH')
          ORDER BY repeat_offender_score DESC NULLS LAST
          LIMIT 30
        `;
        if (threatAircraft.length > 0) {
          const critical = threatAircraft.filter((a: any) => a.threat_tier === 'CRITICAL');
          anomalies.push({
            type: "HIGH_THREAT_AIRCRAFT", severity: "critical",
            description: `${critical.length} CRITICAL + ${threatAircraft.length - critical.length} HIGH threat aircraft baselined from ${totalFlightEstimate.toLocaleString()}+ flight records`,
            aircraft: threatAircraft.slice(0, 10).map((a: any) => a.registration),
            count: threatAircraft.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-threat-${Date.now()}`, priority: "critical",
            question: `Are the ${critical.length} CRITICAL-tier aircraft coordinating operations?`,
            data_needed: "Temporal overlap analysis, operator cross-reference",
            potential_finding: "Coordinated multi-aircraft surveillance campaign"
          });
        }
      } catch (e: any) { skipped.push("threat_profiles"); }

      // 2. Low altitude from profiles — no scan needed
      try {
        const lowAlt = await sql`
          SELECT registration, avg_altitude::int, total_detections, operator_name
          FROM aircraft_profiles_enriched
          WHERE avg_altitude IS NOT NULL AND avg_altitude < 2000 AND avg_altitude > 0
            AND total_detections >= 3
          ORDER BY avg_altitude ASC
          LIMIT 30
        `;
        if (lowAlt.length > 0) {
          anomalies.push({
            type: "LOW_ALTITUDE_PATTERN", severity: "critical",
            description: `${lowAlt.length} aircraft with avg altitude <2000ft (universe: all baselined aircraft)`,
            aircraft: lowAlt.map((a: any) => a.registration),
            count: lowAlt.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("low_altitude"); }

      // 3. ICAO recycling from id_taxonomy — pre-computed, fast
      try {
        const recycling = await sql`
          SELECT icao_hex, COUNT(DISTINCT registration)::int as reg_count
          FROM id_taxonomy
          WHERE icao_hex IS NOT NULL AND icao_hex != ''
            AND registration IS NOT NULL AND registration != ''
          GROUP BY icao_hex
          HAVING COUNT(DISTINCT registration) >= 5
          ORDER BY reg_count DESC
          LIMIT 10
        `;
        if (recycling.length > 0) {
          anomalies.push({
            type: "ICAO_RECYCLING", severity: "critical",
            description: `${recycling.length} ICAO hex codes shared across 5+ registrations — worst: ${recycling[0].icao_hex} with ${recycling[0].reg_count}`,
            count: recycling.reduce((s: number, r: any) => s + r.reg_count, 0),
            timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-recycling-${Date.now()}`, priority: "critical",
            question: `Is ${recycling[0].icao_hex} (${recycling[0].reg_count} registrations) identity laundering?`,
            data_needed: "FAA Mode-S hex assignment records",
            potential_finding: "Industrial-scale identity manufacturing"
          });
        }
      } catch (e: any) { skipped.push("icao_recycling"); }

      // 4. Ghost aircraft from id_taxonomy
      try {
        const ghosts = await sql`
          SELECT registration, classification, icao_hex
          FROM id_taxonomy
          WHERE classification IN ('ghost', 'phantom', 'suspicious')
          LIMIT 20
        `;
        if (ghosts.length > 0) {
          anomalies.push({
            type: "GHOST_AIRCRAFT", severity: "high",
            description: `${ghosts.length} ghost/phantom aircraft classified in identity taxonomy`,
            aircraft: ghosts.map((g: any) => g.registration),
            count: ghosts.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("ghost_aircraft"); }

      // 5. Biometric stress — small table, fast
      try {
        const bioStats = await sql`
          SELECT COUNT(*)::int as spike_count,
                 COUNT(CASE WHEN heart_rate > 120 THEN 1 END)::int as severe_count
          FROM biometric_monitoring
          WHERE (heart_rate > 100 OR hrv < 40 OR stress_level > 70)
            AND measurement_timestamp > NOW() - INTERVAL '7 days'
        `;
        const spikeCount = bioStats[0]?.spike_count || 0;
        if (spikeCount > 0) {
          anomalies.push({
            type: "BIOMETRIC_STRESS", severity: spikeCount > 50 ? "critical" : "high",
            description: `${spikeCount} biometric stress events in 7 days (${bioStats[0]?.severe_count || 0} severe HR>120)`,
            count: spikeCount, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("biometric"); }

      // 6. Recent sentinel threats from Supabase (already indexed)
      // Skip — this is in Supabase not Neon

      // Always add baseline leads
      leads.push({
        id: `lead-timing-${Date.now()}`, priority: "high",
        question: "Are there specific time patterns when surveillance intensifies?",
        data_needed: "Hourly detection frequency, sleep cycle correlation",
        potential_finding: "Operational schedule of harassment campaign"
      });

      // AI hypothesis — use lightweight model
      let aiHypothesis = null;
      if (LOVABLE_API_KEY && anomalies.length > 0) {
        try {
          const prompt = `Analyze these anomalies and generate a 2-sentence prosecutable hypothesis:\n${anomalies.map(a => `- ${a.type}: ${a.description}`).join('\n')}`;
          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI. Be concise and analytical." },
                { role: "user", content: prompt }
              ],
              max_tokens: 200,
            }),
          });
          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiHypothesis = data.choices?.[0]?.message?.content || null;
          } else { await aiResponse.text(); }
        } catch (aiErr) { console.error("AI hypothesis error:", aiErr); }
      }

      await sql.end();

      return new Response(
        JSON.stringify({
          success: true, timestamp: new Date().toISOString(),
          anomalies, leads, aiHypothesis, skipped,
          summary: {
            anomalyCount: anomalies.length, leadCount: leads.length,
            criticalCount: anomalies.filter(a => a.severity === 'critical').length,
            universeEstimate: totalFlightEstimate
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

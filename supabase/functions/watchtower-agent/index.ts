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
    const skipped: string[] = [];
    
    try {
      // Fast row estimate from pg_class — no table scan
      let universeEstimate = 0;
      try {
        const est = await sql`SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'live_flight_detections_rows'`;
        universeEstimate = parseInt(est[0]?.estimate || '0');
      } catch (e: any) { skipped.push("row_estimate"); }

      // 1. Flagged aircraft — uses the `flagged` boolean column, should be fast with index
      try {
        const flagged = await sql`
          SELECT registration, COUNT(*)::int as det_count,
                 ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_alt
          FROM live_flight_detections_rows
          WHERE flagged = true
            AND registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() - INTERVAL '7 days'
          GROUP BY registration
          ORDER BY det_count DESC
          LIMIT 20
        `;
        if (flagged.length > 0) {
          anomalies.push({
            type: "FLAGGED_AIRCRAFT_ACTIVE", severity: "critical",
            description: `${flagged.length} flagged aircraft active in past 7 days across ${universeEstimate.toLocaleString()}+ record universe`,
            aircraft: flagged.map((a: any) => a.registration),
            count: flagged.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-flagged-${Date.now()}`, priority: "critical",
            question: `Are ${flagged.length} flagged aircraft operating in coordinated patterns?`,
            data_needed: "Temporal overlap analysis, operator cross-reference",
            potential_finding: "Coordinated multi-aircraft surveillance campaign"
          });
        }
      } catch (e: any) { skipped.push("flagged_aircraft"); console.warn("Flagged query:", e.message); }

      // 2. Taxonomy-tagged threats (xxb shells, kcso) — uses taxonomy_tag column
      try {
        const taxThreats = await sql`
          SELECT taxonomy_tag, COUNT(DISTINCT registration)::int as aircraft_count,
                 COUNT(*)::int as detections
          FROM live_flight_detections_rows
          WHERE taxonomy_tag IS NOT NULL AND taxonomy_tag != ''
            AND taxonomy_tag LIKE '%xxb%' OR taxonomy_tag LIKE '%kcso%' OR taxonomy_tag LIKE '%shell%'
          GROUP BY taxonomy_tag
          ORDER BY detections DESC
          LIMIT 15
        `;
        if (taxThreats.length > 0) {
          const totalAircraft = taxThreats.reduce((s: number, r: any) => s + r.aircraft_count, 0);
          anomalies.push({
            type: "TAXONOMY_THREATS", severity: "critical",
            description: `${totalAircraft} threat-classified aircraft across ${taxThreats.length} taxonomy tags (xxb/kcso/shell)`,
            count: totalAircraft, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("taxonomy_threats"); console.warn("Taxonomy query:", e.message); }

      // 3. Blocked/anonymous aircraft — registration null/empty, recent
      try {
        const blocked = await sql`
          SELECT COUNT(*)::int as blocked_count,
                 COUNT(DISTINCT icao_code)::int as unique_icaos
          FROM live_flight_detections_rows
          WHERE (registration IS NULL OR registration = '' OR registration = 'N/A')
            AND detection_timestamp > NOW() - INTERVAL '3 days'
        `;
        const blockedCount = blocked[0]?.blocked_count || 0;
        if (blockedCount > 100) {
          anomalies.push({
            type: "BLOCKED_REGISTRATIONS", severity: blockedCount > 1000 ? "critical" : "high",
            description: `${blockedCount} anonymous/blocked detections in 3 days (${blocked[0]?.unique_icaos || 0} unique ICAO codes hiding identity)`,
            count: blockedCount, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-blocked-${Date.now()}`, priority: "high",
            question: `What are the ${blocked[0]?.unique_icaos} anonymous ICAO codes hiding?`,
            data_needed: "FAA Mode-S hex to registration cross-reference",
            potential_finding: "Deliberate identity suppression for covert operations"
          });
        }
      } catch (e: any) { skipped.push("blocked_reg"); console.warn("Blocked query:", e.message); }

      // 4. Low altitude sampled — use LIMIT with ORDER to avoid full scan
      try {
        const lowAlt = await sql`
          SELECT registration, altitude::int, speed::int, detection_timestamp
          FROM live_flight_detections_rows
          WHERE altitude > 0 AND altitude < 500
            AND registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() - INTERVAL '3 days'
          ORDER BY altitude ASC
          LIMIT 50
        `;
        if (lowAlt.length > 0) {
          const uniqueAircraft = [...new Set(lowAlt.map((a: any) => a.registration))];
          anomalies.push({
            type: "EXTREME_LOW_ALTITUDE", severity: "critical",
            description: `${uniqueAircraft.length} aircraft detected below 500ft in past 3 days (sampled ${lowAlt.length} events)`,
            aircraft: uniqueAircraft.slice(0, 10),
            count: uniqueAircraft.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("low_altitude"); console.warn("Low alt query:", e.message); }

      // 5. Biometric stress — small table, always fast
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
      } catch (e: any) { skipped.push("biometric"); console.warn("Bio query:", e.message); }

      // 6. Military hex codes (AE/AF prefix) — targeted filter
      try {
        const milHex = await sql`
          SELECT icao_code, registration, COUNT(*)::int as det
          FROM live_flight_detections_rows
          WHERE icao_code LIKE 'AE%' OR icao_code LIKE 'AF%'
          GROUP BY icao_code, registration
          HAVING registration IS NOT NULL AND registration != '' AND registration NOT LIKE '%-%'
          ORDER BY det DESC
          LIMIT 15
        `;
        if (milHex.length > 0) {
          anomalies.push({
            type: "MILITARY_CIVILIAN_SPOOF", severity: "critical",
            description: `${milHex.length} military hex codes broadcasting civilian registrations`,
            aircraft: milHex.map((r: any) => r.registration).filter(Boolean),
            count: milHex.length, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-milhex-${Date.now()}`, priority: "critical",
            question: `Are ${milHex.length} military hex spoofs Posse Comitatus violations?`,
            data_needed: "DoD airframe registry, 18 U.S.C. § 1385 analysis",
            potential_finding: "Military conducting domestic operations under civilian cover"
          });
        }
      } catch (e: any) { skipped.push("military_hex"); console.warn("Mil hex query:", e.message); }

      // Always add baseline leads
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
          const prompt = `Analyze these anomalies from a ${universeEstimate.toLocaleString()}+ record aviation surveillance database and generate a 2-sentence prosecutable hypothesis:\n${anomalies.map(a => `- ${a.type}: ${a.description}`).join('\n')}`;
          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI analyzing aviation surveillance patterns for legal proceedings. Be concise and cite relevant statutes." },
                { role: "user", content: prompt }
              ],
              max_tokens: 250,
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
            universeEstimate
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

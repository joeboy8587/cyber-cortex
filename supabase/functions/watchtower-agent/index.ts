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
      // Fast universe estimate — pg_class, no scan
      let universeEstimate = 0;
      try {
        const est = await sql`SELECT reltuples::bigint as estimate FROM pg_class WHERE relname = 'live_flight_detections_rows'`;
        universeEstimate = parseInt(est[0]?.estimate || '0');
      } catch (e: any) { skipped.push("row_estimate"); }

      // 1. Flagged aircraft table (small, pre-filtered)
      try {
        const flagged = await sql`SELECT * FROM flagged_aircraft_rows_rows LIMIT 50`;
        if (flagged.length > 0) {
          const regs = flagged.map((r: any) => r.registration || r.tail_number || r.n_number).filter(Boolean);
          anomalies.push({
            type: "FLAGGED_AIRCRAFT", severity: "critical",
            description: `${flagged.length} pre-flagged aircraft in investigation database`,
            aircraft: regs.slice(0, 15),
            count: flagged.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("flagged_aircraft"); }

      // 2. Shell companies (small table)
      try {
        const shells = await sql`
          SELECT COUNT(*)::int as total,
                 COUNT(DISTINCT COALESCE(company_name, entity_name, name))::int as unique_entities
          FROM shell_companies
        `;
        const shellCount = shells[0]?.total || 0;
        if (shellCount > 0) {
          anomalies.push({
            type: "SHELL_COMPANY_NETWORK", severity: "critical",
            description: `${shellCount} shell company records identified (${shells[0]?.unique_entities || 0} unique entities)`,
            count: shellCount, timestamp: new Date().toISOString()
          });
          leads.push({
            id: `lead-shell-${Date.now()}`, priority: "critical",
            question: `How are ${shells[0]?.unique_entities} shell companies connected to flagged aircraft?`,
            data_needed: "CA SOS filings, FAA registration cross-ref",
            potential_finding: "Corporate veil hiding coordinated surveillance operation"
          });
        }
      } catch (e: any) { skipped.push("shell_companies"); }

      // 3. Biometric-aircraft correlations (pre-computed, small)
      try {
        const correlations = await sql`
          SELECT COUNT(*)::int as total,
                 COUNT(CASE WHEN confidence_score > 0.7 OR correlation_strength > 0.7 THEN 1 END)::int as high_conf
          FROM master_biometric_aircraft_correlations
        `;
        const totalCorr = correlations[0]?.total || 0;
        const highConf = correlations[0]?.high_conf || 0;
        if (totalCorr > 0) {
          anomalies.push({
            type: "BIOMETRIC_AIRCRAFT_CORRELATION", severity: highConf > 10 ? "critical" : "high",
            description: `${totalCorr} biometric-aircraft correlations found (${highConf} high-confidence >70%)`,
            count: totalCorr, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("bio_correlations"); }

      // 4. Biometric stress events (small table)
      try {
        const bioStats = await sql`
          SELECT COUNT(*)::int as spike_count,
                 COUNT(CASE WHEN heart_rate > 120 THEN 1 END)::int as severe
          FROM biometric_monitoring
          WHERE heart_rate > 100 OR hrv < 40 OR stress_level > 70
        `;
        const spikeCount = bioStats[0]?.spike_count || 0;
        if (spikeCount > 0) {
          anomalies.push({
            type: "BIOMETRIC_STRESS", severity: spikeCount > 100 ? "critical" : "high",
            description: `${spikeCount} total biometric stress events (${bioStats[0]?.severe || 0} severe HR>120)`,
            count: spikeCount, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("biometric"); }

      // 5. Watchtower unified master (pre-aggregated if exists)
      try {
        const wt = await sql`
          SELECT COUNT(*)::int as total FROM watchtower_unified_master LIMIT 1
        `;
        const wtCount = wt[0]?.total || 0;
        if (wtCount > 0) {
          anomalies.push({
            type: "UNIFIED_EVIDENCE_CORPUS", severity: "high",
            description: `${wtCount.toLocaleString()} unified evidence records in watchtower master corpus`,
            count: wtCount, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("watchtower_master"); }

      // 6. KCSO fleet (small table)
      try {
        const fleet = await sql`
          SELECT tail_number, model, surveillance_capabilities
          FROM kcso_fleet
          ORDER BY tail_number
        `;
        if (fleet.length > 0) {
          anomalies.push({
            type: "KCSO_FLEET_IDENTIFIED", severity: "high",
            description: `${fleet.length} KCSO aircraft identified in fleet registry`,
            aircraft: fleet.map((f: any) => f.tail_number),
            count: fleet.length, timestamp: new Date().toISOString()
          });
        }
      } catch (e: any) { skipped.push("kcso_fleet"); }

      // Always add baseline leads
      leads.push({
        id: `lead-timing-${Date.now()}`, priority: "high",
        question: "Are there specific time patterns when surveillance intensifies?",
        data_needed: "Hourly detection frequency, sleep cycle correlation",
        potential_finding: "Operational schedule of harassment campaign"
      });
      leads.push({
        id: `lead-crossref-${Date.now()}`, priority: "high",
        question: "Which shell companies operate flagged aircraft?",
        data_needed: "FAA N-number to operator cross-reference",
        potential_finding: "RICO enterprise structure connecting entities"
      });

      // AI hypothesis
      let aiHypothesis = null;
      if (LOVABLE_API_KEY && anomalies.length > 0) {
        try {
          const prompt = `Analyze these anomalies from a ${universeEstimate.toLocaleString()}+ record aviation surveillance database:\n${anomalies.map(a => `- ${a.type}: ${a.description}`).join('\n')}\n\nGenerate a 2-sentence prosecutable hypothesis referencing RICO/42 USC 1983.`;
          const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "You are JOSIAH, an investigative AI. Be concise, cite statutes." },
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
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

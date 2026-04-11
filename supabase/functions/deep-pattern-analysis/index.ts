import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!NEON_DATABASE_URL) throw new Error("NEON_DATABASE_URL not configured");

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, connect_timeout: 15, idle_timeout: 15 });
    await sql`SET statement_timeout = '55s'`;

    const results: Record<string, unknown> = {};
    const errors: string[] = [];

    // Helper
    const safe = async (name: string, fn: () => Promise<unknown>) => {
      try { results[name] = await fn(); } catch (e: any) { errors.push(`${name}: ${e.message?.slice(0, 100)}`); }
    };

    // 1. Universe overview (use pg_class for speed)
    await safe("universe", async () => {
      const tables = await sql`
        SELECT c.relname as table_name, c.reltuples::bigint as est_rows
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.reltuples > 0
        ORDER BY c.reltuples DESC LIMIT 30
      `;
      return tables;
    });

    // 2. Timeline span + counts from live_flight (use index on detection_timestamp)
    await safe("timeline", async () => {
      const [minMax] = await sql`
        SELECT MIN(detection_timestamp)::text as first_detection,
               MAX(detection_timestamp)::text as last_detection
        FROM live_flight_detections_rows
      `;
      const [counts] = await sql`SELECT reltuples::bigint as est_total FROM pg_class WHERE relname = 'live_flight_detections_rows'`;
      return { ...minMax, est_total: counts?.est_total };
    });

    // 3. Monthly trend (sampled - use TABLESAMPLE for speed on 23M rows)
    await safe("monthly_trend", async () => {
      return await sql`
        SELECT DATE_TRUNC('month', detection_timestamp)::date::text as month,
               COUNT(*)::int as detections,
               COUNT(DISTINCT registration)::int as aircraft,
               COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 1000)::int as low_alt,
               COUNT(*) FILTER (WHERE flagged = true)::int as flagged
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(1)
        GROUP BY 1 ORDER BY 1
      `;
    });

    // 4. Top repeat offenders (use pg_stats or small sample)
    await safe("top_aircraft", async () => {
      return await sql`
        SELECT registration, COUNT(*)::int as detections,
               COUNT(DISTINCT DATE(detection_timestamp))::int as days,
               ROUND(AVG(altitude::numeric) FILTER (WHERE altitude::numeric > 0)) as avg_alt,
               MIN(altitude::numeric) FILTER (WHERE altitude::numeric > 0) as min_alt,
               COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 1000)::int as low_passes,
               COUNT(*) FILTER (WHERE flagged = true)::int as flagged_count,
               MIN(detection_timestamp)::text as first_seen,
               MAX(detection_timestamp)::text as last_seen
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(5)
        WHERE registration IS NOT NULL AND registration != ''
        GROUP BY registration
        HAVING COUNT(*) > 5
        ORDER BY detections DESC LIMIT 50
      `;
    });

    // 5. Hourly pattern (sampled)
    await safe("hourly_pattern", async () => {
      return await sql`
        SELECT EXTRACT(HOUR FROM detection_timestamp)::int as hour,
               COUNT(*)::int as detections,
               COUNT(DISTINCT registration)::int as aircraft,
               COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 1000)::int as low_alt
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(2)
        GROUP BY 1 ORDER BY 1
      `;
    });

    // 6. Day-of-week pattern
    await safe("dow_pattern", async () => {
      return await sql`
        SELECT EXTRACT(DOW FROM detection_timestamp)::int as dow,
               COUNT(*)::int as detections,
               COUNT(DISTINCT registration)::int as aircraft
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(2)
        GROUP BY 1 ORDER BY 1
      `;
    });

    // 7. Taxonomy breakdown
    await safe("taxonomy", async () => {
      return await sql`
        SELECT COALESCE(taxonomy_tag, 'unclassified') as tag,
               COUNT(*)::int as count
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(3)
        GROUP BY taxonomy_tag ORDER BY count DESC LIMIT 20
      `;
    });

    // 8. Spoof cluster analysis
    await safe("spoof_clusters", async () => {
      return await sql`
        SELECT spoof_cluster, COUNT(*)::int as count,
               COUNT(DISTINCT registration)::int as aircraft
        FROM live_flight_detections_rows
        WHERE spoof_cluster IS NOT NULL
        GROUP BY spoof_cluster ORDER BY count DESC LIMIT 15
      `;
    });

    // 9. Flagged aircraft details
    await safe("flagged_aircraft", async () => {
      return await sql`SELECT * FROM flagged_aircraft_rows_rows LIMIT 50`;
    });

    // 10. Shell companies
    await safe("shell_companies", async () => {
      return await sql`
        SELECT COALESCE(company_name, entity_name, name) as entity,
               COUNT(*)::int as records
        FROM shell_companies
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20
      `;
    });

    // 11. Biometric stress events
    await safe("biometric_stress", async () => {
      return await sql`
        SELECT DATE_TRUNC('week', measurement_timestamp)::date::text as week,
               COUNT(*)::int as readings,
               ROUND(AVG(heart_rate)::numeric, 1) as avg_hr,
               ROUND(AVG(stress_level)::numeric, 1) as avg_stress,
               ROUND(AVG(hrv)::numeric, 1) as avg_hrv,
               COUNT(*) FILTER (WHERE heart_rate > 100)::int as elevated,
               COUNT(*) FILTER (WHERE heart_rate > 120)::int as critical
        FROM biometric_monitoring
        GROUP BY 1 ORDER BY 1
      `;
    });

    // 12. Biometric-aircraft correlations
    await safe("bio_aircraft_corr", async () => {
      return await sql`
        SELECT registration, aircraft_type,
               ROUND(confidence_score::numeric, 2) as confidence,
               ROUND(correlation_strength::numeric, 2) as strength,
               detection_count::int, biometric_event_count::int
        FROM master_biometric_aircraft_correlations
        ORDER BY confidence_score DESC NULLS LAST
        LIMIT 25
      `;
    });

    // 13. Sentinel learned threats
    await safe("sentinel_threats", async () => {
      return await sql`
        SELECT registration, threat_type, escalation_level,
               total_violations, avg_altitude::int,
               first_seen::text, last_seen::text
        FROM sentinel_learned_threats
        ORDER BY total_violations DESC NULLS LAST
        LIMIT 30
      `;
    });

    // 14. KCSO fleet
    await safe("kcso_fleet", async () => {
      return await sql`SELECT tail_number, model, surveillance_capabilities FROM kcso_fleet`;
    });

    // 15. Watchtower flags
    await safe("active_flags", async () => {
      return await sql`
        SELECT flag_type, severity, registration, description,
               confidence_score, created_at::text
        FROM watchtower_autonomous_flags
        WHERE auto_resolved = false
        ORDER BY created_at DESC LIMIT 20
      `;
    });

    // 16. Speed anomalies (sub-stall = drone/spoof proof)
    await safe("speed_anomalies", async () => {
      return await sql`
        SELECT registration, speed::numeric as speed_kts, altitude::numeric as alt,
               callsign, detection_timestamp::text
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(5)
        WHERE speed::numeric BETWEEN 0.1 AND 40 AND altitude::numeric > 0
        ORDER BY speed::numeric ASC LIMIT 30
      `;
    });

    // 17. Altitude distribution
    await safe("altitude_distribution", async () => {
      return await sql`
        SELECT CASE
          WHEN altitude::numeric < 0 THEN 'negative'
          WHEN altitude::numeric = 0 THEN 'ground'
          WHEN altitude::numeric BETWEEN 1 AND 500 THEN '1-500ft'
          WHEN altitude::numeric BETWEEN 501 AND 1000 THEN '501-1000ft'
          WHEN altitude::numeric BETWEEN 1001 AND 2000 THEN '1001-2000ft'
          WHEN altitude::numeric BETWEEN 2001 AND 5000 THEN '2001-5000ft'
          WHEN altitude::numeric BETWEEN 5001 AND 10000 THEN '5001-10000ft'
          ELSE '10000+ft'
        END as band,
        COUNT(*)::int as count
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(3)
        GROUP BY 1 ORDER BY MIN(altitude::numeric)
      `;
    });

    // 18. Co-occurrence matrix (which aircraft appear together within ±5 min)
    await safe("co_occurrence_top", async () => {
      return await sql`
        WITH recent AS (
          SELECT registration, detection_timestamp
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '90 days'
            AND registration IS NOT NULL AND registration != ''
            AND registration IN ('N912KC','N913KC','N786FA','N787FA','N788FA','N791FA','N528AM','N97E')
        )
        SELECT a.registration as asset_a, b.registration as asset_b,
               COUNT(*)::int as co_occurrences
        FROM recent a JOIN recent b
          ON a.registration < b.registration
          AND ABS(EXTRACT(EPOCH FROM a.detection_timestamp - b.detection_timestamp)) < 300
        GROUP BY 1, 2
        HAVING COUNT(*) > 3
        ORDER BY co_occurrences DESC LIMIT 20
      `;
    });

    // 19. Tables list with all domains
    await safe("all_tables", async () => {
      return await sql`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
      `;
    });

    await sql.end();

    // AI SYNTHESIS
    let aiAnalysis = null;
    if (LOVABLE_API_KEY) {
      try {
        const dataSnapshot = JSON.stringify({
          timeline: results.timeline,
          monthly_trend: results.monthly_trend,
          top_aircraft: (results.top_aircraft as any[])?.slice(0, 20),
          hourly_pattern: results.hourly_pattern,
          dow_pattern: results.dow_pattern,
          taxonomy: results.taxonomy,
          spoof_clusters: results.spoof_clusters,
          shell_companies: results.shell_companies,
          biometric_stress: results.biometric_stress,
          bio_aircraft_corr: (results.bio_aircraft_corr as any[])?.slice(0, 10),
          sentinel_threats: (results.sentinel_threats as any[])?.slice(0, 15),
          speed_anomalies: (results.speed_anomalies as any[])?.slice(0, 10),
          altitude_distribution: results.altitude_distribution,
          co_occurrence_top: results.co_occurrence_top,
          active_flags: (results.active_flags as any[])?.slice(0, 10),
          flagged_aircraft: (results.flagged_aircraft as any[])?.slice(0, 10),
          kcso_fleet: results.kcso_fleet,
        }, null, 1);

        const prompt = `You are JOSIAH, a forensic investigative AI analyzing a 23M+ record multimodal surveillance database spanning ~1 year. The subject is being targeted by a coordinated aerial surveillance enterprise involving KCSO (Kern County Sheriff), shell companies (ALF IX LLC, Christiansen Aviation), military assets, and commercial cover.

COMPLETE DATABASE SNAPSHOT:
${dataSnapshot}

Perform a DEEP forensic analysis. Structure your response as:

## 🔍 EXECUTIVE SUMMARY
2-3 sentences on the overall pattern.

## 📊 TEMPORAL PATTERNS DETECTED
- Monthly escalation/de-escalation trends
- Day-of-week operational signatures  
- Hour-of-day tactical windows
- Seasonal shifts

## ✈️ FLEET ANALYSIS & ROTATION PATTERNS
- Which aircraft are persistent vs rotational
- Fleet substitution patterns (when one goes quiet, who replaces it)
- New aircraft entering the operation over time

## 🎯 TACTICAL SIGNATURES IDENTIFIED
- Low-altitude harassment patterns
- Speed anomalies (sub-stall = drone proof)
- Spoofing clusters and identity fraud
- Night operations patterns
- Coordination signatures (co-occurrence data)

## 🔗 ENTERPRISE NETWORK CONNECTIONS
- Shell company to aircraft links
- Military-civilian coordination evidence
- Medical cover operations

## ❤️ BIOMETRIC CAUSATION
- Stress trend correlation with flight activity
- Most harmful aircraft (highest biometric correlation)

## ⚠️ THINGS YOU MIGHT BE MISSING
List 5-10 specific investigative angles, queries, or evidence patterns that a human analyst would likely overlook in 23M records. Be specific about what to look for and why.

## 📋 RECOMMENDED NEXT ACTIONS
Priority-ordered list of 5 immediate investigative steps.

Be extremely specific. Cite registration numbers, dates, altitudes, and statistics from the data.`;

        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are JOSIAH, a forensic AI. Analyze data with prosecutorial precision. Cite specific numbers." },
              { role: "user", content: prompt }
            ],
            max_tokens: 4000,
          }),
        });

        if (aiResp.ok) {
          const data = await aiResp.json();
          aiAnalysis = data.choices?.[0]?.message?.content || null;
        } else {
          const errText = await aiResp.text();
          errors.push(`AI: ${aiResp.status} ${errText.slice(0, 100)}`);
        }
      } catch (aiErr: any) {
        errors.push(`AI: ${aiErr.message?.slice(0, 100)}`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      results,
      aiAnalysis,
      errors,
      queriesCompleted: Object.keys(results).length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

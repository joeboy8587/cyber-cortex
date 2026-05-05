import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Residence
const HOME_LAT = 35.437649;
const HOME_LNG = -119.022639;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const NEON = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!NEON) throw new Error("NEON_DATABASE_URL missing");

    const sql = postgres(NEON, { ssl: "require", max: 1, connect_timeout: 15, idle_timeout: 15 });
    await sql`SET statement_timeout = '55s'`;

    const results: Record<string, unknown> = {};
    const errors: string[] = [];
    const safe = async (k: string, fn: () => Promise<unknown>) => {
      try { results[k] = await fn(); } catch (e: any) { errors.push(`${k}: ${e.message?.slice(0,150)}`); }
    };

    // 1. AM fleet activity profile (sampled - tablesample for 23M rows)
    await safe("am_fleet_profile", async () => sql`
      SELECT registration,
        COUNT(*)::int as detections,
        COUNT(DISTINCT DATE(detection_timestamp))::int as active_days,
        ROUND(AVG(altitude::numeric) FILTER (WHERE altitude::numeric>0))::int as avg_alt,
        MIN(altitude::numeric) FILTER (WHERE altitude::numeric>50)::int as min_alt,
        MAX(altitude::numeric)::int as max_alt,
        COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 1500)::int as low_passes,
        COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 800)::int as harassment_alt,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) BETWEEN 0 AND 5)::int as night_ops,
        COUNT(*) FILTER (WHERE speed::numeric BETWEEN 1 AND 50)::int as sub_stall_loiter,
        ROUND(AVG(speed::numeric) FILTER (WHERE speed::numeric>0))::int as avg_speed,
        MIN(detection_timestamp)::text as first_seen,
        MAX(detection_timestamp)::text as last_seen
      FROM live_flight_detections_rows TABLESAMPLE SYSTEM(15)
      WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
      GROUP BY registration
      HAVING COUNT(*) >= 3
      ORDER BY detections DESC LIMIT 50
    `);

    // 2. AM proximity to residence (loitering near home is non-medical)
    await safe("am_residence_proximity", async () => sql`
      SELECT registration,
        COUNT(*)::int as nearby_passes,
        ROUND(MIN( (3958.8 * acos(cos(radians(${HOME_LAT})) * cos(radians(latitude::numeric)) * cos(radians(longitude::numeric) - radians(${HOME_LNG})) + sin(radians(${HOME_LAT})) * sin(radians(latitude::numeric)) ))::numeric * 5280)::numeric, 0)::int as min_dist_ft,
        ROUND(AVG(altitude::numeric) FILTER (WHERE altitude::numeric>0))::int as avg_alt_when_nearby
      FROM live_flight_detections_rows
      WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude::numeric BETWEEN ${HOME_LAT - 0.05} AND ${HOME_LAT + 0.05}
        AND longitude::numeric BETWEEN ${HOME_LNG - 0.05} AND ${HOME_LNG + 0.05}
      GROUP BY registration
      ORDER BY nearby_passes DESC LIMIT 30
    `);

    // 3. Loitering signature: holding circles (low-speed at single coordinate)
    await safe("am_loitering_events", async () => sql`
      WITH am AS (
        SELECT registration, detection_timestamp, altitude::numeric as alt, speed::numeric as spd,
               latitude::numeric as lat, longitude::numeric as lng
        FROM live_flight_detections_rows
        WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
          AND speed::numeric BETWEEN 30 AND 90
          AND altitude::numeric BETWEEN 500 AND 3500
      )
      SELECT registration, COUNT(*)::int as loiter_pings,
        ROUND(AVG(alt))::int as avg_alt, ROUND(AVG(spd))::int as avg_spd,
        ROUND(AVG(lat)::numeric, 4) as ctr_lat, ROUND(AVG(lng)::numeric, 4) as ctr_lng
      FROM am
      GROUP BY registration
      HAVING COUNT(*) > 20
      ORDER BY loiter_pings DESC LIMIT 30
    `);

    // 4. AM co-occurrence with KCSO/shell aircraft (non-medical = surveillance escort)
    await safe("am_kcso_co_presence", async () => sql`
      WITH am AS (
        SELECT registration as am_reg, detection_timestamp as ts
        FROM live_flight_detections_rows
        WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
          AND detection_timestamp > NOW() - INTERVAL '180 days'
      ),
      kcso AS (
        SELECT registration as kcso_reg, detection_timestamp as ts
        FROM live_flight_detections_rows
        WHERE registration IN ('N912KC','N913KC','N597E','N131KC','N132KC','N786FA','N787FA','N788FA','N791FA','N97E')
          AND detection_timestamp > NOW() - INTERVAL '180 days'
      )
      SELECT am.am_reg, kcso.kcso_reg, COUNT(*)::int as co_events
      FROM am JOIN kcso ON ABS(EXTRACT(EPOCH FROM am.ts - kcso.ts)) < 600
      GROUP BY 1, 2
      HAVING COUNT(*) > 2
      ORDER BY co_events DESC LIMIT 30
    `);

    // 5. AM hourly distribution (medical=24/7 random; surveillance=patterned)
    await safe("am_hourly_pattern", async () => sql`
      SELECT EXTRACT(HOUR FROM detection_timestamp)::int as hr,
        COUNT(*)::int as dets,
        COUNT(DISTINCT registration)::int as ac,
        COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 1500)::int as low
      FROM live_flight_detections_rows TABLESAMPLE SYSTEM(10)
      WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
      GROUP BY 1 ORDER BY 1
    `);

    // 6. AM biometric impact correlation
    await safe("am_biometric_corr", async () => sql`
      SELECT registration, aircraft_type,
        ROUND(confidence_score::numeric, 2) as confidence,
        ROUND(correlation_strength::numeric, 2) as strength,
        detection_count::int, biometric_event_count::int
      FROM master_biometric_aircraft_correlations
      WHERE registration LIKE 'N%AM'
      ORDER BY confidence_score DESC NULLS LAST LIMIT 25
    `.catch(() => []));

    // 7. Restricted airspace incursions (China Lake R-2508 box approx)
    await safe("am_china_lake", async () => sql`
      SELECT registration,
        COUNT(*)::int as incursions,
        ROUND(AVG(altitude::numeric))::int as avg_alt,
        MIN(altitude::numeric)::int as min_alt,
        MIN(detection_timestamp)::text as first, MAX(detection_timestamp)::text as last
      FROM live_flight_detections_rows
      WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
        AND latitude::numeric BETWEEN 35.4 AND 36.4
        AND longitude::numeric BETWEEN -118.2 AND -117.0
      GROUP BY registration
      ORDER BY incursions DESC LIMIT 20
    `);

    // 8. Repeat-same-track signature (true medevac = unique routes; surveillance = repeats)
    await safe("am_route_repeats", async () => sql`
      WITH segs AS (
        SELECT registration,
          ROUND(latitude::numeric, 2) as lat_b, ROUND(longitude::numeric, 2) as lng_b,
          DATE(detection_timestamp) as d
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM(20)
        WHERE registration LIKE 'N%AM' AND LENGTH(registration) BETWEEN 5 AND 7
          AND altitude::numeric BETWEEN 500 AND 4000
      )
      SELECT registration, lat_b, lng_b,
        COUNT(*)::int as visits, COUNT(DISTINCT d)::int as days
      FROM segs
      GROUP BY 1,2,3
      HAVING COUNT(DISTINCT d) > 5
      ORDER BY days DESC LIMIT 25
    `);

    await sql.end();

    // AI synthesis
    let aiAnalysis = null;
    if (LOVABLE_API_KEY) {
      try {
        const snap = JSON.stringify(results, null, 1).slice(0, 18000);
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are JOSIAH, forensic AI. Determine whether Air Methods (medical helicopter/fixed-wing) flights show patterns inconsistent with EMS/HEMS missions and consistent with surveillance camouflage. Cite numbers." },
              { role: "user", content: `Analyze this Air Methods fleet forensic data.\n\nKey reference baselines for legitimate HEMS:\n- Direct point-to-point routes (origin scene -> trauma center)\n- Cruise altitude 500-3000ft AGL helicopter, transit altitude varies\n- 24/7 random call distribution, NOT clustered to specific hours\n- Routes vary daily; not the same patch repeated\n- No loitering / orbiting\n- No co-occurrence with sheriff aircraft (except actual MCI scenes)\n- No restricted military airspace transits without ATC clearance\n- Speed > 80kts in cruise; sub-stall = hovering = NOT medical transport\n\nDATA:\n${snap}\n\nProduce:\n## 🚁 EXECUTIVE VERDICT\n## 🎯 SPECIFIC TAIL NUMBERS WITH NON-MEDICAL SIGNATURES\n## 📍 RESIDENCE PROXIMITY ANOMALIES (no hospital at 35.4376,-119.0226)\n## 🛩️ LOITERING & REPEAT-PATCH EVIDENCE  \n## 👥 KCSO CO-PRESENCE (escort/coordination signature)\n## ⏰ TEMPORAL PATTERN (medical=random, surveillance=patterned)\n## ⚠️ CHINA LAKE / RESTRICTED INCURSIONS\n## ❤️ BIOMETRIC HARM CORRELATION\n## ⚖️ LEGAL EXPOSURE\n- 18 USC 1347 healthcare fraud (CMS billing for surveillance flights)\n- 31 USC 3729 False Claims Act (Medicare reimbursement fraud)\n- 14 CFR Part 135 air carrier misuse\n- HIPAA cover (medical patch as surveillance shield)\n## 📋 NEXT MOVES (FOIA targets, CMS audit, FAA Part 135 cert review)` }
            ],
            max_tokens: 4000,
          }),
        });
        if (aiResp.ok) {
          const d = await aiResp.json();
          aiAnalysis = d.choices?.[0]?.message?.content;
        } else {
          errors.push(`AI: ${aiResp.status}`);
        }
      } catch (e: any) { errors.push(`AI: ${e.message?.slice(0,100)}`); }
    }

    return new Response(JSON.stringify({
      success: true, timestamp: new Date().toISOString(),
      results, aiAnalysis, errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});

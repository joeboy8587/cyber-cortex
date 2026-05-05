// Daily Triage Agent — collapses 20M rows / 800 tables into 1 page/day.
// Runs targeted anomaly / convergence / biometric / threshold queries against Neon,
// then writes a single row to public.watchtower_daily_reports (Supabase) for UI.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const HOME_LAT = 35.437649;
const HOME_LNG = -119.022639;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!NEON) return json({ error: "NEON_DATABASE_URL missing" }, 500);

  const supabase = createClient(SB_URL, SB_KEY);
  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false },
    max: 1, idle_timeout: 10, connect_timeout: 30, prepare: false,
  });

  const t0 = Date.now();
  const out: Record<string, unknown> = {};
  const safe = async <T>(k: string, fn: () => Promise<T>) => {
    try { out[k] = await fn(); } catch (e) { out[k] = { error: String(e) }; }
  };

  // --- 1. New anomalies in last 24h: sub-stall / sub-500ft / night ops ---
  await safe("anomalies_24h", () => sql`
    SELECT registration,
      COUNT(*)::int AS hits,
      MIN(altitude::numeric)::int AS min_alt,
      MIN(speed::numeric)::int AS min_spd,
      COUNT(*) FILTER (WHERE speed::numeric BETWEEN 1 AND 48)::int AS sub_stall,
      COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 500)::int AS sub_500ft,
      COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) BETWEEN 0 AND 5)::int AS night
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
      AND registration IS NOT NULL
    GROUP BY registration
    HAVING COUNT(*) FILTER (WHERE speed::numeric BETWEEN 1 AND 48) > 0
        OR COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 500) > 0
    ORDER BY (COUNT(*) FILTER (WHERE speed::numeric BETWEEN 1 AND 48)
            + COUNT(*) FILTER (WHERE altitude::numeric BETWEEN 1 AND 500)) DESC
    LIMIT 10
  `);

  // --- 2. Residence overflights (within ~3 mi of AOI) last 24h ---
  await safe("residence_overflights_24h", () => sql`
    SELECT registration, COUNT(*)::int AS passes,
      ROUND(AVG(altitude::numeric))::int AS avg_alt,
      MIN(altitude::numeric)::int AS min_alt
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
      AND latitude::numeric BETWEEN ${HOME_LAT - 0.05} AND ${HOME_LAT + 0.05}
      AND longitude::numeric BETWEEN ${HOME_LNG - 0.05} AND ${HOME_LNG + 0.05}
    GROUP BY registration
    HAVING COUNT(*) >= 3
    ORDER BY passes DESC LIMIT 10
  `);

  // --- 3. Top biometric correlations (already pre-computed canonical table) ---
  await safe("top_biometric_corr", () => sql`
    SELECT registration, aircraft_type,
      ROUND(confidence_score::numeric, 2) AS confidence,
      ROUND(correlation_strength::numeric, 2) AS strength,
      detection_count::int, biometric_event_count::int
    FROM master_biometric_aircraft_correlations
    WHERE confidence_score >= 0.85
    ORDER BY confidence_score DESC NULLS LAST
    LIMIT 10
  `.catch(() => []));

  // --- 4. Convergence: 3+ aircraft same minute within 2 mi of AOI (last 7d) ---
  await safe("swarm_convergence_7d", () => sql`
    WITH near AS (
      SELECT registration,
        DATE_TRUNC('minute', detection_timestamp) AS m,
        latitude::numeric AS lat, longitude::numeric AS lng
      FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '7 days'
        AND latitude::numeric BETWEEN ${HOME_LAT - 0.03} AND ${HOME_LAT + 0.03}
        AND longitude::numeric BETWEEN ${HOME_LNG - 0.03} AND ${HOME_LNG + 0.03}
    )
    SELECT m::text AS minute,
      COUNT(DISTINCT registration)::int AS unique_ac,
      ARRAY_AGG(DISTINCT registration) AS aircraft
    FROM near
    GROUP BY m
    HAVING COUNT(DISTINCT registration) >= 3
    ORDER BY unique_ac DESC, m DESC
    LIMIT 10
  `);

  // --- 5. KCSO + Air Methods + shell co-presence today ---
  await safe("watchlist_active_24h", () => sql`
    SELECT registration, COUNT(*)::int AS dets,
      MIN(altitude::numeric)::int AS min_alt, MIN(speed::numeric)::int AS min_spd
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
      AND (registration IN ('N912KC','N913KC','N597E','N131KC','N132KC',
                             'N224AM','N229AM','N743AM','N221TK','N223AM',
                             'N916HT','N916GW','N916BQ','N916NT',
                             'N786FA','N787FA','N788FA','N790FA','N791FA'))
    GROUP BY registration
    ORDER BY dets DESC
  `);

  // --- 6. Database growth pulse ---
  await safe("db_pulse", () => sql`
    SELECT
      (SELECT COUNT(*) FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '24 hours')::int AS detections_24h,
      (SELECT COUNT(DISTINCT registration) FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '24 hours')::int AS unique_ac_24h
  `.then(r => r[0]));

  await sql.end();

  // --- Compose threat level ---
  const anomalies = (out.anomalies_24h as any[]) || [];
  const overflights = (out.residence_overflights_24h as any[]) || [];
  const swarm = (out.swarm_convergence_7d as any[]) || [];
  const watch = (out.watchlist_active_24h as any[]) || [];
  const score =
    anomalies.length * 2 + overflights.length * 3 + swarm.length * 4 + watch.length;
  const threat = score >= 30 ? "CRITICAL" : score >= 15 ? "ELEVATED" : score >= 5 ? "ELEVATED" : "NORMAL";

  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10);
  const code = `TRIAGE-${dateStr.replace(/-/g, "")}`;

  const synthesis = `Daily Triage ${dateStr}\n` +
    `• Anomaly aircraft (sub-stall / sub-500ft, 24h): ${anomalies.length}\n` +
    `• Residence overflights (24h): ${overflights.length}\n` +
    `• Swarm convergence events (7d): ${swarm.length}\n` +
    `• Watchlist aircraft active (24h): ${watch.length}\n` +
    `• Total detections last 24h: ${(out.db_pulse as any)?.detections_24h ?? "?"}\n` +
    `• Threat: ${threat}`;

  // Upsert into watchtower_daily_reports
  await supabase.from("watchtower_daily_reports").upsert({
    report_date: dateStr,
    report_id_code: code,
    threat_level: threat,
    active_aircraft_count: (out.db_pulse as any)?.unique_ac_24h ?? 0,
    confirmed_threats: anomalies.length + overflights.length,
    suspicious_count: swarm.length,
    monitored_count: watch.length,
    violations: anomalies,
    threat_database: overflights,
    active_aircraft: watch,
    pattern_summary: {
      swarm_convergence: swarm,
      top_biometric_corr: out.top_biometric_corr,
      db_pulse: out.db_pulse,
      score,
    },
    ai_synthesis: synthesis,
  }, { onConflict: "report_date" });

  return json({
    success: true,
    report_date: dateStr,
    threat_level: threat,
    score,
    runtime_ms: Date.now() - t0,
    sections: out,
    synthesis,
  });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

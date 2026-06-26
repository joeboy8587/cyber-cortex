// KCSO Air Support Policy Violation Engine
// Deterministic rules derived from the KCSO Air Support Unit Operations Manual.
// Scans Neon flight detections for the past N days, flags every violation,
// writes results into public.policy_violations on Lovable Cloud.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// KCSO rotor + fixed-wing ICAO prefixes seen in fleet (extend over time)
const KCSO_TAIL_PATTERNS = ["KCSO", "STAR", "AIR1", "AIR2", "AIR3"];
const KCSO_CALLSIGN_LIKE = "(callsign ILIKE 'KCSO%' OR callsign ILIKE 'STAR%' OR callsign ILIKE 'AIR%')";

// AOI / Kern mountainous terrain crude bbox (Tehachapi + Greenhorn + Piute)
const MOUNTAIN_BBOX = {
  latMin: 35.0, latMax: 35.95,
  lngMin: -118.95, lngMax: -118.10,
};

interface Rule {
  code: string;
  title: string;
  manual_section: string;
  severity: "low" | "medium" | "high" | "critical";
  sql: string; // SELECT icao, callsign, detected_at, evidence (jsonb) FROM ...
}

function rules(lookbackDays: number): Rule[] {
  const since = `NOW() - INTERVAL '${lookbackDays} days'`;
  return [
    {
      code: "B-401",
      title: "Night VFR below 2000ft AGL in mountainous terrain",
      manual_section: "KCSO Air Support B-401",
      severity: "high",
      sql: `
        SELECT icao24 AS icao, callsign,
               detection_timestamp AS detected_at,
               jsonb_build_object(
                 'altitude_ft', altitude,
                 'lat', latitude, 'lng', longitude,
                 'rule', 'night_vfr_low_alt_mountain'
               ) AS evidence
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= ${since}
          AND altitude IS NOT NULL AND altitude > 0 AND altitude < 2000
          AND latitude BETWEEN ${MOUNTAIN_BBOX.latMin} AND ${MOUNTAIN_BBOX.latMax}
          AND longitude BETWEEN ${MOUNTAIN_BBOX.lngMin} AND ${MOUNTAIN_BBOX.lngMax}
          AND EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') NOT BETWEEN 6 AND 19
          AND ${KCSO_CALLSIGN_LIKE}
        LIMIT 500
      `,
    },
    {
      code: "C-100-HOVER",
      title: "Sustained low-altitude hover outside SAR window",
      manual_section: "KCSO Air Support C-100 (Helicopter Ops)",
      severity: "high",
      sql: `
        WITH lowslow AS (
          SELECT icao24, callsign, detection_timestamp, altitude, ground_speed, latitude, longitude
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= ${since}
            AND altitude IS NOT NULL AND altitude < 500
            AND ground_speed IS NOT NULL AND ground_speed < 30
            AND ${KCSO_CALLSIGN_LIKE}
        ),
        cluster AS (
          SELECT icao24, callsign,
                 MIN(detection_timestamp) AS start_ts,
                 MAX(detection_timestamp) AS end_ts,
                 COUNT(*) AS pings,
                 AVG(altitude) AS avg_alt
          FROM lowslow
          GROUP BY icao24, callsign, date_trunc('hour', detection_timestamp)
          HAVING COUNT(*) >= 6
        )
        SELECT icao24 AS icao, callsign, start_ts AS detected_at,
               jsonb_build_object(
                 'duration_min', EXTRACT(EPOCH FROM (end_ts - start_ts))/60,
                 'pings', pings, 'avg_alt_ft', avg_alt,
                 'rule', 'sustained_hover_low_alt'
               ) AS evidence
        FROM cluster
        LIMIT 500
      `,
    },
    {
      code: "A-401",
      title: "Aerial Surveillance with no concurrent CAD/dispatch trigger",
      manual_section: "KCSO Air Support A-401 (Mission Authorization)",
      severity: "medium",
      sql: `
        SELECT icao24 AS icao, callsign, detection_timestamp AS detected_at,
               jsonb_build_object(
                 'altitude_ft', altitude,
                 'rule', 'surveillance_loiter_no_cad'
               ) AS evidence
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= ${since}
          AND altitude BETWEEN 600 AND 1800
          AND ${KCSO_CALLSIGN_LIKE}
          AND EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') BETWEEN 22 AND 23
        LIMIT 500
      `,
    },
    {
      code: "B-1102",
      title: "Executive transport profile — no manifest expected",
      manual_section: "KCSO Air Support B-1102 (Transport)",
      severity: "medium",
      sql: `
        SELECT icao24 AS icao, callsign, detection_timestamp AS detected_at,
               jsonb_build_object(
                 'altitude_ft', altitude,
                 'ground_speed_kts', ground_speed,
                 'rule', 'exec_transport_profile'
               ) AS evidence
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= ${since}
          AND altitude BETWEEN 5000 AND 12000
          AND ground_speed > 130
          AND ${KCSO_CALLSIGN_LIKE}
        LIMIT 500
      `,
    },
    {
      code: "GHOST-AE",
      title: "Foreign AE-prefix ICAO inside KCSO AOI (identity laundering signal)",
      manual_section: "Cross-reference: Manual A-100 vs FAA Registry",
      severity: "critical",
      sql: `
        SELECT icao24 AS icao, callsign, detection_timestamp AS detected_at,
               jsonb_build_object(
                 'altitude_ft', altitude,
                 'lat', latitude, 'lng', longitude,
                 'rule', 'foreign_prefix_in_aoi'
               ) AS evidence
        FROM live_flight_detections_rows
        WHERE detection_timestamp >= ${since}
          AND icao24 ILIKE 'AE%'
          AND latitude BETWEEN 35.30 AND 35.55
          AND longitude BETWEEN -119.15 AND -118.90
        LIMIT 500
      `,
    },
  ];
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!neonUrl || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "missing config" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const lookbackDays = Math.min(Math.max(Number(body.lookbackDays) || 14, 1), 90);
    const dryRun = body.dryRun === true;

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '60000'`).catch(() => {});

    const supa = createClient(supaUrl, supaKey);
    const report: any[] = [];
    let totalInserted = 0;

    for (const rule of rules(lookbackDays)) {
      try {
        const rows = await sql.unsafe(rule.sql) as any[];
        const records = await Promise.all(rows.map(async (r) => {
          const key = `${rule.code}|${r.icao}|${r.detected_at}`;
          const sha = await sha256Hex(key);
          return {
            icao: r.icao,
            callsign: r.callsign,
            detected_at: r.detected_at,
            rule_code: rule.code,
            rule_title: rule.title,
            manual_section: rule.manual_section,
            severity: rule.severity,
            evidence: r.evidence,
            source_table: "live_flight_detections_rows",
            sha256: sha,
          };
        }));

        if (!dryRun && records.length > 0) {
          // Dedup against existing sha256 batch
          const shas = records.map(r => r.sha256);
          const { data: existing } = await supa
            .from("policy_violations")
            .select("sha256")
            .in("sha256", shas);
          const existingSet = new Set((existing || []).map((e: any) => e.sha256));
          const fresh = records.filter(r => !existingSet.has(r.sha256));
          if (fresh.length > 0) {
            const { error } = await supa.from("policy_violations").insert(fresh);
            if (error) throw error;
            totalInserted += fresh.length;
          }
        }

        report.push({
          rule_code: rule.code,
          rule_title: rule.title,
          severity: rule.severity,
          matches: records.length,
        });
      } catch (e: any) {
        report.push({ rule_code: rule.code, error: String(e?.message || e) });
      }
    }

    return new Response(JSON.stringify({
      ok: true, lookbackDays, dryRun, totalInserted, rules: report,
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

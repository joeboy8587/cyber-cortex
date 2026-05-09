import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Primary AOI (residence)
const AOI_LAT = 35.437649;
const AOI_LNG = -119.022639;
const AOI_RADIUS_DEG = 0.05; // ~5.5km gross filter; finer scoring below

// Layer weights (sum target ~1.0 ideal but score is additive, capped)
const W = {
  physics: 25,
  identity: 20,
  proximity: 20,
  biometric: 25,
  network: 20,
  repetition: 15,
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escalation(score: number): number {
  if (score >= 80) return 5;
  if (score >= 60) return 4;
  if (score >= 40) return 3;
  if (score >= 20) return 2;
  return 1;
}

function threatType(b: any, profile: any): string {
  if (profile?.kcso_flag) return "KCSO Surveillance Asset";
  if (profile?.military_flag) return "Military Coordination";
  if (profile?.shell_links?.length) return "Shell Network Operator";
  if (b.physics > 0) return "Physics Anomaly (sub-stall / 0ft staging)";
  if (b.identity > 0) return "Identity Falsification";
  if (b.biometric > 0) return "Biometric Causation";
  return "Persistent Surveillance Pattern";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON_DATABASE_URL) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const limitTails: string[] | null = Array.isArray(body?.registrations) && body.registrations.length
    ? body.registrations.map((s: string) => String(s).toUpperCase())
    : null;
  const maxRows: number = Math.min(Number(body?.maxRows) || 500, 2000);

  const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Pull candidate tails from canonical profile (preferred) else live detections
    let profiles: any[] = [];
    const hasProfile = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='canonical_operator_profiles'
    `;
    if (hasProfile.length) {
      profiles = limitTails
        ? await sql`SELECT * FROM canonical_operator_profiles WHERE registration = ANY(${limitTails})`
        : await sql`SELECT * FROM canonical_operator_profiles ORDER BY occurrences_total DESC LIMIT ${maxRows}`;
    } else {
      const fallback = await sql`
        SELECT UPPER(TRIM(registration)) AS registration, COUNT(*)::bigint AS occurrences_total, MAX(detection_timestamp) AS last_seen
        FROM live_flight_detections_rows
        WHERE registration IS NOT NULL AND TRIM(registration) <> ''
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT ${maxRows}
      `;
      profiles = fallback;
    }

    // 2. Detect available signal tables once
    const tbls = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY(${[
        "live_flight_detections_rows",
        "confirmed_biometric_correlations",
        "exhibit_d_biometric_harm",
      ]})
    `;
    const have = new Set(tbls.map((r: any) => r.table_name));

    let upserts = 0;
    const summaries: any[] = [];

    for (const p of profiles) {
      const reg = p.registration;
      const breakdown: any = {};

      // PHYSICS — sub-stall (<48kt) or zero-foot staging
      let physics = 0;
      if (have.has("live_flight_detections_rows")) {
        const r = await sql`
          SELECT
            COUNT(*) FILTER (WHERE COALESCE(speed,1000) < 48 AND COALESCE(altitude,1000) < 500)::int AS substall,
            COUNT(*) FILTER (WHERE COALESCE(altitude,9999) <= 0)::int AS zerofoot,
            AVG(altitude)::numeric AS avg_alt
          FROM live_flight_detections_rows
          WHERE UPPER(TRIM(registration)) = ${reg}
        `;
        const substall = Number(r[0]?.substall || 0);
        const zerofoot = Number(r[0]?.zerofoot || 0);
        if (substall > 0) physics += Math.min(W.physics, Math.log10(substall + 1) * (W.physics * 0.6));
        if (zerofoot > 0) physics += Math.min(W.physics * 0.5, Math.log10(zerofoot + 1) * (W.physics * 0.4));
        breakdown.physics = { substall_events: substall, zerofoot_events: zerofoot, avg_altitude_ft: r[0]?.avg_alt };
      }

      // PROXIMITY — events near AOI
      let proximity = 0;
      let avgAlt: number | null = null;
      if (have.has("live_flight_detections_rows")) {
        const r = await sql`
          SELECT COUNT(*)::int AS n, AVG(altitude)::numeric AS avg_alt
          FROM live_flight_detections_rows
          WHERE UPPER(TRIM(registration)) = ${reg}
            AND latitude BETWEEN ${AOI_LAT - AOI_RADIUS_DEG} AND ${AOI_LAT + AOI_RADIUS_DEG}
            AND longitude BETWEEN ${AOI_LNG - AOI_RADIUS_DEG} AND ${AOI_LNG + AOI_RADIUS_DEG}
        `;
        const n = Number(r[0]?.n || 0);
        avgAlt = r[0]?.avg_alt ? Number(r[0].avg_alt) : null;
        if (n > 0) proximity = Math.min(W.proximity, Math.log10(n + 1) * (W.proximity * 0.6));
        breakdown.proximity = { aoi_events: n, avg_altitude_ft: avgAlt };
      }

      // BIOMETRIC — confirmed correlations
      let biometric = 0;
      if (have.has("confirmed_biometric_correlations")) {
        const r = await sql`
          SELECT COUNT(*)::int AS n
          FROM confirmed_biometric_correlations
          WHERE UPPER(TRIM(registration)) = ${reg}
        `;
        const n = Number(r[0]?.n || 0);
        if (n > 0) biometric = Math.min(W.biometric, Math.log10(n + 1) * (W.biometric * 0.7));
        breakdown.biometric = { correlations: n };
      }

      // IDENTITY — multiple icao24 or callsign rotation
      let identity = 0;
      if (have.has("live_flight_detections_rows")) {
        const r = await sql`
          SELECT COUNT(DISTINCT hex)::int AS hex_n, COUNT(DISTINCT callsign)::int AS cs_n
          FROM live_flight_detections_rows
          WHERE UPPER(TRIM(registration)) = ${reg}
        `;
        const hexN = Number(r[0]?.hex_n || 1);
        const csN = Number(r[0]?.cs_n || 1);
        if (hexN > 1) identity += Math.min(W.identity * 0.6, hexN * 3);
        if (csN > 3) identity += Math.min(W.identity * 0.4, (csN - 3) * 2);
        breakdown.identity = { distinct_hex: hexN, distinct_callsign: csN };
      }

      // NETWORK — flagged co-occurrence (KCSO / shell / military profile flags)
      let network = 0;
      if (p.kcso_flag) network += W.network * 0.6;
      if (p.military_flag) network += W.network * 0.4;
      if (p.shell_links && (Array.isArray(p.shell_links) ? p.shell_links.length > 0 : true)) network += W.network * 0.4;
      network = Math.min(W.network, network);
      breakdown.network = {
        kcso: !!p.kcso_flag, military: !!p.military_flag,
        shell_links: p.shell_links || [],
      };

      // REPETITION — total occurrences
      const total = Number(p.occurrences_total || 0);
      const repetition = total > 0 ? Math.min(W.repetition, Math.log10(total + 1) * (W.repetition * 0.4)) : 0;
      breakdown.repetition = { total_occurrences: total };

      const score = Math.round(physics + identity + proximity + biometric + network + repetition);
      const layerScores = { physics, identity, proximity, biometric, network, repetition };
      const lvl = escalation(score);
      const tType = threatType(layerScores, p);

      breakdown.layer_scores = Object.fromEntries(
        Object.entries(layerScores).map(([k, v]) => [k, Math.round(Number(v) * 10) / 10])
      );
      breakdown.total_score = score;
      breakdown.weights = W;
      breakdown.computed_at = new Date().toISOString();

      // Upsert into Supabase sentinel_learned_threats
      const { error: upErr } = await supabase
        .from("sentinel_learned_threats")
        .upsert(
          {
            registration: reg,
            threat_type: tType,
            total_violations: total,
            escalation_level: lvl,
            avg_altitude: avgAlt,
            last_seen: p.last_seen || new Date().toISOString(),
            score_breakdown: breakdown,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "registration" }
        );

      if (!upErr) {
        upserts++;
        summaries.push({ registration: reg, score, level: lvl, type: tType });
      } else {
        console.warn("upsert failed for", reg, upErr.message);
      }
    }

    // Audit summary
    await supabase.from("exhibit_audit_trail").insert({
      action: "RESCORE_THREATS",
      rule_applied: "weighted_6layer_v1",
      records_evaluated: profiles.length,
      records_promoted: upserts,
      result_hash: await sha256(JSON.stringify(summaries.slice(0, 50))),
      metadata: { weights: W, max_rows: maxRows, sample: summaries.slice(0, 20) },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        evaluated: profiles.length,
        upserted: upserts,
        sample: summaries.slice(0, 50),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("threat-rescore-engine error:", err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

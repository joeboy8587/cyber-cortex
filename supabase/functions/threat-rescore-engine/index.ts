import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AOI_LAT = 35.437649;
const AOI_LNG = -119.022639;
const AOI_RADIUS_DEG = 0.05;

const W = { physics: 25, identity: 20, proximity: 20, biometric: 25, network: 20, repetition: 15 };

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
  if (profile?.shell_links && (Array.isArray(profile.shell_links) ? profile.shell_links.length > 0 : true)) return "Shell Network Operator";
  if ((b.physics || 0) > 0) return "Physics Anomaly (sub-stall / 0ft staging)";
  if ((b.identity || 0) > 0) return "Identity Falsification";
  if ((b.biometric || 0) > 0) return "Biometric Causation";
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
  const includeLiveSignals: boolean = body?.includeLiveSignals !== false; // default true but bulk-optimized

  const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20, connect_timeout: 10 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    // 1. Candidate profiles
    const hasProfile = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='canonical_operator_profiles'
    `;
    let profiles: any[] = [];
    if (hasProfile.length) {
      profiles = limitTails
        ? await sql`SELECT * FROM canonical_operator_profiles WHERE registration = ANY(${limitTails})`
        : await sql`SELECT * FROM canonical_operator_profiles ORDER BY occurrences_total DESC LIMIT ${maxRows}`;
    }
    if (!profiles.length) {
      return new Response(JSON.stringify({ ok: false, error: "no profiles found - run operator-profile-builder first" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tails = profiles.map((p) => p.registration);

    // 2. Detect available signal tables
    const tbls = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY(${[
        "live_flight_detections_rows",
        "confirmed_biometric_correlations",
      ]})
    `;
    const have = new Set(tbls.map((r: any) => r.table_name));

    // 3. BULK AGGREGATIONS — one query per signal across all tails
    const flightAgg = new Map<string, any>();
    const aoiAgg = new Map<string, any>();
    const bioAgg = new Map<string, number>();

    if (includeLiveSignals && have.has("live_flight_detections_rows")) {
      const rows = await sql`
        SELECT UPPER(TRIM(registration)) AS reg,
               COUNT(*) FILTER (WHERE COALESCE(speed,1000) < 48 AND COALESCE(altitude,1000) < 500)::int AS substall,
               COUNT(*) FILTER (WHERE COALESCE(altitude,9999) <= 0)::int AS zerofoot,
               AVG(altitude)::numeric AS avg_alt,
               COUNT(DISTINCT icao24)::int AS hex_n,
               COUNT(DISTINCT callsign)::int AS cs_n
        FROM live_flight_detections_rows
        WHERE UPPER(TRIM(registration)) = ANY(${tails})
        GROUP BY 1
      `;
      for (const r of rows) flightAgg.set(r.reg, r);

      const aoiRows = await sql`
        SELECT UPPER(TRIM(registration)) AS reg,
               COUNT(*)::int AS n,
               AVG(altitude)::numeric AS avg_alt
        FROM live_flight_detections_rows
        WHERE UPPER(TRIM(registration)) = ANY(${tails})
          AND latitude BETWEEN ${AOI_LAT - AOI_RADIUS_DEG} AND ${AOI_LAT + AOI_RADIUS_DEG}
          AND longitude BETWEEN ${AOI_LNG - AOI_RADIUS_DEG} AND ${AOI_LNG + AOI_RADIUS_DEG}
        GROUP BY 1
      `;
      for (const r of aoiRows) aoiAgg.set(r.reg, r);
    }

    if (have.has("confirmed_biometric_correlations")) {
      const bio = await sql`
        SELECT UPPER(TRIM(aircraft_registration)) AS reg, COUNT(*)::int AS n
        FROM confirmed_biometric_correlations
        WHERE UPPER(TRIM(aircraft_registration)) = ANY(${tails})
        GROUP BY 1
      `;
      for (const r of bio) bioAgg.set(r.reg, Number(r.n));
    }

    // 4. Score per tail (in-memory now — no per-tail SQL)
    let upserts = 0;
    const summaries: any[] = [];
    const upsertRows: any[] = [];

    for (const p of profiles) {
      const reg = p.registration;
      const f = flightAgg.get(reg);
      const a = aoiAgg.get(reg);
      const bn = bioAgg.get(reg) || 0;
      const breakdown: any = {};

      let physics = 0;
      const substall = Number(f?.substall || 0);
      const zerofoot = Number(f?.zerofoot || 0);
      if (substall > 0) physics += Math.min(W.physics, Math.log10(substall + 1) * (W.physics * 0.6));
      if (zerofoot > 0) physics += Math.min(W.physics * 0.5, Math.log10(zerofoot + 1) * (W.physics * 0.4));
      breakdown.physics = { substall_events: substall, zerofoot_events: zerofoot, avg_altitude_ft: f?.avg_alt };

      const aoiN = Number(a?.n || 0);
      const avgAlt = a?.avg_alt ? Number(a.avg_alt) : (f?.avg_alt ? Number(f.avg_alt) : null);
      const proximity = aoiN > 0 ? Math.min(W.proximity, Math.log10(aoiN + 1) * (W.proximity * 0.6)) : 0;
      breakdown.proximity = { aoi_events: aoiN, avg_altitude_ft: avgAlt };

      const biometric = bn > 0 ? Math.min(W.biometric, Math.log10(bn + 1) * (W.biometric * 0.7)) : 0;
      breakdown.biometric = { correlations: bn };

      let identity = 0;
      const hexN = Number(f?.hex_n || 1);
      const csN = Number(f?.cs_n || 1);
      if (hexN > 1) identity += Math.min(W.identity * 0.6, hexN * 3);
      if (csN > 3) identity += Math.min(W.identity * 0.4, (csN - 3) * 2);
      breakdown.identity = { distinct_hex: hexN, distinct_callsign: csN };

      let network = 0;
      if (p.kcso_flag) network += W.network * 0.6;
      if (p.military_flag) network += W.network * 0.4;
      if (p.shell_links && (Array.isArray(p.shell_links) ? p.shell_links.length > 0 : true)) network += W.network * 0.4;
      network = Math.min(W.network, network);
      breakdown.network = { kcso: !!p.kcso_flag, military: !!p.military_flag, shell_links: p.shell_links || [] };

      const total = Number(p.occurrences_total || 0);
      const repetition = total > 0 ? Math.min(W.repetition, Math.log10(total + 1) * (W.repetition * 0.4)) : 0;
      breakdown.repetition = { total_occurrences: total };

      const layerScores = { physics, identity, proximity, biometric, network, repetition };
      const score = Math.round(physics + identity + proximity + biometric + network + repetition);
      const lvl = escalation(score);
      const tType = threatType(layerScores, p);

      breakdown.layer_scores = Object.fromEntries(
        Object.entries(layerScores).map(([k, v]) => [k, Math.round(Number(v) * 10) / 10])
      );
      breakdown.total_score = score;
      breakdown.weights = W;
      breakdown.computed_at = new Date().toISOString();

      upsertRows.push({
        registration: reg,
        threat_type: tType,
        total_violations: total,
        escalation_level: lvl,
        avg_altitude: avgAlt,
        last_seen: p.last_seen || new Date().toISOString(),
        score_breakdown: breakdown,
        updated_at: new Date().toISOString(),
      });
      summaries.push({ registration: reg, score, level: lvl, type: tType });
    }

    // 5. Bulk upsert in chunks of 100
    for (let i = 0; i < upsertRows.length; i += 100) {
      const chunk = upsertRows.slice(i, i + 100);
      const { error } = await supabase
        .from("sentinel_learned_threats")
        .upsert(chunk, { onConflict: "registration" });
      if (error) {
        console.warn("chunk upsert failed:", error.message);
      } else {
        upserts += chunk.length;
      }
    }

    await supabase.from("exhibit_audit_trail").insert({
      action: "RESCORE_THREATS",
      rule_applied: "weighted_6layer_v2_bulk",
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
        signals_used: Array.from(have),
        sample: summaries.slice(0, 50),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("threat-rescore-engine error:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

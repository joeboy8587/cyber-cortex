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
  // Reframed labels — every threat type ties to an enterprise role + statute,
  // never to "surveillance" or "harassment" of an individual. See doctrine.ts.
  if (profile?.kcso_flag) return "KCSO Civil-Rights Enterprise Actor";
  if (profile?.military_flag) return "Military Coordination (Posse Comitatus § 1385 exposure)";
  if (profile?.shell_links && (Array.isArray(profile.shell_links) ? profile.shell_links.length > 0 : true)) return "Shell Network Operator (RICO predicate)";
  if ((b.physics || 0) > 0) return "Physics Anomaly (sub-stall / 0ft staging)";
  if ((b.identity || 0) > 0) return "Enterprise Identity Falsification (RICO predicate)";
  if ((b.biometric || 0) > 0) return "Biometric Causation (population-scale harm)";
  return "Sustained Enterprise Coordination Pattern";
}

function enterpriseRole(profile: any): string {
  if (profile?.kcso_flag) return "tier1_government_actor";
  if (profile?.military_flag) return "tier3_military_coordination";
  if (profile?.shell_links && (Array.isArray(profile.shell_links) ? profile.shell_links.length > 0 : true)) return "tier2_shell_proxy";
  return "tier4_swarm_participant";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON_DATABASE_URL) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const BUDGET_MS = 100_000;
  const budget = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error("BUDGET_EXCEEDED")), Math.max(2000, BUDGET_MS - (Date.now() - startedAt)))
      ),
    ]);

  const body = await req.json().catch(() => ({}));
  const limitTails: string[] | null = Array.isArray(body?.registrations) && body.registrations.length
    ? body.registrations.map((s: string) => String(s).toUpperCase())
    : null;
  // Sharded by default: small batches that always finish inside the platform limit.
  const maxRows: number = Math.min(Number(body?.maxRows) || 100, 500);
  const offset: number = Math.max(0, Number(body?.offset) || 0);
  // Aggregates are bounded to this window so they ride the detection_timestamp index.
  const lookbackDays: number = Math.min(Math.max(Number(body?.lookbackDays) || 90, 1), 365);
  // Default ON — physics/proximity/identity are the whole point of the engine. Disable only for huge sweeps.
  const includeLiveSignals: boolean = body?.includeLiveSignals !== false;
  const autoFlag: boolean = body?.autoFlag !== false; // auto-create watchtower flags for emerging high-score tails

  const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20, connect_timeout: 10 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    await sql.unsafe(`SET statement_timeout = '85000'`).catch(() => {});

    // 1. Candidate profiles
    const hasProfile = await sql`
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='canonical_operator_profiles'
    `;
    let profiles: any[] = [];
    let totalProfiles = 0;
    if (hasProfile.length) {
      if (limitTails) {
        profiles = await sql`SELECT * FROM canonical_operator_profiles WHERE registration = ANY(${limitTails})`;
        totalProfiles = profiles.length;
      } else {
        const [cnt] = await sql`SELECT COUNT(*)::int AS n FROM canonical_operator_profiles`;
        totalProfiles = Number(cnt?.n || 0);
        profiles = await sql`
          SELECT * FROM canonical_operator_profiles
          ORDER BY occurrences_total DESC
          LIMIT ${maxRows} OFFSET ${offset}
        `;
      }
    }
    if (!profiles.length) {
      return new Response(JSON.stringify({
        ok: true, evaluated: 0, upserted: 0, offset, total_profiles: totalProfiles,
        done: true, note: offset > 0 ? "no more profiles at this offset" : "no profiles found - run operator-profile-builder first",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // 3. BULK AGGREGATIONS — one query per signal across all tails, time-bounded
    const flightAgg = new Map<string, any>();
    const aoiAgg = new Map<string, any>();
    const bioAgg = new Map<string, number>();
    const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString();

    if (includeLiveSignals && have.has("live_flight_detections_rows")) {
      const rows = await budget(sql`
        SELECT UPPER(registration) AS reg,
               COUNT(*) FILTER (WHERE COALESCE(speed,1000) < 48 AND COALESCE(altitude,1000) < 500)::int AS substall,
               COUNT(*) FILTER (WHERE COALESCE(altitude,9999) <= 0)::int AS zerofoot,
               AVG(altitude)::numeric AS avg_alt,
               COUNT(DISTINCT icao24)::int AS hex_n,
               COUNT(DISTINCT callsign)::int AS cs_n
        FROM live_flight_detections_rows
        WHERE registration = ANY(${tails})
          AND detection_timestamp > ${since}
        GROUP BY UPPER(registration)
      `);
      for (const r of rows) flightAgg.set(r.reg, r);

      const aoiRows = await budget(sql`
        SELECT UPPER(registration) AS reg,
               COUNT(*)::int AS n,
               AVG(altitude)::numeric AS avg_alt
        FROM live_flight_detections_rows
        WHERE registration = ANY(${tails})
          AND detection_timestamp > ${since}
          AND latitude BETWEEN ${AOI_LAT - AOI_RADIUS_DEG} AND ${AOI_LAT + AOI_RADIUS_DEG}
          AND longitude BETWEEN ${AOI_LNG - AOI_RADIUS_DEG} AND ${AOI_LNG + AOI_RADIUS_DEG}
        GROUP BY UPPER(registration)
      `);
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
      breakdown.enterprise_role = enterpriseRole(p);
      breakdown.framing = "population_scale_rico_enterprise";

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

    // 5. Bulk upsert in chunks of 100 — conflict target MUST match unique constraint (registration, threat_type)
    for (let i = 0; i < upsertRows.length; i += 100) {
      const chunk = upsertRows.slice(i, i + 100);
      const { error } = await supabase
        .from("sentinel_learned_threats")
        .upsert(chunk, { onConflict: "registration,threat_type" });
      if (error) {
        console.warn("chunk upsert failed:", error.message);
      } else {
        upserts += chunk.length;
      }
    }

    // 5b. AUTO-LEARNING: surface emerging high-score tails into watchtower_autonomous_flags
    let flagsCreated = 0;
    if (autoFlag) {
      const emerging = summaries.filter((s) => s.level >= 4); // L4+ = ≥60 score
      if (emerging.length) {
        const flagRows = emerging.map((s) => ({
          flag_type: "EVOLVED_THREAT_PATTERN",
          severity: s.level >= 5 ? "critical" : "high",
          registration: s.registration,
          description: `Sentinel learned: ${s.type} (score ${s.score}, L${s.level}) emerged from 6-layer rescore. Auto-promoted from operator profile evidence.`,
          confidence_score: Math.min(0.99, s.score / 100),
          evidence_summary: { score: s.score, level: s.level, type: s.type },
          source_scan_id: `rescore-${Date.now()}`,
          auto_resolved: false,
        }));
        for (let i = 0; i < flagRows.length; i += 50) {
          const { error } = await supabase
            .from("watchtower_autonomous_flags")
            .insert(flagRows.slice(i, i + 50));
          if (!error) flagsCreated += Math.min(50, flagRows.length - i);
        }
      }
    }

    // 5c. WIRE: invoke Josiah Confidence Engine for the same tails (per-detection meta-cognition + auto-flag)
    let confidence: any = null;
    if (autoFlag) {
      try {
        const { data: cdata } = await supabase.functions.invoke("josiah-confidence-engine", {
          body: { action: "score", registrations: tails, limit: 500, autoFlag: true },
        });
        confidence = cdata
          ? { evaluated: cdata.evaluated, persisted: cdata.persisted, flags_created: cdata.flags_created, tier_counts: cdata.tier_counts, weights_version: cdata.weights_version }
          : null;
      } catch (e) { console.warn("confidence-engine wire failed:", (e as any)?.message); }
    }

    await supabase.from("exhibit_audit_trail").insert({
      action: "RESCORE_THREATS",
      rule_applied: "weighted_6layer_v3_learning+josiah_confidence",
      records_evaluated: profiles.length,
      records_promoted: upserts,
      result_hash: await sha256(JSON.stringify(summaries.slice(0, 50))),
      metadata: { weights: W, max_rows: maxRows, flags_created: flagsCreated, confidence, sample: summaries.slice(0, 20) },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        evaluated: profiles.length,
        upserted: upserts,
        flags_created: flagsCreated,
        confidence,
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

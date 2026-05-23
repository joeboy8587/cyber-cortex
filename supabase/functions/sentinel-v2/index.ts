// Sentinel Report v2.1 — FAR-cited violations + multimodal justification engine
// Each violation now carries a `justification` block surfacing:
//   • 90-day pattern (avg/min altitude, zero-alt events, night ops, total detections)
//   • Network tier (KCSO / Shell / Medical-cover / Commercial)
//   • Coordination partners (tails seen within ±15min in last 90d)
//   • Shell / registrant linkage from aircraft_registry
//   • Learned threat status (sentinel_learned_threats)
//   • Autonomous flags (watchtower_autonomous_flags)
// This kills the "altitude-only" attack: every flag explains the multimodal reasoning.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Primary AOI = user's residence (Oildale). Updated per user request 2026-05-23.
const AOI = { lat: 35.4377286, lng: -119.0252189 };

const SHELL_KEYWORDS = ["ALF IX", "9K AIR", "BEST EQUIPMENT", "BEST AVIATION", "LBBO", "RESIDCO", "EPIC JET", "MEADOWS"];
const MEDICAL_COVER_KEYWORDS = ["AIR METHODS", "MERCY AIR", "REACH", "GUARDIAN", "HALO FLIGHT"];
const CONTRACTOR_KEYWORDS = ["XP SERVICES", "TRON", "STMPD", "KNIFE", "CONGO", "RCH"];

function classifyTier(reg: string, registrant: string | null, kcsoMatch: boolean): { tier: number; label: string; reason: string } {
  if (kcsoMatch) return { tier: 0, label: "TIER 0 — KCSO Fleet", reason: "Matched against kcso_fleet registry" };
  const r = (registrant || "").toUpperCase();
  if (SHELL_KEYWORDS.some(k => r.includes(k))) return { tier: 1, label: "TIER 1 — Shell Entity", reason: `Registrant: ${registrant}` };
  if (MEDICAL_COVER_KEYWORDS.some(k => r.includes(k))) return { tier: 2, label: "TIER 2 — Medical Cover", reason: `Registrant: ${registrant}` };
  if (CONTRACTOR_KEYWORDS.some(k => r.includes(k))) return { tier: 2, label: "TIER 2 — DOD Contractor", reason: `Registrant: ${registrant}` };
  return { tier: 9, label: "UNCLASSIFIED — Commercial/Unknown", reason: registrant ? `Registrant: ${registrant}` : "No registrant on file" };
}

function cite(a: any, alt: number, spd: number, dist_m: number): { far: string; airspace: string; action: string; severity: string; reason: string } | null {
  const cls = a?.class_label || null;
  const type = a?.airspace_type || null;
  const lo = a?.lower_val_ft;
  const up = a?.upper_val_ft;
  const name = a?.name || "unknown";

  if (spd > 0 && spd < 48 && alt > 300) {
    return { far: "14 CFR § 91.9 / § 91.13 (sub-stall physics)", airspace: `${cls || type} — ${name}`,
      action: "File FAA Hotline complaint citing impossible-physics signature (drone or spoof).",
      severity: "critical", reason: `${spd.toFixed(0)}kts at ${alt.toFixed(0)}ft — below Cessna 172 stall (48kts).` };
  }
  if (spd > 250 && spd < 600 && alt < 10000) {
    return { far: "14 CFR § 91.117(a) — max 250 KIAS below 10,000 ft MSL", airspace: `${cls || type} — ${name}`,
      action: "Add to FAA safety report; cross-reference flight plan for waiver.",
      severity: spd > 320 ? "high" : "medium", reason: `${spd.toFixed(0)} KIAS at ${alt.toFixed(0)}ft MSL.` };
  }
  if (type === "SUA" && cls === "R" && alt >= (lo ?? 0) && (up == null || alt <= up)) {
    return { far: "14 CFR § 73.83 / § 91.133 — restricted area without authorization", airspace: `RESTRICTED — ${name}`,
      action: "FOIA controlling agency for coordination records.", severity: "critical",
      reason: `Inside restricted area at ${alt.toFixed(0)}ft.` };
  }
  if (type === "SUA" && cls === "MOA" && alt >= (lo ?? 0) && (up == null || alt <= up)) {
    return { far: "14 CFR § 91.13 (careless ops in active MOA)", airspace: `MOA — ${name}`,
      action: "Pull MOA schedule; if active, refer to controlling agency.", severity: "high",
      reason: `Inside Military Operations Area at ${alt.toFixed(0)}ft.` };
  }
  if (cls === "B" && alt >= (lo ?? 0) && alt <= (up ?? 10000)) {
    return { far: "14 CFR § 91.131(a)(1) — ATC clearance required for Class B", airspace: `CLASS B — ${name}`,
      action: "Request ATC tapes; verify clearance issuance.", severity: "high",
      reason: `Class B intrusion at ${alt.toFixed(0)}ft.` };
  }
  if (cls === "C" && alt >= (lo ?? 0) && alt <= (up ?? 5000)) {
    return { far: "14 CFR § 91.130(c)(1) — two-way radio required Class C", airspace: `CLASS C — ${name}`,
      action: "Request approach control tapes.", severity: "high",
      reason: `Class C surface area at ${alt.toFixed(0)}ft.` };
  }
  if (cls === "D" && alt >= 0 && alt <= (up ?? 3000)) {
    return { far: "14 CFR § 91.129(c)(1) & (i) — two-way radio required Class D", airspace: `CLASS D — ${name}`,
      action: "FOIA tower voice tapes and radar track.", severity: alt < 500 ? "critical" : "high",
      reason: `Inside Class D surface area at ${alt.toFixed(0)}ft.` };
  }
  if (alt > 0 && alt < 500) {
    return { far: "14 CFR § 91.119(c) — 500 ft AGL minimum", airspace: `OUTSIDE CONTROLLED — ${name}`,
      action: "Add to residential harassment pattern exhibit.", severity: "high",
      reason: `${alt.toFixed(0)}ft AGL violates 500 ft floor.` };
  }
  if (alt > 0 && alt < 1000 && dist_m < 2000) {
    return { far: "14 CFR § 91.119(b) — 1000 ft over congested area", airspace: `RESIDENTIAL AOI — ${name}`,
      action: "Add to RICO harassment exhibit; FOIA KCSO tasking.", severity: "high",
      reason: `${alt.toFixed(0)}ft over residence inside 2000 ft horizontal.` };
  }
  return null;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let sql: any = null;
  const startedAt = new Date().toISOString();
  const scanId = `sentinel-v2-${Date.now()}`;

  try {
    const body = await req.json().catch(() => ({}));
    const lookbackHours = Math.min(720, Math.max(1, Number(body.lookback_hours) || 24));
    const radiusM = Number(body.radius_m) || 15000;
    const limit = Math.min(5000, Number(body.limit) || 1500);

    const neonUrl = Deno.env.get("NEON_DATABASE_URL");
    if (!neonUrl) throw new Error("NEON_DATABASE_URL not configured");
    sql = postgres(neonUrl, { ssl: "require", max: 3, idle_timeout: 20, connect_timeout: 10 });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // === Step 1: Detections + airspace ===
    const padDeg = (radiusM / 111_000) * 1.3;
    const rows = await sql`
      WITH d AS (
        SELECT registration, callsign, icao24,
          altitude::numeric AS altitude, speed::numeric AS speed,
          latitude::numeric AS latitude, longitude::numeric AS longitude,
          detection_timestamp
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - (${lookbackHours} || ' hours')::interval
          AND latitude BETWEEN ${AOI.lat - padDeg} AND ${AOI.lat + padDeg}
          AND longitude BETWEEN ${AOI.lng - padDeg / Math.cos(AOI.lat * Math.PI / 180)}
                            AND ${AOI.lng + padDeg / Math.cos(AOI.lat * Math.PI / 180)}
          AND registration IS NOT NULL AND registration <> ''
          AND altitude IS NOT NULL
        ORDER BY detection_timestamp DESC
        LIMIT ${limit}
      )
      SELECT d.*,
        a.name AS as_name, a.class_label AS as_class, a.airspace_type AS as_type,
        a.lower_val_ft AS as_floor, a.upper_val_ft AS as_ceiling
      FROM d
      LEFT JOIN LATERAL (
        SELECT name, class_label, airspace_type, lower_val_ft, upper_val_ft
        FROM faa_airspace
        WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(d.longitude::float8, d.latitude::float8), 4326))
          AND (lower_val_ft IS NULL OR d.altitude >= lower_val_ft)
          AND (upper_val_ft IS NULL OR upper_val_ft < 0 OR d.altitude <= upper_val_ft)
        ORDER BY COALESCE(upper_val_ft, 99999) - COALESCE(lower_val_ft, 0) ASC
        LIMIT 1
      ) a ON true
    `;

    // === Step 2: Apply FAR citation to identify violations ===
    const draft: any[] = [];
    for (const d of rows) {
      const lat = Number(d.latitude), lng = Number(d.longitude);
      const alt = Number(d.altitude), spd = Number(d.speed) || 0;
      const R = 6_371_000, toRad = (x: number) => x * Math.PI / 180;
      const dLat = toRad(lat - AOI.lat), dLng = toRad(lng - AOI.lng);
      const ha = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(AOI.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
      const dist_m = 2 * R * Math.asin(Math.sqrt(ha));
      const a = d.as_name
        ? { name: d.as_name, class_label: d.as_class, airspace_type: d.as_type, lower_val_ft: d.as_floor, upper_val_ft: d.as_ceiling }
        : { name: "uncontrolled", class_label: "G", airspace_type: "CLASS", lower_val_ft: 0, upper_val_ft: 1200 };
      const c = cite(a, alt, spd, dist_m);
      if (!c) continue;
      draft.push({ d, lat, lng, alt, spd, dist_m, a, c });
    }

    // === Step 3: Batch enrichment per unique tail ===
    const uniqueTails = Array.from(new Set(draft.map(v => String(v.d.registration).toUpperCase())));
    const enrichment = new Map<string, any>();

    if (uniqueTails.length > 0) {
      // 3a. 90-day pattern from Neon (avg/min/zero-alt/night ops)
      const patternRows = await sql`
        SELECT UPPER(registration) AS reg,
          COUNT(*)::int AS total_90d,
          ROUND(AVG(altitude::numeric), 0)::int AS avg_alt,
          MIN(altitude::numeric)::int AS min_alt,
          MAX(altitude::numeric)::int AS max_alt,
          COUNT(*) FILTER (WHERE altitude::numeric < 50)::int AS zero_alt_events,
          COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 22
                            OR EXTRACT(HOUR FROM detection_timestamp) < 6)::int AS night_ops,
          COUNT(DISTINCT callsign)::int AS distinct_callsigns
        FROM live_flight_detections_rows
        WHERE UPPER(registration) = ANY(${uniqueTails})
          AND detection_timestamp > NOW() - INTERVAL '90 days'
        GROUP BY UPPER(registration)
      `;
      const patternMap = new Map(patternRows.map((r: any) => [r.reg, r]));

      // 3b. Coordination partners — tails seen within ±15min of any flagged event on this tail
      const coordRows = await sql`
        WITH targets AS (
          SELECT UPPER(registration) AS reg, detection_timestamp AS ts
          FROM live_flight_detections_rows
          WHERE UPPER(registration) = ANY(${uniqueTails})
            AND detection_timestamp > NOW() - INTERVAL '90 days'
            AND latitude BETWEEN ${AOI.lat - padDeg} AND ${AOI.lat + padDeg}
            AND longitude BETWEEN ${AOI.lng - padDeg / Math.cos(AOI.lat * Math.PI / 180)}
                              AND ${AOI.lng + padDeg / Math.cos(AOI.lat * Math.PI / 180)}
        ),
        pairs AS (
          SELECT t.reg AS target, UPPER(o.registration) AS partner, COUNT(*)::int AS co_events
          FROM targets t
          JOIN live_flight_detections_rows o
            ON o.detection_timestamp BETWEEN t.ts - INTERVAL '15 minutes' AND t.ts + INTERVAL '15 minutes'
           AND UPPER(o.registration) <> t.reg
           AND o.registration IS NOT NULL
           AND o.latitude BETWEEN ${AOI.lat - padDeg} AND ${AOI.lat + padDeg}
           AND o.longitude BETWEEN ${AOI.lng - padDeg / Math.cos(AOI.lat * Math.PI / 180)}
                               AND ${AOI.lng + padDeg / Math.cos(AOI.lat * Math.PI / 180)}
          GROUP BY t.reg, UPPER(o.registration)
        )
        SELECT target, partner, co_events
        FROM pairs
        WHERE co_events >= 2
        ORDER BY target, co_events DESC
      `;
      const coordMap = new Map<string, Array<{ partner: string; co_events: number }>>();
      for (const r of coordRows) {
        const arr = coordMap.get(r.target) || [];
        if (arr.length < 5) arr.push({ partner: r.partner, co_events: r.co_events });
        coordMap.set(r.target, arr);
      }

      // 3c. Supabase enrichment (parallel)
      const [kcsoRes, regRes, learnedRes, flagsRes] = await Promise.all([
        sb.from("kcso_fleet").select("tail_number").in("tail_number", uniqueTails),
        sb.from("aircraft_registry").select("n_number,registrant_name,aircraft_model,year_manufactured")
          .in("n_number", uniqueTails.map(t => t.replace(/^N/, ""))),
        sb.from("sentinel_learned_threats").select("registration,threat_type,escalation_level,total_violations,ai_threat_profile")
          .in("registration", uniqueTails),
        sb.from("watchtower_autonomous_flags").select("registration,flag_type,severity,confidence_score,description")
          .in("registration", uniqueTails).order("created_at", { ascending: false }),
      ]);

      const kcsoSet = new Set((kcsoRes.data || []).map((r: any) => String(r.tail_number).toUpperCase()));
      const regMap = new Map((regRes.data || []).map((r: any) => [`N${r.n_number}`.toUpperCase(), r]));
      const learnedMap = new Map((learnedRes.data || []).map((r: any) => [String(r.registration).toUpperCase(), r]));
      const flagsMap = new Map<string, any[]>();
      for (const f of flagsRes.data || []) {
        const k = String(f.registration).toUpperCase();
        const arr = flagsMap.get(k) || [];
        if (arr.length < 3) arr.push(f);
        flagsMap.set(k, arr);
      }

      for (const reg of uniqueTails) {
        const pat: any = patternMap.get(reg) || {};
        const registry = regMap.get(reg) as any;
        const tier = classifyTier(reg, registry?.registrant_name || null, kcsoSet.has(reg));
        const coord = coordMap.get(reg) || [];
        const learned = learnedMap.get(reg) as any;
        const flags = flagsMap.get(reg) || [];
        enrichment.set(reg, { pattern: pat, registry, tier, coord, learned, flags });
      }
    }

    // === Step 4: Compose violations with justification block ===
    const violations: any[] = [];
    for (const v of draft) {
      const reg = String(v.d.registration).toUpperCase();
      const e = enrichment.get(reg) || {};
      const pat = e.pattern || {};
      const coord = e.coord || [];
      const tier = e.tier || { tier: 9, label: "UNCLASSIFIED", reason: "" };
      const learned = e.learned;
      const flags = e.flags || [];
      const registry = e.registry;

      const networkSignals: string[] = [];
      if (tier.tier <= 2) networkSignals.push(tier.label);
      if (pat.zero_alt_events > 0) networkSignals.push(`${pat.zero_alt_events} zero-alt events in 90d`);
      if (pat.night_ops > 5) networkSignals.push(`${pat.night_ops} night operations`);
      if (coord.length > 0) networkSignals.push(`${coord.length} coordination partner(s)`);
      if (learned) networkSignals.push(`Learned threat: ${learned.threat_type} (esc ${learned.escalation_level})`);
      if (flags.length > 0) networkSignals.push(`${flags.length} prior autonomous flag(s)`);

      const isPatternDriven = networkSignals.length >= 2 || tier.tier <= 2 || !!learned;
      const primaryLabel = isPatternDriven
        ? "PATTERN ANOMALY — Network Context"
        : v.c.far.split("—")[0].trim();

      const justification = {
        primary_label: primaryLabel,
        flag_driver: isPatternDriven ? "multimodal_network" : "far_citation_only",
        network: {
          tier: tier.tier,
          tier_label: tier.label,
          tier_reason: tier.reason,
          registrant: registry?.registrant_name || null,
          aircraft_model: registry?.aircraft_model || null,
        },
        pattern_90d: {
          total_detections: pat.total_90d || 0,
          avg_altitude_ft: pat.avg_alt ?? null,
          min_altitude_ft: pat.min_alt ?? null,
          max_altitude_ft: pat.max_alt ?? null,
          zero_alt_events: pat.zero_alt_events || 0,
          night_operations: pat.night_ops || 0,
          distinct_callsigns: pat.distinct_callsigns || 0,
        },
        coordination_partners: coord,
        learned_threat: learned ? {
          threat_type: learned.threat_type,
          escalation_level: learned.escalation_level,
          total_violations: learned.total_violations,
          profile: learned.ai_threat_profile,
        } : null,
        prior_flags: flags.map((f: any) => ({ type: f.flag_type, severity: f.severity, description: f.description })),
        assessment: isPatternDriven
          ? `Current altitude alone is ${v.alt < 500 ? "below floor" : "within normal band"}; flag driven by ${networkSignals.join(" + ")}.`
          : `Standalone FAR violation; no prior network signals on this tail in last 90 days.`,
      };

      const rowJson = JSON.stringify({
        reg, ts: v.d.detection_timestamp, lat: v.lat, lng: v.lng, alt: v.alt, spd: v.spd,
        far: v.c.far, airspace: v.c.airspace, action: v.c.action,
        tier: tier.tier, pattern_total: pat.total_90d || 0, coord_count: coord.length,
      });
      violations.push({
        registration: v.d.registration,
        callsign: v.d.callsign,
        icao24: v.d.icao24,
        detection_timestamp: v.d.detection_timestamp,
        latitude: v.lat, longitude: v.lng,
        altitude_ft: v.alt, speed_kts: v.spd,
        distance_to_aoi_ft: Math.round(v.dist_m * 3.28084),
        far_cited: v.c.far,
        airspace_class: v.a.class_label,
        airspace_name: v.a.name,
        airspace_floor_ft: v.a.lower_val_ft,
        airspace_ceiling_ft: v.a.upper_val_ft,
        geofence_breach: v.a.class_label !== "G" && v.a.class_label !== "E",
        severity: v.c.severity,
        reason: v.c.reason,
        recommended_action: v.c.action,
        primary_label: primaryLabel,
        justification,
        row_sha256: await sha256(rowJson),
      });
    }

    const batchJson = JSON.stringify(violations.map(v => v.row_sha256).sort());
    const batchSha = await sha256(batchJson);
    const severityCounts = violations.reduce((acc: any, v) => { acc[v.severity] = (acc[v.severity] || 0) + 1; return acc; }, {});
    const tierCounts = violations.reduce((acc: any, v) => {
      const k = `tier_${v.justification.network.tier}`; acc[k] = (acc[k] || 0) + 1; return acc;
    }, {});
    const driverCounts = violations.reduce((acc: any, v) => {
      acc[v.justification.flag_driver] = (acc[v.justification.flag_driver] || 0) + 1; return acc;
    }, {});

    return new Response(JSON.stringify({
      success: true,
      summary: {
        scan_id: scanId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        aoi: AOI, radius_m: radiusM, lookback_hours: lookbackHours,
        detections_evaluated: rows.length,
        violations_found: violations.length,
        severity_breakdown: severityCounts,
        tier_breakdown: tierCounts,
        driver_breakdown: driverCounts,
        batch_sha256: batchSha,
      },
      violations,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("sentinel-v2 error", err);
    return new Response(JSON.stringify({ success: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    if (sql) try { await sql.end(); } catch {}
  }
});

// FAA Rules + Geofence Engine
// Joins Neon detections with FAA registry data, evaluates 14 CFR Part 91 violations,
// performs AOI geofence analysis around the user's residence, and writes flags to
// public.watchtower_autonomous_flags for surfacing in Sentinel / Alerts dashboards.
//
// Version: 1.0.0  |  Author: Watchtower
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---- AOI: user residence (Oildale) ----
const AOI = { lat: 35.437649, lng: -119.022639 };
const AOI_RADIUS_M = 2500;       // primary analytic radius (~1.5 mi)
const AOI_CRITICAL_M = 1000;     // critical proximity (~0.6 mi)

// ---- FAA Part 91 thresholds ----
const FAA = {
  // 14 CFR § 91.119(b) — congested area: 1000 ft above highest obstacle / 2000 ft horiz
  MIN_ALT_CONGESTED_FT: 1000,
  // 14 CFR § 91.119(c) — non-congested: 500 ft AGL
  MIN_ALT_NONCONGESTED_FT: 500,
  // 14 CFR § 91.117(a) — 250 KIAS max below 10,000 ft MSL
  MAX_SPEED_BELOW_10K_KTS: 250,
  // Stall speed proxy — anything <48kts at >300ft is drone or spoof
  STALL_SPEED_KTS: 48,
  STALL_ALT_FLOOR_FT: 300,
  // Loiter: same registration appearing 6+ times within AOI in 30 min
  LOITER_MIN_DETECTIONS: 6,
  LOITER_WINDOW_MIN: 30,
};

const LOOKBACK_HOURS_DEFAULT = 24;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = new Date().toISOString();
  const scanId = `faa-geo-${Date.now()}`;
  let sql: any = null;

  try {
    const body = await req.json().catch(() => ({}));
    const lookbackHours = Math.min(168, Math.max(1, Number(body.lookback_hours) || LOOKBACK_HOURS_DEFAULT));
    const dryRun = Boolean(body.dry_run);

    const neonUrl = Deno.env.get("NEON_DATABASE_URL");
    if (!neonUrl) throw new Error("NEON_DATABASE_URL not configured");
    sql = postgres(neonUrl, { ssl: "require", max: 3, idle_timeout: 20, connect_timeout: 10 });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- 1. Pull AOI detections (haversine bounding box prefilter for speed) ----
    // Rough degree → meters: 1 deg lat ~ 111_320m. Pad bounding box.
    const padDeg = (AOI_RADIUS_M / 111_000) * 1.2;
    const minLat = AOI.lat - padDeg;
    const maxLat = AOI.lat + padDeg;
    const minLng = AOI.lng - padDeg / Math.cos((AOI.lat * Math.PI) / 180);
    const maxLng = AOI.lng + padDeg / Math.cos((AOI.lat * Math.PI) / 180);

    const detections = await sql`
      SELECT
        registration, callsign, icao24,
        altitude::numeric AS altitude,
        speed::numeric AS speed,
        latitude::numeric AS latitude,
        longitude::numeric AS longitude,
        detection_timestamp
      FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - (${lookbackHours} || ' hours')::interval
        AND latitude BETWEEN ${minLat} AND ${maxLat}
        AND longitude BETWEEN ${minLng} AND ${maxLng}
        AND registration IS NOT NULL
        AND registration <> ''
      LIMIT 20000
    `;

    // Haversine filter to true radius
    const inAOI = detections.filter((d: any) => {
      const dist = haversineM(AOI.lat, AOI.lng, Number(d.latitude), Number(d.longitude));
      (d as any)._dist_m = dist;
      return dist <= AOI_RADIUS_M;
    });

    // ---- 2. Enrich with FAA registry (Neon) ----
    const regs = Array.from(new Set(inAOI.map((d: any) => String(d.registration).toUpperCase())));
    let registry: Record<string, any> = {};
    if (regs.length) {
      try {
        const rows = await sql`
          SELECT n_number, registrant_name, aircraft_manufacturer, aircraft_model,
                 registrant_state, registrant_country, mode_s_hex
          FROM aircraft_registry
          WHERE UPPER(n_number) = ANY(${regs})
        `;
        for (const r of rows) registry[String(r.n_number).toUpperCase()] = r;
      } catch (_e) {
        // registry may not exist yet — soft fail
      }
    }

    // ---- 3. Evaluate rules ----
    const flags: any[] = [];
    const byReg = new Map<string, any[]>();
    for (const d of inAOI) {
      const k = String(d.registration).toUpperCase();
      if (!byReg.has(k)) byReg.set(k, []);
      byReg.get(k)!.push(d);
    }

    for (const [reg, hits] of byReg.entries()) {
      const meta = registry[reg];
      const opName = meta?.registrant_name || null;
      const acType = [meta?.aircraft_manufacturer, meta?.aircraft_model].filter(Boolean).join(" ") || null;

      // sort chronologically
      hits.sort((a, b) => new Date(a.detection_timestamp).getTime() - new Date(b.detection_timestamp).getTime());

      const minAlt = Math.min(...hits.map(h => Number(h.altitude) || Infinity).filter(Number.isFinite));
      const maxSpd = Math.max(...hits.map(h => Number(h.speed) || 0));
      const closest = hits.reduce((m, h) => h._dist_m < m._dist_m ? h : m, hits[0]);

      // Rule A: § 91.119 minimum safe altitude (treat Oildale residential as congested)
      const violatingAltHits = hits.filter(h => {
        const a = Number(h.altitude);
        return Number.isFinite(a) && a > 0 && a < FAA.MIN_ALT_CONGESTED_FT;
      });
      if (violatingAltHits.length >= 1) {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "FAA_91119_MIN_ALTITUDE",
          severity: minAlt < FAA.MIN_ALT_NONCONGESTED_FT ? "critical" : "high",
          confidence: minAlt < 200 ? 95 : minAlt < 500 ? 88 : 78,
          description:
            `${reg}${opName ? ` (${opName})` : ""} violated 14 CFR § 91.119 — ${violatingAltHits.length} detections below ${FAA.MIN_ALT_CONGESTED_FT}ft over residential AOI (min ${Math.round(minAlt)}ft, ${Math.round(closest._dist_m)}m from residence).`,
          evidence: {
            statute: "14 CFR § 91.119(b)",
            min_altitude_ft: Math.round(minAlt),
            below_500ft_count: hits.filter(h => Number(h.altitude) > 0 && Number(h.altitude) < 500).length,
            below_1000ft_count: violatingAltHits.length,
            closest_distance_m: Math.round(closest._dist_m),
            sample_timestamps: violatingAltHits.slice(0, 5).map((h: any) => h.detection_timestamp),
          },
        }));
      }

      // Rule B: § 91.117 max 250kts below 10,000ft
      const speeders = hits.filter(h => {
        const a = Number(h.altitude), s = Number(h.speed);
        return Number.isFinite(a) && Number.isFinite(s) && a < 10000 && s > FAA.MAX_SPEED_BELOW_10K_KTS && s < 600;
      });
      if (speeders.length >= 2) {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "FAA_91117_OVERSPEED",
          severity: maxSpd > 320 ? "high" : "medium",
          confidence: 70,
          description: `${reg} exceeded 250 KIAS below 10,000ft (max ${Math.round(maxSpd)}kts) — ${speeders.length} samples in AOI.`,
          evidence: {
            statute: "14 CFR § 91.117(a)",
            max_speed_kts: Math.round(maxSpd),
            overspeed_samples: speeders.length,
          },
        }));
      }

      // Rule C: Sub-stall physics (drone / spoof proof)
      const subStall = hits.filter(h => {
        const a = Number(h.altitude), s = Number(h.speed);
        return Number.isFinite(a) && Number.isFinite(s) && s > 0 && s < FAA.STALL_SPEED_KTS && a > FAA.STALL_ALT_FLOOR_FT;
      });
      if (subStall.length >= 1) {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "PHYSICS_SUB_STALL",
          severity: "critical",
          confidence: 90,
          description: `${reg} reported ${subStall.length} samples below Cessna 172 stall speed (<48kts) while airborne (>300ft) in AOI — drone or transponder spoof.`,
          evidence: {
            statute: "Physics / FAA spoof signature",
            sub_stall_samples: subStall.length,
            min_speed_kts: Math.min(...subStall.map(h => Number(h.speed))),
          },
        }));
      }

      // Rule D: Geofence loiter inside AOI
      const window = FAA.LOITER_WINDOW_MIN * 60_000;
      let loiterMax = 0;
      for (let i = 0; i < hits.length; i++) {
        const t0 = new Date(hits[i].detection_timestamp).getTime();
        let count = 0;
        for (let j = i; j < hits.length; j++) {
          if (new Date(hits[j].detection_timestamp).getTime() - t0 <= window) count++;
          else break;
        }
        loiterMax = Math.max(loiterMax, count);
      }
      if (loiterMax >= FAA.LOITER_MIN_DETECTIONS) {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "GEOFENCE_LOITER",
          severity: loiterMax >= 12 ? "high" : "medium",
          confidence: Math.min(92, 60 + loiterMax * 2),
          description: `${reg} loitered ${loiterMax}× within ${FAA.LOITER_WINDOW_MIN}-min window inside residential AOI (${Math.round(closest._dist_m)}m closest).`,
          evidence: {
            loiter_max_count: loiterMax,
            window_minutes: FAA.LOITER_WINDOW_MIN,
            closest_distance_m: Math.round(closest._dist_m),
          },
        }));
      }

      // Rule E: Critical proximity — any hit inside AOI_CRITICAL_M at low alt
      const critical = hits.filter(h => h._dist_m <= AOI_CRITICAL_M && Number(h.altitude) > 0 && Number(h.altitude) < 1500);
      if (critical.length >= 1) {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "GEOFENCE_CRITICAL_PROXIMITY",
          severity: "critical",
          confidence: 92,
          description: `${reg} entered critical proximity ring (${AOI_CRITICAL_M}m) of residence at low altitude — ${critical.length} samples.`,
          evidence: {
            critical_samples: critical.length,
            min_alt_ft: Math.round(Math.min(...critical.map(h => Number(h.altitude)))),
            closest_m: Math.round(Math.min(...critical.map(h => h._dist_m))),
          },
        }));
      }

      // Rule F: Foreign / out-of-state registrant in AOI
      if (meta && meta.registrant_country && String(meta.registrant_country).toUpperCase() !== "US") {
        flags.push(makeFlag({
          scanId, registration: reg, opName, acType,
          flag_type: "FOREIGN_REGISTRANT_AOI",
          severity: "high",
          confidence: 85,
          description: `${reg} registered to foreign entity (${meta.registrant_country}${opName ? ` — ${opName}` : ""}) detected over residential AOI.`,
          evidence: { country: meta.registrant_country, registrant: opName },
        }));
      }
    }

    // ---- 4. Persist to Supabase ----
    let inserted = 0;
    if (!dryRun && flags.length) {
      // de-duplicate against existing flags from this scan_id by (registration, flag_type)
      const { data } = await supabase
        .from("watchtower_autonomous_flags")
        .insert(flags)
        .select("id");
      inserted = data?.length || 0;
    }

    const summary = {
      scan_id: scanId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      lookback_hours: lookbackHours,
      aoi: { ...AOI, radius_m: AOI_RADIUS_M, critical_m: AOI_CRITICAL_M },
      detections_in_aoi: inAOI.length,
      unique_aircraft: byReg.size,
      registry_matches: Object.keys(registry).length,
      flags_generated: flags.length,
      flags_inserted: inserted,
      severity_breakdown: countBy(flags, "severity"),
      rule_breakdown: countBy(flags, "flag_type"),
      dry_run: dryRun,
    };

    return new Response(
      JSON.stringify({ success: true, summary, flags: flags.slice(0, 50) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("faa-rules-geofence error", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    if (sql) try { await sql.end(); } catch (_e) {}
  }
});

function makeFlag(p: {
  scanId: string; registration: string; opName: string | null; acType: string | null;
  flag_type: string; severity: string; confidence: number; description: string; evidence: any;
}) {
  return {
    flag_type: p.flag_type,
    severity: p.severity,
    registration: p.registration,
    description: p.description,
    confidence_score: p.confidence,
    source_scan_id: p.scanId,
    evidence_summary: {
      ...p.evidence,
      operator: p.opName,
      aircraft_type: p.acType,
      aoi_centered: true,
      generated_by: "faa-rules-geofence v1.0.0",
    },
    cross_references: [],
    learning_context: { engine: "faa-rules-geofence", aoi: AOI },
  };
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function countBy<T extends Record<string, any>>(arr: T[], key: string): Record<string, number> {
  return arr.reduce((acc: any, x) => { acc[x[key]] = (acc[x[key]] || 0) + 1; return acc; }, {});
}

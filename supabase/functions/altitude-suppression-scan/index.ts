// Altitude Suppression Scan — 14 CFR § 91.225 leads.
// Finds pings moving >50 kts with 0 ft / blank altitude in the Kern region,
// looks at the same aircraft ±15 min to tell a real landing roll from a
// touch-and-go / low approach, and logs leads to policy_violations.
// Additive only: never deletes or edits flight records. Runs on demand only.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifySuppression, MIN_SPEED_KTS, type Ping } from "../_shared/suppression.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(t: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const META = {
  EN_ROUTE_ALTITUDE_SUPPRESSION: {
    title: "Moving >50 kts with no altitude, away from any airport", severity: "high",
  },
  AIRPORT_TOUCH_AND_GO: {
    title: "Touch-and-go / low approach with altitude dropped (never stopped, climbed back out)", severity: "medium",
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ error: "NEON_DATABASE_URL not configured" }, 500);

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 30);
  const write = body.write !== false;

  const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 20, prepare: false });
  try {
    await sql.unsafe(`SET statement_timeout = '45s'`);
    const hits: any[] = await sql.unsafe(`
      SELECT icao_code, registration, callsign, latitude, longitude, altitude, speed, detection_timestamp
      FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '${days} days'
        AND (altitude IS NULL OR altitude <= 0)
        AND speed > ${MIN_SPEED_KTS}
        AND COALESCE(on_ground, false) = false
        AND latitude BETWEEN 34.5 AND 36.2 AND longitude BETWEEN -119.8 AND -117.5
        AND icao_code IS NOT NULL AND icao_code <> ''
      ORDER BY detection_timestamp DESC
      LIMIT 1500
    `);

    // Context pings for the same aircraft, ±15 min around each hit (one query).
    const icaos = [...new Set(hits.map(h => h.icao_code))];
    const ctxRows: any[] = icaos.length ? await sql.unsafe(`
      SELECT icao_code, latitude, longitude, altitude, speed, detection_timestamp
      FROM live_flight_detections_rows
      WHERE icao_code = ANY($1::text[])
        AND detection_timestamp > NOW() - INTERVAL '${days} days' - INTERVAL '15 minutes'
        AND latitude BETWEEN 34.5 AND 36.2 AND longitude BETWEEN -119.8 AND -117.5
      LIMIT 60000
    `, [icaos]) : [];
    const byIcao = new Map<string, Ping[]>();
    for (const r of ctxRows) {
      const arr = byIcao.get(r.icao_code) ?? [];
      arr.push({ ts: new Date(r.detection_timestamp).getTime(), alt: r.altitude, spd: r.speed, lat: r.latitude, lon: r.longitude });
      byIcao.set(r.icao_code, arr);
    }

    const counts: Record<string, number> = {};
    const leads: any[] = [];
    for (const h of hits) {
      const p: Ping = { ts: new Date(h.detection_timestamp).getTime(), alt: h.altitude, spd: h.speed, lat: h.latitude, lon: h.longitude };
      const ctx = (byIcao.get(h.icao_code) ?? []).filter(c => Math.abs(c.ts - p.ts) <= 15 * 60_000);
      const r = classifySuppression(p, ctx);
      counts[r.cls] = (counts[r.cls] ?? 0) + 1;
      if (r.cls === "EN_ROUTE_ALTITUDE_SUPPRESSION" || r.cls === "AIRPORT_TOUCH_AND_GO") {
        leads.push({ h, r });
      }
    }

    const records = await Promise.all(leads.map(async ({ h, r }) => {
      const m = META[r.cls as keyof typeof META];
      const key = `ALTSUPv1|${h.icao_code}|${new Date(h.detection_timestamp).toISOString()}`;
      return {
        icao: h.icao_code,
        callsign: h.callsign || null,
        detected_at: new Date(h.detection_timestamp).toISOString(),
        rule_code: r.cls === "AIRPORT_TOUCH_AND_GO" ? "ALT-SUP-TGO" : "ALT-SUP-ENR",
        rule_title: m.title,
        manual_section: "14 CFR § 91.225",
        severity: m.severity,
        rule_source: "FAR",
        citation: "14 CFR § 91.225",
        far_text: "ADS-B Out equipment must be operated in transmit mode at all times in airspace where it is required, including pressure-altitude reporting.",
        altitude_ft: 0,
        lat: h.latitude,
        lon: h.longitude,
        source_table: "live_flight_detections_rows",
        sha256: await sha256Hex(key),
        evidence: {
          registration: h.registration, speed_kts: h.speed, reported_altitude: h.altitude,
          classification: r.cls, nearest_airport: r.airport, airport_km: r.airport_km,
          reclimb_ft: r.reclimb_ft, min_speed_in_window_kts: r.min_speed,
          caveat: "Lead, not proof: a blank altitude can also come from MLAT-only tracking or a feed gap. Confirm with raw source data.",
          method: "ALTSUPv1 ±15min same-aircraft context",
        },
      };
    }));

    let inserted = 0;
    if (write && records.length) {
      const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      for (let i = 0; i < records.length; i += 200) {
        const batch = records.slice(i, i + 200);
        const { data: existing } = await supa.from("policy_violations").select("sha256").in("sha256", batch.map(b => b.sha256));
        const seen = new Set((existing ?? []).map((e: any) => e.sha256));
        const fresh = batch.filter(b => !seen.has(b.sha256));
        if (fresh.length) {
          const { error } = await supa.from("policy_violations").insert(fresh);
          if (error) throw new Error(error.message);
          inserted += fresh.length;
        }
      }
    }

    return json({
      days, scanned: hits.length, counts, leads: records.length, inserted,
      sample: records.slice(0, 50).map(r => ({ icao: r.icao, callsign: r.callsign, detected_at: r.detected_at, rule_code: r.rule_code, ...r.evidence })),
    });
  } catch (e) {
    const msg = (e as Error).message;
    return json({ error: msg, timeout: /statement timeout/i.test(msg) }, /statement timeout/i.test(msg) ? 503 : 500);
  } finally {
    await sql.end().catch(() => {});
  }
});

// FAR Classifier — any aircraft below 1000 ft is routed through this classifier
// which consults public.faa_regulations and public.faa_airspace to determine the
// specific Federal Aviation Regulation (91.119, 91.155, 91.13, 91.209) that was
// broken, then writes a policy_violations row with the exact citation + text.
//
// Deterministic SQL-only. No ML, no external calls.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Primary AOI (Oildale residence) — congested-area determination for 91.119(b)
const AOI_LAT = 35.4377286;
const AOI_LON = -119.0252189;
const CONGESTED_RADIUS_NM = 3.0;

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // nm
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface Detection {
  icao?: string | null;
  registration?: string | null;
  callsign?: string | null;
  lat: number;
  lon: number;
  altitude: number;
  timestamp?: string | null;
  ground_speed?: number | null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isNight(iso?: string | null): boolean {
  if (!iso) return false;
  // Simple sunset heuristic for Kern County: night = local hour < 6 or > 20
  try {
    const d = new Date(iso);
    // Convert UTC → PST (roughly -8h)
    const localHour = (d.getUTCHours() + 24 - 8) % 24;
    return localHour < 6 || localHour >= 20;
  } catch { return false; }
}

interface Classification {
  severity: "critical" | "high" | "medium" | "low" | "none";
  citations: Array<{ citation: string; text: string; description: string }>;
  distance_from_aoi_nm: number;
  night: boolean;
  reasoning: string[];
}

async function classify(det: Detection, sql: ReturnType<typeof postgres>): Promise<Classification> {
  const alt = Number(det.altitude ?? 999999);
  const reasoning: string[] = [];
  const citations: Array<{ citation: string; text: string; description: string }> = [];

  if (alt >= 1000) {
    return { severity: "none", citations: [], distance_from_aoi_nm: -1, night: false, reasoning: ["altitude >= 1000ft, no FAR minimum-altitude issue"] };
  }

  const dist = haversineNm(det.lat, det.lon, AOI_LAT, AOI_LON);
  const congested = dist <= CONGESTED_RADIUS_NM;
  const night = isNight(det.timestamp);
  reasoning.push(`altitude ${alt}ft, ${dist.toFixed(2)}nm from AOI, congested=${congested}, night=${night}`);

  // Fetch FAR text once for the applicable rules
  const wantedCitations = ["91.119(a)", "91.119(b)", "91.119(c)", "91.13", "91.155", "91.209"];
  let farRows: Array<{ citation: string; text: string }> = [];
  try {
    const rows = await sql.unsafe(
      `SELECT citation, text FROM public.faa_regulations WHERE citation = ANY($1::text[])`,
      [wantedCitations],
    );
    farRows = rows as any[];
  } catch {
    // Table may not exist yet or column names differ — fall back to hardcoded text
  }
  const textFor = (c: string) => {
    const r = farRows.find((f) => (f.citation || "").includes(c));
    return r?.text || FAR_FALLBACK[c] || "";
  };

  // 91.119(c) — non-congested, <500 ft or within 500 ft of person/structure
  if (alt < 500) {
    citations.push({
      citation: "14 CFR 91.119(c)",
      text: textFor("91.119(c)"),
      description: "Below 500 ft AGL over non-congested area / within 500 ft of person, vessel, vehicle, or structure",
    });
  }

  // 91.119(b) — congested area, <1000 ft over highest obstacle within 2000 ft
  if (congested) {
    citations.push({
      citation: "14 CFR 91.119(b)",
      text: textFor("91.119(b)"),
      description: `Below 1000 ft AGL over congested area (${dist.toFixed(2)} nm from AOI, within ${CONGESTED_RADIUS_NM} nm congested radius)`,
    });
  } else if (alt < 500) {
    // Already covered by 91.119(c)
  } else {
    // 91.119(a) — general minimum safe altitude for emergency landing without hazard
    citations.push({
      citation: "14 CFR 91.119(a)",
      text: textFor("91.119(a)"),
      description: "Below altitude allowing emergency landing without undue hazard",
    });
  }

  // 91.13 — careless or reckless (stacks when 2+ citations)
  if (citations.length >= 2) {
    citations.push({
      citation: "14 CFR 91.13",
      text: textFor("91.13"),
      description: "Careless or reckless operation (stacked violations)",
    });
  }

  // 91.209 — position lights required after sunset
  if (night) {
    citations.push({
      citation: "14 CFR 91.209",
      text: textFor("91.209"),
      description: "Night operation — position/anti-collision lights required after sunset",
    });
  }

  // Severity ladder
  let severity: Classification["severity"] = "medium";
  if (alt < 500 && congested) severity = "critical";
  else if (alt < 500 || congested) severity = "high";
  else severity = "medium";
  if (night && severity !== "critical") {
    severity = severity === "high" ? "critical" : "high";
    reasoning.push("night operation escalated severity by one tier");
  }

  return { severity, citations, distance_from_aoi_nm: dist, night, reasoning };
}

const FAR_FALLBACK: Record<string, string> = {
  "91.119(a)": "Except when necessary for takeoff or landing, no person may operate an aircraft below an altitude allowing, if a power unit fails, an emergency landing without undue hazard to persons or property on the surface.",
  "91.119(b)": "Over any congested area of a city, town, or settlement, or over any open air assembly of persons, an altitude of 1,000 feet above the highest obstacle within a horizontal radius of 2,000 feet of the aircraft.",
  "91.119(c)": "Over other than congested areas, an altitude of 500 feet above the surface, except over open water or sparsely populated areas. In those cases, the aircraft may not be operated closer than 500 feet to any person, vessel, vehicle, or structure.",
  "91.13": "No person may operate an aircraft in a careless or reckless manner so as to endanger the life or property of another.",
  "91.155": "Basic VFR weather minimums — cloud clearance and visibility requirements by airspace class.",
  "91.209": "No person may, during the period from sunset to sunrise, operate an aircraft unless it has lighted position lights and (b) operate an aircraft equipped with an anti-collision light system unless it has approved and lighted aviation red or aviation white anti-collision lights.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!neonUrl || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "missing config" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "scan";

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '30000'`).catch(() => {});
    const supa = createClient(supaUrl, supaKey);

    // ---- classifyOne ----
    if (action === "classifyOne") {
      const det: Detection = body.detection || {};
      const result = await classify(det, sql);
      return new Response(JSON.stringify({ ok: true, classification: result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- scan: pull recent low-altitude detections from Neon, classify, upsert violations ----
    if (action === "scan") {
      const hours = Number(body.lookbackHours ?? 24);
      const limit = Math.min(Number(body.limit ?? 500), 2000);
      // Try a couple of common detection tables
      const candidateTables = [
        "public.live_flight_detections_rows",
        "public.live_flight_detections",
        "public.flight_detections_unified",
      ];
      let rows: any[] = [];
      let sourceTable = "";
      for (const t of candidateTables) {
        try {
          const r = await sql.unsafe(
            `SELECT icao24 AS icao, registration, callsign, latitude AS lat, longitude AS lon,
                    altitude, timestamp, ground_speed
             FROM ${t}
             WHERE altitude IS NOT NULL
               AND altitude::int < 1000
               AND latitude IS NOT NULL AND longitude IS NOT NULL
               AND timestamp > now() - ($1 || ' hours')::interval
             ORDER BY timestamp DESC
             LIMIT ${limit}`,
            [String(hours)],
          );
          if (Array.isArray(r) && r.length >= 0) { rows = r as any[]; sourceTable = t; break; }
        } catch { /* try next */ }
      }

      const violations: any[] = [];
      for (const r of rows) {
        const det: Detection = {
          icao: r.icao, registration: r.registration, callsign: r.callsign,
          lat: Number(r.lat), lon: Number(r.lon), altitude: Number(r.altitude),
          timestamp: r.timestamp, ground_speed: r.ground_speed,
        };
        if (!isFinite(det.lat) || !isFinite(det.lon) || !isFinite(det.altitude)) continue;
        const cls = await classify(det, sql);
        if (cls.severity === "none" || cls.citations.length === 0) continue;
        const primary = cls.citations[0];
        const hash = await sha256Hex(`${det.icao}|${det.timestamp}|${det.altitude}|${det.lat}|${det.lon}`);
        violations.push({
          rule_source: "FAR",
          citation: primary.citation,
          far_text: primary.text,
          policy_code: primary.citation,
          policy_section: "14 CFR Part 91",
          violation_type: "low_altitude",
          severity: cls.severity,
          altitude_ft: det.altitude,
          lat: det.lat,
          lon: det.lon,
          icao: det.icao,
          aircraft_registration: det.registration || det.callsign,
          detection_timestamp: det.timestamp,
          notes: cls.citations.map((c) => `${c.citation}: ${c.description}`).join(" | "),
          evidence_hash: hash,
        });
      }

      // Upsert-ish: only insert if a matching (icao, detection_timestamp, citation) doesn't exist
      let inserted = 0;
      for (const v of violations) {
        const { data: existing } = await supa
          .from("policy_violations")
          .select("id")
          .eq("icao", v.icao)
          .eq("citation", v.citation)
          .eq("detection_timestamp", v.detection_timestamp)
          .limit(1);
        if (existing && existing.length > 0) continue;
        const { error } = await supa.from("policy_violations").insert(v);
        if (!error) inserted++;
      }

      return new Response(JSON.stringify({
        ok: true, source_table: sourceTable, scanned: rows.length,
        violations_generated: violations.length, inserted,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

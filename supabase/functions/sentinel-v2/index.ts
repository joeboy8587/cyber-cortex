// Sentinel Report v2 — FAA airspace + FAR-cited violation engine
// Joins live_flight_detections_rows to faa_airspace (PostGIS) and emits
// rows with: FAR_cited, airspace_class, airspace_name, geo_fence_breach,
// distance_to_airport_ft, recommended_action, sha256(row), sha256(batch).
//
// Output is consumed by the Sentinel v2 PDF/UI panel. Read-only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AOI = { lat: 35.437649, lng: -119.022639 };

// FAR citation engine — input: airspace row + telemetry → output: {far, action, severity}
function cite(a: any, alt: number, spd: number, dist_m: number): { far: string; airspace: string; action: string; severity: string; reason: string } | null {
  const cls = a?.class_label || null;
  const type = a?.airspace_type || null;
  const lo = a?.lower_val_ft;
  const up = a?.upper_val_ft;
  const name = a?.name || "unknown";

  // Sub-stall physics — independent of airspace, always cited
  if (spd > 0 && spd < 48 && alt > 300) {
    return {
      far: "14 CFR § 91.9 / § 91.13 (careless operation; aircraft below published stall speed)",
      airspace: `${cls || type} — ${name}`,
      action: "File FAA Hotline complaint citing impossible-physics signature (drone or spoof).",
      severity: "critical",
      reason: `Reported ${spd.toFixed(0)}kts at ${alt.toFixed(0)}ft — below Cessna 172 stall (48kts). Manned aircraft cannot sustain flight here.`,
    };
  }

  // Speed > 250 KIAS below 10,000 MSL
  if (spd > 250 && spd < 600 && alt < 10000) {
    return {
      far: "14 CFR § 91.117(a) — max 250 KIAS below 10,000 ft MSL",
      airspace: `${cls || type} — ${name}`,
      action: "Add to FAA safety report; cross-reference flight plan for waiver.",
      severity: spd > 320 ? "high" : "medium",
      reason: `${spd.toFixed(0)} KIAS at ${alt.toFixed(0)}ft MSL exceeds 250 KIAS limit.`,
    };
  }

  // Restricted area (R-xxxx)
  if (type === "SUA" && cls === "R" && alt >= (lo ?? 0) && (up == null || alt <= up)) {
    return {
      far: "14 CFR § 73.83 / § 91.133 — operation in restricted area without authorization",
      airspace: `RESTRICTED — ${name} (${lo ?? "SFC"}–${up ?? "UNL"} ft)`,
      action: "FOIA controlling agency for coordination records; refer to FAA Flight Standards.",
      severity: "critical",
      reason: `Inside restricted area at ${alt.toFixed(0)}ft (R-area floor ${lo ?? 0}, ceiling ${up ?? "UNL"}).`,
    };
  }

  // MOA
  if (type === "SUA" && cls === "MOA" && alt >= (lo ?? 0) && (up == null || alt <= up)) {
    return {
      far: "14 CFR § 91.13 (careless ops in active MOA) / FAA JO 7110.65 coord required",
      airspace: `MOA — ${name} (${lo ?? "SFC"}–${up ?? "UNL"} ft)`,
      action: "Pull MOA schedule; if active, refer to controlling agency.",
      severity: "high",
      reason: `Inside Military Operations Area at ${alt.toFixed(0)}ft.`,
    };
  }

  // Class B — clearance required
  if (cls === "B" && alt >= (lo ?? 0) && alt <= (up ?? 10000)) {
    return {
      far: "14 CFR § 91.131(a)(1) — ATC clearance required to enter Class B",
      airspace: `CLASS B — ${name} (${lo ?? "SFC"}–${up ?? 10000} ft)`,
      action: "Request ATC tapes; verify clearance issuance for tail.",
      severity: "high",
      reason: `Class B intrusion at ${alt.toFixed(0)}ft.`,
    };
  }

  // Class C — two-way comms + Mode C required
  if (cls === "C" && alt >= (lo ?? 0) && alt <= (up ?? 5000)) {
    return {
      far: "14 CFR § 91.130(c)(1) — two-way radio communications required prior to entry",
      airspace: `CLASS C — ${name} (${lo ?? "SFC"}–${up ?? 5000} ft)`,
      action: "Request approach control tapes; verify radio contact established.",
      severity: "high",
      reason: `Class C surface area at ${alt.toFixed(0)}ft (floor ${lo ?? "SFC"} MSL).`,
    };
  }

  // Class D — two-way comms required
  if (cls === "D" && alt >= 0 && alt <= (up ?? 3000)) {
    return {
      far: "14 CFR § 91.129(c)(1) & (i) — two-way radio comms required in Class D surface area",
      airspace: `CLASS D — ${name} (SFC–${up ?? 3000} ft)`,
      action: "FOIA KBFL tower voice tapes and radar track for the timestamp window.",
      severity: alt < 500 ? "critical" : "high",
      reason: `Inside Class D surface area at ${alt.toFixed(0)}ft. Tower clearance required.`,
    };
  }

  // § 91.119 minimum safe altitudes (no airspace polygon — generic)
  if (alt > 0 && alt < 500) {
    return {
      far: "14 CFR § 91.119(c) — minimum 500 ft AGL over non-congested areas",
      airspace: `OUTSIDE CONTROLLED — ${name}`,
      action: "Add to residential harassment pattern exhibit.",
      severity: "high",
      reason: `${alt.toFixed(0)}ft AGL violates 500 ft floor.`,
    };
  }
  if (alt > 0 && alt < 1000 && dist_m < 2000) {
    return {
      far: "14 CFR § 91.119(b) — 1000 ft above highest obstacle within 2000 ft over congested area",
      airspace: `RESIDENTIAL AOI — ${name}`,
      action: "Add to RICO harassment exhibit; FOIA KCSO tasking.",
      severity: "high",
      reason: `${alt.toFixed(0)}ft over residential area inside 2000 ft horizontal of residence.`,
    };
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
    const radiusM = Number(body.radius_m) || 8000; // wider than v1 to catch Class C/D intrusions
    const limit = Math.min(5000, Number(body.limit) || 1000);

    const neonUrl = Deno.env.get("NEON_DATABASE_URL");
    if (!neonUrl) throw new Error("NEON_DATABASE_URL not configured");
    sql = postgres(neonUrl, { ssl: "require", max: 3, idle_timeout: 20, connect_timeout: 10 });

    // 1+2. Detections + smallest containing airspace polygon in ONE PostGIS LATERAL join.
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

    const violations: any[] = [];
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

      const rowJson = JSON.stringify({
        reg: d.registration, ts: d.detection_timestamp, lat, lng, alt, spd,
        far: c.far, airspace: c.airspace, action: c.action,
      });
      violations.push({
        registration: d.registration,
        callsign: d.callsign,
        icao24: d.icao24,
        detection_timestamp: d.detection_timestamp,
        latitude: lat, longitude: lng,
        altitude_ft: alt, speed_kts: spd,
        distance_to_aoi_ft: Math.round(dist_m * 3.28084),
        far_cited: c.far,
        airspace_class: a.class_label,
        airspace_name: a.name,
        airspace_floor_ft: a.lower_val_ft,
        airspace_ceiling_ft: a.upper_val_ft,
        geofence_breach: a.class_label !== "G" && a.class_label !== "E",
        severity: c.severity,
        reason: c.reason,
        recommended_action: c.action,
        row_sha256: await sha256(rowJson),
      });
    }
    const detectionsEvaluated = rows.length;

    const batchJson = JSON.stringify(violations.map(v => v.row_sha256).sort());
    const batchSha = await sha256(batchJson);

    const severityCounts = violations.reduce((acc: any, v) => { acc[v.severity] = (acc[v.severity] || 0) + 1; return acc; }, {});
    const farCounts = violations.reduce((acc: any, v) => { acc[v.far_cited] = (acc[v.far_cited] || 0) + 1; return acc; }, {});

    return new Response(JSON.stringify({
      success: true,
      summary: {
        scan_id: scanId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        aoi: AOI, radius_m: radiusM, lookback_hours: lookbackHours,
        detections_evaluated: detections.length,
        violations_found: violations.length,
        severity_breakdown: severityCounts,
        far_breakdown: farCounts,
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

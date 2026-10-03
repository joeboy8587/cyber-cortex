// Behavior Fingerprint: classifies each aircraft's track by HOW it flies, not WHERE it is.
// Distinguishes airport-consistent behavior (landing, departure, transit) from
// orbit / hover / loiter patterns. Statistics are deterministic; NVIDIA NIM narrates.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { nimChat, hasNim } from "../_shared/nim.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AOI = { lat: 35.4377286, lon: -119.0252189 };
// Meadows Field (KBFL) — the airport legit traffic would be using
const KBFL = { lat: 35.4336, lon: -119.0567 };
const BOX_NM = 12; // analysis radius around AOI
const NM_DEG = 1 / 60;
const SESSION_GAP_MIN = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function distNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dy = (aLat - bLat) * 60;
  const dx = (aLon - bLon) * 60 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}
function headingDelta(a: number, b: number) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

interface Ping { t: number; lat: number; lon: number; alt: number | null; spd: number | null; hdg: number | null; }
interface Session {
  key: string; id: string; callsign: string | null;
  start: string; end: string; duration_min: number; pings: number;
  behavior: string; airport_consistent: boolean;
  cum_turn_deg: number; bbox_radius_nm: number; alt_change_ft: number | null;
  avg_speed_kts: number | null; min_dist_kbfl_nm: number; min_dist_aoi_nm: number;
  max_alt: number | null; min_alt: number | null;
}

function classify(pings: Ping[]): Omit<Session, "key" | "id" | "callsign" | "start" | "end"> {
  const n = pings.length;
  const durMin = (pings[n - 1].t - pings[0].t) / 60000;
  const alts = pings.map((p) => p.alt).filter((a): a is number => a != null);
  const spds = pings.map((p) => p.spd).filter((s): s is number => s != null);
  const avgSpd = spds.length ? spds.reduce((a, b) => a + b, 0) / spds.length : null;
  const maxAlt = alts.length ? Math.max(...alts) : null;
  const minAlt = alts.length ? Math.min(...alts) : null;
  const altChange = alts.length >= 2 ? alts[alts.length - 1] - alts[0] : null;

  // cumulative turn
  let cumTurn = 0;
  for (let i = 1; i < n; i++) {
    if (pings[i].hdg != null && pings[i - 1].hdg != null) cumTurn += headingDelta(pings[i - 1].hdg!, pings[i].hdg!);
  }
  // bounding box radius from centroid
  const cLat = pings.reduce((a, p) => a + p.lat, 0) / n;
  const cLon = pings.reduce((a, p) => a + p.lon, 0) / n;
  let bboxR = 0;
  for (const p of pings) bboxR = Math.max(bboxR, distNm(p.lat, p.lon, cLat, cLon));
  // distances
  let minKbfl = Infinity, minAoi = Infinity;
  for (const p of pings) {
    minKbfl = Math.min(minKbfl, distNm(p.lat, p.lon, KBFL.lat, KBFL.lon));
    minAoi = Math.min(minAoi, distNm(p.lat, p.lon, AOI.lat, AOI.lon));
  }

  const absTurn = Math.abs(cumTurn);
  let behavior = "TRANSIT";
  if (avgSpd != null && avgSpd < 15 && durMin >= 3 && (maxAlt ?? 9999) < 1500) {
    behavior = "HOVER";
  } else if (absTurn >= 270 && bboxR <= 2 && durMin >= 3) {
    behavior = "ORBIT";
  } else if (durMin >= 15 && bboxR <= 3 && absTurn < 270) {
    behavior = "LOITER";
  } else if (altChange != null && altChange < -400 && minKbfl <= 4) {
    behavior = "LANDING";
  } else if (altChange != null && altChange > 400 && minKbfl <= 4) {
    behavior = "DEPARTURE";
  }

  const airportConsistent =
    behavior === "LANDING" || behavior === "DEPARTURE" ||
    (behavior === "TRANSIT" && (minAlt ?? 0) > 1500);

  return {
    duration_min: +durMin.toFixed(1), pings: n, behavior, airport_consistent: airportConsistent,
    cum_turn_deg: Math.round(cumTurn), bbox_radius_nm: +bboxR.toFixed(2),
    alt_change_ft: altChange != null ? Math.round(altChange) : null,
    avg_speed_kts: avgSpd != null ? Math.round(avgSpd) : null,
    min_dist_kbfl_nm: +minKbfl.toFixed(2), min_dist_aoi_nm: +minAoi.toFixed(2),
    max_alt: maxAlt, min_alt: minAlt,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let days = 7;
  let narrate = true;
  try {
    const body = await req.json().catch(() => ({}));
    const d = Number(body?.days);
    if (Number.isFinite(d)) days = Math.min(30, Math.max(1, Math.round(d)));
    if (body?.narrate === false) narrate = false;
  } catch { /* defaults */ }

  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) return json({ error: "Flight database not configured" }, 500);
  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 10, idle_timeout: 10 });
  const skipped: string[] = [];

  try {
    await sql`SET statement_timeout = '30s'`;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const r = BOX_NM * NM_DEG;

    const rows = await sql`
      SELECT COALESCE(NULLIF(UPPER(registration),''), NULLIF(UPPER(callsign),''), NULLIF(UPPER(icao24),'')) AS ident,
             UPPER(callsign) AS callsign,
             detection_timestamp AS ts, latitude, longitude, altitude, speed, heading
      FROM live_flight_detections_rows
      WHERE detection_timestamp > ${since}
        AND latitude BETWEEN ${AOI.lat - r} AND ${AOI.lat + r}
        AND longitude BETWEEN ${AOI.lon - r * 1.22} AND ${AOI.lon + r * 1.22}
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND altitude IS NOT NULL AND altitude > 0 AND altitude < 8000
      ORDER BY ident, detection_timestamp
      LIMIT 60000`;

    // group into per-aircraft sessions (gap > 20 min = new session)
    const byIdent = new Map<string, { callsign: string | null; pings: Ping[] }>();
    for (const row of rows) {
      const id = String(row.ident);
      if (!byIdent.has(id)) byIdent.set(id, { callsign: row.callsign ?? null, pings: [] });
      byIdent.get(id)!.pings.push({
        t: new Date(row.ts).getTime(), lat: Number(row.latitude), lon: Number(row.longitude),
        alt: row.altitude != null ? Number(row.altitude) : null,
        spd: row.speed != null ? Number(row.speed) : null,
        hdg: row.heading != null ? Number(row.heading) : null,
      });
    }

    const debugSample = rows[0]
      ? { lat: rows[0].latitude, lon: rows[0].longitude, latType: typeof rows[0].latitude, lonType: typeof rows[0].longitude, altType: typeof rows[0].altitude }
      : null;

    const sessions: Session[] = [];
    for (const [id, { callsign, pings }] of byIdent) {
      let start = 0;
      for (let i = 1; i <= pings.length; i++) {
        const gap = i < pings.length ? (pings[i].t - pings[i - 1].t) / 60000 : Infinity;
        if (gap > SESSION_GAP_MIN) {
          const seg = pings.slice(start, i);
          start = i;
          if (seg.length < 4) continue;
          const c = classify(seg);
          sessions.push({
            key: `${id}_${seg[0].t}`, id, callsign,
            start: new Date(seg[0].t).toISOString(), end: new Date(seg[seg.length - 1].t).toISOString(),
            ...c,
          });
        }
      }
    }

    const counts: Record<string, number> = {};
    for (const s of sessions) counts[s.behavior] = (counts[s.behavior] ?? 0) + 1;
    const anomalous = sessions
      .filter((s) => !s.airport_consistent)
      .sort((a, b) => a.min_dist_aoi_nm - b.min_dist_aoi_nm)
      .slice(0, 50);
    const normal = sessions.filter((s) => s.airport_consistent).length;

    const stats = {
      window_days: days, generated_at: new Date().toISOString(),
      box_nm: BOX_NM, total_detections: rows.length,
      aircraft_seen: byIdent.size, sessions: sessions.length,
      behavior_counts: counts,
      airport_consistent_sessions: normal,
      anomalous_sessions: sessions.length - normal,
      anomalous: anomalous,
      debug_sample: debugSample,
      skipped,
    };
    const hash = await sha256(JSON.stringify(stats));

    let narrative = "";
    const provider = hasNim() ? "nvidia-nim" : "lovable-gateway";
    if (narrate) {
      try {
        const res = await nimChat({
          stream: false, temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a forensic aviation analyst. Using ONLY the JSON provided, write a plain-language brief (max 300 words) for a non-technical reader explaining: 1) what share of nearby air traffic behaves like normal airport traffic (landing/departure/transit) vs orbit/hover/loiter, 2) the most notable anomalous sessions (tail, behavior, how close to the residence, how long), 3) limitations — you MUST note that behavior near an airport approach path can legitimately include circling (go-arounds, training patterns at Meadows Field), that orbit/hover alone is not proof of surveillance, and that receiver coverage gaps can break tracks into short sessions. Never invent numbers. Do not use words like targeting or stalking.",
            },
            { role: "user", content: JSON.stringify({ ...stats, anomalous: anomalous.slice(0, 15) }) },
          ],
        });
        if (res.ok) {
          const j = await res.json();
          narrative = j?.choices?.[0]?.message?.content ?? "";
        } else skipped.push(`narrative_${res.status}`);
      } catch { skipped.push("narrative"); }
    }

    return json({ stats, sha256: hash, narrative, provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), skipped }, 500);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
});

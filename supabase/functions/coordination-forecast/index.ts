// Coordination Forecast: periodicity + military→local handoff lags + control-sector comparison.
// Statistics are computed deterministically in Neon; NVIDIA NIM only writes the narrative.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { nimChat, hasNim } from "../_shared/nim.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NM_DEG = 1 / 60; // 1 NM ≈ 1/60 deg latitude
const RADIUS_NM = 1.5;
const LOW_ALT_FT = 2000;

const SECTORS = [
  { key: "AOI", name: "Primary AOI (Oildale)", lat: 35.4377286, lon: -119.0252189, control: false },
  { key: "A", name: "Control A — Shafter", lat: 35.5005, lon: -119.2718, control: true },
  { key: "B", name: "Control B — Rosedale", lat: 35.3836, lon: -119.1457, control: true },
  { key: "C", name: "Control C — Lamont", lat: 35.2597, lon: -118.9143, control: true },
  { key: "D", name: "Control D — Arvin", lat: 35.2091, lon: -118.8284, control: true },
];

const MILITARY_PREFIXES = ["STMPD", "KNIFE", "TRON", "RCH", "REACH", "CONGO", "PAT", "SPAR", "BOLT", "TOPCAT", "VV", "CNV"];
const LOCAL_TAILS = ["N912KC", "N913KC", "N911KC", "N597E", "N788FA", "N787FA"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let days = 30;
  let narrate = true;
  try {
    const body = await req.json().catch(() => ({}));
    const d = Number(body?.days);
    if (Number.isFinite(d)) days = Math.min(180, Math.max(7, Math.round(d)));
    if (body?.narrate === false) narrate = false;
  } catch { /* defaults */ }

  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) return json({ error: "Flight database not configured" }, 500);
  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 10, idle_timeout: 10 });
  const skipped: string[] = [];
  const r = RADIUS_NM * NM_DEG;

  try {
    await sql`SET statement_timeout = '25s'`;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // 1. Control-sector comparison (low-altitude contacts within 1.5 NM box of each sector)
    const sectorStats: any[] = [];
    let totalWindow: number | null = null;
    try {
      const est = await sql`SELECT COUNT(*)::bigint AS n FROM live_flight_detections_rows WHERE detection_timestamp > ${since}`;
      totalWindow = Number(est[0]?.n ?? 0);
    } catch { skipped.push("total_window_count"); }

    for (const s of SECTORS) {
      try {
        const rows = await sql`
          SELECT COUNT(*)::int AS low_alt_pings,
                 COUNT(DISTINCT COALESCE(NULLIF(registration,''), NULLIF(callsign,'')))::int AS unique_aircraft,
                 COUNT(DISTINCT date_trunc('hour', detection_timestamp))::int AS active_hours,
                 COUNT(*) FILTER (WHERE COALESCE(speed,999) < 48)::int AS sub_stall_pings
          FROM live_flight_detections_rows
          WHERE detection_timestamp > ${since}
            AND latitude BETWEEN ${s.lat - r} AND ${s.lat + r}
            AND longitude BETWEEN ${s.lon - r * 1.22} AND ${s.lon + r * 1.22}
            AND altitude IS NOT NULL AND altitude > 0 AND altitude < ${LOW_ALT_FT}`;
        sectorStats.push({ ...s, ...rows[0] });
      } catch {
        skipped.push(`sector_${s.key}`);
        sectorStats.push({ ...s, low_alt_pings: null, unique_aircraft: null, active_hours: null, sub_stall_pings: null });
      }
    }
    const controls = sectorStats.filter((s) => s.control && s.active_hours != null);
    const aoi = sectorStats.find((s) => s.key === "AOI");
    const ctrlMean = controls.length ? controls.reduce((a, s) => a + s.active_hours, 0) / controls.length : null;
    const specificityRatio = aoi?.active_hours != null && ctrlMean ? +(aoi.active_hours / Math.max(ctrlMean, 0.5)).toFixed(2) : null;
    // Poisson tail: P(X >= aoi | lambda = control mean)
    let pValue: number | null = null;
    if (aoi?.active_hours != null && ctrlMean != null) {
      const lam = Math.max(ctrlMean, 0.5);
      let term = Math.exp(-lam), cdf = 0;
      for (let k = 0; k < aoi.active_hours; k++) { cdf += term; term *= lam / (k + 1); }
      pValue = Math.max(0, 1 - cdf);
    }

    // 2. Periodicity — military + local fleet, Pacific time
    const milPattern = MILITARY_PREFIXES.map((p) => `${p}%`);
    let periodicity: any[] = [];
    try {
      periodicity = await sql`
        SELECT CASE WHEN UPPER(COALESCE(registration,'')) = ANY(${LOCAL_TAILS}) THEN 'local' ELSE 'military' END AS fleet,
               EXTRACT(DOW FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles')::int AS dow,
               EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles')::int AS hour,
               COUNT(DISTINCT date_trunc('day', detection_timestamp))::int AS active_days
        FROM live_flight_detections_rows
        WHERE detection_timestamp > ${since}
          AND (UPPER(COALESCE(registration,'')) = ANY(${LOCAL_TAILS})
               OR UPPER(COALESCE(callsign,'')) LIKE ANY(${milPattern}))
        GROUP BY 1,2,3`;
    } catch { skipped.push("periodicity"); }
    const weeks = days / 7;
    const topWindows = (fleet: string) =>
      periodicity.filter((p) => p.fleet === fleet)
        .map((p) => ({ dow: p.dow, hour: p.hour, active_days: p.active_days, probability: +Math.min(1, p.active_days / weeks).toFixed(2) }))
        .sort((a, b) => b.probability - a.probability).slice(0, 8);

    // 3. Handoff lags — military entry followed by local fleet within 60 min (Kern box)
    let handoffs: any[] = [];
    try {
      handoffs = await sql`
        WITH mil AS (
          SELECT UPPER(callsign) AS mil_cs, MIN(detection_timestamp) AS t
          FROM live_flight_detections_rows
          WHERE detection_timestamp > ${since}
            AND UPPER(COALESCE(callsign,'')) LIKE ANY(${milPattern})
            AND latitude BETWEEN 34.8 AND 35.8 AND longitude BETWEEN -119.6 AND -118.3
          GROUP BY 1, date_trunc('hour', detection_timestamp)
        ), loc AS (
          SELECT UPPER(registration) AS tail, MIN(detection_timestamp) AS t
          FROM live_flight_detections_rows
          WHERE detection_timestamp > ${since}
            AND UPPER(COALESCE(registration,'')) = ANY(${LOCAL_TAILS})
          GROUP BY 1, date_trunc('hour', detection_timestamp)
        )
        SELECT mil.mil_cs, mil.t AS mil_t, l.tail, l.t AS local_t,
               ROUND(EXTRACT(EPOCH FROM (l.t - mil.t))/60)::int AS lag_min
        FROM mil JOIN LATERAL (
          SELECT tail, t FROM loc WHERE loc.t > mil.t AND loc.t <= mil.t + INTERVAL '60 minutes'
          ORDER BY loc.t LIMIT 1) l ON true
        ORDER BY mil.t DESC LIMIT 200`;
    } catch { skipped.push("handoffs"); }
    const lags = handoffs.map((h) => h.lag_min).sort((a, b) => a - b);
    const medianLag = lags.length ? lags[Math.floor(lags.length / 2)] : null;

    const stats = {
      window_days: days,
      generated_at: new Date().toISOString(),
      radius_nm: RADIUS_NM,
      low_alt_ft: LOW_ALT_FT,
      total_detections_in_window: totalWindow,
      sectors: sectorStats,
      control_mean_active_hours: ctrlMean != null ? +ctrlMean.toFixed(2) : null,
      specificity_ratio: specificityRatio,
      poisson_p_value: pValue,
      military_windows: topWindows("military"),
      local_windows: topWindows("local"),
      handoff_count: handoffs.length,
      handoff_median_lag_min: medianLag,
      handoffs: handoffs.slice(0, 50),
      skipped,
    };
    const hash = await sha256(JSON.stringify(stats));

    let narrative = "";
    let provider = hasNim() ? "nvidia-nim" : "lovable-gateway";
    if (narrate) {
      try {
        const res = await nimChat({
          stream: false,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "You are a forensic aviation statistician. Using ONLY the JSON statistics provided, write a concise forecast brief (max 350 words) with sections: 1) Forecast windows (Pacific time, day names), 2) Military-to-local handoff signal, 3) Control-sector specificity (state ratio and p-value plainly), 4) Limitations. Never invent numbers. Do not use words like targeting, stalking, conspiracy. Co-presence is not proof of coordination; say so where relevant. Days of week: 0=Sunday. The dow/hour fields are ALREADY Pacific local time — do not convert them. In Limitations you MUST note: (a) the receiver network may cover the AOI better than control sectors, so near-zero control counts can reflect coverage rather than absence of flights; (b) the AOI lies near Meadows Field (KBFL) approach paths, which raises routine low-altitude traffic; (c) small handoff counts are not statistically meaningful.",
            },
            { role: "user", content: JSON.stringify(stats) },
          ],
        });
        if (res.ok) {
          const j = await res.json();
          narrative = j?.choices?.[0]?.message?.content ?? "";
        } else {
          narrative = "";
          skipped.push(`narrative_${res.status}`);
        }
      } catch { skipped.push("narrative"); }
    }

    return json({ stats, sha256: hash, narrative, provider });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), skipped }, 500);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
});

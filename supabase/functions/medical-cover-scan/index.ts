// Medical Cover Scan — mission-consistency analysis of air-ambulance / HEMS airframes.
//
// A medical registrant is treated as a CONCEALMENT VECTOR, not an exemption. Every
// airframe on a medical certificate is tested against what a real patient-transport
// mission looks like (direct transit, scene landing, hospital terminus, base return).
// Only behaviour a medical mission cannot explain produces a score.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import {
  MEDICAL_OPERATOR_SQL,
  NEAR_HOSPITAL_SQL,
  NEAR_BASE_SQL,
  scoreMedicalCover,
  type MedicalCoverMetrics,
} from "../_shared/medicalFleet.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUDGET_MS = 100_000;
const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;
const AOI = `(latitude BETWEEN ${AOI_LAT - 0.025} AND ${AOI_LAT + 0.025} AND longitude BETWEEN ${AOI_LNG - 0.031} AND ${AOI_LNG + 0.031})`;

function withBudget<T>(p: Promise<T>, started: number): Promise<T> {
  const remaining = BUDGET_MS - (Date.now() - started);
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("BUDGET_EXCEEDED")), Math.max(1000, remaining))),
  ]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  const json = (p: unknown, status = 200) =>
    new Response(JSON.stringify(p), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!NEON) return json({ error: "NEON_DATABASE_URL not configured" }, 500);

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days ?? 90), 1), 730);
    const limit = Math.min(Math.max(Number(body.limit ?? 40), 5), 200);
    const only: string[] = Array.isArray(body.registrations) ? body.registrations : [];

    sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 20, prepare: false });
    await sql.unsafe(`SET statement_timeout = '85s'`).catch(() => {});

    const regFilter = only.length
      ? `AND upper(registration) IN (${only.map((r) => `'${String(r).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}'`).join(",")})`
      : "";

    const rows = await withBudget(
      sql.unsafe(`
        WITH med AS (
          SELECT registration,
                 max(nullif(btrim(coalesce(owner_operator, operator_inferred, '')), '')) AS registrant,
                 count(*)::int                                                       AS detections,
                 count(DISTINCT date(detection_timestamp))::int                      AS active_days,
                 count(*) FILTER (WHERE ${AOI})::int                                 AS aoi_passes,
                 count(DISTINCT date_trunc('minute', detection_timestamp))
                   FILTER (WHERE ${AOI})::int                                        AS aoi_minutes,
                 count(*) FILTER (WHERE ${AOI}
                        AND extract(hour FROM detection_timestamp) BETWEEN 0 AND 5)::int AS aoi_nights,
                 min(altitude) FILTER (WHERE ${AOI} AND altitude > 0)::int           AS min_alt_near_aoi,
                 count(*) FILTER (WHERE ${AOI} AND altitude BETWEEN 1 AND 2000
                        AND speed BETWEEN 1 AND 70)::int                             AS loiter_samples,
                 count(*) FILTER (WHERE ${NEAR_HOSPITAL_SQL} AND coalesce(altitude, 0) < 900)::int AS hospital_terminus,
                 count(*) FILTER (WHERE ${NEAR_BASE_SQL} AND coalesce(altitude, 0) < 900)::int     AS base_ops,
                 min(detection_timestamp)::text                                      AS first_seen,
                 max(detection_timestamp)::text                                      AS last_seen
          FROM public.live_flight_detections_rows
          WHERE detection_timestamp > now() - interval '${days} days'
            AND registration IS NOT NULL
            AND ${MEDICAL_OPERATOR_SQL}
            ${regFilter}
          GROUP BY registration
        )
        SELECT * FROM med
        ORDER BY aoi_passes DESC, detections DESC
        LIMIT ${limit}
      `),
      started,
    ) as unknown as MedicalCoverMetrics[];

    const fleet = rows.map((m) => {
      const v = scoreMedicalCover(m);
      return { ...m, medical_cover_score: v.score, tier: v.tier, reasons: v.reasons, rebuttal: v.rebuttal };
    }).sort((a, b) => b.medical_cover_score - a.medical_cover_score);

    const summary = {
      airframes: fleet.length,
      suspected: fleet.filter((f) => f.tier === "MEDICAL_COVER_SUSPECTED").length,
      anomalous: fleet.filter((f) => f.tier === "MEDICAL_PROFILE_ANOMALY").length,
      review: fleet.filter((f) => f.tier === "REVIEW").length,
      consistent: fleet.filter((f) => f.tier === "MEDICAL_CONSISTENT").length,
      aoi_active: fleet.filter((f) => f.aoi_passes > 0).length,
      no_hospital_terminus: fleet.filter((f) => f.aoi_passes >= 5 && f.hospital_terminus === 0).length,
      window_days: days,
    };

    return json({ ok: true, summary, fleet, elapsed_ms: Date.now() - started });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg, code: msg.includes("BUDGET") ? "BUDGET_EXCEEDED" : "ERROR" }, 500);
  } finally {
    if (sql) await sql.end().catch(() => {});
  }
});

// Detection Enrichment Engine — canonical classification + composite threat scoring
// for public.live_flight_detections_rows (Neon).
//
// Actions:
//   init     — add composite_threat_score / composite_threat_reasons columns + index
//   backfill — classify + score a bounded time window (resumable, budget-guarded)
//   stats    — bucket + severity distribution for the UI
//
// Nothing is deleted. threat_score is preserved; the composite score is additive.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUDGET_MS = 100_000;
const STMT_TIMEOUT_MS = 85_000;

// Primary AOI (Oildale residence)
const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;
// Kern working box
const KERN = { latMin: 34.8, latMax: 35.9, lngMin: -119.8, lngMax: -118.3 };

/** Canonical MLAT / detection bucket, mirrors src/lib/detectionClassifier.ts. */
const BUCKET_SQL = `
  CASE
    -- MLAT placeholder identity with zero kinematics: tracker artifact, NOT a violation
    WHEN (registration IS NULL OR btrim(registration) = ''
          OR upper(registration) LIKE 'XXB%' OR upper(coalesce(icao_code,'')) LIKE '%XXB%'
          OR upper(coalesce(registration,'')) IN ('UNKNOWN','XXX','XXA','XXC','XXD'))
         AND coalesce(altitude, 0) <= 0
         AND coalesce(speed, 0) <= 0
      THEN 'MLAT'
    -- Parked / taxiing
    WHEN on_ground IS TRUE
         OR (coalesce(altitude, 0) <= 50 AND coalesce(speed, 0) <= 30)
      THEN 'GROUND'
    -- Physics-impossible: airborne below Cessna-172 stall, or beyond civil envelope
    WHEN (altitude > 500 AND speed IS NOT NULL AND speed > 0 AND speed < 48)
         OR (speed IS NOT NULL AND speed > 700)
      THEN 'SPOOF'
    -- Valid tail, moving, but altitude suppressed mid-flight
    WHEN registration IS NOT NULL AND btrim(registration) <> ''
         AND (altitude IS NULL OR altitude <= 0)
         AND speed IS NOT NULL AND speed > 30
      THEN 'SUPPRESS'
    -- Valid tail broadcasting a normal profile with no hex (LADD / masked)
    WHEN registration IS NOT NULL AND btrim(registration) <> ''
         AND (icao24 IS NULL OR btrim(icao24) = '')
         AND altitude > 500 AND speed > 50
      THEN 'MASKED'
    ELSE 'NORMAL'
  END`;

const IN_KERN_SQL = `(latitude BETWEEN ${KERN.latMin} AND ${KERN.latMax} AND longitude BETWEEN ${KERN.lngMin} AND ${KERN.lngMax})`;
// ~3nm of the residence
const NEAR_AOI_SQL = `(latitude BETWEEN ${AOI_LAT - 0.05} AND ${AOI_LAT + 0.05} AND longitude BETWEEN ${AOI_LNG - 0.06} AND ${AOI_LNG + 0.06})`;

const LAW_ENF_SQL = `(upper(coalesce(owner_operator,'') || ' ' || coalesce(registered_owner,'')) ~ '(SHERIFF|KCSO|POLICE|HIGHWAY PATROL|MARSHAL|CUSTOMS|BORDER)')`;

/** Raw composite points before clamping. */
const RAW_SCORE_SQL = `
  (
    CASE
      WHEN ${BUCKET_SQL} IN ('MLAT','GROUND') THEN 0
      ELSE
        -- altitude pressure (only meaningful when actually airborne)
        (CASE
           WHEN altitude IS NULL THEN 0
           WHEN altitude > 0 AND altitude < 500  THEN 45
           WHEN altitude < 1000 THEN 30
           WHEN altitude < 1500 THEN 18
           ELSE 0
         END)
        + (CASE WHEN ${NEAR_AOI_SQL} THEN 20 ELSE 0 END)
        + (CASE WHEN is_military IS TRUE THEN 10 ELSE 0 END)
        + (CASE WHEN ${LAW_ENF_SQL} THEN 15 ELSE 0 END)
        + (CASE WHEN shell_auto_detected IS TRUE THEN 12 ELSE 0 END)
        + (CASE WHEN altitude BETWEEN 1 AND 500 AND speed IS NOT NULL AND speed > 0 AND speed < 48 THEN 15 ELSE 0 END)
        + (CASE ${BUCKET_SQL}
             WHEN 'SPOOF' THEN 25
             WHEN 'SUPPRESS' THEN 20
             WHEN 'MASKED' THEN 10
             ELSE 0
           END)
    END
  )`;

// Out-of-county rows are damped: they are context, not case evidence.
const SCORE_SQL = `LEAST(100, GREATEST(0, ROUND((${RAW_SCORE_SQL}) * (CASE WHEN ${IN_KERN_SQL} THEN 1.0 ELSE 0.4 END))::int))`;

const REASONS_SQL = `
  ARRAY_REMOVE(ARRAY[
    CASE WHEN altitude > 0 AND altitude < 500 THEN 'below_500ft' 
         WHEN altitude < 1000 THEN 'below_1000ft'
         WHEN altitude < 1500 THEN 'below_1500ft' END,
    CASE WHEN ${NEAR_AOI_SQL} THEN 'within_3nm_of_aoi' END,
    CASE WHEN NOT ${IN_KERN_SQL} THEN 'outside_kern_aoi' END,
    CASE WHEN is_military IS TRUE THEN 'military_asset' END,
    CASE WHEN ${LAW_ENF_SQL} THEN 'law_enforcement_operator' END,
    CASE WHEN shell_auto_detected IS TRUE THEN 'shell_registrant' END,
    CASE WHEN altitude BETWEEN 1 AND 500 AND speed > 0 AND speed < 48 THEN 'sub_stall_speed' END,
    CASE WHEN ${BUCKET_SQL} = 'SPOOF' THEN 'physics_violation' END,
    CASE WHEN ${BUCKET_SQL} = 'SUPPRESS' THEN 'altitude_suppressed_14CFR91.225' END,
    CASE WHEN ${BUCKET_SQL} = 'MASKED' THEN 'identity_masked_ladd' END,
    CASE WHEN ${BUCKET_SQL} = 'MLAT' THEN 'mlat_placeholder_not_a_violation' END,
    CASE WHEN ${BUCKET_SQL} = 'GROUND' THEN 'on_ground' END
  ], NULL)`;

async function withBudget<T>(p: Promise<T>, started: number): Promise<T> {
  const remaining = BUDGET_MS - (Date.now() - started);
  return await Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("BUDGET_EXCEEDED")), Math.max(1000, remaining))),
  ]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();

  const databaseUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "backfill";

    sql = postgres(databaseUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '${STMT_TIMEOUT_MS}'`).catch(() => {});

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "init") {
      // The ingester holds row locks continuously; take the DDL lock opportunistically
      // with a short lock_timeout and retry rather than blocking for 85s.
      await sql.unsafe(`SET lock_timeout = '4000'`).catch(() => {});
      const ddl = [
        `ALTER TABLE public.live_flight_detections_rows ADD COLUMN IF NOT EXISTS composite_threat_score integer`,
        `ALTER TABLE public.live_flight_detections_rows ADD COLUMN IF NOT EXISTS composite_threat_reasons text[]`,
        `ALTER TABLE public.live_flight_detections_rows ADD COLUMN IF NOT EXISTS composite_scored_at timestamptz`,
      ];
      const applied: string[] = [];
      const failedDdl: string[] = [];
      for (const stmt of ddl) {
        let ok = false;
        for (let attempt = 0; attempt < 12 && !ok; attempt++) {
          if (Date.now() - started > BUDGET_MS - 15_000) break;
          try { await sql.unsafe(stmt); ok = true; }
          catch { await new Promise((r) => setTimeout(r, 1500)); }
        }
        (ok ? applied : failedDdl).push(stmt.split("IF NOT EXISTS ")[1]);
      }
      await sql.unsafe(`SET lock_timeout = '0'`).catch(() => {});
      if (failedDdl.length === 0) {
        await sql.unsafe(`
          CREATE INDEX IF NOT EXISTS idx_lfdr_composite
            ON public.live_flight_detections_rows (detection_timestamp DESC, composite_threat_score DESC)
        `).catch(() => {});
      }
      return json({ ok: failedDdl.length === 0, action, applied, failed: failedDdl });
    }

    if (action === "stats") {
      const hours = Math.min(Math.max(Number(body.hours ?? 24), 1), 720);
      const rows = await withBudget(sql.unsafe(`
        SELECT coalesce(mlat_taxonomy, 'unclassified') AS bucket,
               count(*)::int AS n,
               count(*) FILTER (WHERE composite_threat_score >= 70)::int AS critical,
               count(*) FILTER (WHERE composite_threat_score BETWEEN 45 AND 69)::int AS high,
               count(*) FILTER (WHERE ${IN_KERN_SQL})::int AS in_kern,
               max(composite_threat_score)::int AS max_score
        FROM public.live_flight_detections_rows
        WHERE detection_timestamp > now() - interval '${hours} hours'
        GROUP BY 1 ORDER BY n DESC
      `), started);
      return json({ ok: true, action, hours, buckets: rows });
    }

    if (action === "backfill") {
      // Bounded, resumable window. Default: last 24 hours, unscored rows only.
      const hours = Math.min(Math.max(Number(body.hours ?? 24), 1), 24 * 400);
      const onlyUnscored = body.onlyUnscored !== false;
      const batch = Math.min(Math.max(Number(body.batchSize ?? 40000), 1000), 200000);
      const maxBatches = Math.min(Math.max(Number(body.maxBatches ?? 6), 1), 40);

      let totalUpdated = 0;
      let batches = 0;
      let budgetHit = false;

      for (let i = 0; i < maxBatches; i++) {
        if (Date.now() - started > BUDGET_MS - 20_000) { budgetHit = true; break; }
        let updated = 0;
        try {
          const res = await withBudget(sql.unsafe(`
            WITH target AS (
              SELECT id FROM public.live_flight_detections_rows
              WHERE detection_timestamp > now() - interval '${hours} hours'
                ${onlyUnscored ? "AND composite_threat_score IS NULL" : ""}
              ORDER BY detection_timestamp DESC
              LIMIT ${batch}
            )
            UPDATE public.live_flight_detections_rows d
            SET mlat_taxonomy = ${BUCKET_SQL},
                composite_threat_score = ${SCORE_SQL},
                composite_threat_reasons = ${REASONS_SQL},
                is_spoofing_candidate = (${BUCKET_SQL} = 'SPOOF'),
                composite_scored_at = now()
            FROM target t
            WHERE d.id = t.id
            RETURNING 1
          `), started);
          updated = Array.isArray(res) ? res.length : (res as any)?.count ?? 0;
        } catch (e) {
          if (String((e as Error).message).includes("BUDGET_EXCEEDED")) { budgetHit = true; break; }
          throw e;
        }
        totalUpdated += updated;
        batches++;
        if (updated < batch) break; // window exhausted
      }

      const [remaining] = await sql.unsafe(`
        SELECT count(*)::int AS n FROM public.live_flight_detections_rows
        WHERE detection_timestamp > now() - interval '${hours} hours'
          AND composite_threat_score IS NULL
      `).catch(() => [{ n: null }] as any);

      return json({
        ok: true, action, hours, batches, updated: totalUpdated,
        remaining_unscored: remaining?.n ?? null,
        budget_hit: budgetHit,
        note: budgetHit || (remaining?.n ?? 0) > 0 ? "Call backfill again to continue." : "Window fully scored.",
        elapsed_ms: Date.now() - started,
      });
    }

    return json({ error: "unknown action", allowed: ["init", "backfill", "stats"] }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    return new Response(JSON.stringify({ error: msg, code: msg.includes("BUDGET") ? "BUDGET_EXCEEDED" : "ERROR" }), {
      status: msg.includes("BUDGET") ? 504 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

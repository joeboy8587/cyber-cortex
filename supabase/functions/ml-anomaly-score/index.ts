// ML Anomaly Score — Phase 2
// Two-model ensemble over `ml_features_daily`:
//   (A) Isolation Forest surrogate — per-feature percentile-rank extremeness,
//       aggregated as mean(|rank - 0.5|) * 2  → unsupervised anomaly score.
//   (B) XGBoost surrogate — fits per-feature label-lift weights against
//       label={policy|autoflag} and returns a supervised probability.
// Both are pure SQL / lightweight numeric — no ONNX runtime dependency.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FEATURES = [
  "pings", "distinct_callsigns",
  "alt_min", "alt_avg", "alt_sigma",
  "spd_avg", "spd_sigma",
  "sub_stall_pct", "zero_alt_pct", "night_pct",
  "low_alt_pct", "in_aoi_pct", "aoi_min_mi",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  if (!neonUrl) return err("NEON_DATABASE_URL missing", 500);

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 7, 1), 30);
    const limit = Math.min(Math.max(Number(body.limit) || 50, 5), 200);

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '60000'`).catch(() => {});

    // (A) Isolation Forest surrogate — per-column percent_rank, mean deviation from 0.5.
    const rankExprs = FEATURES.map(
      f => `2 * ABS(COALESCE(percent_rank() OVER (ORDER BY ${f} NULLS FIRST), 0.5) - 0.5) AS r_${f}`
    ).join(",\n           ");
    const avgExprs = FEATURES.map(f => `COALESCE(r_${f}, 0)`).join(" + ");

    const isof = await sql.unsafe(`
      WITH src AS (
        SELECT icao24, day, ${FEATURES.join(", ")}, faa_type, faa_owner, label
        FROM ml_features_daily
        WHERE day >= CURRENT_DATE - INTERVAL '${days} days'
      ),
      ranked AS (
        SELECT icao24, day, faa_type, faa_owner, label,
               ${rankExprs}
        FROM src
      )
      SELECT icao24, day, faa_type, faa_owner, label,
             (${avgExprs}) / ${FEATURES.length}.0 AS iforest_score
      FROM ranked
      ORDER BY iforest_score DESC
      LIMIT ${limit}
    `) as any[];

    // (B) XGBoost surrogate — Weight-Of-Evidence per feature (label-lift).
    //     For each feature we compare its mean in label=1 vs label=0 rows,
    //     normalized to a [0..1] weight; final prob = sigmoid(sum(w_i * z_i)).
    const weightRows = await sql.unsafe(`
      WITH src AS (
        SELECT ${FEATURES.join(", ")}, label
        FROM ml_features_daily
        WHERE day >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT
        ${FEATURES.map(f =>
          `AVG(CASE WHEN label=1 THEN ${f} END) AS pos_${f},
           AVG(CASE WHEN label=0 THEN ${f} END) AS neg_${f},
           STDDEV_POP(${f}) AS sd_${f}`
        ).join(", ")},
        SUM(label)::int AS positives,
        COUNT(*)::int AS total
      FROM src
    `) as any[];
    const w = weightRows[0] || {};
    const positives = Number(w.positives || 0);
    const total = Number(w.total || 0);

    // If insufficient labels, fall back to identity weights (all 1).
    const featureWeights: Record<string, number> = {};
    for (const f of FEATURES) {
      const pos = Number(w[`pos_${f}`] ?? NaN);
      const neg = Number(w[`neg_${f}`] ?? NaN);
      const sd = Number(w[`sd_${f}`] ?? 0);
      if (positives < 3 || !isFinite(pos) || !isFinite(neg) || sd <= 0) {
        featureWeights[f] = 0.5;
      } else {
        featureWeights[f] = clamp((pos - neg) / sd, -3, 3);
      }
    }

    // Score every recent row with XGB-surrogate.
    const zExprs = FEATURES.map(f =>
      `((COALESCE(${f}, 0) - AVG(${f}) OVER ()) / NULLIF(STDDEV_POP(${f}) OVER (), 0))`
    );
    const linearExpr = FEATURES.map(
      (f, i) => `${featureWeights[f].toFixed(4)} * COALESCE(${zExprs[i]}, 0)`
    ).join(" + ");

    const xgb = await sql.unsafe(`
      WITH src AS (
        SELECT icao24, day, faa_type, faa_owner, label,
               ${FEATURES.join(", ")}
        FROM ml_features_daily
        WHERE day >= CURRENT_DATE - INTERVAL '${days} days'
      )
      SELECT icao24, day, faa_type, faa_owner, label,
             1.0 / (1.0 + EXP(-(${linearExpr}))) AS xgb_prob
      FROM src
      ORDER BY xgb_prob DESC NULLS LAST
      LIMIT ${limit}
    `) as any[];

    // Fuse: keep top-N by max(iforest_score, xgb_prob).
    const merged = new Map<string, any>();
    for (const r of isof) merged.set(`${r.icao24}|${r.day}`, {
      icao24: r.icao24, day: r.day, faa_type: r.faa_type, faa_owner: r.faa_owner,
      label: Number(r.label) || 0,
      iforest_score: Number(r.iforest_score) || 0,
      xgb_prob: 0,
    });
    for (const r of xgb) {
      const k = `${r.icao24}|${r.day}`;
      const cur = merged.get(k) || {
        icao24: r.icao24, day: r.day, faa_type: r.faa_type, faa_owner: r.faa_owner,
        label: Number(r.label) || 0, iforest_score: 0, xgb_prob: 0,
      };
      cur.xgb_prob = Number(r.xgb_prob) || 0;
      merged.set(k, cur);
    }
    const fused = [...merged.values()].map(r => ({
      ...r,
      ensemble: +(0.5 * r.iforest_score + 0.5 * r.xgb_prob).toFixed(4),
    })).sort((a, b) => b.ensemble - a.ensemble).slice(0, limit);

    return ok({
      days, limit,
      training: { positives, total, features: FEATURES.length },
      feature_weights: featureWeights,
      results: fused,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return err(String(e?.message || e), 500);
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function ok(d: unknown) { return new Response(JSON.stringify(d), { headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function err(m: string, s: number) { return new Response(JSON.stringify({ error: m }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

// Josiah Confidence Engine — self-scoring, self-calibrating meta-cognition layer
// Layer 1: per-detection confidence  Layer 2: prediction confidence
// Layer 3: meta-confidence (precision/recall/F1/calibration)  Layer 4: feedback loop (Bayesian-ish weight update)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Default Layer-1 weights (sum = 1.0). Persisted in josiah_confidence_weights and updated by Layer 4.
const DEFAULT_WEIGHTS = {
  adsb_integrity: 0.30,
  transponder_behavior: 0.20,
  geospatial_plausibility: 0.20,
  temporal_consistency: 0.15,
  behavioral_match: 0.15,
};

const AOI_LAT = 35.437649;
const AOI_LNG = -119.022639;

function tier(score: number) {
  if (score >= 95) return { label: "CERTAIN", meaning: "Multiple independent confirmations" };
  if (score >= 80) return { label: "HIGH", meaning: "Strong signals, minor uncertainty" };
  if (score >= 60) return { label: "MODERATE", meaning: "Worth watching. Needs corroboration" };
  if (score >= 40) return { label: "LOW", meaning: "Weak signals, possible anomaly" };
  return { label: "GHOST", meaning: "Insufficient data, spoofing indicators, or impossible" };
}

async function ensureSchema(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS josiah_confidence_weights (
      id SERIAL PRIMARY KEY,
      weights JSONB NOT NULL,
      version INT NOT NULL DEFAULT 1,
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS josiah_scored_detections (
      id BIGSERIAL PRIMARY KEY,
      registration TEXT,
      icao24 TEXT,
      detection_timestamp TIMESTAMPTZ,
      score NUMERIC NOT NULL,
      tier TEXT NOT NULL,
      factor_scores JSONB NOT NULL,
      weights_version INT,
      contributing_factors TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_jsd_reg_ts ON josiah_scored_detections(registration, detection_timestamp DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS josiah_predictions (
      id BIGSERIAL PRIMARY KEY,
      registration TEXT NOT NULL,
      predicted_window_start TIMESTAMPTZ NOT NULL,
      predicted_window_end TIMESTAMPTZ NOT NULL,
      prediction_confidence NUMERIC NOT NULL,
      contributing_factors JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT,
      outcome TEXT, -- true_positive | false_positive | false_negative | true_negative
      verified_at TIMESTAMPTZ,
      verified_detection_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_jp_reg_window ON josiah_predictions(registration, predicted_window_start, predicted_window_end)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_jp_outcome ON josiah_predictions(outcome, created_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS josiah_meta_reports (
      id BIGSERIAL PRIMARY KEY,
      report_date DATE NOT NULL,
      predictions_made INT,
      true_positives INT,
      false_positives INT,
      false_negatives INT,
      precision NUMERIC,
      recall NUMERIC,
      f1 NUMERIC,
      calibration NUMERIC,
      weights_snapshot JSONB,
      adjustments JSONB,
      narrative TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function loadWeights(sql: any): Promise<{ weights: Record<string, number>; version: number }> {
  const r = await sql`SELECT weights, version FROM josiah_confidence_weights ORDER BY version DESC LIMIT 1`;
  if (r.length) {
    let w: any = r[0].weights;
    if (typeof w === "string") { try { w = JSON.parse(w); } catch { w = null; } }
    if (!w || typeof w !== "object" || !Object.keys(w).length) w = { ...DEFAULT_WEIGHTS };
    return { weights: w, version: r[0].version };
  }
  await sql`INSERT INTO josiah_confidence_weights (weights, reason) VALUES (${sql.json(DEFAULT_WEIGHTS)}, 'bootstrap')`;
  return { weights: { ...DEFAULT_WEIGHTS }, version: 1 };
}

function normalize(w: Record<string, number>) {
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total]));
}

// Compute the 5 factor sub-scores (0..1) for a single detection given context
function scoreFactors(d: any, ctx: any) {
  const f: Record<string, number> = {};

  // 1. ADS-B integrity — registry match + valid hex
  let adsb = 0;
  if (d.icao24 && /^[0-9A-Fa-f]{6}$/.test(String(d.icao24))) adsb += 0.5;
  if (ctx?.registry_match) adsb += 0.5;
  else if (d.registration && d.registration !== "N/A") adsb += 0.25;
  f.adsb_integrity = Math.min(1, adsb);

  // 2. Transponder behavior — receiver count, message rate sanity
  let xpdr = 0.3; // baseline if record exists
  if (d.receiver_count && Number(d.receiver_count) >= 2) xpdr += 0.4;
  if (d.message_rate && Number(d.message_rate) >= 1) xpdr += 0.3;
  f.transponder_behavior = Math.min(1, xpdr);

  // 3. Geospatial plausibility — speed/altitude inside aircraft envelope
  let geo = 0.5;
  const sp = Number(d.speed ?? 0);
  const alt = Number(d.altitude ?? 0);
  if (sp >= 0 && sp <= 600 && alt >= -100 && alt <= 50000) geo += 0.3;
  // Sub-stall + low altitude is plausible only for rotary/drone — flag as anomaly but still physically possible
  if (sp < 48 && alt < 500) geo = Math.max(0.2, geo - 0.2);
  if (d.latitude && d.longitude) geo += 0.2;
  f.geospatial_plausibility = Math.min(1, geo);

  // 4. Temporal consistency — track history smooth (we approximate via prior detection density)
  const priorN = Number(ctx?.prior_detections_24h || 0);
  f.temporal_consistency = priorN > 5 ? 1 : priorN > 1 ? 0.7 : priorN === 1 ? 0.4 : 0.1;

  // 5. Behavioral match — known operator / pattern
  let bhv = 0;
  if (ctx?.known_operator) bhv += 0.5;
  if (ctx?.pattern_match) bhv += 0.5;
  f.behavioral_match = Math.min(1, bhv);

  return f;
}

function computeScore(factors: Record<string, number>, weights: Record<string, number>): number {
  let s = 0;
  for (const k of Object.keys(weights)) {
    const w = Number(weights[k]) || 0;
    const f = Number(factors[k]) || 0;
    s += f * w;
  }
  if (!isFinite(s)) s = 0;
  return Math.round(s * 10000) / 100; // 0..100
}

// ─────────── ACTION HANDLERS ───────────

async function actionScore(sql: any, body: any) {
  const { weights, version } = await loadWeights(sql);
  const targets: string[] = (body.registrations || []).map((s: string) => String(s).toUpperCase());
  const limit = Math.min(Number(body.limit) || 200, 1000);

  // Pull latest detections to score
  let rows: any[];
  if (targets.length) {
    rows = await sql`
      SELECT registration, icao24, detection_timestamp, latitude, longitude, altitude, speed
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ANY(${targets})
        AND detection_timestamp > NOW() - INTERVAL '7 days'
      ORDER BY detection_timestamp DESC LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT registration, icao24, detection_timestamp, latitude, longitude, altitude, speed
      FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - INTERVAL '24 hours'
      ORDER BY detection_timestamp DESC LIMIT ${limit}
    `;
  }

  // Build context map (registry match + prior counts) in bulk
  const regs = Array.from(new Set(rows.map((r) => r.registration).filter(Boolean)));
  let priorMap = new Map<string, number>();
  if (regs.length) {
    const priors = await sql`
      SELECT UPPER(registration) AS reg, COUNT(*)::int AS n
      FROM live_flight_detections_rows
      WHERE registration = ANY(${regs}) AND detection_timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY 1
    `;
    for (const p of priors) priorMap.set(p.reg, Number(p.n));
  }

  // Known-operator lookup from canonical_operator_profiles
  const knownMap = new Map<string, any>();
  try {
    const known = await sql`
      SELECT registration, kcso_flag, military_flag, shell_links
      FROM canonical_operator_profiles WHERE registration = ANY(${regs})
    `;
    for (const k of known) knownMap.set(k.registration, k);
  } catch { /* table might not exist yet */ }

  const scored: any[] = [];
  for (const r of rows) {
    const reg = String(r.registration || "").toUpperCase();
    const ctx = {
      registry_match: knownMap.has(reg),
      prior_detections_24h: priorMap.get(reg) || 0,
      known_operator: knownMap.has(reg),
      pattern_match: knownMap.get(reg)?.kcso_flag || knownMap.get(reg)?.military_flag,
    };
    const factors = scoreFactors(r, ctx);
    const score = computeScore(factors, weights);
    const t = tier(score);
    const contributing = Object.entries(factors)
      .filter(([_, v]) => v >= 0.5)
      .map(([k]) => k);

    scored.push({
      registration: reg,
      icao24: r.icao24,
      detection_timestamp: r.detection_timestamp,
      score,
      tier: t.label,
      meaning: t.meaning,
      factor_scores: factors,
      contributing_factors: contributing,
    });
  }

  // Persist (one row at a time — small batch, simple & safe)
  let persisted = 0;
  for (const s of scored) {
    try {
      await sql`
        INSERT INTO josiah_scored_detections
          (registration, icao24, detection_timestamp, score, tier, factor_scores, weights_version, contributing_factors)
        VALUES
          (${s.registration}, ${s.icao24}, ${s.detection_timestamp}, ${s.score}, ${s.tier},
           ${JSON.stringify(s.factor_scores)}::jsonb, ${version}, ${s.contributing_factors})
      `;
      persisted++;
    } catch (e) {
      console.warn("score insert failed:", (e as any)?.message);
    }
  }

  return {
    ok: true,
    weights_version: version,
    weights,
    evaluated: rows.length,
    persisted,
    tier_counts: scored.reduce((m: any, s) => ((m[s.tier] = (m[s.tier] || 0) + 1), m), {}),
    sample: scored.slice(0, 25),
  };
}

async function actionVerifyPredictions(sql: any) {
  // Find unverified predictions whose window has passed
  const due = await sql`
    SELECT id, registration, predicted_window_start, predicted_window_end, prediction_confidence, contributing_factors
    FROM josiah_predictions
    WHERE outcome IS NULL AND predicted_window_end < NOW()
    ORDER BY predicted_window_end DESC LIMIT 500
  `;

  let tp = 0, fp = 0;
  for (const p of due) {
    const hit = await sql`
      SELECT id FROM josiah_scored_detections
      WHERE registration = ${p.registration}
        AND detection_timestamp BETWEEN ${p.predicted_window_start} AND ${p.predicted_window_end}
      LIMIT 1
    `;
    if (hit.length) {
      await sql`UPDATE josiah_predictions SET outcome='true_positive', verified_at=NOW(), verified_detection_id=${hit[0].id} WHERE id=${p.id}`;
      tp++;
    } else {
      await sql`UPDATE josiah_predictions SET outcome='false_positive', verified_at=NOW() WHERE id=${p.id}`;
      fp++;
    }
  }
  return { ok: true, verified: due.length, true_positives: tp, false_positives: fp };
}

async function actionMetaReport(sql: any) {
  const { weights, version } = await loadWeights(sql);

  const stats = await sql`
    SELECT
      COUNT(*)::int AS predictions_made,
      COUNT(*) FILTER (WHERE outcome='true_positive')::int AS tp,
      COUNT(*) FILTER (WHERE outcome='false_positive')::int AS fp,
      COUNT(*) FILTER (WHERE outcome='false_negative')::int AS fn
    FROM josiah_predictions
    WHERE created_at > NOW() - INTERVAL '7 days' AND outcome IS NOT NULL
  `;
  const s = stats[0];
  const precision = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : null;
  const recall = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : null;

  // Calibration: avg predicted confidence vs actual hit rate
  const calRows = await sql`
    SELECT AVG(prediction_confidence)::numeric AS avg_conf,
           AVG((outcome='true_positive')::int)::numeric AS hit_rate
    FROM josiah_predictions
    WHERE created_at > NOW() - INTERVAL '7 days' AND outcome IS NOT NULL
  `;
  const calibration = calRows[0]?.avg_conf && calRows[0]?.hit_rate
    ? Number(calRows[0].avg_conf) / 100 - Number(calRows[0].hit_rate)
    : null;

  // Layer 4: weight adjustments based on contributing factors of TP vs FP
  const adjustments: Record<string, number> = {};
  if (precision !== null && (s.tp + s.fp) >= 5) {
    const tpFactors = await sql`
      SELECT jsonb_object_keys(contributing_factors) AS f, COUNT(*)::int AS n
      FROM josiah_predictions WHERE outcome='true_positive' AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY 1
    `;
    const fpFactors = await sql`
      SELECT jsonb_object_keys(contributing_factors) AS f, COUNT(*)::int AS n
      FROM josiah_predictions WHERE outcome='false_positive' AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY 1
    `;
    const tpMap: any = {}, fpMap: any = {};
    for (const r of tpFactors) tpMap[r.f] = r.n;
    for (const r of fpFactors) fpMap[r.f] = r.n;
    const newW: any = { ...weights };
    for (const k of Object.keys(weights)) {
      const tpc = tpMap[k] || 0, fpc = fpMap[k] || 0;
      let mult = 1.0;
      if (tpc > fpc) mult = 1.02;
      else if (fpc > tpc) mult = 0.95;
      newW[k] = weights[k] * mult;
      if (mult !== 1.0) adjustments[k] = +(((mult - 1) * 100).toFixed(1));
    }
    const normalized = normalize(newW);
    if (Object.keys(adjustments).length) {
      await sql`
        INSERT INTO josiah_confidence_weights (weights, version, reason)
        VALUES (${JSON.stringify(normalized)}::jsonb, ${version + 1}, 'auto-recalibration')
      `;
    }
  }

  const narrative = [
    `Predictions made (7d): ${s.predictions_made}`,
    `TP: ${s.tp} · FP: ${s.fp} · FN: ${s.fn}`,
    precision !== null ? `Precision: ${(precision * 100).toFixed(1)}%` : "Precision: insufficient data",
    recall !== null ? `Recall: ${(recall * 100).toFixed(1)}%` : "Recall: insufficient data",
    f1 !== null ? `F1: ${(f1 * 100).toFixed(1)}%` : "",
    calibration !== null ? `Calibration drift: ${calibration > 0 ? "+" : ""}${(calibration * 100).toFixed(1)}% (${calibration > 0 ? "overconfident" : "underconfident"})` : "",
    Object.keys(adjustments).length ? `Weight adjustments applied: ${JSON.stringify(adjustments)}` : "No weight adjustments needed.",
  ].filter(Boolean).join("\n");

  await sql`
    INSERT INTO josiah_meta_reports (report_date, predictions_made, true_positives, false_positives, false_negatives, precision, recall, f1, calibration, weights_snapshot, adjustments, narrative)
    VALUES (CURRENT_DATE, ${s.predictions_made}, ${s.tp}, ${s.fp}, ${s.fn}, ${precision}, ${recall}, ${f1}, ${calibration}, ${JSON.stringify(weights)}::jsonb, ${JSON.stringify(adjustments)}::jsonb, ${narrative})
  `;

  return {
    ok: true,
    predictions_made: s.predictions_made,
    true_positives: s.tp, false_positives: s.fp, false_negatives: s.fn,
    precision, recall, f1, calibration,
    weights_version: version,
    weights,
    adjustments,
    narrative,
  };
}

async function actionRecentScores(sql: any) {
  const rows = await sql`
    SELECT registration, icao24, detection_timestamp, score, tier, contributing_factors, factor_scores
    FROM josiah_scored_detections
    ORDER BY created_at DESC LIMIT 100
  `;
  const tierCounts = await sql`
    SELECT tier, COUNT(*)::int AS n FROM josiah_scored_detections
    WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY tier
  `;
  return { ok: true, scored: rows, tier_counts_24h: tierCounts };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sql = postgres(NEON, { ssl: "require", max: 2, idle_timeout: 20, connect_timeout: 10 });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || "score";

    await ensureSchema(sql);

    let result: any;
    if (action === "score") result = await actionScore(sql, body);
    else if (action === "verify_predictions") result = await actionVerifyPredictions(sql);
    else if (action === "meta_report") result = await actionMetaReport(sql);
    else if (action === "recent") result = await actionRecentScores(sql);
    else result = { ok: false, error: `unknown action: ${action}` };

    return new Response(JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("josiah-confidence-engine error:", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

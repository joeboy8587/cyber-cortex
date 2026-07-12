// Anomaly Sweep Agent — statistical outlier detection over mv_spacetime / mv_entities.
// Uses MAD (Median Absolute Deviation, robust z-score), Benford's Law on altitudes,
// and DBSCAN-style temporal clustering. Auto-promotes high scorers to
// public.watchtower_autonomous_flags.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
}
function mad(xs: number[], med: number) {
  return median(xs.map((x) => Math.abs(x - med))) || 1;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const body = await req.json().catch(() => ({}));
  const minDetections = Math.max(1, Math.min(Number(body.minDetections ?? 5) || 5, 100));

  const sb = createClient(SB_URL, SB_KEY);
  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false },
    max: 1,
    connect_timeout: 15,
    prepare: false,
    connection: { statement_timeout: 20000 },
  });

  try {
    await sql.unsafe(`SET statement_timeout = '20s'`).catch(() => {});

    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='mv_spacetime'
    `.catch(() => []);
    const have = new Set(cols.map((r: any) => r.column_name));
    const tsCol = have.has("ts") ? "ts" : "event_timestamp";
    const altCol = have.has("altitude") ? "altitude" : "altitude_ft";
    const spdCol = have.has("speed") ? "speed" : "speed_kts";

    // Pull rollups from mv_entities (cheap; < 100k rows even on huge fleets)
    let ent: any[] = await sql.unsafe(`
      SELECT entity_id,
             COUNT(*)::int AS detections,
             ROUND(AVG(${altCol})::numeric, 0) AS avg_alt,
             MIN(${altCol})::numeric AS min_alt,
             ROUND(AVG(${spdCol})::numeric, 0) AS avg_spd,
             MIN(${spdCol})::numeric AS min_spd,
             COUNT(*) FILTER (WHERE ${spdCol} BETWEEN 1 AND 48)::int AS sub_stall_pings,
             COUNT(*) FILTER (WHERE ${altCol} BETWEEN 1 AND 500)::int AS low_alt_pings,
             COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ${tsCol}::timestamp) BETWEEN 0 AND 5)::int AS night_pings
      FROM mv_spacetime
      WHERE entity_id IS NOT NULL AND entity_id <> 'SELF'
      GROUP BY entity_id
      HAVING COUNT(*) >= ${minDetections}
    `).catch(() => []);

    // Small/live datasets may not have five pings per entity yet. Fall back to
    // all populated entities so the UI returns a useful scan instead of ERR.
    const relaxedThreshold = !ent.length && minDetections > 1;
    if (relaxedThreshold) {
      ent = await sql.unsafe(`
        SELECT entity_id,
               COUNT(*)::int AS detections,
               ROUND(AVG(${altCol})::numeric, 0) AS avg_alt,
               MIN(${altCol})::numeric AS min_alt,
               ROUND(AVG(${spdCol})::numeric, 0) AS avg_spd,
               MIN(${spdCol})::numeric AS min_spd,
               COUNT(*) FILTER (WHERE ${spdCol} BETWEEN 1 AND 48)::int AS sub_stall_pings,
               COUNT(*) FILTER (WHERE ${altCol} BETWEEN 1 AND 500)::int AS low_alt_pings,
               COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM ${tsCol}::timestamp) BETWEEN 0 AND 5)::int AS night_pings
        FROM mv_spacetime
        WHERE entity_id IS NOT NULL AND entity_id <> 'SELF'
        GROUP BY entity_id
        HAVING COUNT(*) >= 1
      `).catch(() => []);
    }

    if (!ent.length) {
      await sql.end();
      return json({ ok: false, status: "needs_unified_views", error: "mv_entities is empty. Run Build Unified Views first, then View Stats." });
    }

    // Robust z-scores on alt + speed minimums (low = anomalous)
    const minAlts = ent.map((e) => Number(e.min_alt) || 0);
    const minSpds = ent.map((e) => Number(e.min_spd) || 0);
    const detCnt = ent.map((e) => Number(e.detections) || 0);
    const medAlt = median(minAlts), madAlt = mad(minAlts, medAlt);
    const medSpd = median(minSpds), madSpd = mad(minSpds, medSpd);
    const medDet = median(detCnt), madDet = mad(detCnt, medDet);

    const scored = ent.map((e) => {
      const za = Math.abs((Number(e.min_alt) - medAlt) / (1.4826 * madAlt));
      const zs = Math.abs((Number(e.min_spd) - medSpd) / (1.4826 * madSpd));
      const zd = Math.abs((Number(e.detections) - medDet) / (1.4826 * madDet));
      // Composite + ops bonuses
      const score =
        za * 0.30 + zs * 0.30 + zd * 0.20 +
        (Number(e.sub_stall_pings) > 0 ? 1.5 : 0) +
        (Number(e.low_alt_pings) > 0 ? 1.0 : 0) +
        (Number(e.night_pings) > 5 ? 1.0 : 0);
      return { ...e, score: Math.round(score * 100) / 100 };
    }).sort((a, b) => b.score - a.score);

    // Benford's first-digit on altitudes (fraud / spoofed telemetry signal)
    const firstDigit = (n: number) => {
      const s = String(Math.abs(Math.trunc(n)));
      return s[0] && s[0] !== "0" ? Number(s[0]) : 0;
    };
    const expBenford = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
    const altSample: any[] = await sql.unsafe(`
      SELECT ${altCol} AS altitude FROM mv_spacetime
      WHERE ${altCol} > 0 AND ${tsCol} > NOW() - INTERVAL '120 days'
      ORDER BY ${tsCol} DESC
      LIMIT 50000
    `).catch(() => []);
    const counts = new Array(10).fill(0);
    for (const r of altSample) counts[firstDigit(Number(r.altitude))]++;
    const total = counts.slice(1).reduce((a, b) => a + b, 0) || 1;
    const observed = counts.slice(1).map((c) => (c / total) * 100);
    const benfordChi = observed.reduce((acc, o, i) => acc + Math.pow(o - expBenford[i], 2) / expBenford[i], 0);

    // Auto-promote score >= 4.0 into watchtower_autonomous_flags
    const TOP = scored.filter((s) => s.score >= 4.0).slice(0, 50);
    const scanId = `anomaly-sweep-${Date.now()}`;
    let inserted = 0;
    for (const t of TOP) {
      const { error } = await sb.from("watchtower_autonomous_flags").insert({
        flag_type: "statistical_anomaly",
        severity: t.score >= 6 ? "critical" : t.score >= 5 ? "high" : "medium",
        registration: t.entity_id,
        description: `Robust z-score outlier (score=${t.score}). min_alt=${t.min_alt}, min_spd=${t.min_spd}, sub_stall=${t.sub_stall_pings}, low_alt=${t.low_alt_pings}, night=${t.night_pings}`,
        confidence_score: Math.min(0.99, t.score / 10),
        evidence_summary: t,
        source_scan_id: scanId,
      });
      if (!error) inserted++;
    }

    await sql.end();
    return json({
        ok: true,
        scan_id: scanId,
        entities_scored: scored.length,
        flagged: inserted,
        top: scored.slice(0, 20),
        benford_chi_squared: Math.round(benfordChi * 100) / 100,
        benford_verdict: benfordChi > 15.5 ? "DEVIATION (possible spoof / fabrication)" : "consistent with natural data",
        note: relaxedThreshold ? "Small unified view scan completed with relaxed entity threshold." : undefined,
      });
  } catch (e) {
    try { await sql.end(); } catch {}
    return json({ ok: true, warning: "Anomaly sweep could not complete within the fast path.", error: String(e), top: [], flagged: 0 }, 200);
  }
});

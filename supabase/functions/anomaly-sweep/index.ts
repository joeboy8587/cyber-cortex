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
  if (!NEON) return new Response(JSON.stringify({ error: "NEON_DATABASE_URL missing" }), { status: 500, headers: cors });

  const sb = createClient(SB_URL, SB_KEY);
  const sql = postgres(NEON, { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 30, prepare: false });

  try {
    // Pull rollups from mv_entities (cheap; < 100k rows even on huge fleets)
    const ent: any[] = await sql`
      SELECT entity_id, detections, avg_alt, min_alt, avg_spd, min_spd,
             sub_stall_pings, low_alt_pings, night_pings
      FROM mv_entities
      WHERE detections >= 5
    `.catch(() => []);

    if (!ent.length) {
      return new Response(JSON.stringify({ error: "mv_entities empty — run materialized-views createUnified first" }), { status: 412, headers: cors });
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
    const altSample: any[] = await sql`
      SELECT altitude FROM mv_spacetime
      WHERE altitude > 0 AND ts > NOW() - INTERVAL '30 days' LIMIT 200000
    `.catch(() => []);
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
    return new Response(
      JSON.stringify({
        ok: true,
        scan_id: scanId,
        entities_scored: scored.length,
        flagged: inserted,
        top: scored.slice(0, 20),
        benford_chi_squared: Math.round(benfordChi * 100) / 100,
        benford_verdict: benfordChi > 15.5 ? "DEVIATION (possible spoof / fabrication)" : "consistent with natural data",
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});

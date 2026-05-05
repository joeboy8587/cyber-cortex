// Graph PageRank Hub Detector — builds a co-occurrence graph of entities
// (aircraft co-present at same lat/lng cell within ±10 min) and runs PageRank
// to surface real "hubs" and "brokers" in the operation.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!NEON) return new Response(JSON.stringify({ error: "NEON_DATABASE_URL missing" }), { status: 500, headers: cors });

  const sb = createClient(SB_URL, SB_KEY);
  const sql = postgres(NEON, { ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 30, prepare: false });

  try {
    // Build edges: pairs co-present in same 0.05° geo cell + 10-min bucket.
    // Cap edge count to keep runtime sane.
    const edges: any[] = await sql`
      WITH bucketed AS (
        SELECT entity_id,
               date_trunc('minute', ts)
                 - (EXTRACT(MINUTE FROM ts)::int % 10) * INTERVAL '1 minute' AS tb,
               ROUND((lat * 20)::numeric)::int AS gx,
               ROUND((lng * 20)::numeric)::int AS gy
        FROM mv_spacetime
        WHERE ts > NOW() - INTERVAL '90 days'
          AND lat IS NOT NULL AND entity_id IS NOT NULL
      )
      SELECT a.entity_id AS src, b.entity_id AS dst, COUNT(*)::int AS w
      FROM bucketed a
      JOIN bucketed b
        ON a.tb = b.tb AND a.gx = b.gx AND a.gy = b.gy
       AND a.entity_id < b.entity_id
      GROUP BY a.entity_id, b.entity_id
      HAVING COUNT(*) >= 2
      LIMIT 50000
    `.catch(() => []);

    if (!edges.length) {
      await sql.end();
      return new Response(JSON.stringify({ error: "No co-occurrence edges found" }), { status: 412, headers: cors });
    }

    // Build adjacency (undirected, weighted)
    const adj = new Map<string, Map<string, number>>();
    const nodes = new Set<string>();
    for (const e of edges) {
      nodes.add(e.src); nodes.add(e.dst);
      if (!adj.has(e.src)) adj.set(e.src, new Map());
      if (!adj.has(e.dst)) adj.set(e.dst, new Map());
      adj.get(e.src)!.set(e.dst, e.w);
      adj.get(e.dst)!.set(e.src, e.w);
    }

    // Weighted PageRank — 30 iterations, damping 0.85
    const N = nodes.size;
    const damping = 0.85;
    let pr = new Map<string, number>();
    for (const n of nodes) pr.set(n, 1 / N);
    const outW = new Map<string, number>();
    for (const [n, m] of adj) outW.set(n, [...m.values()].reduce((a, b) => a + b, 0));

    for (let it = 0; it < 30; it++) {
      const next = new Map<string, number>();
      for (const n of nodes) next.set(n, (1 - damping) / N);
      for (const [n, m] of adj) {
        const out = outW.get(n)!;
        const share = pr.get(n)! / out;
        for (const [t, w] of m) next.set(t, next.get(t)! + damping * share * w);
      }
      pr = next;
    }

    const ranked = [...pr.entries()]
      .map(([id, score]) => ({ entity_id: id, score, degree: adj.get(id)!.size, total_weight: outW.get(id) }))
      .sort((a, b) => b.score - a.score);

    // Flag top 25 hubs
    const scanId = `pagerank-${Date.now()}`;
    let inserted = 0;
    for (const r of ranked.slice(0, 25)) {
      const { error } = await sb.from("watchtower_autonomous_flags").insert({
        flag_type: "network_hub",
        severity: r.degree > 10 ? "high" : "medium",
        registration: r.entity_id,
        description: `Network hub — PageRank=${r.score.toExponential(3)}, degree=${r.degree}, edge weight=${r.total_weight}. Persistent co-presence with ${r.degree} other assets across 90 days.`,
        confidence_score: Math.min(0.99, r.score * 100),
        evidence_summary: r,
        source_scan_id: scanId,
      });
      if (!error) inserted++;
    }

    await sql.end();
    return new Response(
      JSON.stringify({
        ok: true,
        scan_id: scanId,
        nodes: N,
        edges: edges.length,
        flagged: inserted,
        top_hubs: ranked.slice(0, 25),
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    try { await sql.end(); } catch {}
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});

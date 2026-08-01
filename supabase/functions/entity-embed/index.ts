// Entity Behavioral Embeddings — Phase B
// Trains a small linear autoencoder (pure numeric, no ML runtime) over the
// per-aircraft behavioural feature vectors in `ml_features_daily`, stores a
// 8-dim embedding per aircraft in `entity_embeddings`, computes nearest
// "behavioural twins", and writes them back as `behavior` edges in the
// entity graph. Deterministic (seeded init) so any cluster is reproducible.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FEATURES = [
  "pings", "distinct_callsigns", "alt_min", "alt_avg", "alt_sigma",
  "spd_avg", "spd_sigma", "sub_stall_pct", "zero_alt_pct", "night_pct",
  "low_alt_pct", "in_aoi_pct", "aoi_min_mi",
];
const DIM = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 100000 },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 90, 7), 730);
    const maxAircraft = Math.min(Math.max(Number(body.maxAircraft) || 1500, 100), 4000);
    const epochs = Math.min(Math.max(Number(body.epochs) || 120, 20), 400);
    const t0 = Date.now();

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS entity_embeddings (
        icao24     text PRIMARY KEY,
        registration text,
        vec        double precision[] NOT NULL,
        recon_error double precision,
        neighbors  jsonb,
        model_hash text,
        updated_at timestamptz DEFAULT NOW()
      )`);

    // Per-aircraft averaged feature vector (feature store preferred).
    let rows: Array<Record<string, unknown>> = [];
    let source = "ml_features_daily";
    try {
      rows = await sql.unsafe(`
        SELECT icao24,
               ${FEATURES.map((f) => `AVG(COALESCE(${f}, 0))::float8 AS ${f}`).join(", ")},
               SUM(COALESCE(pings,0))::float8 AS total_pings
        FROM ml_features_daily
        WHERE day >= CURRENT_DATE - INTERVAL '${days} days'
        GROUP BY icao24
        HAVING SUM(COALESCE(pings,0)) >= 10
        ORDER BY SUM(COALESCE(pings,0)) DESC
        LIMIT ${maxAircraft}
      `) as Array<Record<string, unknown>>;
    } catch { rows = []; }

    // Fallback: derive the same feature shape straight from the detection archive.
    if (rows.length < 20) {
      source = "live_flight_detections_rows";
      rows = await sql.unsafe(`
        WITH base AS (
          SELECT LOWER(icao24) AS icao24, callsign, detection_timestamp AS ts,
                 latitude, longitude, altitude, speed
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
            AND icao24 IS NOT NULL AND TRIM(icao24) <> ''
            AND latitude IS NOT NULL AND longitude IS NOT NULL
        )
        SELECT icao24,
               COUNT(*)::float8 AS pings,
               COUNT(DISTINCT callsign)::float8 AS distinct_callsigns,
               COALESCE(MIN(altitude), 0)::float8 AS alt_min,
               COALESCE(AVG(altitude), 0)::float8 AS alt_avg,
               COALESCE(STDDEV_POP(altitude), 0)::float8 AS alt_sigma,
               COALESCE(AVG(speed), 0)::float8 AS spd_avg,
               COALESCE(STDDEV_POP(speed), 0)::float8 AS spd_sigma,
               AVG(CASE WHEN speed IS NOT NULL AND speed > 0 AND speed < 48 THEN 1.0 ELSE 0 END)::float8 AS sub_stall_pct,
               AVG(CASE WHEN altitude IS NOT NULL AND altitude <= 1 THEN 1.0 ELSE 0 END)::float8 AS zero_alt_pct,
               AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END)::float8 AS night_pct,
               AVG(CASE WHEN altitude IS NOT NULL AND altitude < 1000 THEN 1.0 ELSE 0 END)::float8 AS low_alt_pct,
               AVG(CASE WHEN ${HAV} <= 10 THEN 1.0 ELSE 0 END)::float8 AS in_aoi_pct,
               MIN(${HAV})::float8 AS aoi_min_mi,
               COUNT(*)::float8 AS total_pings
        FROM base
        GROUP BY icao24
        HAVING COUNT(*) >= 10
        ORDER BY COUNT(*) DESC
        LIMIT ${maxAircraft}
      `) as Array<Record<string, unknown>>;
    }

    if (rows.length < 20) {
      return json({
        ok: false,
        error: `Only ${rows.length} aircraft with enough recent activity to train on — widen the day range.`,
      }, 400);
    }


    // Standardize.
    const X = rows.map((r) => FEATURES.map((f) => Number(r[f]) || 0));
    const mean = FEATURES.map((_, j) => X.reduce((s, x) => s + x[j], 0) / X.length);
    const sd = FEATURES.map((_, j) =>
      Math.sqrt(X.reduce((s, x) => s + (x[j] - mean[j]) ** 2, 0) / X.length) || 1);
    const Z = X.map((x) => x.map((v, j) => clamp((v - mean[j]) / sd[j], -5, 5)));

    // Linear autoencoder: DIM latent, trained with SGD (deterministic init).
    const F = FEATURES.length;
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const W1 = Array.from({ length: F }, () => Array.from({ length: DIM }, () => rnd() * 0.3));
    const W2 = Array.from({ length: DIM }, () => Array.from({ length: F }, () => rnd() * 0.3));
    const lr = 0.01;

    for (let ep = 0; ep < epochs; ep++) {
      for (const z of Z) {
        const h = new Array(DIM).fill(0);
        for (let k = 0; k < DIM; k++) { let s = 0; for (let j = 0; j < F; j++) s += z[j] * W1[j][k]; h[k] = s; }
        const yh = new Array(F).fill(0);
        for (let j = 0; j < F; j++) { let s = 0; for (let k = 0; k < DIM; k++) s += h[k] * W2[k][j]; yh[j] = s; }
        const err = yh.map((v, j) => v - z[j]);
        const dh = new Array(DIM).fill(0);
        for (let k = 0; k < DIM; k++) {
          let s = 0;
          for (let j = 0; j < F; j++) { s += err[j] * W2[k][j]; W2[k][j] -= lr * err[j] * h[k]; }
          dh[k] = s;
        }
        for (let j = 0; j < F; j++) for (let k = 0; k < DIM; k++) W1[j][k] -= lr * dh[k] * z[j];
      }
    }

    // Encode + reconstruction error.
    const embeds = Z.map((z) => {
      const h = new Array(DIM).fill(0);
      for (let k = 0; k < DIM; k++) { let s = 0; for (let j = 0; j < F; j++) s += z[j] * W1[j][k]; h[k] = s; }
      const yh = new Array(F).fill(0);
      for (let j = 0; j < F; j++) { let s = 0; for (let k = 0; k < DIM; k++) s += h[k] * W2[k][j]; yh[j] = s; }
      const mse = yh.reduce((s, v, j) => s + (v - z[j]) ** 2, 0) / F;
      return { h, mse };
    });

    const modelHash = await sha256(JSON.stringify({ FEATURES, DIM, epochs, days, W1, W2 }).slice(0, 200000));

    // Nearest behavioural twins (cosine).
    const norm = embeds.map((e) => Math.sqrt(e.h.reduce((s, v) => s + v * v, 0)) || 1);
    const neighbors: string[][] = [];
    const simRows: Array<{ a: string; b: string; sim: number }> = [];
    for (let i = 0; i < embeds.length; i++) {
      const scored: Array<{ id: string; sim: number }> = [];
      for (let j = 0; j < embeds.length; j++) {
        if (i === j) continue;
        let dot = 0;
        for (let k = 0; k < DIM; k++) dot += embeds[i].h[k] * embeds[j].h[k];
        const sim = dot / (norm[i] * norm[j]);
        if (sim > 0.9) scored.push({ id: String(rows[j].icao24), sim });
      }
      scored.sort((a, b) => b.sim - a.sim);
      const top = scored.slice(0, 5);
      neighbors.push(top.map((t) => t.id));
      for (const t of top) {
        const a = String(rows[i].icao24), b = t.id;
        if (a < b) simRows.push({ a, b, sim: t.sim });
      }
      if (!neighbors[i]) neighbors[i] = [];
      // store full objects later via JSON
      (embeds[i] as unknown as { top: typeof top }).top = top;
    }

    // Persist embeddings.
    for (let i = 0; i < rows.length; i += 300) {
      const chunk = rows.slice(i, i + 300);
      const values = chunk.map((r, idx) => {
        const g = i + idx;
        const vec = `ARRAY[${embeds[g].h.map((v) => v.toFixed(6)).join(",")}]::double precision[]`;
        const nb = JSON.stringify((embeds[g] as unknown as { top: Array<{ id: string; sim: number }> }).top || []);
        return `('${String(r.icao24).replace(/'/g, "")}', ${vec}, ${embeds[g].mse.toFixed(6)}, '${nb.replace(/'/g, "")}'::jsonb, '${modelHash}')`;
      }).join(",");
      await sql.unsafe(`
        INSERT INTO entity_embeddings (icao24, vec, recon_error, neighbors, model_hash)
        VALUES ${values}
        ON CONFLICT (icao24) DO UPDATE SET
          vec = EXCLUDED.vec, recon_error = EXCLUDED.recon_error,
          neighbors = EXCLUDED.neighbors, model_hash = EXCLUDED.model_hash, updated_at = NOW()
      `);
    }

    // Map icao24 → registration using the graph nodes (FAA-backed).
    await sql.unsafe(`
      UPDATE entity_embeddings e
      SET registration = n.registration
      FROM entity_graph_nodes n
      WHERE n.node_type = 'aircraft' AND LOWER(n.icao_hex) = LOWER(e.icao24)
    `).catch(() => {});

    // Behavioural-twin edges back into the graph.
    let behaviorEdges = 0;
    try {
      await sql.unsafe(`DELETE FROM entity_graph_edges WHERE edge_type = 'behavior'`);
      for (let i = 0; i < simRows.length; i += 400) {
        const chunk = simRows.slice(i, i + 400);
        const values = chunk.map((s) =>
          `('${s.a.replace(/'/g, "")}','${s.b.replace(/'/g, "")}',${s.sim.toFixed(4)})`).join(",");
        if (!values) continue;
        const r = await sql.unsafe(`
          INSERT INTO entity_graph_edges (src, dst, edge_type, weight, detail, updated_at)
          SELECT na.node_id, nb.node_id, 'behavior', v.sim,
                 'behavioural similarity ' || ROUND((v.sim*100)::numeric,1) || '%', NOW()
          FROM (VALUES ${values}) AS v(a, b, sim)
          JOIN entity_graph_nodes na ON LOWER(na.icao_hex) = LOWER(v.a) AND na.node_type='aircraft'
          JOIN entity_graph_nodes nb ON LOWER(nb.icao_hex) = LOWER(v.b) AND nb.node_type='aircraft'
          WHERE na.node_id <> nb.node_id
          ON CONFLICT (src, dst, edge_type) DO UPDATE SET weight = EXCLUDED.weight, updated_at = NOW()
          RETURNING 1
        `) as unknown[];
        behaviorEdges += r.length;
      }
    } catch { /* graph tables may not exist yet */ }

    const avgMse = embeds.reduce((s, e) => s + e.mse, 0) / embeds.length;
    const outliers = rows
      .map((r, i) => ({ icao24: String(r.icao24), recon_error: +embeds[i].mse.toFixed(4) }))
      .sort((a, b) => b.recon_error - a.recon_error).slice(0, 20);

    return json({
      ok: true, aircraft: rows.length, features: F, latent_dim: DIM, epochs,
      avg_recon_error: +avgMse.toFixed(5), behavior_edges: behaviorEdges,
      model_hash: modelHash, outliers, elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

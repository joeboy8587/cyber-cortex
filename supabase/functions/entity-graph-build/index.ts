// Entity Profile Graph — Phase A
// Builds `entity_graph_nodes` / `entity_graph_edges` in Neon from:
//   • FAA-authoritative identity (v_faa_identity) — never feed operator strings
//   • registrant links (aircraft → operator/LLC)
//   • spatio-temporal co-presence (same ~0.05° cell, same 10-min bucket)
//   • flag / violation counts pulled from the Supabase forensic tables
// Also serves read actions for the /network-intel UI: graph, profile, rank.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const AOI_LAT = 35.4377286;
const AOI_LNG = -119.0252189;

const HAV = (latCol: string, lngCol: string) => `
  3958.8 * 2 * asin(sqrt(
    power(sin(radians((${latCol} - ${AOI_LAT})/2)), 2) +
    cos(radians(${AOI_LAT})) * cos(radians(${latCol})) *
    power(sin(radians((${lngCol} - ${AOI_LNG})/2)), 2)))`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false },
    max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 100000 },
  });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "graph");

    await ensureSchema(sql);

    if (action === "build") return json(await build(sql, body));
    if (action === "graph") return json(await graph(sql, body));
    if (action === "profile") return json(await profile(sql, body));
    if (action === "rank") return json(await rank(sql, body));
    return json({ ok: false, error: `unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

async function ensureSchema(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS entity_graph_nodes (
      node_id       text PRIMARY KEY,
      node_type     text NOT NULL,               -- aircraft | operator
      label         text,
      registration  text,
      icao_hex      text,
      operator      text,
      operator_type text,
      operator_city text,
      operator_state text,
      aircraft_type text,
      detections    bigint DEFAULT 0,
      days_active   int DEFAULT 0,
      aoi_min_mi    numeric,
      aoi_pings     bigint DEFAULT 0,
      night_pct     numeric,
      low_alt_pct   numeric,
      sub_stall_pct numeric,
      min_altitude  numeric,
      flag_count    int DEFAULT 0,
      critical_flags int DEFAULT 0,
      violation_count int DEFAULT 0,
      centrality    numeric DEFAULT 0,
      risk_score    numeric DEFAULT 0,
      first_seen    timestamptz,
      last_seen     timestamptz,
      updated_at    timestamptz DEFAULT NOW()
    )`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS entity_graph_edges (
      src        text NOT NULL,
      dst        text NOT NULL,
      edge_type  text NOT NULL,                  -- registrant | copresence | behavior
      weight     numeric DEFAULT 1,
      detail     text,
      updated_at timestamptz DEFAULT NOW(),
      PRIMARY KEY (src, dst, edge_type)
    )`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_egn_risk ON entity_graph_nodes(risk_score DESC)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ege_src ON entity_graph_edges(src)`);
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_ege_dst ON entity_graph_edges(dst)`);
}

async function build(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const days = Math.min(Math.max(Number(body.days) || 30, 1), 365);
  const maxPairs = Math.min(Math.max(Number(body.maxPairs) || 20000, 500), 60000);
  const t0 = Date.now();

  // ── 1. Aircraft nodes (FAA identity is authoritative) ────────────────────
  await sql.unsafe(`
    WITH base AS (
      SELECT UPPER(TRIM(d.registration)) AS reg,
             d.icao24, d.detection_timestamp AS ts,
             d.latitude, d.longitude, d.altitude, d.speed
      FROM live_flight_detections_rows d
      WHERE d.detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND d.registration IS NOT NULL AND TRIM(d.registration) <> ''
        AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
    ),
    agg AS (
      SELECT reg,
             MAX(icao24) AS icao_hex,
             COUNT(*)::bigint AS detections,
             COUNT(DISTINCT DATE(ts))::int AS days_active,
             MIN(ts) AS first_seen, MAX(ts) AS last_seen,
             MIN(altitude) AS min_altitude,
             AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END) AS night_pct,
             AVG(CASE WHEN altitude IS NOT NULL AND altitude < 1000 THEN 1.0 ELSE 0 END) AS low_alt_pct,
             AVG(CASE WHEN speed IS NOT NULL AND speed > 0 AND speed < 48 THEN 1.0 ELSE 0 END) AS sub_stall_pct,
             MIN(${HAV("latitude", "longitude")}) AS aoi_min_mi,
             COUNT(*) FILTER (WHERE ${HAV("latitude", "longitude")} <= 10)::bigint AS aoi_pings
      FROM base
      GROUP BY reg
      HAVING COUNT(*) >= 3
    )
    INSERT INTO entity_graph_nodes (
      node_id, node_type, label, registration, icao_hex, operator, operator_type,
      operator_city, operator_state, aircraft_type, detections, days_active,
      aoi_min_mi, aoi_pings, night_pct, low_alt_pct, sub_stall_pct, min_altitude,
      first_seen, last_seen, updated_at)
    SELECT 'AC:' || a.reg, 'aircraft', a.reg, a.reg, a.icao_hex,
           f.registrant_name, f.registrant_type, f.registrant_city, f.registrant_state,
           NULLIF(TRIM(CONCAT_WS(' ', f.aircraft_manufacturer, f.aircraft_model)), ''),
           a.detections, a.days_active, a.aoi_min_mi, a.aoi_pings,
           a.night_pct, a.low_alt_pct, a.sub_stall_pct, a.min_altitude,
           a.first_seen, a.last_seen, NOW()
    FROM agg a
    LEFT JOIN v_faa_identity f ON f.n_number = a.reg
    ON CONFLICT (node_id) DO UPDATE SET
      icao_hex = EXCLUDED.icao_hex, operator = EXCLUDED.operator,
      operator_type = EXCLUDED.operator_type, operator_city = EXCLUDED.operator_city,
      operator_state = EXCLUDED.operator_state, aircraft_type = EXCLUDED.aircraft_type,
      detections = EXCLUDED.detections, days_active = EXCLUDED.days_active,
      aoi_min_mi = EXCLUDED.aoi_min_mi, aoi_pings = EXCLUDED.aoi_pings,
      night_pct = EXCLUDED.night_pct, low_alt_pct = EXCLUDED.low_alt_pct,
      sub_stall_pct = EXCLUDED.sub_stall_pct, min_altitude = EXCLUDED.min_altitude,
      first_seen = LEAST(entity_graph_nodes.first_seen, EXCLUDED.first_seen),
      last_seen = GREATEST(entity_graph_nodes.last_seen, EXCLUDED.last_seen),
      updated_at = NOW()
  `);

  // ── 2. Operator nodes + registrant edges ─────────────────────────────────
  await sql.unsafe(`
    INSERT INTO entity_graph_nodes (
      node_id, node_type, label, operator, operator_type, operator_city, operator_state,
      detections, days_active, aoi_pings, first_seen, last_seen, updated_at)
    SELECT 'OP:' || UPPER(operator), 'operator', operator, operator,
           MAX(operator_type), MAX(operator_city), MAX(operator_state),
           SUM(detections), MAX(days_active), SUM(aoi_pings),
           MIN(first_seen), MAX(last_seen), NOW()
    FROM entity_graph_nodes
    WHERE node_type = 'aircraft' AND operator IS NOT NULL AND operator <> ''
    GROUP BY UPPER(operator), operator
    ON CONFLICT (node_id) DO UPDATE SET
      detections = EXCLUDED.detections, aoi_pings = EXCLUDED.aoi_pings,
      days_active = EXCLUDED.days_active, last_seen = EXCLUDED.last_seen, updated_at = NOW()
  `);

  await sql.unsafe(`
    INSERT INTO entity_graph_edges (src, dst, edge_type, weight, detail, updated_at)
    SELECT node_id, 'OP:' || UPPER(operator), 'registrant', 1,
           'FAA registrant of record', NOW()
    FROM entity_graph_nodes
    WHERE node_type = 'aircraft' AND operator IS NOT NULL AND operator <> ''
    ON CONFLICT (src, dst, edge_type) DO UPDATE SET updated_at = NOW()
  `);

  // ── 3. Co-presence edges (same 0.05° cell, same 10-min bucket) ───────────
  const cop = await sql.unsafe(`
    WITH bucketed AS (
      SELECT DISTINCT UPPER(TRIM(registration)) AS reg,
             date_trunc('hour', detection_timestamp)
               + (FLOOR(EXTRACT(MINUTE FROM detection_timestamp) / 10) * INTERVAL '10 minutes') AS tb,
             ROUND((latitude * 20)::numeric)::int  AS gx,
             ROUND((longitude * 20)::numeric)::int AS gy
      FROM live_flight_detections_rows
      WHERE detection_timestamp >= NOW() - INTERVAL '${days} days'
        AND registration IS NOT NULL AND TRIM(registration) <> ''
        AND latitude IS NOT NULL AND longitude IS NOT NULL
    ),
    pairs AS (
      SELECT a.reg AS r1, b.reg AS r2, COUNT(*)::int AS w
      FROM bucketed a
      JOIN bucketed b ON a.tb = b.tb AND a.gx = b.gx AND a.gy = b.gy AND a.reg < b.reg
      GROUP BY a.reg, b.reg
      HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC
      LIMIT ${maxPairs}
    )
    INSERT INTO entity_graph_edges (src, dst, edge_type, weight, detail, updated_at)
    SELECT 'AC:' || p.r1, 'AC:' || p.r2, 'copresence', p.w,
           p.w || ' shared time/space windows', NOW()
    FROM pairs p
    WHERE EXISTS (SELECT 1 FROM entity_graph_nodes n WHERE n.node_id = 'AC:' || p.r1)
      AND EXISTS (SELECT 1 FROM entity_graph_nodes n WHERE n.node_id = 'AC:' || p.r2)
    ON CONFLICT (src, dst, edge_type) DO UPDATE SET
      weight = EXCLUDED.weight, detail = EXCLUDED.detail, updated_at = NOW()
    RETURNING 1
  `) as unknown[];

  // ── 4. Flag / violation counts from the Supabase forensic tables ─────────
  let flagged = 0;
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const counts = new Map<string, { flags: number; critical: number }>();
    const CRIT = new Set([
      "PHYSICS_VIOLATION", "ALTITUDE_ANOMALY", "LAYERED_DECEPTION", "BIOMETRIC_CORRELATION",
      "XXB_MLAT_ANOMALY", "FICTITIOUS_TAIL_NUMBER_NO_FAA_REGISTRY", "ICAO_FAA_HEX_MISMATCH",
    ]);
    for (let page = 0; page < 10; page++) {
      const { data, error } = await sb
        .from("watchtower_autonomous_flags")
        .select("registration, flag_type, occurrence_count")
        .eq("auto_resolved", false)
        .not("registration", "is", null)
        .range(page * 1000, page * 1000 + 999);
      if (error || !data?.length) break;
      for (const r of data) {
        const key = String(r.registration).toUpperCase().trim();
        if (!key) continue;
        const cur = counts.get(key) || { flags: 0, critical: 0 };
        cur.flags += Number(r.occurrence_count) || 1;
        if (CRIT.has(String(r.flag_type || "").toUpperCase())) cur.critical += 1;
        counts.set(key, cur);
      }
      if (data.length < 1000) break;
    }
    const rows = [...counts.entries()];
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = chunk
        .map(([reg, c]) => `('AC:${reg.replace(/'/g, "")}', ${c.flags}, ${c.critical})`)
        .join(",");
      if (!values) continue;
      await sql.unsafe(`
        UPDATE entity_graph_nodes n
        SET flag_count = v.f, critical_flags = v.c
        FROM (VALUES ${values}) AS v(id, f, c)
        WHERE n.node_id = v.id
      `);
    }
    flagged = rows.length;
  } catch { /* flags are best-effort */ }

  // ── 5. Centrality (power iteration) + risk score ─────────────────────────
  const edges = await sql.unsafe(`
    SELECT src, dst, weight::float8 AS weight FROM entity_graph_edges
  `) as Array<{ src: string; dst: string; weight: number }>;
  const centrality = pagerank(edges);
  const centEntries = [...centrality.entries()];
  for (let i = 0; i < centEntries.length; i += 500) {
    const values = centEntries.slice(i, i + 500)
      .map(([id, v]) => `('${id.replace(/'/g, "")}', ${v.toFixed(8)})`).join(",");
    if (!values) continue;
    await sql.unsafe(`
      UPDATE entity_graph_nodes n SET centrality = v.c
      FROM (VALUES ${values}) AS v(id, c) WHERE n.node_id = v.id
    `);
  }

  await sql.unsafe(`
    WITH mx AS (SELECT GREATEST(MAX(centrality), 0.0001) AS c, GREATEST(MAX(flag_count), 1) AS f FROM entity_graph_nodes)
    UPDATE entity_graph_nodes n SET risk_score = ROUND(LEAST(100, (
        30 * LEAST(1, COALESCE(n.critical_flags, 0) / 3.0)
      + 20 * (COALESCE(n.flag_count, 0)::numeric / (SELECT f FROM mx))
      + 15 * LEAST(1, COALESCE(n.sub_stall_pct, 0) * 4)
      + 15 * CASE WHEN COALESCE(n.aoi_min_mi, 999) <= 2 THEN 1
                  WHEN COALESCE(n.aoi_min_mi, 999) <= 5 THEN 0.6
                  WHEN COALESCE(n.aoi_min_mi, 999) <= 10 THEN 0.3 ELSE 0 END
      + 10 * LEAST(1, COALESCE(n.low_alt_pct, 0) * 2)
      + 10 * (COALESCE(n.centrality, 0) / (SELECT c FROM mx))
    ))::numeric, 1), updated_at = NOW()
  `);

  const stats = await sql.unsafe(`
    SELECT
      COUNT(*) FILTER (WHERE node_type='aircraft')::int AS aircraft,
      COUNT(*) FILTER (WHERE node_type='operator')::int AS operators,
      (SELECT COUNT(*)::int FROM entity_graph_edges) AS edges,
      (SELECT COUNT(*)::int FROM entity_graph_edges WHERE edge_type='copresence') AS copresence_edges,
      (SELECT COUNT(*)::int FROM entity_graph_edges WHERE edge_type='behavior') AS behavior_edges
    FROM entity_graph_nodes
  `) as Array<Record<string, number>>;

  return {
    ok: true, action: "build", days,
    copresence_pairs: cop.length, flagged_entities: flagged,
    stats: stats[0] || {}, elapsed_ms: Date.now() - t0,
  };
}

function pagerank(edges: Array<{ src: string; dst: string; weight: number }>, iters = 20, d = 0.85) {
  const out = new Map<string, Array<[string, number]>>();
  const nodes = new Set<string>();
  for (const e of edges) {
    const w = Number(e.weight) || 1;
    nodes.add(e.src); nodes.add(e.dst);
    if (!out.has(e.src)) out.set(e.src, []);
    if (!out.has(e.dst)) out.set(e.dst, []);
    out.get(e.src)!.push([e.dst, w]);
    out.get(e.dst)!.push([e.src, w]);
  }
  const n = nodes.size || 1;
  let pr = new Map<string, number>([...nodes].map((k) => [k, 1 / n]));
  for (let i = 0; i < iters; i++) {
    const next = new Map<string, number>([...nodes].map((k) => [k, (1 - d) / n]));
    for (const [src, links] of out) {
      const total = links.reduce((s, [, w]) => s + w, 0) || 1;
      const share = (pr.get(src) || 0) * d;
      for (const [dst, w] of links) next.set(dst, (next.get(dst) || 0) + share * (w / total));
    }
    pr = next;
  }
  return pr;
}

async function graph(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 120, 10), 400);
  const aoiOnly = Boolean(body.aoiOnly);
  const flaggedOnly = Boolean(body.flaggedOnly);
  const search = String(body.search || "").trim().toUpperCase().replace(/'/g, "");
  const edgeTypes = Array.isArray(body.edgeTypes) && body.edgeTypes.length
    ? (body.edgeTypes as string[]).map((t) => `'${String(t).replace(/'/g, "")}'`).join(",")
    : `'registrant','copresence','behavior'`;

  const where = [`node_type = 'aircraft'`];
  if (aoiOnly) where.push(`COALESCE(aoi_pings,0) > 0`);
  if (flaggedOnly) where.push(`COALESCE(flag_count,0) > 0`);
  if (search) where.push(`(registration ILIKE '%${search}%' OR UPPER(COALESCE(operator,'')) LIKE '%${search}%')`);

  const aircraft = await sql.unsafe(`
    SELECT * FROM entity_graph_nodes
    WHERE ${where.join(" AND ")}
    ORDER BY risk_score DESC NULLS LAST, detections DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;

  if (!aircraft.length) return { ok: true, nodes: [], edges: [] };
  const ids = aircraft.map((n) => `'${String(n.node_id).replace(/'/g, "")}'`).join(",");

  const edges = await sql.unsafe(`
    SELECT e.src, e.dst, e.edge_type, e.weight::float8 AS weight, e.detail
    FROM entity_graph_edges e
    WHERE e.edge_type IN (${edgeTypes})
      AND (e.src IN (${ids}) OR e.dst IN (${ids}))
      AND (e.src IN (${ids}) OR e.src LIKE 'OP:%')
      AND (e.dst IN (${ids}) OR e.dst LIKE 'OP:%')
    ORDER BY e.weight DESC
    LIMIT 1500
  `) as Array<Record<string, unknown>>;

  const opIds = [...new Set(edges.flatMap((e) => [e.src, e.dst])
    .map(String).filter((id) => id.startsWith("OP:")))];
  let operators: Array<Record<string, unknown>> = [];
  if (opIds.length) {
    const list = opIds.map((i) => `'${i.replace(/'/g, "")}'`).join(",");
    operators = await sql.unsafe(`
      SELECT * FROM entity_graph_nodes WHERE node_id IN (${list})
    `) as Array<Record<string, unknown>>;
  }

  return { ok: true, nodes: [...aircraft, ...operators], edges };
}

async function profile(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const nodeId = String(body.nodeId || "").replace(/'/g, "");
  if (!nodeId) return { ok: false, error: "nodeId required" };

  const node = (await sql.unsafe(`
    SELECT * FROM entity_graph_nodes WHERE node_id = '${nodeId}'
  `) as Array<Record<string, unknown>>)[0];
  if (!node) return { ok: false, error: "node not found" };

  const neighbors = await sql.unsafe(`
    SELECT CASE WHEN e.src = '${nodeId}' THEN e.dst ELSE e.src END AS other,
           e.edge_type, e.weight::float8 AS weight, e.detail,
           n.label, n.operator, n.risk_score, n.node_type
    FROM entity_graph_edges e
    JOIN entity_graph_nodes n
      ON n.node_id = CASE WHEN e.src = '${nodeId}' THEN e.dst ELSE e.src END
    WHERE e.src = '${nodeId}' OR e.dst = '${nodeId}'
    ORDER BY e.weight DESC
    LIMIT 40
  `) as Array<Record<string, unknown>>;

  let fleet: Array<Record<string, unknown>> = [];
  if (node.operator) {
    const op = String(node.operator).replace(/'/g, "");
    fleet = await sql.unsafe(`
      SELECT registration, aircraft_type, detections, risk_score, flag_count, aoi_min_mi
      FROM entity_graph_nodes
      WHERE node_type = 'aircraft' AND UPPER(operator) = UPPER('${op}')
      ORDER BY risk_score DESC LIMIT 25
    `) as Array<Record<string, unknown>>;
  }

  let twins: Array<Record<string, unknown>> = [];
  try {
    twins = await sql.unsafe(`
      SELECT n.registration, n.operator, n.risk_score, e.weight::float8 AS similarity
      FROM entity_graph_edges e
      JOIN entity_graph_nodes n
        ON n.node_id = CASE WHEN e.src = '${nodeId}' THEN e.dst ELSE e.src END
      WHERE e.edge_type = 'behavior' AND (e.src = '${nodeId}' OR e.dst = '${nodeId}')
      ORDER BY e.weight DESC LIMIT 10
    `) as Array<Record<string, unknown>>;
  } catch { /* embeddings optional */ }

  return { ok: true, node, neighbors, fleet, twins };
}

async function rank(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 5), 250);
  const scope = String(body.scope || "aircraft") === "operator" ? "operator" : "aircraft";
  const rows = await sql.unsafe(`
    SELECT node_id, label, registration, operator, operator_type, operator_state,
           aircraft_type, detections, days_active, aoi_min_mi, aoi_pings,
           night_pct, low_alt_pct, sub_stall_pct, min_altitude,
           flag_count, critical_flags, centrality, risk_score, last_seen
    FROM entity_graph_nodes
    WHERE node_type = '${scope}'
    ORDER BY risk_score DESC NULLS LAST, flag_count DESC
    LIMIT ${limit}
  `) as Array<Record<string, unknown>>;
  return { ok: true, scope, rows };
}

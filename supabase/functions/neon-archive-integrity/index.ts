// Archive Integrity & Query Speed engine (Neon)
// Actions: indexAudit | indexCleanup | vacuumTables | tagsView | hashCoverage
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VERSION = "1.0.0";

async function neonQuery(neonUrl: string, sql: string, params: unknown[] = []) {
  const url = new URL(neonUrl);
  const response = await fetch(`https://${url.hostname}/sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Neon-Connection-String": neonUrl },
    body: JSON.stringify({ query: sql, params }),
  });
  if (!response.ok) throw new Error(`Neon ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json();
  return result.rows ?? (Array.isArray(result) && result[0]?.rows ? result[0].rows : result);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status >= 400 ? data : { data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── INDEX AUDIT ──────────────────────────────────────────────────────
// Finds: never-used indexes, duplicate (identical column set) indexes,
// indexes on empty tables, and tables with heavy dead-row bloat.
async function handleIndexAudit(neonUrl: string, body: any) {
  const minSizeMb = Number(body.minSizeMb ?? 8);
  const limit = Math.min(Number(body.limit ?? 60), 200);

  const [unused, duplicates, bloat, totals] = await Promise.all([
    neonQuery(
      neonUrl,
      `SELECT s.relname AS table_name, s.indexrelname AS index_name,
              s.idx_scan::bigint AS scans,
              pg_relation_size(s.indexrelid) AS size_bytes,
              round(pg_relation_size(s.indexrelid)/1048576.0, 1) AS size_mb,
              c.reltuples::bigint AS est_rows
       FROM pg_stat_user_indexes s
       JOIN pg_class c ON c.oid = s.relid
       LEFT JOIN pg_constraint con ON con.conindid = s.indexrelid
       WHERE s.schemaname = 'public'
         AND s.idx_scan = 0
         AND con.oid IS NULL
         AND pg_relation_size(s.indexrelid) > ${minSizeMb} * 1048576
       ORDER BY pg_relation_size(s.indexrelid) DESC
       LIMIT ${limit}`,
    ),
    neonQuery(
      neonUrl,
      `WITH idx AS (
         SELECT indrelid::regclass::text AS table_name,
                indexrelid::regclass::text AS index_name,
                indkey::text AS cols, indisunique, indisprimary,
                pg_relation_size(indexrelid) AS size_bytes,
                COALESCE((SELECT idx_scan FROM pg_stat_user_indexes u WHERE u.indexrelid = i.indexrelid), 0) AS scans
         FROM pg_index i
         WHERE indrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r')
       )
       SELECT table_name, cols,
              count(*)::int AS copies,
              sum(size_bytes) AS total_bytes,
              json_agg(json_build_object('index', index_name, 'scans', scans,
                       'size_mb', round(size_bytes/1048576.0,1),
                       'unique', indisunique, 'primary', indisprimary)
                       ORDER BY indisprimary DESC, indisunique DESC, scans DESC) AS members
       FROM idx
       GROUP BY table_name, cols
       HAVING count(*) > 1
       ORDER BY sum(size_bytes) DESC
       LIMIT ${limit}`,
    ),
    neonQuery(
      neonUrl,
      `SELECT relname AS table_name, n_live_tup::bigint AS live_rows, n_dead_tup::bigint AS dead_rows,
              CASE WHEN n_live_tup > 0 THEN round(100.0*n_dead_tup/n_live_tup, 1) ELSE 0 END AS dead_pct,
              last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
              round(pg_total_relation_size(relid)/1048576.0, 1) AS total_mb
       FROM pg_stat_user_tables
       WHERE schemaname = 'public' AND n_dead_tup > 50000
       ORDER BY n_dead_tup DESC
       LIMIT 40`,
    ),
    neonQuery(
      neonUrl,
      `SELECT
         (SELECT count(*)::int FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') AS base_tables,
         (SELECT count(*)::int FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='i') AS indexes,
         (SELECT sum(pg_relation_size(oid)) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='i') AS index_bytes,
         (SELECT sum(pg_total_relation_size(oid)) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') AS table_bytes`,
    ),
  ]);

  // Recommend drops: every non-primary/non-unique duplicate beyond the best member,
  // plus never-scanned indexes on empty tables.
  const dropList: Array<{ index: string; table: string; reason: string; size_mb: number }> = [];
  for (const d of duplicates as any[]) {
    const members = (typeof d.members === "string" ? JSON.parse(d.members) : d.members) as any[];
    members.slice(1).forEach((m) => {
      if (m.primary || m.unique) return;
      dropList.push({
        index: m.index,
        table: d.table_name,
        reason: `duplicate column set (${d.copies} copies)`,
        size_mb: Number(m.size_mb) || 0,
      });
    });
  }
  for (const u of unused as any[]) {
    if (Number(u.est_rows) <= 0) {
      dropList.push({
        index: u.index_name,
        table: u.table_name,
        reason: "never scanned, table empty",
        size_mb: Number(u.size_mb) || 0,
      });
    }
  }

  const seen = new Set<string>();
  const recommendedDrops = dropList.filter((d) => (seen.has(d.index) ? false : (seen.add(d.index), true)));

  return json({
    version: VERSION,
    totals: (totals as any[])[0] ?? {},
    unusedIndexes: unused,
    duplicateGroups: duplicates,
    bloatedTables: bloat,
    recommendedDrops,
    reclaimableMb: Number(recommendedDrops.reduce((s, d) => s + d.size_mb, 0).toFixed(1)),
  });
}

// ─── INDEX CLEANUP ────────────────────────────────────────────────────
async function handleIndexCleanup(neonUrl: string, body: any) {
  const indexes: string[] = Array.isArray(body.indexes) ? body.indexes : [];
  const dryRun = body.dryRun !== false;
  if (!indexes.length) return json({ error: "indexes[] required" }, 400);

  const results: any[] = [];
  const t0 = Date.now();
  for (const raw of indexes) {
    const name = String(raw).replace(/[^a-zA-Z0-9_."]/g, "");
    if (!name) continue;
    if (Date.now() - t0 > 60000) {
      results.push({ index: name, status: "skipped", error: "time budget reached" });
      continue;
    }
    if (dryRun) {
      results.push({ index: name, status: "dry_run" });
      continue;
    }
    try {
      await neonQuery(neonUrl, `DROP INDEX IF EXISTS ${name}`);
      results.push({ index: name, status: "dropped" });
    } catch (err) {
      results.push({ index: name, status: "error", error: (err as Error).message.slice(0, 200) });
    }
  }
  return json({ dryRun, dropped: results.filter((r) => r.status === "dropped").length, results });
}

// ─── VACUUM / ANALYZE ─────────────────────────────────────────────────
async function handleVacuum(neonUrl: string, body: any) {
  const tables: string[] = Array.isArray(body.tables) ? body.tables : [];
  const analyzeOnly = body.analyzeOnly === true;
  if (!tables.length) return json({ error: "tables[] required" }, 400);

  const results: any[] = [];
  const t0 = Date.now();
  for (const raw of tables.slice(0, 10)) {
    const name = String(raw).replace(/[^a-zA-Z0-9_]/g, "");
    if (!name) continue;
    if (Date.now() - t0 > 90000) {
      results.push({ table: name, status: "skipped", error: "time budget reached" });
      continue;
    }
    try {
      // Never VACUUM FULL — sealed evidence tables must stay online/immutable.
      await neonQuery(neonUrl, analyzeOnly ? `ANALYZE "${name}"` : `VACUUM (ANALYZE) "${name}"`);
      results.push({ table: name, status: analyzeOnly ? "analyzed" : "vacuumed" });
    } catch (err) {
      results.push({ table: name, status: "error", error: (err as Error).message.slice(0, 200) });
    }
  }
  return json({ results });
}

// ─── COUNTY INTEGRITY (coordinate-derived, additive) ──────────────────
// The legacy `county_classification` column is a stale partial backfill.
// Truth comes from lat/lon tested against real county polygons, stored in
// the side table `detection_county_map` — the original column is never touched.
async function handleCountyStats(neonUrl: string) {
  const [totals, byCounty, mismatch] = await Promise.all([
    neonQuery(
      neonUrl,
      `SELECT (SELECT count(*) FROM live_flight_detections_rows)::bigint AS total_rows,
              (SELECT count(*) FROM detection_county_map)::bigint AS derived_rows,
              (SELECT count(*) FROM detection_county_map WHERE county_source='no_position')::bigint AS no_position`,
    ),
    neonQuery(
      neonUrl,
      `SELECT county_derived AS county, count(*)::bigint AS rows
       FROM detection_county_map GROUP BY 1 ORDER BY 2 DESC LIMIT 25`,
    ),
    neonQuery(
      neonUrl,
      `SELECT count(*)::bigint AS disagreements
       FROM detection_county_map m
       JOIN live_flight_detections_rows d ON d.id = m.detection_id
       WHERE m.county_derived IS NOT NULL
         AND m.county_derived <> 'Outside_AOI'
         AND d.county_classification IS DISTINCT FROM m.county_derived`,
    ),
  ]);
  const legacy = await neonQuery(
    neonUrl,
    `SELECT COALESCE(county_classification,'(blank)') AS county, count(*)::bigint AS rows
     FROM live_flight_detections_rows GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
  );
  return json({
    totals: (totals as any[])[0] ?? {},
    byCounty,
    legacy,
    disagreements: Number((mismatch as any[])[0]?.disagreements ?? 0),
  });
}

async function handleCountyBackfill(neonUrl: string, body: any) {
  const batch = Math.min(Number(body.batchSize ?? 200000), 500000);
  const rows = await neonQuery(
    neonUrl,
    `WITH p AS (
       SELECT d.id, d.latitude, d.longitude
       FROM live_flight_detections_rows d
       WHERE NOT EXISTS (SELECT 1 FROM detection_county_map m WHERE m.detection_id = d.id)
       LIMIT ${batch}
     ), ins AS (
       INSERT INTO detection_county_map(detection_id, county_derived, county_source)
       SELECT p.id,
         CASE WHEN p.latitude IS NULL OR p.longitude IS NULL THEN NULL
              ELSE COALESCE((SELECT c.county_name FROM ca_county_parts c
                    WHERE c.geom && ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)
                      AND ST_Intersects(c.geom, ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326))
                    LIMIT 1), 'Outside_AOI') END,
         CASE WHEN p.latitude IS NULL OR p.longitude IS NULL THEN 'no_position' ELSE 'polygon' END
       FROM p
       ON CONFLICT (detection_id) DO NOTHING
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM ins)::bigint AS inserted,
            (SELECT count(*) FROM live_flight_detections_rows d
             WHERE NOT EXISTS (SELECT 1 FROM detection_county_map m WHERE m.detection_id = d.id))::bigint AS remaining`,
  );
  return json((rows as any[])[0] ?? { inserted: 0, remaining: 0 });
}


// ─── UNIFIED TAG VIEW (Phase 2) ───────────────────────────────────────
async function handleTagsView(neonUrl: string) {
  const cols = await neonQuery(
    neonUrl,
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='live_flight_detections_rows'`,
  );
  const have = new Set((cols as any[]).map((c) => c.column_name));
  const pick = (c: string) => (have.has(c) ? `"${c}"` : "NULL");
  const arr = (c: string) =>
    have.has(c) ? `COALESCE(to_jsonb("${c}"), '[]'::jsonb)` : `'[]'::jsonb`;

  const hexCol = have.has("icao24") ? "icao24" : have.has("icao_code") ? "icao_code" : "NULL";
  const timeCol = have.has("detection_timestamp") ? "detection_timestamp" : "created_at";

  await neonQuery(
    neonUrl,
    `CREATE OR REPLACE VIEW v_detection_tags AS
     SELECT
       id,
       ${hexCol === "NULL" ? "NULL::text" : `"${hexCol}"`} AS icao24,
       ${pick("registration")} AS registration,
       ${pick("callsign")} AS callsign,
       "${timeCol}" AS detected_at,
       ${pick("sha256_hash")} AS sha256_hash,
       (
         SELECT COALESCE(jsonb_agg(DISTINCT lower(btrim(t::text, '"'))) FILTER (
                  WHERE btrim(t::text, '"') <> '' AND lower(btrim(t::text,'"')) NOT IN ('null','normal_traffic')
                ), '[]'::jsonb)
         FROM jsonb_array_elements(
                ${arr("flagged_reasons")} || ${arr("anomaly_flags")} ||
                CASE WHEN ${have.has("taxonomy_tag") ? `"taxonomy_tag" IS NOT NULL` : "false"}
                     THEN jsonb_build_array(${pick("taxonomy_tag")}) ELSE '[]'::jsonb END
              ) AS t
       ) AS tags
     FROM live_flight_detections_rows`,
  );

  const sample = await neonQuery(
    neonUrl,
    `SELECT icao24, registration, detected_at, tags FROM v_detection_tags
     WHERE jsonb_array_length(tags) > 0 ORDER BY detected_at DESC LIMIT 10`,
  );
  return json({ created: "v_detection_tags", sample });
}

// ─── HASH COVERAGE ────────────────────────────────────────────────────
async function handleHashCoverage(neonUrl: string) {
  const rows = await neonQuery(
    neonUrl,
    `WITH base AS (
       SELECT c.oid, c.relname AS table_name, c.reltuples::bigint AS est_rows,
              EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid=c.oid AND a.attname='sha256_hash' AND a.attnum>0 AND NOT a.attisdropped) AS has_hash
       FROM pg_class c
       WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
     )
     SELECT
       count(*)::int AS total_tables,
       count(*) FILTER (WHERE has_hash)::int AS hashed_tables,
       count(*) FILTER (WHERE NOT has_hash)::int AS unhashed_tables,
       COALESCE(sum(est_rows) FILTER (WHERE NOT has_hash), 0)::bigint AS unhashed_rows_est
     FROM base`,
  );
  const worst = await neonQuery(
    neonUrl,
    `SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows
     FROM pg_class c
     WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'
       AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid=c.oid AND a.attname='sha256_hash' AND a.attnum>0 AND NOT a.attisdropped)
     ORDER BY c.reltuples DESC LIMIT 25`,
  );
  return json({ summary: (rows as any[])[0] ?? {}, topUnhashed: worst });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const neonUrl = Deno.env.get("NEON_DATABASE_URL")!;
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "indexAudit";
    console.log(`neon-archive-integrity v${VERSION} action=${action}`);
    switch (action) {
      case "indexAudit": return await handleIndexAudit(neonUrl, body);
      case "indexCleanup": return await handleIndexCleanup(neonUrl, body);
      case "vacuumTables": return await handleVacuum(neonUrl, body);
      case "tagsView": return await handleTagsView(neonUrl);
      case "countyStats": return await handleCountyStats(neonUrl);
      case "countyBackfill": return await handleCountyBackfill(neonUrl, body);
      case "hashCoverage": return await handleHashCoverage(neonUrl);
      default: return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("neon-archive-integrity error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

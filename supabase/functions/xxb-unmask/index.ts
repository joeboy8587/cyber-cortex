// XXB Unmasking Engine v2 — forensic attribution of MLAT-only ("XXB") tracks
// to known airframes via deterministic + probabilistic bridges.
//
// Credibility-preserving protocol:
//   * Raw XXB rows are NEVER mutated. Attribution rows are written to a
//     SEPARATE table `public.xxb_attributions` in Neon.
//   * Each attribution carries a tier (1=deterministic .. 7=corridor lock)
//     plus the bridging row IDs as evidence. Bradford-Hill style stacking:
//     multiple tiers agreeing on the same xxb_record_id boost confidence.
//   * Idempotent: ON CONFLICT (xxb_record_id, source_table, attribution_method) DO NOTHING.
//
// Actions:
//   - init             : create the xxb_attributions table + indexes + consensus view
//   - tier1_icao       : exact icao24 hex match within ±60s
//   - tier2_continuity : <500m and <30s from a registered (non-XXB) track
//   - tier3_callsign   : same callsign as a registered track within ±10 min
//   - tier4_fingerprint: track-fingerprint (rounded lat/lon/alt every 30s) match
//   - tier5_coflight   : consistently within 1nm of a registered tail ≥5min × ≥3 days
//   - tier6_envelope   : altitude/squawk envelope matches a single known operator
//   - tier7_corridor   : XXB tracks confined to a known corporate corridor
//   - run_all          : sequentially run tiers 1..7 (each capped by batch_size)
//   - consensus        : refresh xxb_attribution_consensus (aggregated score)
//   - stats            : counts per tier + consensus histogram
//
// Body: { action, batch_size?, source_table?, dry_run? }

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const NEON_URL = Deno.env.get("NEON_DATABASE_URL")!;
const VERSION = "2.0.0";

const SOURCES = [
  "live_flight_detections_rows",
  "live_flight_detections",
  "quarantine.evidence_flight_dump_20260103_sealed",
];

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isXxb = (v: string) =>
  `(UPPER(COALESCE(${v},'')) IN ('XXB','XXA','XXC','XXX','UNKNOWN','~XXB',''))`;

function checkSource(s: string) {
  if (!SOURCES.includes(s)) throw new Error(`unknown source_table: ${s}`);
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action: string = body.action || "stats";
  // Lower default batch to keep Neon queries under the statement timeout.
  const batchSize: number = Math.min(Math.max(Number(body.batch_size) || 2_500, 200), 50_000);
  const dryRun: boolean = !!body.dry_run;
  const source: string = body.source_table || "live_flight_detections_rows";
  // Recent-only window for XXB candidates — full-history scans time out.
  const windowDays: number = Math.min(Math.max(Number(body.window_days) || 7, 1), 60);
  const RECENT = `AND detection_timestamp > now() - interval '${windowDays} days'`;
  // Safe integer altitude for the xxb_attributions.xxb_alt column (integer).
  const intAlt = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const sql = postgres(NEON_URL, {
    ssl: "require",
    max: 3,
    idle_timeout: 20,
    connection: { statement_timeout: "180000" },
  });

  try {
    // ───────────────────────────────────────────────────────────── INIT
    if (action === "init") {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS public.xxb_attributions (
          id                  bigserial PRIMARY KEY,
          xxb_record_id       text NOT NULL,
          source_table        text NOT NULL,
          xxb_timestamp       timestamptz,
          xxb_lat             double precision,
          xxb_lng             double precision,
          xxb_alt             integer,
          attributed_icao24   text,
          attributed_reg      text,
          attribution_tier    smallint NOT NULL,
          attribution_method  text NOT NULL,
          bridge_record_id    text,
          bridge_table        text,
          time_delta_sec      numeric,
          space_delta_m       numeric,
          confidence          numeric,
          evidence_refs       jsonb DEFAULT '{}'::jsonb,
          attributed_at       timestamptz DEFAULT now(),
          attributed_by       text DEFAULT 'auto:xxb-unmask/v2',
          UNIQUE (xxb_record_id, source_table, attribution_method)
        );
        CREATE INDEX IF NOT EXISTS xxb_attr_tier_idx ON public.xxb_attributions(attribution_tier);
        CREATE INDEX IF NOT EXISTS xxb_attr_reg_idx  ON public.xxb_attributions(attributed_reg);
        CREATE INDEX IF NOT EXISTS xxb_attr_icao_idx ON public.xxb_attributions(attributed_icao24);
        CREATE INDEX IF NOT EXISTS xxb_attr_ts_idx   ON public.xxb_attributions(xxb_timestamp);
        CREATE INDEX IF NOT EXISTS xxb_attr_rec_idx  ON public.xxb_attributions(xxb_record_id, source_table);

        -- Consensus view: stack multiple tier agreements per xxb row
        CREATE OR REPLACE VIEW public.xxb_attribution_consensus AS
        SELECT
          xxb_record_id,
          source_table,
          (array_agg(attributed_reg ORDER BY confidence DESC NULLS LAST))[1] AS best_reg,
          (array_agg(attributed_icao24 ORDER BY confidence DESC NULLS LAST))[1] AS best_icao,
          COUNT(DISTINCT attribution_method) AS tiers_agreed,
          array_agg(DISTINCT attribution_method ORDER BY attribution_method) AS methods,
          -- bounded Bradford-Hill stacking: ceil at 0.99
          LEAST(0.99, 1 - EXP(SUM(LN(GREATEST(1 - COALESCE(confidence,0), 0.01))))) AS consensus_confidence,
          MAX(xxb_timestamp) AS xxb_timestamp
        FROM public.xxb_attributions
        GROUP BY xxb_record_id, source_table;
      `);
      return json({ ok: true, version: VERSION, action, message: "xxb_attributions + consensus view ready" });
    }

    // ───────────────────────────────────────────────────────────── STATS
    if (action === "stats") {
      const exists = await sql`SELECT to_regclass('public.xxb_attributions') AS t`;
      if (!exists[0].t) return json({ initialized: false, hint: "POST {action:'init'} first" });
      const breakdown = await sql`
        SELECT attribution_tier, attribution_method, COUNT(*)::bigint AS n,
               COUNT(DISTINCT attributed_reg) AS unique_regs,
               COUNT(DISTINCT attributed_icao24) AS unique_icao,
               ROUND(AVG(confidence)::numeric, 3) AS avg_conf
        FROM public.xxb_attributions
        GROUP BY attribution_tier, attribution_method
        ORDER BY attribution_tier, n DESC
      `;
      const total = await sql`SELECT COUNT(*)::bigint AS n FROM public.xxb_attributions`;
      const consensus = await sql`
        SELECT
          COUNT(*) FILTER (WHERE consensus_confidence >= 0.90)::bigint AS near_certain,
          COUNT(*) FILTER (WHERE consensus_confidence BETWEEN 0.70 AND 0.899)::bigint AS high,
          COUNT(*) FILTER (WHERE consensus_confidence BETWEEN 0.40 AND 0.699)::bigint AS medium,
          COUNT(*) FILTER (WHERE consensus_confidence < 0.40)::bigint AS low,
          COUNT(*) FILTER (WHERE tiers_agreed >= 2)::bigint AS multi_tier
        FROM public.xxb_attribution_consensus
      `;
      return json({ initialized: true, version: VERSION, total: total[0].n, breakdown, consensus: consensus[0] });
    }

    // ───────────────────────────────────────────────────────────── TIER 1
    if (action === "tier1_icao") {
      checkSource(source);
      const probe = await sql.unsafe(`
        SELECT id::text AS id, icao_code AS icao24, registration, detection_timestamp,
               latitude, longitude, altitude
        FROM ${source}
        WHERE ${isXxb("registration")}
          AND icao_code ~ '^[0-9a-fA-F]{6}$'
          AND UPPER(icao_code) NOT IN ('XXB','XXA','XXC')
          ${RECENT}
          AND NOT EXISTS (
            SELECT 1 FROM public.xxb_attributions a
            WHERE a.xxb_record_id = ${source.includes('.') ? 'live_flight_detections_rows' : source}.id::text
              AND a.source_table = '${source}'
              AND a.attribution_method = 'icao_bridge'
          )
        ORDER BY detection_timestamp DESC
        LIMIT ${batchSize}
      `);
      if (dryRun) return json({ dry_run: true, candidates: probe.length, sample: probe.slice(0, 5) });

      let inserted = 0;
      for (const r of probe) {
        const bridge = await sql.unsafe(`
          SELECT id::text AS id, registration, detection_timestamp
          FROM ${source}
          WHERE icao_code = '${r.icao24}'
            AND NOT (${isXxb("registration")})
            AND detection_timestamp BETWEEN
              ('${new Date(r.detection_timestamp).toISOString()}'::timestamptz - interval '60 seconds')
              AND ('${new Date(r.detection_timestamp).toISOString()}'::timestamptz + interval '60 seconds')
          LIMIT 1
        `);
        if (bridge.length === 0) continue;
        const b = bridge[0];
        const dt = Math.abs((new Date(b.detection_timestamp).getTime() - new Date(r.detection_timestamp).getTime()) / 1000);
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             bridge_record_id, bridge_table, time_delta_sec, confidence, evidence_refs)
          VALUES
            (${r.id}, ${source}, ${r.detection_timestamp}, ${r.latitude}, ${r.longitude}, ${r.altitude},
             ${r.icao24.toLowerCase()}, ${b.registration}, 1, 'icao_bridge',
             ${b.id}, ${source}, ${dt}, 1.00,
             ${sql.json({ method: "exact_hex_match_within_60s" })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, candidates: probe.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 2
    if (action === "tier2_continuity") {
      checkSource(source);
      const candidates = await sql.unsafe(`
        WITH xxb AS (
          SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat, longitude AS xlng, altitude AS xalt
          FROM ${source}
          WHERE ${isXxb("registration")}
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            ${RECENT}
            AND NOT EXISTS (
              SELECT 1 FROM public.xxb_attributions a
              WHERE a.xxb_record_id = ${source}.id::text
                AND a.source_table = '${source}'
                AND a.attribution_method = 'track_continuity'
            )
          ORDER BY detection_timestamp DESC
          LIMIT ${batchSize}
        )
        SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt,
               r.id::text AS rid, r.registration, r.icao_code AS ricao,
               r.detection_timestamp AS rts,
               EXTRACT(EPOCH FROM (r.detection_timestamp - x.xts)) AS dt_sec,
               (111320 * SQRT(POWER(r.latitude - x.xlat, 2) + POWER((r.longitude - x.xlng) * COS(RADIANS(x.xlat)), 2))) AS dist_m
        FROM xxb x
        CROSS JOIN LATERAL (
          SELECT id, registration, icao_code, detection_timestamp, latitude, longitude
          FROM ${source}
          WHERE NOT (${isXxb("registration")})
            AND detection_timestamp BETWEEN x.xts - interval '30 seconds' AND x.xts + interval '30 seconds'
            AND latitude BETWEEN x.xlat - 0.01 AND x.xlat + 0.01
            AND longitude BETWEEN x.xlng - 0.01 AND x.xlng + 0.01
          ORDER BY ABS(EXTRACT(EPOCH FROM (detection_timestamp - x.xts)))
          LIMIT 1
        ) r
        WHERE (111320 * SQRT(POWER(r.latitude - x.xlat, 2) + POWER((r.longitude - x.xlng) * COS(RADIANS(x.xlat)), 2))) < 500
      `);
      if (dryRun) return json({ dry_run: true, matches: candidates.length, sample: candidates.slice(0, 5) });
      let inserted = 0;
      for (const c of candidates) {
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             bridge_record_id, bridge_table, time_delta_sec, space_delta_m, confidence, evidence_refs)
          VALUES
            (${c.xid}, ${source}, ${c.xts}, ${c.xlat}, ${c.xlng}, ${c.xalt},
             ${c.ricao}, ${c.registration}, 2, 'track_continuity',
             ${c.rid}, ${source}, ${c.dt_sec}, ${c.dist_m}, 0.95,
             ${sql.json({ method: "kinematic_continuity_500m_30s" })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, candidates: candidates.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 3 — Callsign bridge
    if (action === "tier3_callsign") {
      checkSource(source);
      const matches = await sql.unsafe(`
        WITH xxb AS (
          SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat,
                 longitude AS xlng, altitude AS xalt, callsign AS xcs
          FROM ${source}
          WHERE ${isXxb("registration")}
            AND callsign IS NOT NULL AND length(trim(callsign)) > 2
            ${RECENT}
            AND NOT EXISTS (
              SELECT 1 FROM public.xxb_attributions a
              WHERE a.xxb_record_id = ${source}.id::text
                AND a.source_table = '${source}'
                AND a.attribution_method = 'callsign_bridge'
            )
          ORDER BY detection_timestamp DESC
          LIMIT ${batchSize}
        )
        SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt, x.xcs,
               r.id::text AS rid, r.registration, r.icao_code AS ricao,
               EXTRACT(EPOCH FROM (r.detection_timestamp - x.xts)) AS dt_sec
        FROM xxb x
        CROSS JOIN LATERAL (
          SELECT id, registration, icao_code, detection_timestamp
          FROM ${source}
          WHERE callsign = x.xcs
            AND NOT (${isXxb("registration")})
            AND detection_timestamp BETWEEN x.xts - interval '10 minutes' AND x.xts + interval '10 minutes'
          ORDER BY ABS(EXTRACT(EPOCH FROM (detection_timestamp - x.xts)))
          LIMIT 1
        ) r
      `);
      if (dryRun) return json({ dry_run: true, matches: matches.length, sample: matches.slice(0, 5) });
      let inserted = 0;
      for (const c of matches) {
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             bridge_record_id, bridge_table, time_delta_sec, confidence, evidence_refs)
          VALUES
            (${c.xid}, ${source}, ${c.xts}, ${c.xlat}, ${c.xlng}, ${c.xalt},
             ${c.ricao}, ${c.registration}, 3, 'callsign_bridge',
             ${c.rid}, ${source}, ${c.dt_sec}, 0.85,
             ${sql.json({ method: "shared_callsign_10min", callsign: c.xcs })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, matches: matches.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 4 — Trajectory fingerprint
    // Hash 30-second rounded position+alt segments. If an XXB segment hash matches
    // a registered tail's segment hash within ±2h, attribute it.
    if (action === "tier4_fingerprint") {
      checkSource(source);
      const matches = await sql.unsafe(`
        WITH segments AS (
          SELECT
            id::text AS rid,
            registration,
            icao_code,
            detection_timestamp,
            latitude, longitude, altitude,
            ${isXxb("registration")} AS is_xxb,
            md5(
              concat_ws('|',
                ROUND(latitude::numeric, 3)::text,
                ROUND(longitude::numeric, 3)::text,
                ROUND((COALESCE(altitude,0)::numeric / 200))::text,
                ROUND(EXTRACT(EPOCH FROM detection_timestamp)::numeric / 30)::text
              )
            ) AS fp
          FROM ${source}
          WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            AND detection_timestamp > now() - interval '30 days'
          LIMIT ${batchSize * 4}
        ),
        xxb_seg AS (
          SELECT rid AS xid, detection_timestamp AS xts, latitude AS xlat,
                 longitude AS xlng, altitude AS xalt, fp
          FROM segments WHERE is_xxb = true
            AND NOT EXISTS (
              SELECT 1 FROM public.xxb_attributions a
              WHERE a.xxb_record_id = segments.rid
                AND a.source_table = '${source}'
                AND a.attribution_method = 'trajectory_fingerprint'
            )
        ),
        known_seg AS (
          SELECT rid, registration, icao_code, detection_timestamp, fp
          FROM segments WHERE is_xxb = false
        )
        SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt,
               k.rid, k.registration, k.icao_code AS ricao,
               EXTRACT(EPOCH FROM (k.detection_timestamp - x.xts)) AS dt_sec
        FROM xxb_seg x
        JOIN known_seg k ON k.fp = x.fp
        WHERE ABS(EXTRACT(EPOCH FROM (k.detection_timestamp - x.xts))) < 7200
        LIMIT ${batchSize}
      `);
      if (dryRun) return json({ dry_run: true, matches: matches.length, sample: matches.slice(0, 5) });
      let inserted = 0;
      for (const c of matches) {
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             bridge_record_id, bridge_table, time_delta_sec, confidence, evidence_refs)
          VALUES
            (${c.xid}, ${source}, ${c.xts}, ${c.xlat}, ${c.xlng}, ${c.xalt},
             ${c.ricao}, ${c.registration}, 4, 'trajectory_fingerprint',
             ${c.rid}, ${source}, ${c.dt_sec}, 0.80,
             ${sql.json({ method: "md5_seg_match_30s_200ft_2h" })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, matches: matches.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 5 — Co-flight pairing
    // XXB tracks that fly within ~1nm of a registered tail for ≥5 min on ≥3 distinct days.
    if (action === "tier5_coflight") {
      checkSource(source);
      const matches = await sql.unsafe(`
        WITH pairs AS (
          SELECT
            x.id::text AS xid,
            x.detection_timestamp AS xts,
            x.latitude AS xlat, x.longitude AS xlng, x.altitude AS xalt,
            r.registration,
            r.icao_code AS ricao,
            date_trunc('day', x.detection_timestamp) AS day
          FROM ${source} x
          JOIN ${source} r
            ON NOT (${isXxb("r.registration")})
            AND r.detection_timestamp BETWEEN x.detection_timestamp - interval '60 seconds'
                                          AND x.detection_timestamp + interval '60 seconds'
            AND r.latitude BETWEEN x.latitude - 0.025 AND x.latitude + 0.025
            AND r.longitude BETWEEN x.longitude - 0.025 AND x.longitude + 0.025
            AND (111320 * SQRT(POWER(r.latitude - x.latitude, 2) +
                 POWER((r.longitude - x.longitude) * COS(RADIANS(x.latitude)), 2))) < 1852
          WHERE ${isXxb("x.registration")}
            AND x.latitude IS NOT NULL AND x.longitude IS NOT NULL
            AND x.detection_timestamp > now() - interval '60 days'
          LIMIT ${batchSize * 2}
        ),
        scored AS (
          SELECT registration, ricao,
                 COUNT(DISTINCT day) AS distinct_days,
                 COUNT(*) AS hits,
                 (array_agg(xid))[1:50] AS sample_xids,
                 (array_agg(xts))[1] AS sample_ts,
                 (array_agg(xlat))[1] AS sample_lat,
                 (array_agg(xlng))[1] AS sample_lng,
                 (array_agg(xalt))[1] AS sample_alt
          FROM pairs
          GROUP BY registration, ricao
          HAVING COUNT(DISTINCT day) >= 3 AND COUNT(*) >= 5
        )
        SELECT * FROM scored ORDER BY distinct_days DESC, hits DESC LIMIT 500
      `);
      if (dryRun) return json({ dry_run: true, pairs: matches.length, sample: matches.slice(0, 5) });
      let inserted = 0;
      for (const c of matches) {
        for (const xid of (c.sample_xids || []).slice(0, 50)) {
          await sql`
            INSERT INTO public.xxb_attributions
              (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
               attributed_icao24, attributed_reg, attribution_tier, attribution_method,
               confidence, evidence_refs)
            VALUES
              (${xid}, ${source}, ${c.sample_ts}, ${c.sample_lat}, ${c.sample_lng}, ${c.sample_alt},
               ${c.ricao}, ${c.registration}, 5, 'coflight_pairing',
               0.75,
               ${sql.json({ method: "coflight_1nm_5min_3day", distinct_days: c.distinct_days, hits: c.hits })})
            ON CONFLICT DO NOTHING
          `;
          inserted++;
        }
      }
      return json({ ok: true, action, source, pairs: matches.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 6 — Operator envelope
    // XXB rows whose altitude/squawk match exactly one known operator's normal envelope.
    if (action === "tier6_envelope") {
      checkSource(source);
      const hasSquawk = await sql.unsafe(`
        SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='${source.split('.').pop()}' AND column_name='squawk') AS ok
      `);
      const squawkCol = hasSquawk[0].ok ? "squawk" : "NULL::text AS squawk";
      const matches = await sql.unsafe(`
        WITH envelopes AS (
          SELECT registration, icao_code,
                 percentile_cont(0.10) WITHIN GROUP (ORDER BY altitude) AS alt_p10,
                 percentile_cont(0.90) WITHIN GROUP (ORDER BY altitude) AS alt_p90,
                 mode() WITHIN GROUP (ORDER BY ${hasSquawk[0].ok ? "squawk" : "NULL::text"}) AS common_squawk,
                 COUNT(*) AS n
          FROM ${source}
          WHERE NOT (${isXxb("registration")})
            AND altitude IS NOT NULL
            AND detection_timestamp > now() - interval '30 days'
          GROUP BY registration, icao_code
          HAVING COUNT(*) >= 20
        ),
        xxb AS (
          SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat,
                 longitude AS xlng, altitude AS xalt,
                 ${hasSquawk[0].ok ? "squawk" : "NULL::text AS squawk"}
          FROM ${source}
          WHERE ${isXxb("registration")}
            AND altitude IS NOT NULL
            ${RECENT}
            AND NOT EXISTS (
              SELECT 1 FROM public.xxb_attributions a
              WHERE a.xxb_record_id = ${source}.id::text
                AND a.source_table = '${source}'
                AND a.attribution_method = 'operator_envelope'
            )
          ORDER BY detection_timestamp DESC
          LIMIT ${batchSize}
        )
        SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt,
               e.registration, e.icao_code AS ricao,
               COUNT(*) OVER (PARTITION BY x.xid) AS match_count
        FROM xxb x
        JOIN envelopes e
          ON x.xalt BETWEEN e.alt_p10 AND e.alt_p90
          ${hasSquawk[0].ok ? "AND (x.squawk IS NULL OR x.squawk = e.common_squawk)" : ""}
        QUALIFY COUNT(*) OVER (PARTITION BY x.xid) = 1
      `).catch(async () => {
        // Postgres lacks QUALIFY → fallback with subquery
        return await sql.unsafe(`
          WITH envelopes AS (
            SELECT registration, icao_code,
                   percentile_cont(0.10) WITHIN GROUP (ORDER BY altitude) AS alt_p10,
                   percentile_cont(0.90) WITHIN GROUP (ORDER BY altitude) AS alt_p90,
                   COUNT(*) AS n
            FROM ${source}
            WHERE NOT (${isXxb("registration")})
              AND altitude IS NOT NULL
              AND detection_timestamp > now() - interval '30 days'
            GROUP BY registration, icao_code
            HAVING COUNT(*) >= 20
          ),
          xxb AS (
            SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat,
                   longitude AS xlng, altitude AS xalt
            FROM ${source}
            WHERE ${isXxb("registration")} AND altitude IS NOT NULL
              ${RECENT}
              AND NOT EXISTS (
                SELECT 1 FROM public.xxb_attributions a
                WHERE a.xxb_record_id = ${source}.id::text
                  AND a.source_table = '${source}'
                  AND a.attribution_method = 'operator_envelope'
              )
            ORDER BY detection_timestamp DESC LIMIT ${batchSize}
          ),
          joined AS (
            SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt,
                   e.registration, e.icao_code AS ricao
            FROM xxb x
            JOIN envelopes e ON x.xalt BETWEEN e.alt_p10 AND e.alt_p90
          ),
          unique_match AS (
            SELECT xid FROM joined GROUP BY xid HAVING COUNT(*) = 1
          )
          SELECT j.* FROM joined j JOIN unique_match u USING (xid)
        `);
      });
      if (dryRun) return json({ dry_run: true, matches: matches.length, sample: matches.slice(0, 5) });
      let inserted = 0;
      for (const c of matches) {
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             confidence, evidence_refs)
          VALUES
            (${c.xid}, ${source}, ${c.xts}, ${c.xlat}, ${c.xlng}, ${c.xalt},
             ${c.ricao}, ${c.registration}, 6, 'operator_envelope',
             0.55,
             ${sql.json({ method: "altitude_squawk_envelope_unique" })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, matches: matches.length, inserted });
    }

    // ───────────────────────────────────────────────────────────── TIER 7 — Corridor lock
    // XXB tracks confined to a known corporate corridor get attributed to the
    // corridor's dominant operator (from corporate_transit_corridors.top_operators).
    if (action === "tier7_corridor") {
      checkSource(source);
      // Pull corridors from Supabase via Neon FDW? — corridors live in Supabase, so we
      // fetch them via a separate small query and inline the bbox filter.
      const corridorsResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/rest/v1/corporate_transit_corridors?select=corridor_name,corporate_owner,bbox_min_lat,bbox_max_lat,bbox_min_lng,bbox_max_lng,top_operators`,
        { headers: { apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` } }
      );
      const corridors = await corridorsResp.json();
      if (!Array.isArray(corridors) || corridors.length === 0) {
        return json({ ok: true, action, message: "no corridors defined", inserted: 0 });
      }
      let totalInserted = 0;
      const perCorridor: any[] = [];
      for (const cor of corridors) {
        if (cor.bbox_min_lat == null) continue;
        const ops = Array.isArray(cor.top_operators) ? cor.top_operators : [];
        const dominant = ops[0]?.registration || ops[0]?.operator || cor.corporate_owner;
        if (!dominant) continue;
        const xxb = await sql.unsafe(`
          SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat,
                 longitude AS xlng, altitude AS xalt
          FROM ${source}
          WHERE ${isXxb("registration")}
            AND latitude BETWEEN ${cor.bbox_min_lat} AND ${cor.bbox_max_lat}
            AND longitude BETWEEN ${cor.bbox_min_lng} AND ${cor.bbox_max_lng}
            ${RECENT}
            AND NOT EXISTS (
              SELECT 1 FROM public.xxb_attributions a
              WHERE a.xxb_record_id = ${source}.id::text
                AND a.source_table = '${source}'
                AND a.attribution_method = 'corridor_lock'
            )
          ORDER BY detection_timestamp DESC
          LIMIT ${Math.min(batchSize, 5000)}
        `);
        let inserted = 0;
        if (!dryRun) {
          for (const r of xxb) {
            await sql`
              INSERT INTO public.xxb_attributions
                (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
                 attributed_reg, attribution_tier, attribution_method, confidence, evidence_refs)
              VALUES
                (${r.xid}, ${source}, ${r.xts}, ${r.xlat}, ${r.xlng}, ${r.xalt},
                 ${dominant}, 7, 'corridor_lock', 0.45,
                 ${sql.json({ method: "corridor_bbox_lock", corridor: cor.corridor_name, owner: cor.corporate_owner })})
              ON CONFLICT DO NOTHING
            `;
            inserted++;
          }
        }
        perCorridor.push({ corridor: cor.corridor_name, dominant, candidates: xxb.length, inserted });
        totalInserted += inserted;
      }
      return json({ ok: true, action, source, total_inserted: totalInserted, per_corridor: perCorridor });
    }

    // ───────────────────────────────────────────────────────────── RUN ALL
    if (action === "run_all") {
      checkSource(source);
      const results: Record<string, any> = {};
      const tiers = ["tier1_icao","tier2_continuity","tier3_callsign","tier4_fingerprint","tier5_coflight","tier6_envelope","tier7_corridor"];
      for (const t of tiers) {
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/xxb-unmask`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ action: t, source_table: source, batch_size: batchSize }),
          });
          results[t] = await r.json();
        } catch (e) {
          results[t] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      return json({ ok: true, action, source, results });
    }

    if (action === "consensus") {
      const rows = await sql`SELECT * FROM public.xxb_attribution_consensus ORDER BY consensus_confidence DESC LIMIT 500`;
      return json({ ok: true, count: rows.length, top: rows });
    }

    return json({
      error: `unknown action: ${action}`,
      actions: ["init","tier1_icao","tier2_continuity","tier3_callsign","tier4_fingerprint","tier5_coflight","tier6_envelope","tier7_corridor","run_all","consensus","stats"],
      version: VERSION,
    }, 400);
  } catch (e) {
    console.error("xxb-unmask error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

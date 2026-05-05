// XXB Unmasking Engine — forensic attribution of MLAT-only ("XXB") tracks
// to known airframes via deterministic + probabilistic bridges.
//
// Credibility-preserving protocol:
//   * Raw XXB rows are NEVER mutated. Attribution rows are written to a
//     SEPARATE table `public.xxb_attributions` in Neon.
//   * Each attribution carries a tier (1=deterministic, 2=probabilistic,
//     3=pattern-only) plus the bridging row IDs as evidence.
//   * Idempotent: ON CONFLICT (xxb_record_id, attribution_method) DO NOTHING.
//
// Actions:
//   - init           : create the xxb_attributions table + indexes
//   - tier1_icao     : attribute XXB rows whose icao24 hex matches a non-XXB row within ±60s
//   - tier2_continuity : attribute XXB segments adjacent (<500m, <30s) to a registered track
//   - stats          : return counts per tier
//
// Body: { action, batch_size?, source_table?, dry_run? }

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const NEON_URL = Deno.env.get("NEON_DATABASE_URL")!;

// Candidate detection tables (XXB-bearing). Probed in order; missing ones skipped.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const action: string = body.action || "stats";
  const batchSize: number = Math.min(Math.max(Number(body.batch_size) || 50_000, 1_000), 500_000);
  const dryRun: boolean = !!body.dry_run;

  const sql = postgres(NEON_URL, {
    ssl: "require",
    max: 3,
    idle_timeout: 20,
    connection: { statement_timeout: "120000" },
  });

  try {
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
          attributed_by       text DEFAULT 'auto:xxb-unmask/v1',
          UNIQUE (xxb_record_id, source_table, attribution_method)
        );
        CREATE INDEX IF NOT EXISTS xxb_attr_tier_idx ON public.xxb_attributions(attribution_tier);
        CREATE INDEX IF NOT EXISTS xxb_attr_reg_idx  ON public.xxb_attributions(attributed_reg);
        CREATE INDEX IF NOT EXISTS xxb_attr_icao_idx ON public.xxb_attributions(attributed_icao24);
        CREATE INDEX IF NOT EXISTS xxb_attr_ts_idx   ON public.xxb_attributions(xxb_timestamp);
      `);
      return json({ ok: true, action, message: "xxb_attributions ready" });
    }

    if (action === "stats") {
      const exists = await sql`SELECT to_regclass('public.xxb_attributions') AS t`;
      if (!exists[0].t) return json({ initialized: false, hint: "POST {action:'init'} first" });
      const rows = await sql`
        SELECT attribution_tier, attribution_method, COUNT(*)::bigint AS n,
               COUNT(DISTINCT attributed_reg) AS unique_regs,
               COUNT(DISTINCT attributed_icao24) AS unique_icao
        FROM public.xxb_attributions
        GROUP BY attribution_tier, attribution_method
        ORDER BY attribution_tier, n DESC
      `;
      const total = await sql`SELECT COUNT(*)::bigint AS n FROM public.xxb_attributions`;
      return json({ initialized: true, total: total[0].n, breakdown: rows });
    }

    // ---- Tier 1: ICAO24 bridge ----------------------------------------------
    // XXB row that has a *real* hex icao24 (not 'XXB') and the same hex appears
    // in another row (XXB or not) within ±60s and 2nm. The hex IS the aircraft.
    if (action === "tier1_icao") {
      const source: string = body.source_table || "live_flight_detections_rows";
      if (!SOURCES.includes(source)) return json({ error: `unknown source_table` }, 400);

      // Find XXB rows where reg='XXB' but icao24 looks like a valid hex
      const probe = await sql.unsafe(`
        SELECT id::text AS id, icao_code AS icao24, registration, detection_timestamp,
               latitude, longitude, altitude
        FROM ${source}
        WHERE ${isXxb("registration")}
          AND icao_code ~ '^[0-9a-fA-F]{6}$'
          AND UPPER(icao_code) NOT IN ('XXB','XXA','XXC')
          AND id::text NOT IN (
            SELECT xxb_record_id FROM public.xxb_attributions
            WHERE source_table = '${source}' AND attribution_method = 'icao_bridge'
          )
        ORDER BY detection_timestamp DESC
        LIMIT ${batchSize}
      `);

      if (dryRun) return json({ dry_run: true, candidates: probe.length, sample: probe.slice(0, 5) });

      let inserted = 0;
      // For each candidate, look up a non-XXB row with the same hex within ±60s
      for (const r of probe) {
        const bridge = await sql.unsafe(`
          SELECT id::text AS id, registration, detection_timestamp, latitude, longitude
          FROM ${source}
          WHERE icao_code = '${r.icao24}'
            AND NOT (${isXxb("registration")})
            AND detection_timestamp BETWEEN
              ('${r.detection_timestamp.toISOString()}'::timestamptz - interval '60 seconds')
              AND ('${r.detection_timestamp.toISOString()}'::timestamptz + interval '60 seconds')
          LIMIT 1
        `);
        if (bridge.length === 0) continue;
        const b = bridge[0];
        const dt = Math.abs(
          (new Date(b.detection_timestamp).getTime() - new Date(r.detection_timestamp).getTime()) / 1000
        );
        await sql`
          INSERT INTO public.xxb_attributions
            (xxb_record_id, source_table, xxb_timestamp, xxb_lat, xxb_lng, xxb_alt,
             attributed_icao24, attributed_reg, attribution_tier, attribution_method,
             bridge_record_id, bridge_table, time_delta_sec, confidence, evidence_refs)
          VALUES
            (${r.id}, ${source}, ${r.detection_timestamp}, ${r.latitude}, ${r.longitude}, ${r.altitude},
             ${r.icao24.toLowerCase()}, ${b.registration}, 1, 'icao_bridge',
             ${b.id}, ${source}, ${dt}, 1.00,
             ${sql.json({ method: "exact_hex_match_within_60s", bridge_reg: b.registration })})
          ON CONFLICT DO NOTHING
        `;
        inserted++;
      }
      return json({ ok: true, action, source, candidates: probe.length, inserted });
    }

    // ---- Tier 2: track continuity -------------------------------------------
    // XXB row whose position is <500m and <30s from a registered (non-XXB) row.
    if (action === "tier2_continuity") {
      const source: string = body.source_table || "live_flight_detections_rows";
      if (!SOURCES.includes(source)) return json({ error: `unknown source_table` }, 400);

      const candidates = await sql.unsafe(`
        WITH xxb AS (
          SELECT id::text AS xid, detection_timestamp AS xts, latitude AS xlat, longitude AS xlng, altitude AS xalt
          FROM ${source}
          WHERE ${isXxb("registration")}
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND id::text NOT IN (
              SELECT xxb_record_id FROM public.xxb_attributions
              WHERE source_table = '${source}' AND attribution_method = 'track_continuity'
            )
          ORDER BY detection_timestamp DESC
          LIMIT ${batchSize}
        )
        SELECT x.xid, x.xts, x.xlat, x.xlng, x.xalt,
               r.id::text AS rid, r.registration, r.icao_code AS ricao,
               r.detection_timestamp AS rts, r.latitude AS rlat, r.longitude AS rlng,
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

    return json({ error: `unknown action: ${action}`,
      actions: ["init", "tier1_icao", "tier2_continuity", "stats"] }, 400);
  } catch (e) {
    console.error("xxb-unmask error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

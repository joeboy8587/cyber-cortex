// Schema Integrity Audit + Fix for Neon DB
// Addresses Josiah's 2026-05-16 audit:
//   1. Column name drift across detections / unified_detections / unfiltered_detections / aircraft / ghost_fleet
//   2. aircraft.icao24 NULL for KCSO fleet
//   3. government_link FALSE for confirmed KCSO aircraft
//   4. Corrupt / non-hex / wrong-length ICAO values in detections
//   5. ghost_fleet using icao_hex instead of icao24
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Confirmed KCSO fleet (Kern County Sheriff's Office)
const KCSO_FLEET = [
  "N912KC", "N913KC", "N788FA", "N597E",
  "N197E", "N397E", "N497E",
];

// Detections tables we care about (some may not exist — handled gracefully)
const DETECTION_TABLES = [
  "detections",
  "unified_detections",
  "unfilterd_detections",      // legacy misspelling kept for compatibility
  "unfiltered_detections",
  "live_flight_detections_rows",
];

async function tableExists(sql: any, table: string): Promise<boolean> {
  const r = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name=${table} LIMIT 1
  `;
  return r.length > 0;
}

async function listColumns(sql: any, table: string): Promise<string[]> {
  const r = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${table}
  `;
  return r.map((x: any) => x.column_name);
}

async function audit(sql: any) {
  const report: Record<string, any> = { tables: {}, kcso: [], issues: [] };

  for (const t of [
    ...DETECTION_TABLES,
    "aircraft", "ghost_fleet", "spoofing_profiles",
  ]) {
    if (await tableExists(sql, t)) {
      const cols = await listColumns(sql, t);
      const cnt = await sql.unsafe(
        `SELECT reltuples::bigint AS est FROM pg_class WHERE relname='${t}'`
      );
      report.tables[t] = {
        exists: true,
        row_estimate: Number(cnt[0]?.est ?? 0),
        has_registration: cols.includes("registration"),
        has_tail_number: cols.includes("tail_number"),
        has_icao24: cols.includes("icao24"),
        has_icao_hex: cols.includes("icao_hex"),
        has_icao_code: cols.includes("icao_code"),
        has_government_link: cols.includes("government_link"),
      };
    } else {
      report.tables[t] = { exists: false };
    }
  }

  // KCSO state in aircraft table
  if (report.tables.aircraft?.exists) {
    const cols = report.tables.aircraft;
    const regCol = cols.has_tail_number ? "tail_number" : "registration";
    const icaoCol = cols.has_icao24 ? "icao24" : (cols.has_icao_code ? "icao_code" : null);
    const govCol = cols.has_government_link ? "government_link" : null;
    if (icaoCol) {
      const list = await sql.unsafe(`
        SELECT ${regCol} AS reg,
               ${icaoCol} AS icao,
               ${govCol ? govCol : "NULL"} AS government_link
        FROM aircraft
        WHERE ${regCol} = ANY('{${KCSO_FLEET.join(",")}}')
      `);
      report.kcso = list;
      for (const row of list) {
        if (!row.icao) report.issues.push(`aircraft.${icaoCol} NULL for ${row.reg}`);
        if (govCol && row.government_link === false)
          report.issues.push(`aircraft.government_link=FALSE for KCSO ${row.reg}`);
      }
    }
  }

  // Sample corrupt ICAO in live_flight_detections_rows
  if (report.tables.live_flight_detections_rows?.exists) {
    try {
      const bad = await sql.unsafe(`
        SELECT
          COUNT(*) FILTER (WHERE icao24 IS NOT NULL AND icao24 NOT SIMILAR TO '[0-9a-fA-F]{6}')::int AS non_hex_or_bad_len,
          COUNT(*) FILTER (WHERE icao24 ~* '^n[0-9]')::int AS tail_in_icao_field,
          COUNT(*) FILTER (WHERE LENGTH(icao24) BETWEEN 1 AND 5)::int AS short_icao,
          COUNT(*) FILTER (WHERE icao24 = '002025')::int AS suspect_002025
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '180 days'
      `);
      report.tables.live_flight_detections_rows.icao_quality = bad[0];
    } catch (_) {}
  }

  return report;
}

async function applyFixes(sql: any) {
  const out: Record<string, any> = {};

  await sql.unsafe(`SET statement_timeout = '120s'`);

  // FIX 1 — backfill 'registration' on tables that only have tail_number
  out.fix1_column_alignment = [];
  for (const t of DETECTION_TABLES) {
    if (!(await tableExists(sql, t))) continue;
    const cols = await listColumns(sql, t);
    if (cols.includes("tail_number") && !cols.includes("registration")) {
      await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS registration TEXT`);
      const r = await sql.unsafe(
        `UPDATE ${t} SET registration = tail_number WHERE registration IS NULL AND tail_number IS NOT NULL`
      );
      out.fix1_column_alignment.push({ table: t, action: "added registration + backfilled", rows: r.count });
    } else if (cols.includes("tail_number") && cols.includes("registration")) {
      const r = await sql.unsafe(
        `UPDATE ${t} SET registration = tail_number WHERE registration IS NULL AND tail_number IS NOT NULL`
      );
      out.fix1_column_alignment.push({ table: t, action: "backfilled registration from tail_number", rows: r.count });
    }
  }

  // FIX 2 — ghost_fleet icao_hex → icao24 compatibility
  if (await tableExists(sql, "ghost_fleet")) {
    const cols = await listColumns(sql, "ghost_fleet");
    if (cols.includes("icao_hex") && !cols.includes("icao24")) {
      await sql.unsafe(`ALTER TABLE ghost_fleet ADD COLUMN IF NOT EXISTS icao24 TEXT`);
    }
    if (cols.includes("icao_hex") || (await listColumns(sql, "ghost_fleet")).includes("icao24")) {
      const r = await sql.unsafe(
        `UPDATE ghost_fleet SET icao24 = LOWER(icao_hex) WHERE icao24 IS NULL AND icao_hex IS NOT NULL`
      );
      out.fix2_ghost_fleet = { backfilled_icao24: r.count };
    }
  }

  // FIX 3 — aircraft.icao24 backfill from detections (most-common valid 6-char hex per tail)
  if (await tableExists(sql, "aircraft")) {
    const ac = await listColumns(sql, "aircraft");
    const regCol = ac.includes("tail_number") ? "tail_number" : "registration";
    if (!ac.includes("icao24")) {
      await sql.unsafe(`ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS icao24 TEXT`);
    }
    // Use live_flight_detections_rows as the canonical source
    if (await tableExists(sql, "live_flight_detections_rows")) {
      const r = await sql.unsafe(`
        WITH ranked AS (
          SELECT registration,
                 LOWER(COALESCE(icao24, icao_code)) AS hex,
                 COUNT(*) AS n,
                 ROW_NUMBER() OVER (
                   PARTITION BY registration
                   ORDER BY COUNT(*) DESC
                 ) AS rk
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL
            AND COALESCE(icao24, icao_code) ~ '^[0-9a-fA-F]{6}$'
            AND detection_timestamp > NOW() - INTERVAL '365 days'
          GROUP BY registration, LOWER(COALESCE(icao24, icao_code))
        )
        UPDATE aircraft a
        SET icao24 = r.hex
        FROM ranked r
        WHERE r.rk = 1
          AND (a.icao24 IS NULL OR a.icao24 = '')
          AND a.${regCol} = r.registration
      `);
      out.fix3_aircraft_icao_backfill = { rows_updated: r.count };
    }
  }

  // FIX 4 — government_link flag for KCSO fleet
  if (await tableExists(sql, "aircraft")) {
    const ac = await listColumns(sql, "aircraft");
    const regCol = ac.includes("tail_number") ? "tail_number" : "registration";
    if (!ac.includes("government_link")) {
      await sql.unsafe(`ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS government_link BOOLEAN DEFAULT FALSE`);
    }
    const r = await sql.unsafe(`
      UPDATE aircraft
      SET government_link = TRUE
      WHERE ${regCol} = ANY('{${KCSO_FLEET.join(",")}}')
        AND (government_link IS NULL OR government_link = FALSE)
    `);
    out.fix4_kcso_government_flag = { rows_updated: r.count, fleet: KCSO_FLEET };
  }

  // FIX 5 — quarantine + clean corrupt ICAO data in live_flight_detections_rows
  if (await tableExists(sql, "live_flight_detections_rows")) {
    // Quarantine table
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS icao_quarantine (
        id BIGSERIAL PRIMARY KEY,
        source_table TEXT NOT NULL,
        registration TEXT,
        bad_icao TEXT,
        reason TEXT,
        detection_timestamp TIMESTAMPTZ,
        quarantined_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Move pipeline errors (tail-number-in-icao24) to quarantine, then null
    const q1 = await sql.unsafe(`
      WITH bad AS (
        SELECT registration, icao24, detection_timestamp
        FROM live_flight_detections_rows
        WHERE icao24 ~* '^n[0-9]'
          AND detection_timestamp > NOW() - INTERVAL '365 days'
        LIMIT 50000
      ),
      ins AS (
        INSERT INTO icao_quarantine (source_table, registration, bad_icao, reason, detection_timestamp)
        SELECT 'live_flight_detections_rows', registration, icao24, 'tail_number_in_icao_field', detection_timestamp
        FROM bad RETURNING 1
      )
      UPDATE live_flight_detections_rows lf
      SET icao24 = NULL
      FROM bad
      WHERE lf.registration = bad.registration
        AND lf.icao24 = bad.icao24
        AND lf.detection_timestamp = bad.detection_timestamp
    `);

    // Wrong length / non-hex
    const q2 = await sql.unsafe(`
      WITH bad AS (
        SELECT registration, icao24, detection_timestamp
        FROM live_flight_detections_rows
        WHERE icao24 IS NOT NULL
          AND icao24 !~* '^n[0-9]'
          AND icao24 NOT SIMILAR TO '[0-9a-fA-F]{6}'
          AND detection_timestamp > NOW() - INTERVAL '365 days'
        LIMIT 50000
      ),
      ins AS (
        INSERT INTO icao_quarantine (source_table, registration, bad_icao, reason, detection_timestamp)
        SELECT 'live_flight_detections_rows', registration, icao24, 'non_hex_or_wrong_length', detection_timestamp
        FROM bad RETURNING 1
      )
      UPDATE live_flight_detections_rows lf
      SET icao24 = NULL
      FROM bad
      WHERE lf.registration = bad.registration
        AND lf.icao24 = bad.icao24
        AND lf.detection_timestamp = bad.detection_timestamp
    `);

    out.fix5_icao_cleanup = {
      tail_in_icao_field: q1.count,
      non_hex_or_wrong_length: q2.count,
      note: "All bad ICAOs copied to icao_quarantine table before NULL-ing — forensic reproducibility preserved",
    };
  }

  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 20 });
  try {
    const body = await req.json().catch(() => ({}));
    const mode: "audit" | "fix" = body.mode === "fix" ? "fix" : "audit";

    const before = await audit(sql);
    let fixes: Record<string, any> | null = null;
    let after: Record<string, any> | null = null;

    if (mode === "fix") {
      fixes = await applyFixes(sql);
      after = await audit(sql);
    }

    return new Response(JSON.stringify({
      mode, timestamp: new Date().toISOString(),
      audit_before: before, fixes, audit_after: after,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("schema-integrity-fix error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    try { await sql.end(); } catch (_) {}
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Sources that hold a registration column. Each contributes occurrences + flags.
// live_flight_detections_rows is HEAVY (millions of rows) — opt-in via body.includeHeavy.
const SOURCES_LIGHT: Array<{ table: string; idCol: string; tsCol?: string }> = [
  { table: "confirmed_biometric_correlations", idCol: "aircraft_registration", tsCol: "aircraft_timestamp" },
  { table: "exhibit_d_biometric_harm", idCol: "aircraft_registration", tsCol: "aircraft_timestamp" },
  { table: "alert_logs", idCol: "registration", tsCol: "created_at" },
];
const SOURCES_HEAVY: Array<{ table: string; idCol: string; tsCol?: string }> = [
  { table: "flight_events", idCol: "registration", tsCol: "detection_timestamp" },
  { table: "live_flight_detections_rows", idCol: "registration", tsCol: "detection_timestamp" },
];


const KCSO_REGS = ["N912KC", "N913KC", "N597E", "N911KC"];
const SHELL_HINTS = ["9K AIR", "BEST EQUIPMENT", "RESIDCO", "ALF IX", "LBBO", "BANC OF CAL"];
const MEDICAL_HINTS = ["AIR METHODS", "MERCY", "MEDEVAC"];
const MILITARY_HINTS = ["U.S.", "USAF", "ARMY", "NAVY", "DEPT OF DEF", "DOD"];

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON_DATABASE_URL) {
    return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sql = postgres(NEON_DATABASE_URL, {
    ssl: "require",
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: "540000" }, // 9 min per statement
  });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const reqBody = await req.json().catch(() => ({}));
  const includeHeavy: boolean = reqBody?.includeHeavy === true;
  const onlySources: string[] | undefined = Array.isArray(reqBody?.onlySources) ? reqBody.onlySources : undefined;
  let SOURCES = includeHeavy ? [...SOURCES_LIGHT, ...SOURCES_HEAVY] : SOURCES_LIGHT;
  if (onlySources?.length) SOURCES = SOURCES.filter((s) => onlySources.includes(s.table));

  try {
    // 1. Ensure target table
    await sql`
      CREATE TABLE IF NOT EXISTS canonical_operator_profiles (
        registration TEXT PRIMARY KEY,
        icao24 TEXT,
        faa_registrant_name TEXT,
        faa_address TEXT,
        aircraft_model TEXT,
        operator_resolved TEXT,
        shell_links JSONB DEFAULT '[]'::jsonb,
        kcso_flag BOOLEAN DEFAULT false,
        military_flag BOOLEAN DEFAULT false,
        medical_flag BOOLEAN DEFAULT false,
        xp_services_flag BOOLEAN DEFAULT false,
        source_tables JSONB DEFAULT '{}'::jsonb,
        occurrences_total BIGINT DEFAULT 0,
        last_seen TIMESTAMPTZ,
        confidence NUMERIC DEFAULT 0,
        sha256_hash TEXT,
        rebuilt_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    // 2. Probe which source tables actually exist AND have the registration column
    const tableNames = SOURCES.map((s) => s.table);
    const cols = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name = ANY(${tableNames})
    `;
    const colMap = new Map<string, Set<string>>();
    for (const c of cols as any[]) {
      if (!colMap.has(c.table_name)) colMap.set(c.table_name, new Set());
      colMap.get(c.table_name)!.add(c.column_name);
    }
    const existingSet = new Set(colMap.keys());
    const usable = SOURCES.filter((s) => {
      const colSet = colMap.get(s.table);
      return colSet?.has(s.idCol);
    }).map((s) => ({ ...s, tsCol: s.tsCol && colMap.get(s.table)?.has(s.tsCol) ? s.tsCol : undefined }));

    if (usable.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "no source tables with registration column found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // 3. Stage occurrences in a Neon temp table — aggregation runs server-side, no JS row holding.
    await sql`DROP TABLE IF EXISTS _opb_stage`;
    await sql`CREATE TEMP TABLE _opb_stage (
      registration TEXT,
      src TEXT,
      n BIGINT,
      last_seen TIMESTAMPTZ
    )`;

    const sourceErrors: Record<string, string> = {};
    const sourceCounts: Record<string, number> = {};
    for (const s of usable) {
      const tsExpr = s.tsCol ? `MAX(NULLIF(${s.tsCol}::text,'')::timestamptz)` : `NULL::timestamptz`;
      const insertSql = `
        INSERT INTO _opb_stage (registration, src, n, last_seen)
        SELECT UPPER(TRIM(${s.idCol}::text)), '${s.table}', COUNT(*)::bigint, ${tsExpr}
        FROM ${s.table}
        WHERE ${s.idCol} IS NOT NULL AND TRIM(${s.idCol}::text) <> ''
        GROUP BY 1
      `;
      try {
        const result: any = await sql.unsafe(insertSql);
        sourceCounts[s.table] = result?.count ?? 0;
      } catch (e: any) {
        console.error(`source ${s.table} failed:`, e?.message || e);
        sourceErrors[s.table] = String(e?.message || e);
      }
    }

    // 4. FAA enrichment table (optional) staged similarly
    const regTbl = existingSet.has("aircraft_registry_neon") ? "aircraft_registry_neon" : null;
    await sql`DROP TABLE IF EXISTS _opb_faa`;
    await sql`CREATE TEMP TABLE _opb_faa (
      registration TEXT PRIMARY KEY,
      name TEXT,
      address TEXT,
      model TEXT,
      icao24 TEXT
    )`;
    if (regTbl) {
      try {
        await sql.unsafe(`
          INSERT INTO _opb_faa (registration, name, address, model, icao24)
          SELECT UPPER(TRIM(registration::text)),
                 COALESCE(registrant_name, owner_operator),
                 COALESCE(registrant_street || ', ' || registrant_city || ', ' || registrant_state, ''),
                 COALESCE(aircraft_model, model),
                 icao24
          FROM ${regTbl}
          WHERE registration IS NOT NULL
          ON CONFLICT (registration) DO NOTHING
        `);
      } catch (e: any) {
        console.error("FAA enrichment failed:", e?.message || e);
      }
    }

    // 5. Server-side aggregation + upsert in ONE statement — no JS row iteration.
    const kcsoArr = `ARRAY[${KCSO_REGS.map((r) => `'${r}'`).join(",")}]`;
    const upsertSql = `
      WITH agg AS (
        SELECT registration,
               SUM(n)::bigint AS total,
               MAX(last_seen) AS last_seen,
               jsonb_object_agg(src, n) AS source_tables
        FROM _opb_stage
        WHERE registration IS NOT NULL AND registration <> ''
        GROUP BY registration
        HAVING SUM(n) >= 5
      ),
      enriched AS (
        SELECT a.*,
               f.name, f.address, f.model, f.icao24,
               UPPER(COALESCE(f.name,'')) AS uname
        FROM agg a
        LEFT JOIN _opb_faa f USING (registration)
      )
      INSERT INTO canonical_operator_profiles (
        registration, icao24, faa_registrant_name, faa_address, aircraft_model,
        operator_resolved, shell_links, kcso_flag, military_flag, medical_flag, xp_services_flag,
        source_tables, occurrences_total, last_seen, confidence, sha256_hash, rebuilt_at
      )
      SELECT
        registration, icao24, name, address, model,
        name,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('entity', h, 'source','faa_registrant_name'))
          FROM unnest(ARRAY['9K AIR','BEST EQUIPMENT','RESIDCO','ALF IX','LBBO','BANC OF CAL']) h
          WHERE uname LIKE '%' || h || '%'
        ), '[]'::jsonb),
        (registration = ANY(${kcsoArr}) OR uname LIKE '%KERN COUNTY%' OR uname LIKE '%SHERIFF%'),
        (uname LIKE '%U.S.%' OR uname LIKE '%USAF%' OR uname LIKE '%ARMY%' OR uname LIKE '%NAVY%' OR uname LIKE '%DEPT OF DEF%' OR uname LIKE '%DOD%'),
        (uname LIKE '%AIR METHODS%' OR uname LIKE '%MERCY%' OR uname LIKE '%MEDEVAC%'),
        (uname LIKE '%XP SERVICES%'),
        source_tables,
        total,
        last_seen,
        LEAST(1.0, (CASE WHEN name IS NOT NULL THEN 0.6 ELSE 0.2 END) + LEAST(0.4, LOG(GREATEST(total,1)+1) * 0.1)),
        encode(sha256(convert_to(registration || '|' || total::text || '|' || COALESCE(uname,''), 'UTF8')), 'hex'),
        now()
      FROM enriched
      ON CONFLICT (registration) DO UPDATE SET
        icao24 = EXCLUDED.icao24,
        faa_registrant_name = EXCLUDED.faa_registrant_name,
        faa_address = EXCLUDED.faa_address,
        aircraft_model = EXCLUDED.aircraft_model,
        operator_resolved = EXCLUDED.operator_resolved,
        shell_links = EXCLUDED.shell_links,
        kcso_flag = EXCLUDED.kcso_flag,
        military_flag = EXCLUDED.military_flag,
        medical_flag = EXCLUDED.medical_flag,
        xp_services_flag = EXCLUDED.xp_services_flag,
        source_tables = EXCLUDED.source_tables,
        occurrences_total = EXCLUDED.occurrences_total,
        last_seen = EXCLUDED.last_seen,
        confidence = EXCLUDED.confidence,
        sha256_hash = EXCLUDED.sha256_hash,
        rebuilt_at = now()
    `;
    const upsertResult: any = await sql.unsafe(upsertSql);
    const upserts = upsertResult?.count ?? 0;
    const conflicts: any[] = [];
    const rows = { length: upserts } as any;

    // 6. Audit trail (one summary row, not per-tail to keep volume sane)
    await supabase.from("exhibit_audit_trail").insert({
      action: "REBUILD_OPERATOR_PROFILES",
      rule_applied: `union_all_${usable.length}_sources`,
      records_evaluated: rows.length,
      records_promoted: upserts,
      result_hash: await sha256(`${upserts}|${Date.now()}`),
      metadata: { sources: usable.map((s) => s.table), conflicts: conflicts.length, source_errors: sourceErrors },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        sources_used: usable.map((s) => s.table),
        source_errors: sourceErrors,
        profiles_upserted: upserts,
        conflicts_logged: conflicts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("operator-profile-builder error:", err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
});

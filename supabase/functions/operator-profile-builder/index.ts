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


    // 3. Aggregate occurrences per (registration, source) — ONE TABLE AT A TIME
    // (avoids a single mega-query timeout when live_flight_detections_rows is included)
    type Agg = { total: bigint; last_seen: string | null; source_tables: Record<string, number> };
    const aggMap = new Map<string, Agg>();
    const sourceErrors: Record<string, string> = {};

    for (const s of usable) {
      const tsExpr = s.tsCol ? `MAX(NULLIF(${s.tsCol}::text,'')::timestamptz)` : `NULL::timestamptz`;
      const q = `SELECT UPPER(TRIM(${s.idCol}::text)) AS registration,
                        COUNT(*)::bigint AS n,
                        ${tsExpr} AS last_seen
                 FROM ${s.table}
                 WHERE ${s.idCol} IS NOT NULL AND TRIM(${s.idCol}::text) <> ''
                 GROUP BY 1`;
      try {
        const partRows = await sql.unsafe(q);
        for (const pr of partRows as any[]) {
          const reg = pr.registration;
          if (!reg) continue;
          const cur = aggMap.get(reg) || { total: 0n, last_seen: null, source_tables: {} };
          const n = BigInt(pr.n);
          cur.total += n;
          cur.source_tables[s.table] = Number(pr.n);
          if (pr.last_seen && (!cur.last_seen || pr.last_seen > cur.last_seen)) {
            cur.last_seen = pr.last_seen;
          }
          aggMap.set(reg, cur);
        }
      } catch (e: any) {
        console.error(`source ${s.table} failed:`, e?.message || e);
        sourceErrors[s.table] = String(e?.message || e);
      }
    }

    const rows = Array.from(aggMap.entries())
      .filter(([_, v]) => v.total >= 5n)
      .map(([registration, v]) => ({
        registration,
        total: v.total.toString(),
        last_seen: v.last_seen,
        source_tables: v.source_tables,
      }));

    // 4. Try to enrich with FAA registry data (if a registry table exists in Neon)
    const regTbl = existingSet.has("aircraft_registry_neon") ? "aircraft_registry_neon" : null;
    const faaMap = new Map<string, any>();
    if (regTbl) {
      const regRows = await sql.unsafe(
        `SELECT UPPER(TRIM(registration::text)) AS registration,
                COALESCE(registrant_name, owner_operator) AS name,
                COALESCE(registrant_street || ', ' || registrant_city || ', ' || registrant_state, '') AS address,
                COALESCE(aircraft_model, model) AS model,
                icao24
         FROM ${regTbl}
         WHERE registration IS NOT NULL`
      ).catch(() => []);
      for (const r of regRows) faaMap.set(r.registration, r);
    }

    // 5. Build profile rows + classification
    let upserts = 0;
    const conflicts: any[] = [];
    for (const r of rows) {
      const reg = r.registration;
      const faa = faaMap.get(reg) || {};
      const name: string = (faa.name || "").toUpperCase();
      const kcso = KCSO_REGS.includes(reg) || name.includes("KERN COUNTY") || name.includes("SHERIFF");
      const shell_links = SHELL_HINTS.filter((h) => name.includes(h)).map((h) => ({ entity: h, source: "faa_registrant_name" }));
      const military = MILITARY_HINTS.some((h) => name.includes(h));
      const medical = MEDICAL_HINTS.some((h) => name.includes(h));
      const xp = name.includes("XP SERVICES");

      const confidence = (faa.name ? 0.6 : 0.2) + Math.min(0.4, Math.log10(Number(r.total) + 1) * 0.1);
      const snapshot = JSON.stringify({ reg, name, total: r.total, last_seen: r.last_seen });
      const hash = await sha256(snapshot);

      await sql`
        INSERT INTO canonical_operator_profiles (
          registration, icao24, faa_registrant_name, faa_address, aircraft_model,
          operator_resolved, shell_links, kcso_flag, military_flag, medical_flag, xp_services_flag,
          source_tables, occurrences_total, last_seen, confidence, sha256_hash, rebuilt_at
        ) VALUES (
          ${reg}, ${faa.icao24 || null}, ${faa.name || null}, ${faa.address || null}, ${faa.model || null},
          ${faa.name || null}, ${sql.json(shell_links)}, ${kcso}, ${military}, ${medical}, ${xp},
          ${sql.json(r.source_tables)}, ${r.total}, ${r.last_seen}, ${confidence}, ${hash}, now()
        )
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
      upserts++;
    }

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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Sources that hold a registration column. Each contributes occurrences + flags.
const SOURCES: Array<{ table: string; idCol: string; tsCol?: string; tag?: string }> = [
  { table: "live_flight_detections_rows", idCol: "registration", tsCol: "detection_timestamp" },
  { table: "surveillance_feed_rows", idCol: "registration", tsCol: "detection_timestamp" },
  { table: "confirmed_biometric_correlations", idCol: "registration", tsCol: "event_timestamp" },
  { table: "exhibit_d_biometric_harm", idCol: "registration", tsCol: "event_timestamp" },
  { table: "alert_logs", idCol: "registration", tsCol: "created_at" },
  { table: "flight_events", idCol: "registration", tsCol: "event_timestamp" },
  { table: "aircraft_registry_neon", idCol: "registration" },
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

  const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 2, idle_timeout: 20 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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

    // 2. Probe which source tables actually exist
    const tableNames = SOURCES.map((s) => s.table);
    const existing = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${tableNames})
    `;
    const existingSet = new Set(existing.map((r: any) => r.table_name));
    const usable = SOURCES.filter((s) => existingSet.has(s.table));

    // 3. Aggregate occurrences per (registration, source)
    const unionParts = usable.map((s) => {
      const tsExpr = s.tsCol ? `MAX(${s.tsCol})` : `NULL::timestamptz`;
      return `SELECT UPPER(TRIM(${s.idCol}::text)) AS registration, '${s.table}' AS src, COUNT(*)::bigint AS n, ${tsExpr} AS last_seen FROM ${s.table} WHERE ${s.idCol} IS NOT NULL AND TRIM(${s.idCol}::text) <> '' GROUP BY 1`;
    }).join(" UNION ALL ");

    const aggSql = `
      WITH src AS (${unionParts})
      SELECT registration,
             SUM(n)::bigint AS total,
             MAX(last_seen) AS last_seen,
             jsonb_object_agg(src, n) AS source_tables
      FROM src
      GROUP BY registration
      HAVING SUM(n) >= 5
    `;
    const rows = await sql.unsafe(aggSql);

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
      metadata: { sources: usable.map((s) => s.table), conflicts: conflicts.length },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        sources_used: usable.map((s) => s.table),
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

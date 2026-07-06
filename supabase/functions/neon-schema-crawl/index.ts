// Neon Schema Crawler — discovers every table in the Neon database and scores
// it by forensic relevance (presence of join keys like icao, timestamp, lat/lng,
// callsign, case_id, whoop_*). Writes results into public.discovered_evidence_sources.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FORENSIC_KEYS: Record<string, number> = {
  icao: 8, icao24: 8, hex: 6, tail: 6, registration: 6, callsign: 6,
  timestamp: 5, detection_timestamp: 6, ts: 4, event_time: 4, created_at: 1,
  latitude: 5, longitude: 5, lat: 4, lon: 4, lng: 4, altitude: 5, ground_speed: 4, heading: 3,
  case_id: 7, exhibit_id: 7, sha256: 5,
  whoop_user_id: 7, heart_rate: 6, hrv: 6, hr: 4,
  operator: 4, owner: 4, faa_n_number: 6, n_number: 5,
  // FAA regulatory family — boost so they surface at the top of the panel
  citation: 8, far: 8, cfr: 7, regulation: 6, airspace: 6, class_letter: 5,
};

// Table-name boosts (added on top of column-based score)
const TABLE_BOOSTS: Record<string, number> = {
  faa_regulations: 25, faa_registration_master: 20, faa_airspace: 18,
  faa_airspace_classification: 18, faa_validated_violations: 22,
  faa_aircraft_ref: 15, faa_master: 15, faa_aircraft_registry: 15,
  policy_violations: 18, schema_wiring_report: 10,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!neonUrl || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "missing config" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "crawl";

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '60000'`).catch(() => {});

    if (action === "summary") {
      const supa = createClient(supaUrl, supaKey);
      const { data: top } = await supa
        .from("discovered_evidence_sources")
        .select("*")
        .order("forensic_score", { ascending: false })
        .limit(100);
      const { count } = await supa
        .from("discovered_evidence_sources")
        .select("*", { count: "exact", head: true });
      return new Response(JSON.stringify({ ok: true, total: count, top: top || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Crawl
    const tables = await sql.unsafe(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type='BASE TABLE'
        AND table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY table_schema, table_name
      LIMIT 2000
    `) as any[];

    const columns = await sql.unsafe(`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
    `) as any[];

    const colByTable = new Map<string, Array<{name: string, type: string}>>();
    for (const c of columns) {
      const k = `${c.table_schema}.${c.table_name}`;
      if (!colByTable.has(k)) colByTable.set(k, []);
      colByTable.get(k)!.push({ name: c.column_name, type: c.data_type });
    }

    const rowEstimates = await sql.unsafe(`
      SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS est
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind='r'
    `) as any[];
    const rowMap = new Map<string, number>();
    for (const r of rowEstimates) rowMap.set(`${r.schema}.${r.table}`, Number(r.est) || 0);

    const supa = createClient(supaUrl, supaKey);
    const upserts: any[] = [];
    for (const t of tables) {
      const k = `${t.table_schema}.${t.table_name}`;
      const cols = colByTable.get(k) || [];
      const colNames = cols.map(c => c.name.toLowerCase());
      let score = 0;
      const matchedKeys: string[] = [];
      for (const [key, weight] of Object.entries(FORENSIC_KEYS)) {
        if (colNames.some(n => n === key || n.includes(key))) {
          score += weight;
          if (!matchedKeys.includes(key)) matchedKeys.push(key);
        }
      }
      score += TABLE_BOOSTS[t.table_name.toLowerCase()] || 0;
      if (score === 0) continue; // skip noise
      upserts.push({
        schema_name: t.table_schema,
        table_name: t.table_name,
        row_estimate: rowMap.get(k) || 0,
        forensic_score: score,
        join_keys: matchedKeys,
        column_summary: { column_count: cols.length, sample: cols.slice(0, 12) },
        last_crawled: new Date().toISOString(),
      });
    }

    // Upsert in chunks
    let written = 0;
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const { error } = await supa
        .from("discovered_evidence_sources")
        .upsert(chunk, { onConflict: "schema_name,table_name" });
      if (error) throw error;
      written += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true, tables_scanned: tables.length, sources_indexed: written,
      generated_at: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

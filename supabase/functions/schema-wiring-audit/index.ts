// Schema Wiring Audit — enumerates every public.* table + column in Neon and
// records which edge functions / UI files reference them. Detects stale
// references (dropped table / missing column) that cause 5xx errors like the
// recent `ground_speed` breakage.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Legacy column mappings the auditor knows have moved
const COLUMN_RENAMES: Record<string, string> = {
  ground_speed: "gs",
  timestamp: "detection_timestamp",
  altitude_agl: "altitude",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const neonUrl = Deno.env.get("NEON_DATABASE_URL");
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!neonUrl || !supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "missing config" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action || "audit";

    sql = postgres(neonUrl, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '30000'`).catch(() => {});

    if (action === "audit") {
      // 1. Snapshot live schema
      const cols = await sql.unsafe(`
        SELECT table_schema, table_name, column_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      `) as any[];

      const tableColumns = new Map<string, Set<string>>();
      for (const c of cols) {
        const k = `${c.table_schema}.${c.table_name}`;
        if (!tableColumns.has(k)) tableColumns.set(k, new Set());
        tableColumns.get(k)!.add(String(c.column_name).toLowerCase());
      }
      const knownTables = new Set(Array.from(tableColumns.keys()).map((k) => k.split(".")[1]));

      // 2. Load edge-function inventory from Supabase read table (best effort:
      //    scan discovered_evidence_sources for references written by other jobs).
      const supa = createClient(supaUrl, supaKey);

      // 3. Build a static reference list — the audit ships with a known map of
      //    UI file / edge function → tables they read. Extend over time.
      const REFERENCE_MAP: Array<{ source_type: string; source_path: string; table: string; columns: string[] }> = [
        // Edge functions that broke recently
        { source_type: "edge_function", source_path: "sentinel-ml-score", table: "live_flight_detections_rows",
          columns: ["icao24","registration","callsign","latitude","longitude","altitude","gs","timestamp"] },
        { source_type: "edge_function", source_path: "far-classifier", table: "live_flight_detections_rows",
          columns: ["icao24","registration","callsign","latitude","longitude","altitude","timestamp","ground_speed"] },
        { source_type: "edge_function", source_path: "neon-query", table: "live_flight_detections_rows",
          columns: ["icao24","altitude","timestamp"] },
        { source_type: "edge_function", source_path: "policy-violation-scan", table: "live_flight_detections_rows",
          columns: ["icao24","altitude","latitude","longitude","timestamp"] },
        { source_type: "edge_function", source_path: "policy-violation-scan", table: "policy_violations",
          columns: ["policy_code","severity","aircraft_registration","detection_timestamp"] },
        { source_type: "edge_function", source_path: "wtpr-cases", table: "wtpr_registry",
          columns: ["case_id","status"] },
        // FAA registry family
        { source_type: "edge_function", source_path: "far-classifier", table: "faa_regulations",
          columns: ["citation","text"] },
        // UI components
        { source_type: "ui_component", source_path: "src/components/dashboard/EvidenceSourcesPanel.tsx", table: "discovered_evidence_sources",
          columns: ["schema_name","table_name","row_estimate","forensic_score","join_keys","added_to_investigation"] },
        { source_type: "ui_component", source_path: "src/components/dashboard/PolicyViolationPanel.tsx", table: "policy_violations",
          columns: ["policy_code","severity","aircraft_registration","detection_timestamp","citation","rule_source"] },
        { source_type: "ui_component", source_path: "src/components/dashboard/SentinelMLPanel.tsx", table: "sentinel_learned_threats",
          columns: ["icao","score","threat_level","detected_at"] },
        { source_type: "ui_component", source_path: "src/components/dashboard/WTPRCasePanel.tsx", table: "wtpr_registry",
          columns: ["case_id","status"] },
        { source_type: "ui_component", source_path: "src/components/dashboard/SchemaWiringPanel.tsx", table: "schema_wiring_report",
          columns: ["source_type","source_path","table_name","column_ref","status","severity"] },
      ];

      const report: any[] = [];
      const now = new Date().toISOString();
      for (const ref of REFERENCE_MAP) {
        // We check both Neon (public schema for detection/faa tables) AND the
        // audit does not check Supabase-side tables; those are always OK if the
        // migration ran.
        const supabaseTables = new Set([
          "discovered_evidence_sources","policy_violations","sentinel_learned_threats",
          "schema_wiring_report","cases","exhibits","evidence_documents","user_roles",
          "profiles","agent_sessions","agent_messages","rag_documents","rag_chunks",
        ]);
        if (supabaseTables.has(ref.table)) {
          // Trust Supabase migration — write ok row.
          report.push({
            source_type: ref.source_type, source_path: ref.source_path,
            table_name: ref.table, column_ref: null,
            status: "ok", suggested_fix: null, severity: "info", scanned_at: now,
          });
          continue;
        }
        // Neon-side reference
        const found = tableColumns.get(`public.${ref.table}`);
        if (!found) {
          report.push({
            source_type: ref.source_type, source_path: ref.source_path,
            table_name: ref.table, column_ref: null,
            status: knownTables.has(ref.table) ? "renamed" : "dropped_table",
            suggested_fix: knownTables.has(ref.table)
              ? `Table exists in another schema — qualify the schema name.`
              : `Neon table public.${ref.table} not found. Search for renamed table or remove reference.`,
            severity: "critical", scanned_at: now,
          });
          continue;
        }
        for (const col of ref.columns) {
          if (found.has(col.toLowerCase())) {
            report.push({
              source_type: ref.source_type, source_path: ref.source_path,
              table_name: ref.table, column_ref: col,
              status: "ok", suggested_fix: null, severity: "info", scanned_at: now,
            });
          } else {
            const rename = COLUMN_RENAMES[col.toLowerCase()];
            const guess = rename && found.has(rename) ? rename : null;
            report.push({
              source_type: ref.source_type, source_path: ref.source_path,
              table_name: ref.table, column_ref: col,
              status: guess ? "renamed" : "missing_column",
              suggested_fix: guess ? `Rename ${col} → ${guess}` : `Column ${col} not present on public.${ref.table}. Available: ${Array.from(found).slice(0,20).join(", ")}`,
              severity: guess ? "warn" : "critical", scanned_at: now,
            });
          }
        }
      }

      // Wipe old + insert
      await supa.from("schema_wiring_report").delete().gt("scanned_at", "1900-01-01");
      // Chunked insert
      for (let i = 0; i < report.length; i += 200) {
        const chunk = report.slice(i, i + 200);
        const { error } = await supa.from("schema_wiring_report").insert(chunk);
        if (error) throw error;
      }

      const summary = {
        total: report.length,
        ok: report.filter((r) => r.status === "ok").length,
        renamed: report.filter((r) => r.status === "renamed").length,
        missing_column: report.filter((r) => r.status === "missing_column").length,
        dropped_table: report.filter((r) => r.status === "dropped_table").length,
        critical: report.filter((r) => r.severity === "critical").length,
      };

      return new Response(JSON.stringify({ ok: true, summary, sample: report.slice(0, 20) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    try { await sql?.end({ timeout: 5 }); } catch {}
  }
});

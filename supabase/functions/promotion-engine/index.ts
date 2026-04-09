import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Maps promotion rule categories to actual Neon tables and their column mappings
const RULE_TABLE_MAP: Record<string, { table: string; columns: Record<string, string>; timeCol: string }[]> = {
  altitude_trigger: [
    { table: "live_flight_detections_rows", columns: { altitude_ft: "altitude", registration: "registration" }, timeCol: "detection_timestamp" },
    { table: "surveillance_feed_rows", columns: { altitude_ft: "altitude", registration: "registration" }, timeCol: "detection_timestamp" },
  ],
  flag_indicator: [
    { table: "live_flight_detections_rows", columns: { flagged: "is_flagged", is_violation: "is_violation", anomaly_score: "threat_score" }, timeCol: "detection_timestamp" },
    { table: "sentinel_learned_threats_rows", columns: { flagged: "COALESCE(total_violations > 0, false)", is_violation: "COALESCE(total_violations > 0, false)", anomaly_score: "escalation_level" }, timeCol: "updated_at" },
  ],
  severity_level: [
    { table: "legal_violations_rows", columns: { violation_severity: "severity", grade_a_causation: "COALESCE(severity = 'critical', false)", four_factor_lock: "COALESCE(factor_count >= 4, false)" }, timeCol: "violation_date" },
    { table: "ada_violation_evidence_rows", columns: { violation_severity: "severity_level", grade_a_causation: "COALESCE(severity_level = 'critical', false)" }, timeCol: "created_at" },
  ],
  temporal_proximity: [
    { table: "biometric_aircraft_correlations_rows", columns: { time_to_biometric_event: "time_delta_seconds", correlation_confidence: "correlation_strength" }, timeCol: "event_timestamp" },
  ],
};

// Build a safe WHERE clause from abstract sql_condition by mapping column names
function buildWhereClause(sqlCondition: string, columnMap: Record<string, string>): string | null {
  let clause = sqlCondition;
  for (const [abstract, real] of Object.entries(columnMap)) {
    clause = clause.replace(new RegExp(`\\b${abstract}\\b`, "g"), real);
  }
  return clause;
}

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { ruleIds, dryRun = false } = await req.json();

    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    if (!NEON_DATABASE_URL) {
      return new Response(JSON.stringify({ error: "NEON_DATABASE_URL not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch rules to execute
    let rulesQuery = supabase.from("promotion_rules").select("*").eq("is_active", true).order("priority");
    if (ruleIds?.length) {
      rulesQuery = rulesQuery.in("rule_id", ruleIds);
    }
    const { data: rules, error: rulesErr } = await rulesQuery;
    if (rulesErr || !rules?.length) {
      return new Response(JSON.stringify({ error: "No active rules found", details: rulesErr?.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 20, connect_timeout: 15 });

    const results: Array<{
      rule_name: string;
      rule_id: string;
      category: string;
      table: string;
      records_evaluated: number;
      records_matched: number;
      sample_records: unknown[];
      audit_id?: string;
    }> = [];

    let totalEvaluated = 0;
    let totalPromoted = 0;

    try {
      for (const rule of rules) {
        const tableSources = RULE_TABLE_MAP[rule.rule_category] || [];

        for (const source of tableSources) {
          const whereClause = buildWhereClause(rule.sql_condition, source.columns);
          if (!whereClause) continue;

          try {
            // Set statement timeout for safety
            await sql`SET statement_timeout = '20s'`;

            // Count total records in table (fast estimate)
            const countResult = await sql.unsafe(
              `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = '${source.table}'`
            ).catch(() => [{ estimate: 0 }]);
            const totalEstimate = Number(countResult[0]?.estimate) || 0;

            // Count matching records
            const matchQuery = `SELECT COUNT(*)::int AS matched FROM ${source.table} WHERE ${whereClause}`;
            const matchResult = await sql.unsafe(matchQuery).catch(() => [{ matched: 0 }]);
            const matched = Number(matchResult[0]?.matched) || 0;

            // Get sample records for verification
            const sampleQuery = `SELECT * FROM ${source.table} WHERE ${whereClause} ORDER BY ${source.timeCol} DESC LIMIT 10`;
            const samples = await sql.unsafe(sampleQuery).catch(() => []);

            totalEvaluated += totalEstimate;
            totalPromoted += matched;

            // Generate audit hash
            const sourceHash = await sha256(`${source.table}:${totalEstimate}:${new Date().toISOString()}`);
            const resultHash = await sha256(`${source.table}:${whereClause}:${matched}:${JSON.stringify(samples.slice(0, 3))}`);

            // Log to audit trail
            if (!dryRun) {
              const { data: auditEntry } = await supabase.from("exhibit_audit_trail").insert({
                action: "PROMOTION_RULE_EXECUTED",
                rule_applied: `${rule.rule_name}: ${rule.sql_condition}`,
                records_evaluated: totalEstimate,
                records_promoted: matched,
                source_hash: sourceHash,
                result_hash: resultHash,
                performed_by: "promotion_engine",
                metadata: {
                  table: source.table,
                  where_clause: whereClause,
                  rule_category: rule.rule_category,
                  priority: rule.priority,
                  sample_registrations: samples.slice(0, 5).map((s: any) => s.registration || s.reg || "unknown"),
                  dry_run: false,
                },
              }).select("audit_id").single();

              results.push({
                rule_name: rule.rule_name,
                rule_id: rule.rule_id,
                category: rule.rule_category,
                table: source.table,
                records_evaluated: totalEstimate,
                records_matched: matched,
                sample_records: samples.slice(0, 5),
                audit_id: auditEntry?.audit_id,
              });
            } else {
              results.push({
                rule_name: rule.rule_name,
                rule_id: rule.rule_id,
                category: rule.rule_category,
                table: source.table,
                records_evaluated: totalEstimate,
                records_matched: matched,
                sample_records: samples.slice(0, 5),
              });
            }
          } catch (queryErr) {
            console.warn(`Rule "${rule.rule_name}" on ${source.table} failed:`, (queryErr as Error).message);
            results.push({
              rule_name: rule.rule_name,
              rule_id: rule.rule_id,
              category: rule.rule_category,
              table: source.table,
              records_evaluated: 0,
              records_matched: 0,
              sample_records: [],
            });
          }
        }
      }
    } finally {
      await sql.end();
    }

    // Summary audit entry
    if (!dryRun && results.length > 0) {
      const summaryHash = await sha256(`BATCH:${totalEvaluated}:${totalPromoted}:${new Date().toISOString()}`);
      await supabase.from("exhibit_audit_trail").insert({
        action: "PROMOTION_BATCH_COMPLETE",
        rule_applied: `Executed ${rules.length} rules across ${results.length} table scans`,
        records_evaluated: totalEvaluated,
        records_promoted: totalPromoted,
        source_hash: summaryHash,
        result_hash: summaryHash,
        performed_by: "promotion_engine",
        metadata: {
          rules_executed: rules.length,
          tables_scanned: results.length,
          rule_names: rules.map((r: any) => r.rule_name),
          dry_run: false,
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      summary: {
        rules_executed: rules.length,
        tables_scanned: results.length,
        total_evaluated: totalEvaluated,
        total_promoted: totalPromoted,
        promotion_rate: totalEvaluated > 0 ? ((totalPromoted / totalEvaluated) * 100).toFixed(4) + "%" : "0%",
      },
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Promotion engine error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

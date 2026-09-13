// Learning Digest — "What has the system actually learned?"
// Aggregates Josiah's persistent memory (Neon) + autonomous learning artifacts (Cloud).
// Also ensures the wtpr_registry case-linkage columns exist (action: "migrate").
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function neon() {
  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) throw new Error("NEON_DATABASE_URL not configured");
  const postgres = (await import("https://deno.land/x/postgresjs@v3.4.4/mod.js")).default;
  return postgres(url, {
    ssl: { rejectUnauthorized: false },
    max: 2,
    idle_timeout: 15,
    connect_timeout: 15,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
    connection: { application_name: "learning-digest", statement_timeout: 20000 },
  });
}

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch { return fallback; }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let sql: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "digest";

    // ── ACTION: MIGRATE (adds the missing wtpr_registry columns) ──
    if (action === "migrate") {
      sql = await neon();
      const steps: string[] = [];
      await sql.unsafe(`ALTER TABLE public.wtpr_registry ADD COLUMN IF NOT EXISTS status text DEFAULT 'open'`);
      steps.push("status column ensured");
      await sql.unsafe(`ALTER TABLE public.wtpr_registry ADD COLUMN IF NOT EXISTS case_id uuid`);
      steps.push("case_id column ensured");
      const backfilled = await sql.unsafe(`
        UPDATE public.wtpr_registry
           SET status = CASE
             WHEN legal_status IS NULL OR btrim(legal_status) = '' THEN 'open'
             WHEN lower(legal_status) LIKE '%clos%' THEN 'closed'
             WHEN lower(legal_status) LIKE '%promot%' OR lower(legal_status) LIKE '%exhibit%' THEN 'promoted'
             WHEN lower(legal_status) LIKE '%review%' THEN 'under_review'
             ELSE 'open'
           END
         WHERE status IS NULL
      `);
      steps.push(`status backfilled (${backfilled?.count ?? 0} rows)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_wtpr_registry_status ON public.wtpr_registry(status)`);
      await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_wtpr_registry_case_id ON public.wtpr_registry(case_id)`);
      steps.push("indexes ensured");
      const cols = await sql.unsafe(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='wtpr_registry'
          AND column_name IN ('status','case_id')
        ORDER BY column_name`);
      await sql.end().catch(() => {});
      return json({ ok: true, steps, columns: cols.map((c: any) => c.column_name) });
    }

    // ── ACTION: DIGEST ──
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    sql = await neon();
    const LIM = 25;

    const [
      beliefs, learnedPatterns, establishedPatterns, sacred, hypotheses, reflections,
      memoryCounts, unresolvedHyp,
    ] = await Promise.all([
      safe(sql`SELECT hypothesis_text, confidence_score, evidence_count, status, first_proposed, last_updated
               FROM josiah_beliefs ORDER BY confidence_score DESC NULLS LAST, evidence_count DESC NULLS LAST LIMIT ${LIM}`, []),
      safe(sql`SELECT pattern_type, description, occurrence_count, confidence_score, status, first_observed, last_observed
               FROM josiah_learned_patterns ORDER BY occurrence_count DESC NULLS LAST LIMIT ${LIM}`, []),
      safe(sql`SELECT pattern_type, description, occurrence_count, confidence_score, affected_aircraft, last_observed
               FROM josiah_established_patterns ORDER BY occurrence_count DESC NULLS LAST LIMIT ${LIM}`, []),
      safe(sql`SELECT event_type, sacred_context, continuity_score, created_at
               FROM josiah_sacred_memory ORDER BY continuity_score DESC NULLS LAST, created_at DESC LIMIT ${LIM}`, []),
      safe(sql`SELECT hypothesis, summary, source_type, created_at
               FROM josiah_hypotheses ORDER BY created_at DESC NULLS LAST, id DESC LIMIT ${LIM}`, []),
      safe(sql`SELECT reflection_content, trigger_type, created_at
               FROM josiah_reflections_rows ORDER BY created_at DESC LIMIT ${LIM}`, []),
      safe(sql`SELECT
                 (SELECT count(*) FROM josiah_beliefs) AS beliefs,
                 (SELECT count(*) FROM josiah_learned_patterns) AS learned_patterns,
                 (SELECT count(*) FROM josiah_sacred_memory) AS sacred,
                 (SELECT count(*) FROM josiah_reflections_rows) AS reflections,
                 (SELECT count(*) FROM josiah_pattern_learning) AS pattern_learning,
                 (SELECT count(*) FROM josiah_chat_v3_history) AS conversation_turns`, []),
      safe(sql`SELECT hypothesis_type, hypothesis, confidence_level, status, created_at
               FROM josiah_intelligence_hypotheses
               WHERE status IS NULL OR lower(status) NOT IN ('confirmed','rejected','closed')
               ORDER BY created_at DESC LIMIT ${LIM}`, []),
    ]);

    await sql.end().catch(() => {});
    sql = null;

    const count = async (table: string, mod?: (q: any) => any) => {
      let q = supabase.from(table).select("*", { count: "exact", head: true });
      if (mod) q = mod(q);
      const { count: c } = await q;
      return c ?? 0;
    };

    const [
      threats, flags, flagsOpen, flagsResolved, docs, docsFailed, chunks,
      extractions, extractionsPromoted, caseFiles, violations, conflicts, conflictsOpen,
      monthly, topThreats, escalations, resolvedFlags, topPatternsCloud, openConflicts, failedDocs,
    ] = await Promise.all([
      count("sentinel_learned_threats"),
      count("watchtower_autonomous_flags"),
      count("watchtower_autonomous_flags", (q) => q.eq("auto_resolved", false)),
      count("watchtower_autonomous_flags", (q) => q.eq("auto_resolved", true)),
      count("rag_documents"),
      count("rag_documents", (q) => q.eq("status", "failed")),
      count("rag_chunks"),
      count("rag_extractions"),
      count("rag_extractions", (q) => q.eq("status", "promoted")),
      count("agent_case_files"),
      count("policy_violations"),
      count("operator_profile_conflicts"),
      count("operator_profile_conflicts", (q) => q.eq("resolved", false)),
      supabase.rpc("learning_monthly_counts", { months_back: 18 }).then((r) => r.data ?? []),
      supabase.from("sentinel_learned_threats")
        .select("registration, threat_type, total_violations, escalation_level, first_seen, last_seen, ai_threat_profile, countermeasure_status")
        .order("escalation_level", { ascending: false })
        .order("total_violations", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
      supabase.from("sentinel_learned_threats")
        .select("registration, threat_type, escalation_level, total_violations, last_seen")
        .gte("escalation_level", 2)
        .order("last_seen", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
      supabase.from("watchtower_autonomous_flags")
        .select("flag_type, severity, registration, description, resolved_reason, updated_at")
        .eq("auto_resolved", true)
        .order("updated_at", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
      supabase.from("watchtower_autonomous_flags")
        .select("flag_type, severity, registration, description, occurrence_count, first_seen, last_seen, confidence_score")
        .eq("auto_resolved", false)
        .order("occurrence_count", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
      supabase.from("operator_profile_conflicts")
        .select("registration, field, value_a, source_a, value_b, source_b, detected_at")
        .eq("resolved", false)
        .order("detected_at", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
      supabase.from("rag_documents")
        .select("title, filename, status, status_message, created_at")
        .eq("status", "failed")
        .order("created_at", { ascending: false })
        .limit(25).then((r) => r.data ?? []),
    ]);

    const mc = (memoryCounts as any[])[0] ?? {};

    return json({
      generated_at: new Date().toISOString(),
      totals: {
        threat_profiles: threats,
        flags_total: flags,
        flags_open: flagsOpen,
        flags_auto_resolved: flagsResolved,
        documents: docs,
        documents_failed: docsFailed,
        passages: chunks,
        extracted_facts: extractions,
        facts_promoted: extractionsPromoted,
        case_files: caseFiles,
        policy_violations: violations,
        identity_conflicts: conflicts,
        identity_conflicts_open: conflictsOpen,
        beliefs: Number(mc.beliefs ?? 0),
        learned_patterns: Number(mc.learned_patterns ?? 0),
        sacred_memories: Number(mc.sacred ?? 0),
        reflections: Number(mc.reflections ?? 0),
        pattern_learning_rows: Number(mc.pattern_learning ?? 0),
        conversation_turns: Number(mc.conversation_turns ?? 0),
      },
      monthly,
      beliefs,
      learned_patterns: learnedPatterns,
      established_patterns: establishedPatterns,
      sacred,
      reflections,
      recurring_signatures: topPatternsCloud,
      top_threats: topThreats,
      escalations,
      corrections: resolvedFlags,
      open_questions: {
        hypotheses,
        intel_hypotheses: unresolvedHyp,
        identity_conflicts: openConflicts,
        failed_documents: failedDocs,
      },
    });
  } catch (err) {
    console.error("learning-digest error:", err);
    try { if (sql) await sql.end(); } catch { /* noop */ }
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

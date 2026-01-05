import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.86.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type LinkageStats = {
  forensicEvents: number;
  entities: number;
  chainLinks: number;
  totalFlights: number;
  linkedFlights: number;
  totalBiometrics: number;
  linkedBiometrics: number;
  flightCoverage: string;
  biometricCoverage: string;
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, status = 400, details?: Json) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return fail("Backend not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)", 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    const params = (body ?? {}) as Record<string, unknown>;

    console.log("[forensic-linker] action=", action);

    if (!action) return fail("Missing action");

    // NOTE:
    // This function operates on Lovable Cloud database tables (public.*).
    // If your source data currently lives in an external database (e.g., Neon),
    // run the ingestion pipeline into Lovable Cloud first; correlation/backfill
    // actions will be enabled after that.

    if (action === "getStats") {
      const [eventsRes, entitiesRes, linksRes] = await Promise.all([
        supabase.from("master_forensic_events").select("forensic_event_id", { count: "exact", head: true }),
        supabase.from("entity_registry").select("entity_id", { count: "exact", head: true }),
        supabase.from("evidence_chain_links").select("link_id", { count: "exact", head: true }),
      ]);

      if (eventsRes.error) return fail(eventsRes.error.message, 500);
      if (entitiesRes.error) return fail(entitiesRes.error.message, 500);
      if (linksRes.error) return fail(linksRes.error.message, 500);

      const stats: LinkageStats = {
        forensicEvents: eventsRes.count ?? 0,
        entities: entitiesRes.count ?? 0,
        chainLinks: linksRes.count ?? 0,
        // Source data counts are unknown until ingested into Lovable Cloud.
        totalFlights: 0,
        linkedFlights: 0,
        totalBiometrics: 0,
        linkedBiometrics: 0,
        flightCoverage: "0",
        biometricCoverage: "0",
      };

      return ok(stats);
    }

    if (action === "getJobStatus") {
      const jobsRes = await supabase
        .from("correlation_job_status")
        .select("job_id, job_type, target_table, processed_records, linked_records, status, started_at, completed_at")
        .order("created_at", { ascending: false })
        .limit(25);

      if (jobsRes.error) return fail(jobsRes.error.message, 500);
      return ok({ jobs: jobsRes.data ?? [] });
    }

    if (action === "getTopEvents") {
      const limit = typeof params.limit === "number" ? params.limit : 10;

      const eventsRes = await supabase
        .from("master_forensic_events")
        .select(
          "forensic_event_id, event_timestamp, event_type, primary_entity_id, confidence_score, bradford_hill_score, factor_count, is_physical_verified, summary"
        )
        .order("bradford_hill_score", { ascending: false, nullsFirst: false })
        .limit(Math.min(Math.max(limit, 1), 50));

      if (eventsRes.error) return fail(eventsRes.error.message, 500);

      const events = eventsRes.data ?? [];

      // Add link_count (N+1, but limit is small)
      const withCounts = await Promise.all(
        events.map(async (e) => {
          const countRes = await supabase
            .from("evidence_chain_links")
            .select("link_id", { count: "exact", head: true })
            .eq("forensic_event_id", e.forensic_event_id);

          return { ...e, link_count: countRes.count ?? 0 };
        })
      );

      return ok({ events: withCounts });
    }

    // Temporarily disabled until source tables exist in Lovable Cloud.
    const disabled = new Set([
      "initTables",
      "backfillFlights",
      "backfillBiometrics",
      "backfillJosiah",
      "resolveEntities",
      "calculateBradfordHill",
      "runFullBackfill",
    ]);

    if (disabled.has(action)) {
      return fail(
        `Action '${action}' is disabled until source tables are ingested into the Lovable Cloud database.`,
        409
      );
    }

    return fail(`Unknown action '${action}'`, 400);
  } catch (err) {
    console.error("[forensic-linker] Unhandled error", err);
    return fail("Unhandled error", 500, { message: (err as Error)?.message });
  }
});

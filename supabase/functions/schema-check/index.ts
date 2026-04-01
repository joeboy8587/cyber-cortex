import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON_DATABASE_URL) return new Response(JSON.stringify({ error: "no db" }), { status: 500, headers: corsHeaders });

  const sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 10 });
  await sql`SET statement_timeout = '15s'`;

  try {
    const results: Record<string, any> = {};

    // Check row counts using pg_class for accuracy
    results.actual_counts = await sql`
      SELECT relname as table_name, reltuples::bigint as est_rows
      FROM pg_class 
      WHERE relname IN ('canonical_forensic_events', 'master_unified_evidence', 'confirmed_biometric_correlations')
      ORDER BY reltuples DESC
    `;

    // Sample master_unified_evidence
    results.mue_cols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'master_unified_evidence' AND table_schema = 'public'
      ORDER BY ordinal_position
    `.then(r => r.map((c: any) => c.column_name));

    results.mue_sample = await sql`
      SELECT * FROM master_unified_evidence LIMIT 1
    `.catch((e: any) => [{ error: e.message }]);

    await sql.end();
    return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await sql.end();
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});

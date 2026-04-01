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

  try {
    const tables = [
      'canonical_forensic_events', 'case_evidence_links',
      'biometric_threshold_collapses', 'confirmed_biometric_correlations',
      'was_discovered_patterns', 'josiah_pattern_learning',
      'legal_ada_violations_proper', 'exhibit_d_biometric_harm',
      'threat_tiers', 'aircraft_profiles_enriched',
      'sentinel_learned_threats_rows', 'shell_companies',
      'xxb_resolution_mapping', 'ada_violation_evidence_rows',
      'criminal_enterprise_command_structure'
    ];

    const results: Record<string, string[]> = {};
    for (const t of tables) {
      try {
        const cols = await sql`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = ${t} AND table_schema = 'public'
          ORDER BY ordinal_position
        `;
        results[t] = cols.map((c: any) => c.column_name);
      } catch (e) {
        results[t] = [`ERROR: ${(e as Error).message}`];
      }
    }

    await sql.end();
    return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await sql.end();
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});

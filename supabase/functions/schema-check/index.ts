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
    
    // Check canonical_forensic_events date range
    results.cfe_date_range = await sql`
      SELECT MIN(event_timestamp) as earliest, MAX(event_timestamp) as latest,
        COUNT(CASE WHEN registration IS NOT NULL AND registration != '' THEN 1 END)::int as with_reg
      FROM canonical_forensic_events
    `.catch((e: any) => [{ error: e.message }]);

    // Check confirmed_biometric_correlations sample  
    results.cbc_sample = await sql`
      SELECT aircraft_registration, confidence_level, created_at
      FROM confirmed_biometric_correlations
      WHERE aircraft_registration IS NOT NULL AND aircraft_registration != ''
      LIMIT 3
    `.catch((e: any) => [{ error: e.message }]);

    // Check xxb_resolution_mapping
    results.xxb_sample = await sql`
      SELECT xxb_tag, resolved_aircraft, confidence_score
      FROM xxb_resolution_mapping
      LIMIT 3
    `.catch((e: any) => [{ error: e.message }]);

    await sql.end();
    return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await sql.end();
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});

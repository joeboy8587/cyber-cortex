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
    
    // Sample canonical_forensic_events to see what data actually looks like
    results.cfe_sample = await sql`
      SELECT * FROM canonical_forensic_events LIMIT 2
    `.catch((e: any) => [{ error: e.message }]);

    // Count with non-null registration
    results.cfe_counts = await sql`
      SELECT 
        COUNT(CASE WHEN registration IS NOT NULL AND registration != '' THEN 1 END)::int as with_reg,
        COUNT(CASE WHEN callsign IS NOT NULL AND callsign != '' THEN 1 END)::int as with_callsign,
        COUNT(CASE WHEN icao_code IS NOT NULL AND icao_code != '' THEN 1 END)::int as with_icao
      FROM canonical_forensic_events
      WHERE canonical_id IN (SELECT canonical_id FROM canonical_forensic_events LIMIT 1000)
    `.catch((e: any) => [{ error: e.message }]);

    await sql.end();
    return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    await sql.end();
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});

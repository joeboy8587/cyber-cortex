import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return new Response(JSON.stringify({ error: "NEON_DATABASE_URL missing" }), { status: 500, headers: corsHeaders });
  const sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 10, connect_timeout: 10 });
  const out: Record<string, any> = {};
  try {
    await sql.unsafe(`SET statement_timeout = '30s'`);
    // Add icao24 to aircraft + ghost_fleet, add government_link to aircraft
    await sql.unsafe(`ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS icao24 TEXT`);
    await sql.unsafe(`ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS government_link BOOLEAN DEFAULT FALSE`);
    out.aircraft = "icao24 + government_link ensured";
    try {
      await sql.unsafe(`ALTER TABLE ghost_fleet ADD COLUMN IF NOT EXISTS icao24 TEXT`);
      await sql.unsafe(`UPDATE ghost_fleet SET icao24 = LOWER(icao_hex) WHERE icao24 IS NULL AND icao_hex IS NOT NULL`);
      out.ghost_fleet = "icao24 added + backfilled from icao_hex";
    } catch (e) { out.ghost_fleet_error = (e as Error).message; }
    // Verify
    const cols = await sql.unsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='aircraft' ORDER BY ordinal_position`);
    out.aircraft_columns = cols.map((r: any) => r.column_name);
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, partial: out }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    try { await sql.end({ timeout: 5 }); } catch (_) {}
  }
});

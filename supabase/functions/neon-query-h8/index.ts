// neon-query-h8: sibling edge function hosting the handlers8 action set.
// Split out of neon-query to shrink the main function's parse size and
// eliminate cold-start BOOT_ERROR spikes. Same request contract: { action, ...body }.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { handleAction8 } from "./handlers8.ts";

const VERSION = "1.0.0";
console.log(`neon-query-h8 v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let _sql: ReturnType<typeof postgres> | null = null;
let _sqlReady: Promise<ReturnType<typeof postgres>> | null = null;

function getConnection(): Promise<ReturnType<typeof postgres>> {
  if (_sql) return Promise.resolve(_sql);
  if (_sqlReady) return _sqlReady;

  _sqlReady = (async () => {
    const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!databaseUrl) throw new Error('Database connection not configured');
    const url = new URL(databaseUrl);
    url.searchParams.set('sslmode', 'require');
    const sql = postgres(url.toString(), {
      ssl: { rejectUnauthorized: false },
      max: 3,
      idle_timeout: 20,
      connect_timeout: 15,
      fetch_types: false,
      prepare: false,
      connection: {
        application_name: 'neon-query-h8-edge-v' + VERSION,
        statement_timeout: 25000,
      },
      onnotice: () => {},
      debug: false,
      transform: { undefined: null },
    });
    await sql`SELECT 1 as connected`;
    _sql = sql;
    return sql;
  })().catch((err) => {
    _sqlReady = null;
    _sql = null;
    throw err;
  });

  return _sqlReady;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    let body: Record<string, any> = {};
    try {
      const text = await req.text();
      if (text && text.trim()) body = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const action = body.action;
    if (!action || typeof action !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing required field: action' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'ping') {
      return new Response(JSON.stringify({ status: 'ok', version: VERSION }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sql = await getConnection();
    const result = await handleAction8(action, body, sql);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('neon-query-h8 error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (msg.includes('Connection') || msg.includes('timeout') || msg.includes('FATAL')) {
      _sql = null;
      _sqlReady = null;
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

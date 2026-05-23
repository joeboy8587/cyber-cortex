// ClickHouse Cloud query proxy — forensic archive access
// Routes read-only SELECT queries to the original ClickHouse instance
// over the HTTPS interface (port 8443) using stored credentials.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const HOST = Deno.env.get('CLICKHOUSE_HOST');
const USER = Deno.env.get('CLICKHOUSE_USER') || 'default';
const PASSWORD = Deno.env.get('CLICKHOUSE_PASSWORD');

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!HOST || !PASSWORD) {
      return new Response(
        JSON.stringify({ error: 'ClickHouse credentials not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const query: string = (body.query ?? '').toString().trim();
    const database: string = (body.database ?? 'default').toString();
    const format: string = (body.format ?? 'JSON').toString();

    if (!query) {
      return new Response(JSON.stringify({ error: 'query required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Read-only guard — forensic archive must never be mutated from here.
    const lowered = query.toLowerCase();
    const forbidden = ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ', 'create ', 'rename ', 'attach ', 'detach ', 'optimize ', 'system '];
    if (forbidden.some((kw) => lowered.includes(kw))) {
      return new Response(
        JSON.stringify({ error: 'read-only proxy — write/DDL statements blocked' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const url = new URL(`https://${HOST}:8443/`);
    url.searchParams.set('database', database);
    url.searchParams.set('default_format', format);
    // Hard server-side limits as a second safety net
    url.searchParams.set('max_result_rows', '50000');
    url.searchParams.set('max_execution_time', '60');
    url.searchParams.set('readonly', '1');

    const started = Date.now();
    const chRes = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${USER}:${PASSWORD}`),
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: query,
    });
    const text = await chRes.text();
    const elapsed_ms = Date.now() - started;

    if (!chRes.ok) {
      return new Response(
        JSON.stringify({ error: 'clickhouse_error', status: chRes.status, body: text.slice(0, 4000) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let parsed: unknown = null;
    if (format === 'JSON' || format === 'JSONCompact' || format === 'JSONEachRow') {
      try { parsed = format === 'JSONEachRow'
        ? text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
        : JSON.parse(text);
      } catch { parsed = null; }
    }

    const result_hash = await sha256(text);
    return new Response(
      JSON.stringify({
        ok: true,
        elapsed_ms,
        result_hash,
        bytes: text.length,
        format,
        data: parsed,
        raw: parsed ? undefined : text,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

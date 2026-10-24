import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const Input = z.object({
  registration: z.string().trim().toUpperCase().regex(/^N?[0-9][A-Z0-9]{0,5}$/),
  reportedHex: z.string().trim().toUpperCase().regex(/^[A-F0-9]{6}$/).nullable().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return respond({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return respond({ error: 'Authentication unavailable' }, 503);
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await client.auth.getClaims(authHeader.slice(7));
  if (error || !data?.claims) return respond({ error: 'Unauthorized' }, 401);
  const { data: permitted, error: roleError } = await client.rpc('is_investigator_or_admin');
  if (roleError || !permitted) return respond({ error: 'Investigator access required' }, 403);
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return respond({ error: 'Valid registration and optional six-digit hex required' }, 400);
  try {
    const key = Deno.env.get('LOVABLE_API_KEY');
    const connectionKey = Deno.env.get('NEON_API_KEY');
    if (!key || !connectionKey) return respond({ error: 'FAA connection unavailable' }, 503);
    const response = await fetch('https://connector-gateway.lovable.dev/neon/sql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'X-Connection-Api-Key': connectionKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ query: 'SELECT faa_registry_20261021.resolve_identity($1,$2) AS identity LIMIT 1',
        params: [input.data.registration, input.data.reportedHex ?? null] }),
    });
    if (!response.ok) {
      const details = await response.text();
      console.error(`FAA identity gateway failed [${response.status}]: ${details}`);
      const stale = /password authentication failed|endpoint cannot be found|"code"\s*:\s*"28[0P]01?"/.test(details);
      const blocked = /The endpoint has been disabled|endpoint is (disabled|temporarily unavailable)/.test(details);
      return respond({ error: stale ? 'The FAA database connection needs replacement in Lovable connector settings.'
        : blocked ? 'The FAA database is unavailable. The app owner should check its endpoint and plan in Neon.'
        : 'FAA identity could not be retrieved; no identity conclusion was made.', status: response.status }, 503);
    }
    const result = await response.json();
    return respond({ ok: true, identity: result.rows?.[0]?.identity ?? null });
  } catch (err) {
    console.error('FAA identity read failed', err);
    return respond({ error: 'FAA identity could not be retrieved; no identity conclusion was made.' }, 503);
  }
});
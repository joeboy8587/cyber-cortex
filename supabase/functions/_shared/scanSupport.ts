import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { persistScan } from './persistScan.ts';
export const respondScan = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
export async function scanClient(req: Request) {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw Object.assign(new Error('Sign in to run this scan'), { status: 401 });
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) throw new Error('Scan configuration unavailable');
  const options = { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(8_000) }) } };
  const client = createClient(url, anon, { ...options, global: { ...options.global, headers: { Authorization: header } } });
  const { data, error } = await client.auth.getClaims(header.slice(7));
  if (error || !data?.claims) throw Object.assign(new Error('Sign in to run this scan'), { status: 401 });
  const { data: allowed, error: roleError } = await client.rpc('is_investigator_or_admin');
  if (roleError || !allowed) throw Object.assign(new Error('Investigator access required'), { status: 403 });
  return createClient(url, service, options);
}
// Only server-owned SQL is accepted here. Request input never contains SQL.
export async function scanRead(query: string, params: unknown[] = []) {
  const key = Deno.env.get('LOVABLE_API_KEY'), connection = Deno.env.get('NEON_API_KEY');
  if (!key || !connection) throw new Error('Flight database connection unavailable');
  const response = await fetch('https://connector-gateway.lovable.dev/neon/sql', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Connection-Api-Key': connection,
      'Content-Type': 'application/json', 'Neon-Batch-Read-Only': 'true' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ queries: [{ query: "SET LOCAL statement_timeout = '12s'", params: [] }, { query, params }] }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error(`Scan database read [${response.status}]: ${details}`);
    throw Object.assign(new Error(/password authentication failed|endpoint cannot be found/.test(details)
      ? 'The flight database connection needs replacement in Lovable connector settings.'
      : /endpoint (has been |is )disabled/.test(details) ? 'The flight database is unavailable; check its endpoint and plan in Neon.'
      : 'Flight database read did not finish; this is not a zero-result scan.'), { status: 503, providerStatus: response.status });
  }
  const payload = await response.json();
  const rows = payload.results?.[1]?.rows;
  if (!Array.isArray(rows)) throw new Error('Incomplete flight database response');
  return rows as Record<string, any>[];
}
export async function saveScanRecords(client: Awaited<ReturnType<typeof scanClient>>, records: Record<string, any>[], deadline: number) {
  const unique = [...new Map(records.map(r => [r.sha256, r])).values()];
  return persistScan(unique, async batch => {
    const { data, error } = await client.from('policy_violations').select('sha256').in('sha256', batch.map(r => r.sha256));
    if (error) return { inserted: 0, error: 'Duplicate check failed; refresh before retrying.' };
    const known = new Set((data || []).map(r => r.sha256));
    const fresh = batch.filter(r => !known.has(r.sha256));
    if (!fresh.length) return { inserted: 0, error: null };
    const { error: writeError } = await client.from('policy_violations').insert(fresh);
    if (writeError) return { inserted: 0, error: 'A later batch could not be confirmed; refresh before retrying.' };
    return { inserted: fresh.length, error: null };
  }, deadline);
}
export async function scanHash(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PINECONE_API_KEY = Deno.env.get('PINECONE_API_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

async function pcFetch(url: string, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    headers: {
      'Api-Key': PINECONE_API_KEY,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2024-07',
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) throw new Error(`Pinecone ${r.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function embed(text: string, dim: number) {
  // Pick model by dim. 1536 → text-embedding-3-small, 3072 → gemini-embedding-001, else small w/ dimensions.
  let model = 'openai/text-embedding-3-small';
  const body: any = { model, input: text };
  if (dim === 3072) {
    body.model = 'google/gemini-embedding-001';
  } else if (dim !== 1536) {
    body.dimensions = dim;
  }
  const r = await fetch('https://ai.gateway.lovable.dev/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`embedding ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding as number[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!PINECONE_API_KEY) throw new Error('PINECONE_API_KEY not configured');
    const { action, query, index_host, namespace, top_k, dimension } = await req.json();

    if (action === 'list_indexes') {
      const data = await pcFetch('https://api.pinecone.io/indexes');
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'search') {
      if (!query || !index_host) throw new Error('query and index_host required');
      const dim = Number(dimension) || 1536;
      const vector = await embed(query, dim);
      const host = index_host.startsWith('http') ? index_host : `https://${index_host}`;
      const data = await pcFetch(`${host}/query`, {
        method: 'POST',
        body: JSON.stringify({
          vector,
          topK: top_k ?? 10,
          namespace: namespace || '',
          includeMetadata: true,
        }),
      });
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'multi_search') {
      // Search all indexes the workspace has access to
      if (!query) throw new Error('query required');
      const list = await pcFetch('https://api.pinecone.io/indexes');
      const indexes = list.indexes ?? [];
      const results = await Promise.allSettled(
        indexes.map(async (idx: any) => {
          const dim = idx.dimension || 1536;
          const vector = await embed(query, dim);
          const host = `https://${idx.host}`;
          const r = await pcFetch(`${host}/query`, {
            method: 'POST',
            body: JSON.stringify({ vector, topK: 5, includeMetadata: true }),
          });
          return { index: idx.name, host: idx.host, dimension: dim, matches: r.matches ?? [] };
        }),
      );
      const ok = results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<any>).value);
      const errors = results
        .filter((r) => r.status === 'rejected')
        .map((r) => ({ error: (r as PromiseRejectedResult).reason?.message ?? String((r as PromiseRejectedResult).reason) }));
      return new Response(JSON.stringify({ results: ok, errors, indexes_searched: ok.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`unknown action: ${action}`);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { scanClient, respondScan } from '../_shared/scanSupport.ts';
import { loadFleetIdentities } from '../_shared/kcsoOwnership.ts';
import { fleetOwnershipStatus } from '../_shared/kcsoOwnershipRules.ts';

const Input = z.object({ registrations: z.array(z.string().trim().toUpperCase().regex(/^N[0-9][A-Z0-9]{0,5}$/)).max(200).default([]) });
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respondScan({ error: 'Method not allowed' }, 405);
  try {
    await scanClient(req);
    const parsed = Input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return respondScan({ error: 'Valid aircraft registrations required' }, 400);
    const identities = await loadFleetIdentities(parsed.data.registrations);
    return respondScan({ complete: true, checked_at: new Date().toISOString(),
      identities: identities.map(row => ({ ...row, ownership_status: fleetOwnershipStatus(row) })) });
  } catch (error) {
    console.error('Fleet identity read failed', error);
    return respondScan({ complete: false, error: error instanceof Error ? error.message : 'Fleet identity unavailable' },
      (error as { status?: number })?.status ?? 503);
  }
});
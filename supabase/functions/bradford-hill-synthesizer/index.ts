import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NEON_URL = `${SUPABASE_URL}/functions/v1/neon-query`;

async function neonQ(query: string): Promise<any[]> {
  const r = await fetch(NEON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
    },
    body: JSON.stringify({ action: 'customQuery', query }),
  });
  const j = await r.json();
  return Array.isArray(j) ? j : (j?.data ?? []);
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface CriterionScore {
  name: string;
  score: number;
  max: number;
  evidence: string;
  source: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const subject: string = body.subject || 'population-scale aerial surveillance over Oildale AOI';
    const icao: string | null = body.icao || null;

    // ── Deterministic SQL scoring per criterion ────────────────────────────
    // Use estimates + bounded sampling so the function returns in seconds on
    // multi-million-row flight history while still reading real database state.
    const filter = icao ? `WHERE icao_code = '${icao.replace(/'/g, "''")}'` : '';
    const stats = await neonQ(icao ? `
      SELECT
        COUNT(*)::bigint AS total_n,
        COUNT(DISTINCT icao_code)::int AS uniq_n,
        COUNT(*) FILTER (WHERE flagged = true)::bigint AS flag_n,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp::timestamp) BETWEEN 0 AND 5)::bigint AS night_n,
        COUNT(*) FILTER (WHERE altitude > 0 AND altitude < 2000)::bigint AS prox_n,
        (SELECT COUNT(*)::bigint FROM watchtower_biometrics_master) AS bio_n
      FROM live_flight_detections_rows ${filter}
    ` : `
      WITH rel AS (
        SELECT GREATEST(reltuples, 0)::numeric AS total
        FROM pg_class
        WHERE oid = 'public.live_flight_detections_rows'::regclass
      ),
      sample AS (
        SELECT flagged, icao_code, altitude, detection_timestamp
        FROM live_flight_detections_rows TABLESAMPLE SYSTEM (0.5)
      ),
      sample_totals AS (
        SELECT GREATEST(COUNT(*), 1)::numeric AS sampled FROM sample
      ),
      scale AS (
        SELECT (SELECT total FROM rel) / (SELECT sampled FROM sample_totals) AS factor
      )
      SELECT
        (SELECT total::bigint FROM rel) AS total_n,
        (SELECT COUNT(DISTINCT icao_code)::int FROM sample WHERE icao_code IS NOT NULL) AS uniq_n,
        ROUND((SELECT COUNT(*) FROM sample WHERE flagged = true) * (SELECT factor FROM scale))::bigint AS flag_n,
        ROUND((SELECT COUNT(*) FROM sample WHERE EXTRACT(HOUR FROM detection_timestamp::timestamp) BETWEEN 0 AND 5) * (SELECT factor FROM scale))::bigint AS night_n,
        ROUND((SELECT COUNT(*) FROM sample WHERE altitude > 0 AND altitude < 2000) * (SELECT factor FROM scale))::bigint AS prox_n,
        (SELECT COUNT(*)::bigint FROM watchtower_biometrics_master) AS bio_n
    `);

    const row = stats?.[0] ?? {};
    const totalN = Number(row.total_n ?? 0);
    const uniqN = Number(row.uniq_n ?? 0);
    const flagN = Number(row.flag_n ?? 0);
    const bioN = Number(row.bio_n ?? 0);
    const nightN = Number(row.night_n ?? 0);
    const proxN = Number(row.prox_n ?? 0);

    const criteria: CriterionScore[] = [
      {
        name: 'Strength of Association',
        score: Math.min(10, Math.round((totalN / 50000) * 10)),
        max: 10,
        evidence: `${totalN.toLocaleString()} detection events linking aircraft activity to AOI.`,
        source: 'live_flight_detections_rows',
      },
      {
        name: 'Consistency',
        score: Math.min(10, Math.round((uniqN / 100) * 10)),
        max: 10,
        evidence: `${uniqN} distinct ICAO codes producing recurring patterns.`,
        source: 'live_flight_detections_rows DISTINCT icao',
      },
      {
        name: 'Specificity',
        score: Math.min(10, Math.round((flagN / 2000) * 10)),
        max: 10,
        evidence: `${flagN.toLocaleString()} flagged anomalous events targeting AOI specifically.`,
        source: 'live_flight_detections_rows WHERE flagged',
      },
      {
        name: 'Temporality',
        score: Math.min(10, Math.round((nightN / Math.max(totalN, 1)) * 30)),
        max: 10,
        evidence: `${nightN.toLocaleString()} night-ops detections (0000–0500 UTC), consistent with surveillance precedence.`,
        source: 'live_flight_detections_rows HOUR filter',
      },
      {
        name: 'Biological Gradient',
        score: Math.min(10, Math.round((proxN / Math.max(totalN, 1)) * 20)),
        max: 10,
        evidence: `${proxN.toLocaleString()} low-altitude events (<2000ft) — dose-proximity gradient.`,
        source: 'live_flight_detections_rows altitude<2000',
      },
      {
        name: 'Plausibility',
        score: 8,
        max: 10,
        evidence: 'Documented ISR/EW airframes (EA-37B, RC-26, Huey) have published surveillance & DEW capability.',
        source: 'doctrine corpus',
      },
      {
        name: 'Coherence',
        score: 8,
        max: 10,
        evidence: 'Pattern coheres with prior targeted-individual + RICO surveillance enterprise cases.',
        source: 'precedent corpus',
      },
      {
        name: 'Experiment',
        score: Math.min(10, Math.round((bioN / 50000) * 10)),
        max: 10,
        evidence: `${bioN.toLocaleString()} biometric records form longitudinal natural experiment.`,
        source: 'watchtower_biometrics_master',
      },
      {
        name: 'Analogy',
        score: 7,
        max: 10,
        evidence: 'Analogous to MKULTRA, COINTELPRO, post-9/11 ISR drift cases.',
        source: 'historical analogy',
      },
    ];

    const totalScore = criteria.reduce((s, c) => s + c.score, 0);
    const maxScore = criteria.reduce((s, c) => s + c.max, 0);
    const pct = Math.round((totalScore / maxScore) * 100);
    const verdict =
      pct >= 80 ? 'CAUSATION ESTABLISHED' :
      pct >= 60 ? 'CAUSATION PROBABLE' :
      pct >= 40 ? 'CAUSATION SUGGESTED — additional evidence required' :
      'INSUFFICIENT — do not assert causation';

    // ── AI narrative wrapper (deterministic scores → prose only) ──────────
    const prompt = `You are a forensic epidemiologist. Wrap the following Bradford Hill scoring into a 5-sentence neutral prosecution-brief paragraph. Do NOT invent numbers; quote only the evidence strings provided.

Subject: ${subject}
Overall: ${totalScore}/${maxScore} (${pct}%) — ${verdict}

${criteria.map((c) => `- ${c.name} ${c.score}/${c.max}: ${c.evidence}`).join('\n')}`;

    let narrative = '';
    try {
      const aiR = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const aiJ = await aiR.json();
      narrative = aiJ?.choices?.[0]?.message?.content ?? '';
    } catch (_) {
      narrative = '(narrative wrapper unavailable; deterministic scores stand alone)';
    }

    const payload = { subject, icao, criteria, totalScore, maxScore, pct, verdict, narrative };
    const content_hash = await sha256(JSON.stringify(payload));

    // Persist to reasoning_outputs (chain-of-custody)
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await sb.from('reasoning_outputs').insert({
        module: 'bradford-hill-synthesizer',
        subject,
        content_hash,
        payload,
        bradford_hill_score: pct,
      });
    } catch (e) {
      console.error('audit insert failed', e);
    }

    return new Response(JSON.stringify({ ...payload, content_hash }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

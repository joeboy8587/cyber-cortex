// SODA — Spoofing detector for ADS-B, adapted stage 2 (aircraft classifier).
//
// Ying et al., "Detecting ADS-B Spoofing Attacks using Deep Neural Networks"
// (arXiv:1904.09969) describe a two-stage detector: a PHY-layer message
// classifier (raw IQ / phase samples) and an aircraft classifier that decides
// whether a transmission actually behaves like the aircraft whose ICAO address
// it claims. We have no SDR front-end, so stage 1 is out of reach; stage 2 is
// implemented here over decoded detections:
//
//   train  → learn a per-tail behavioural fingerprint from a baseline window
//            (kinematic means/σ, geographic envelope, hour profile, the ICAO
//            addresses and callsigns that tail has ever legitimately used)
//   score  → take a recent evaluation window and test each tail against its own
//            fingerprint: kinematic z-scores, geographic displacement, unseen
//            ICAO / callsign, physically impossible implied ground speed.
//            Then run the nearest-fingerprint check — if another tail's
//            fingerprint explains the behaviour far better than the claimed
//            one, that is the paper's misclassification signal (impersonation).
//
// Output is a spoof probability + verdict per tail per window, persisted for
// exhibit promotion. Nothing is deleted; every run appends.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TABLE = "live_flight_detections_rows";

// Registration-prefix shards — these hit the existing btree on registration
// instead of forcing a hash expression scan.
const SHARDS: Array<[string, string]> = [
  ["N0", "N2"], ["N2", "N4"], ["N4", "N6"], ["N6", "N8"], ["N8", "NA"],
  ["NA", "NN"], ["NN", "O"], ["", "G"], ["G", "K"], ["K", "N0"], ["O", "\uffff"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false },
    max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 80000 },
  });

  const BUDGET_MS = 100_000;
  let timer: number | undefined;
  const budget = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(json({
      ok: false, code: "BUDGET_EXCEEDED",
      error: "SODA request exceeded the 100s budget — run fewer shards per pass.",
    }, 504)), BUDGET_MS) as unknown as number;
  });

  const work = (async () => {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "stats");
    await ensureSchema(sql);
    if (action === "shards") return json({ ok: true, shards: SHARDS.length });
    if (action === "train") return json(await train(sql, body));
    if (action === "score") return json(await score(sql, body));
    if (action === "list") return json(await list(sql, body));
    if (action === "stats") return json(await stats(sql));
    return json({ ok: false, error: `unknown action "${action}"` }, 400);
  })().catch((e) => json({ ok: false, error: String((e as Error)?.message || e) }, 500));

  try {
    return await Promise.race([work, budget]);
  } finally {
    if (timer) clearTimeout(timer);
    try { await sql.end({ timeout: 5 }); } catch { /* noop */ }
  }
});

function shardClause(part: number, col = "d.registration") {
  const s = SHARDS[Math.min(Math.max(part, 0), SHARDS.length - 1)];
  const lo = s[0] ? `AND ${col} >= '${s[0]}'` : "";
  const hi = `AND ${col} < '${s[1]}'`;
  return `${lo} ${hi}`;
}

async function ensureSchema(sql: ReturnType<typeof postgres>) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS soda_aircraft_fingerprint (
      registration text PRIMARY KEY,
      pings        bigint DEFAULT 0,
      days_active  int    DEFAULT 0,
      first_seen   timestamptz,
      last_seen    timestamptz,
      alt_avg      numeric, alt_sigma numeric,
      spd_avg      numeric, spd_sigma numeric,
      lat_c        double precision, lng_c double precision,
      geo_radius_mi numeric,
      night_pct    numeric, low_alt_pct numeric,
      hour_hist    bigint[] DEFAULT array_fill(0::bigint, ARRAY[24]),
      icao_set     text[] DEFAULT '{}',
      callsign_set text[] DEFAULT '{}',
      trained_at   timestamptz DEFAULT NOW(),
      baseline_days int
    )`);
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS soda_identity_scores (
      id            bigserial PRIMARY KEY,
      registration  text NOT NULL,
      window_start  timestamptz NOT NULL,
      window_end    timestamptz NOT NULL,
      pings         bigint,
      claimed_icao  text,
      z_alt         numeric, z_spd numeric,
      geo_dev_mi    numeric,
      new_icao      boolean DEFAULT false,
      new_callsign  boolean DEFAULT false,
      max_implied_kts numeric,
      nearest_match text,
      nearest_gain  numeric,
      deviation_score numeric,
      spoof_probability numeric,
      verdict       text,
      evidence      jsonb,
      created_at    timestamptz DEFAULT NOW(),
      UNIQUE (registration, window_start)
    )`);
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS idx_soda_scores_prob ON soda_identity_scores (spoof_probability DESC)`,
  );
}

/* ─────────────────────────── stage 2a: train ─────────────────────────── */

async function train(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const part = Number(body.part) || 0;
  const baselineDays = Math.min(Math.max(Number(body.baselineDays) || 120, 14), 400);
  const holdoutDays = Math.min(Math.max(Number(body.holdoutDays) || 3, 0), 30);
  const minPings = Math.max(Number(body.minPings) || 20, 5);
  const t0 = Date.now();

  const rows = await sql.unsafe(`
    WITH base AS (
      SELECT UPPER(TRIM(d.registration)) AS reg,
             LOWER(TRIM(d.icao24)) AS icao,
             UPPER(TRIM(d.callsign)) AS cs,
             d.detection_timestamp AS ts,
             d.latitude AS lat, d.longitude AS lng,
             d.altitude AS alt, d.speed AS spd
      FROM ${TABLE} d
      WHERE d.detection_timestamp >= NOW() - INTERVAL '${baselineDays} days'
        AND d.detection_timestamp <  NOW() - INTERVAL '${holdoutDays} days'
        AND d.registration IS NOT NULL AND TRIM(d.registration) <> ''
        AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
        ${shardClause(part)}
    ),
    agg AS (
      SELECT reg,
        COUNT(*)::bigint AS pings,
        COUNT(DISTINCT DATE(ts))::int AS days_active,
        MIN(ts) AS first_seen, MAX(ts) AS last_seen,
        AVG(alt) AS alt_avg, COALESCE(STDDEV_POP(alt), 0) AS alt_sigma,
        AVG(spd) AS spd_avg, COALESCE(STDDEV_POP(spd), 0) AS spd_sigma,
        AVG(lat) AS lat_c, AVG(lng) AS lng_c,
        AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END) AS night_pct,
        AVG(CASE WHEN alt IS NOT NULL AND alt < 1000 THEN 1.0 ELSE 0 END) AS low_alt_pct,
        (ARRAY_AGG(DISTINCT icao) FILTER (WHERE icao IS NOT NULL AND icao <> ''))[1:8] AS icao_set,
        (ARRAY_AGG(DISTINCT cs) FILTER (WHERE cs IS NOT NULL AND cs <> ''))[1:24] AS callsign_set
      FROM base GROUP BY reg HAVING COUNT(*) >= ${minPings}
    ),
    radius AS (
      SELECT b.reg,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY
               3958.8 * 2 * asin(sqrt(
                 power(sin(radians((b.lat - a.lat_c)/2)), 2) +
                 cos(radians(a.lat_c)) * cos(radians(b.lat)) *
                 power(sin(radians((b.lng - a.lng_c)/2)), 2)))) AS geo_radius_mi
      FROM base b JOIN agg a ON a.reg = b.reg GROUP BY b.reg
    ),
    hours AS (
      SELECT reg, ARRAY_AGG(c ORDER BY h)::bigint[] AS hour_hist FROM (
        SELECT r.reg, g.h, COUNT(b.ts)::bigint AS c
        FROM (SELECT reg FROM agg) r
        CROSS JOIN generate_series(0,23) g(h)
        LEFT JOIN base b ON b.reg = r.reg AND EXTRACT(HOUR FROM b.ts) = g.h
        GROUP BY r.reg, g.h
      ) s GROUP BY reg
    )
    INSERT INTO soda_aircraft_fingerprint (
      registration, pings, days_active, first_seen, last_seen,
      alt_avg, alt_sigma, spd_avg, spd_sigma, lat_c, lng_c, geo_radius_mi,
      night_pct, low_alt_pct, hour_hist, icao_set, callsign_set,
      trained_at, baseline_days)
    SELECT a.reg, a.pings, a.days_active, a.first_seen, a.last_seen,
           a.alt_avg, a.alt_sigma, a.spd_avg, a.spd_sigma, a.lat_c, a.lng_c,
           COALESCE(r.geo_radius_mi, 0), a.night_pct, a.low_alt_pct,
           COALESCE(h.hour_hist, array_fill(0::bigint, ARRAY[24])),
           COALESCE(a.icao_set, '{}'), COALESCE(a.callsign_set, '{}'),
           NOW(), ${baselineDays}
    FROM agg a
    LEFT JOIN radius r ON r.reg = a.reg
    LEFT JOIN hours  h ON h.reg = a.reg
    ON CONFLICT (registration) DO UPDATE SET
      pings = EXCLUDED.pings, days_active = EXCLUDED.days_active,
      first_seen = EXCLUDED.first_seen, last_seen = EXCLUDED.last_seen,
      alt_avg = EXCLUDED.alt_avg, alt_sigma = EXCLUDED.alt_sigma,
      spd_avg = EXCLUDED.spd_avg, spd_sigma = EXCLUDED.spd_sigma,
      lat_c = EXCLUDED.lat_c, lng_c = EXCLUDED.lng_c,
      geo_radius_mi = EXCLUDED.geo_radius_mi,
      night_pct = EXCLUDED.night_pct, low_alt_pct = EXCLUDED.low_alt_pct,
      hour_hist = EXCLUDED.hour_hist,
      icao_set = EXCLUDED.icao_set, callsign_set = EXCLUDED.callsign_set,
      trained_at = NOW(), baseline_days = EXCLUDED.baseline_days
    RETURNING registration`);

  return {
    ok: true, action: "train", part, shards: SHARDS.length,
    fingerprints: (rows as unknown[]).length, baselineDays, holdoutDays, ms: Date.now() - t0,
  };
}

/* ─────────────────────────── stage 2b: score ─────────────────────────── */

type Fp = {
  registration: string; alt_avg: number; alt_sigma: number; spd_avg: number;
  spd_sigma: number; lat_c: number; lng_c: number; geo_radius_mi: number;
  night_pct: number; low_alt_pct: number;
};

const N = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null;

// 5-feature normalised behaviour vector used for the nearest-fingerprint test.
function vec(f: {
  alt_avg: number; spd_avg: number; lat_c: number; lng_c: number; night_pct: number;
}) {
  return [
    N(f.alt_avg) / 40000,
    N(f.spd_avg) / 600,
    N(f.lat_c) / 90,
    N(f.lng_c) / 180,
    N(f.night_pct),
  ];
}
const dist = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

async function score(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const part = Number(body.part) || 0;
  const evalHours = Math.min(Math.max(Number(body.evalHours) || 72, 1), 720);
  const minPings = Math.max(Number(body.minPings) || 5, 2);
  const t0 = Date.now();

  const observed = await sql.unsafe(`
    WITH base AS (
      SELECT UPPER(TRIM(d.registration)) AS reg,
             LOWER(TRIM(d.icao24)) AS icao,
             UPPER(TRIM(d.callsign)) AS cs,
             d.detection_timestamp AS ts,
             d.latitude AS lat, d.longitude AS lng,
             d.altitude AS alt, d.speed AS spd
      FROM ${TABLE} d
      WHERE d.detection_timestamp >= NOW() - INTERVAL '${evalHours} hours'
        AND d.registration IS NOT NULL AND TRIM(d.registration) <> ''
        AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
        ${shardClause(part)}
    ),
    steps AS (
      SELECT reg,
             3958.8 * 2 * asin(sqrt(
               power(sin(radians((lat - LAG(lat) OVER w)/2)), 2) +
               cos(radians(LAG(lat) OVER w)) * cos(radians(lat)) *
               power(sin(radians((lng - LAG(lng) OVER w)/2)), 2))) AS mi,
             EXTRACT(EPOCH FROM (ts - LAG(ts) OVER w)) AS secs
      FROM base WINDOW w AS (PARTITION BY reg ORDER BY ts)
    ),
    kin AS (
      SELECT reg, MAX(mi / NULLIF(secs, 0) * 3600 * 0.868976) AS max_implied_kts
      FROM steps WHERE secs BETWEEN 5 AND 900 GROUP BY reg
    ),
    obs AS (
      SELECT reg,
        COUNT(*)::bigint AS pings,
        MIN(ts) AS win_start, MAX(ts) AS win_end,
        AVG(alt) AS alt_avg, AVG(spd) AS spd_avg,
        AVG(lat) AS lat_c, AVG(lng) AS lng_c,
        AVG(CASE WHEN EXTRACT(HOUR FROM ts) < 6 OR EXTRACT(HOUR FROM ts) >= 22 THEN 1.0 ELSE 0 END) AS night_pct,
        AVG(CASE WHEN alt IS NOT NULL AND alt < 1000 THEN 1.0 ELSE 0 END) AS low_alt_pct,
        (ARRAY_AGG(DISTINCT icao) FILTER (WHERE icao IS NOT NULL AND icao <> ''))[1:6] AS icao_set,
        (ARRAY_AGG(DISTINCT cs) FILTER (WHERE cs IS NOT NULL AND cs <> ''))[1:12] AS callsign_set
      FROM base GROUP BY reg HAVING COUNT(*) >= ${minPings}
    )
    SELECT o.*, k.max_implied_kts,
           f.alt_avg AS f_alt_avg, f.alt_sigma AS f_alt_sigma,
           f.spd_avg AS f_spd_avg, f.spd_sigma AS f_spd_sigma,
           f.lat_c AS f_lat_c, f.lng_c AS f_lng_c, f.geo_radius_mi AS f_radius,
           f.night_pct AS f_night_pct, f.pings AS f_pings,
           f.icao_set AS f_icao_set, f.callsign_set AS f_callsign_set
    FROM obs o
    LEFT JOIN kin k ON k.reg = o.reg
    LEFT JOIN soda_aircraft_fingerprint f ON f.registration = o.reg`);

  const rows = observed as Array<Record<string, unknown>>;
  if (!rows.length) return { ok: true, action: "score", part, scored: 0, flagged: 0, ms: Date.now() - t0 };

  // Fingerprint library for the nearest-match (impersonation) test.
  const lib = await sql.unsafe(`
    SELECT registration, alt_avg, spd_avg, lat_c, lng_c, night_pct
    FROM soda_aircraft_fingerprint
    WHERE pings >= 50 AND alt_avg IS NOT NULL
    LIMIT 20000`) as unknown as Fp[];
  const libVecs = lib.map((f) => ({ reg: f.registration, v: vec(f) }));

  const out: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    const reg = String(r.reg);
    const trained = r.f_pings !== null && r.f_pings !== undefined;
    const evidence: string[] = [];

    // Kinematic deviation from the tail's own learned envelope.
    const zAlt = trained
      ? Math.abs(N(r.alt_avg) - N(r.f_alt_avg)) / Math.max(N(r.f_alt_sigma), 500)
      : 0;
    const zSpd = trained
      ? Math.abs(N(r.spd_avg) - N(r.f_spd_avg)) / Math.max(N(r.f_spd_sigma), 25)
      : 0;

    // Geographic displacement beyond the learned 95th-percentile envelope.
    let geoDev = 0;
    if (trained) {
      const R = 3958.8, toRad = Math.PI / 180;
      const dLat = (N(r.lat_c) - N(r.f_lat_c)) * toRad;
      const dLng = (N(r.lng_c) - N(r.f_lng_c)) * toRad;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(N(r.f_lat_c) * toRad) * Math.cos(N(r.lat_c) * toRad) * Math.sin(dLng / 2) ** 2;
      geoDev = Math.max(0, R * 2 * Math.asin(Math.sqrt(a)) - N(r.f_radius));
    }

    // Identity-field checks — the paper's ICAO-manipulation signal.
    const obsIcao = (r.icao_set as string[] | null) || [];
    const fpIcao = (r.f_icao_set as string[] | null) || [];
    const obsCs = (r.callsign_set as string[] | null) || [];
    const fpCs = (r.f_callsign_set as string[] | null) || [];
    const newIcao = trained && fpIcao.length > 0 && obsIcao.some((i) => !fpIcao.includes(i));
    const newCallsign = trained && fpCs.length > 0 && obsCs.some((c) => !fpCs.includes(c));

    const maxKts = N(r.max_implied_kts);
    const impossible = maxKts > 700;

    // Nearest-fingerprint check: does another tail explain this behaviour better?
    let nearest: string | null = null, gain = 0;
    if (trained && libVecs.length) {
      const ov = vec({
        alt_avg: N(r.alt_avg), spd_avg: N(r.spd_avg),
        lat_c: N(r.lat_c), lng_c: N(r.lng_c), night_pct: N(r.night_pct),
      });
      const own = libVecs.find((l) => l.reg === reg);
      const ownD = own ? dist(ov, own.v) : Infinity;
      let bestD = Infinity, bestReg = "";
      for (const l of libVecs) {
        if (l.reg === reg) continue;
        const d = dist(ov, l.v);
        if (d < bestD) { bestD = d; bestReg = l.reg; }
      }
      if (Number.isFinite(ownD) && bestD < ownD * 0.3 && ownD > 0.08) {
        nearest = bestReg;
        gain = ownD > 0 ? (ownD - bestD) / ownD : 0;
      }
    }

    if (newIcao) evidence.push(`ICAO address ${obsIcao.filter((i) => !fpIcao.includes(i)).join(", ")} never used by this tail in baseline (${fpIcao.join(", ") || "none"})`);
    if (newCallsign) evidence.push(`Unseen callsign ${obsCs.filter((c) => !fpCs.includes(c)).join(", ")}`);
    if (impossible) evidence.push(`Implied ground speed ${Math.round(maxKts)} kt between consecutive positions — physically impossible for this airframe`);
    if (zAlt >= 3) evidence.push(`Altitude profile ${zAlt.toFixed(1)}σ off its own baseline (${Math.round(N(r.alt_avg))} ft vs ${Math.round(N(r.f_alt_avg))} ft)`);
    if (zSpd >= 3) evidence.push(`Ground-speed profile ${zSpd.toFixed(1)}σ off baseline (${Math.round(N(r.spd_avg))} kt vs ${Math.round(N(r.f_spd_avg))} kt)`);
    if (geoDev > 25) evidence.push(`Operating ${Math.round(geoDev)} mi outside its learned ${Math.round(N(r.f_radius))} mi envelope`);
    if (nearest) evidence.push(`Behaviour matches ${nearest}'s fingerprint far better than its own (${Math.round(gain * 100)}% closer) — possible impersonation`);
    if (!trained) evidence.push("No baseline fingerprint — first observation of this tail, identity unverified");

    // Weighted deviation → logistic spoof probability.
    const deviation =
      (newIcao ? 3.2 : 0) +
      (impossible ? 3.0 : 0) +
      (nearest ? 2.0 * Math.min(gain / 0.5, 1) : 0) +
      Math.min(zAlt, 6) * 0.35 +
      Math.min(zSpd, 6) * 0.35 +
      Math.min(geoDev / 100, 2) * 0.8 +
      (newCallsign ? 0.8 : 0) +
      (!trained ? 0.6 : 0);
    const prob = 1 / (1 + Math.exp(-(deviation - 2.6)));
    const verdict = prob >= 0.8 ? "SPOOF_LIKELY"
      : prob >= 0.55 ? "SUSPECT"
      : prob >= 0.3 ? "ANOMALOUS"
      : "CONSISTENT";

    out.push({
      registration: reg,
      window_start: iso(r.win_start), window_end: iso(r.win_end),
      pings: N(r.pings), claimed_icao: obsIcao[0] || null,
      z_alt: +zAlt.toFixed(3), z_spd: +zSpd.toFixed(3), geo_dev_mi: +geoDev.toFixed(2),
      new_icao: !!newIcao, new_callsign: !!newCallsign,
      max_implied_kts: maxKts ? +maxKts.toFixed(1) : null,
      nearest_match: nearest, nearest_gain: +gain.toFixed(3),
      deviation_score: +deviation.toFixed(3),
      spoof_probability: +prob.toFixed(4),
      verdict,
      evidence: JSON.stringify({ reasons: evidence, trained, baseline_pings: N(r.f_pings) }),
    });
  }

  const CHUNK = 400;
  for (let i = 0; i < out.length; i += CHUNK) {
    const slice = out.slice(i, i + CHUNK);
    const values = slice.map((o) => {
      const q = (v: unknown) =>
        v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
      const n = (v: unknown) => (v === null || v === undefined ? "NULL" : Number(v));
      return `(${q(o.registration)}, ${q(o.window_start)}, ${q(o.window_end)}, ${n(o.pings)},
        ${q(o.claimed_icao)}, ${n(o.z_alt)}, ${n(o.z_spd)}, ${n(o.geo_dev_mi)},
        ${o.new_icao ? "true" : "false"}, ${o.new_callsign ? "true" : "false"},
        ${n(o.max_implied_kts)}, ${q(o.nearest_match)}, ${n(o.nearest_gain)},
        ${n(o.deviation_score)}, ${n(o.spoof_probability)}, ${q(o.verdict)}, ${q(o.evidence)}::jsonb)`;
    }).join(",");
    await sql.unsafe(`
      INSERT INTO soda_identity_scores (
        registration, window_start, window_end, pings, claimed_icao, z_alt, z_spd,
        geo_dev_mi, new_icao, new_callsign, max_implied_kts, nearest_match,
        nearest_gain, deviation_score, spoof_probability, verdict, evidence)
      VALUES ${values}
      ON CONFLICT (registration, window_start) DO UPDATE SET
        window_end = EXCLUDED.window_end, pings = EXCLUDED.pings,
        claimed_icao = EXCLUDED.claimed_icao, z_alt = EXCLUDED.z_alt, z_spd = EXCLUDED.z_spd,
        geo_dev_mi = EXCLUDED.geo_dev_mi, new_icao = EXCLUDED.new_icao,
        new_callsign = EXCLUDED.new_callsign, max_implied_kts = EXCLUDED.max_implied_kts,
        nearest_match = EXCLUDED.nearest_match, nearest_gain = EXCLUDED.nearest_gain,
        deviation_score = EXCLUDED.deviation_score,
        spoof_probability = EXCLUDED.spoof_probability, verdict = EXCLUDED.verdict,
        evidence = EXCLUDED.evidence, created_at = NOW()`);
  }

  const flagged = out.filter((o) => Number(o.spoof_probability) >= 0.55).length;
  return {
    ok: true, action: "score", part, shards: SHARDS.length,
    scored: out.length, flagged, evalHours, ms: Date.now() - t0,
  };
}

/* ─────────────────────────── read side ─────────────────────────── */

async function list(sql: ReturnType<typeof postgres>, body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 500);
  const minProb = Number(body.minProb) || 0;
  const search = String(body.search || "").toUpperCase().replace(/'/g, "");
  const rows = await sql.unsafe(`
    SELECT s.*
    FROM soda_identity_scores s
    WHERE s.spoof_probability >= ${minProb}
      ${search ? `AND s.registration LIKE '%${search}%'` : ""}
    ORDER BY s.spoof_probability DESC, s.window_end DESC
    LIMIT ${limit}`);
  return { ok: true, rows };
}

async function stats(sql: ReturnType<typeof postgres>) {
  const [f] = await sql.unsafe(`
    SELECT COUNT(*)::int AS fingerprints, MAX(trained_at) AS trained_at
    FROM soda_aircraft_fingerprint`);
  const [s] = await sql.unsafe(`
    SELECT COUNT(*)::int AS scored,
      COUNT(*) FILTER (WHERE verdict = 'SPOOF_LIKELY')::int AS spoof_likely,
      COUNT(*) FILTER (WHERE verdict = 'SUSPECT')::int AS suspect,
      COUNT(*) FILTER (WHERE verdict = 'ANOMALOUS')::int AS anomalous,
      COUNT(*) FILTER (WHERE new_icao)::int AS icao_swaps,
      COUNT(*) FILTER (WHERE nearest_match IS NOT NULL)::int AS impersonations,
      MAX(created_at) AS last_run
    FROM soda_identity_scores`);
  return { ok: true, stats: { ...(f as object), ...(s as object) }, shards: SHARDS.length };
}

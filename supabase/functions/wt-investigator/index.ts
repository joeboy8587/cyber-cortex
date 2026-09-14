// Watchtower Autonomous Investigator
// Findings memory + sense pass + bounded thread-pulling investigations + scoring/feedback.
// All state lives in Neon under wt_* tables. Additive only — nothing is deleted.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const AOI = { lat: 35.4377286, lng: -119.0252189 };
const PAD = 0.18; // ~20 km box

// Deterministic detectors. base = starting confidence before corroboration.
const RULES: Record<string, { base: number; title: string }> = {
  NEW_SUBJECT_IN_AOI: { base: 0.45, title: "First appearance over the area of interest" },
  FREQUENCY_SPIKE: { base: 0.62, title: "Presence increased sharply versus the prior month" },
  SUB_STALL_PHYSICS: { base: 0.80, title: "Telemetry below fixed-wing stall speed" },
  LOW_ALTITUDE_RESIDENCE: { base: 0.70, title: "Low pass close to the residence" },
  NIGHT_PRESENCE: { base: 0.58, title: "Repeated night-hours presence" },
  REPEAT_DAYS: { base: 0.55, title: "Returned on multiple separate days" },
};

const AUTO_ACCEPT = 0.75;
const REVIEW_FLOOR = 0.45;

function neon() {
  const url = Deno.env.get("NEON_DATABASE_URL");
  if (!url) throw new Error("NEON_DATABASE_URL not configured");
  return postgres(url, {
    ssl: { rejectUnauthorized: false },
    max: 2,
    idle_timeout: 15,
    connect_timeout: 15,
    prepare: false,
    fetch_types: false,
    onnotice: () => {},
    connection: { application_name: "wt-investigator", statement_timeout: 25000 },
  });
}

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch (e) { console.warn("step skipped:", (e as Error).message); return fallback; }
};

async function migrate(sql: any) {
  await sql`CREATE TABLE IF NOT EXISTS wt_findings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    signature text UNIQUE NOT NULL,
    rule_code text NOT NULL,
    subject_type text NOT NULL DEFAULT 'aircraft',
    subject text NOT NULL,
    claim text NOT NULL,
    confidence numeric NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'new',
    layer text NOT NULL DEFAULT 'behaviour',
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
    times_corroborated int NOT NULL DEFAULT 0,
    times_contradicted int NOT NULL DEFAULT 0,
    occurrences int NOT NULL DEFAULT 1,
    investigated_at timestamptz,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS wt_findings_status_idx ON wt_findings (status, confidence DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS wt_findings_subject_idx ON wt_findings (subject)`;

  await sql`CREATE TABLE IF NOT EXISTS wt_finding_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id uuid NOT NULL,
    source_table text NOT NULL,
    source_ref text,
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS wt_finding_evidence_fid ON wt_finding_evidence (finding_id)`;

  await sql`CREATE TABLE IF NOT EXISTS wt_investigations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id uuid NOT NULL,
    subject text NOT NULL,
    depth int NOT NULL DEFAULT 0,
    steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    outcome text NOT NULL DEFAULT 'pending',
    narrative text,
    corroborations int NOT NULL DEFAULT 0,
    contradictions int NOT NULL DEFAULT 0,
    duration_ms int,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS wt_investigations_fid ON wt_investigations (finding_id)`;

  await sql`CREATE TABLE IF NOT EXISTS wt_subject_profiles (
    subject text PRIMARY KEY,
    subject_type text NOT NULL DEFAULT 'aircraft',
    total_detections bigint NOT NULL DEFAULT 0,
    detections_30d bigint NOT NULL DEFAULT 0,
    detections_prev_30d bigint NOT NULL DEFAULT 0,
    distinct_days_30d int NOT NULL DEFAULT 0,
    min_altitude numeric,
    min_speed numeric,
    night_detections_30d int NOT NULL DEFAULT 0,
    first_detection timestamptz,
    last_detection timestamptz,
    monthly jsonb NOT NULL DEFAULT '[]'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS wt_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id uuid NOT NULL,
    rule_code text NOT NULL,
    verdict text NOT NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;

  await sql`CREATE TABLE IF NOT EXISTS wt_rule_weights (
    rule_code text PRIMARY KEY,
    hits int NOT NULL DEFAULT 1,
    misses int NOT NULL DEFAULT 1,
    reliability numeric NOT NULL DEFAULT 0.5,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`;
  for (const code of Object.keys(RULES)) {
    await sql`INSERT INTO wt_rule_weights (rule_code) VALUES (${code}) ON CONFLICT (rule_code) DO NOTHING`;
  }

  await sql`CREATE TABLE IF NOT EXISTS wt_job_state (
    job text PRIMARY KEY,
    status text NOT NULL DEFAULT 'idle',
    paused_reason text,
    lease_until timestamptz,
    watermark timestamptz,
    last_run timestamptz,
    last_result jsonb NOT NULL DEFAULT '{}'::jsonb
  )`;
  await sql`INSERT INTO wt_job_state (job) VALUES ('sense') ON CONFLICT (job) DO NOTHING`;
  await sql`INSERT INTO wt_job_state (job) VALUES ('investigate') ON CONFLICT (job) DO NOTHING`;

  // One-time cleanup: ground-level (0 ft) rows are parked data, not low passes.
  await sql`UPDATE wt_findings SET status = 'dismissed', updated_at = now()
            WHERE rule_code = 'LOW_ALTITUDE_RESIDENCE' AND claim LIKE '% at 0 ft.%'
              AND status NOT IN ('confirmed','dismissed')`;

  return { migrated: true };
}

async function weights(sql: any): Promise<Record<string, number>> {
  const rows = await safe(sql`SELECT rule_code, reliability FROM wt_rule_weights`, [] as any[]);
  const w: Record<string, number> = {};
  for (const r of rows) w[r.rule_code] = Number(r.reliability) || 0.5;
  return w;
}

function scoreOf(rule: string, reliability: number, corr: number, contra: number) {
  const base = RULES[rule]?.base ?? 0.5;
  // reliability 0.5 is neutral; it can move the score by ±30%.
  const adj = base * (0.7 + 0.6 * reliability);
  const v = adj * (1 + 0.08 * corr) - 0.18 * contra;
  return Math.max(0, Math.min(0.99, Number(v.toFixed(3))));
}

const statusFor = (c: number) => (c >= AUTO_ACCEPT ? "accepted" : c >= REVIEW_FLOOR ? "review" : "weak");

async function upsertFinding(sql: any, f: {
  rule: string; subject: string; claim: string; evidence: Record<string, unknown>;
  confidence: number; layer?: string; sigExtra?: string;
}) {
  const signature = `${f.rule}|${f.subject.toUpperCase()}|${f.sigExtra ?? ""}`;
  const rows = await sql`
    INSERT INTO wt_findings (signature, rule_code, subject, claim, confidence, status, layer, evidence)
    VALUES (${signature}, ${f.rule}, ${f.subject.toUpperCase()}, ${f.claim}, ${f.confidence},
            ${statusFor(f.confidence)}, ${f.layer ?? "behaviour"}, ${sql.json(f.evidence)})
    ON CONFLICT (signature) DO UPDATE SET
      occurrences = wt_findings.occurrences + 1,
      last_seen = now(),
      updated_at = now(),
      claim = EXCLUDED.claim,
      evidence = EXCLUDED.evidence,
      confidence = GREATEST(wt_findings.confidence, EXCLUDED.confidence),
      status = CASE WHEN wt_findings.status IN ('confirmed','wrong','dismissed')
                    THEN wt_findings.status ELSE EXCLUDED.status END
    RETURNING id, (xmax = 0) AS inserted`;
  return rows[0];
}

// ---------------------------------------------------------------- sense pass
async function sense(sql: any, hours: number, cap: number) {
  const started = Date.now();
  const w = await weights(sql);
  const created: any[] = [];
  const skipped: string[] = [];

  // Recent AOI activity, collapsed per aircraft.
  const recent = await safe(sql`
    SELECT UPPER(registration) AS reg,
           COUNT(*)::int AS pings,
           MIN(NULLIF(altitude::numeric, 0)) AS min_alt,
           MIN(NULLIF(speed::numeric,0)) AS min_speed,
           MIN(detection_timestamp) AS first_ts,
           MAX(detection_timestamp) AS last_ts,
           COUNT(DISTINCT date_trunc('day', detection_timestamp))::int AS days,
           COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') >= 22
                               OR EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') < 5)::int AS night,
           MIN(ST_DistanceSphere(ST_MakePoint(longitude::float8, latitude::float8),
                                 ST_MakePoint(${AOI.lng}, ${AOI.lat}))) AS min_dist_m,
           MIN(NULLIF(altitude::numeric, 0)) FILTER (
             WHERE ST_DistanceSphere(ST_MakePoint(longitude::float8, latitude::float8),
                                     ST_MakePoint(${AOI.lng}, ${AOI.lat})) < 3000
           ) AS near_min_alt
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - (${hours} || ' hours')::interval
      AND registration IS NOT NULL AND registration <> ''
      AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
    GROUP BY 1
    ORDER BY pings DESC
    LIMIT ${cap}
  `, [] as any[]);

  if (!recent.length) skipped.push("recent_detections");

  const tails: string[] = recent.map((r: any) => r.reg).filter(Boolean);

  // Rolling history for the same tails — powers "more present than last month".
  const hist = tails.length ? await safe(sql`
    SELECT UPPER(registration) AS reg,
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE detection_timestamp > NOW() - INTERVAL '30 days')::bigint AS d30,
      COUNT(*) FILTER (WHERE detection_timestamp <= NOW() - INTERVAL '30 days'
                         AND detection_timestamp > NOW() - INTERVAL '60 days')::bigint AS prev30,
      MIN(detection_timestamp) AS first_ts,
      MAX(detection_timestamp) AS last_ts
    FROM live_flight_detections_rows
    WHERE UPPER(registration) = ANY(string_to_array(${tails.join("|")}, '|'))
      AND detection_timestamp > NOW() - INTERVAL '400 days'
    GROUP BY 1
  `, [] as any[]) : [];
  if (tails.length && !hist.length) skipped.push("history");
  const histMap = new Map(hist.map((h: any) => [h.reg, h]));

  // Airframe class — a helicopter at 20 knots is normal, not a physics violation.
  const types = tails.length ? await safe(sql`
    SELECT UPPER(registration) AS reg, COALESCE(aircraft_type,'') AS aircraft_type
    FROM aircraft_dossier
    WHERE UPPER(registration) = ANY(string_to_array(${tails.join("|")}, '|'))
  `, [] as any[]) : [];
  const rotor = new Set(
    types
      .filter((t: any) => /HELI|ROTOR|SIKORSKY|ROBINSON|BELL |EUROCOPTER|AIRBUS HELI|MD HELI|AS3|EC1|R44|R66|UH-|BK117/i.test(t.aircraft_type))
      .map((t: any) => t.reg),
  );

  for (const r of recent) {
    const h: any = histMap.get(r.reg) || {};
    const d30 = Number(h.d30 || 0), prev30 = Number(h.prev30 || 0), total = Number(h.total || r.pings);
    const firstTs = h.first_ts ? new Date(h.first_ts) : new Date(r.first_ts);
    const windowStart = Date.now() - hours * 3600_000;

    // rolling profile
    await safe(sql`
      INSERT INTO wt_subject_profiles (subject, total_detections, detections_30d, detections_prev_30d,
        distinct_days_30d, min_altitude, min_speed, night_detections_30d, first_detection, last_detection, updated_at)
      VALUES (${r.reg}, ${total}, ${d30}, ${prev30}, ${r.days}, ${r.min_alt}, ${r.min_speed},
              ${r.night}, ${h.first_ts ?? r.first_ts}, ${h.last_ts ?? r.last_ts}, now())
      ON CONFLICT (subject) DO UPDATE SET
        total_detections = EXCLUDED.total_detections,
        detections_30d = EXCLUDED.detections_30d,
        detections_prev_30d = EXCLUDED.detections_prev_30d,
        distinct_days_30d = EXCLUDED.distinct_days_30d,
        min_altitude = LEAST(COALESCE(wt_subject_profiles.min_altitude, EXCLUDED.min_altitude), EXCLUDED.min_altitude),
        min_speed = LEAST(COALESCE(wt_subject_profiles.min_speed, EXCLUDED.min_speed), EXCLUDED.min_speed),
        night_detections_30d = EXCLUDED.night_detections_30d,
        first_detection = LEAST(wt_subject_profiles.first_detection, EXCLUDED.first_detection),
        last_detection = GREATEST(wt_subject_profiles.last_detection, EXCLUDED.last_detection),
        updated_at = now()
    `, null);

    const emit = async (rule: string, claim: string, evidence: Record<string, unknown>, sigExtra?: string) => {
      const conf = scoreOf(rule, w[rule] ?? 0.5, 0, 0);
      const row = await safe(upsertFinding(sql, { rule, subject: r.reg, claim, evidence, confidence: conf, sigExtra }), null as any);
      if (row) created.push({ id: row.id, rule, subject: r.reg, claim, confidence: conf, isNew: row.inserted });
    };

    if (firstTs.getTime() >= windowStart && total <= r.pings) {
      await emit("NEW_SUBJECT_IN_AOI",
        `${r.reg} appears over the area for the first time in the archive (${r.pings} contacts).`,
        { pings: r.pings, first_seen: r.first_ts, min_altitude_ft: r.min_alt });
    }
    if (prev30 >= 3 && d30 >= 10 && d30 >= prev30 * 2) {
      await emit("FREQUENCY_SPIKE",
        `${r.reg} is over the area far more than last month: ${d30} contacts in the last 30 days versus ${prev30} the month before.`,
        { last_30d: d30, prior_30d: prev30, ratio: Number((d30 / Math.max(prev30, 1)).toFixed(2)) },
        new Date().toISOString().slice(0, 7));
    }
    if (!rotor.has(r.reg) && r.min_speed != null && Number(r.min_speed) > 0 && Number(r.min_speed) < 48 && Number(r.min_alt) > 200) {
      await emit("SUB_STALL_PHYSICS",
        `${r.reg} reports ${Math.round(Number(r.min_speed))} knots at ${Math.round(Number(r.min_alt))} ft — below fixed-wing stall speed.`,
        { min_speed_kts: Number(r.min_speed), min_altitude_ft: Number(r.min_alt) },
        new Date().toISOString().slice(0, 10));
    }
    const nearAlt = r.near_min_alt != null ? Number(r.near_min_alt) : null;
    if (r.min_dist_m != null && Number(r.min_dist_m) < 3000 && nearAlt != null && nearAlt > 0 && nearAlt < 2500) {
      await emit("LOW_ALTITUDE_RESIDENCE",
        `${r.reg} passed within ${(Number(r.min_dist_m) / 1000).toFixed(1)} km of the residence at ${Math.round(nearAlt)} ft.`,
        { min_distance_m: Math.round(Number(r.min_dist_m)), altitude_ft_near_residence: nearAlt },
        new Date().toISOString().slice(0, 10));
    }
    if (r.night >= 3) {
      await emit("NIGHT_PRESENCE",
        `${r.reg} was overhead ${r.night} times between 10 pm and 5 am local.`,
        { night_contacts: r.night }, new Date().toISOString().slice(0, 10));
    }
    if (r.days >= 3) {
      await emit("REPEAT_DAYS",
        `${r.reg} returned over the area on ${r.days} separate days in this window.`,
        { distinct_days: r.days }, new Date().toISOString().slice(0, 10));
    }
  }

  await safe(sql`UPDATE wt_job_state SET last_run = now(), watermark = now(),
      last_result = ${sql.json({ created: created.length, subjects: recent.length, skipped })}
      WHERE job = 'sense'`, null);

  return {
    subjects_scanned: recent.length,
    findings_written: created.length,
    new_findings: created.filter((c) => c.isNew).length,
    created: created.slice(0, 40),
    skipped,
    duration_ms: Date.now() - started,
  };
}

// -------------------------------------------------------- thread-pull engine
async function investigate(sql: any, findingId: string | null, maxDepth = 6) {
  const started = Date.now();
  const f = findingId
    ? (await sql`SELECT * FROM wt_findings WHERE id = ${findingId}`)[0]
    : (await sql`SELECT * FROM wt_findings
         WHERE status NOT IN ('wrong','dismissed') AND investigated_at IS NULL
         ORDER BY confidence DESC, last_seen DESC LIMIT 1`)[0];
  if (!f) return { message: "nothing to investigate" };

  const subject: string = f.subject;
  const steps: any[] = [];
  let corr = 0, contra = 0;
  const addStep = (name: string, label: string, result: any, effect: "corroborate" | "contradict" | "neutral" | "unavailable") => {
    steps.push({ step: name, question: label, result, effect });
    if (effect === "corroborate") corr++;
    if (effect === "contradict") contra++;
  };

  // 1. Has this subject done this before?
  const prof = (await safe(sql`SELECT * FROM wt_subject_profiles WHERE subject = ${subject}`, [] as any[]))[0];
  const monthly = await safe(sql`
    SELECT to_char(date_trunc('month', detection_timestamp), 'YYYY-MM') AS month, COUNT(*)::int AS contacts
    FROM live_flight_detections_rows
    WHERE UPPER(registration) = ${subject}
      AND detection_timestamp > NOW() - INTERVAL '365 days'
      AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
    GROUP BY 1 ORDER BY 1
  `, null as any);
  if (monthly === null) addStep("history", "Has this aircraft been here before?", null, "unavailable");
  else {
    const months = monthly.length;
    addStep("history", "Has this aircraft been here before?",
      { months_present: months, monthly },
      months >= 3 ? "corroborate" : months <= 1 ? "neutral" : "neutral");
    if (months >= 3) {
      await safe(sql`UPDATE wt_subject_profiles SET monthly = ${sql.json(monthly)}, updated_at = now() WHERE subject = ${subject}`, null);
    }
  }

  // 2. Who else was up at the same time?
  const partners = await safe(sql`
    WITH me AS (
      SELECT DISTINCT FLOOR(EXTRACT(EPOCH FROM detection_timestamp) / 900)::bigint AS bucket
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${subject}
        AND detection_timestamp > NOW() - INTERVAL '14 days'
        AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
        AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
      LIMIT 2000
    )
    SELECT UPPER(d.registration) AS reg, COUNT(DISTINCT me.bucket)::int AS shared_windows
    FROM live_flight_detections_rows d
    JOIN me ON FLOOR(EXTRACT(EPOCH FROM d.detection_timestamp) / 900)::bigint = me.bucket
    WHERE d.detection_timestamp > NOW() - INTERVAL '14 days'
      AND d.registration IS NOT NULL AND UPPER(d.registration) <> ${subject}
      AND d.latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND d.longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
    GROUP BY 1 HAVING COUNT(DISTINCT me.bucket) >= 3
    ORDER BY shared_windows DESC LIMIT 12
  `, null as any);
  if (partners === null) addStep("co_presence", "Who else was overhead at the same time?", null, "unavailable");
  else addStep("co_presence", "Who else was overhead at the same time?",
    { partners }, partners.length >= 3 ? "corroborate" : "neutral");

  // 3. Who really owns it — FAA master is authoritative, dossier is the resolved view.
  let identity = await safe(sql`
    SELECT registration, icao24, operator, operator_type, operator_city, operator_state,
           aircraft_type, faa_matched
    FROM aircraft_dossier WHERE UPPER(registration) = ${subject} LIMIT 1
  `, null as any);
  if (identity === null || !identity.length) {
    identity = await safe(sql`
      SELECT n_number, name AS operator, type_aircraft AS aircraft_type, city AS operator_city, state AS operator_state
      FROM faa_master WHERE UPPER(TRIM(n_number)) = ${subject.replace(/^N/, "")} LIMIT 1
    `, identity);
  }
  if (identity === null) addStep("identity", "Who does the FAA registry say owns it?", null, "unavailable");
  else addStep("identity", "Who does the FAA registry say owns it?",
    identity[0] ?? null, identity.length ? "corroborate" : "contradict");

  const ownerName: string | null =
    identity && identity[0]
      ? (identity[0].operator || identity[0].owner_name || identity[0].registrant_name || null)
      : null;

  // 4. Does the owner touch the shell network?
  if (ownerName) {
    const shells = await safe(sql`
      SELECT company_name
      FROM shell_companies
      WHERE company_name ILIKE ${"%" + ownerName.slice(0, 18) + "%"}
      LIMIT 5
    `, null as any);
    if (shells === null) addStep("shell_network", "Does the owner connect to a known shell entity?", null, "unavailable");
    else addStep("shell_network", "Does the owner connect to a known shell entity?",
      { owner: ownerName, matches: shells }, shells.length ? "corroborate" : "neutral");
  } else {
    addStep("shell_network", "Does the owner connect to a known shell entity?", { owner: null }, "neutral");
  }

  // 5. Behaviourally similar airframes (pre-computed neighbours from the GPU embeddings).
  const neighbours = await safe(sql`
    SELECT neighbors FROM aircraft_dossier_embeddings WHERE UPPER(registration) = ${subject} LIMIT 1
  `, null as any);
  if (neighbours === null) addStep("behaviour_match", "Which airframes behave like this one?", null, "unavailable");
  else {
    const list = (neighbours[0]?.neighbors ?? []) as any[];
    const top = Array.isArray(list) ? list.slice(0, 8) : [];
    addStep("behaviour_match", "Which airframes behave like this one?", { neighbours: top },
      top.some((n: any) => Number(n?.similarity ?? n?.score ?? 0) >= 0.85) ? "corroborate" : "neutral");
  }

  // 6. Did it line up with a physiological event?
  const bio = await safe(sql`
    SELECT aircraft_registration AS registration, threat_score, threat_level,
           correlation_strength
    FROM unified_biometric_aircraft_correlation_final
    WHERE UPPER(aircraft_registration) = ${subject}
    ORDER BY COALESCE(threat_score, 0) DESC
    LIMIT 5
  `, null as any);
  if (bio === null) addStep("biometric", "Did its passes line up with a heart-rate event?", null, "unavailable");
  else addStep("biometric", "Did its passes line up with a heart-rate event?",
    { correlations: bio }, bio.length ? "corroborate" : "neutral");

  // ------- rescore
  const w = await weights(sql);
  const confidence = scoreOf(f.rule_code, w[f.rule_code] ?? 0.5, corr, contra);
  const outcome = corr >= 3 ? "thread_holds" : corr >= 1 ? "partial" : "cold";

  // Narrative in plain language (never blocks the record).
  let narrative: string | null = null;
  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (key) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.8-flash",
          max_tokens: 1500,
          messages: [
            {
              role: "system",
              content:
                "You are Josiah, the Watchtower investigator. Write 3-5 plain sentences for a non-technical reader. " +
                "State only what the evidence supports. Keep behaviour/integrity findings separate from registry-identity findings. " +
                "Never label anything a civil-rights violation. If a step was unavailable, say the data is not captured yet.",
            },
            {
              role: "user",
              content: `Claim: ${f.claim}\nRule: ${f.rule_code}\nInvestigation steps:\n${JSON.stringify(steps).slice(0, 12000)}`,
            },
          ],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        narrative = d.choices?.[0]?.message?.content ?? null;
      } else if (res.status === 402 || res.status === 403) {
        await safe(sql`UPDATE wt_job_state SET status='paused', paused_reason=${`AI blocked: ${res.status}`} WHERE job='investigate'`, null);
      }
    }
  } catch (e) { console.warn("narrative skipped:", (e as Error).message); }

  const inv = (await sql`
    INSERT INTO wt_investigations (finding_id, subject, depth, steps, outcome, narrative, corroborations, contradictions, duration_ms)
    VALUES (${f.id}, ${subject}, ${Math.min(steps.length, maxDepth)}, ${sql.json(steps)}, ${outcome},
            ${narrative}, ${corr}, ${contra}, ${Date.now() - started})
    RETURNING id`)[0];

  await sql`UPDATE wt_findings SET
      confidence = ${confidence},
      status = CASE WHEN status IN ('confirmed','wrong','dismissed') THEN status ELSE ${statusFor(confidence)} END,
      times_corroborated = ${corr}, times_contradicted = ${contra},
      investigated_at = now(), updated_at = now()
    WHERE id = ${f.id}`;

  for (const s of steps.filter((x) => x.effect === "corroborate")) {
    await safe(sql`INSERT INTO wt_finding_evidence (finding_id, source_table, source_ref, detail)
      VALUES (${f.id}, ${s.step}, ${subject}, ${sql.json(s.result ?? {})})`, null);
  }

  return {
    investigation_id: inv.id, finding_id: f.id, subject, outcome,
    confidence, status: statusFor(confidence), corroborations: corr, contradictions: contra,
    steps, narrative, duration_ms: Date.now() - started,
  };
}

// ---------------------------------------------------------------- feedback
async function feedback(sql: any, findingId: string, verdict: string, note?: string) {
  const f = (await sql`SELECT rule_code FROM wt_findings WHERE id = ${findingId}`)[0];
  if (!f) throw new Error("finding not found");
  await sql`INSERT INTO wt_feedback (finding_id, rule_code, verdict, note)
    VALUES (${findingId}, ${f.rule_code}, ${verdict}, ${note ?? null})`;

  const status = verdict === "real" ? "confirmed" : verdict === "not_real" ? "wrong" : "review";
  await sql`UPDATE wt_findings SET status = ${status}, updated_at = now() WHERE id = ${findingId}`;

  if (verdict === "real" || verdict === "not_real") {
    const hit = verdict === "real";
    await sql`UPDATE wt_rule_weights SET
        hits = hits + ${hit ? 1 : 0},
        misses = misses + ${hit ? 0 : 1},
        reliability = (hits + ${hit ? 1 : 0})::numeric / NULLIF((hits + misses + 1), 0),
        updated_at = now()
      WHERE rule_code = ${f.rule_code}`;
  }
  return { finding_id: findingId, status, rule_code: f.rule_code };
}

// ------------------------------------------------------------------- reads
async function list(sql: any, status: string | null, limit: number) {
  const rows = status
    ? await sql`SELECT * FROM wt_findings WHERE status = ${status} ORDER BY confidence DESC, last_seen DESC LIMIT ${limit}`
    : await sql`SELECT * FROM wt_findings WHERE status NOT IN ('wrong','dismissed') ORDER BY last_seen DESC LIMIT ${limit}`;
  const counts = await safe(sql`SELECT status, COUNT(*)::int AS n FROM wt_findings GROUP BY 1`, [] as any[]);
  const rules = await safe(sql`SELECT * FROM wt_rule_weights ORDER BY reliability DESC`, [] as any[]);
  const jobs = await safe(sql`SELECT * FROM wt_job_state`, [] as any[]);
  return { findings: rows, counts, rules, jobs };
}

async function detail(sql: any, findingId: string) {
  const f = (await sql`SELECT * FROM wt_findings WHERE id = ${findingId}`)[0] ?? null;
  const investigations = await safe(sql`SELECT * FROM wt_investigations WHERE finding_id = ${findingId} ORDER BY created_at DESC LIMIT 5`, [] as any[]);
  const profile = f ? (await safe(sql`SELECT * FROM wt_subject_profiles WHERE subject = ${f.subject}`, [] as any[]))[0] ?? null : null;
  return { finding: f, investigations, profile };
}

async function brief(sql: any, hours: number) {
  const since = `${hours} hours`;
  const fresh = await safe(sql`SELECT * FROM wt_findings
     WHERE last_seen > NOW() - (${since})::interval
     ORDER BY confidence DESC LIMIT 40`, [] as any[]);
  const needsYou = await safe(sql`SELECT * FROM wt_findings WHERE status = 'review'
     ORDER BY confidence DESC LIMIT 25`, [] as any[]);
  const strongest = await safe(sql`SELECT * FROM wt_findings WHERE status IN ('accepted','confirmed')
     ORDER BY confidence DESC, last_seen DESC LIMIT 15`, [] as any[]);
  const recentWork = await safe(sql`SELECT id, subject, outcome, narrative, created_at
     FROM wt_investigations ORDER BY created_at DESC LIMIT 10`, [] as any[]);
  return {
    generated_at: new Date().toISOString(),
    window_hours: hours,
    whats_new: fresh, needs_your_call: needsYou, strongest, recent_investigations: recentWork,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let sql: any;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "list");
    sql = neon();

    // Everything depends on the tables existing.
    await migrate(sql);

    switch (action) {
      case "migrate":
        return json({ ok: true, ...(await migrate(sql)) });
      case "sense": {
        const paused = (await safe(sql`SELECT status, paused_reason FROM wt_job_state WHERE job='sense'`, [] as any[]))[0];
        if (paused?.status === "paused") return json({ ok: false, paused: true, reason: paused.paused_reason });
        return json({ ok: true, ...(await sense(sql, Math.min(720, Number(body.hours) || 24), Math.min(400, Number(body.limit) || 120))) });
      }
      case "investigate": {
        const paused = (await safe(sql`SELECT status, paused_reason FROM wt_job_state WHERE job='investigate'`, [] as any[]))[0];
        if (paused?.status === "paused") return json({ ok: false, paused: true, reason: paused.paused_reason });
        return json({ ok: true, ...(await investigate(sql, body.finding_id ?? null)) });
      }
      case "investigate_batch": {
        const n = Math.min(5, Number(body.count) || 3);
        const out = [];
        for (let i = 0; i < n; i++) out.push(await investigate(sql, null));
        return json({ ok: true, runs: out });
      }
      case "feedback":
        return json({ ok: true, ...(await feedback(sql, String(body.finding_id), String(body.verdict), body.note)) });
      case "detail":
        return json({ ok: true, ...(await detail(sql, String(body.finding_id))) });
      case "brief":
        return json({ ok: true, ...(await brief(sql, Math.min(168, Number(body.hours) || 24))) });
      case "resume":
        await sql`UPDATE wt_job_state SET status='idle', paused_reason=NULL`;
        return json({ ok: true, resumed: true });
      case "list":
      default:
        return json({ ok: true, ...(await list(sql, body.status ?? null, Math.min(200, Number(body.limit) || 60))) });
    }
  } catch (e) {
    console.error("wt-investigator error:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    try { await sql?.end(); } catch { /* ignore */ }
  }
});

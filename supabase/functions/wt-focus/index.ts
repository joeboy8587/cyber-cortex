// Watchtower Focus Fire
// Four work queues the operator asked to prioritise:
//   1. identity conflicts  2. single-subject deep dive
//   3. coordinated aircraft pairs  4. promotion of extracted facts into exhibits
// Read-heavy; the only writes are conflict resolutions, exhibit rows and fact status.
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "npm:@supabase/supabase-js@2";

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
const PAD = 0.18;

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
    connection: { application_name: "wt-focus", statement_timeout: 25000 },
  });
}

function cloud() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try { return await p; } catch (e) { console.warn("step skipped:", (e as Error).message); return fallback; }
};

const TAIL = /^N[0-9][0-9A-Z]{0,4}$/;
const PLACEHOLDER =
  /(john doe|jane smith|emily davis|alice white|robert johnson|michael brown|emily johnson|123 main|123 aviation|456 elm|789 oak)/i;

// ───────────────────────── 1. identity conflicts ─────────────────────────
async function conflicts(sql: any) {
  const db = cloud();
  const { data, error } = await db
    .from("operator_profile_conflicts")
    .select("id, registration, field, value_a, source_a, value_b, source_b, detected_at")
    .eq("resolved", false)
    .order("detected_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const out: any[] = [];
  for (const c of rows) {
    const subject = String(c.registration ?? "").toUpperCase().trim();
    const isTail = TAIL.test(subject);
    const junk = PLACEHOLDER.test(`${c.value_a ?? ""} ${c.value_b ?? ""}`);
    let authority: any = null;

    if (isTail) {
      const d = await safe(sql`
        SELECT registration, icao24, operator, operator_type, operator_city, operator_state,
               aircraft_type, faa_matched
        FROM aircraft_dossier WHERE UPPER(registration) = ${subject} LIMIT 1
      `, [] as any[]);
      authority = d?.[0] ?? null;
      if (!authority) {
        const m = await safe(sql`
          SELECT n_number, name AS operator, type_aircraft AS aircraft_type,
                 city AS operator_city, state AS operator_state
          FROM faa_master WHERE UPPER(TRIM(n_number)) = ${subject.replace(/^N/, "")} LIMIT 1
        `, [] as any[]);
        authority = m?.[0] ?? null;
      }
    }

    out.push({
      ...c,
      kind: isTail ? "aircraft_identity" : "network_link",
      quality: junk ? "placeholder" : "real",
      authority,
      suggested_resolution: junk
        ? "Placeholder data — not evidence. Dismiss."
        : authority
          ? `FAA registry: ${authority.operator ?? "unknown operator"}${authority.aircraft_type ? ` · ${authority.aircraft_type}` : ""}`
          : isTail
            ? "No FAA record resolved — needs a manual registry lookup."
            : "Not an aircraft identity conflict — this is a shell-network link. Route it to the network map.",
    });
  }

  return {
    total: rows.length,
    aircraft_identity: out.filter((o) => o.kind === "aircraft_identity").length,
    network_links: out.filter((o) => o.kind === "network_link").length,
    placeholders: out.filter((o) => o.quality === "placeholder").length,
    conflicts: out,
  };
}

async function resolveConflict(id: string, resolvedValue: string) {
  const db = cloud();
  const { error } = await db
    .from("operator_profile_conflicts")
    .update({ resolved: true, resolved_value: resolvedValue })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, id, resolved_value: resolvedValue };
}

// ───────────────────────── 2. subject deep dive ─────────────────────────
async function dossier(sql: any, subjectRaw: string) {
  const subject = subjectRaw.toUpperCase().trim();
  const box = sql`
    AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
    AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}`;

  const [identity, monthly, spikeDays, lowPasses, night, bio, partners, neigh] = await Promise.all([
    safe(sql`
      SELECT registration, icao24, operator, operator_type, operator_city, operator_state,
             aircraft_type, faa_matched
      FROM aircraft_dossier WHERE UPPER(registration) = ${subject} LIMIT 1`, [] as any[]),
    safe(sql`
      SELECT to_char(date_trunc('month', detection_timestamp), 'YYYY-MM') AS month, COUNT(*)::int AS contacts
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${subject}
        AND detection_timestamp > NOW() - INTERVAL '540 days' ${box}
      GROUP BY 1 ORDER BY 1`, [] as any[]),
    safe(sql`
      SELECT date_trunc('day', detection_timestamp)::date AS day, COUNT(*)::int AS contacts,
             MIN(altitude)::int AS min_alt, MIN(speed)::int AS min_speed
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${subject}
        AND detection_timestamp > NOW() - INTERVAL '120 days' ${box}
      GROUP BY 1 ORDER BY contacts DESC LIMIT 15`, [] as any[]),
    safe(sql`
      SELECT detection_timestamp, altitude::int AS altitude, speed::int AS speed, latitude, longitude,
             ROUND((111320 * SQRT(POWER(latitude - ${AOI.lat}, 2) +
               POWER((longitude - ${AOI.lng}) * COS(RADIANS(${AOI.lat})), 2)))::numeric) AS metres_from_home
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${subject}
        AND detection_timestamp > NOW() - INTERVAL '120 days'
        AND altitude IS NOT NULL AND altitude BETWEEN 1 AND 2500 ${box}
      ORDER BY detection_timestamp DESC LIMIT 40`, [] as any[]),
    safe(sql`
      SELECT COUNT(*)::int AS night_contacts,
             COUNT(DISTINCT date_trunc('day', detection_timestamp))::int AS night_days
      FROM live_flight_detections_rows
      WHERE UPPER(registration) = ${subject}
        AND detection_timestamp > NOW() - INTERVAL '120 days'
        AND EXTRACT(HOUR FROM detection_timestamp AT TIME ZONE 'America/Los_Angeles') NOT BETWEEN 6 AND 21
        ${box}`, [] as any[]),
    safe(sql`
      SELECT aircraft_registration AS registration, threat_score, threat_level, correlation_strength
      FROM unified_biometric_aircraft_correlation_final
      WHERE UPPER(aircraft_registration) = ${subject}
      ORDER BY COALESCE(threat_score, 0) DESC LIMIT 10`, [] as any[]),
    safe(sql`
      WITH me AS (
        SELECT DISTINCT FLOOR(EXTRACT(EPOCH FROM detection_timestamp) / 900)::bigint AS bucket
        FROM live_flight_detections_rows
        WHERE UPPER(registration) = ${subject}
          AND detection_timestamp > NOW() - INTERVAL '30 days' ${box}
        LIMIT 3000
      )
      SELECT UPPER(d.registration) AS reg, COUNT(DISTINCT me.bucket)::int AS shared_windows
      FROM live_flight_detections_rows d
      JOIN me ON FLOOR(EXTRACT(EPOCH FROM d.detection_timestamp) / 900)::bigint = me.bucket
      WHERE d.detection_timestamp > NOW() - INTERVAL '30 days'
        AND d.registration IS NOT NULL AND UPPER(d.registration) <> ${subject} ${box}
      GROUP BY 1 HAVING COUNT(DISTINCT me.bucket) >= 3
      ORDER BY shared_windows DESC LIMIT 15`, [] as any[]),
    safe(sql`SELECT neighbors FROM aircraft_dossier_embeddings WHERE UPPER(registration) = ${subject} LIMIT 1`, [] as any[]),
  ]);

  const months = (monthly ?? []) as any[];
  const last = months[months.length - 1]?.contacts ?? 0;
  const prev = months[months.length - 2]?.contacts ?? 0;
  const peak = months.reduce((m, r) => Math.max(m, Number(r.contacts) || 0), 0);

  return {
    subject,
    identity: identity?.[0] ?? null,
    monthly: months,
    trend: { this_month: last, last_month: prev, peak_month: peak, multiple: prev ? +(last / prev).toFixed(2) : null },
    spike_days: spikeDays ?? [],
    low_passes: lowPasses ?? [],
    night: night?.[0] ?? { night_contacts: 0, night_days: 0 },
    biometric: bio ?? [],
    co_present: partners ?? [],
    behaviour_neighbours: Array.isArray(neigh?.[0]?.neighbors) ? neigh[0].neighbors.slice(0, 10) : [],
  };
}

// ───────────────────────── 3. coordinated pairs ─────────────────────────
async function pairs(sql: any, days: number, minShared: number) {
  const rows = await safe(sql`
    WITH ctx AS (
      SELECT UPPER(registration) AS reg,
             FLOOR(EXTRACT(EPOCH FROM detection_timestamp) / 900)::bigint AS bucket
      FROM live_flight_detections_rows
      WHERE detection_timestamp > NOW() - make_interval(days => ${days})
        AND registration IS NOT NULL AND registration <> ''
        AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
        AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
      GROUP BY 1, 2
    ),
    tops AS (SELECT reg, COUNT(*)::int AS windows FROM ctx GROUP BY 1 ORDER BY windows DESC LIMIT 70)
    SELECT a.reg AS reg_a, b.reg AS reg_b, COUNT(*)::int AS shared_windows,
           ta.windows AS windows_a, tb.windows AS windows_b
    FROM ctx a
    JOIN ctx b ON a.bucket = b.bucket AND a.reg < b.reg
    JOIN tops ta ON ta.reg = a.reg
    JOIN tops tb ON tb.reg = b.reg
    GROUP BY 1, 2, 4, 5
    HAVING COUNT(*) >= ${minShared}
    ORDER BY shared_windows DESC
    LIMIT 40
  `, null as any);

  if (rows === null) return { window_days: days, unavailable: true, pairs: [] };

  const regs = [...new Set(rows.flatMap((r: any) => [r.reg_a, r.reg_b]))];
  const owners = regs.length
    ? await safe(sql`
        SELECT UPPER(registration) AS reg, operator, aircraft_type
        FROM aircraft_dossier
        WHERE UPPER(registration) = ANY(string_to_array(${regs.join("|")}, '|'))`, [] as any[])
    : [];
  const byReg = new Map((owners ?? []).map((o: any) => [o.reg, o]));

  const enriched = rows.map((r: any) => {
    const overlap = Math.min(1, r.shared_windows / Math.max(1, Math.min(r.windows_a, r.windows_b)));
    const oa = byReg.get(r.reg_a) as any, ob = byReg.get(r.reg_b) as any;
    return {
      ...r,
      overlap_ratio: +overlap.toFixed(3),
      same_operator: !!(oa?.operator && ob?.operator && oa.operator === ob.operator),
      operator_a: oa?.operator ?? null,
      operator_b: ob?.operator ?? null,
      type_a: oa?.aircraft_type ?? null,
      type_b: ob?.aircraft_type ?? null,
      verdict:
        overlap >= 0.5 && r.shared_windows >= 12 ? "tight coordination"
        : overlap >= 0.3 ? "recurring overlap"
        : "loose overlap",
    };
  });

  return { window_days: days, min_shared: minShared, pairs: enriched };
}

// ─────────── 3b. shell-to-shell handoffs (the "baton pass") ───────────
// One tail leaves the sector as another enters. Adversaries avoid holding a
// single registration over a target for hours; the relay is the signature.
const SHELL_KEYWORDS = [
  "WINGSLEASING", "WINGS LEASING", "9K AIR", "FF22", "BEST EQUIPMENT", "BEST AVIATION",
  "LEASING", "HOLDINGS", "LLC TRUSTEE", "TRUSTEE", "AIRCRAFT HOLDING",
];

async function handoffs(sql: any, days: number, gapMin: number) {
  // Step 1 — resolve the shell fleet from the registry (cheap, indexed).
  const fleet = await safe(sql`
    SELECT UPPER(registration) AS reg, operator, aircraft_type
    FROM aircraft_dossier
    WHERE UPPER(COALESCE(operator, '')) ~ ${SHELL_KEYWORDS.join("|")}
    LIMIT 400
  `, [] as any[]);
  const meta = new Map((fleet ?? []).map((f: any) => [f.reg, f]));
  const tails = [...meta.keys()];
  if (!tails.length) return { window_days: days, shell_visits: 0, shell_tails: 0, recurring_relays: [], handoffs: [] };

  // Step 2 — pull only those tails' passes over the AOI.
  const rows = await safe(sql`
    SELECT UPPER(registration) AS reg, detection_timestamp AS ts, altitude
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - make_interval(days => ${days})
      AND UPPER(registration) = ANY(string_to_array(${tails.join("|")}, '|'))
      AND latitude BETWEEN ${AOI.lat - PAD} AND ${AOI.lat + PAD}
      AND longitude BETWEEN ${AOI.lng - PAD} AND ${AOI.lng + PAD}
    ORDER BY detection_timestamp ASC
    LIMIT 30000
  `, null as any);
  if (rows === null) return { window_days: days, unavailable: true, handoffs: [] };
  for (const r of rows as any[]) {
    const m: any = meta.get(r.reg);
    r.operator = m?.operator ?? null;
    r.aircraft_type = m?.aircraft_type ?? null;
  }

  const isShell = (_op: string | null) => true; // every tail here is already a shell registrant


  // Presence segments: a gap over 25 minutes starts a new visit.
  type Seg = { reg: string; operator: string | null; type: string | null; start: number; end: number; minAlt: number; pings: number };
  const segs: Seg[] = [];
  const open = new Map<string, Seg>();
  for (const r of rows as any[]) {
    const t = new Date(r.ts).getTime();
    const alt = Number(r.altitude);
    const cur = open.get(r.reg);
    if (cur && t - cur.end <= 25 * 60000) {
      cur.end = t; cur.pings++;
      if (Number.isFinite(alt) && alt > 0) cur.minAlt = Math.min(cur.minAlt, alt);
    } else {
      if (cur) segs.push(cur);
      open.set(r.reg, {
        reg: r.reg, operator: r.operator ?? null, type: r.aircraft_type ?? null,
        start: t, end: t, minAlt: Number.isFinite(alt) && alt > 0 ? alt : 99999, pings: 1,
      });
    }
  }
  for (const s of open.values()) segs.push(s);

  // A relay participant has to be IN the sector, not overflying it in cruise.
  // Anything that never came below 6,000ft is airway traffic, not a loiter.
  const SECTOR_CEILING_FT = 6000;
  const shellSegs = segs.filter(
    (s) => isShell(s.operator) && s.pings >= 2 && s.minAlt <= SECTOR_CEILING_FT,
  );
  shellSegs.sort((a, b) => a.start - b.start);

  const out: any[] = [];
  for (let i = 0; i < shellSegs.length; i++) {
    const a = shellSegs[i];
    for (let j = 0; j < shellSegs.length; j++) {
      if (i === j) continue;
      const b = shellSegs[j];
      if (b.reg === a.reg) continue;
      const deltaMin = (b.start - a.end) / 60000;
      if (deltaMin < -5 || deltaMin > gapMin) continue;
      out.push({
        outgoing: a.reg, outgoing_operator: a.operator, outgoing_type: a.type,
        incoming: b.reg, incoming_operator: b.operator, incoming_type: b.type,
        handoff_at: new Date(a.end).toISOString(),
        gap_minutes: +deltaMin.toFixed(1),
        outgoing_dwell_min: +((a.end - a.start) / 60000).toFixed(1),
        incoming_dwell_min: +((b.end - b.start) / 60000).toFixed(1),
        outgoing_min_alt: a.minAlt === 99999 ? null : a.minAlt,
        incoming_min_alt: b.minAlt === 99999 ? null : b.minAlt,
        same_operator: !!(a.operator && b.operator && a.operator === b.operator),
        verdict: deltaMin <= 5 ? "tight relay" : deltaMin <= 15 ? "sequential relay" : "loose relay",
      });
    }
  }
  out.sort((x, y) => x.gap_minutes - y.gap_minutes);

  const byPair = new Map<string, number>();
  for (const h of out) {
    const k = [h.outgoing, h.incoming].sort().join(" ↔ ");
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }

  return {
    window_days: days,
    max_gap_minutes: gapMin,
    shell_visits: shellSegs.length,
    shell_tails: [...new Set(shellSegs.map((s) => s.reg))].length,
    recurring_relays: [...byPair.entries()]
      .filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([pair, count]) => ({ pair, count })),
    handoffs: out.slice(0, 60),
  };
}

// ───────── 3c. federal front-company sweep (AP / BuzzFeed / Intercept) ─────────
const FRONT_NAMES = [
  "FVX RESEARCH", "KQM AVIATION", "NBR AVIATION", "PXW SERVICES", "NG RESEARCH",
  "OBR LEASING", "OTV LEASING", "NBY PRODUCTIONS", "PSL SURVEYS", "RKT PRODUCTIONS",
  "AEROGRAPHICS", "NATIONAL AIRCRAFT LEASING", "SILVER CREEK AVIATION",
  "CHAPARRAL AIR GROUP", "EARLY DETECTION ALARM", "GLOBAL GEO MAPPING",
  "MIDWEST AERIAL IMAGING", "AIR CERBERUS",
];
const CONFIRMED_FRONT_TAILS = ["N125AL", "N484JB", "N795DH"];

async function fronts(sql: any, days: number) {
  const regex = FRONT_NAMES.join("|");

  const registry = await safe(sql`
    SELECT UPPER(registration) AS reg, operator, operator_city, operator_state, aircraft_type
    FROM aircraft_dossier
    WHERE UPPER(COALESCE(operator, '')) ~ ${regex}
    LIMIT 200
  `, [] as any[]);

  const registryTails = [...new Set((registry ?? []).map((r: any) => r.reg))];
  const watch = [...new Set([...registryTails, ...CONFIRMED_FRONT_TAILS])];

  const contacts = watch.length
    ? await safe(sql`
        SELECT UPPER(registration) AS reg, COUNT(*)::int AS contacts,
               MIN(detection_timestamp) AS first_seen, MAX(detection_timestamp) AS last_seen,
               MIN(NULLIF(altitude, 0))::int AS min_alt,
               COUNT(DISTINCT DATE(detection_timestamp))::int AS days_seen
        FROM live_flight_detections_rows
        WHERE UPPER(registration) = ANY(string_to_array(${watch.join("|")}, '|'))
          AND detection_timestamp > NOW() - make_interval(days => ${days})
        GROUP BY 1 ORDER BY contacts DESC LIMIT 100
      `, [] as any[])
    : [];

  // Owner-string matches straight off the detection feed (catches tails the
  // dossier has not resolved yet).
  const feedMatches = await safe(sql`
    SELECT UPPER(registration) AS reg, owner_operator, COUNT(*)::int AS contacts,
           MAX(detection_timestamp) AS last_seen
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - make_interval(days => ${days})
      AND UPPER(COALESCE(owner_operator, '')) ~ ${regex}
    GROUP BY 1, 2 ORDER BY contacts DESC LIMIT 100
  `, [] as any[]);

  const byReg = new Map((contacts ?? []).map((c: any) => [c.reg, c]));
  const regMeta = new Map((registry ?? []).map((r: any) => [r.reg, r]));

  const detected = [...new Set([
    ...(contacts ?? []).map((c: any) => c.reg),
    ...(feedMatches ?? []).map((f: any) => f.reg),
  ])].map((reg) => {
    const c: any = byReg.get(reg);
    const m: any = regMeta.get(reg);
    const f: any = (feedMatches ?? []).find((x: any) => x.reg === reg);
    return {
      registration: reg,
      operator: m?.operator ?? f?.owner_operator ?? null,
      operator_city: m?.operator_city ?? null,
      operator_state: m?.operator_state ?? null,
      aircraft_type: m?.aircraft_type ?? null,
      contacts: c?.contacts ?? f?.contacts ?? 0,
      days_seen: c?.days_seen ?? null,
      min_alt: c?.min_alt ?? null,
      first_seen: c?.first_seen ?? null,
      last_seen: c?.last_seen ?? f?.last_seen ?? null,
      confirmed_front_tail: CONFIRMED_FRONT_TAILS.includes(reg),
    };
  }).sort((a, b) => b.contacts - a.contacts);

  return {
    window_days: days,
    front_companies_checked: FRONT_NAMES.length,
    registry_matches: registry ?? [],
    detected_in_airspace: detected,
    detected_count: detected.filter((d) => d.contacts > 0).length,
  };
}

// ───────────────────────── 4. facts → exhibits ─────────────────────────
async function facts() {
  const db = cloud();
  const [{ data: pending }, { count: total }, { count: promoted }] = await Promise.all([
    db.from("rag_extractions")
      .select("id, document_id, extraction_type, label, value, context, confidence, status, created_at")
      .neq("status", "promoted")
      .gte("confidence", 0.85)
      .order("confidence", { ascending: false })
      .limit(150),
    db.from("rag_extractions").select("*", { count: "exact", head: true }),
    db.from("rag_extractions").select("*", { count: "exact", head: true }).eq("status", "promoted"),
  ]);
  const { data: cases } = await db.from("cases").select("case_id, case_code, case_name").order("case_code");
  return { total: total ?? 0, already_promoted: promoted ?? 0, ready: pending ?? [], cases: cases ?? [] };
}

async function promoteFacts(ids: string[], caseId: string) {
  const db = cloud();
  const { data: rows, error } = await db
    .from("rag_extractions")
    .select("id, extraction_type, label, value, context, confidence, document_id")
    .in("id", ids);
  if (error) throw new Error(error.message);
  if (!rows?.length) return { ok: true, promoted: 0 };

  const { data: caseRow } = await db.from("cases").select("case_code").eq("case_id", caseId).maybeSingle();
  const code = caseRow?.case_code ?? "CASE";
  const results: any[] = [];


  for (const r of rows) {
    const body = [r.label, r.value, r.context].filter(Boolean).join(" — ");
    const hash = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${r.id}|${body}`)),
    )].map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: ex, error: exErr } = await db.from("exhibits").insert({
      case_id: caseId,
      exhibit_code: await nextExhibitCode(db, code),
      exhibit_name: (r.label ?? "Extracted fact").slice(0, 120),
      tier: Number(r.confidence) >= 0.95 ? 1 : 2,
      evidence_type: `document_extraction:${r.extraction_type}`,
      description: body.slice(0, 4000),
      legal_significance: `Extracted from ingested document ${r.document_id} at ${Math.round(Number(r.confidence) * 100)}% extraction confidence.`,
      file_count: 1,
      promotion_rule: "focus_fire.manual_promotion",
      sha256_hash: hash,
      chain_of_custody: { source: "rag_extractions", source_id: r.id, promoted_at: new Date().toISOString() },
      status: "active",
    }).select("exhibit_id").maybeSingle();

    if (exErr) { results.push({ id: r.id, ok: false, error: exErr.message }); continue; }

    await db.from("rag_extractions").update({
      status: "promoted",
      promoted_to: `exhibits:${ex?.exhibit_id}`,
      promoted_at: new Date().toISOString(),
    }).eq("id", r.id);

    await db.from("exhibit_audit_trail").insert({
      case_id: caseId,
      exhibit_id: ex?.exhibit_id,
      action: "promote_extracted_fact",
      rule_applied: "focus_fire.manual_promotion",
      result_hash: hash,
      records_evaluated: 1,
      records_promoted: 1,
      performed_by: "focus-fire",
      metadata: { extraction_id: r.id, extraction_type: r.extraction_type },
    }).then(() => {}, () => {});

    results.push({ id: r.id, ok: true, exhibit_id: ex?.exhibit_id });
  }

  return { ok: true, promoted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), results };
}

// ───────────────────────── 5. settled facts (institutional memory) ─────────────────────────
async function sha256(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function settledFacts() {
  const db = cloud();
  const [{ data: rows }, { data: cases }] = await Promise.all([
    db.from("settled_facts")
      .select("id, subject, subject_type, fact_class, headline, proof_summary, supporting_sources, case_id, exhibit_id, evidence_hash, locked_at, superseded, superseded_reason")
      .order("locked_at", { ascending: false })
      .limit(500),
    db.from("cases").select("case_id, case_code, case_name").order("case_code"),
  ]);
  const live = (rows ?? []).filter((r: any) => !r.superseded);
  return {
    facts: rows ?? [],
    cases: cases ?? [],
    locked_count: live.length,
    subjects_locked: new Set(live.map((r: any) => String(r.subject).toUpperCase())).size,
    with_exhibit: live.filter((r: any) => r.exhibit_id).length,
  };
}

async function lockSettledFact(b: any) {
  const db = cloud();
  const subject = String(b.subject ?? "").trim().toUpperCase();
  const factClass = String(b.fact_class ?? "").trim();
  const headline = String(b.headline ?? "").trim();
  const proof = String(b.proof_summary ?? "").trim();
  if (!subject || !factClass || !headline || !proof) {
    return { ok: false, error: "Subject, what kind of fact, a headline and the proof are all required." };
  }
  const sources = Array.isArray(b.supporting_sources) ? b.supporting_sources : [];
  const hash = await sha256(`${subject}|${factClass}|${headline}|${proof}|${JSON.stringify(sources)}`);

  const { data, error } = await db.from("settled_facts").insert({
    subject,
    subject_type: String(b.subject_type ?? "aircraft"),
    lifecycle_stage: "SETTLED",
    fact_class: factClass,
    headline: headline.slice(0, 300),
    proof_summary: proof.slice(0, 8000),
    supporting_sources: sources,
    case_id: b.case_id ?? null,
    evidence_hash: hash,
  }).select("id, evidence_hash").maybeSingle();

  if (error) {
    if (/duplicate key/i.test(error.message)) {
      return { ok: false, error: "This fact is already locked for that subject." };
    }
    return { ok: false, error: error.message };
  }

  // Optional: immediately file it as a numbered exhibit.
  let exhibitId: string | null = null;
  if (b.case_id && b.create_exhibit !== false) {
    const { data: caseRow } = await db.from("cases").select("case_code").eq("case_id", b.case_id).maybeSingle();
    const code = caseRow?.case_code ?? "CASE";
    const { data: ex, error: exErr } = await db.from("exhibits").insert({
      case_id: b.case_id,
      exhibit_code: await nextExhibitCode(db, code),
      exhibit_name: headline.slice(0, 255),
      tier: 1,
      evidence_type: `settled_fact:${factClass}`.slice(0, 100),

      description: proof.slice(0, 4000),
      legal_significance: `Settled fact locked for ${subject}. Established through ${sources.length} corroborating source(s); no longer re-litigated by automated scanning.`,
      file_count: 1,
      promotion_rule: "focus_fire.settled_fact_lock",
      sha256_hash: hash,
      chain_of_custody: { source: "settled_facts", source_id: data?.id, locked_at: new Date().toISOString() },
      status: "active",
    }).select("exhibit_id").maybeSingle();
    exhibitId = ex?.exhibit_id ?? null;
    if (exhibitId) {
      await db.from("settled_facts").update({ exhibit_id: exhibitId }).eq("id", data?.id);
      await db.from("exhibit_audit_trail").insert({
        case_id: b.case_id,
        exhibit_id: exhibitId,
        action: "lock_settled_fact",
        rule_applied: "focus_fire.settled_fact_lock",
        result_hash: hash,
        records_evaluated: 1,
        records_promoted: 1,
        performed_by: "focus-fire",
        metadata: { settled_fact_id: data?.id, subject, fact_class: factClass },
      }).then(() => {}, () => {});
    }
  }

  return { ok: true, id: data?.id, evidence_hash: hash, exhibit_id: exhibitId };
}

async function supersedeSettledFact(id: string, reason: string) {
  const db = cloud();
  const { error } = await db.from("settled_facts")
    .update({ superseded: true, superseded_reason: reason.slice(0, 1000) })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let sql: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "overview");

    if (action === "settled") return json(await settledFacts());
    if (action === "lock_settled") return json(await lockSettledFact(body));
    if (action === "supersede_settled") {
      if (!body?.id) return json({ ok: false, error: "Missing fact id." }, 400);
      return json(await supersedeSettledFact(String(body.id), String(body?.reason ?? "Superseded by newer evidence.")));
    }
    if (action === "facts") return json(await facts());
    if (action === "promote_facts") {
      const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 100) : [];
      if (!ids.length || !body?.case_id) return json({ ok: false, error: "Pick a case and at least one fact." }, 400);
      return json(await promoteFacts(ids, String(body.case_id)));
    }
    if (action === "resolve_conflict") {
      if (!body?.id) return json({ ok: false, error: "Missing conflict id." }, 400);
      return json(await resolveConflict(String(body.id), String(body?.resolved_value ?? "resolved")));
    }

    sql = neon();
    if (action === "conflicts") return json(await conflicts(sql));
    if (action === "dossier") {
      if (!body?.subject) return json({ ok: false, error: "Missing aircraft." }, 400);
      return json(await dossier(sql, String(body.subject)));
    }
    if (action === "pairs") {
      return json(await pairs(sql, Math.min(180, Number(body?.days) || 30), Math.max(3, Number(body?.min_shared) || 6)));
    }
    if (action === "handoffs") {
      return json(await handoffs(sql, Math.min(90, Number(body?.days) || 30), Math.min(60, Number(body?.gap_minutes) || 20)));
    }
    if (action === "fronts") {
      return json(await fronts(sql, Math.min(3650, Number(body?.days) || 365)));
    }
    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("wt-focus error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    try { if (sql) await sql.end(); } catch { /* noop */ }
  }
});

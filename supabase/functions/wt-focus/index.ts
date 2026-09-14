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
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const results: any[] = [];

  for (const r of rows) {
    const body = [r.label, r.value, r.context].filter(Boolean).join(" — ");
    const hash = [...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${r.id}|${body}`)),
    )].map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: ex, error: exErr } = await db.from("exhibits").insert({
      case_id: caseId,
      exhibit_code: `${stamp}_${code}_FACT_${String(r.id).slice(0, 8).toUpperCase()}`,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let sql: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "overview");

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
    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("wt-focus error:", err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  } finally {
    try { if (sql) await sql.end(); } catch { /* noop */ }
  }
});

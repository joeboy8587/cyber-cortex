// Military ↔ Civil Law-Enforcement Joint Operation Detector (Posse Comitatus signature)
// Finds SIMULTANEOUS co-presence (not sequential handoff) between a law-enforcement
// airframe (KCSO fleet) and a military airframe (US mil ICAO hex block / tail pattern).
// Detections come from Neon; flags are written to Lovable Cloud watchtower_autonomous_flags.

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ error: "NEON_DATABASE_URL not configured" }, 500);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const hours = Math.min(Math.max(Number(body.hours) || 48, 1), 720);
  const proximityNm = Math.min(Math.max(Number(body.proximityNm) || 10, 0.1), 50);
  const windowSec = Math.min(Math.max(Number(body.windowSec) || 300, 30), 3600);
  const persist = body.persist !== false;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let sql: ReturnType<typeof postgres> | null = null;
  try {
    // 1. Law-enforcement fleet (authoritative registry in Cloud)
    const { data: fleet } = await supabase.from("kcso_fleet").select("tail_number, model");
    const leTails = [
      ...new Set([
        ...(fleet ?? []).map((f: { tail_number: string }) => String(f.tail_number).toUpperCase()),
        ...((body.extraTails as string[] | undefined) ?? []).map((t) => String(t).toUpperCase()),
      ]),
    ];
    const modelByTail = Object.fromEntries((fleet ?? []).map((f: { tail_number: string; model: string }) => [
      String(f.tail_number).toUpperCase(), f.model,
    ]));
    sql = postgres(NEON, { ssl: "require", max: 1, idle_timeout: 30, prepare: false });
    await sql.unsafe(`SET statement_timeout = '110000'`).catch(() => {});

    // 2. Simultaneous co-presence: LE ping ↔ MIL ping within windowSec and proximityNm
    // Law-enforcement side = FULL FAA registry (any sheriff / police / patrol / federal
    // enforcement registrant) plus the locally-registered KCSO fleet.
    const tailList = leTails.length
      ? leTails.map((t) => `'${t.replace(/'/g, "")}'`).join(",")
      : "''";
    const rows = (await sql.unsafe(`
      WITH le AS (
        SELECT upper(d.registration) AS tail,
               COALESCE(NULLIF(TRIM(m.name), ''), 'LAW ENFORCEMENT') AS agency,
               d.detection_timestamp AS t,
               d.latitude AS la, d.longitude AS lo, d.altitude AS alt
        FROM live_flight_detections_rows d
        LEFT JOIN faa_master m
          ON m.n_number = regexp_replace(upper(d.registration), '^N', '')
        WHERE d.detection_timestamp > NOW() - INTERVAL '${hours} hours'
          AND d.registration IS NOT NULL
          AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
          AND (
            upper(coalesce(m.name,'')) ~ '(SHERIFF|POLICE|HIGHWAY PATROL|MARSHAL|CUSTOMS|BORDER PROTECTION|HOMELAND|DEPT OF JUSTICE|DEPARTMENT OF JUSTICE|DRUG ENFORCEMENT)'
            OR upper(d.registration) IN (${tailList})
          )
      ),
      mil AS (
        SELECT upper(coalesce(icao24,'')) AS hex,
               upper(coalesce(registration, callsign, icao24, '')) AS mil_id,
               callsign, detection_timestamp AS t,
               latitude AS la, longitude AS lo, altitude AS alt
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '${hours} hours'
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND (
            (length(coalesce(icao24,'')) = 6 AND upper(icao24) BETWEEN 'ADF7C8' AND 'AFFFFF') OR
            coalesce(registration,'') ~ '^[0-9]{2}-[0-9]{3,5}$' OR
            upper(coalesce(callsign,'')) ~ '^(RCH|REACH|KNIFE|STMPD|TRON|CONGO|LASSO|EVAC|SNTRY|DOOM|HAWK|VVBH|BOXER|PYTHN|ROMAN|SHADY|GRZLY|VADER|TITAN|SPAR|POLO|JEDI|DINOCO)'
          )
      ),
      pairs AS (
        SELECT le.tail, le.agency, mil.mil_id, mil.hex, mil.callsign,
               le.t AS le_t, mil.t AS mil_t, le.alt AS le_alt, mil.alt AS mil_alt,
               le.la AS le_la, le.lo AS le_lo,
               (3440.065 * 2 * asin(sqrt(
                  power(sin(radians((le.la - mil.la)/2)), 2) +
                  cos(radians(le.la)) * cos(radians(mil.la)) *
                  power(sin(radians((le.lo - mil.lo)/2)), 2)
               ))) AS nm
        FROM le
        JOIN mil
          ON abs(extract(epoch FROM le.t - mil.t)) <= ${windowSec}
         AND mil.la BETWEEN le.la - 0.35 AND le.la + 0.35
         AND mil.lo BETWEEN le.lo - 0.4  AND le.lo + 0.4
      )
      SELECT tail, max(agency) AS agency, mil_id, hex, max(callsign) AS callsign,
             date_trunc('hour', le_t) AS window_start,
             count(*) AS ping_pairs,
             round(min(nm)::numeric, 2) AS min_nm,
             round(avg(nm)::numeric, 2) AS avg_nm,
             min(le_t) AS first_seen, max(le_t) AS last_seen,
             round(avg(le_la)::numeric, 5) AS lat, round(avg(le_lo)::numeric, 5) AS lng,
             min(le_alt) AS le_min_alt, min(mil_alt) AS mil_min_alt
      FROM pairs
      WHERE nm <= ${proximityNm}
      GROUP BY tail, mil_id, hex, date_trunc('hour', le_t)
      ORDER BY min(nm) ASC, count(*) DESC
      LIMIT 500
    `)) as unknown as Array<Record<string, unknown>>;

    const events = rows.map((r) => {
      const minNm = Number(r.min_nm);
      const pings = Number(r.ping_pairs);
      const confidence = Math.min(
        0.98,
        0.55 + (minNm <= 2 ? 0.25 : minNm <= 5 ? 0.15 : 0.05) + Math.min(0.18, pings / 500),
      );
      return {
        le_tail: String(r.tail),
        le_model: modelByTail[String(r.tail)] ?? null,
        mil_id: String(r.mil_id),
        mil_hex: String(r.hex),
        mil_callsign: r.callsign ? String(r.callsign) : null,
        window_start: r.window_start,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        ping_pairs: pings,
        min_nm: minNm,
        avg_nm: Number(r.avg_nm),
        le_min_alt_ft: r.le_min_alt === null ? null : Number(r.le_min_alt),
        mil_min_alt_ft: r.mil_min_alt === null ? null : Number(r.mil_min_alt),
        lat: Number(r.lat),
        lng: Number(r.lng),
        confidence: +confidence.toFixed(2),
        statute: "18 U.S.C. § 1385 (Posse Comitatus) — military asset co-operating with civil law enforcement",
      };
    });

    // 3. Persist as autonomous flags (dedupe trigger rolls up repeats)
    let flagsWritten = 0;
    if (persist && events.length) {
      const payload = events.slice(0, 50).map((e) => ({
        flag_type: "MILITARY_CIVIL_JOINT_OPERATION",
        severity: "critical",
        registration: e.le_tail,
        description:
          `Simultaneous co-presence: KCSO ${e.le_tail}${e.le_model ? ` (${e.le_model})` : ""} and military ${e.mil_id}` +
          ` closed to ${e.min_nm} nm across ${e.ping_pairs} synchronized ping pairs within ±${windowSec}s.`,
        evidence_summary: e as unknown as Record<string, unknown>,
        cross_references: { mil_hex: e.mil_hex, mil_id: e.mil_id, statute: "18 U.S.C. § 1385" },
        confidence_score: e.confidence,
        source_scan_id: `joint-op-${new Date().toISOString().slice(0, 13)}`,
      }));
      const { error, count } = await supabase
        .from("watchtower_autonomous_flags")
        .insert(payload, { count: "exact" });
      if (error) console.error("flag insert error", error.message);
      flagsWritten = count ?? 0;
    }

    return json({
      data: {
        params: { hours, proximityNm, windowSec },
        le_fleet: leTails,
        events_found: events.length,
        flags_written: flagsWritten,
        events,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("joint-operation-scan error:", err);
    return json({ error: (err as Error).message }, 500);
  } finally {
    if (sql) { try { await sql.end(); } catch { /* noop */ } }
  }
});

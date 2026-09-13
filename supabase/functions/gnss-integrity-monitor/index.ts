// GROUND-SIDE POSITION-DOMAIN INNOVATION MONITOR
// Adapted from: S. Kujur, S. Khanafseh, B. Pervan, "Detecting GNSS spoofing of
// ADS-B equipped aircraft using INS" (ION PLANS 2020 / GNSS 2022, IDM-10).
//
// IMPORTANT SCOPE STATEMENT (must be reproduced in every report):
// Kujur et al. compute the innovation test statistic INSIDE the aircraft
// (GNSS measurement vs INS propagation inside the airborne Kalman filter).
// This monitor is GROUND-SIDE: it compares the BROADCAST ADS-B position against
// a coasted (dead-reckoned) prediction built from the aircraft's own previously
// broadcast state. Same statistic family, different observer. We do NOT
// reproduce the aircraft's internal KF innovation and never claim to.
//
//   q_k = |z_k - H_k x̄_k| / sigma_k        (position-domain, normalised)
//   T   = k_FA                              (normalised fault-free threshold)
//
// sigma_k is the propagated coast covariance: sqrt(sigma0^2 + (drift_rate*dt)^2),
// i.e. the ground-side analogue of the INS covariance that grows while the
// aircraft coasts.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: Record<string, unknown>, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ---------------------------------------------------------------- calibration
// Documented once, used everywhere. A reader must be able to tell what
// false-alarm / missed-detection rate the numbers were produced under.
export const CALIBRATION = {
  k_FA: 3.29,            // two-sided Gaussian, P_FA = 1e-3 per test
  P_FA: 1e-3,
  k_MD: 3.09,            // P_MD = 1e-3 at the minimum detectable bias
  P_MD: 1e-3,
  // Minimum detectable position bias = (k_FA + k_MD) * sigma_k
  mdb_multiplier: 3.29 + 3.09,
  sigma0_m: 30,          // broadcast position quantisation + report noise floor
  drift_rate_m_per_s: 4, // coast growth: tactical-grade INS ~ 4 m/s of drift 1-sigma
  max_gap_s: 120,        // above this the coast prediction is not defensible
  // NACp/NIC: the archive does not carry per-detection NACp. Reported as a gap,
  // never silently assumed.
  nacp_available: false,
};

const R_EARTH_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
function haversineM(a: [number, number], b: [number, number]) {
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}
// Constant-velocity coast from (lat,lng) along heading at ground speed (kts).
function coast(lat: number, lng: number, headingDeg: number, speedKts: number, dtS: number): [number, number] {
  const dist = (speedKts * 0.514444) * dtS; // m
  const brg = toRad(headingDeg);
  const dLat = (dist * Math.cos(brg)) / R_EARTH_M;
  const dLng = (dist * Math.sin(brg)) / (R_EARTH_M * Math.cos(toRad(lat)));
  return [lat + (dLat * 180) / Math.PI, lng + (dLng * 180) / Math.PI];
}

interface Ping {
  registration: string | null; icao24: string | null; callsign: string | null;
  ts: string; lat: number; lng: number; alt: number | null;
  speed: number | null; heading: number | null; vrate: number | null;
  county: string | null;
}

interface Innovation {
  registration: string; icao24: string | null; callsign: string | null;
  ts: string; dt_s: number;
  residual_m: number; sigma_m: number; q: number; T: number;
  mdb_m: number; exceeds: boolean;
  lat: number; lng: number; alt: number | null; vertical_rate: number | null;
  county: string | null;
}

function innovations(pings: Ping[]): Innovation[] {
  const out: Innovation[] = [];
  for (let i = 1; i < pings.length; i++) {
    const p = pings[i - 1], c = pings[i];
    if (p.lat == null || p.lng == null || c.lat == null || c.lng == null) continue;
    const dt = (new Date(c.ts).getTime() - new Date(p.ts).getTime()) / 1000;
    if (!(dt > 0) || dt > CALIBRATION.max_gap_s) continue; // coast not defensible
    const spd = Number(p.speed ?? 0), hdg = Number(p.heading ?? 0);
    const [plat, plng] = Number.isFinite(spd) && spd > 0 && Number.isFinite(hdg)
      ? coast(p.lat, p.lng, hdg, spd, dt)
      : [p.lat, p.lng];
    const residual = haversineM([plat, plng], [c.lat, c.lng]);
    const sigma = Math.sqrt(CALIBRATION.sigma0_m ** 2 + (CALIBRATION.drift_rate_m_per_s * dt) ** 2);
    const q = residual / sigma;
    out.push({
      registration: c.registration || p.registration || "UNKNOWN",
      icao24: c.icao24, callsign: c.callsign,
      ts: c.ts, dt_s: Math.round(dt),
      residual_m: Math.round(residual * 10) / 10,
      sigma_m: Math.round(sigma * 10) / 10,
      q: Math.round(q * 100) / 100,
      T: CALIBRATION.k_FA,
      mdb_m: Math.round(CALIBRATION.mdb_multiplier * sigma),
      exceeds: q > CALIBRATION.k_FA,
      lat: c.lat, lng: c.lng, alt: c.alt == null ? null : Number(c.alt),
      vertical_rate: c.vrate == null ? null : Number(c.vrate),
      county: c.county,
    });
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const NEON = Deno.env.get("NEON_DATABASE_URL");
  if (!NEON) return json({ ok: false, error: "NEON_DATABASE_URL missing" }, 500);

  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "scan");

  const sql = postgres(NEON, {
    ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 15, prepare: false,
    connection: { statement_timeout: 20000 },
  });

  const doctrine = {
    observer: "GROUND-SIDE",
    statement:
      "Ground-side position-domain innovation monitor adapted from Kujur, Khanafseh & Pervan (2020/2022). "
      + "The test statistic is computed from broadcast ADS-B state against a coasted prediction of that same "
      + "broadcast state. It is not the aircraft's internal Kalman-filter innovation and does not depend on any "
      + "operator's avionics.",
    citation: "Kujur, Khanafseh, Pervan — Detecting GNSS spoofing of ADS-B equipped aircraft using INS (ION PLANS 2020; GNSS 2022 IDM-10)",
    calibration: CALIBRATION,
    known_gaps: [
      CALIBRATION.nacp_available
        ? null
        : "NACp is not captured per detection in the archive. The 'innovation out of bounds while NACp unchanged' "
          + "finding — the strongest form of this evidence — cannot be produced until NACp is ingested. NIC is "
          + "captured only sporadically.",
      "Broadcast cadence in this archive is irregular. Only consecutive pings separated by "
        + `${CALIBRATION.max_gap_s}s or less are scored; wider gaps are reported as coverage loss, not as clean.`,
      "ADS-B Out position modulation (the paper's countermeasure, AC 20-165 tolerances) cannot be applied to "
        + "third-party aircraft. Absence of a modulation signature means either a non-modulating aircraft or a "
        + "spoofer that stripped it — the two are not distinguished here.",
    ].filter(Boolean),
  };

  try {
    await sql.unsafe(`SET statement_timeout = '20s'`).catch(() => {});

    // ---------------------------------------------------------------- ENVELOPE
    // 60s (configurable) before/after an event for a single tail: the plot that
    // separates jamming (residuals return to baseline after re-acquisition)
    // from spoofing (residuals stay elevated / track drifts plausibly wrong).
    if (action === "envelope") {
      const tail = String(body.registration ?? "").toUpperCase().trim();
      const at = String(body.at ?? "");
      const win = Math.min(Math.max(Number(body.windowSeconds ?? 60), 15), 900);
      if (!tail || !at) { await sql.end(); return json({ ok: false, error: "registration and at are required" }, 400); }

      const rows: any[] = await sql`
        SELECT registration, icao24, callsign, detection_timestamp AS ts,
               latitude AS lat, longitude AS lng, altitude AS alt,
               speed, heading, vertical_rate AS vrate, county_derived AS county
        FROM live_flight_detections_rows
        WHERE upper(registration) = ${tail}
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND detection_timestamp BETWEEN (${at}::timestamptz - ${win + "s"}::interval)
                                      AND (${at}::timestamptz + ${win + "s"}::interval)
        ORDER BY detection_timestamp
      `.catch(() => []);

      const series = innovations(rows as Ping[]);
      const evT = new Date(at).getTime();
      const before = series.filter((s) => new Date(s.ts).getTime() < evT);
      const after = series.filter((s) => new Date(s.ts).getTime() >= evT);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      const qBefore = mean(before.map((s) => s.q));
      const qAfter = mean(after.map((s) => s.q));

      let verdict = "INCONCLUSIVE — not enough scored pings inside the envelope";
      let reason = "The broadcast cadence around this event is too sparse to coast a defensible prediction.";
      if (qBefore != null && qAfter != null) {
        if (qAfter <= CALIBRATION.k_FA && qBefore <= CALIBRATION.k_FA) {
          verdict = "NO INTEGRITY EVENT IN ENVELOPE";
          reason = "Innovation stayed inside the fault-free threshold on both sides of the event time.";
        } else if (qAfter <= CALIBRATION.k_FA) {
          verdict = "JAMMING / COASTING SIGNATURE";
          reason = "Innovation spiked and then returned to baseline once the aircraft re-acquired. "
            + "That is the coasting-error recovery pattern, not a sustained false fix.";
        } else if (qAfter > CALIBRATION.k_FA && (qBefore == null || qAfter >= qBefore)) {
          verdict = "SUSTAINED DEVIATION — SPOOFING FOLLOW-ON CONSISTENT";
          reason = "Innovation remained out of bounds after the event with no recovery. Under Kujur et al. this is "
            + "the jamming-then-spoofing sequence: covariance widens during the coast, the false fix is then "
            + "accepted inside the widened envelope.";
        }
      }

      await sql.end();
      return json({
        ok: true, doctrine, registration: tail, at, window_seconds: win,
        pings: rows.length, scored: series.length,
        series,
        q_mean_before: qBefore == null ? null : Math.round(qBefore * 100) / 100,
        q_mean_after: qAfter == null ? null : Math.round(qAfter * 100) / 100,
        verdict, reason,
        nacp_note: "NACp not present in archive — cannot test the 'integrity report unchanged while innovation spikes' divergence.",
      });
    }

    // ------------------------------------------------------------ WIDE-AREA
    // Is a multi-tail spike a regional RF event or a per-tail problem?
    if (action === "wide_area") {
      const at = String(body.at ?? "");
      const win = Math.min(Math.max(Number(body.windowSeconds ?? 60), 15), 1800);
      const baselineMin = Math.min(Math.max(Number(body.baselineMinutes ?? 10), 1), 60);
      if (!at) { await sql.end(); return json({ ok: false, error: "at is required" }, 400); }

      const rows: any[] = await sql`
        SELECT registration, icao24, callsign, detection_timestamp AS ts,
               latitude AS lat, longitude AS lng, altitude AS alt,
               speed, heading, vertical_rate AS vrate, county_derived AS county
        FROM live_flight_detections_rows
        WHERE registration IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND detection_timestamp BETWEEN (${at}::timestamptz - ${baselineMin + " minutes"}::interval)
                                      AND (${at}::timestamptz + ${win + "s"}::interval)
        ORDER BY registration, detection_timestamp
      `.catch(() => []);

      const byTail = new Map<string, Ping[]>();
      for (const r of rows as Ping[]) {
        const k = String(r.registration).toUpperCase();
        (byTail.get(k) ?? byTail.set(k, []).get(k)!).push(r);
      }
      const evT = new Date(at).getTime();
      const eventEnd = evT + win * 1000;
      const perTail: any[] = [];
      for (const [tail, ps] of byTail) {
        const s = innovations(ps);
        if (!s.length) continue;
        const ev = s.filter((x) => { const t = new Date(x.ts).getTime(); return t >= evT && t <= eventEnd; });
        const base = s.filter((x) => new Date(x.ts).getTime() < evT);
        if (!ev.length) continue;
        const qMax = Math.max(...ev.map((x) => x.q));
        const qBase = base.length ? base.reduce((a, b) => a + b.q, 0) / base.length : null;
        perTail.push({
          registration: tail, icao24: ev[0].icao24, callsign: ev[0].callsign,
          county: ev[0].county,
          q_max_event: Math.round(qMax * 100) / 100,
          q_mean_baseline: qBase == null ? null : Math.round(qBase * 100) / 100,
          exceeds: qMax > CALIBRATION.k_FA,
          scored_pings: s.length,
          residual_max_m: Math.round(Math.max(...ev.map((x) => x.residual_m))),
        });
      }
      perTail.sort((a, b) => b.q_max_event - a.q_max_event);
      const hits = perTail.filter((t) => t.exceeds);
      const qs = hits.map((t) => t.q_max_event);
      const spread = qs.length ? Math.max(...qs) / Math.max(Math.min(...qs), 0.01) : 0;
      const counties = new Map<string, number>();
      for (const h of hits) counties.set(h.county ?? "unknown", (counties.get(h.county ?? "unknown") ?? 0) + 1);
      const quietBaseline = hits.filter((h) => h.q_mean_baseline != null && h.q_mean_baseline <= CALIBRATION.k_FA).length;

      let classification = "NO WIDE-AREA EVENT";
      if (hits.length >= 5 && counties.size >= 3 && spread >= 3) {
        classification = "REGIONAL RF EVENT — per-airframe geometry and INS quality produced a wide q spread "
          + "across separated counties, which is what a regional jamming footprint looks like.";
      } else if (hits.length >= 5 && spread < 3) {
        classification = "TIGHT q CLUSTER — the spread is too narrow for independent airframes in independent "
          + "geometry. This points at a shared processing or feed-side artefact, not a regional RF event.";
      } else if (hits.length > 0) {
        classification = "LOCALISED / PER-TAIL EVENT";
      }

      await sql.end();
      return json({
        ok: true, doctrine, at, window_seconds: win, baseline_minutes: baselineMin,
        tails_scored: perTail.length, tails_exceeding: hits.length,
        q_spread_ratio: Math.round(spread * 100) / 100,
        counties: [...counties.entries()].map(([county, n]) => ({ county, n })).sort((a, b) => b.n - a.n),
        quiet_before_spike: quietBaseline,
        onset: quietBaseline >= Math.max(3, Math.floor(hits.length * 0.6))
          ? "SIMULTANEOUS ONSET — these tails were inside threshold in the pre-event baseline and broke together."
          : "TRENDING ONSET — several tails were already drifting before the event; this is a slower-moving deviation.",
        classification,
        distribution: hits.map((h) => ({ registration: h.registration, q: h.q_max_event, county: h.county })),
        per_tail: perTail.slice(0, 200),
      });
    }

    // -------------------------------------------------------------------- SCAN
    // Rolling scan over a recent window; returns only the integrity layer.
    const hours = Math.min(Math.max(Number(body.hours ?? 6), 1), 72);
    const limit = Math.min(Math.max(Number(body.limit ?? 20000), 1000), 60000);
    const rows: any[] = await sql`
      SELECT registration, icao24, callsign, detection_timestamp AS ts,
             latitude AS lat, longitude AS lng, altitude AS alt,
             speed, heading, vertical_rate AS vrate, county_derived AS county
      FROM live_flight_detections_rows
      WHERE registration IS NOT NULL
        AND latitude IS NOT NULL AND longitude IS NOT NULL
        AND detection_timestamp > NOW() - ${hours + " hours"}::interval
      ORDER BY registration, detection_timestamp
      LIMIT ${limit}
    `.catch(() => []);

    const byTail = new Map<string, Ping[]>();
    for (const r of rows as Ping[]) {
      const k = String(r.registration).toUpperCase();
      (byTail.get(k) ?? byTail.set(k, []).get(k)!).push(r);
    }
    let scoredPairs = 0;
    const flags: Innovation[] = [];
    for (const ps of byTail.values()) {
      const s = innovations(ps);
      scoredPairs += s.length;
      for (const x of s) if (x.exceeds) flags.push(x);
    }
    flags.sort((a, b) => b.q - a.q);
    const uniqueTails = new Set(flags.map((f) => f.registration));

    await sql.end();
    return json({
      ok: true, doctrine,
      window_hours: hours,
      pings_read: rows.length,
      tails_seen: byTail.size,
      scored_pairs: scoredPairs,
      coverage_note: rows.length
        ? `${scoredPairs} of ${Math.max(rows.length - byTail.size, 0)} consecutive ping pairs were inside the `
          + `${CALIBRATION.max_gap_s}s cadence limit and could be scored. The rest are coverage loss, not clean results.`
        : "No positions in window.",
      exceedances: flags.length,
      tails_flagged: uniqueTails.size,
      top: flags.slice(0, 100),
    });
  } catch (e) {
    try { await sql.end(); } catch { /* ignore */ }
    return json({ ok: false, doctrine, error: String(e) }, 200);
  }
});

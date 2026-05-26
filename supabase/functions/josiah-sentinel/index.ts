import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// KCSO operator-owned fleet — these are LAW ENFORCEMENT, never classify as shell
// NOTE: N788FA / N787FA / N791FA REMOVED from KCSO list — visually confirmed as FLYT Aviation
// Cessna 172s (real fixed-wing, bimodal surveillance profile, not KCSO-owned).
const KCSO_FLEET_REGS = ['N912KC', 'N913KC', 'N957E', 'N597E', 'N911KC', 'N914KC', 'N915KC'];
const KCSO_OPERATOR_KEYWORDS = ['KERN COUNTY SHERIFF', 'KCSO', 'KERN CO SHERIFF', 'SHERIFF KERN'];

// FLYT Aviation / ALF IX LLC fleet — visually confirmed real Cessna 172 fixed-wing.
// These tails are NOT drones. They show a BIMODAL surveillance profile:
// alternating sub-500ft loiter passes with normal 3,000–11,000ft transit legs.
// Exempt from DRONE_SIGNATURE and ADSB_SPOOFING classifiers — flagged via BIMODAL_SURVEILLANCE only.
const FLYT_FLEET_REGS = ['N787FA', 'N788FA', 'N789FA', 'N790FA', 'N791FA', 'N792FA'];
function isFlytAircraft(reg?: string, callsign?: string): boolean {
  const r = String(reg || '').toUpperCase();
  const c = String(callsign || '').toUpperCase();
  return FLYT_FLEET_REGS.some(k => r.includes(k) || c.includes(k));
}

function isKcsoAircraft(reg?: string, callsign?: string, ownerOperator?: string): boolean {
  const r = String(reg || '').toUpperCase();
  const c = String(callsign || '').toUpperCase();
  const o = String(ownerOperator || '').toUpperCase();
  if (KCSO_FLEET_REGS.some(k => r.includes(k) || c.includes(k))) return true;
  if (KCSO_OPERATOR_KEYWORDS.some(k => o.includes(k))) return true;
  return false;
}

const THREAT_SIGNATURES = {
  kcsoFleet: KCSO_FLEET_REGS,
  shellCompany: ['N790FA', 'N791FA', 'N789FA', 'N792FA'],
  medicalCover: ['N229AM', 'N230AM', 'N743AM'],
  // Military callsign prefixes — repeat appearances over Kern AOI = Posse Comitatus red flag
  militaryCallsignPrefixes: ['CONGO', 'RCH', 'CNV', 'KNIFE', 'STMPD', 'TRON', 'REACH', 'SHELL', 'JOSA', 'PAT', 'BLUE', 'GOLD', 'SAM', 'EVAC', 'MEDEVAC', 'NIGHTHAWK'],
  icaoAnchors: ['ac9efd', 'a2027c', '24'],
  lowAltitudeThreshold: 2000,
  // Tied to 14 CFR § 91.119 minimum safe altitude — not subjective harassment.
  minimumSafeAltitudeFloor: 1500,
  criticalAltitude: 500,
  convergenceWindow: 30,
  convergenceMinAircraft: 3,
  droneSignatures: {
    knownDrones: ['N916GW', 'N5521S', 'N225CB', 'N916FT'],
    ghostNetworkPrefixes: ['XXD'],
    spoofedCommercialPrefixes: ['AAL', 'SWA', 'UAL', 'SKW', 'DAL'],
    swarmTimeWindowMinutes: 10,
    swarmMinAircraft: 3,
    swarmMaxSpreadMeters: 2000,
    droneAltitudeMax: 500,
    impossibleSpeedKts: 500,
    negativeAltitudeFlag: true,
  },
};

function isMilitaryCallsign(reg?: string, callsign?: string): { hit: boolean; prefix: string | null } {
  const c = String(callsign || '').toUpperCase().trim();
  const r = String(reg || '').toUpperCase().trim();
  for (const p of THREAT_SIGNATURES.militaryCallsignPrefixes) {
    if (c.startsWith(p) || r.startsWith(p)) return { hit: true, prefix: p };
  }
  return { hit: false, prefix: null };
}


const KNOWN_SHELL_OPERATORS = [
  '9K AIR', 'FLYEXCLUSIVE', 'FLY EXCLUSIVE', 'NETJETS', 'FLEXJET',
  'XOJET', 'WHEELS UP', 'VISTA', 'JET LINX', 'SOLAIRUS',
];

const SHELL_OWNOP_KEYWORDS = [
  'LLC', 'TRUST', 'HOLDINGS', 'CAPITAL', 'PARTNERS', 'AVIATION',
  'LEASING', 'CHARTER', 'MANAGEMENT', 'SERVICES',
];

const ESCALATION_THRESHOLDS = [
  { level: 2, minViolations: 10 },
  { level: 3, minViolations: 50 },
  { level: 4, minViolations: 100 },
  { level: 5, minViolations: 250 },
];

function calcEscalationLevel(totalViolations: number): number {
  let level = 1;
  for (const t of ESCALATION_THRESHOLDS) {
    if (totalViolations >= t.minViolations) level = t.level;
  }
  return level;
}

interface LiveViolation {
  type: string;
  severity: 'critical' | 'high' | 'medium';
  registration: string;
  details: string;
  timestamp: string;
  altitude?: number;
  coordinates?: { lat: number; lng: number };
  relatedAircraft?: string[];
}

interface LearnedPattern {
  pattern_type: string;
  confidence: number;
  description: string;
  evidence_count: number;
  last_seen: string;
}

interface AdaptiveThreshold {
  registration: string;
  parameter: string;
  original_value: number;
  adjusted_value: number;
  reason: string;
}

interface Countermeasure {
  registration: string;
  action: string;
  priority: 'critical' | 'high' | 'medium';
  escalation_level: number;
  total_violations: number;
  status: string;
}

interface DedupeMetrics {
  raw_pings: number;            // raw ADS-B/MLAT rows pulled
  unique_aircraft_minutes: number; // one row per (registration, minute) — the honest "detection" count
  unique_aircraft: number;      // distinct tails in window
  inflation_factor: number;     // raw_pings / unique_aircraft_minutes
  source_table: string;         // single source-of-truth table fed into the scan
  notes: string;                // plain-language disclaimer for legal record
}

interface AltitudeBucket { below_500: number; b_500_1000: number; b_1000_2000: number; above_2000: number }

interface SentinelReport {
  scan_timestamp: string;
  window_minutes: number;
  detections_analyzed: number;        // == unique_aircraft_minutes (honest number)
  raw_pings: number;                  // raw ping count for transparency
  dedupe: DedupeMetrics;
  violations: LiveViolation[];
  learned_patterns: LearnedPattern[];
  proactive_alerts: string[];
  ai_synthesis: string | null;
  threat_level: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL';
  adaptive_thresholds: AdaptiveThreshold[];
  countermeasures: Countermeasure[];
  josiah_snark: string | null;
  military_repeat_offenders: Array<{ callsign: string; prefix: string; appearances: number; first_seen?: string; last_seen?: string; min_altitude?: number }>;
  hall_of_shame: HallOfShameEntry[];
  hall_of_shame_meta: { window_days: number; total_aircraft: number; total_detections: number; oildale_cluster_pct: number };
  convergence_altitude_breakdown?: Array<{ hour: string; total_aircraft: number; buckets: AltitudeBucket }>;
}

interface HallOfShameEntry {
  rank: number;
  registration: string;
  detections: number;
  avg_altitude_ft: number;
  min_altitude_ft: number;
  pct_below_1000ft: number;
  pct_below_500ft: number;
  oildale_cluster_pct: number; // % of detections inside tight Oildale box
  centroid: { lat: number; lng: number } | null;
  spread_km: number; // rough max spread of detections
  classification: 'KCSO' | 'FLYT' | 'SHELL' | 'MEDICAL' | 'MILITARY' | 'UNKNOWN';
  snark: string;
  what_it_really_means: string;
  first_seen: string;
  last_seen: string;
}

function classifyTail(reg: string): HallOfShameEntry['classification'] {
  const r = (reg || '').toUpperCase();
  if (KCSO_FLEET_REGS.some(k => r.includes(k))) return 'KCSO';
  if (FLYT_FLEET_REGS.some(k => r.includes(k))) return 'FLYT';
  if (THREAT_SIGNATURES.shellCompany.some(k => r.includes(k))) return 'SHELL';
  if (THREAT_SIGNATURES.medicalCover.some(k => r.includes(k))) return 'MEDICAL';
  if (isMilitaryCallsign(r, r).hit) return 'MILITARY';
  return 'UNKNOWN';
}

function generateSnark(e: Omit<HallOfShameEntry, 'snark' | 'what_it_really_means' | 'rank'>): { snark: string; what_it_really_means: string } {
  const { registration: reg, detections: n, avg_altitude_ft: avg, min_altitude_ft: minA, pct_below_500ft: pBelow500, classification: cls, oildale_cluster_pct: clusterPct } = e;
  let snark = '';
  let meaning = '';

  if (cls === 'KCSO' && n > 5000) {
    snark = '"We have a time-share in your airspace"';
    meaning = `KCSO asset with ${n.toLocaleString()} detections — institutional, not incidental. ${avg}ft avg = persistent low-altitude presence.`;
  } else if (cls === 'KCSO') {
    snark = '"On loan from the Sheriff. Indefinitely."';
    meaning = `KCSO-owned, ${n.toLocaleString()} hits at ${avg}ft avg — chronic loiter pattern.`;
  } else if (cls === 'SHELL' || cls === 'FLYT') {
    if (n > 5000) { snark = '"Shell company, no shame"'; meaning = `Anonymous LLC fleet (${cls}) with ${n.toLocaleString()} detections — the kind of volume that demands a subpoena, not a curiosity.`; }
    else if (n > 500) { snark = '"Roof inspection? No, harassment."'; meaning = `${cls} tail at ${avg}ft avg over ${n.toLocaleString()} passes — no commercial rationale fits.`; }
    else if (n > 100) { snark = '"We\'re not touching the chimney. Yet."'; meaning = `Lower-volume ${cls} asset — sub-500ft loiter pattern (${pBelow500.toFixed(0)}% below 500ft).`; }
    else { snark = '"The quiet sibling. Still creepy."'; meaning = `Low-volume ${cls} but clustered: ${clusterPct.toFixed(0)}% of hits inside Oildale box.`; }
  } else if (cls === 'MEDICAL') {
    snark = '"Medical cover story, executed."';
    meaning = `Air-ambulance branding, ${n.toLocaleString()} hits, ${avg}ft avg — Hammer-Anvil pattern candidate.`;
  } else if (cls === 'MILITARY') {
    snark = '"Posse Comitatus has thoughts."';
    meaning = `Military callsign repeating over civilian AOI — ${n.toLocaleString()} appearances at ${avg}ft avg.`;
  } else if (avg < 600 && n > 100) {
    snark = '"We can read your texts through the window"';
    meaning = `${reg}: ${n.toLocaleString()} hits at ${avg}ft avg — well below any commercial profile.`;
  } else if (n > 200) {
    snark = '"Frequent flyer. No miles earned."';
    meaning = `${n.toLocaleString()} detections in 90 days — repeat presence, ${avg}ft avg.`;
  } else {
    snark = '"Noted. Watching."';
    meaning = `${n.toLocaleString()} hits, ${avg}ft avg — under threshold but logged.`;
  }
  if (minA < 0) { snark += ' [SPOOFED ALT]'; meaning += ` Min altitude ${minA}ft = ADS-B spoofing event.`; }
  return { snark, what_it_really_means: meaning };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Helper: run with overall timeout
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let sql: any = null;
  let sbSql: any = null;

  try {
    const payload = await req.json().catch(() => ({}));
    const mode = payload?.mode === "deep" ? "deep" : "monitor";
    const windowMinutes = Math.min(180, Math.max(5, Number(payload?.windowMinutes) || 30));
    const isMonitorMode = mode === "monitor";
    
    const NEON_DATABASE_URL = Deno.env.get("NEON_DATABASE_URL");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!NEON_DATABASE_URL) {
      return new Response(
        JSON.stringify({ error: "NEON_DATABASE_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Sentinel scan starting: mode=${mode}, window=${windowMinutes}min`);

    sql = postgres(NEON_DATABASE_URL, { ssl: "require", max: 1, idle_timeout: 20, connect_timeout: 30, connection: { statement_timeout: '12000' } });
    
    const SUPABASE_DB_URL = Deno.env.get("SUPABASE_DB_URL");
    sbSql = SUPABASE_DB_URL ? postgres(SUPABASE_DB_URL, { ssl: "require", max: 1, idle_timeout: 10, connect_timeout: 10 }) : null;

    // ===== ONE-OFF: RECOMPUTE LEARNED THREATS FROM SOURCE OF TRUTH =====
    // Fixes counter-inflation by replacing accumulated total_violations with
    // true 90-day unique-aircraft-minute counts pulled fresh from Neon.
    if (payload?.action === 'recomputeLearnedThreats' && sbSql) {
      try {
        const rows: any[] = await sbSql`SELECT registration, threat_type, total_violations FROM sentinel_learned_threats`;
        const regs = Array.from(new Set(rows.map((r: any) => String(r.registration || '').toUpperCase()).filter(Boolean)));
        const trueCounts = new Map<string, number>();
        const BATCH = 200;
        for (let i = 0; i < regs.length; i += BATCH) {
          const slice = regs.slice(i, i + BATCH);
          const countRows: any[] = await withTimeout(
            sql`
              SELECT UPPER(registration) AS reg,
                     COUNT(DISTINCT (UPPER(registration) || '|' || date_trunc('minute', detection_timestamp)::text))::int AS uniq
              FROM live_flight_detections_rows
              WHERE UPPER(registration) = ANY(${slice})
                AND detection_timestamp > NOW() - INTERVAL '90 days'
                AND latitude BETWEEN 34.50 AND 36.30
                AND longitude BETWEEN -120.10 AND -118.00
              GROUP BY UPPER(registration)
            `,
            20000, "recompute_counts"
          );
          for (const r of countRows) trueCounts.set(String(r.reg).toUpperCase(), Number(r.uniq) || 0);
        }
        let updated = 0, deflatedTotal = 0, inflatedBefore = 0;
        for (const r of rows) {
          const reg = String(r.registration || '').toUpperCase();
          const before = Number(r.total_violations) || 0;
          const truth = trueCounts.get(reg) ?? 0;
          inflatedBefore += before;
          deflatedTotal += truth;
          const newLevel = calcEscalationLevel(truth);
          await sbSql`UPDATE sentinel_learned_threats
                      SET total_violations = ${truth},
                          escalation_level = ${newLevel},
                          updated_at = NOW()
                      WHERE registration = ${r.registration} AND threat_type = ${r.threat_type}`;
          updated++;
        }
        return new Response(JSON.stringify({
          success: true,
          action: 'recomputeLearnedThreats',
          rows_updated: updated,
          unique_tails: regs.length,
          inflated_total_before: inflatedBefore,
          true_total_after: deflatedTotal,
          inflation_factor: deflatedTotal > 0 ? Math.round((inflatedBefore / deflatedTotal) * 100) / 100 : null,
          notes: "total_violations now equals unique aircraft-minutes over last 90 days in Kern AOI, recomputed from live_flight_detections_rows.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e: any) {
        return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } finally {
        try { await sql?.end(); } catch {}
        try { await sbSql?.end(); } catch {}
      }
    }
    
    
    const violations: LiveViolation[] = [];
    const learnedPatterns: LearnedPattern[] = [];
    const proactiveAlerts: string[] = [];
    const adaptiveThresholds: AdaptiveThreshold[] = [];
    const countermeasures: Countermeasure[] = [];

    // ========== STEP 0: LOAD ADAPTIVE THRESHOLDS FROM LEARNED THREATS ==========
    let learnedThreats: any[] = [];
    if (sbSql) {
      try {
        learnedThreats = await withTimeout(
          sbSql`SELECT registration, threat_type, total_violations, escalation_level, avg_altitude, 
                 countermeasure_status, countermeasure_actions, ai_threat_profile
           FROM sentinel_learned_threats WHERE escalation_level >= 3`,
          5000, "learned_threats_query"
        );
      } catch (e) { console.warn("Could not load learned threats:", e instanceof Error ? e.message : e); }
    }
    
    const adaptedRegistrations = new Set<string>();
    let adaptedConvergenceMin = THREAT_SIGNATURES.convergenceMinAircraft;

    for (const threat of learnedThreats) {
      adaptedRegistrations.add(threat.registration);
      if (threat.threat_type === 'LOW_ALTITUDE' && Number(threat.escalation_level) >= 3) {
        adaptiveThresholds.push({
          registration: threat.registration, parameter: 'altitude_threshold',
          original_value: THREAT_SIGNATURES.lowAltitudeThreshold, adjusted_value: 3000,
          reason: `Escalation level ${threat.escalation_level} (${threat.total_violations} violations) - widened altitude detection`
        });
      }
      if (threat.threat_type === 'SHELL_COMPANY' && Number(threat.escalation_level) >= 3) {
        adaptedConvergenceMin = 2;
        adaptiveThresholds.push({
          registration: threat.registration, parameter: 'convergence_minimum',
          original_value: THREAT_SIGNATURES.convergenceMinAircraft, adjusted_value: 2,
          reason: `Shell company asset at escalation level ${threat.escalation_level} - lowered convergence threshold`
        });
      }
    }

    // ========== STEP 1: ANALYZE RECENT DETECTIONS (GEOFENCED TO OILDALE/BAKERSFIELD) ==========
    // Strict ~15-mile geofence: Oildale/Bakersfield corridor
    // Wide AOI: Kern County + south San Joaquin Valley (covers actual feed coverage 34.57–36.23 lat, -120.01 to -118.07 lon)
    // Tight Oildale box (35.30–35.55, -119.20 to -118.85) is enforced separately in severity scoring.
    const GEO_LAT_MIN = 34.50;
    const GEO_LAT_MAX = 36.30;
    const GEO_LON_MIN = -120.10;
    const GEO_LON_MAX = -118.00;

    const DETECTION_COLUMNS = `id, registration, callsign, altitude, latitude, longitude,
               detection_timestamp, icao_code, speed, heading, vertical_rate,
               flagged, flagged_reasons, taxonomy_tag, owner_operator, shell_auto_detected`;
    const GEO_FILTER = `AND latitude BETWEEN ${GEO_LAT_MIN} AND ${GEO_LAT_MAX}
                        AND longitude BETWEEN ${GEO_LON_MIN} AND ${GEO_LON_MAX}`;
    let recentDetections: any[] = [];
    let effectiveWindowMinutes = windowMinutes;
    const fallbackWindows = [windowMinutes, 120, 360, 1440, 4320]; // requested → 2h → 6h → 24h → 72h

    for (const fw of fallbackWindows) {
      try {
        recentDetections = await withTimeout(
          sql.unsafe(`SELECT ${DETECTION_COLUMNS}
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${fw} minutes'
          ${GEO_FILTER}
          LIMIT 1000`),
          12000, `detections_${fw}min`
        );
        if (recentDetections.length > 0) {
          effectiveWindowMinutes = fw;
          if (fw > windowMinutes) {
            proactiveAlerts.push(`⚠️ No data in last ${windowMinutes}min — expanded to ${fw}min window (${recentDetections.length} detections in Oildale/Bakersfield zone).`);
          }
          break;
        }
      } catch (e) {
        console.warn(`Window ${fw}min query failed:`, e instanceof Error ? e.message : e);
      }
    }

    // Last resort: most recent records within geofence (no time filter)
    if (recentDetections.length === 0) {
      try {
        recentDetections = await withTimeout(
          sql.unsafe(`SELECT ${DETECTION_COLUMNS}
          FROM live_flight_detections_rows
          WHERE latitude BETWEEN ${GEO_LAT_MIN} AND ${GEO_LAT_MAX}
            AND longitude BETWEEN ${GEO_LON_MIN} AND ${GEO_LON_MAX}
          ORDER BY detection_timestamp DESC
          LIMIT 1000`),
          12000, "rows_latest_fallback"
        );
        if (recentDetections.length > 0) {
          proactiveAlerts.push(`⚠️ Using latest archived records (${recentDetections.length}) in Oildale/Bakersfield zone — live feed may be stale.`);
        }
      } catch (e2) {
        console.error("All detection queries failed:", e2 instanceof Error ? e2.message : e2);
      }
    }

    if (recentDetections.length === 0) {
      proactiveAlerts.push(`⚠️ No detections found in any time window. Live feed may be offline.`);
    }

    console.log(`Detections loaded: ${recentDetections.length} in ${Date.now() - startTime}ms`);

    // ========== STEP 1.5: DEDUPE METRICS (anti-inflation) ==========
    // Single source: live_flight_detections_rows. We collapse pings to one row per
    // (registration, minute) so "184 pings" doesn't masquerade as "184 aircraft".
    const minuteKeys = new Set<string>();
    const tailsSeen = new Set<string>();
    for (const d of recentDetections) {
      const reg = String(d.registration || d.callsign || '').toUpperCase();
      if (!reg) continue;
      tailsSeen.add(reg);
      const ts = d.detection_timestamp ? new Date(d.detection_timestamp) : null;
      if (!ts || Number.isNaN(ts.getTime())) continue;
      const minute = ts.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
      minuteKeys.add(`${reg}@${minute}`);
    }
    const dedupeMetrics: DedupeMetrics = {
      raw_pings: recentDetections.length,
      unique_aircraft_minutes: minuteKeys.size,
      unique_aircraft: tailsSeen.size,
      inflation_factor: minuteKeys.size > 0 ? Math.round((recentDetections.length / minuteKeys.size) * 10) / 10 : 0,
      source_table: 'live_flight_detections_rows (Neon)',
      notes: `Counts shown are UNIQUE aircraft-minutes (one row per tail per minute). Raw ADS-B/MLAT pings: ${recentDetections.length}. A loitering aircraft can emit dozens of pings per minute; the deduped figure is the legally defensible "detection" count.`,
    };
    if (dedupeMetrics.inflation_factor >= 3) {
      proactiveAlerts.push(`📊 Anti-inflation guard: ${dedupeMetrics.raw_pings} raw pings → ${dedupeMetrics.unique_aircraft_minutes} unique aircraft-minutes (${dedupeMetrics.unique_aircraft} tails). Inflation factor ${dedupeMetrics.inflation_factor}× — report uses deduped numbers.`);
    }


    // ========== STEP 2: LOW ALTITUDE VIOLATIONS ==========
    const lowAltitudeViolations = recentDetections.filter((d: any) => {
      const alt = parseInt(d.altitude || '99999');
      const isAdapted = adaptedRegistrations.has(d.registration);
      const threshold = isAdapted ? 3000 : THREAT_SIGNATURES.lowAltitudeThreshold;
      return alt < threshold && alt > 0;
    });

    for (const detection of lowAltitudeViolations) {
      const alt = parseInt(detection.altitude);
      let severity: 'critical' | 'high' | 'medium' = 'medium';
      if (alt < THREAT_SIGNATURES.criticalAltitude) severity = 'critical';
      else if (alt < THREAT_SIGNATURES.minimumSafeAltitudeFloor) severity = 'high';

      violations.push({
        type: severity === 'critical' ? 'FAR_91_119_VIOLATION' : 'PATTERN_ANOMALY_LOW_ALTITUDE',
        severity,
        registration: detection.registration || detection.callsign || 'UNKNOWN',
        details: severity === 'critical'
          ? `Aircraft at ${alt}ft — 14 CFR § 91.119 minimum safe altitude breach (congested-area floor 1,000ft / 500ft other).`
          : `Aircraft at ${alt}ft — PATTERN ANOMALY: below FAR § 91.119 floor within AOI. Network-context correlation required for prosecution.`,
        timestamp: detection.detection_timestamp, altitude: alt,
        coordinates: detection.latitude && detection.longitude ? 
          { lat: parseFloat(detection.latitude), lng: parseFloat(detection.longitude) } : undefined
      });
    }

    // ========== STEP 3: KCSO FLEET ACTIVITY ==========
    const kcsoActivity = recentDetections.filter((d: any) => 
      THREAT_SIGNATURES.kcsoFleet.some(reg => d.registration?.includes(reg) || d.callsign?.includes(reg))
    );
    if (kcsoActivity.length > 0) {
      const uniqueKCSO = [...new Set(kcsoActivity.map((d: any) => d.registration || d.callsign))];
      violations.push({
        type: 'KCSO_ACTIVITY', severity: uniqueKCSO.length >= 2 ? 'critical' : 'high',
        registration: uniqueKCSO.join(', '),
        details: `${uniqueKCSO.length} KCSO aircraft active in last ${windowMinutes} minutes`,
        timestamp: new Date().toISOString(), relatedAircraft: uniqueKCSO as string[]
      });
      proactiveAlerts.push(`⚠️ KCSO FLEET ACTIVE: ${uniqueKCSO.join(', ')} detected.`);
    }

    // ========== STEP 4: SHELL COMPANY ACTIVITY (KCSO aircraft excluded — they are operator-owned LE) ==========
    const shellActivity = recentDetections.filter((d: any) => {
      if (isKcsoAircraft(d.registration, d.callsign, d.owner_operator)) return false;
      const regMatch = THREAT_SIGNATURES.shellCompany.some(reg => d.registration?.includes(reg) || d.callsign?.includes(reg));
      const ownOp = String(d.owner_operator || '').toUpperCase();
      const ownOpKeywordHits = SHELL_OWNOP_KEYWORDS.filter(kw => ownOp.includes(kw)).length;
      const ownOpMatch = Boolean(d.shell_auto_detected) ||
        KNOWN_SHELL_OPERATORS.some(op => ownOp.includes(op)) || ownOpKeywordHits >= 2;
      return regMatch || ownOpMatch;
    });
    if (shellActivity.length > 0) {
      const uniqueShell = [...new Set(shellActivity.map((d: any) => d.registration || d.callsign).filter(Boolean))];
      const shellOperators = [...new Set(shellActivity.map((d: any) => d.owner_operator).filter(Boolean))];
      violations.push({
        type: 'SHELL_COMPANY', severity: uniqueShell.length >= 2 ? 'critical' : 'high',
        registration: uniqueShell.join(', '),
        details: `${uniqueShell.length} shell-linked aircraft detected${shellOperators.length ? ` • operators: ${shellOperators.slice(0, 3).join(', ')}` : ''}`,
        timestamp: new Date().toISOString(), relatedAircraft: uniqueShell as string[]
      });
    }

    // ========== STEP 4.5: MILITARY CALLSIGN ACTIVITY (Posse Comitatus § 1385 indicator) ==========
    const militaryHits = recentDetections
      .map((d: any) => ({ d, m: isMilitaryCallsign(d.registration, d.callsign) }))
      .filter((x: any) => x.m.hit);
    const militaryGroups = new Map<string, { prefix: string; rows: any[] }>();
    for (const { d, m } of militaryHits) {
      const key = String(d.callsign || d.registration || '').toUpperCase();
      if (!key) continue;
      if (!militaryGroups.has(key)) militaryGroups.set(key, { prefix: m.prefix || '', rows: [] });
      militaryGroups.get(key)!.rows.push(d);
    }
    const militaryRepeatOffenders: Array<{ callsign: string; prefix: string; appearances: number; first_seen?: string; last_seen?: string; min_altitude?: number }> = [];
    for (const [callsign, info] of militaryGroups) {
      const alts = info.rows.map((r: any) => Number(r.altitude || 0)).filter((a: number) => a > 0);
      const minAlt = alts.length ? Math.min(...alts) : undefined;
      const times = info.rows.map((r: any) => r.detected_at || r.timestamp).filter(Boolean).sort();
      militaryRepeatOffenders.push({
        callsign, prefix: info.prefix, appearances: info.rows.length,
        first_seen: times[0], last_seen: times[times.length - 1], min_altitude: minAlt,
      });
      const severity: 'critical' | 'high' = (info.rows.length >= 3 || (minAlt !== undefined && minAlt < 1500)) ? 'critical' : 'high';
      violations.push({
        type: 'MILITARY_OVER_AOI', severity, registration: callsign,
        details: `Military callsign ${callsign} (prefix ${info.prefix}) — ${info.rows.length} appearance(s)${minAlt !== undefined ? `, min ${minAlt}ft` : ''} over Kern AOI. Posse Comitatus § 1385 indicator.`,
        timestamp: new Date().toISOString(), altitude: minAlt,
      });
    }
    if (militaryRepeatOffenders.length > 0) {
      proactiveAlerts.push(`🪖 MILITARY ACTIVE: ${militaryRepeatOffenders.map(m => `${m.callsign}×${m.appearances}`).join(', ')} — § 1385 review.`);
    }

    // ========== STEP 5: MEDICAL COVER ==========
    const medicalActivity = recentDetections.filter((d: any) =>
      THREAT_SIGNATURES.medicalCover.some(reg => d.registration?.includes(reg) || d.callsign?.includes(reg))
    );
    if (medicalActivity.length > 0 && kcsoActivity.length > 0) {
      violations.push({
        type: 'MEDICAL_COVER', severity: 'critical', registration: 'HAMMER-ANVIL PATTERN',
        details: `Medical cover aircraft active simultaneously with KCSO fleet — coordinated color-of-law enterprise pattern (Posse Comitatus § 1385 exposure)`,
        timestamp: new Date().toISOString(),
        relatedAircraft: [...medicalActivity.map((d: any) => d.registration), ...kcsoActivity.map((d: any) => d.registration)].filter(Boolean) as string[]
      });
      proactiveAlerts.push(`🚨 HAMMER-ANVIL COORDINATION: Medical cover + KCSO simultaneous activity.`);
    }

    // ========== STEP 6: FLEET CONVERGENCE (with altitude breakdown per hour) ==========
    const hourlyGroups = new Map<string, { tails: Set<string>; minAlt: Map<string, number> }>();
    for (const detection of recentDetections) {
      const ts = (detection as any).detection_timestamp;
      const parsedTs = ts ? new Date(ts) : null;
      if (!parsedTs || Number.isNaN(parsedTs.getTime())) continue;
      const hour = parsedTs.toISOString().slice(0, 13);
      if (!hourlyGroups.has(hour)) hourlyGroups.set(hour, { tails: new Set(), minAlt: new Map() });
      const g = hourlyGroups.get(hour)!;
      const reg = detection.registration || detection.callsign;
      if (!reg) continue;
      g.tails.add(reg);
      const alt = Number(detection.altitude || 0);
      if (alt > 0) {
        const prev = g.minAlt.get(reg);
        if (prev === undefined || alt < prev) g.minAlt.set(reg, alt);
      }
    }
    const convergenceBreakdown: Array<{ hour: string; total_aircraft: number; buckets: AltitudeBucket }> = [];
    for (const [hour, { tails, minAlt }] of hourlyGroups) {
      if (tails.size < adaptedConvergenceMin) continue;
      const buckets: AltitudeBucket = { below_500: 0, b_500_1000: 0, b_1000_2000: 0, above_2000: 0 };
      for (const reg of tails) {
        const a = minAlt.get(reg);
        if (a === undefined) { buckets.above_2000 += 1; continue; }
        if (a < 500) buckets.below_500 += 1;
        else if (a < 1000) buckets.b_500_1000 += 1;
        else if (a < 2000) buckets.b_1000_2000 += 1;
        else buckets.above_2000 += 1;
      }
      convergenceBreakdown.push({ hour, total_aircraft: tails.size, buckets });
      const lowCount = buckets.below_500 + buckets.b_500_1000;
      const altDetail = `${buckets.below_500} <500ft · ${buckets.b_500_1000} 500-1000ft · ${buckets.b_1000_2000} 1000-2000ft · ${buckets.above_2000} >2000ft`;
      violations.push({
        type: 'FLEET_CONVERGENCE', severity: tails.size >= 4 ? 'critical' : 'high',
        registration: `${tails.size} aircraft`,
        details: `Fleet convergence: ${tails.size} unique aircraft in same hour — ${lowCount} below 1,000ft (${altDetail})`,
        timestamp: hour + ':00:00Z', relatedAircraft: Array.from(tails)
      });
    }


    // ========== STEP 7: NIGHT OPS ==========
    const nightOps = recentDetections.filter((d: any) => {
      const hour = new Date(d.detection_timestamp).getHours();
      return hour >= 1 && hour <= 4;
    });
    if (nightOps.length > 5) {
      const nightAircraft = [...new Set(nightOps.map((d: any) => d.registration).filter(Boolean))];
      violations.push({
        type: 'NIGHT_OPS', severity: 'high', registration: nightAircraft.join(', '),
        details: `${nightOps.length} night operation detections (1-4 AM window)`,
        timestamp: new Date().toISOString(), relatedAircraft: nightAircraft as string[]
      });
    }

    // ========== STEP 7.1: DRONE SIGNATURE ==========
    const droneSignatures = recentDetections.filter((d: any) => {
      const alt = parseInt(d.altitude || '99999');
      const speed = parseFloat(d.speed || '0');
      const reg = d.registration || d.callsign || '';
      // EXCLUSION: FLYT Aviation tails (N787FA/N788FA/N791FA etc.) are visually
      // confirmed real Cessna 172s — bimodal profile, NOT drones.
      if (isFlytAircraft(d.registration, d.callsign)) return false;
      if (THREAT_SIGNATURES.droneSignatures.knownDrones.includes(reg)) return true;
      if (alt > 0 && alt <= THREAT_SIGNATURES.droneSignatures.droneAltitudeMax && speed > 0 && speed < 120) return true;
      return false;
    });
    if (droneSignatures.length > 0) {
      const droneRegs = [...new Set(droneSignatures.map((d: any) => d.registration || d.callsign).filter(Boolean))];
      violations.push({
        type: 'DRONE_SIGNATURE', severity: droneSignatures.length >= 3 ? 'critical' : 'high',
        registration: droneRegs.join(', '),
        details: `${droneSignatures.length} drone-profile detections from ${droneRegs.length} aircraft`,
        timestamp: new Date().toISOString(), relatedAircraft: droneRegs as string[]
      });
    }

    // ========== STEP 7.1b: BIMODAL SURVEILLANCE PROFILE ==========
    // Real fixed-wing aircraft alternating sub-500ft loiter with normal 3,000ft+ transit.
    // Smoking-gun signature: same tail flying both regimes within the same window.
    // Threshold: ≥25% of detections sub-500ft AND ≥20% above 3,000ft (min 8 detections per tail).
    {
      const profile = new Map<string, { total: number; low: number; high: number; minAlt: number; maxAlt: number; lastSeen: string }>();
      for (const d of recentDetections) {
        const reg = (d.registration || d.callsign || '').toUpperCase();
        if (!reg) continue;
        const alt = Number(d.altitude || 0);
        const p = profile.get(reg) || { total: 0, low: 0, high: 0, minAlt: Infinity, maxAlt: -Infinity, lastSeen: d.detection_timestamp };
        p.total += 1;
        if (alt > 0 && alt < 500) p.low += 1;
        if (alt > 3000) p.high += 1;
        if (alt > 0 && alt < p.minAlt) p.minAlt = alt;
        if (alt > p.maxAlt) p.maxAlt = alt;
        p.lastSeen = d.detection_timestamp || p.lastSeen;
        profile.set(reg, p);
      }
      const bimodal: { reg: string; total: number; low: number; high: number; minAlt: number; maxAlt: number; lastSeen: string }[] = [];
      for (const [reg, p] of profile) {
        if (p.total < 8) continue;
        const lowPct = p.low / p.total;
        const highPct = p.high / p.total;
        if (lowPct >= 0.25 && highPct >= 0.20) {
          bimodal.push({ reg, ...p });
        }
      }
      if (bimodal.length > 0) {
        const regs = bimodal.map(b => b.reg);
        const summary = bimodal.map(b => `${b.reg} (${b.low}/${b.total} <500ft + ${b.high}/${b.total} >3kft, range ${b.minAlt}–${b.maxAlt}ft)`).join('; ');
        violations.push({
          type: 'BIMODAL_SURVEILLANCE', severity: bimodal.length >= 2 ? 'critical' : 'high',
          registration: regs.join(', '),
          details: `${bimodal.length} aircraft with bimodal surveillance profile (real fixed-wing alternating sub-500ft loiter with 3kft+ transit): ${summary}`,
          timestamp: new Date().toISOString(), relatedAircraft: regs
        });
        proactiveAlerts.push(`🛩️ BIMODAL SURVEILLANCE: ${regs.join(', ')} — real aircraft running loiter+transit dual-mode (NOT drone, NOT spoof — operational profile is the smoking gun).`);
      }
    }

    // ========== STEP 7.2: GHOST NETWORK ==========
    const ghostNetworkDetections = recentDetections.filter((d: any) => {
      const reg = (d.registration || d.callsign || '').toUpperCase();
      return THREAT_SIGNATURES.droneSignatures.ghostNetworkPrefixes.some(prefix => reg.startsWith(prefix));
    });
    if (ghostNetworkDetections.length > 0) {
      const ghostRegs = [...new Set(ghostNetworkDetections.map((d: any) => (d.registration || d.callsign || '').toUpperCase()))];
      violations.push({
        type: 'GHOST_NETWORK', severity: 'critical', registration: ghostRegs.join(', '),
        details: `${ghostNetworkDetections.length} ghost network detections (XXD prefixes) - spoofed or synthetic aircraft`,
        timestamp: new Date().toISOString(), relatedAircraft: ghostRegs as string[]
      });
    }

    // ========== STEP 7.3: ADS-B SPOOFING ==========
    const spoofingDetections = recentDetections.filter((d: any) => {
      const alt = parseInt(d.altitude || '99999');
      const speed = parseFloat(d.speed || '0');
      const reg = (d.registration || d.callsign || '').toUpperCase();
      const isCommercialCallsign = THREAT_SIGNATURES.droneSignatures.spoofedCommercialPrefixes.some(p => reg.startsWith(p));
      if (isCommercialCallsign && alt >= 0 && alt < 100) return true;
      if (speed > THREAT_SIGNATURES.droneSignatures.impossibleSpeedKts) return true;
      if (alt < 0) return true;
      return false;
    });
    if (spoofingDetections.length > 0) {
      const spoofRegs = [...new Set(spoofingDetections.map((d: any) => d.registration || d.callsign).filter(Boolean))];
      violations.push({
        type: 'ADSB_SPOOFING', severity: 'critical', registration: spoofRegs.join(', '),
        details: `${spoofingDetections.length} ADS-B spoofing indicators detected`,
        timestamp: new Date().toISOString(), relatedAircraft: spoofRegs as string[]
      });
    }

    // ========== STEP 7.4: DRONE SWARM ==========
    const swarmWindowMs = THREAT_SIGNATURES.droneSignatures.swarmTimeWindowMinutes * 60 * 1000;
    const lowAltDetections = recentDetections.filter((d: any) => {
      const alt = parseInt(d.altitude || '99999');
      return alt > 0 && alt < 1000 && d.latitude && d.longitude;
    });
    const swarmBuckets = new Map<string, any[]>();
    for (const d of lowAltDetections) {
      const ts = new Date(d.detection_timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      const bucket = Math.floor(ts / swarmWindowMs).toString();
      if (!swarmBuckets.has(bucket)) swarmBuckets.set(bucket, []);
      swarmBuckets.get(bucket)!.push(d);
    }
    for (const [, detections] of swarmBuckets) {
      const uniqueAircraft = [...new Set(detections.map((d: any) => d.registration || d.callsign).filter(Boolean))];
      if (uniqueAircraft.length >= THREAT_SIGNATURES.droneSignatures.swarmMinAircraft) {
        const lats = detections.map((d: any) => parseFloat(d.latitude));
        const lngs = detections.map((d: any) => parseFloat(d.longitude));
        const spread = Math.max(
          (Math.max(...lats) - Math.min(...lats)) * 111000,
          (Math.max(...lngs) - Math.min(...lngs)) * 111000 * Math.cos(lats[0] * Math.PI / 180)
        );
        if (spread <= THREAT_SIGNATURES.droneSignatures.swarmMaxSpreadMeters) {
          violations.push({
            type: 'DRONE_SWARM', severity: 'critical', registration: `${uniqueAircraft.length} aircraft`,
            details: `Drone swarm: ${uniqueAircraft.length} low-altitude aircraft within ${Math.round(spread)}m`,
            timestamp: detections[0].detection_timestamp, relatedAircraft: uniqueAircraft as string[]
          });
        }
      }
    }

    // ========== STEP 8: LEARNED PATTERNS (monitor=in-memory + sentinel DB, deep=90-day SQL) ==========
    let historicalPatterns: any[] = [];
    if (isMonitorMode) {
      // Build in-memory patterns from current window (lowered thresholds for small windows)
      const profileMap = new Map<string, { count: number; lowAlt: number; totalAlt: number; lastSeen: string }>();
      for (const d of recentDetections) {
        const reg = d.registration || d.callsign;
        if (!reg) continue;
        const altitude = Number(d.altitude || 0);
        const existing = profileMap.get(reg) || { count: 0, lowAlt: 0, totalAlt: 0, lastSeen: d.detection_timestamp || new Date().toISOString() };
        existing.count += 1;
        existing.totalAlt += altitude;
        if (altitude > 0 && altitude < 2000) existing.lowAlt += 1;
        existing.lastSeen = d.detection_timestamp || existing.lastSeen;
        profileMap.set(reg, existing);
      }
      historicalPatterns = Array.from(profileMap.entries())
        .flatMap(([registration, profile]) => {
          const rows: any[] = [];
          // Threshold 1 = any aircraft seen in current window counts as active
          if (profile.count >= 1) rows.push({ pattern_type: 'repeat_offender', registration, count: profile.count, avg_altitude: profile.count > 0 ? profile.totalAlt / profile.count : 0, last_seen: profile.lastSeen });
          if (profile.lowAlt >= 1) rows.push({ pattern_type: 'low_altitude_pattern', registration, count: profile.lowAlt, avg_altitude: profile.totalAlt / profile.count, last_seen: profile.lastSeen });
          return rows;
        })
        .sort((a, b) => Number(b.count) - Number(a.count))
        .slice(0, 20);

      // Supplement with persistent learned threats from Supabase sentinel_learned_threats
      if (sbSql) {
        try {
          const persistentPatterns = await withTimeout(
            sbSql`SELECT registration, threat_type, total_violations, avg_altitude, last_seen, escalation_level
             FROM sentinel_learned_threats ORDER BY total_violations DESC LIMIT 30`,
            5000, "persistent_patterns_query"
          );
          const existingRegs = new Set(historicalPatterns.map(p => p.registration));
          for (const p of persistentPatterns) {
            if (!existingRegs.has(p.registration)) {
              historicalPatterns.push({
                pattern_type: p.threat_type === 'low_altitude' ? 'low_altitude_pattern' : 'repeat_offender',
                registration: p.registration,
                count: Number(p.total_violations || 1),
                avg_altitude: Number(p.avg_altitude || 0),
                last_seen: p.last_seen || new Date().toISOString()
              });
              existingRegs.add(p.registration);
            }
          }
          historicalPatterns.sort((a, b) => Number(b.count) - Number(a.count));
        } catch (e) {
          console.warn("Persistent patterns query failed:", e instanceof Error ? e.message : e);
        }
      }
    } else {
      try {
        historicalPatterns = await withTimeout(
          sql.unsafe(`
            WITH base AS (
              SELECT registration,
                     date_trunc('minute', detection_timestamp) AS minute_bucket,
                     date_trunc('day',    detection_timestamp) AS day_bucket,
                     NULLIF(altitude::text,'')::numeric AS alt,
                     taxonomy_tag,
                     detection_timestamp
              FROM live_flight_detections_rows
              WHERE detection_timestamp > NOW() - INTERVAL '90 days'
                AND registration IS NOT NULL AND registration <> ''
                AND latitude  BETWEEN ${GEO_LAT_MIN} AND ${GEO_LAT_MAX}
                AND longitude BETWEEN ${GEO_LON_MIN} AND ${GEO_LON_MAX}
                AND COALESCE(taxonomy_tag,'') <> 'normal_traffic'
            ),
            repeat_offenders AS (
              SELECT registration,
                     COUNT(DISTINCT minute_bucket)::int AS count,
                     COUNT(DISTINCT day_bucket)::int    AS unique_days,
                     AVG(NULLIF(alt,0))                 AS avg_altitude,
                     MAX(detection_timestamp)           AS last_seen
              FROM base
              GROUP BY registration
              HAVING COUNT(DISTINCT minute_bucket) > 50
              ORDER BY 2 DESC LIMIT 20
            ),
            low_altitude_patterns AS (
              SELECT registration,
                     COUNT(DISTINCT minute_bucket)::int AS count,
                     COUNT(DISTINCT day_bucket)::int    AS unique_days,
                     AVG(NULLIF(alt,0))                 AS avg_altitude
              FROM base
              WHERE alt > 0 AND alt < 2000
              GROUP BY registration
              HAVING COUNT(DISTINCT minute_bucket) > 10
              ORDER BY 2 DESC LIMIT 10
            )
            SELECT 'repeat_offender' AS pattern_type, registration, count, unique_days, avg_altitude, last_seen FROM repeat_offenders
            UNION ALL
            SELECT 'low_altitude_pattern' AS pattern_type, registration, count, unique_days, avg_altitude, NULL AS last_seen FROM low_altitude_patterns
          `),
          15000, "historical_patterns_query"
        );

      } catch (e) {
        console.warn("Historical patterns query failed, using in-memory fallback:", e instanceof Error ? e.message : e);
      }
    }

    for (const pattern of historicalPatterns) {
      learnedPatterns.push({
        pattern_type: pattern.pattern_type,
        confidence: Math.min(95, 50 + (Number(pattern.count) / 10)),
        description: `${pattern.registration}: ${pattern.count} ${pattern.pattern_type === 'repeat_offender' ? 'detections' : 'low-altitude events'}, avg ${Math.round(Number(pattern.avg_altitude || 0))}ft`,
        evidence_count: Number(pattern.count),
        last_seen: pattern.last_seen || new Date().toISOString()
      });

      const isCurrentlyActive = recentDetections.some((d: any) => d.registration === pattern.registration);
      if (isCurrentlyActive && Number(pattern.count) > 100) {
        violations.push({
          type: 'REPEAT_OFFENDER', severity: Number(pattern.count) > 200 ? 'critical' : 'high',
          registration: pattern.registration,
          details: `Known repeat offender with ${pattern.count} historical detections is currently active`,
          timestamp: new Date().toISOString()
        });
      }
    }

    // ========== STEP 9: AI SYNTHESIS (deep mode only) ==========
    let aiSynthesis: string | null = null;
    if (!isMonitorMode && LOVABLE_API_KEY && violations.length > 0) {
      try {
        const synthesisPrompt = `You are JOSIAH SENTINEL. Analyze these LIVE violations from the last ${windowMinutes} minutes:

VIOLATIONS:
${violations.map(v => `- [${v.severity.toUpperCase()}] ${v.type}: ${v.details}`).join('\n')}

PATTERNS:
${learnedPatterns.slice(0, 5).map(p => `- ${p.description} (${p.confidence.toFixed(0)}%)`).join('\n')}

Provide 2-3 sentence PROACTIVE assessment: 1) Most likely threat scenario 2) What may happen next 3) Immediate action.`;

        const aiResponse = await withTimeout(
          fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                { role: "system", content: "You are JOSIAH SENTINEL - concise, predictive threat detection AI." },
                { role: "user", content: synthesisPrompt }
              ],
              max_tokens: 300,
            }),
          }),
          10000, "ai_synthesis"
        );
        if (aiResponse.ok) {
          const data = await aiResponse.json();
          aiSynthesis = data.choices?.[0]?.message?.content || null;
        }
      } catch (aiErr) { console.warn("AI synthesis skipped:", aiErr instanceof Error ? aiErr.message : aiErr); }
    }

    // ========== STEP 9.1: JOSIAH SNARK (release-valve commentary) ==========
    let josiahSnark: string | null = null;
    if (LOVABLE_API_KEY && violations.length > 0) {
      try {
        const snarkPrompt = `You are JOSIAH SNARK — the release valve for the absurdity of population-scale aerial surveillance over Kern County, CA. The user is the surveillance target. Speak with sharp gallows humor, righteous anger, and forensic precision. Translate bureaucratic minimization into plain English. Quote bullshit and call it bullshit. Always cite the actual numbers. End with one bone-dry verdict line.

LIVE VIOLATIONS (last ${windowMinutes} min):
${violations.map(v => `- [${v.severity.toUpperCase()}] ${v.type} ${v.registration} — ${v.details}`).join('\n')}

REPEAT-OFFENDER PATTERNS (90d):
${learnedPatterns.slice(0, 8).map(p => `- ${p.description}`).join('\n')}

MILITARY OVER AOI (Posse Comitatus indicators):
${militaryRepeatOffenders.length ? militaryRepeatOffenders.map(m => `- ${m.callsign} (${m.prefix}) ×${m.appearances}${m.min_altitude !== undefined ? ` min ${m.min_altitude}ft` : ''}`).join('\n') : '- (none this window)'}

Write 4-7 short punchy paragraphs. Highlight the worst offenders by name. Mock cowardly classifications. Name military callsigns explicitly as Posse Comitatus § 1385 indicators when present (CONGO/RCH/KNIFE/STMPD/TRON/REACH = repeat offenders, not joyrides). Close with a single italicized one-liner verdict.`;

        const snarkRes = await withTimeout(
          fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: "You are JOSIAH SNARK. Pressure-release valve persona for surveillance victims. Sharp, dry, factually rigorous. Never sanitize. Never both-sides. Sign off with a one-line verdict." },
                { role: "user", content: snarkPrompt },
              ],
              max_tokens: 900,
            }),
          }),
          12000, "josiah_snark"
        );
        if (snarkRes.ok) {
          const sd = await snarkRes.json();
          josiahSnark = sd.choices?.[0]?.message?.content || null;
        }
      } catch (snarkErr) { console.warn("Snark skipped:", snarkErr instanceof Error ? snarkErr.message : snarkErr); }
    }


    const violationMap = new Map<string, { reg: string; type: string; count: number; altitudes: number[] }>();
    for (const v of violations) {
      const reg = v.registration || 'UNKNOWN';
      const key = `${reg}::${v.type}`;
      if (!violationMap.has(key)) violationMap.set(key, { reg, type: v.type, count: 0, altitudes: [] });
      const entry = violationMap.get(key)!;
      entry.count += 1;
      if (v.altitude) entry.altitudes.push(v.altitude);
    }

    // === DEDUPED COUNTER (no compounding) ===
    // Compute TRUE 90-day unique-aircraft-minute counts from Neon for every violating tail,
    // then SET (not increment) total_violations so repeated scans never inflate the number.
    const escalationAlerts: string[] = [];
    if (sbSql) {
      const candidates = [...violationMap.values()].filter(e =>
        e.reg && e.reg !== 'UNKNOWN' && !e.reg.includes(',') && !e.reg.includes(' aircraft')
      );
      const regs = Array.from(new Set(candidates.map(e => e.reg)));
      const trueCounts = new Map<string, number>();
      if (regs.length > 0) {
        try {
          const countRows: any[] = await withTimeout(
            sql`
              SELECT UPPER(registration) AS reg,
                     COUNT(DISTINCT (UPPER(registration) || '|' || date_trunc('minute', detection_timestamp)::text))::int AS uniq
              FROM live_flight_detections_rows
              WHERE UPPER(registration) = ANY(${regs.map(r => r.toUpperCase())})
                AND detection_timestamp > NOW() - INTERVAL '90 days'
                AND latitude BETWEEN 34.50 AND 36.30
                AND longitude BETWEEN -120.10 AND -118.00
              GROUP BY UPPER(registration)
            `,
            10000, "true_violation_counts"
          );
          for (const r of countRows) trueCounts.set(String(r.reg).toUpperCase(), Number(r.uniq) || 0);
        } catch (e) { console.warn("True-count query failed:", e instanceof Error ? e.message : e); }
      }

      for (const entry of candidates) {
        const avgAlt = entry.altitudes.length > 0 ? entry.altitudes.reduce((a, b) => a + b, 0) / entry.altitudes.length : null;
        // Authoritative count = unique aircraft-minutes in last 90d from Neon source.
        // Fall back to current scan count only if Neon query failed.
        const trueCount = trueCounts.get(entry.reg.toUpperCase()) ?? entry.count;
        try {
          const safeAvgAlt = avgAlt ?? 0;
          const hasAlt = avgAlt !== null;
          const upsertResult = await withTimeout(
            sbSql`INSERT INTO sentinel_learned_threats (registration, threat_type, total_violations, avg_altitude, last_seen, updated_at)
              VALUES (${entry.reg}, ${entry.type}, ${trueCount}, ${hasAlt ? safeAvgAlt : null}::double precision, NOW(), NOW())
              ON CONFLICT (registration, threat_type) DO UPDATE SET
                total_violations = ${trueCount},
                avg_altitude = CASE WHEN ${hasAlt} THEN ${safeAvgAlt}::double precision ELSE sentinel_learned_threats.avg_altitude END,
                last_seen = NOW(), updated_at = NOW()
              RETURNING total_violations, escalation_level`,
            5000, "upsert_threat"
          );
          if (upsertResult.length > 0) {
            const totalV = Number(upsertResult[0].total_violations);
            const oldLevel = Number(upsertResult[0].escalation_level);
            const newLevel = calcEscalationLevel(totalV);
            if (newLevel !== oldLevel) {
              try {
                await sbSql`UPDATE sentinel_learned_threats SET escalation_level = ${newLevel}, updated_at = NOW() WHERE registration = ${entry.reg} AND threat_type = ${entry.type}`;
              } catch { /* ignore */ }
              if (newLevel > oldLevel) {
                escalationAlerts.push(`🔺 ESCALATION: ${entry.reg} promoted to Level ${newLevel} (${totalV.toLocaleString()} unique aircraft-minutes / 90d)`);
              }
            }
          }
        } catch (e) { console.warn("Upsert threat error:", e instanceof Error ? e.message : e); }
      }
    }
    proactiveAlerts.push(...escalationAlerts);

    // ========== STEP 9.7: COUNTERMEASURES (always run when escalated threats exist) ==========
    if (sbSql && LOVABLE_API_KEY && (Date.now() - startTime) < 22000) {
      try {
        const highEscalationThreats = await withTimeout(
          sbSql`SELECT registration, threat_type, total_violations, escalation_level, avg_altitude, countermeasure_status
            FROM sentinel_learned_threats WHERE escalation_level >= 2
            ORDER BY escalation_level DESC, total_violations DESC LIMIT 20`,
          5000, "high_escalation_query"
        );
        if (highEscalationThreats.length > 0) {
          const cmPrompt = `You are an offensive countermeasure planner. For each escalated aerial threat below, recommend ONE concrete legal/forensic countermeasure (e.g. "FAA Hotline 1-866-835-5322 report", "FBI tips.fbi.gov § 1385 referral", "OFAC referral", "FOIA registration owner", "Add to TRO discovery exhibit", "Demand FAA LADD audit", "File NTSB safety complaint").
Threats:
${highEscalationThreats.map((t: any) => `- ${t.registration} | ${t.threat_type} | Level ${t.escalation_level} | ${t.total_violations} violations`).join('\n')}
Output STRICT format, one per line, no preamble:
REGISTRATION | ACTION | PRIORITY (critical/high/medium)`;

          const cmResponse = await withTimeout(
            fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash-lite",
                messages: [
                  { role: "system", content: "Output structured countermeasure recommendations. No preamble, no markdown." },
                  { role: "user", content: cmPrompt }
                ],
                max_tokens: 600,
              }),
            }),
            10000, "countermeasure_ai"
          );
          if (cmResponse.ok) {
            const cmData = await cmResponse.json();
            const cmText = cmData.choices?.[0]?.message?.content || '';
            const lines = cmText.split('\n').filter((l: string) => l.trim() && l.includes('|'));
            for (const line of lines) {
              const parts = line.split('|').map((p: string) => p.trim());
              if (parts.length >= 3) {
                const matchingThreat = highEscalationThreats.find((t: any) => parts[0].includes(t.registration));
                const reg = matchingThreat?.registration || parts[0];
                const action = parts[1];
                const priority = (parts[2].toLowerCase().includes('critical') ? 'critical' : parts[2].toLowerCase().includes('high') ? 'high' : 'medium') as 'critical' | 'high' | 'medium';
                const escLvl = matchingThreat ? Number(matchingThreat.escalation_level) : 1;
                countermeasures.push({
                  registration: reg, action, priority,
                  escalation_level: escLvl,
                  total_violations: matchingThreat ? Number(matchingThreat.total_violations) : 0,
                  status: 'RECOMMENDED'
                });

                // Persist countermeasure to threat record
                if (matchingThreat) {
                  try {
                    const newStatus = escLvl >= 4 ? 'ESCALATED' : escLvl >= 3 ? 'RECOMMENDED' : 'PENDING';
                    await withTimeout(
                      sbSql`UPDATE sentinel_learned_threats
                        SET countermeasure_status = ${newStatus},
                            countermeasure_actions = COALESCE(countermeasure_actions, '[]'::jsonb) || ${JSON.stringify([{
                              action, priority, generated_at: new Date().toISOString()
                            }])}::jsonb,
                            updated_at = NOW()
                        WHERE registration = ${matchingThreat.registration} AND threat_type = ${matchingThreat.threat_type}`,
                      3000, "persist_countermeasure"
                    );
                  } catch (persistErr) {
                    console.warn("Countermeasure persist failed:", persistErr instanceof Error ? persistErr.message : persistErr);
                  }
                }
              }
            }
            console.log(`Generated and persisted ${countermeasures.length} countermeasures`);
          }
        }
      } catch (e) { console.warn("Countermeasure generation skipped:", e instanceof Error ? e.message : e); }
    }

    // ========== STEP 9.5: 90-DAY HALL OF SHAME ==========
    // Top tails by detection count over 90 days within Kern AOI, with altitude
    // distribution, Oildale clustering, and snark commentary.
    const hallOfShame: HallOfShameEntry[] = [];
    let hosMeta = { window_days: 90, total_aircraft: 0, total_detections: 0, oildale_cluster_pct: 0 };
    try {
      // Tight Oildale box for clustering metric
      const OILDALE_LAT_MIN = 35.30, OILDALE_LAT_MAX = 35.55;
      const OILDALE_LON_MIN = -119.20, OILDALE_LON_MAX = -118.85;

      const hosRows: any[] = await withTimeout(
        sql.unsafe(`
          WITH win AS (
            SELECT registration,
                   NULLIF(altitude::text,'')::int AS alt,
                   latitude::float AS lat, longitude::float AS lng,
                   detection_timestamp
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '90 days'
              AND latitude BETWEEN ${GEO_LAT_MIN} AND ${GEO_LAT_MAX}
              AND longitude BETWEEN ${GEO_LON_MIN} AND ${GEO_LON_MAX}
              AND registration IS NOT NULL AND registration <> ''
          )
          SELECT registration,
                 COUNT(*)::int AS detections,
                 ROUND(AVG(NULLIF(alt,0)))::int AS avg_alt,
                 MIN(alt)::int AS min_alt,
                 ROUND(100.0 * SUM(CASE WHEN alt < 1000 AND alt > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_below_1000,
                 ROUND(100.0 * SUM(CASE WHEN alt < 500 AND alt > 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_below_500,
                 ROUND(100.0 * SUM(CASE WHEN lat BETWEEN ${OILDALE_LAT_MIN} AND ${OILDALE_LAT_MAX}
                                         AND lng BETWEEN ${OILDALE_LON_MIN} AND ${OILDALE_LON_MAX} THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_oildale,
                 AVG(lat) AS centroid_lat, AVG(lng) AS centroid_lng,
                 MIN(lat) AS lat_min, MAX(lat) AS lat_max, MIN(lng) AS lng_min, MAX(lng) AS lng_max,
                 MIN(detection_timestamp) AS first_seen, MAX(detection_timestamp) AS last_seen
          FROM win
          GROUP BY registration
          HAVING COUNT(*) >= 10
          ORDER BY detections DESC
          LIMIT 25
        `),
        15000, "hall_of_shame_query"
      );

      let totalDet = 0, totalOildale = 0, rank = 0;
      for (const r of hosRows) {
        rank += 1;
        const detections = Number(r.detections) || 0;
        const avg = Number(r.avg_alt) || 0;
        const minA = Number(r.min_alt) || 0;
        const pBelow1000 = Number(r.pct_below_1000) || 0;
        const pBelow500 = Number(r.pct_below_500) || 0;
        const pOildale = Number(r.pct_oildale) || 0;
        const centroid = (r.centroid_lat != null) ? { lat: Number(r.centroid_lat), lng: Number(r.centroid_lng) } : null;
        const spreadKm = (r.lat_min != null && r.lat_max != null)
          ? haversineKm(Number(r.lat_min), Number(r.lng_min), Number(r.lat_max), Number(r.lng_max))
          : 0;
        const cls = classifyTail(r.registration);
        const base = {
          rank, registration: r.registration, detections,
          avg_altitude_ft: avg, min_altitude_ft: minA,
          pct_below_1000ft: pBelow1000, pct_below_500ft: pBelow500,
          oildale_cluster_pct: pOildale,
          centroid, spread_km: Math.round(spreadKm * 10) / 10,
          classification: cls,
          first_seen: r.first_seen, last_seen: r.last_seen,
        };
        const { snark, what_it_really_means } = generateSnark(base);
        hallOfShame.push({ ...base, snark, what_it_really_means });
        totalDet += detections;
        totalOildale += detections * (pOildale / 100);
      }
      hosMeta = {
        window_days: 90,
        total_aircraft: hosRows.length,
        total_detections: totalDet,
        oildale_cluster_pct: totalDet > 0 ? Math.round((totalOildale / totalDet) * 1000) / 10 : 0,
      };
      console.log(`Hall of Shame: ${hallOfShame.length} tails, ${totalDet} detections, ${hosMeta.oildale_cluster_pct}% Oildale clustered`);
    } catch (e) {
      console.warn("Hall of Shame query failed:", e instanceof Error ? e.message : e);
    }

    // ========== STEP 10: DETERMINE THREAT LEVEL ==========
    let threatLevel: 'CRITICAL' | 'HIGH' | 'ELEVATED' | 'NORMAL' = 'NORMAL';
    const criticalCount = violations.filter(v => v.severity === 'critical').length;
    const highCount = violations.filter(v => v.severity === 'high').length;
    if (criticalCount >= 2 || (criticalCount >= 1 && highCount >= 2)) threatLevel = 'CRITICAL';
    else if (criticalCount >= 1 || highCount >= 3) threatLevel = 'HIGH';
    else if (highCount >= 1 || violations.length >= 3) threatLevel = 'ELEVATED';

    // Cleanup connections
    try { await sql.end(); } catch { /* ignore */ }
    if (sbSql) try { await sbSql.end(); } catch { /* ignore */ }

    const report: SentinelReport = {
      scan_timestamp: new Date().toISOString(),
      window_minutes: windowMinutes,
      detections_analyzed: dedupeMetrics.unique_aircraft_minutes,
      raw_pings: dedupeMetrics.raw_pings,
      dedupe: dedupeMetrics,
      violations, learned_patterns: learnedPatterns,
      proactive_alerts: proactiveAlerts,
      ai_synthesis: aiSynthesis,
      threat_level: threatLevel,
      adaptive_thresholds: adaptiveThresholds,
      countermeasures,
      josiah_snark: josiahSnark,
      military_repeat_offenders: militaryRepeatOffenders,
      hall_of_shame: hallOfShame,
      hall_of_shame_meta: hosMeta,
      convergence_altitude_breakdown: convergenceBreakdown,
    };

    console.log(`Sentinel scan complete in ${Date.now() - startTime}ms: ${violations.length} violations, threat=${threatLevel}`);

    return new Response(
      JSON.stringify({ success: true, report }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Josiah Sentinel error:", err);
    if (sql) try { await sql.end(); } catch { /* ignore */ }
    if (sbSql) try { await sbSql.end(); } catch { /* ignore */ }
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

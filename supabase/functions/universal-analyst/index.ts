import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// AOI Center — 120 W Pilot Ave, Bakersfield CA 93308
const AOI = {
  lat: 35.437649,
  lng: -119.022639,
  // Tight box: ~4km x 4.5km
  latMin: 35.42, latMax: 35.46,
  lngMin: -119.05, lngMax: -119.00,
  // Wide box: ~20km x 20km
  wideLatMin: 35.35, wideLatMax: 35.55,
  wideLngMin: -119.12, wideLngMax: -118.93,
};

// Haversine distance in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distance from AOI center in km
function distFromAOI(lat: number, lng: number): number {
  return haversineKm(AOI.lat, AOI.lng, lat, lng);
}

// Stall speeds by aircraft type (KIAS)
const STALL_SPEEDS: Record<string, number> = {
  'H125': 50, 'B407': 40, 'R44': 40, 'H500': 45, 'B206': 40,
  'C172': 48, 'C182': 55, 'PA28': 50, 'BE36': 60, 'SR22': 70,
  'E175': 110, 'B737': 130, 'A320': 125, 'TBM7': 70, 'UNKNOWN': 50
};

const LEGAL_FRAMEWORKS: Record<string, any> = {
  'PHYSICS_VIOLATION': {
    statute: '49 USC § 46315', crime: 'Fraudulent aircraft registration in air commerce',
    elements: ['False data in ADS-B', 'Physics-impossible parameters', 'Intentional deception'],
    penalty: 'Up to 3 years imprisonment + fines', civil: 'FAA enforcement action'
  },
  'HEX_RECYCLING': {
    statute: '18 USC § 1001', crime: 'False statements to federal agency',
    elements: ['Multiple aircraft using same transponder code', 'Shell company registration fraud'],
    penalty: 'Up to 5 years per count', civil: 'Treble damages under False Claims Act'
  },
  'FLEET_CONVERGENCE': {
    statute: '18 USC § 241', crime: 'Conspiracy against rights',
    elements: ['Two or more persons', 'Agreement to intimidate/harass', 'Overt act'],
    penalty: 'Up to 10 years', civil: '42 USC § 1983 civil rights lawsuit'
  },
  'NIGHT_HARASSMENT': {
    statute: '42 USC § 1983', crime: 'Civil rights violation under color of law',
    elements: ['State actor', 'Deprivation of constitutional right', 'Under color of law'],
    penalty: 'Compensatory + punitive damages', civil: 'Injunctive relief available'
  },
  'REPEAT_OFFENDER': {
    statute: '18 USC § 1961-1968 (RICO)', crime: 'Racketeering / pattern of harassment',
    elements: ['Enterprise', 'Pattern of activity', 'Two or more predicate acts'],
    penalty: 'Up to 20 years per count', civil: 'Treble damages'
  },
  'CROSS_COUNTY_COORDINATION': {
    statute: '18 USC § 1385 (Posse Comitatus)', crime: 'Use of military for civilian law enforcement',
    elements: ['Military involvement', 'Civilian law enforcement purpose', 'No explicit authorization'],
    penalty: 'Fine + imprisonment', civil: 'Declaratory and injunctive relief'
  },
  'LOITER_SURVEILLANCE': {
    statute: '42 USC § 1983 + 4th Amendment', crime: 'Warrantless persistent aerial surveillance',
    elements: ['Sustained loiter over residence', 'No warrant', 'Pattern of repeated targeting'],
    penalty: 'Compensatory + punitive damages', civil: 'Carpenter v. US analogy'
  },
  'DRONE_ISR': {
    statute: '18 USC § 2511 + FAR § 107.39', crime: 'Electronic surveillance + drone over persons',
    elements: ['Unregistered drone', 'Over residential area', 'No COA/waiver'],
    penalty: 'Up to 5 years', civil: 'FAA enforcement, civil ECPA claim'
  }
};

function guessAircraftType(tailNumber: string): string {
  if (!tailNumber) return 'UNKNOWN';
  if (tailNumber.includes('KC')) return 'H125';
  return 'UNKNOWN';
}

interface PhysicsViolation { type: string; details: Record<string, any>; confidence: number; }

function validatePhysics(row: any): PhysicsViolation[] {
  const violations: PhysicsViolation[] = [];
  const alt = parseFloat(row.altitude_ft) || 0;
  const spd = parseFloat(row.speed_kts) || 0;
  const type = guessAircraftType(row.tail_number || row.registration || '');
  const stallSpeed = STALL_SPEEDS[type] || 50;
  if (alt < 1000 && spd < stallSpeed && spd > 0) violations.push({ type: 'BELOW_STALL', details: { expected: stallSpeed, actual: spd, altitude: alt }, confidence: 0.95 });
  if (alt === 0 && spd > 10) violations.push({ type: 'GROUND_SPEED_AIRBORNE', details: { speed: spd }, confidence: 0.98 });
  if (alt < 0) violations.push({ type: 'NEGATIVE_ALTITUDE', details: { altitude: alt }, confidence: 0.99 });
  if (alt < 5000 && spd > 600) violations.push({ type: 'SUPERSONIC_LOW', details: { speed: spd, altitude: alt }, confidence: 0.90 });
  return violations;
}

function hashPattern(type: string, data: any): string {
  const str = `${type}:${JSON.stringify(data)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
}

// Track-level scoring with haversine
interface TrackScore {
  registration: string;
  callsign: string;
  detections: number;
  track_km: number;
  disp_km: number;
  path_eff: number;
  bbox_area_km2: number;
  avg_alt: number;
  avg_speed: number;
  min_dist_aoi_km: number;
  loiter_score: number;
  orbit_score: number;
  slow_score: number;
  tactics_score: number;
}

function computeTrackScores(contacts: any[]): TrackScore[] {
  // Group by registration
  const grouped: Record<string, any[]> = {};
  for (const c of contacts) {
    const key = c.tail_number || c.hex_code || 'UNKNOWN';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  const scores: TrackScore[] = [];
  for (const [reg, pts] of Object.entries(grouped)) {
    if (pts.length < 3) continue;

    // Sort by timestamp
    pts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Haversine track distance with per-segment cap
    let trackKm = 0;
    for (let i = 1; i < pts.length; i++) {
      const segDist = haversineKm(pts[i-1].latitude, pts[i-1].longitude, pts[i].latitude, pts[i].longitude);
      const dtSec = (new Date(pts[i].timestamp).getTime() - new Date(pts[i-1].timestamp).getTime()) / 1000;
      // Cap: max 350 kts = 648 km/h = 0.18 km/s
      const maxSegDist = Math.max(dtSec * 0.18, 1);
      trackKm += Math.min(segDist, maxSegDist);
    }

    // Endpoint displacement
    const dispKm = haversineKm(pts[0].latitude, pts[0].longitude, pts[pts.length-1].latitude, pts[pts.length-1].longitude);

    // Path efficiency (capped at 20)
    const pathEff = dispKm > 0.1 ? Math.min(trackKm / dispKm, 20) : (trackKm > 0.5 ? 20 : 1);

    // Bounding box area with cos(lat) correction
    const lats = pts.map((p: any) => p.latitude);
    const lngs = pts.map((p: any) => p.longitude);
    const latRange = (Math.max(...lats) - Math.min(...lats)) * 111.32;
    const lngRange = (Math.max(...lngs) - Math.min(...lngs)) * 111.32 * Math.cos(AOI.lat * Math.PI / 180);
    const bboxArea = latRange * lngRange;

    // Altitude and speed stats
    const alts = pts.map((p: any) => parseFloat(p.altitude_ft) || 0);
    const spds = pts.map((p: any) => parseFloat(p.speed_kts) || 0);
    const avgAlt = alts.reduce((a: number, b: number) => a + b, 0) / alts.length;
    const avgSpd = spds.reduce((a: number, b: number) => a + b, 0) / spds.length;

    // Min distance to AOI center
    const minDistAOI = Math.min(...pts.map((p: any) => distFromAOI(p.latitude, p.longitude)));

    // Scoring
    // Loiter: small bbox, many points
    const loiterScore = bboxArea < 4 ? Math.min((pts.length / 10) * (4 - bboxArea), 100) : 0;
    // Orbit: high path efficiency
    const orbitScore = Math.min((pathEff - 1) * 15, 100);
    // Slow: low average speed
    const slowScore = avgSpd < 30 ? Math.min((30 - avgSpd) * 3, 100) : 0;

    // Proximity bonus (closer to residence = higher weight)
    const proxBonus = minDistAOI < 1 ? 2.0 : minDistAOI < 2 ? 1.5 : minDistAOI < 5 ? 1.2 : 1.0;

    // Altitude bonus (lower = more suspicious)
    const altBonus = avgAlt < 200 ? 1.5 : avgAlt < 500 ? 1.3 : avgAlt < 1000 ? 1.1 : 1.0;

    const tacticsScore = (loiterScore * 0.35 + orbitScore * 0.30 + slowScore * 0.35) * proxBonus * altBonus;

    scores.push({
      registration: reg,
      callsign: pts[0].operator || '',
      detections: pts.length,
      track_km: Math.round(trackKm * 100) / 100,
      disp_km: Math.round(dispKm * 100) / 100,
      path_eff: Math.round(pathEff * 100) / 100,
      bbox_area_km2: Math.round(bboxArea * 100) / 100,
      avg_alt: Math.round(avgAlt),
      avg_speed: Math.round(avgSpd * 10) / 10,
      min_dist_aoi_km: Math.round(minDistAOI * 100) / 100,
      loiter_score: Math.round(loiterScore * 10) / 10,
      orbit_score: Math.round(orbitScore * 10) / 10,
      slow_score: Math.round(slowScore * 10) / 10,
      tactics_score: Math.round(tacticsScore * 10) / 10,
    });
  }

  return scores.sort((a, b) => b.tactics_score - a.tactics_score);
}

async function universalSurface(sql: any, hours: number) {
  const contacts = await sql`
    SELECT 
      COALESCE(icao_code, icao24, '') as hex_code,
      COALESCE(registration, '') as tail_number,
      COALESCE(callsign, 'UNKNOWN') as operator,
      COALESCE(altitude::float, 0) as altitude_ft,
      COALESCE(speed::float, 0) as speed_kts,
      COALESCE(detection_timestamp, created_at) as timestamp,
      COALESCE(latitude::float, 0) as latitude,
      COALESCE(longitude::float, 0) as longitude,
      COALESCE(threat_score::int, 0) as threat_score
    FROM live_flight_detections_rows
    WHERE COALESCE(detection_timestamp, created_at) IS NOT NULL
    AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 hour' * ${hours}
    AND latitude BETWEEN ${AOI.wideLatMin} AND ${AOI.wideLatMax}
    AND longitude BETWEEN ${AOI.wideLngMin} AND ${AOI.wideLngMax}
    ORDER BY COALESCE(detection_timestamp, created_at) DESC
    LIMIT 2000
  `;

  if (contacts.length === 0) {
    return { status: 'NO_DATA', message: 'No aircraft contacts in window', aoi: AOI, timestamp: new Date().toISOString() };
  }

  const patterns: any[] = [];

  // Pattern 1: Physics violations
  const physicsViolations: any[] = [];
  for (const c of contacts) {
    const v = validatePhysics(c);
    if (v.length > 0) physicsViolations.push({ hex: c.hex_code, tail: c.tail_number, operator: c.operator, timestamp: c.timestamp, violations: v });
  }
  if (physicsViolations.length > 0) {
    const involved = [...new Set(physicsViolations.map(v => v.hex))];
    patterns.push({
      pattern_id: hashPattern('physics', involved), pattern_type: 'PHYSICS_VIOLATION',
      confidence: 0.95, evidence_count: physicsViolations.length,
      description: `${physicsViolations.length} aerodynamically impossible flight parameters detected`,
      involved_aircraft: involved, legal_framework: LEGAL_FRAMEWORKS['PHYSICS_VIOLATION'],
      severity: physicsViolations.length > 5 ? 'CRITICAL' : 'HIGH', details: physicsViolations.slice(0, 10)
    });
  }

  // Pattern 2: Fleet convergence
  const hourly: Record<string, Set<string>> = {};
  for (const c of contacts) {
    const ts = new Date(c.timestamp);
    const key = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}`;
    if (!hourly[key]) hourly[key] = new Set();
    hourly[key].add(c.hex_code);
  }
  for (const [hour, hexes] of Object.entries(hourly)) {
    if (hexes.size >= 3) {
      patterns.push({
        pattern_id: hashPattern('convergence', hour), pattern_type: 'FLEET_CONVERGENCE',
        confidence: 0.85, evidence_count: hexes.size,
        description: `${hexes.size} unique aircraft in same hour — coordinated swarm`,
        involved_aircraft: [...hexes], legal_framework: LEGAL_FRAMEWORKS['FLEET_CONVERGENCE'],
        severity: hexes.size >= 10 ? 'CRITICAL' : hexes.size >= 5 ? 'HIGH' : 'MEDIUM', hour
      });
    }
  }

  // Pattern 3: Hex recycling
  const hexToTails: Record<string, Set<string>> = {};
  for (const c of contacts) {
    if (c.hex_code && c.tail_number && c.tail_number !== 'UNKNOWN' && c.tail_number !== 'ISTRATION') {
      if (!hexToTails[c.hex_code]) hexToTails[c.hex_code] = new Set();
      hexToTails[c.hex_code].add(c.tail_number);
    }
  }
  const recycled = Object.entries(hexToTails).filter(([, tails]) => tails.size > 1);
  if (recycled.length > 0) {
    patterns.push({
      pattern_id: hashPattern('recycling', recycled.map(r => r[0])), pattern_type: 'HEX_RECYCLING',
      confidence: 0.90, evidence_count: recycled.length,
      description: `${recycled.length} hex codes associated with multiple tail numbers (transponder spoofing)`,
      involved_aircraft: recycled.map(r => r[0]), legal_framework: LEGAL_FRAMEWORKS['HEX_RECYCLING'],
      severity: 'CRITICAL', details: recycled.map(([hex, tails]) => ({ hex, tails: [...tails] }))
    });
  }

  // Pattern 4: Night ops (1-4 AM)
  const nightContacts = contacts.filter((c: any) => { const h = new Date(c.timestamp).getHours(); return h >= 1 && h <= 4; });
  if (nightContacts.length > 5) {
    patterns.push({
      pattern_id: hashPattern('night', nightContacts.length), pattern_type: 'NIGHT_HARASSMENT',
      confidence: 0.80, evidence_count: nightContacts.length,
      description: `${nightContacts.length} detections during 1-4 AM window (sleep disruption pattern)`,
      involved_aircraft: [...new Set(nightContacts.map((c: any) => c.hex_code))],
      legal_framework: LEGAL_FRAMEWORKS['NIGHT_HARASSMENT'],
      severity: nightContacts.length > 20 ? 'HIGH' : 'MEDIUM'
    });
  }

  // Pattern 5: Repeat offenders
  const hexCounts: Record<string, number> = {};
  for (const c of contacts) hexCounts[c.hex_code] = (hexCounts[c.hex_code] || 0) + 1;
  const repeaters = Object.entries(hexCounts).filter(([, count]) => count > 5);
  if (repeaters.length > 0) {
    patterns.push({
      pattern_id: hashPattern('repeaters', repeaters.map(r => r[0])), pattern_type: 'REPEAT_OFFENDER',
      confidence: 0.75, evidence_count: repeaters.length,
      description: `${repeaters.length} aircraft with 5+ detections (persistent presence)`,
      involved_aircraft: repeaters.map(r => r[0]), legal_framework: LEGAL_FRAMEWORKS['REPEAT_OFFENDER'],
      severity: 'MEDIUM', details: repeaters.map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count)
    });
  }

  // Pattern 6: Loiter surveillance (new — from track scoring)
  const trackScores = computeTrackScores(contacts);
  const loiterSuspects = trackScores.filter(t => t.tactics_score > 30 && t.min_dist_aoi_km < 3);
  if (loiterSuspects.length > 0) {
    patterns.push({
      pattern_id: hashPattern('loiter', loiterSuspects.map(l => l.registration)), pattern_type: 'LOITER_SURVEILLANCE',
      confidence: 0.88, evidence_count: loiterSuspects.length,
      description: `${loiterSuspects.length} aircraft with loiter/orbit patterns within 3km of residence`,
      involved_aircraft: loiterSuspects.map(l => l.registration),
      legal_framework: LEGAL_FRAMEWORKS['LOITER_SURVEILLANCE'],
      severity: loiterSuspects.some(l => l.tactics_score > 60) ? 'CRITICAL' : 'HIGH',
      details: loiterSuspects.slice(0, 10)
    });
  }

  // Sort patterns
  const severityOrder: Record<string, number> = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
  patterns.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  return {
    status: 'COMPLETE',
    timestamp: new Date().toISOString(),
    aoi: { center: `${AOI.lat}, ${AOI.lng}`, address: '120 W Pilot Ave, Bakersfield CA 93308' },
    scan_window_hours: hours,
    total_contacts_analyzed: contacts.length,
    analysis_philosophy: 'EQUAL_TREATMENT',
    patterns_surfaced: patterns.length,
    critical_patterns: patterns.filter(p => p.severity === 'CRITICAL').length,
    high_patterns: patterns.filter(p => p.severity === 'HIGH').length,
    patterns,
    top_suspect_tracks: trackScores.slice(0, 20),
    unique_operators: new Set(contacts.map((c: any) => c.operator)).size,
    unique_aircraft: new Set(contacts.map((c: any) => c.hex_code)).size,
  };
}

async function aoiReport(sql: any) {
  // Pre-computed AOI intelligence report
  const [lowAlt, loiterSlow, xxd, sis, peakDays] = await Promise.all([
    sql`SELECT registration, callsign, COUNT(*) as hits, ROUND(AVG(altitude)) as avg_alt
      FROM live_flight_detections_rows
      WHERE latitude BETWEEN ${AOI.latMin} AND ${AOI.latMax} AND longitude BETWEEN ${AOI.lngMin} AND ${AOI.lngMax}
      AND altitude < 500 AND registration IS NOT NULL AND registration != 'ISTRATION'
      GROUP BY registration, callsign ORDER BY hits DESC LIMIT 25`,
    sql`SELECT registration, callsign, COUNT(*) as hits, ROUND(AVG(altitude)) as avg_alt, ROUND(AVG(speed)::numeric, 1) as avg_speed
      FROM live_flight_detections_rows
      WHERE latitude BETWEEN ${AOI.latMin} AND ${AOI.latMax} AND longitude BETWEEN ${AOI.lngMin} AND ${AOI.lngMax}
      AND altitude BETWEEN 50 AND 500 AND speed IS NOT NULL AND speed < 30
      AND registration IS NOT NULL AND registration != 'ISTRATION'
      GROUP BY registration, callsign HAVING COUNT(*) >= 3 ORDER BY hits DESC LIMIT 15`,
    sql`SELECT callsign, COUNT(*) as hits, ROUND(AVG(altitude)) as avg_alt, ROUND(AVG(speed)::numeric, 1) as avg_spd,
      MIN(COALESCE(detection_timestamp, created_at)) as first_seen, MAX(COALESCE(detection_timestamp, created_at)) as last_seen
      FROM live_flight_detections_rows
      WHERE latitude BETWEEN ${AOI.latMin} AND ${AOI.latMax} AND longitude BETWEEN ${AOI.lngMin} AND ${AOI.lngMax}
      AND (callsign LIKE 'XXD%' OR callsign LIKE 'XXB%') GROUP BY callsign ORDER BY hits DESC LIMIT 10`,
    sql`SELECT callsign, registration, COUNT(*) as hits, ROUND(AVG(altitude)) as avg_alt
      FROM live_flight_detections_rows
      WHERE latitude BETWEEN ${AOI.latMin} AND ${AOI.latMax} AND longitude BETWEEN ${AOI.lngMin} AND ${AOI.lngMax}
      AND (callsign LIKE 'SIS%' OR registration = 'N912KC') GROUP BY callsign, registration ORDER BY hits DESC LIMIT 10`,
    sql`SELECT DATE(COALESCE(detection_timestamp, created_at)) as dt, COUNT(*) as detections, COUNT(DISTINCT registration) as unique_aircraft
      FROM live_flight_detections_rows
      WHERE latitude BETWEEN ${AOI.latMin} AND ${AOI.latMax} AND longitude BETWEEN ${AOI.lngMin} AND ${AOI.lngMax}
      AND altitude < 1000 AND COALESCE(detection_timestamp, created_at) IS NOT NULL
      GROUP BY DATE(COALESCE(detection_timestamp, created_at)) ORDER BY detections DESC LIMIT 10`,
  ]);

  return {
    status: 'COMPLETE',
    aoi: { center: `${AOI.lat}, ${AOI.lng}`, address: '120 W Pilot Ave, Bakersfield CA 93308', tight_box: `${AOI.latMin}-${AOI.latMax} N, ${AOI.lngMin}-${AOI.lngMax} W` },
    low_altitude_threats: lowAlt,
    loiter_suspects: loiterSlow,
    drone_contacts: xxd,
    kcso_assets: sis,
    peak_activity_days: peakDays,
  };
}

async function deepDive(sql: any, identifier: string, days: number) {
  const isHex = /^[a-f0-9]{6}$/i.test(identifier);
  const isTail = /^N[0-9A-Z]{2,5}$/i.test(identifier);
  const isCallsign = !isHex && !isTail && identifier.length >= 2;

  let contacts;
  if (isHex) {
    contacts = await sql`SELECT *, COALESCE(icao_code, icao24, '') as hex_code, COALESCE(registration, '') as tail_number,
      COALESCE(callsign, 'UNKNOWN') as operator, COALESCE(altitude::float, 0) as altitude_ft, COALESCE(speed::float, 0) as speed_kts,
      COALESCE(latitude::float, 0) as latitude, COALESCE(longitude::float, 0) as longitude
      FROM live_flight_detections_rows WHERE (icao_code = ${identifier} OR icao24 = ${identifier})
      AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY COALESCE(detection_timestamp, created_at) ASC LIMIT 2000`;
  } else if (isTail) {
    contacts = await sql`SELECT *, COALESCE(icao_code, icao24, '') as hex_code, COALESCE(registration, '') as tail_number,
      COALESCE(callsign, 'UNKNOWN') as operator, COALESCE(altitude::float, 0) as altitude_ft, COALESCE(speed::float, 0) as speed_kts,
      COALESCE(latitude::float, 0) as latitude, COALESCE(longitude::float, 0) as longitude
      FROM live_flight_detections_rows WHERE registration = ${identifier}
      AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY COALESCE(detection_timestamp, created_at) ASC LIMIT 2000`;
  } else if (isCallsign) {
    contacts = await sql`SELECT *, COALESCE(icao_code, icao24, '') as hex_code, COALESCE(registration, '') as tail_number,
      COALESCE(callsign, 'UNKNOWN') as operator, COALESCE(altitude::float, 0) as altitude_ft, COALESCE(speed::float, 0) as speed_kts,
      COALESCE(latitude::float, 0) as latitude, COALESCE(longitude::float, 0) as longitude
      FROM live_flight_detections_rows WHERE callsign = ${identifier}
      AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY COALESCE(detection_timestamp, created_at) ASC LIMIT 2000`;
  } else {
    return { status: 'INVALID_IDENTIFIER', message: 'Provide a hex code, N-number, or callsign' };
  }

  if (contacts.length === 0) return { status: 'NO_DATA', aircraft: identifier };

  const alts = contacts.map((c: any) => parseFloat(c.altitude_ft || 0)).filter((a: number) => !isNaN(a));
  const spds = contacts.map((c: any) => parseFloat(c.speed_kts || 0)).filter((s: number) => !isNaN(s));
  const physicsViolations = contacts.reduce((count: number, c: any) => count + (validatePhysics(c).length > 0 ? 1 : 0), 0);

  // Track scoring for this aircraft
  const trackScores = computeTrackScores(contacts);

  // AOI proximity analysis
  const aoiContacts = contacts.filter((c: any) => 
    c.latitude >= AOI.latMin && c.latitude <= AOI.latMax && c.longitude >= AOI.lngMin && c.longitude <= AOI.lngMax
  );

  // Hour distribution
  const hourDist: Record<number, number> = {};
  for (const c of contacts) {
    const ts = c.detection_timestamp || c.created_at;
    if (ts) { const h = new Date(ts).getHours(); hourDist[h] = (hourDist[h] || 0) + 1; }
  }

  return {
    status: 'COMPLETE',
    aircraft: identifier,
    tail_number: contacts[0].registration || contacts[0].tail_number || identifier,
    operator: contacts[0].operator || 'UNKNOWN',
    analysis_period_days: days,
    total_detections: contacts.length,
    aoi_detections: aoiContacts.length,
    aoi_percentage: ((aoiContacts.length / contacts.length) * 100).toFixed(1) + '%',
    first_seen: contacts[0].detection_timestamp || contacts[0].created_at,
    last_seen: contacts[contacts.length - 1].detection_timestamp || contacts[contacts.length - 1].created_at,
    altitude_stats: {
      mean: alts.length ? Math.round(alts.reduce((a, b) => a + b, 0) / alts.length) : 0,
      min: alts.length ? Math.min(...alts) : 0,
      max: alts.length ? Math.max(...alts) : 0,
    },
    speed_stats: {
      mean: spds.length ? Math.round(spds.reduce((a, b) => a + b, 0) / spds.length) : 0,
      min: spds.length ? Math.min(...spds) : 0,
      max: spds.length ? Math.max(...spds) : 0,
    },
    physics_violations: physicsViolations,
    violation_percentage: contacts.length > 0 ? ((physicsViolations / contacts.length) * 100).toFixed(1) : 0,
    legal_exposure: physicsViolations / contacts.length > 0.5 ? 'HIGH' : physicsViolations / contacts.length > 0.2 ? 'MEDIUM' : 'LOW',
    track_scoring: trackScores.length > 0 ? trackScores[0] : null,
    hour_distribution: hourDist,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { action, hours, identifier, days } = await req.json();
    const NEON_DATABASE_URL = Deno.env.get('NEON_DATABASE_URL');
    if (!NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL not configured');

    const sql = postgres(NEON_DATABASE_URL, { ssl: 'require', max: 1 });
    let result;
    try {
      if (action === 'surface') result = await universalSurface(sql, hours || 48);
      else if (action === 'aoi_report') result = await aoiReport(sql);
      else if (action === 'deep_dive') result = await deepDive(sql, identifier || '', days || 90);
      else if (action === 'legal_framework') result = { frameworks: LEGAL_FRAMEWORKS };
      else result = { error: 'Unknown action. Use: surface, aoi_report, deep_dive, legal_framework' };
    } finally { await sql.end(); }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Universal analyst error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

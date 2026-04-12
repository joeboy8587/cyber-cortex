import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Stall speeds by aircraft type (KIAS)
const STALL_SPEEDS: Record<string, number> = {
  'H125': 50, 'B407': 40, 'R44': 40, 'H500': 45, 'B206': 40,
  'C172': 48, 'C182': 55, 'PA28': 50, 'BE36': 60, 'SR22': 70,
  'E175': 110, 'B737': 130, 'A320': 125, 'TBM7': 70, 'UNKNOWN': 50
};

// Legal frameworks mapped to pattern types
const LEGAL_FRAMEWORKS: Record<string, any> = {
  'PHYSICS_VIOLATION': {
    statute: '49 USC § 46315',
    crime: 'Fraudulent aircraft registration in air commerce',
    elements: ['False data in ADS-B', 'Physics-impossible parameters', 'Intentional deception'],
    penalty: 'Up to 3 years imprisonment + fines',
    civil: 'FAA enforcement action, certificate revocation'
  },
  'HEX_RECYCLING': {
    statute: '18 USC § 1001',
    crime: 'False statements to federal agency',
    elements: ['Multiple aircraft using same transponder code', 'Shell company registration fraud'],
    penalty: 'Up to 5 years per count',
    civil: 'Treble damages under False Claims Act'
  },
  'FLEET_CONVERGENCE': {
    statute: '18 USC § 241',
    crime: 'Conspiracy against rights',
    elements: ['Two or more persons', 'Agreement to intimidate/harass', 'Overt act'],
    penalty: 'Up to 10 years (life if kidnapping/death)',
    civil: '42 USC § 1983 civil rights lawsuit'
  },
  'NIGHT_HARASSMENT': {
    statute: '42 USC § 1983',
    crime: 'Civil rights violation — targeted harassment',
    elements: ['State action', 'Intentional infliction of emotional distress', 'Physiological harm'],
    penalty: 'Monetary damages, injunctive relief',
    civil: 'Federal civil rights lawsuit, DOJ referral'
  },
  'REPEAT_OFFENDER': {
    statute: '18 USC § 1962(c)',
    crime: 'Pattern of persistent surveillance',
    elements: ['Repeated low-altitude overflights', 'Same aircraft/operator', 'Sustained period'],
    penalty: 'Pattern evidence for RICO enterprise',
    civil: 'Cumulative harassment damages'
  },
  'CROSS_COUNTY_COORDINATION': {
    statute: '18 USC § 1962(c)',
    crime: 'RICO — conducting enterprise through racketeering',
    elements: ['Enterprise (multi-county network)', 'Pattern of racketeering', 'Interstate commerce'],
    penalty: '20 years + asset forfeiture',
    civil: 'RICO civil suit (treble damages)'
  }
};

function guessAircraftType(tailNumber: string): string {
  if (!tailNumber) return 'UNKNOWN';
  if (tailNumber.includes('KC')) return 'H125';
  return 'UNKNOWN';
}

interface PhysicsViolation {
  type: string;
  details: Record<string, any>;
  confidence: number;
}

function validatePhysics(row: any): PhysicsViolation[] {
  const violations: PhysicsViolation[] = [];
  const alt = parseFloat(row.altitude_ft) || 0;
  const spd = parseFloat(row.speed_kts) || 0;
  const type = guessAircraftType(row.tail_number || row.registration || '');
  const stallSpeed = STALL_SPEEDS[type] || 50;

  if (alt < 1000 && spd < stallSpeed && spd > 0) {
    violations.push({ type: 'BELOW_STALL', details: { expected: stallSpeed, actual: spd, altitude: alt }, confidence: 0.95 });
  }
  if (alt === 0 && spd > 10) {
    violations.push({ type: 'GROUND_SPEED_AIRBORNE', details: { speed: spd }, confidence: 0.98 });
  }
  if (alt < 0) {
    violations.push({ type: 'NEGATIVE_ALTITUDE', details: { altitude: alt }, confidence: 0.99 });
  }
  if (alt < 5000 && spd > 600) {
    violations.push({ type: 'SUPERSONIC_LOW', details: { speed: spd, altitude: alt }, confidence: 0.90 });
  }
  return violations;
}

function hashPattern(type: string, data: any): string {
  const str = `${type}:${JSON.stringify(data)}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
}

async function universalSurface(sql: any, hours: number) {
  // Query ALL detections equally — no operator filtering
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
    WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 hour' * ${hours}
    ORDER BY COALESCE(detection_timestamp, created_at) ASC
    LIMIT 5000
  `;

  if (contacts.length === 0) {
    return { status: 'NO_DATA', message: 'No aircraft contacts in window', timestamp: new Date().toISOString() };
  }

  const patterns: any[] = [];

  // Pattern 1: Physics violations
  const physicsViolations: any[] = [];
  for (const c of contacts) {
    const v = validatePhysics(c);
    if (v.length > 0) {
      physicsViolations.push({ hex: c.hex_code, tail: c.tail_number, operator: c.operator, timestamp: c.timestamp, violations: v });
    }
  }
  if (physicsViolations.length > 0) {
    const involved = [...new Set(physicsViolations.map(v => v.hex))];
    patterns.push({
      pattern_id: hashPattern('physics', involved),
      pattern_type: 'PHYSICS_VIOLATION',
      confidence: 0.95,
      evidence_count: physicsViolations.length,
      description: `${physicsViolations.length} aerodynamically impossible flight parameters detected`,
      involved_aircraft: involved,
      legal_framework: LEGAL_FRAMEWORKS['PHYSICS_VIOLATION'],
      severity: physicsViolations.length > 5 ? 'CRITICAL' : 'HIGH',
      details: physicsViolations.slice(0, 10)
    });
  }

  // Pattern 2: Fleet convergence (hourly swarm detection)
  const hourly: Record<string, Set<string>> = {};
  for (const c of contacts) {
    const ts = new Date(c.timestamp);
    const key = `${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}`;
    if (!hourly[key]) hourly[key] = new Set();
    hourly[key].add(c.hex_code);
  }
  for (const [hour, hexes] of Object.entries(hourly)) {
    if (hexes.size >= 3) {
      const sev = hexes.size >= 10 ? 'CRITICAL' : hexes.size >= 5 ? 'HIGH' : 'MEDIUM';
      patterns.push({
        pattern_id: hashPattern('convergence', hour),
        pattern_type: 'FLEET_CONVERGENCE',
        confidence: 0.85,
        evidence_count: hexes.size,
        description: `${hexes.size} unique aircraft in same hour — coordinated swarm`,
        involved_aircraft: [...hexes],
        legal_framework: LEGAL_FRAMEWORKS['FLEET_CONVERGENCE'],
        severity: sev,
        hour
      });
    }
  }

  // Pattern 3: Hex recycling (same hex, different tails)
  const hexToTails: Record<string, Set<string>> = {};
  for (const c of contacts) {
    if (c.hex_code && c.tail_number && c.tail_number !== 'UNKNOWN') {
      if (!hexToTails[c.hex_code]) hexToTails[c.hex_code] = new Set();
      hexToTails[c.hex_code].add(c.tail_number);
    }
  }
  const recycled = Object.entries(hexToTails).filter(([, tails]) => tails.size > 1);
  if (recycled.length > 0) {
    patterns.push({
      pattern_id: hashPattern('recycling', recycled.map(r => r[0])),
      pattern_type: 'HEX_RECYCLING',
      confidence: 0.90,
      evidence_count: recycled.length,
      description: `${recycled.length} hex codes associated with multiple tail numbers (transponder spoofing)`,
      involved_aircraft: recycled.map(r => r[0]),
      legal_framework: LEGAL_FRAMEWORKS['HEX_RECYCLING'],
      severity: 'CRITICAL',
      details: recycled.map(([hex, tails]) => ({ hex, tails: [...tails] }))
    });
  }

  // Pattern 4: Night operations (1-4 AM)
  const nightContacts = contacts.filter((c: any) => {
    const h = new Date(c.timestamp).getHours();
    return h >= 1 && h <= 4;
  });
  if (nightContacts.length > 5) {
    const involved = [...new Set(nightContacts.map((c: any) => c.hex_code))];
    patterns.push({
      pattern_id: hashPattern('night', nightContacts.length),
      pattern_type: 'NIGHT_HARASSMENT',
      confidence: 0.80,
      evidence_count: nightContacts.length,
      description: `${nightContacts.length} detections during 1-4 AM window (sleep disruption pattern)`,
      involved_aircraft: involved,
      legal_framework: LEGAL_FRAMEWORKS['NIGHT_HARASSMENT'],
      severity: nightContacts.length > 20 ? 'HIGH' : 'MEDIUM'
    });
  }

  // Pattern 5: Repeat offenders
  const hexCounts: Record<string, number> = {};
  for (const c of contacts) {
    hexCounts[c.hex_code] = (hexCounts[c.hex_code] || 0) + 1;
  }
  const repeaters = Object.entries(hexCounts).filter(([, count]) => count > 5);
  if (repeaters.length > 0) {
    patterns.push({
      pattern_id: hashPattern('repeaters', repeaters.map(r => r[0])),
      pattern_type: 'REPEAT_OFFENDER',
      confidence: 0.75,
      evidence_count: repeaters.length,
      description: `${repeaters.length} aircraft with 5+ detections (persistent presence)`,
      involved_aircraft: repeaters.map(r => r[0]),
      legal_framework: LEGAL_FRAMEWORKS['REPEAT_OFFENDER'],
      severity: 'MEDIUM',
      details: repeaters.map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count)
    });
  }

  // Pattern 6: Cross-county coordination
  const operators = contacts.map((c: any) => c.operator).filter((o: string) => o !== 'UNKNOWN');
  const countyOps = operators.filter((o: string) => /sheriff|kcso|county/i.test(o));
  const uniqueCounties = new Set(countyOps);
  if (uniqueCounties.size > 1) {
    patterns.push({
      pattern_id: hashPattern('cross_county', [...uniqueCounties]),
      pattern_type: 'CROSS_COUNTY_COORDINATION',
      confidence: 0.70,
      evidence_count: countyOps.length,
      description: `${uniqueCounties.size} different county agencies operating simultaneously`,
      involved_aircraft: [...new Set(contacts.filter((c: any) => /sheriff|kcso|county/i.test(c.operator)).map((c: any) => c.hex_code))],
      legal_framework: LEGAL_FRAMEWORKS['CROSS_COUNTY_COORDINATION'],
      severity: 'HIGH'
    });
  }

  // Sort patterns by severity
  const severityOrder: Record<string, number> = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
  patterns.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  const uniqueAircraft = new Set(contacts.map((c: any) => c.hex_code));
  const uniqueOperators = new Set(contacts.map((c: any) => c.operator));

  return {
    status: 'COMPLETE',
    timestamp: new Date().toISOString(),
    scan_window_hours: hours,
    total_contacts_analyzed: contacts.length,
    analysis_philosophy: 'EQUAL_TREATMENT',
    patterns_surfaced: patterns.length,
    critical_patterns: patterns.filter(p => p.severity === 'CRITICAL').length,
    high_patterns: patterns.filter(p => p.severity === 'HIGH').length,
    patterns,
    unique_operators: uniqueOperators.size,
    unique_aircraft: uniqueAircraft.size,
    operator_breakdown: Object.fromEntries(
      [...new Set(contacts.map((c: any) => c.operator))].map(op => [
        op,
        contacts.filter((c: any) => c.operator === op).length
      ])
    )
  };
}

async function deepDive(sql: any, identifier: string, days: number) {
  const isHex = /^[a-f0-9]{6}$/i.test(identifier);
  const isTail = /^N[0-9A-Z]{2,5}$/i.test(identifier);

  let contacts;
  if (isHex) {
    contacts = await sql`
      SELECT *, COALESCE(icao_code, icao24, '') as hex_code, COALESCE(registration, '') as tail_number,
        COALESCE(operator, callsign, 'UNKNOWN') as op, COALESCE(altitude::float, 0) as altitude_ft,
        COALESCE(speed::float, 0) as speed_kts
      FROM live_flight_detections_rows
      WHERE (icao_code = ${identifier} OR icao24 = ${identifier})
      AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY COALESCE(detection_timestamp, created_at) ASC LIMIT 2000
    `;
  } else if (isTail) {
    contacts = await sql`
      SELECT *, COALESCE(icao_code, icao24, '') as hex_code, COALESCE(registration, '') as tail_number,
        COALESCE(operator, callsign, 'UNKNOWN') as op, COALESCE(altitude::float, 0) as altitude_ft,
        COALESCE(speed::float, 0) as speed_kts
      FROM live_flight_detections_rows
      WHERE registration = ${identifier}
      AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '1 day' * ${days}
      ORDER BY COALESCE(detection_timestamp, created_at) ASC LIMIT 2000
    `;
  } else {
    return { status: 'INVALID_IDENTIFIER', message: 'Provide a hex code or N-number' };
  }

  if (contacts.length === 0) {
    return { status: 'NO_DATA', aircraft: identifier };
  }

  const altitudes = contacts.map((c: any) => parseFloat(c.altitude_ft || c.altitude_baro || 0)).filter((a: number) => !isNaN(a));
  const speeds = contacts.map((c: any) => parseFloat(c.speed_kts || c.ground_speed || 0)).filter((s: number) => !isNaN(s));

  const physicsViolations = contacts.reduce((count: number, c: any) => count + (validatePhysics(c).length > 0 ? 1 : 0), 0);

  return {
    status: 'COMPLETE',
    aircraft: identifier,
    tail_number: contacts[0].registration || contacts[0].tail_number || identifier,
    operator: contacts[0].operator || 'UNKNOWN',
    analysis_period_days: days,
    total_detections: contacts.length,
    first_seen: contacts[0].timestamp,
    last_seen: contacts[contacts.length - 1].timestamp,
    altitude_stats: {
      mean: altitudes.length ? (altitudes.reduce((a: number, b: number) => a + b, 0) / altitudes.length).toFixed(0) : 0,
      min: altitudes.length ? Math.min(...altitudes) : 0,
      max: altitudes.length ? Math.max(...altitudes) : 0,
    },
    speed_stats: {
      mean: speeds.length ? (speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length).toFixed(0) : 0,
      min: speeds.length ? Math.min(...speeds) : 0,
      max: speeds.length ? Math.max(...speeds) : 0,
    },
    physics_violations: physicsViolations,
    violation_percentage: contacts.length > 0 ? ((physicsViolations / contacts.length) * 100).toFixed(1) : 0,
    legal_exposure: physicsViolations / contacts.length > 0.5 ? 'HIGH' : physicsViolations / contacts.length > 0.2 ? 'MEDIUM' : 'LOW',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, hours, identifier, days } = await req.json();
    const NEON_DATABASE_URL = Deno.env.get('NEON_DATABASE_URL');
    if (!NEON_DATABASE_URL) {
      throw new Error('NEON_DATABASE_URL not configured');
    }

    const sql = postgres(NEON_DATABASE_URL, { ssl: 'require', max: 1 });

    let result;
    try {
      if (action === 'surface') {
        result = await universalSurface(sql, hours || 48);
      } else if (action === 'deep_dive') {
        result = await deepDive(sql, identifier || '', days || 90);
      } else if (action === 'legal_framework') {
        result = { frameworks: LEGAL_FRAMEWORKS };
      } else {
        result = { error: 'Unknown action. Use: surface, deep_dive, legal_framework' };
      }
    } finally {
      await sql.end();
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Universal analyst error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

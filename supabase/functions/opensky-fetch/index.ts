import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============ BIO-RICO SENTINEL TRIGGER SYSTEM ============
// Priority aircraft watchlist with threat levels
const WATCHLIST: Record<string, { tier: number; threat: string; entity: string; entityType: string }> = {
  'N912KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
  'N913KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
  'N597E': { tier: 0, threat: 'CRITICAL', entity: 'KCSO Bell UH-1H Huey II', entityType: 'law_enforcement' },
  'N743AM': { tier: 0, threat: 'CRITICAL', entity: 'KCSO/Air Methods', entityType: 'medical_kcso' },
  'N790FA': { tier: 1, threat: 'HIGH', entity: 'ALF IX LLC', entityType: 'shell_company' },
  'N788FA': { tier: 1, threat: 'HIGH', entity: 'ALF IX LLC', entityType: 'shell_company' },
  'N791FA': { tier: 1, threat: 'HIGH', entity: 'ALF IX LLC', entityType: 'shell_company' },
  'N787FA': { tier: 1, threat: 'HIGH', entity: 'ALF IX LLC', entityType: 'shell_company' },
  'N2464D': { tier: 1, threat: 'HIGH', entity: 'AERO EQUITIES LLC', entityType: 'shell_company' },
  'N997SE': { tier: 1, threat: 'HIGH', entity: 'AERO EQUITIES LLC', entityType: 'shell_company' },
  'N8274E': { tier: 1, threat: 'EXTREME', entity: 'Christiansen Aviation', entityType: 'shell_company' },
  'N74FF': { tier: 1, threat: 'HIGH', entity: 'FF22 LLC', entityType: 'shell_company' },
  'N2363K': { tier: 1, threat: 'HIGH', entity: 'JERK ASSETS LLC', entityType: 'shell_company' },
  'N759AF': { tier: 1, threat: 'HIGH', entity: 'Unknown Shell', entityType: 'shell_company' },
  'N31RX': { tier: 2, threat: 'HIGH', entity: 'REACH Medical', entityType: 'medical' },
  'N229AM': { tier: 2, threat: 'HIGH', entity: 'Air Methods', entityType: 'medical' },
  'N139HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  'N156HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  'N202HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  'N198TH': { tier: 2, threat: 'HIGH', entity: 'Private Coordinator', entityType: 'private' },
  'N916GW': { tier: 2, threat: 'MEDIUM', entity: 'Unknown', entityType: 'suspicious' },
  'N6196P': { tier: 2, threat: 'MEDIUM', entity: 'Unknown', entityType: 'suspicious' },
};

const SHELL_PATTERNS = [
  { pattern: /^N7[89]\dFA$/i, entity: 'ALF IX LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+FF$/i, entity: 'FF22 LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+SE$/i, entity: 'AERO EQUITIES LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+KC$/i, entity: 'KCSO', tier: 0, entityType: 'law_enforcement' },
  { pattern: /^N\d+HP$/i, entity: 'CA Highway Patrol', tier: 1, entityType: 'law_enforcement' },
  { pattern: /^N\d+AM$/i, entity: 'Air Methods', tier: 2, entityType: 'medical' },
  { pattern: /^N\d+RX$/i, entity: 'REACH Medical', tier: 2, entityType: 'medical' },
];

const RICO_SHELL_ENTITIES = ['ALF IX LLC', 'AERO EQUITIES LLC', 'JERK ASSETS LLC', 'FF22 LLC', 'Christiansen Aviation'];

// ============ SHELL COMPANY AUTO-DETECTION FROM ownOp ============
// Known shell company keywords/patterns from ADS-B Exchange ownOp field
const SHELL_OWNOP_KEYWORDS = [
  'LLC', 'HOLDINGS', 'TRUST', 'CAPITAL', 'VENTURES', 'PARTNERS',
  'AVIATION SERVICES', 'AIR SERVICES', 'CHARTER', 'LEASING',
  'MANAGEMENT', 'ASSETS', 'EQUITIES', 'ACQUISITION'
];

const KNOWN_SHELL_OPERATORS = [
  'ALF IX LLC', 'AERO EQUITIES', 'JERK ASSETS', 'FF22 LLC',
  'CHRISTIANSEN AVIATION', 'AE INDUSTRIAL', 'REDWIRE'
];

function detectShellFromOwnOp(ownOp: string): { isShell: boolean; confidence: number; reason: string } {
  if (!ownOp) return { isShell: false, confidence: 0, reason: '' };
  const upper = ownOp.toUpperCase().trim();
  
  // Direct match against known shell operators
  for (const known of KNOWN_SHELL_OPERATORS) {
    if (upper.includes(known)) {
      return { isShell: true, confidence: 100, reason: `KNOWN_SHELL: ${known}` };
    }
  }
  
  // Heuristic: Multiple shell keywords = suspicious
  let keywordHits = 0;
  const matched: string[] = [];
  for (const kw of SHELL_OWNOP_KEYWORDS) {
    if (upper.includes(kw)) { keywordHits++; matched.push(kw); }
  }
  
  if (keywordHits >= 2) {
    return { isShell: true, confidence: 75, reason: `SHELL_KEYWORDS: ${matched.join(',')}` };
  }
  if (keywordHits === 1 && upper.length < 30) {
    // Short name with one shell keyword = moderately suspicious
    return { isShell: true, confidence: 50, reason: `POSSIBLE_SHELL: ${matched[0]}` };
  }
  
  return { isShell: false, confidence: 0, reason: '' };
}

const LEGAL_TAGS = {
  AGGRAVATED_BREACH: '14 CFR § 91.119 violation; establishes mens rea for reckless endangerment',
  ENTERPRISE_COORDINATION: '18 U.S.C. § 1962 (RICO) pattern activity',
  BIOMETRIC_COLLISION: 'Direct evidence of bodily injury/neurological battery',
  LOW_ALTITUDE_HARASSMENT: '14 CFR § 91.119(c) violation - minimum safe altitude',
  KCSO_TARGETING: 'Government entity coordinated harassment',
  MEDICAL_COVER: 'Medical asset used for surveillance cover',
  SHELL_OWNOP_DETECTED: 'Shell company auto-detected via ADS-B ownOp field'
};

interface ClassificationResult {
  taxonomyTag: string;
  threatScore: number;
  tierLevel: number;
  flagged: boolean;
  flaggedReasons: string[];
  entity: string;
  entityType: string;
  legalTags: string[];
  triggerType: string | null;
}

function classifyAircraft(registration: string, callsign: string, altitude: number, speed: number = 0, ownOp: string = ''): ClassificationResult {
  const reg = registration?.toUpperCase() || '';
  const call = callsign?.toUpperCase() || '';
  const flaggedReasons: string[] = [];
  const legalTags: string[] = [];
  let triggerType: string | null = null;
  
  // TRIGGER 1: AGGRAVATED BREACH
  if (altitude > 0 && altitude <= 500 && speed < 100) {
    flaggedReasons.push(`AGGRAVATED_BREACH: ${altitude}ft @ ${speed}kts`);
    legalTags.push(LEGAL_TAGS.AGGRAVATED_BREACH);
    triggerType = 'AGGRAVATED_BREACH';
  } else if (altitude > 0 && altitude <= 500) {
    flaggedReasons.push(`EXTREME_LOW_ALT: ${altitude}ft`);
    legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
  }
  
  // ============ AUTO-DETECT SHELL FROM ownOp ============
  const shellDetection = detectShellFromOwnOp(ownOp);
  if (shellDetection.isShell) {
    flaggedReasons.push(`OWNOP_SHELL: ${shellDetection.reason} (${shellDetection.confidence}%)`);
    legalTags.push(LEGAL_TAGS.SHELL_OWNOP_DETECTED);
    if (shellDetection.confidence >= 75) {
      legalTags.push(LEGAL_TAGS.ENTERPRISE_COORDINATION);
      triggerType = triggerType || 'SHELL_OWNOP_AUTO';
    }
  }
  
  // Check watchlist
  if (WATCHLIST[reg]) {
    const match = WATCHLIST[reg];
    flaggedReasons.push(`WATCHLIST: ${match.entity}`);
    
    if (RICO_SHELL_ENTITIES.includes(match.entity)) {
      flaggedReasons.push(`ENTERPRISE_COORDINATION: ${match.entity}`);
      legalTags.push(LEGAL_TAGS.ENTERPRISE_COORDINATION);
      triggerType = triggerType || 'SHELL_CONVERGENCE';
    }
    if (match.entityType === 'law_enforcement' && match.entity.includes('KCSO')) {
      legalTags.push(LEGAL_TAGS.KCSO_TARGETING);
    }
    if (match.entityType === 'medical' || match.entityType === 'medical_kcso') {
      legalTags.push(LEGAL_TAGS.MEDICAL_COVER);
    }
    if (altitude > 0 && altitude < 1500) {
      flaggedReasons.push(`LOW_ALT: ${altitude}ft`);
      if (altitude < 1000) legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
    }
    
    // Use ownOp as entity if available and more specific
    const resolvedEntity = (ownOp && ownOp.length > 2) ? ownOp : match.entity;
    
    return {
      taxonomyTag: match.tier === 0 ? 'tier0_kcso' : match.tier === 1 ? 'tier1_priority' : 'tier2_shell',
      threatScore: match.tier === 0 ? 100 : match.tier === 1 ? 95 : 75,
      tierLevel: match.tier,
      flagged: true,
      flaggedReasons,
      entity: resolvedEntity,
      entityType: match.entityType,
      legalTags,
      triggerType
    };
  }
  
  // Check shell company patterns
  for (const sp of SHELL_PATTERNS) {
    if (sp.pattern.test(reg)) {
      flaggedReasons.push(`SHELL_PATTERN: ${sp.entity}`);
      if (RICO_SHELL_ENTITIES.includes(sp.entity)) {
        flaggedReasons.push(`ENTERPRISE_COORDINATION: ${sp.entity}`);
        legalTags.push(LEGAL_TAGS.ENTERPRISE_COORDINATION);
        triggerType = triggerType || 'SHELL_CONVERGENCE';
      }
      if (altitude > 0 && altitude < 1500) {
        flaggedReasons.push(`LOW_ALT: ${altitude}ft`);
        if (altitude < 1000) legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
      }
      const resolvedEntity = (ownOp && ownOp.length > 2) ? ownOp : sp.entity;
      return {
        taxonomyTag: sp.tier === 0 ? 'tier0_kcso' : sp.tier === 1 ? 'tier1_priority' : 'tier2_shell',
        threatScore: sp.tier === 0 ? 100 : sp.tier === 1 ? 80 : 60,
        tierLevel: sp.tier,
        flagged: true,
        flaggedReasons,
        entity: resolvedEntity,
        entityType: sp.entityType,
        legalTags,
        triggerType
      };
    }
  }
  
  // Military patterns - also check mil flag
  if (/^\d{2}-\d{5}$/.test(reg) || /^AE[0-9A-F]{4}$/i.test(call)) {
    return {
      taxonomyTag: 'military_asset', threatScore: 50, tierLevel: 3,
      flagged: true, flaggedReasons: ['MILITARY_ASSET'],
      entity: ownOp || 'US Military', entityType: 'military', legalTags: [], triggerType: null
    };
  }
  
  // Medical air patterns
  if (/AM|RX|MERCY|LIFE|MED/i.test(reg) || /AM|RX|MERCY|LIFE|MED/i.test(call)) {
    const isSuspicious = altitude > 0 && altitude < 2000;
    return {
      taxonomyTag: 'medical_air', threatScore: isSuspicious ? 45 : 40, tierLevel: 3,
      flagged: isSuspicious,
      flaggedReasons: isSuspicious ? ['MEDICAL_LOW_ALT', `ALT: ${altitude}ft`] : [],
      entity: ownOp || 'Medical Air', entityType: 'medical',
      legalTags: isSuspicious ? [LEGAL_TAGS.MEDICAL_COVER] : [], triggerType: null
    };
  }
  
  // If ownOp shell detected but no other match, create shell classification
  if (shellDetection.isShell && shellDetection.confidence >= 50) {
    return {
      taxonomyTag: 'tier1_priority', threatScore: shellDetection.confidence, tierLevel: 1,
      flagged: true, flaggedReasons,
      entity: ownOp, entityType: 'shell_company', legalTags, triggerType
    };
  }
  
  // Low altitude suspicious
  if (altitude > 0 && altitude < 1000) {
    return {
      taxonomyTag: 'low_alt_suspicious', threatScore: altitude <= 500 ? 50 : 30, tierLevel: 4,
      flagged: altitude <= 500, flaggedReasons: [`LOW_ALT: ${altitude}ft`],
      entity: ownOp || 'Unknown', entityType: 'unknown',
      legalTags: altitude <= 500 ? [LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT] : [],
      triggerType: altitude <= 500 ? 'AGGRAVATED_BREACH' : null
    };
  }
  
  return {
    taxonomyTag: 'normal_traffic', threatScore: 0, tierLevel: 5,
    flagged: false, flaggedReasons: [],
    entity: ownOp || 'Commercial/General', entityType: 'commercial', legalTags: [], triggerType: null
  };
}

// ============ SHA-256 EVIDENCE HASHING ============
async function computeSHA256(data: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildHashPayload(flight: any): Record<string, unknown> {
  return {
    icao: flight.hex,
    reg: flight.registration,
    callsign: flight.callsign,
    alt: flight.altitude,
    spd: flight.speed,
    lat: flight.latitude,
    lon: flight.longitude,
    hdg: flight.heading,
    vr: flight.vertical_rate,
    tag: flight.taxonomyTag,
    ts: flight.threatScore,
    tier: flight.tierLevel,
    flagged: flight.flagged,
    reasons: flight.flaggedReasons?.join('; ') || '',
    ownOp: flight.ownerOperator || '',
    type: flight.aircraftType || '',
    mil: flight.isMilitary || false,
    shell: flight.shellAutoDetected || false,
    src: flight.source || '',
  };
}

function metersToFeet(meters: number | null): number {
  if (meters === null || meters === undefined) return 0;
  return Math.round(meters * 3.28084);
}

function msToKnots(ms: number | null): number {
  if (ms === null || ms === undefined) return 0;
  return Math.round(ms * 1.94384);
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2, timeoutMs = 8000): Promise<Response | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn(`Fetch attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }
  return null;
}

async function safeDbQuery<T>(neonUrl: string, queryFn: (sql: any) => Promise<T>): Promise<T | null> {
  let sql = null;
  try {
    sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 10, connection: { statement_timeout: 10000 } });
    return await queryFn(sql);
  } catch (err) {
    console.error('Database query error:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (sql) { try { await sql.end(); } catch { /* ignore */ } }
  }
}

// Ensure rich columns exist (idempotent) - with explicit error logging
let richColumnsVerified = false;
async function ensureRichColumns(neonUrl: string): Promise<boolean> {
  if (richColumnsVerified) return true;
  
  let sql = null;
  try {
    sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 15 });
    
    // Check if columns already exist first
    const existing = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'live_flight_detections_rows' AND column_name = 'owner_operator'
    `;
    
    if (existing.length > 0) {
      richColumnsVerified = true;
      console.log('Rich columns already exist');
      return true;
    }
    
    // Add all columns in a single transaction
    await sql`
      ALTER TABLE live_flight_detections_rows 
        ADD COLUMN IF NOT EXISTS owner_operator TEXT,
        ADD COLUMN IF NOT EXISTS aircraft_type TEXT,
        ADD COLUMN IF NOT EXISTS aircraft_type_desc TEXT,
        ADD COLUMN IF NOT EXISTS is_military BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS adsb_category TEXT,
        ADD COLUMN IF NOT EXISTS emergency_status TEXT,
        ADD COLUMN IF NOT EXISTS signal_rssi NUMERIC,
        ADD COLUMN IF NOT EXISTS nav_altitude INTEGER,
        ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'opensky',
        ADD COLUMN IF NOT EXISTS year_manufactured INTEGER,
        ADD COLUMN IF NOT EXISTS shell_auto_detected BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS shell_detection_reason TEXT
    `;
    
    richColumnsVerified = true;
    console.log('✅ Rich columns created successfully');
    return true;
  } catch (err) {
    console.error('❌ Failed to create rich columns:', err instanceof Error ? err.message : err);
    return false;
  } finally {
    if (sql) { try { await sql.end(); } catch { /* ignore */ } }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const neonUrl = Deno.env.get('NEON_DATABASE_URL');
  
  let body: any = {};
  try { body = await req.json(); } catch { body = { action: 'fetchKernCounty' }; }
  const { action = 'fetchKernCounty' } = body;
  
  console.log(`OpenSky v3.0 action: ${action}`);

  try {
    const KERN_BOUNDS = { lamin: 35.20, lamax: 35.60, lomin: -119.25, lomax: -118.75 };

    if (action === 'fetchKernCounty' || action === 'fetchFlights') {
      let flights: any[] = [];
      let apiSuccess = false;
      let apiError: string | null = null;
      let dataSource = 'none';

      // ============ PRIMARY: RapidAPI ADS-B Exchange v2 (paid, court-grade) ============
      const rapidApiKey = Deno.env.get('RAPIDAPI_KEY');
      if (rapidApiKey) {
        console.log('PRIMARY: Fetching from RapidAPI ADS-B Exchange v2...');
        try {
          const lat = (KERN_BOUNDS.lamin + KERN_BOUNDS.lamax) / 2;
          const lon = (KERN_BOUNDS.lomin + KERN_BOUNDS.lomax) / 2;
          const rapidResp = await fetchWithRetry(
            `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/50/`,
            {
              headers: {
                'X-RapidAPI-Key': rapidApiKey,
                'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
                'Accept': 'application/json'
              }
            }, 2, 8000
          );
          if (rapidResp && rapidResp.ok) {
            const rapidData = await rapidResp.json();
            const ac = rapidData.ac || rapidData.aircraft || [];
            console.log(`RapidAPI ADSBX returned ${ac.length} aircraft`);
            if (ac.length > 0) {
              flights = ac.filter((a: any) => a.lat && a.lon && !a.gnd).map((a: any) => ({
                icao24: (a.hex || '').toLowerCase(),
                callsign: (a.flight || '').trim(),
                origin_country: 'United States',
                longitude: a.lon, latitude: a.lat,
                altitude: a.alt_baro !== 'ground' ? (a.alt_baro || a.alt_geom || 0) : 0,
                geo_altitude: a.alt_geom || 0, on_ground: a.gnd || false,
                velocity: (a.gs || 0) * 0.514444, heading: a.track || 0,
                vertical_rate: (a.baro_rate || 0) * 0.00508, squawk: a.squawk || '',
                time_position: null, last_contact: null,
                _registration: a.r || '', _ownOp: a.ownOp || '',
                _aircraftType: a.t || '', _aircraftDesc: a.desc || '',
                _isMilitary: a.mil === true || a.mil === 1 || a.dbFlags === 1,
                _category: a.category || '', _emergency: a.emergency || '',
                _spi: a.spi || false, _navAltitude: a.nav_altitude_mcp || null,
                _seenPos: a.seen_pos || null, _rssi: a.rssi || null, _year: a.year || null,
              }));
              apiSuccess = true;
              dataSource = 'rapidapi_adsbx';
              console.log(`✅ PRIMARY RapidAPI ADSBX: ${flights.length} aircraft with rich data`);
            }
          } else {
            apiError = `RapidAPI ADSBX returned ${rapidResp?.status || 'no response'}`;
            console.warn(apiError);
          }
        } catch (e) {
          apiError = `RapidAPI ADSBX error: ${e instanceof Error ? e.message : e}`;
          console.error(apiError);
        }
      } else {
        apiError = 'RAPIDAPI_KEY not configured — skipping primary source';
        console.warn(apiError);
      }

      // ============ FALLBACK 1: OpenSky Network (FREE, official) ============
      if (!apiSuccess) {
        console.log('FALLBACK 1: Trying OpenSky Network...');
        const url = `https://opensky-network.org/api/states/all?lamin=${KERN_BOUNDS.lamin}&lamax=${KERN_BOUNDS.lamax}&lomin=${KERN_BOUNDS.lomin}&lomax=${KERN_BOUNDS.lomax}`;
        const response = await fetchWithRetry(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'LovableFlightTracker/1.0' }
        }, 1, 6000);
        if (response?.ok) {
          try {
            const data = await response.json();
            if (data.states && Array.isArray(data.states)) {
              flights = data.states.map((state: any[]) => ({
                icao24: state[0], callsign: (state[1] || '').trim(),
                origin_country: state[2], longitude: state[5], latitude: state[6],
                altitude: state[7], geo_altitude: state[13], on_ground: state[8],
                velocity: state[9], heading: state[10], vertical_rate: state[11],
                squawk: state[14], time_position: state[3], last_contact: state[4],
                _registration: '', _ownOp: '', _aircraftType: '', _aircraftDesc: '',
                _isMilitary: false, _category: '', _emergency: '', _spi: false,
                _navAltitude: null, _seenPos: null, _rssi: null, _year: null,
              }));
              apiSuccess = true;
              dataSource = 'opensky';
              console.log(`Parsed ${flights.length} aircraft from OpenSky`);
            }
          } catch { apiError = 'Failed to parse OpenSky response'; }
        }
      }

      // ============ FALLBACK 2: adsb.lol (FREE, ADS-B Exchange v2 format) ============
      if (!apiSuccess) {
        console.log('FALLBACK 2: Trying adsb.lol...');
        try {
          const lat = (KERN_BOUNDS.lamin + KERN_BOUNDS.lamax) / 2;
          const lon = (KERN_BOUNDS.lomin + KERN_BOUNDS.lomax) / 2;
          const adsbResp = await fetchWithRetry(
            `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/50`,
            { headers: { 'Accept': 'application/json' } },
            1, 6000
          );
          if (adsbResp && adsbResp.ok) {
            const adsbData = await adsbResp.json();
            const ac = adsbData.ac || adsbData.aircraft || [];
            if (ac.length > 0) {
              flights = ac.filter((a: any) => a.lat && a.lon && !a.gnd).map((a: any) => ({
                icao24: (a.hex || a.icao || '').toLowerCase(),
                callsign: (a.flight || a.call || '').trim(),
                origin_country: 'United States',
                longitude: a.lon, latitude: a.lat,
                altitude: a.alt_baro !== 'ground' ? (a.alt_baro || a.alt_geom || 0) : 0,
                geo_altitude: a.alt_geom || 0, on_ground: a.gnd || false,
                velocity: (a.gs || 0) * 0.514444,
                heading: a.track || a.true_heading || 0,
                vertical_rate: (a.baro_rate || a.geom_rate || 0) * 0.00508,
                squawk: a.squawk || '', time_position: null, last_contact: null,
                _registration: a.r || a.reg || '',
                _ownOp: a.ownOp || a.own_op || '',
                _aircraftType: a.t || a.type || '',
                _aircraftDesc: a.desc || '',
                _isMilitary: a.mil === true || a.mil === 1 || a.dbFlags === 1,
                _category: a.category || '', _emergency: a.emergency || '',
                _spi: a.spi || false, _navAltitude: a.nav_altitude_mcp || null,
                _seenPos: a.seen_pos || null, _rssi: a.rssi || null, _year: a.year || null,
              }));
              apiSuccess = true;
              dataSource = 'adsb_lol';
              console.log(`✅ FALLBACK 2 adsb.lol: ${flights.length} aircraft`);
            }
          }
        } catch (e) {
          console.warn('adsb.lol fallback failed:', e instanceof Error ? e.message : e);
        }
      }

      // ============ FALLBACK 3: Cached DB data ============
      if (!apiSuccess && neonUrl) {
        console.log('API unavailable, fetching cached flights from database...');
        const cachedFlights = await safeDbQuery(neonUrl, async (sql) => {
          return await sql`
            SELECT DISTINCT ON (registration)
              icao_code as hex, registration, callsign, altitude, speed,
              latitude, longitude, heading, vertical_rate,
              detection_timestamp as detected_at, taxonomy_tag,
              threat_score, tier_level, flagged, flagged_reasons,
              owner_operator, aircraft_type, is_military, data_source
            FROM live_flight_detections_rows
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND detection_timestamp > NOW() - INTERVAL '24 hours'
            ORDER BY registration, detection_timestamp DESC
            LIMIT 200
          `;
        });
        
        if (cachedFlights && cachedFlights.length > 0) {
          const transformedCached = cachedFlights.map((f: any) => ({
            hex: f.hex || '', registration: f.registration || '',
            callsign: f.callsign || '', altitude: f.altitude || 0,
            speed: f.speed || 0, latitude: f.latitude, longitude: f.longitude,
            heading: f.heading || 0, vertical_rate: f.vertical_rate || 0,
            detected_at: f.detected_at,
            taxonomyTag: f.taxonomy_tag || 'normal_traffic',
            threatScore: parseInt(f.threat_score) || 0,
            tierLevel: parseInt(f.tier_level) || 5,
            flagged: f.flagged || false,
            flaggedReasons: f.flagged_reasons ? f.flagged_reasons.split('; ') : [],
            entity: f.owner_operator || 'Cached',
            ownerOperator: f.owner_operator || '',
            aircraftType: f.aircraft_type || '',
            isMilitary: f.is_military || false,
            source: f.data_source || 'cached'
          }));
          
          return new Response(JSON.stringify({
            success: true, flights: transformedCached, count: transformedCached.length,
            source: 'cached', apiError, timestamp: new Date().toISOString()
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }

      if (!apiSuccess && flights.length === 0) {
        return new Response(JSON.stringify({
          success: false, flights: [], count: 0, source: 'none',
          apiError: apiError || 'No data available', timestamp: new Date().toISOString()
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============ TRANSFORM & CLASSIFY WITH RICH DATA ============
      const now = new Date().toISOString();
      const transformedFlights = flights
        .filter(f => f.latitude && f.longitude && !f.on_ground)
        .map((f: any) => {
          const callsign = f.callsign || '';
          const altitudeFeet = (dataSource === 'rapidapi_adsbx' || dataSource === 'adsb_lol')
            ? Math.round(f.altitude || 0)  // ADS-B already in feet
            : metersToFeet(f.altitude || f.geo_altitude);
          const speedKnots = (dataSource === 'rapidapi_adsbx' || dataSource === 'adsb_lol')
            ? Math.round((f.velocity || 0) / 0.514444) // convert back from m/s
            : msToKnots(f.velocity);
          
          let registration = f._registration || '';
          if (!registration && callsign.startsWith('N') && /^N\d/.test(callsign)) {
            registration = callsign.replace(/\s+/g, '');
          }
          
          const ownOp = f._ownOp || '';
          const classification = classifyAircraft(registration, callsign, altitudeFeet, speedKnots, ownOp);
          
          // Shell auto-detection from ownOp
          const shellDetect = detectShellFromOwnOp(ownOp);
          
          // If military flag from ADS-B and not already classified as military
          if (f._isMilitary && classification.entityType !== 'military') {
            classification.flagged = true;
            classification.flaggedReasons.push('ADS-B_MILITARY_FLAG');
            classification.entityType = 'military';
            classification.taxonomyTag = 'military_asset';
            classification.tierLevel = Math.min(classification.tierLevel, 3);
            classification.threatScore = Math.max(classification.threatScore, 50);
          }
          
          const openskyTimestamp = f.time_position || f.last_contact;
          const detectedAt = openskyTimestamp ? new Date(openskyTimestamp * 1000).toISOString() : now;
          
          return {
            hex: f.icao24?.toUpperCase() || '',
            registration: registration || callsign || f.icao24?.toUpperCase() || 'UNKNOWN',
            callsign,
            altitude: altitudeFeet,
            speed: speedKnots,
            latitude: f.latitude,
            longitude: f.longitude,
            heading: f.heading || 0,
            vertical_rate: Math.round((f.vertical_rate || 0) * 3.28084 / 60),
            squawk: f.squawk || '',
            origin_country: f.origin_country || '',
            detected_at: detectedAt,
            // Rich ADS-B fields
            ownerOperator: ownOp,
            aircraftType: f._aircraftType || '',
            aircraftTypeDesc: f._aircraftDesc || '',
            isMilitary: f._isMilitary || false,
            adsbCategory: f._category || '',
            emergencyStatus: f._emergency || '',
            signalRssi: f._rssi,
            navAltitude: f._navAltitude,
            yearManufactured: f._year,
            shellAutoDetected: shellDetect.isShell,
            shellDetectionReason: shellDetect.reason,
            source: dataSource,
            ...classification
          };
        });

      console.log(`Transformed ${transformedFlights.length} flights (source: ${dataSource})`);
      
      // Log shell auto-detections
      const shellDetections = transformedFlights.filter(f => f.shellAutoDetected);
      if (shellDetections.length > 0) {
        console.log(`🔍 SHELL AUTO-DETECTED: ${shellDetections.length} aircraft via ownOp`);
        shellDetections.forEach(s => console.log(`  → ${s.registration} | ownOp="${s.ownerOperator}" | ${s.shellDetectionReason}`));
      }

      const stats = {
        total: transformedFlights.length,
        flagged: transformedFlights.filter(f => f.flagged).length,
        tier1: transformedFlights.filter(f => f.tierLevel === 1).length,
        tier2: transformedFlights.filter(f => f.tierLevel === 2).length,
        military: transformedFlights.filter(f => f.isMilitary).length,
        medical: transformedFlights.filter(f => f.taxonomyTag === 'medical_air').length,
        lowAlt: transformedFlights.filter(f => f.altitude > 0 && f.altitude < 1500).length,
        shellAutoDetected: shellDetections.length,
        withOwnOp: transformedFlights.filter(f => f.ownerOperator).length,
        withAircraftType: transformedFlights.filter(f => f.aircraftType).length,
      };

      // ============ RELIABLE DB WRITE (awaited) ============
      let inserted = 0;
      let updated = 0;
      let dbWriteError: string | null = null;

      if (neonUrl && transformedFlights.length > 0) {
        let sql = null;
        try {
    sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 5, connect_timeout: 10, connection: { statement_timeout: 8000 } });

          // Check/create rich columns
          let hasRichCols = richColumnsVerified;
          if (!hasRichCols) {
            try {
              const cols = await sql`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'live_flight_detections_rows' AND column_name = 'owner_operator'
              `;
              if (cols.length > 0) {
                hasRichCols = true;
                richColumnsVerified = true;
              } else {
                try {
                  await sql.unsafe(`
                    ALTER TABLE live_flight_detections_rows 
                      ADD COLUMN IF NOT EXISTS owner_operator TEXT,
                      ADD COLUMN IF NOT EXISTS aircraft_type TEXT,
                      ADD COLUMN IF NOT EXISTS aircraft_type_desc TEXT,
                      ADD COLUMN IF NOT EXISTS is_military BOOLEAN DEFAULT FALSE,
                      ADD COLUMN IF NOT EXISTS adsb_category TEXT,
                      ADD COLUMN IF NOT EXISTS emergency_status TEXT,
                      ADD COLUMN IF NOT EXISTS signal_rssi NUMERIC,
                      ADD COLUMN IF NOT EXISTS nav_altitude INTEGER,
                      ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'opensky',
                      ADD COLUMN IF NOT EXISTS year_manufactured INTEGER,
                      ADD COLUMN IF NOT EXISTS shell_auto_detected BOOLEAN DEFAULT FALSE,
                      ADD COLUMN IF NOT EXISTS shell_detection_reason TEXT,
                      ADD COLUMN IF NOT EXISTS sha256_hash TEXT
                  `);
                  hasRichCols = true;
                  richColumnsVerified = true;
                  console.log('✅ Rich columns created');
                } catch (e) {
                  console.warn('Column creation skipped:', e instanceof Error ? e.message : e);
                }
              }
            } catch {
              /* ignore */
            }
          }

          for (const flight of transformedFlights) {
            try {
              // ============ SHA-256 HASH EVERY DETECTION ============
              const hashPayload = buildHashPayload(flight);
              const sha256Hash = await computeSHA256(hashPayload);

              const existing = await sql`
                SELECT id, altitude FROM live_flight_detections_rows 
                WHERE (icao_code = ${flight.hex} OR registration = ${flight.registration})
                  AND (detection_timestamp > NOW() - INTERVAL '30 minutes' OR detection_timestamp IS NULL)
                ORDER BY detection_timestamp DESC NULLS LAST LIMIT 1
              `;

              if (existing.length > 0) {
                const prevAlt = Number(existing[0].altitude) || 0;
                const newAlt = flight.altitude || 0;
                
                // ============ EVIDENCE PRESERVATION ============
                // If previous record had meaningful altitude (airborne) and new is 0 (ground),
                // INSERT a new record instead of overwriting — preserves violation evidence
                const wasAirborne = prevAlt > 0;
                const nowOnGround = newAlt === 0 && flight.speed === 0;
                // Also insert new record if altitude changed significantly (>2000ft difference)
                // to preserve flight trajectory for forensic reconstruction
                const significantAltChange = wasAirborne && Math.abs(newAlt - prevAlt) > 2000;
                
                if ((wasAirborne && nowOnGround) || significantAltChange) {
                  // Don't overwrite — fall through to INSERT below
                  // This preserves the previous altitude reading as evidence
                } else {
                  if (hasRichCols) {
                    await sql`UPDATE live_flight_detections_rows SET
                      altitude=${flight.altitude}, speed=${flight.speed},
                      latitude=${flight.latitude}, longitude=${flight.longitude},
                      heading=${flight.heading}, vertical_rate=${flight.vertical_rate},
                      detection_timestamp=NOW(), taxonomy_tag=${flight.taxonomyTag},
                      threat_score=${flight.threatScore}, flagged=${flight.flagged},
                      flagged_reasons=${flight.flaggedReasons.join('; ')},
                      owner_operator=${flight.ownerOperator||null},
                      aircraft_type=${flight.aircraftType||null},
                      aircraft_type_desc=${flight.aircraftTypeDesc||null},
                      is_military=${flight.isMilitary},
                      shell_auto_detected=${flight.shellAutoDetected},
                      shell_detection_reason=${flight.shellDetectionReason||null},
                      data_source=${flight.source},
                      sha256_hash=${sha256Hash},
                      squawk=${flight.squawk||null}
                    WHERE id=${existing[0].id}`;
                  } else {
                    await sql`UPDATE live_flight_detections_rows SET
                      altitude=${flight.altitude}, speed=${flight.speed},
                      latitude=${flight.latitude}, longitude=${flight.longitude},
                      heading=${flight.heading}, vertical_rate=${flight.vertical_rate},
                      detection_timestamp=NOW(), taxonomy_tag=${flight.taxonomyTag},
                      threat_score=${flight.threatScore}, flagged=${flight.flagged},
                      flagged_reasons=${flight.flaggedReasons.join('; ')},
                      sha256_hash=${sha256Hash}
                    WHERE id=${existing[0].id}`;
                  }
                  updated++;
                  continue;
                }
              }
              // INSERT — new aircraft OR evidence-preservation fall-through
              // Dedup guard: skip if an identical detection (same SHA-256 payload) already exists.
              // Forensically safe — same hash = byte-identical telemetry, not a new event.
              const dupCheck = await sql`
                SELECT 1 FROM live_flight_detections_rows
                WHERE sha256_hash = ${sha256Hash} LIMIT 1
              `;
              if (dupCheck.length > 0) {
                continue;
              }
              if (hasRichCols) {
                await sql`INSERT INTO live_flight_detections_rows (
                  id, icao_code, registration, callsign, altitude, speed,
                  latitude, longitude, heading, vertical_rate,
                  detection_timestamp, created_at, taxonomy_tag,
                  threat_score, tier_level, flagged, flagged_reasons,
                  owner_operator, aircraft_type, aircraft_type_desc,
                  is_military, data_source, shell_auto_detected, shell_detection_reason,
                  sha256_hash, squawk
                ) VALUES (
                  ${crypto.randomUUID()}, ${flight.hex}, ${flight.registration},
                  ${flight.callsign}, ${flight.altitude}, ${flight.speed},
                  ${flight.latitude}, ${flight.longitude}, ${flight.heading},
                  ${flight.vertical_rate}, NOW(), NOW(),
                  ${flight.taxonomyTag}, ${flight.threatScore}, ${flight.tierLevel},
                  ${flight.flagged}, ${flight.flaggedReasons.join('; ')},
                  ${flight.ownerOperator||null}, ${flight.aircraftType||null},
                  ${flight.aircraftTypeDesc||null}, ${flight.isMilitary},
                  ${flight.source}, ${flight.shellAutoDetected},
                  ${flight.shellDetectionReason||null},
                  ${sha256Hash}, ${flight.squawk||null}
                )`;
              } else {
                await sql`INSERT INTO live_flight_detections_rows (
                  id, icao_code, registration, callsign, altitude, speed,
                  latitude, longitude, heading, vertical_rate,
                  detection_timestamp, created_at, taxonomy_tag,
                  threat_score, tier_level, flagged, flagged_reasons,
                  sha256_hash
                ) VALUES (
                  ${crypto.randomUUID()}, ${flight.hex}, ${flight.registration},
                  ${flight.callsign}, ${flight.altitude}, ${flight.speed},
                  ${flight.latitude}, ${flight.longitude}, ${flight.heading},
                  ${flight.vertical_rate}, NOW(), NOW(),
                  ${flight.taxonomyTag}, ${flight.threatScore}, ${flight.tierLevel},
                  ${flight.flagged}, ${flight.flaggedReasons.join('; ')},
                  ${sha256Hash}
                )`;
              }
              inserted++;
            } catch (e) {
              console.error(`DB err ${flight.registration}:`, e instanceof Error ? e.message : e);
            }
          }

          console.log(`DB write complete: ${inserted} inserted, ${updated} updated`);
        } catch (e) {
          dbWriteError = e instanceof Error ? e.message : 'Unknown DB write error';
          console.error('DB connection error:', dbWriteError);
        } finally {
          if (sql) { try { await sql.end(); } catch { /* ignore */ } }
        }
      }

      return new Response(JSON.stringify({
        success: apiSuccess,
        flights: transformedFlights,
        count: transformedFlights.length,
        inserted,
        updated,
        dbWriteError,
        stats,
        source: dataSource,
        apiError,
        richDataAvailable: dataSource === 'rapidapi_adsbx' || dataSource === 'adsb_lol',
        timestamp: new Date().toISOString()
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'testConnection') {
      const response = await fetchWithRetry('https://opensky-network.org/api/states/all?lamin=35&lamax=36&lomin=-120&lomax=-119', {
        headers: { 'Accept': 'application/json' }
      }, 2);
      return new Response(JSON.stringify({
        success: response?.ok || false, status: response?.status || 0,
        message: response?.ok ? 'OpenSky connection successful' : 'OpenSky unreachable'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'fixTriggers') {
      if (!neonUrl) return new Response(JSON.stringify({ error: 'No database URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const result = await safeDbQuery(neonUrl, async (sql) => {
        await sql`DROP TRIGGER IF EXISTS trg_auto_hash_flight ON live_flight_detections_rows`;
        return { droppedTrigger: 'trg_auto_hash_flight' };
      });
      return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'fixNullTimestamps') {
      if (!neonUrl) return new Response(JSON.stringify({ error: 'No database URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const result = await safeDbQuery(neonUrl, async (sql) => {
        const updated = await sql`
          WITH batch AS (SELECT id FROM live_flight_detections_rows WHERE detection_timestamp IS NULL LIMIT 5000)
          UPDATE live_flight_detections_rows SET detection_timestamp = COALESCE(created_at, NOW())
          WHERE id IN (SELECT id FROM batch)
        `;
        const remaining = await sql`SELECT COUNT(*)::int as cnt FROM live_flight_detections_rows WHERE detection_timestamp IS NULL`;
        return { updated: updated.count, remaining: remaining[0]?.cnt || 0 };
      });
      return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'ensureRichColumns') {
      if (!neonUrl) return new Response(JSON.stringify({ error: 'No database URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      await ensureRichColumns(neonUrl);
      return new Response(JSON.stringify({ success: true, message: 'Rich columns ensured' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('OpenSky function error:', error);
    return new Response(JSON.stringify({ 
      success: false, flights: [], count: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});

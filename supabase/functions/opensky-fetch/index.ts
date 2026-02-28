import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// OpenSky Network API - FREE, no API key required for anonymous access
// Rate limits: 400 API credits/day for anonymous, 4000/day for registered users
// https://openskynetwork.github.io/opensky-api/rest.html

// ============ BIO-RICO SENTINEL TRIGGER SYSTEM ============
// Three automated triggers for legal-ready evidence generation:
// 1. AGGRAVATED_BREACH: <500ft + <100kts = CRITICAL_ENDANGERMENT
// 2. SHELL_CONVERGENCE: ALF IX LLC, AERO EQUITIES, JERK ASSETS = ENTERPRISE_COORDINATION
// 3. BIOMETRIC_COLLISION: Checked separately with ±3 min window

// Priority aircraft watchlist with threat levels
const WATCHLIST: Record<string, { tier: number; threat: string; entity: string; entityType: string }> = {
  // KCSO ASSETS (Tier 0 - APEX) - All KCSO helicopters
  'N912KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
  'N913KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
  'N597E': { tier: 0, threat: 'CRITICAL', entity: 'KCSO Bell UH-1H Huey II', entityType: 'law_enforcement' },
  'N743AM': { tier: 0, threat: 'CRITICAL', entity: 'KCSO/Air Methods', entityType: 'medical_kcso' },
  
  // SHELL NETWORK (Tier 1 - RICO Enterprise)
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
  
  // MEDICAL ASSETS (Tier 2 - Cover Operations)
  'N31RX': { tier: 2, threat: 'HIGH', entity: 'REACH Medical', entityType: 'medical' },
  'N229AM': { tier: 2, threat: 'HIGH', entity: 'Air Methods', entityType: 'medical' },
  
  // LAW ENFORCEMENT (Tier 1)
  'N139HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  'N156HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  'N202HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol', entityType: 'law_enforcement' },
  
  // PRIVATE COORDINATORS (Tier 2)
  'N198TH': { tier: 2, threat: 'HIGH', entity: 'Private Coordinator', entityType: 'private' },
  'N916GW': { tier: 2, threat: 'MEDIUM', entity: 'Unknown', entityType: 'suspicious' },
  'N6196P': { tier: 2, threat: 'MEDIUM', entity: 'Unknown', entityType: 'suspicious' },
};

// Shell company registration patterns (expanded)
const SHELL_PATTERNS = [
  { pattern: /^N7[89]\dFA$/i, entity: 'ALF IX LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+FF$/i, entity: 'FF22 LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+SE$/i, entity: 'AERO EQUITIES LLC', tier: 1, entityType: 'shell_company' },
  { pattern: /^N\d+KC$/i, entity: 'KCSO', tier: 0, entityType: 'law_enforcement' },
  { pattern: /^N\d+HP$/i, entity: 'CA Highway Patrol', tier: 1, entityType: 'law_enforcement' },
  { pattern: /^N\d+AM$/i, entity: 'Air Methods', tier: 2, entityType: 'medical' },
  { pattern: /^N\d+RX$/i, entity: 'REACH Medical', tier: 2, entityType: 'medical' },
];

// RICO Shell Entity List for ENTERPRISE_COORDINATION trigger
const RICO_SHELL_ENTITIES = [
  'ALF IX LLC',
  'AERO EQUITIES LLC', 
  'JERK ASSETS LLC',
  'FF22 LLC',
  'Christiansen Aviation'
];

// Legal tags for automated evidence categorization
const LEGAL_TAGS = {
  AGGRAVATED_BREACH: '14 CFR § 91.119 violation; establishes mens rea for reckless endangerment',
  ENTERPRISE_COORDINATION: '18 U.S.C. § 1962 (RICO) pattern activity',
  BIOMETRIC_COLLISION: 'Direct evidence of bodily injury/neurological battery',
  LOW_ALTITUDE_HARASSMENT: '14 CFR § 91.119(c) violation - minimum safe altitude',
  KCSO_TARGETING: 'Government entity coordinated harassment',
  MEDICAL_COVER: 'Medical asset used for surveillance cover'
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

function classifyAircraft(registration: string, callsign: string, altitude: number, speed: number = 0): ClassificationResult {
  const reg = registration?.toUpperCase() || '';
  const call = callsign?.toUpperCase() || '';
  const flaggedReasons: string[] = [];
  const legalTags: string[] = [];
  let triggerType: string | null = null;
  
  // ============ TRIGGER 1: AGGRAVATED BREACH ============
  // Threshold: Altitude < 500 ft AND Speed < 100 kts
  // Action: CRITICAL_ENDANGERMENT
  // Changed from < 500 to <= 500 to catch boundary condition (500ft is still violation)
  if (altitude > 0 && altitude <= 500 && speed < 100) {
    flaggedReasons.push(`AGGRAVATED_BREACH: ${altitude}ft @ ${speed}kts`);
    legalTags.push(LEGAL_TAGS.AGGRAVATED_BREACH);
    triggerType = 'AGGRAVATED_BREACH';
  } else if (altitude > 0 && altitude <= 500) {
    flaggedReasons.push(`EXTREME_LOW_ALT: ${altitude}ft`);
    legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
  }
  
  // Check watchlist first (KCSO, Shell, Medical assets)
  if (WATCHLIST[reg]) {
    const match = WATCHLIST[reg];
    flaggedReasons.push(`WATCHLIST: ${match.entity}`);
    
    // ============ TRIGGER 2: SHELL ENTITY CONVERGENCE ============
    if (RICO_SHELL_ENTITIES.includes(match.entity)) {
      flaggedReasons.push(`ENTERPRISE_COORDINATION: ${match.entity}`);
      legalTags.push(LEGAL_TAGS.ENTERPRISE_COORDINATION);
      triggerType = triggerType || 'SHELL_CONVERGENCE';
    }
    
    // KCSO-specific tagging
    if (match.entityType === 'law_enforcement' && match.entity.includes('KCSO')) {
      legalTags.push(LEGAL_TAGS.KCSO_TARGETING);
    }
    
    // Medical cover detection
    if (match.entityType === 'medical' || match.entityType === 'medical_kcso') {
      legalTags.push(LEGAL_TAGS.MEDICAL_COVER);
    }
    
    if (altitude > 0 && altitude < 1500) {
      flaggedReasons.push(`LOW_ALT: ${altitude}ft`);
      if (altitude < 1000) legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
    }
    
    return {
      taxonomyTag: match.tier === 0 ? 'tier0_kcso' : match.tier === 1 ? 'tier1_priority' : 'tier2_shell',
      threatScore: match.tier === 0 ? 100 : match.tier === 1 ? 95 : 75,
      tierLevel: match.tier,
      flagged: true,
      flaggedReasons,
      entity: match.entity,
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
      
      return {
        taxonomyTag: sp.tier === 0 ? 'tier0_kcso' : sp.tier === 1 ? 'tier1_priority' : 'tier2_shell',
        threatScore: sp.tier === 0 ? 100 : sp.tier === 1 ? 80 : 60,
        tierLevel: sp.tier,
        flagged: true,
        flaggedReasons,
        entity: sp.entity,
        entityType: sp.entityType,
        legalTags,
        triggerType
      };
    }
  }
  
  // Military patterns
  if (/^\d{2}-\d{5}$/.test(reg) || /^AE[0-9A-F]{4}$/i.test(call)) {
    return {
      taxonomyTag: 'military_asset',
      threatScore: 50,
      tierLevel: 3,
      flagged: true,
      flaggedReasons: ['MILITARY_ASSET'],
      entity: 'US Military',
      entityType: 'military',
      legalTags: [],
      triggerType: null
    };
  }
  
  // Medical air patterns (may be cover operations)
  if (/AM|RX|MERCY|LIFE|MED/i.test(reg) || /AM|RX|MERCY|LIFE|MED/i.test(call)) {
    // Flag medical assets at low altitude as potential cover
    const isSuspicious = altitude > 0 && altitude < 2000;
    return {
      taxonomyTag: 'medical_air',
      threatScore: isSuspicious ? 45 : 40,
      tierLevel: 3,
      flagged: isSuspicious,
      flaggedReasons: isSuspicious ? ['MEDICAL_LOW_ALT', `ALT: ${altitude}ft`] : [],
      entity: 'Medical Air',
      entityType: 'medical',
      legalTags: isSuspicious ? [LEGAL_TAGS.MEDICAL_COVER] : [],
      triggerType: null
    };
  }
  
  // Low altitude suspicious (any unknown aircraft below 1000ft)
  // Changed < 500 to <= 500 to catch 500ft boundary condition
  if (altitude > 0 && altitude < 1000) {
    return {
      taxonomyTag: 'low_alt_suspicious',
      threatScore: altitude <= 500 ? 50 : 30,
      tierLevel: 4,
      flagged: altitude <= 500, // Flag extreme low altitude including 500ft boundary
      flaggedReasons: [`LOW_ALT: ${altitude}ft`],
      entity: 'Unknown',
      entityType: 'unknown',
      legalTags: altitude <= 500 ? [LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT] : [],
      triggerType: altitude <= 500 ? 'AGGRAVATED_BREACH' : null
    };
  }
  
  // Default: live tracking
  return {
    taxonomyTag: 'normal_traffic',
    threatScore: 0,
    tierLevel: 5,
    flagged: false,
    flaggedReasons: [],
    entity: 'Commercial/General',
    entityType: 'commercial',
    legalTags: [],
    triggerType: null
  };
}

// Convert meters to feet
function metersToFeet(meters: number | null): number {
  if (meters === null || meters === undefined) return 0;
  return Math.round(meters * 3.28084);
}

// Convert m/s to knots
function msToKnots(ms: number | null): number {
  if (ms === null || ms === undefined) return 0;
  return Math.round(ms * 1.94384);
}

// Retry helper with exponential backoff
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn(`Fetch attempt ${attempt}/${maxRetries} failed: ${errorMsg}`);
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return null;
}

// Safe database query helper
async function safeDbQuery<T>(neonUrl: string, queryFn: (sql: any) => Promise<T>): Promise<T | null> {
  let sql = null;
  try {
    sql = postgres(neonUrl, { 
      ssl: 'require', 
      max: 1, 
      idle_timeout: 5, 
      connect_timeout: 10 
    });
    const result = await queryFn(sql);
    return result;
  } catch (err) {
    console.error('Database query error:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (sql) {
      try { await sql.end(); } catch { /* ignore */ }
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const neonUrl = Deno.env.get('NEON_DATABASE_URL');
  
  // Safe JSON parse
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = { action: 'fetchKernCounty' };
  }
  
  const { action = 'fetchKernCounty' } = body;
  
  console.log(`OpenSky Network action: ${action}`);

  try {
    // Bakersfield/Oildale tightly focused bounding box
    // Oildale: ~35.43°N, 119.02°W  |  Bakersfield: ~35.37°N, 119.02°W
    // Box: ~15mi radius centered on Oildale to catch low-altitude surveillance
    const KERN_BOUNDS = {
      lamin: 35.20,
      lamax: 35.60,
      lomin: -119.25,
      lomax: -118.75
    };

    if (action === 'fetchKernCounty' || action === 'fetchFlights') {
      const url = `https://opensky-network.org/api/states/all?lamin=${KERN_BOUNDS.lamin}&lamax=${KERN_BOUNDS.lamax}&lomin=${KERN_BOUNDS.lomin}&lomax=${KERN_BOUNDS.lomax}`;
      
      console.log('Fetching flights from OpenSky Network (Kern County)...');
      
      let flights: any[] = [];
      let apiSuccess = false;
      let apiError: string | null = null;
      
      // Try OpenSky API with retry
      const response = await fetchWithRetry(url, {
        headers: { 
          'Accept': 'application/json',
          'User-Agent': 'LovableFlightTracker/1.0'
        }
      }, 2);
      
      if (response) {
        console.log(`OpenSky response status: ${response.status}`);
        
        if (response.ok) {
          try {
            const data = await response.json();
            console.log(`OpenSky returned time: ${data.time}, states count: ${data.states?.length || 0}`);
            
            if (data.states && Array.isArray(data.states)) {
              flights = data.states.map((state: any[]) => ({
                icao24: state[0],
                callsign: (state[1] || '').trim(),
                origin_country: state[2],
                longitude: state[5],
                latitude: state[6],
                altitude: state[7],
                geo_altitude: state[13],
                on_ground: state[8],
                velocity: state[9],
                heading: state[10],
                vertical_rate: state[11],
                squawk: state[14],
                time_position: state[3],
                last_contact: state[4]
              }));
              
              apiSuccess = true;
              console.log(`Parsed ${flights.length} aircraft from OpenSky`);
            } else {
              flights = [];
              apiSuccess = true;
            }
          } catch (parseErr) {
            apiError = 'Failed to parse OpenSky response';
            console.error(apiError);
          }
        } else if (response.status === 429) {
          apiError = 'OpenSky rate limit exceeded';
        } else {
          apiError = `OpenSky API returned ${response.status}`;
        }
      } else {
        apiError = 'OpenSky API unreachable after retries';
      }
      
      // ============ FALLBACK 1: RapidAPI ADS-B Exchange ============
      if (!apiSuccess) {
        const rapidApiKey = Deno.env.get('RAPIDAPI_KEY');
        if (rapidApiKey) {
          console.log('OpenSky failed, trying RapidAPI ADS-B Exchange...');
          try {
            // ADS-B Exchange v2 - search by geographic bounds
            const lat = (KERN_BOUNDS.lamin + KERN_BOUNDS.lamax) / 2;
            const lon = (KERN_BOUNDS.lomin + KERN_BOUNDS.lomax) / 2;
            const dist = 50; // ~50 nautical miles radius covers the bounding box
            
            const rapidResp = await fetchWithRetry(
              `https://adsbexchange-com1.p.rapidapi.com/v2/lat/${lat}/lon/${lon}/dist/${dist}/`,
              {
                headers: {
                  'X-RapidAPI-Key': rapidApiKey,
                  'X-RapidAPI-Host': 'adsbexchange-com1.p.rapidapi.com',
                  'Accept': 'application/json'
                }
              },
              2
            );

            if (rapidResp && rapidResp.ok) {
              const rapidData = await rapidResp.json();
              const ac = rapidData.ac || rapidData.aircraft || [];
              console.log(`RapidAPI returned ${ac.length} aircraft`);
              
              if (ac.length > 0) {
                flights = ac
                  .filter((a: any) => a.lat && a.lon && !a.gnd)
                  .map((a: any) => ({
                    icao24: (a.hex || a.icao || '').toLowerCase(),
                    callsign: (a.flight || a.call || '').trim(),
                    origin_country: 'United States',
                    longitude: a.lon,
                    latitude: a.lat,
                    altitude: a.alt_baro !== 'ground' ? (a.alt_baro || a.alt_geom || 0) : 0,
                    geo_altitude: a.alt_geom || 0,
                    on_ground: a.gnd || false,
                    velocity: (a.gs || 0) * 0.514444, // knots to m/s for consistent processing
                    heading: a.track || a.true_heading || 0,
                    vertical_rate: (a.baro_rate || a.geom_rate || 0) * 0.00508, // fpm to m/s
                    squawk: a.squawk || '',
                    time_position: null,
                    last_contact: null,
                    // ADS-B Exchange provides registration directly
                    _registration: a.r || a.reg || ''
                  }));
                apiSuccess = true;
                apiError = null;
                console.log(`✅ RapidAPI ADS-B Exchange: ${flights.length} valid aircraft`);
              }
            } else {
              const status = rapidResp?.status || 'no response';
              console.warn(`RapidAPI returned ${status}`);
            }
          } catch (rapidErr) {
            console.error('RapidAPI fallback error:', rapidErr instanceof Error ? rapidErr.message : rapidErr);
          }
        }
      }

      // ============ FALLBACK 2: Cached DB data ============
      if (!apiSuccess && neonUrl) {
        console.log('API unavailable, fetching cached flights from database...');
        
        const cachedFlights = await safeDbQuery(neonUrl, async (sql) => {
          return await sql`
            SELECT DISTINCT ON (registration)
              icao_code as hex, registration, callsign, altitude, speed,
              latitude, longitude, heading, vertical_rate,
              detection_timestamp as detected_at, taxonomy_tag,
              threat_score, tier_level, flagged, flagged_reasons
            FROM live_flight_detections_rows
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              AND detection_timestamp > NOW() - INTERVAL '2 hours'
            ORDER BY registration, detection_timestamp DESC
            LIMIT 200
          `;
        });
        
        if (cachedFlights && cachedFlights.length > 0) {
          const transformedCached = cachedFlights.map((f: any) => ({
            hex: f.hex || '',
            registration: f.registration || '',
            callsign: f.callsign || '',
            altitude: f.altitude || 0,
            speed: f.speed || 0,
            latitude: f.latitude,
            longitude: f.longitude,
            heading: f.heading || 0,
            vertical_rate: f.vertical_rate || 0,
            detected_at: f.detected_at,
            taxonomyTag: f.taxonomy_tag || 'normal_traffic',
            threatScore: parseInt(f.threat_score) || 0,
            tierLevel: parseInt(f.tier_level) || 5,
            flagged: f.flagged || false,
            flaggedReasons: f.flagged_reasons ? f.flagged_reasons.split('; ') : [],
            entity: 'Cached'
          }));
          
          return new Response(
            JSON.stringify({
              success: true,
              flights: transformedCached,
              count: transformedCached.length,
              source: 'cached',
              apiError,
              timestamp: new Date().toISOString()
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // Return empty result if both API and cache failed (don't throw 500)
      if (!apiSuccess && flights.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            flights: [],
            count: 0,
            source: 'none',
            apiError: apiError || 'No data available',
            timestamp: new Date().toISOString()
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Transform and classify flights
      const now = new Date().toISOString();
      const transformedFlights = flights
        .filter(f => f.latitude && f.longitude && !f.on_ground)
        .map((f: any) => {
          const callsign = f.callsign || '';
          const altitudeFeet = metersToFeet(f.altitude || f.geo_altitude);
          const speedKnots = msToKnots(f.velocity);
          
          // Use direct registration from ADS-B Exchange if available
          let registration = f._registration || '';
          if (!registration && callsign.startsWith('N') && /^N\d/.test(callsign)) {
            registration = callsign.replace(/\s+/g, '');
          }
          
          const classification = classifyAircraft(registration, callsign, altitudeFeet, speedKnots);
          
          const openskyTimestamp = f.time_position || f.last_contact;
          const detectedAt = openskyTimestamp 
            ? new Date(openskyTimestamp * 1000).toISOString()
            : now;
          
          return {
            hex: f.icao24?.toUpperCase() || '',
            registration: registration || callsign || f.icao24?.toUpperCase() || 'UNKNOWN',
            callsign: callsign,
            altitude: altitudeFeet,
            speed: speedKnots,
            latitude: f.latitude,
            longitude: f.longitude,
            heading: f.heading || 0,
            vertical_rate: Math.round((f.vertical_rate || 0) * 3.28084 / 60),
            squawk: f.squawk || '',
            origin_country: f.origin_country || '',
            detected_at: detectedAt,
            ...classification
          };
        });

      console.log(`Transformed ${transformedFlights.length} valid flights`);

      // Store in database (fire and forget, don't fail if DB is unavailable)
      let inserted = 0;
      let updated = 0;
      if (neonUrl && transformedFlights.length > 0) {
        const insertResult = await safeDbQuery(neonUrl, async (sql) => {
          let newCount = 0;
          let upCount = 0;
          for (const flight of transformedFlights) {
            try {
              // Check for existing record (handle NULL timestamps too)
              const existing = await sql`
                SELECT id FROM live_flight_detections_rows 
                WHERE (icao_code = ${flight.hex} OR registration = ${flight.registration})
                  AND (detection_timestamp > NOW() - INTERVAL '30 minutes' OR detection_timestamp IS NULL)
                ORDER BY detection_timestamp DESC NULLS LAST
                LIMIT 1
              `;
              
              if (existing.length > 0) {
                // UPDATE existing record with fresh position/timestamp
                await sql`
                  UPDATE live_flight_detections_rows
                  SET altitude = ${flight.altitude},
                      speed = ${flight.speed},
                      latitude = ${flight.latitude},
                      longitude = ${flight.longitude},
                      heading = ${flight.heading},
                      vertical_rate = ${flight.vertical_rate},
                      detection_timestamp = NOW(),
                      taxonomy_tag = ${flight.taxonomyTag},
                      threat_score = ${flight.threatScore},
                      flagged = ${flight.flagged},
                      flagged_reasons = ${flight.flaggedReasons.join('; ')}
                  WHERE id = ${existing[0].id}
                `;
                upCount++;
              } else {
                // INSERT new record
                await sql`
                  INSERT INTO live_flight_detections_rows (
                    id, icao_code, registration, callsign, altitude, speed,
                    latitude, longitude, heading, vertical_rate,
                    detection_timestamp, created_at, taxonomy_tag,
                    threat_score, tier_level, flagged, flagged_reasons
                  ) VALUES (
                    ${crypto.randomUUID()},
                    ${flight.hex},
                    ${flight.registration},
                    ${flight.callsign},
                    ${flight.altitude},
                    ${flight.speed},
                    ${flight.latitude},
                    ${flight.longitude},
                    ${flight.heading},
                    ${flight.vertical_rate},
                    NOW(),
                    NOW(),
                    ${flight.taxonomyTag},
                    ${flight.threatScore},
                    ${flight.tierLevel},
                    ${flight.flagged},
                    ${flight.flaggedReasons.join('; ')}
                  )
                `;
                newCount++;
              }

              if (flight.flagged) {
                console.log(`🚨 FLAGGED: ${flight.registration} - ${flight.flaggedReasons.join(', ')}`);
              }
            } catch (insertErr) {
              console.error(`DB error for ${flight.registration}:`, insertErr instanceof Error ? insertErr.message : insertErr);
            }
          }
          return { newCount, upCount };
        });
        
        inserted = insertResult?.newCount || 0;
        updated = insertResult?.upCount || 0;
        console.log(`Inserted ${inserted} new, updated ${updated} existing flights`);
      }

      const stats = {
        total: transformedFlights.length,
        flagged: transformedFlights.filter(f => f.flagged).length,
        tier1: transformedFlights.filter(f => f.tierLevel === 1).length,
        tier2: transformedFlights.filter(f => f.tierLevel === 2).length,
        military: transformedFlights.filter(f => f.taxonomyTag === 'military_asset').length,
        medical: transformedFlights.filter(f => f.taxonomyTag === 'medical_air').length,
        lowAlt: transformedFlights.filter(f => f.altitude > 0 && f.altitude < 1500).length
      };

      // Determine which source provided the data
      const dataSource = flights.length > 0 && flights[0]._registration !== undefined ? 'rapidapi_adsb' : 'opensky';

      return new Response(
        JSON.stringify({
          success: apiSuccess,
          flights: transformedFlights,
          count: transformedFlights.length,
          inserted,
          updated,
          stats,
          source: dataSource,
          apiError,
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'testConnection') {
      const response = await fetchWithRetry('https://opensky-network.org/api/states/all?lamin=35&lamax=36&lomin=-120&lomax=-119', {
        headers: { 'Accept': 'application/json' }
      }, 2);
      
      return new Response(
        JSON.stringify({
          success: response?.ok || false,
          status: response?.status || 0,
          message: response?.ok ? 'OpenSky Network connection successful' : 'OpenSky unreachable'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'fixTriggers') {
      if (!neonUrl) {
        return new Response(JSON.stringify({ error: 'No database URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const result = await safeDbQuery(neonUrl, async (sql) => {
        await sql`DROP TRIGGER IF EXISTS trg_auto_hash_flight ON live_flight_detections_rows`;
        return { droppedTrigger: 'trg_auto_hash_flight' };
      });
      return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'fixNullTimestamps') {
      if (!neonUrl) {
        return new Response(JSON.stringify({ error: 'No database URL' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const result = await safeDbQuery(neonUrl, async (sql) => {
        // Fix in batches of 5000 to avoid timeout
        const updated = await sql`
          WITH batch AS (
            SELECT id FROM live_flight_detections_rows WHERE detection_timestamp IS NULL LIMIT 5000
          )
          UPDATE live_flight_detections_rows SET detection_timestamp = COALESCE(created_at, NOW())
          WHERE id IN (SELECT id FROM batch)
        `;
        const remaining = await sql`SELECT COUNT(*)::int as cnt FROM live_flight_detections_rows WHERE detection_timestamp IS NULL`;
        return { updated: updated.count, remaining: remaining[0]?.cnt || 0 };
      });
      return new Response(JSON.stringify({ success: true, result }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OpenSky function error:', error);
    // Always return valid JSON, never 500 for network issues
    return new Response(
      JSON.stringify({ 
        success: false,
        flights: [],
        count: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

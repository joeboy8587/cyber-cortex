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
      taxonomyTag: match.tier === 0 ? 'xxb_tier0_kcso' : match.tier === 1 ? 'xxb_tier1_priority' : 'xxb_tier2_shell',
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
        taxonomyTag: sp.tier === 0 ? 'xxb_tier0_kcso' : sp.tier === 1 ? 'xxb_tier1_priority' : 'xxb_tier2_shell',
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
      taxonomyTag: 'xxb_military',
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
      taxonomyTag: 'xxb_medical_air',
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
      taxonomyTag: 'xxb_low_alt_suspicious',
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
    taxonomyTag: 'xxb_live',
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
    // Kern County bounding box (expanded to catch more aircraft)
    const KERN_BOUNDS = {
      lamin: 34.5,
      lamax: 36.5,
      lomin: -120.5,
      lomax: -117.5
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
      
      // Fallback to cached data if API failed
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
            taxonomyTag: f.taxonomy_tag || 'xxb_live',
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
          
          let registration = '';
          if (callsign.startsWith('N') && /^N\d/.test(callsign)) {
            registration = callsign.replace(/\s+/g, '');
          }
          
          const classification = classifyAircraft(registration, callsign, altitudeFeet);
          
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
      if (neonUrl && transformedFlights.length > 0) {
        const insertResult = await safeDbQuery(neonUrl, async (sql) => {
          let count = 0;
          for (const flight of transformedFlights) {
            try {
              const existing = await sql`
                SELECT id FROM live_flight_detections_rows 
                WHERE (icao_code = ${flight.hex} OR registration = ${flight.registration})
                  AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                LIMIT 1
              `;
              
              if (existing.length > 0) continue;
              
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
              
              count++;
              if (flight.flagged) {
                console.log(`🚨 FLAGGED: ${flight.registration} - ${flight.flaggedReasons.join(', ')}`);
              }
            } catch {
              // Skip individual insert errors
            }
          }
          return count;
        });
        
        inserted = insertResult || 0;
        console.log(`Inserted ${inserted} new flights into database`);
      }

      const stats = {
        total: transformedFlights.length,
        flagged: transformedFlights.filter(f => f.flagged).length,
        tier1: transformedFlights.filter(f => f.tierLevel === 1).length,
        tier2: transformedFlights.filter(f => f.tierLevel === 2).length,
        military: transformedFlights.filter(f => f.taxonomyTag === 'xxb_military').length,
        medical: transformedFlights.filter(f => f.taxonomyTag === 'xxb_medical_air').length,
        lowAlt: transformedFlights.filter(f => f.altitude > 0 && f.altitude < 1500).length
      };

      return new Response(
        JSON.stringify({
          success: apiSuccess,
          flights: transformedFlights,
          count: transformedFlights.length,
          inserted,
          stats,
          source: 'opensky',
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

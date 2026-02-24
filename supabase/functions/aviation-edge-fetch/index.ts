import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Retry helper for transient network failures
async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15000)
      });
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTransient = lastError.message.includes('connection') ||
                          lastError.message.includes('network') ||
                          lastError.message.includes('timeout') ||
                          lastError.message.includes('ECONNRESET') ||
                          lastError.message.includes('lost');
      if (isTransient && attempt < maxRetries) {
        console.warn(`Fetch attempt ${attempt}/${maxRetries} failed, retrying in ${200 * attempt}ms...`);
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

// ============ BIO-RICO SENTINEL TRIGGER SYSTEM ============
// Three automated triggers for legal-ready evidence generation:
// 1. AGGRAVATED_BREACH: <500ft + <100kts = CRITICAL_ENDANGERMENT
// 2. SHELL_CONVERGENCE: ALF IX LLC, AERO EQUITIES, JERK ASSETS = ENTERPRISE_COORDINATION
// 3. BIOMETRIC_COLLISION: Checked separately with ±3 min window

// Priority aircraft watchlist with threat levels
const WATCHLIST: Record<string, { tier: number; threat: string; entity: string; entityType: string }> = {
  // KCSO ASSETS (Tier 0 - APEX)
  'N912KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
  'N913KC': { tier: 0, threat: 'CRITICAL', entity: 'KCSO', entityType: 'law_enforcement' },
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
  if (altitude > 0 && altitude < 500 && speed < 100) {
    flaggedReasons.push(`AGGRAVATED_BREACH: ${altitude}ft @ ${speed}kts`);
    legalTags.push(LEGAL_TAGS.AGGRAVATED_BREACH);
    triggerType = 'AGGRAVATED_BREACH';
  } else if (altitude > 0 && altitude < 500) {
    flaggedReasons.push(`EXTREME_LOW_ALT: ${altitude}ft`);
    legalTags.push(LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT);
  }
  
  // Check watchlist first
  if (WATCHLIST[reg]) {
    const match = WATCHLIST[reg];
    flaggedReasons.push(`WATCHLIST: ${match.entity}`);
    
    // ============ TRIGGER 2: SHELL ENTITY CONVERGENCE ============
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
  if (/^\d{2}-\d{5}$/.test(reg)) {
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
  
  // Medical air patterns
  if (/AM|RX|MERCY|LIFE|MED/i.test(reg) || /AM|RX|MERCY|LIFE|MED/i.test(call)) {
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
  
  // Low altitude suspicious
  if (altitude > 0 && altitude < 1000) {
    return {
      taxonomyTag: 'low_alt_suspicious',
      threatScore: altitude < 500 ? 50 : 30,
      tierLevel: 4,
      flagged: altitude < 500,
      flaggedReasons: [`LOW_ALT: ${altitude}ft`],
      entity: 'Unknown',
      entityType: 'unknown',
      legalTags: altitude < 500 ? [LEGAL_TAGS.LOW_ALTITUDE_HARASSMENT] : [],
      triggerType: altitude < 500 ? 'AGGRAVATED_BREACH' : null
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('AVIATION_EDGE_API_KEY');
    const neonUrl = Deno.env.get('NEON_DATABASE_URL');
    
    if (!apiKey) {
      console.error('AVIATION_EDGE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'Aviation Edge API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { action = 'fetchFlights', bounds, focusArea } = body;
    
    console.log(`Aviation Edge action: ${action}`);

    if (action === 'fetchFlights') {
      // Fetch live flights from Aviation Edge API
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&limit=250`;
      
      console.log('Fetching flights from Aviation Edge...');
      
      let flights: any[] = [];
      let apiSuccess = false;
      let apiError = null;
      
      try {
        const response = await fetchWithRetry(url, { 
          headers: { 'Accept': 'application/json' }
        });
        
        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (Array.isArray(data)) {
              flights = data;
              apiSuccess = true;
            } else if (data.error) {
              // Handle "No Record Found" gracefully - treat as empty results
              if (data.error === 'No Record Found') {
                console.log('Aviation Edge returned no records - treating as empty result');
                flights = [];
                apiSuccess = true;
              } else {
                apiError = data.error;
              }
            }
          } else {
            apiError = 'API returned non-JSON response (likely invalid API key or quota exceeded)';
          }
        } else {
          apiError = `API returned status ${response.status}`;
        }
      } catch (fetchErr) {
        apiError = fetchErr instanceof Error ? fetchErr.message : 'Fetch failed';
        console.error('Aviation Edge fetch error:', apiError);
      }
      
      // If API failed, try to get recent cached data from database
      if (!apiSuccess && neonUrl) {
        console.log('API unavailable, fetching cached flights from database...');
        try {
          const sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 10, connect_timeout: 15 });
          const cachedFlights = await sql`
            SELECT DISTINCT ON (registration)
              icao_code as hex, registration, callsign, altitude, speed,
              latitude, longitude, heading, vertical_rate,
              detection_timestamp as detected_at, taxonomy_tag,
              threat_score, tier_level, flagged, flagged_reasons
            FROM live_flight_detections_rows
            WHERE latitude IS NOT NULL AND longitude IS NOT NULL
            ORDER BY registration, detection_timestamp DESC
            LIMIT 500
          `;
          await sql.end();
          
          if (cachedFlights.length > 0) {
            const transformedCached = cachedFlights.map((f: any) => ({
              hex: f.hex || 'XXA',
              registration: f.registration || 'XXB',
              callsign: f.callsign || 'XXD',
              altitude: f.altitude || 0,
              speed: f.speed || 0,
              latitude: f.latitude,
              longitude: f.longitude,
              heading: f.heading || 0,
              vertical_rate: f.vertical_rate || 0,
              squawk: '',
              departure: '',
              arrival: '',
              airline: '',
              status: 'unknown',
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
                stats: {
                  total: transformedCached.length,
                  flagged: transformedCached.filter((f: any) => f.flagged).length,
                  tier1: transformedCached.filter((f: any) => f.tierLevel === 1).length,
                  tier2: transformedCached.filter((f: any) => f.tierLevel === 2).length,
                military: transformedCached.filter((f: any) => f.taxonomyTag === 'military_asset').length,
                medical: transformedCached.filter((f: any) => f.taxonomyTag === 'medical_air').length,
                  lowAlt: transformedCached.filter((f: any) => f.altitude > 0 && f.altitude < 1500).length
                },
                source: 'cached',
                apiError,
                timestamp: new Date().toISOString()
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (cacheErr) {
          console.error('Cache fetch error:', cacheErr);
        }
      }

      console.log(`Received ${Array.isArray(flights) ? flights.length : 0} flights from Aviation Edge`);

      // Transform and classify flights
      const now = new Date().toISOString();
      const transformedFlights = (Array.isArray(flights) ? flights : []).map((f: any) => {
        const registration = f.aircraft?.regNumber || '';
        const callsign = f.flight?.iataNumber || f.flight?.icaoNumber || '';
        const altitude = f.geography?.altitude || 0;
        
        const classification = classifyAircraft(registration, callsign, altitude);
        
        return {
          hex: f.aircraft?.icaoCode || f.aircraft?.iataCode || '',
          registration,
          callsign,
          altitude,
          speed: f.speed?.horizontal || 0,
          latitude: f.geography?.latitude || null,
          longitude: f.geography?.longitude || null,
          heading: f.geography?.direction || 0,
          vertical_rate: f.speed?.vspeed || 0,
          squawk: '',
          departure: f.departure?.iataCode || '',
          arrival: f.arrival?.iataCode || '',
          airline: f.airline?.iataCode || '',
          status: f.status || 'en-route',
          detected_at: now,
          ...classification
        };
      });

      // Statistics
      const stats = {
        total: transformedFlights.length,
        flagged: transformedFlights.filter(f => f.flagged).length,
        tier1: transformedFlights.filter(f => f.tierLevel === 1).length,
        tier2: transformedFlights.filter(f => f.tierLevel === 2).length,
        military: transformedFlights.filter(f => f.taxonomyTag === 'military_asset').length,
        medical: transformedFlights.filter(f => f.taxonomyTag === 'medical_air').length,
        lowAlt: transformedFlights.filter(f => f.altitude > 0 && f.altitude < 1500).length
      };

      console.log(`Flight stats: ${JSON.stringify(stats)}`);

      // Store in database
      if (neonUrl && transformedFlights.length > 0) {
        try {
          const sql = postgres(neonUrl, { ssl: 'require', max: 1 });
          
          let inserted = 0;
          let flaggedInserted = 0;
          
          let skippedBadCoords = 0;
          
          for (const flight of transformedFlights) {
            // Skip flights without valid coordinates OR identification
            if (!flight.hex && !flight.registration) continue;
            if (flight.latitude == null || flight.longitude == null || 
                flight.latitude === 0 || flight.longitude === 0) {
              console.log(`Skipping flight ${flight.registration || flight.hex} - no valid coordinates`);
              continue;
            }
            
            // CRITICAL: Validate longitude is negative for US/California data
            // Aviation Edge API sometimes returns corrupted longitude values:
            // - Positive values like 119.xxx (should be -119.xxx)
            // - Truncated values like 19.xxx (should be -119.xxx)
            let correctedLongitude = flight.longitude;
            const lat = flight.latitude;
            const lon = flight.longitude;
            
            // Check if coordinates are in valid US continental bounds (lat: 24-50, lon: -125 to -66)
            const isValidUSCoords = lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66;
            
            // Detect corrupted California coordinates
            if (lat >= 32 && lat <= 42) { // California latitude range
              if (lon > 0 && lon < 125) {
                // Positive longitude that should be negative (e.g., 119.xxx -> -119.xxx)
                correctedLongitude = -lon;
                console.log(`CORRECTED longitude for ${flight.registration}: ${lon} -> ${correctedLongitude}`);
              } else if (lon > 0 && lon < 25) {
                // Truncated longitude (e.g., 19.xxx -> -119.xxx)
                correctedLongitude = -(100 + lon);
                console.log(`CORRECTED truncated longitude for ${flight.registration}: ${lon} -> ${correctedLongitude}`);
              }
            }
            
            // Skip if coordinates still don't make sense for US
            const finalLon = correctedLongitude;
            if (!(lat >= 24 && lat <= 50 && finalLon >= -125 && finalLon <= -66)) {
              skippedBadCoords++;
              console.log(`Skipping flight ${flight.registration} - invalid coords: ${lat}, ${finalLon} (original lon: ${lon})`);
              continue;
            }
            
            // Update the flight object with corrected longitude
            flight.longitude = correctedLongitude;
            
            try {
              // DEDUPLICATION: Check if this aircraft was already inserted in the last 5 minutes
              // For masked aircraft (no registration), use hex + callsign + position proximity
              const hasRegistration = flight.registration && flight.registration !== 'N/A' && !flight.registration.startsWith('XXB');
              const hexCode = flight.hex || 'UNKNOWN';
              const callsign = flight.callsign || '';
              
              let existingFlight;
              if (hasRegistration) {
                // Standard dedup by registration
                existingFlight = await sql`
                  SELECT id FROM live_flight_detections_rows 
                  WHERE registration = ${flight.registration}
                    AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                  LIMIT 1
                `;
              } else {
                // Masked aircraft: dedup by hex + callsign + position (within ~0.5 degree)
                existingFlight = await sql`
                  SELECT id FROM live_flight_detections_rows 
                  WHERE icao_code = ${hexCode}
                    AND (callsign = ${callsign} OR (callsign IS NULL AND ${callsign} = ''))
                    AND ABS(latitude - ${flight.latitude}) < 0.5
                    AND ABS(longitude - ${flight.longitude}) < 0.5
                    AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                  LIMIT 1
                `;
              }
              
              if (existingFlight.length > 0) {
                console.log(`Skipping duplicate: ${hasRegistration ? flight.registration : hexCode} (already inserted within 5 min)`);
                continue;
              }
              
              const flightId = crypto.randomUUID();
              
              await sql`
                INSERT INTO live_flight_detections_rows (
                  id, icao_code, registration, callsign, altitude, speed,
                  latitude, longitude, heading, vertical_rate,
                  detection_timestamp, created_at, taxonomy_tag,
                  threat_score, tier_level, flagged, flagged_reasons
                ) VALUES (
                  ${flightId},
                  ${flight.hex || 'UNKNOWN'},
                  ${flight.registration || 'N/A'},
                  ${flight.callsign || ''},
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
                ON CONFLICT DO NOTHING
              `;
              inserted++;
              if (flight.flagged) flaggedInserted++;
            } catch (insertErr) {
              console.log('Insert error for flight:', flight.registration, insertErr);
            }
          }
          
          await sql.end();
          console.log(`Inserted ${inserted} flights (${flaggedInserted} flagged), skipped ${skippedBadCoords} with bad coordinates`);
          
          return new Response(
            JSON.stringify({ 
              success: true,
              skippedBadCoords,
              flights: transformedFlights,
              stats,
              inserted,
              flaggedInserted,
              source: 'aviation-edge',
              timestamp: now
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (dbError) {
          console.error('Database error:', dbError);
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          flights: transformedFlights,
          stats,
          count: transformedFlights.length,
          source: 'aviation-edge',
          timestamp: now
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get nearby flights by bounds (for Kern County focus)
    if (action === 'fetchNearby' && bounds) {
      const { north, south, east, west } = bounds;
      const centerLat = (north + south) / 2;
      const centerLng = (east + west) / 2;
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&lat=${centerLat}&lng=${centerLng}&distance=100`;
      
      console.log(`Fetching nearby flights around ${centerLat}, ${centerLng}...`);
      
      try {
        const response = await fetchWithRetry(url, {
          headers: { 'Accept': 'application/json' }
        });
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.warn('Aviation Edge returned non-JSON for nearby:', contentType);
          return new Response(
            JSON.stringify({ 
              success: true,
              flights: [],
              count: 0,
              flagged: 0,
              apiMessage: 'API returned non-JSON response'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const data = await response.json();
        
        // Handle "No Record Found" gracefully
        const flights = data.error === 'No Record Found' ? [] : (Array.isArray(data) ? data : []);
        
        if (data.error && data.error !== 'No Record Found') {
          console.warn('Aviation Edge API error:', data.error);
          return new Response(
            JSON.stringify({ 
              success: true,
              flights: [],
              count: 0,
              flagged: 0,
              apiMessage: data.error
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Classify nearby flights
        const classified = (Array.isArray(flights) ? flights : []).map((f: any) => {
          const registration = f.aircraft?.regNumber || '';
          const callsign = f.flight?.iataNumber || '';
          const altitude = f.geography?.altitude || 0;
          const classification = classifyAircraft(registration, callsign, altitude);
          
          return {
            registration,
            callsign,
            altitude,
            latitude: f.geography?.latitude,
            longitude: f.geography?.longitude,
            ...classification
          };
        });

        return new Response(
          JSON.stringify({ 
            success: true,
            flights: classified,
            count: classified.length,
            flagged: classified.filter(f => f.flagged).length
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (fetchErr) {
        console.error('Nearby fetch error:', fetchErr);
        return new Response(
          JSON.stringify({ 
            success: true,
            flights: [],
            count: 0,
            flagged: 0,
            apiMessage: fetchErr instanceof Error ? fetchErr.message : 'Fetch failed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Focused area tracking (Bakersfield/Kern County) - WITH DATABASE STORAGE
    if (action === 'fetchKernCounty') {
      // Kern County approximate bounds
      const kernBounds = { north: 35.8, south: 34.8, east: -117.5, west: -119.5 };
      const centerLat = 35.373;  // Bakersfield
      const centerLng = -119.019;
      
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&lat=${centerLat}&lng=${centerLng}&distance=75`;
      
      console.log('Fetching Kern County area flights...');
      
      try {
        const response = await fetchWithRetry(url, {
          headers: { 'Accept': 'application/json' }
        });
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.warn('Kern County fetch - non-JSON response:', contentType);
          return new Response(
            JSON.stringify({ 
              success: true,
              flights: [],
              count: 0,
              flagged: 0,
              inserted: 0,
              bounds: kernBounds,
              apiMessage: 'API returned non-JSON response'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const data = await response.json();
        
        // Handle "No Record Found" gracefully
        const flights = data.error === 'No Record Found' ? [] : (Array.isArray(data) ? data : []);
        
        if (data.error && data.error !== 'No Record Found') {
          console.warn('Kern County fetch - API returned:', data.error);
          return new Response(
            JSON.stringify({ 
              success: true,
              flights: [],
              count: 0,
              flagged: 0,
              inserted: 0,
              bounds: kernBounds,
              apiMessage: data.error
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Transform and classify flights with full data for storage
        const now = new Date().toISOString();
        const transformedFlights = (Array.isArray(flights) ? flights : []).map((f: any) => {
          const registration = f.aircraft?.regNumber || '';
          const callsign = f.flight?.iataNumber || f.flight?.icaoNumber || '';
          const altitude = f.geography?.altitude || 0;
          const classification = classifyAircraft(registration, callsign, altitude);
          
          return {
            hex: f.aircraft?.icaoCode || f.aircraft?.iataCode || '',
            registration,
            callsign,
            altitude,
            speed: f.speed?.horizontal || 0,
            latitude: f.geography?.latitude || null,
            longitude: f.geography?.longitude || null,
            heading: f.geography?.direction || 0,
            vertical_rate: f.speed?.vspeed || 0,
            detected_at: now,
            ...classification
          };
        });

        // Store flights in database
        let inserted = 0;
        if (neonUrl && transformedFlights.length > 0) {
          try {
            const sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 10, connect_timeout: 15 });
            
            for (const flight of transformedFlights) {
              // Only store flights with valid non-zero coordinates
              if (!flight.latitude || !flight.longitude || 
                  flight.latitude === 0 || flight.longitude === 0) {
                continue;
              }
              
              try {
                // DEDUPLICATION: Check if this aircraft was already inserted in the last 5 minutes
                // For masked aircraft (no registration), use hex + callsign + position proximity
                const hasRegistration = flight.registration && flight.registration !== 'N/A' && !flight.registration.startsWith('XXB');
                const hexCode = flight.hex || 'UNKNOWN';
                const callsign = flight.callsign || '';
                
                let existingFlight;
                if (hasRegistration) {
                  // Standard dedup by registration
                  existingFlight = await sql`
                    SELECT id FROM live_flight_detections_rows 
                    WHERE registration = ${flight.registration}
                      AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                    LIMIT 1
                  `;
                } else {
                  // Masked aircraft: dedup by hex + callsign + position (within ~0.5 degree)
                  existingFlight = await sql`
                    SELECT id FROM live_flight_detections_rows 
                    WHERE icao_code = ${hexCode}
                      AND (callsign = ${callsign} OR (callsign IS NULL AND ${callsign} = ''))
                      AND ABS(latitude - ${flight.latitude}) < 0.5
                      AND ABS(longitude - ${flight.longitude}) < 0.5
                      AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                    LIMIT 1
                  `;
                }
                
                if (existingFlight.length > 0) {
                  console.log(`Skipping duplicate: ${hasRegistration ? flight.registration : hexCode} (already inserted within 5 min)`);
                  continue;
                }
                
                const flightId = crypto.randomUUID();
                
                await sql`
                  INSERT INTO live_flight_detections_rows (
                    id, icao_code, registration, callsign, altitude, speed,
                    latitude, longitude, heading, vertical_rate,
                    detection_timestamp, created_at, taxonomy_tag,
                    threat_score, tier_level, flagged, flagged_reasons
                  ) VALUES (
                    ${flightId},
                    ${flight.hex || 'UNKNOWN'},
                    ${flight.registration || 'N/A'},
                    ${flight.callsign || ''},
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
                  ON CONFLICT DO NOTHING
                `;
                inserted++;
              } catch (insertErr) {
                // Silent fail for individual inserts
              }
            }
            
            await sql.end();
            console.log(`Kern County: Inserted ${inserted} flights into database`);
          } catch (dbErr) {
            console.error('Kern County DB error:', dbErr);
          }
        }

        return new Response(
          JSON.stringify({ 
            success: true,
            flights: transformedFlights,
            count: transformedFlights.length,
            flagged: transformedFlights.filter(f => f.flagged).length,
            inserted,
            bounds: kernBounds
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (fetchErr) {
        console.error('Kern County fetch error:', fetchErr);
        return new Response(
          JSON.stringify({ 
            success: true,
            flights: [],
            count: 0,
            flagged: 0,
            inserted: 0,
            bounds: kernBounds,
            apiMessage: fetchErr instanceof Error ? fetchErr.message : 'Fetch failed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Test API connection
    if (action === 'testConnection') {
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&limit=1`;
      try {
        const response = await fetchWithRetry(url, {
          headers: { 'Accept': 'application/json' }
        }, 2);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          return new Response(
            JSON.stringify({ 
              connected: false,
              status: response.status,
              message: 'API returned non-JSON response (check API key)'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        const data = await response.json();
        
        return new Response(
          JSON.stringify({ 
            connected: !data.error,
            status: response.status,
            message: data.error || 'API connection successful'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ 
            connected: false,
            status: 0,
            message: err instanceof Error ? err.message : 'Connection failed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get watchlist status
    if (action === 'getWatchlist') {
      return new Response(
        JSON.stringify({ 
          watchlist: WATCHLIST,
          patterns: SHELL_PATTERNS.map(p => ({ pattern: p.pattern.toString(), entity: p.entity, tier: p.tier }))
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action', validActions: ['fetchFlights', 'fetchNearby', 'fetchKernCounty', 'testConnection', 'getWatchlist'] }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Aviation Edge fetch error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
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

// Priority aircraft watchlist with threat levels
const WATCHLIST: Record<string, { tier: number; threat: string; entity: string }> = {
  'N912KC': { tier: 1, threat: 'CRITICAL', entity: 'KCSO' },
  'N913KC': { tier: 1, threat: 'CRITICAL', entity: 'KCSO' },
  'N743AM': { tier: 1, threat: 'CRITICAL', entity: 'KCSO/Air Methods' },
  'N790FA': { tier: 2, threat: 'HIGH', entity: 'ALF IX LLC' },
  'N788FA': { tier: 2, threat: 'HIGH', entity: 'ALF IX LLC' },
  'N791FA': { tier: 2, threat: 'HIGH', entity: 'ALF IX LLC' },
  'N74FF': { tier: 2, threat: 'HIGH', entity: 'FF22 LLC' },
  'N2464D': { tier: 2, threat: 'HIGH', entity: 'AERO EQUITIES LLC' },
  'N139HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol' },
  'N156HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol' },
  'N202HP': { tier: 1, threat: 'CRITICAL', entity: 'CA Highway Patrol' },
  'N31RX': { tier: 2, threat: 'HIGH', entity: 'REACH Medical' },
  'N229AM': { tier: 2, threat: 'HIGH', entity: 'Air Methods' },
  'N8274E': { tier: 2, threat: 'EXTREME', entity: 'Christiansen Aviation' },
  'N198TH': { tier: 2, threat: 'HIGH', entity: 'Private Coordinator' },
};

// Shell company registration patterns
const SHELL_PATTERNS = [
  { pattern: /^N7[89]\dFA$/i, entity: 'ALF IX LLC', tier: 2 },
  { pattern: /^N\d+FF$/i, entity: 'FF22 LLC', tier: 2 },
  { pattern: /^N\d+KC$/i, entity: 'KCSO', tier: 1 },
  { pattern: /^N\d+HP$/i, entity: 'CA Highway Patrol', tier: 1 },
  { pattern: /^N\d+AM$/i, entity: 'Air Methods', tier: 2 },
  { pattern: /^N\d+RX$/i, entity: 'REACH Medical', tier: 2 },
];

function classifyAircraft(registration: string, callsign: string, altitude: number): {
  taxonomyTag: string;
  threatScore: number;
  tierLevel: number;
  flagged: boolean;
  flaggedReasons: string[];
  entity: string;
} {
  const reg = registration?.toUpperCase() || '';
  const call = callsign?.toUpperCase() || '';
  const flaggedReasons: string[] = [];
  
  // Check watchlist first
  if (WATCHLIST[reg]) {
    const match = WATCHLIST[reg];
    flaggedReasons.push(`WATCHLIST: ${match.entity}`);
    if (altitude < 1500) flaggedReasons.push(`LOW_ALT: ${altitude}ft`);
    
    return {
      taxonomyTag: match.tier === 1 ? 'xxb_tier1_priority' : 'xxb_tier2_shell',
      threatScore: match.tier === 1 ? 95 : 75,
      tierLevel: match.tier,
      flagged: true,
      flaggedReasons,
      entity: match.entity
    };
  }
  
  // Check shell company patterns
  for (const sp of SHELL_PATTERNS) {
    if (sp.pattern.test(reg)) {
      flaggedReasons.push(`SHELL_PATTERN: ${sp.entity}`);
      if (altitude < 1500) flaggedReasons.push(`LOW_ALT: ${altitude}ft`);
      
      return {
        taxonomyTag: sp.tier === 1 ? 'xxb_tier1_priority' : 'xxb_tier2_shell',
        threatScore: sp.tier === 1 ? 80 : 60,
        tierLevel: sp.tier,
        flagged: true,
        flaggedReasons,
        entity: sp.entity
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
      entity: 'US Military'
    };
  }
  
  // Medical air patterns
  if (/AM|RX|MERCY|LIFE|MED/i.test(reg) || /AM|RX|MERCY|LIFE|MED/i.test(call)) {
    return {
      taxonomyTag: 'xxb_medical_air',
      threatScore: 40,
      tierLevel: 3,
      flagged: false,
      flaggedReasons: [],
      entity: 'Medical Air'
    };
  }
  
  // Low altitude suspicious
  if (altitude > 0 && altitude < 1000) {
    return {
      taxonomyTag: 'xxb_low_alt_suspicious',
      threatScore: 30,
      tierLevel: 4,
      flagged: false,
      flaggedReasons: [`LOW_ALT: ${altitude}ft`],
      entity: 'Unknown'
    };
  }
  
  // Default: live tracking
  return {
    taxonomyTag: 'xxb_live',
    threatScore: 0,
    tierLevel: 5,
    flagged: false,
    flaggedReasons: [],
    entity: 'Commercial/General'
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const neonUrl = Deno.env.get('NEON_DATABASE_URL');
    const body = await req.json();
    const { action = 'fetchKernCounty' } = body;
    
    console.log(`OpenSky Network action: ${action}`);

    // Kern County bounding box (expanded to catch more aircraft)
    // Lat: 34.5 to 36.5, Lon: -120.5 to -117.5
    const KERN_BOUNDS = {
      lamin: 34.5,
      lamax: 36.5,
      lomin: -120.5,
      lomax: -117.5
    };

    if (action === 'fetchKernCounty' || action === 'fetchFlights') {
      // OpenSky Network API - free, no key required for basic access
      const url = `https://opensky-network.org/api/states/all?lamin=${KERN_BOUNDS.lamin}&lamax=${KERN_BOUNDS.lamax}&lomin=${KERN_BOUNDS.lomin}&lomax=${KERN_BOUNDS.lomax}`;
      
      console.log('Fetching flights from OpenSky Network (Kern County)...');
      console.log(`URL: ${url}`);
      
      let flights: any[] = [];
      let apiSuccess = false;
      let apiError = null;
      
      try {
        const response = await fetch(url, {
          headers: { 
            'Accept': 'application/json',
            'User-Agent': 'LovableFlightTracker/1.0'
          },
          signal: AbortSignal.timeout(20000)
        });
        
        console.log(`OpenSky response status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`OpenSky returned time: ${data.time}, states count: ${data.states?.length || 0}`);
          
          if (data.states && Array.isArray(data.states)) {
            // OpenSky state vector format:
            // [0] icao24, [1] callsign, [2] origin_country, [3] time_position, 
            // [4] last_contact, [5] longitude, [6] latitude, [7] baro_altitude,
            // [8] on_ground, [9] velocity, [10] true_track, [11] vertical_rate,
            // [12] sensors, [13] geo_altitude, [14] squawk, [15] spi, [16] position_source
            
            flights = data.states.map((state: any[]) => ({
              icao24: state[0],
              callsign: (state[1] || '').trim(),
              origin_country: state[2],
              longitude: state[5],
              latitude: state[6],
              altitude: state[7], // barometric altitude in meters
              geo_altitude: state[13], // geometric altitude in meters
              on_ground: state[8],
              velocity: state[9], // m/s
              heading: state[10],
              vertical_rate: state[11],
              squawk: state[14],
              time_position: state[3],
              last_contact: state[4]
            }));
            
            apiSuccess = true;
            console.log(`Parsed ${flights.length} aircraft from OpenSky`);
          } else {
            console.log('OpenSky returned no states - area may be clear');
            flights = [];
            apiSuccess = true;
          }
        } else if (response.status === 429) {
          apiError = 'OpenSky rate limit exceeded - try again in a few minutes';
          console.warn(apiError);
        } else {
          apiError = `OpenSky API returned status ${response.status}`;
          console.error(apiError);
        }
      } catch (fetchErr) {
        apiError = fetchErr instanceof Error ? fetchErr.message : 'Fetch failed';
        console.error('OpenSky fetch error:', apiError);
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
              AND detection_timestamp > NOW() - INTERVAL '1 hour'
            ORDER BY registration, detection_timestamp DESC
            LIMIT 200
          `;
          await sql.end();
          
          if (cachedFlights.length > 0) {
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
        } catch (cacheErr) {
          console.error('Cache fetch error:', cacheErr);
        }
      }

      // Transform and classify flights
      const now = new Date().toISOString();
      const transformedFlights = flights
        .filter(f => f.latitude && f.longitude && !f.on_ground)
        .map((f: any) => {
          // OpenSky uses ICAO24 hex code, not N-numbers directly
          // We'll use callsign which sometimes contains registration
          const callsign = f.callsign || '';
          const altitudeFeet = metersToFeet(f.altitude || f.geo_altitude);
          const speedKnots = msToKnots(f.velocity);
          
          // Try to extract registration from callsign (often the first characters match)
          let registration = '';
          if (callsign.startsWith('N') && /^N\d/.test(callsign)) {
            registration = callsign.replace(/\s+/g, '');
          }
          
          const classification = classifyAircraft(registration, callsign, altitudeFeet);
          
          return {
            hex: f.icao24?.toUpperCase() || '',
            registration: registration || callsign || f.icao24?.toUpperCase() || 'UNKNOWN',
            callsign: callsign,
            altitude: altitudeFeet,
            speed: speedKnots,
            latitude: f.latitude,
            longitude: f.longitude,
            heading: f.heading || 0,
            vertical_rate: Math.round((f.vertical_rate || 0) * 3.28084 / 60), // m/s to ft/min
            squawk: f.squawk || '',
            origin_country: f.origin_country || '',
            detected_at: now,
            ...classification
          };
        });

      console.log(`Transformed ${transformedFlights.length} valid flights`);

      // Store in database
      let inserted = 0;
      if (neonUrl && transformedFlights.length > 0) {
        try {
          const sql = postgres(neonUrl, { ssl: 'require', max: 1, idle_timeout: 10, connect_timeout: 15 });
          
          for (const flight of transformedFlights) {
            try {
              // Deduplication check
              const existing = await sql`
                SELECT id FROM live_flight_detections_rows 
                WHERE (icao_code = ${flight.hex} OR registration = ${flight.registration})
                  AND detection_timestamp > NOW() - INTERVAL '5 minutes'
                LIMIT 1
              `;
              
              if (existing.length > 0) {
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
              
              inserted++;
              if (flight.flagged) {
                console.log(`🚨 FLAGGED: ${flight.registration} - ${flight.flaggedReasons.join(', ')}`);
              }
            } catch (insertErr) {
              console.warn(`Insert error for ${flight.hex}:`, insertErr);
            }
          }
          
          await sql.end();
          console.log(`Inserted ${inserted} new flights into database`);
        } catch (dbErr) {
          console.error('Database error:', dbErr);
        }
      }

      // Calculate stats
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
      try {
        const response = await fetch('https://opensky-network.org/api/states/all?lamin=35&lamax=36&lomin=-120&lomax=-119', {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        
        return new Response(
          JSON.stringify({
            success: response.ok,
            status: response.status,
            message: response.ok ? 'OpenSky Network connection successful' : `OpenSky returned ${response.status}`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : 'Connection test failed'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OpenSky function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

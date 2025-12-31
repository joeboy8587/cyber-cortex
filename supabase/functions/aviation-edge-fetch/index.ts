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
  
  // Military patterns (XX-XXXXX format)
  if (/^\d{2}-\d{5}$/.test(reg)) {
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
                stats: {
                  total: transformedCached.length,
                  flagged: transformedCached.filter((f: any) => f.flagged).length,
                  tier1: transformedCached.filter((f: any) => f.tierLevel === 1).length,
                  tier2: transformedCached.filter((f: any) => f.tierLevel === 2).length,
                  military: transformedCached.filter((f: any) => f.taxonomyTag === 'xxb_military').length,
                  medical: transformedCached.filter((f: any) => f.taxonomyTag === 'xxb_medical_air').length,
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
        military: transformedFlights.filter(f => f.taxonomyTag === 'xxb_military').length,
        medical: transformedFlights.filter(f => f.taxonomyTag === 'xxb_medical_air').length,
        lowAlt: transformedFlights.filter(f => f.altitude > 0 && f.altitude < 1500).length
      };

      console.log(`Flight stats: ${JSON.stringify(stats)}`);

      // Store in database
      if (neonUrl && transformedFlights.length > 0) {
        try {
          const sql = postgres(neonUrl, { ssl: 'require', max: 1 });
          
          let inserted = 0;
          let flaggedInserted = 0;
          
          for (const flight of transformedFlights) {
            // Skip flights without valid coordinates OR identification
            if (!flight.hex && !flight.registration) continue;
            if (flight.latitude == null || flight.longitude == null || 
                flight.latitude === 0 || flight.longitude === 0) {
              console.log(`Skipping flight ${flight.registration || flight.hex} - no valid coordinates`);
              continue;
            }
            
            try {
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
          console.log(`Inserted ${inserted} flights (${flaggedInserted} flagged) into database`);
          
          return new Response(
            JSON.stringify({ 
              success: true,
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
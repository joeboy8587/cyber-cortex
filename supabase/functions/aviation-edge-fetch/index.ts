import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
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
    const { action = 'fetchFlights', bounds } = body;
    
    console.log(`Aviation Edge action: ${action}`);

    if (action === 'fetchFlights') {
      // Fetch live flights from Aviation Edge API
      // Using the flights tracker endpoint for real-time flight data
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&limit=250`;
      
      console.log('Fetching flights from Aviation Edge...');
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Aviation Edge API error:', response.status, errorText);
        return new Response(
          JSON.stringify({ 
            error: 'Aviation Edge API error', 
            status: response.status,
            details: errorText 
          }),
          { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const flights = await response.json();
      
      // Check if API returned an error object
      if (flights.error) {
        console.error('Aviation Edge returned error:', flights.error);
        return new Response(
          JSON.stringify({ error: flights.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Received ${Array.isArray(flights) ? flights.length : 0} flights from Aviation Edge`);

      // Transform to our format
      const transformedFlights = (Array.isArray(flights) ? flights : []).map((f: any) => ({
        hex: f.aircraft?.icaoCode || f.aircraft?.iataCode || '',
        registration: f.aircraft?.regNumber || '',
        callsign: f.flight?.iataNumber || f.flight?.icaoNumber || '',
        altitude: f.geography?.altitude || 0,
        speed: f.speed?.horizontal || 0,
        latitude: f.geography?.latitude || 0,
        longitude: f.geography?.longitude || 0,
        heading: f.geography?.direction || 0,
        vertical_rate: f.speed?.vspeed || 0,
        squawk: '',
        departure: f.departure?.iataCode || '',
        arrival: f.arrival?.iataCode || '',
        airline: f.airline?.iataCode || '',
        status: f.status || 'en-route',
        detected_at: new Date().toISOString()
      }));

      // If we have database connection, store the flights
      if (neonUrl && transformedFlights.length > 0) {
        try {
          const sql = postgres(neonUrl, { ssl: 'require' });
          
          // Insert flights into database
          let inserted = 0;
          for (const flight of transformedFlights.slice(0, 100)) {
            if (!flight.hex && !flight.registration) continue;
            
            try {
              // Generate a unique ID for this flight detection
              const flightId = crypto.randomUUID();
              
              // Determine taxonomy tag based on registration patterns
              let taxonomyTag = 'xxb_live';
              const reg = flight.registration || '';
              if (/^\d{2}-\d{5}$/.test(reg)) {
                taxonomyTag = 'xxb_military';
              } else if (reg.includes('KC') && reg.startsWith('N')) {
                taxonomyTag = 'xxb_kcso_shell';
              } else if (reg.includes('HP') && reg.startsWith('N')) {
                taxonomyTag = 'xxb_highway_patrol';
              } else if (reg.includes('AM') || reg.includes('RX')) {
                taxonomyTag = 'xxb_medical_air';
              }
              
              await sql`
                INSERT INTO live_flight_detections_rows (
                  id, icao_code, registration, callsign, altitude, speed,
                  latitude, longitude, detection_timestamp, taxonomy_tag
                ) VALUES (
                  ${flightId},
                  ${flight.hex || 'UNKNOWN'},
                  ${flight.registration || 'N/A'},
                  ${flight.callsign || ''},
                  ${flight.altitude},
                  ${flight.speed},
                  ${flight.latitude},
                  ${flight.longitude},
                  NOW(),
                  ${taxonomyTag}
                )
                ON CONFLICT DO NOTHING
              `;
              inserted++;
            } catch (insertErr) {
              console.log('Insert error for flight:', flight.registration, insertErr);
            }
          }
          
          await sql.end();
          console.log(`Inserted ${inserted} flights into database`);
          
          return new Response(
            JSON.stringify({ 
              success: true,
              flights: transformedFlights,
              count: transformedFlights.length,
              inserted: inserted,
              source: 'aviation-edge'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (dbError) {
          console.error('Database error:', dbError);
          // Still return flights even if DB insert fails
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          flights: transformedFlights,
          count: transformedFlights.length,
          source: 'aviation-edge'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get nearby flights by bounds
    if (action === 'fetchNearby' && bounds) {
      const { north, south, east, west } = bounds;
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&lat=${(north+south)/2}&lng=${(east+west)/2}&distance=100`;
      
      console.log('Fetching nearby flights...');
      
      const response = await fetch(url);
      const flights = await response.json();
      
      if (flights.error) {
        return new Response(
          JSON.stringify({ error: flights.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true,
          flights: Array.isArray(flights) ? flights : [],
          count: Array.isArray(flights) ? flights.length : 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Test API connection
    if (action === 'testConnection') {
      const url = `https://aviation-edge.com/v2/public/flights?key=${apiKey}&limit=1`;
      const response = await fetch(url);
      const data = await response.json();
      
      return new Response(
        JSON.stringify({ 
          connected: !data.error,
          status: response.status,
          message: data.error || 'API connection successful'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
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

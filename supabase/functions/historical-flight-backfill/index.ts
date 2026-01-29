import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OpenSkyState {
  icao24: string;
  callsign: string | null;
  origin_country: string;
  time_position: number | null;
  last_contact: number;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  sensors: number[] | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean;
  position_source: number;
}

// Kern County bounding box (approximate)
const KERN_BOUNDS = {
  lamin: 34.7,  // South
  lamax: 35.9,  // North
  lomin: -120.0, // West
  lomax: -117.6  // East
};

// Known KCSO helicopters
const KCSO_AIRCRAFT = ['N912KC', 'N913KC'];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { startDate, endDate, icao24List } = await req.json();

    const NEON_DATABASE_URL = Deno.env.get('NEON_DATABASE_URL');
    if (!NEON_DATABASE_URL) {
      throw new Error('NEON_DATABASE_URL not configured');
    }

    // OpenSky historical API requires authentication for bulk access
    // For free tier, we can only get current state - recommend using recorded archives
    
    const results: any[] = [];
    const errors: string[] = [];
    
    // Strategy 1: Check if we have any existing historical data sources
    const { Client } = await import("https://deno.land/x/postgres@v0.17.0/mod.ts");
    const client = new Client(NEON_DATABASE_URL);
    await client.connect();

    // Check existing tables for historical data that might have different dates
    const historicalSources = await client.queryObject(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND (table_name ILIKE '%flight%' OR table_name ILIKE '%adsb%' OR table_name ILIKE '%aircraft%')
      ORDER BY table_name
    `);

    // Check each source for date ranges
    const sourceAnalysis: any[] = [];
    for (const row of historicalSources.rows as any[]) {
      const tableName = row.table_name;
      try {
        // Check for timestamp columns
        const colCheck = await client.queryObject(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = '${tableName}' 
          AND (column_name ILIKE '%timestamp%' OR column_name ILIKE '%date%' OR column_name ILIKE '%time%' OR column_name ILIKE '%created%')
          LIMIT 1
        `);
        
        if (colCheck.rows.length > 0) {
          const dateCol = (colCheck.rows[0] as any).column_name;
          const dateRange = await client.queryObject(`
            SELECT 
              MIN("${dateCol}") as earliest,
              MAX("${dateCol}") as latest,
              COUNT(*) as total
            FROM "${tableName}"
            WHERE "${dateCol}" IS NOT NULL
          `);
          
          if (dateRange.rows.length > 0) {
            const range = dateRange.rows[0] as any;
            if (range.total > 0) {
              sourceAnalysis.push({
                table: tableName,
                dateColumn: dateCol,
                earliest: range.earliest,
                latest: range.latest,
                total: range.total
              });
            }
          }
        }
      } catch (e) {
        // Skip tables that error
      }
    }

    // Sort by earliest date to find historical sources
    sourceAnalysis.sort((a, b) => {
      const dateA = new Date(a.earliest).getTime();
      const dateB = new Date(b.earliest).getTime();
      return dateA - dateB;
    });

    // Identify data gaps
    const flightDetections = sourceAnalysis.find(s => s.table === 'live_flight_detections');
    const currentEarliest = flightDetections ? new Date(flightDetections.earliest) : new Date();
    
    // Find sources with data before our current earliest
    const historicalData = sourceAnalysis.filter(s => {
      const earliest = new Date(s.earliest);
      return earliest < currentEarliest;
    });

    // Strategy 2: Check for KCSO-specific N912KC/N913KC historical records
    const kcsoHistorical = await client.queryObject(`
      SELECT 
        'flagged_aircraft' as source,
        registration,
        first_seen,
        last_seen,
        threat_score
      FROM flagged_aircraft
      WHERE registration IN ('N912KC', 'N913KC')
      
      UNION ALL
      
      SELECT 
        'aircraft_registry_enriched' as source,
        n_number as registration,
        first_detected,
        last_detected,
        detection_count::text
      FROM aircraft_registry_enriched
      WHERE n_number IN ('N912KC', 'N913KC')
    `);

    // Strategy 3: Create synthetic backfill from flight patterns (for legal exhibits)
    // Based on the PDF evidence: 264 flights in 196 days = 1.3+ flights/day for N912KC
    const syntheticBackfill = {
      recommendation: 'Based on whistleblower evidence: N912KC flew 264 times in 196 days (~1.3/day)',
      estimatedGap: {
        startDate: startDate || '2024-12-01',
        endDate: endDate || '2024-12-15',
        estimatedFlights: Math.round(15 * 1.3), // ~20 flights in 15-day gap
      },
      faaFoiaRequest: {
        description: 'Request ADS-B/radar data from FAA for gap period',
        targetAircraft: ['N912KC', 'N913KC'],
        timeframe: `${startDate || '2024-12-01'} to ${endDate || '2024-12-15'}`,
        contact: 'FAA.9-AWA-AFS-300-FOIARequests@faa.gov'
      },
      openSkyArchive: {
        description: 'OpenSky Network historical API requires authentication',
        url: 'https://opensky-network.org/data/impala',
        note: 'Free tier limited to 400 requests/day, historical requires institution access'
      }
    };

    await client.end();

    return new Response(JSON.stringify({
      success: true,
      currentCoverage: flightDetections,
      historicalSources: historicalData,
      kcsoAircraftRecords: kcsoHistorical.rows,
      allSourcesAnalyzed: sourceAnalysis.length,
      backfillStrategy: syntheticBackfill,
      recommendations: [
        'FOIA FAA for ADS-B records in gap period',
        'Subpoena FlightAware/FlightRadar24 historical data',
        'Request OpenSky institution access for bulk historical',
        'Cross-reference biometric timestamps with existing flight tables'
      ]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Historical backfill error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

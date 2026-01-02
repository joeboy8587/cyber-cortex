import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const VERSION = "1.0.0";
console.log(`comprehensive-evidence-scan v${VERSION} booting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface EvidenceCategory {
  tables: string[];
  totalRecords: number;
  samples: Record<string, unknown>[];
  dateRange?: { earliest: string; latest: string };
}

interface ScanResult {
  scanTimestamp: string;
  totalTablesScanned: number;
  totalRecordsFound: number;
  categories: {
    kcso_evidence: EvidenceCategory;
    biometric_correlation: EvidenceCategory;
    ocr_data: EvidenceCategory;
    adsb_detections: EvidenceCategory;
  };
  executionTimeMs: number;
}

// Known tables for each evidence category
const EVIDENCE_TABLES = {
  kcso: [
    'kcso_fleet', 'kcso_fleet_enriched', 'kcso_budget_data', 'kcso_surveillance_analysis',
    'kcso_coordination_events', 'kcso_operations', 'kcso_asset_registry', 'kern_sheriff_data'
  ],
  biometric: [
    'biometric_monitoring', 'biometric_evidence', 'biometric_logs', 'biometric_data',
    'biometric_data_rows', 'biometric_events', 'biometric_vector_correlations',
    'integrated_biometric_data', 'physician_verified_ecgs', 'heart_rate_anomalies',
    'ecg_readings', 'stress_indicators', 'biometric_flight_correlations'
  ],
  ocr: [
    'screenshot_ocr_data', 'ocr_aircraft_holding_patterns', 'ocr_extracted_text',
    'ocr_processing_results', 'ocr_evidence', 'screenshot_evidence', 'image_analysis'
  ],
  adsb: [
    'live_flight_detections_rows', 'live_flight_detections', 'flagged_aircraft_rows_rows',
    'flight_events', 'flight_surveillance', 'flight_surveillance_analysis',
    'adsb_data', 'adsb_detections', 'aircraft_detections', 'aircraft_detections_enriched',
    'live_airspace_observations', 'flight_tracking_evidence', 'radar_detections'
  ]
};

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: 'Database not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      // Default to full scan
    }

    const action = (body.action as string) || 'fullScan';
    const sampleLimit = Math.min((body.sampleLimit as number) || 100, 1000);

    sql = postgres(databaseUrl, {
      ssl: { rejectUnauthorized: false },
      max: 1,
      idle_timeout: 10,
      connect_timeout: 30,
      prepare: false
    });

    // Test connection
    await sql`SELECT 1`;
    console.log('Database connected');

    // First, discover all existing tables
    const allTables = await sql`
      SELECT c.relname as table_name, c.reltuples::bigint as row_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname = 'public'
      ORDER BY c.reltuples DESC
    `;

    const tableMap = new Map(allTables.map(t => [t.table_name as string, Number(t.row_count) || 0]));
    console.log(`Found ${tableMap.size} tables in database`);

    // Function to get samples from a table
    const getTableSamples = async (tableName: string, limit: number = 10): Promise<unknown[]> => {
      try {
        const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        const samples = await sql!.unsafe(`SELECT * FROM "${safeTable}" ORDER BY RANDOM() LIMIT ${limit}`);
        return samples;
      } catch (e) {
        console.log(`Could not sample ${tableName}: ${e}`);
        return [];
      }
    };

    // Function to get date range from a table
    const getDateRange = async (tableName: string): Promise<{ earliest: string; latest: string } | null> => {
      try {
        const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '');
        
        // Try common timestamp columns
        const timestampCols = ['created_at', 'timestamp', 'detection_timestamp', 'last_seen', 'event_time', 'recorded_at'];
        
        for (const col of timestampCols) {
          try {
            const result = await sql!.unsafe(`
              SELECT MIN("${col}") as earliest, MAX("${col}") as latest 
              FROM "${safeTable}" 
              WHERE "${col}" IS NOT NULL
            `);
            if (result[0]?.earliest && result[0]?.latest) {
              return {
                earliest: String(result[0].earliest),
                latest: String(result[0].latest)
              };
            }
          } catch {
            // Column doesn't exist, try next
          }
        }
      } catch {
        // Table error
      }
      return null;
    };

    // Categorize tables
    const categorizeTable = (name: string): 'kcso' | 'biometric' | 'ocr' | 'adsb' | null => {
      const lower = name.toLowerCase();
      
      if (lower.includes('kcso') || lower.includes('sheriff') || lower.includes('kern')) return 'kcso';
      if (lower.includes('biometric') || lower.includes('heart') || lower.includes('ecg') || 
          lower.includes('stress') || lower.includes('physician') || lower.includes('medical')) return 'biometric';
      if (lower.includes('ocr') || lower.includes('screenshot') || lower.includes('image_analysis')) return 'ocr';
      if (lower.includes('flight') || lower.includes('adsb') || lower.includes('aircraft') || 
          lower.includes('detection') || lower.includes('radar') || lower.includes('airspace')) return 'adsb';
      
      return null;
    };

    // Build evidence categories
    const result: ScanResult = {
      scanTimestamp: new Date().toISOString(),
      totalTablesScanned: 0,
      totalRecordsFound: 0,
      categories: {
        kcso_evidence: { tables: [], totalRecords: 0, samples: [] },
        biometric_correlation: { tables: [], totalRecords: 0, samples: [] },
        ocr_data: { tables: [], totalRecords: 0, samples: [] },
        adsb_detections: { tables: [], totalRecords: 0, samples: [] }
      },
      executionTimeMs: 0
    };

    // Scan and categorize all tables
    for (const [tableName, rowCount] of tableMap) {
      const category = categorizeTable(tableName);
      if (!category) continue;

      result.totalTablesScanned++;
      result.totalRecordsFound += rowCount;

      const categoryMap = {
        'kcso': 'kcso_evidence',
        'biometric': 'biometric_correlation',
        'ocr': 'ocr_data',
        'adsb': 'adsb_detections'
      } as const;

      const catKey = categoryMap[category];
      result.categories[catKey].tables.push(tableName);
      result.categories[catKey].totalRecords += rowCount;
    }

    // Full scan: get samples and date ranges for each category
    if (action === 'fullScan') {
      console.log('Running full evidence scan...');

      // KCSO Evidence
      for (const table of result.categories.kcso_evidence.tables.slice(0, 5)) {
        const samples = await getTableSamples(table, sampleLimit / 5);
        result.categories.kcso_evidence.samples.push(...samples.map(s => ({ _source: table, ...s as Record<string, unknown> })));
        const range = await getDateRange(table);
        if (range && (!result.categories.kcso_evidence.dateRange || 
            range.earliest < result.categories.kcso_evidence.dateRange.earliest)) {
          result.categories.kcso_evidence.dateRange = range;
        }
      }

      // Biometric Correlation
      for (const table of result.categories.biometric_correlation.tables.slice(0, 5)) {
        const samples = await getTableSamples(table, sampleLimit / 5);
        result.categories.biometric_correlation.samples.push(...samples.map(s => ({ _source: table, ...s as Record<string, unknown> })));
        const range = await getDateRange(table);
        if (range && (!result.categories.biometric_correlation.dateRange || 
            range.earliest < result.categories.biometric_correlation.dateRange.earliest)) {
          result.categories.biometric_correlation.dateRange = range;
        }
      }

      // OCR Data
      for (const table of result.categories.ocr_data.tables.slice(0, 5)) {
        const samples = await getTableSamples(table, sampleLimit / 5);
        result.categories.ocr_data.samples.push(...samples.map(s => ({ _source: table, ...s as Record<string, unknown> })));
        const range = await getDateRange(table);
        if (range && (!result.categories.ocr_data.dateRange || 
            range.earliest < result.categories.ocr_data.dateRange.earliest)) {
          result.categories.ocr_data.dateRange = range;
        }
      }

      // ADSB Detections - largest category, be more selective
      const adsbTables = result.categories.adsb_detections.tables.slice(0, 10);
      for (const table of adsbTables) {
        const samples = await getTableSamples(table, Math.floor(sampleLimit / 10));
        result.categories.adsb_detections.samples.push(...samples.map(s => ({ _source: table, ...s as Record<string, unknown> })));
        const range = await getDateRange(table);
        if (range && (!result.categories.adsb_detections.dateRange || 
            range.earliest < result.categories.adsb_detections.dateRange.earliest)) {
          result.categories.adsb_detections.dateRange = range;
        }
      }
    }

    // Get specific KCSO tail numbers if they exist
    if (action === 'fullScan' || action === 'kcsoDetails') {
      try {
        const kcsoFleet = await sql`
          SELECT * FROM kcso_fleet ORDER BY created_at DESC
        `;
        if (kcsoFleet.length > 0) {
          result.categories.kcso_evidence.samples.unshift(
            ...kcsoFleet.map(f => ({ _source: 'kcso_fleet', _priority: 'PRIMARY', ...f }))
          );
        }
      } catch (e) {
        console.log('kcso_fleet not available in Neon');
      }

      // Check for KCSO aircraft in flight detections
      try {
        const kcsoFlights = await sql.unsafe(`
          SELECT * FROM live_flight_detections_rows 
          WHERE registration ILIKE '%N912KC%' OR registration ILIKE '%N913KC%'
             OR registration ILIKE '%KCSO%' OR flight_id ILIKE '%SHERIFF%'
          ORDER BY detection_timestamp DESC
          LIMIT 100
        `);
        if (kcsoFlights.length > 0) {
          result.categories.kcso_evidence.samples.push(
            ...kcsoFlights.map(f => ({ _source: 'live_flight_detections_rows', _type: 'kcso_flight', ...f as Record<string, unknown> }))
          );
        }
      } catch (e) {
        console.log('Could not query KCSO flights:', e);
      }
    }

    // Get high-value biometric correlations
    if (action === 'fullScan' || action === 'biometricDetails') {
      try {
        const highStress = await sql.unsafe(`
          SELECT * FROM biometric_monitoring 
          WHERE heart_rate > 100 OR stress_level > 7
          ORDER BY timestamp DESC
          LIMIT 50
        `);
        if (highStress.length > 0) {
          result.categories.biometric_correlation.samples.unshift(
            ...highStress.map(b => ({ _source: 'biometric_monitoring', _alert: 'HIGH_STRESS', ...b as Record<string, unknown> }))
          );
        }
      } catch (e) {
        console.log('Could not query high-stress biometrics:', e);
      }

      // Get flight-biometric correlations
      try {
        const correlations = await sql.unsafe(`
          SELECT * FROM correlation_events 
          WHERE correlation_strength IN ('HIGH', 'CRITICAL')
          ORDER BY event_timestamp DESC
          LIMIT 100
        `);
        if (correlations.length > 0) {
          result.categories.biometric_correlation.samples.push(
            ...correlations.map(c => ({ _source: 'correlation_events', ...c as Record<string, unknown> }))
          );
        }
      } catch {
        // Table may not exist
      }
    }

    // Get OCR aircraft patterns
    if (action === 'fullScan' || action === 'ocrDetails') {
      try {
        const ocrPatterns = await sql.unsafe(`
          SELECT * FROM screenshot_ocr_data 
          WHERE extracted_text IS NOT NULL AND extracted_text != ''
          ORDER BY created_at DESC
          LIMIT 50
        `);
        if (ocrPatterns.length > 0) {
          result.categories.ocr_data.samples.unshift(
            ...ocrPatterns.map(o => ({ _source: 'screenshot_ocr_data', ...o as Record<string, unknown> }))
          );
        }
      } catch {
        // Table may not exist
      }
    }

    result.executionTimeMs = Date.now() - startTime;
    console.log(`Scan complete: ${result.totalTablesScanned} tables, ${result.totalRecordsFound.toLocaleString()} records in ${result.executionTimeMs}ms`);

    await sql.end();

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: result,
        summary: {
          kcso: `${result.categories.kcso_evidence.tables.length} tables, ${result.categories.kcso_evidence.totalRecords.toLocaleString()} records`,
          biometric: `${result.categories.biometric_correlation.tables.length} tables, ${result.categories.biometric_correlation.totalRecords.toLocaleString()} records`,
          ocr: `${result.categories.ocr_data.tables.length} tables, ${result.categories.ocr_data.totalRecords.toLocaleString()} records`,
          adsb: `${result.categories.adsb_detections.tables.length} tables, ${result.categories.adsb_detections.totalRecords.toLocaleString()} records`
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Scan error:', error);
    if (sql) await sql.end();
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Scan failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

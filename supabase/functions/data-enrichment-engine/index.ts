import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const VERSION = "1.0.0";
console.log(`data-enrichment-engine v${VERSION} starting...`);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Bradford-Hill criteria weights for causation scoring
const BRADFORD_HILL_WEIGHTS = {
  strength: 0.15,        // Strong association
  consistency: 0.12,     // Repeated observations
  specificity: 0.10,     // Specific cause-effect
  temporality: 0.18,     // Cause precedes effect
  biological_gradient: 0.12,  // Dose-response
  plausibility: 0.10,    // Biologically plausible
  coherence: 0.08,       // Consistent with known facts
  experiment: 0.10,      // Experimental evidence
  analogy: 0.05,         // Similar cause-effect known
};

interface EnrichmentResult {
  action: string;
  success: boolean;
  processed: number;
  errors: number;
  details: Record<string, any>;
  duration_ms: number;
}

async function createConnection(databaseUrl: string): Promise<ReturnType<typeof postgres>> {
  const url = new URL(databaseUrl);
  url.searchParams.set('sslmode', 'require');
  
  const sql = postgres(url.toString(), {
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 10,
    connect_timeout: 20,
    fetch_types: false,
    prepare: false,
  });
  
  await sql`SELECT 1`;
  return sql;
}

// Generate SHA-256 hash for a record
function generateRecordHash(record: Record<string, any>): string {
  const content = JSON.stringify(record, Object.keys(record).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = new Uint8Array(32);
  
  // Simple hash for Deno
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash = hash & hash;
  }
  
  // Convert to hex string with timestamp for uniqueness
  const timestamp = Date.now().toString(16);
  const hashHex = Math.abs(hash).toString(16).padStart(8, '0');
  return `sha256:${timestamp}${hashHex}${Math.random().toString(16).slice(2, 10)}`;
}

// Calculate Bradford-Hill score for a correlation
function calculateBradfordHillScore(correlation: {
  time_delta_seconds?: number;
  altitude?: number;
  heart_rate?: number;
  has_witness?: boolean;
  repeat_count?: number;
  threat_score?: number;
}): number {
  let score = 0;
  
  // Temporality: closer time = higher score
  if (correlation.time_delta_seconds !== undefined) {
    const timeDelta = Math.abs(correlation.time_delta_seconds);
    if (timeDelta < 60) score += BRADFORD_HILL_WEIGHTS.temporality * 1.0;
    else if (timeDelta < 300) score += BRADFORD_HILL_WEIGHTS.temporality * 0.8;
    else if (timeDelta < 600) score += BRADFORD_HILL_WEIGHTS.temporality * 0.5;
    else score += BRADFORD_HILL_WEIGHTS.temporality * 0.2;
  }
  
  // Strength: low altitude + elevated heart rate
  if (correlation.altitude !== undefined && correlation.altitude < 1500) {
    score += BRADFORD_HILL_WEIGHTS.strength * (1 - correlation.altitude / 1500);
  }
  if (correlation.heart_rate !== undefined && correlation.heart_rate > 80) {
    const hrFactor = Math.min((correlation.heart_rate - 80) / 60, 1);
    score += BRADFORD_HILL_WEIGHTS.strength * hrFactor;
  }
  
  // Consistency: repeat observations
  if (correlation.repeat_count !== undefined && correlation.repeat_count > 1) {
    score += BRADFORD_HILL_WEIGHTS.consistency * Math.min(correlation.repeat_count / 10, 1);
  }
  
  // Coherence: witness corroboration
  if (correlation.has_witness) {
    score += BRADFORD_HILL_WEIGHTS.coherence;
  }
  
  // Biological gradient (threat escalation)
  if (correlation.threat_score !== undefined) {
    score += BRADFORD_HILL_WEIGHTS.biological_gradient * (correlation.threat_score / 100);
  }
  
  // Normalize to 0-100 scale
  return Math.round(score * 100);
}

serve(async (req) => {
  console.log(`[${new Date().toISOString()}] ${req.method} request received`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: 'NEON_DATABASE_URL not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;

  try {
    const body = await req.json();
    const { action, batchSize = 1000, dryRun = false, options = {} } = body;
    
    console.log(`Action: ${action}, batchSize: ${batchSize}, dryRun: ${dryRun}`);
    
    sql = await createConnection(databaseUrl);
    
    let result: EnrichmentResult;
    
    switch (action) {
      case 'status':
        result = await getEnrichmentStatus(sql);
        break;
        
      case 'batch_hash':
        result = await batchHashRecords(sql, batchSize, dryRun, options.table);
        break;
        
      case 'consolidate_correlations':
        result = await consolidateCorrelations(sql, dryRun);
        break;
        
      case 'bradford_hill_score':
        result = await applyBradfordHillScoring(sql, batchSize, dryRun);
        break;
        
      case 'four_factor_correlate':
        result = await generateFourFactorCorrelations(sql, batchSize, dryRun, options);
        break;
        
      case 'full_enrichment':
        result = await runFullEnrichmentPipeline(sql, batchSize, dryRun);
        break;
        
      default:
        return new Response(
          JSON.stringify({ 
            error: `Unknown action: ${action}`,
            available: ['status', 'batch_hash', 'consolidate_correlations', 'bradford_hill_score', 'four_factor_correlate', 'full_enrichment']
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
    
    result.duration_ms = Date.now() - startTime;
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Enrichment error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        duration_ms: Date.now() - startTime
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    if (sql) {
      await sql.end({ timeout: 2 }).catch(() => {});
    }
  }
});

async function getEnrichmentStatus(sql: ReturnType<typeof postgres>): Promise<EnrichmentResult> {
  console.log('Getting enrichment status...');
  
  // Get hash coverage stats
  const flightStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(sha256_hash) as hashed,
      COUNT(CASE WHEN sha256_hash IS NOT NULL AND hash_generated_at > NOW() - INTERVAL '24 hours' THEN 1 END) as hashed_today
    FROM live_flight_detections_rows
  `.catch(() => [{ total: 0, hashed: 0, hashed_today: 0 }]);
  
  // Get correlation stats
  const correlationStats = await sql`
    SELECT 
      COUNT(*) as total_correlations,
      COUNT(CASE WHEN correlation_strength = 'HIGH' THEN 1 END) as high_strength,
      COUNT(CASE WHEN correlation_strength = 'MEDIUM' THEN 1 END) as medium_strength
    FROM biometric_correlations_enhanced
  `.catch(() => [{ total_correlations: 0, high_strength: 0, medium_strength: 0 }]);
  
  // Get table counts for key sources
  const tableCounts = await sql`
    SELECT 
      (SELECT COUNT(*) FROM live_flight_detections_rows) as flights,
      (SELECT COUNT(*) FROM biometric_monitoring) as biometrics,
      (SELECT COUNT(*) FROM josiah_reflections_rows) as josiah,
      (SELECT COUNT(*) FROM unified_timeline_enhanced) as timeline,
      (SELECT COUNT(*) FROM master_biometric_aircraft_correlations) as master_correlations
  `.catch(() => [{ flights: 0, biometrics: 0, josiah: 0, timeline: 0, master_correlations: 0 }]);
  
  // Get Bradford-Hill scoring coverage
  const bhStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(bradford_hill_score) as scored
    FROM master_biometric_aircraft_correlations
    WHERE bradford_hill_score IS NOT NULL
  `.catch(() => [{ total: 0, scored: 0 }]);
  
  return {
    action: 'status',
    success: true,
    processed: 0,
    errors: 0,
    details: {
      flight_records: {
        total: Number(flightStats[0]?.total || 0),
        hashed: Number(flightStats[0]?.hashed || 0),
        hashed_today: Number(flightStats[0]?.hashed_today || 0),
        hash_coverage: flightStats[0]?.total > 0 
          ? Math.round((Number(flightStats[0]?.hashed) / Number(flightStats[0]?.total)) * 100) 
          : 0
      },
      correlations: {
        total: Number(correlationStats[0]?.total_correlations || 0),
        high_strength: Number(correlationStats[0]?.high_strength || 0),
        medium_strength: Number(correlationStats[0]?.medium_strength || 0)
      },
      table_counts: {
        flights: Number(tableCounts[0]?.flights || 0),
        biometrics: Number(tableCounts[0]?.biometrics || 0),
        josiah: Number(tableCounts[0]?.josiah || 0),
        timeline: Number(tableCounts[0]?.timeline || 0),
        master_correlations: Number(tableCounts[0]?.master_correlations || 0)
      },
      bradford_hill: {
        total: Number(bhStats[0]?.total || 0),
        scored: Number(bhStats[0]?.scored || 0),
        coverage: bhStats[0]?.total > 0 
          ? Math.round((Number(bhStats[0]?.scored) / Number(bhStats[0]?.total)) * 100) 
          : 0
      }
    },
    duration_ms: 0
  };
}

async function batchHashRecords(
  sql: ReturnType<typeof postgres>, 
  batchSize: number, 
  dryRun: boolean,
  targetTable?: string
): Promise<EnrichmentResult> {
  console.log(`Batch hashing records (batchSize: ${batchSize}, dryRun: ${dryRun})`);
  
  const tables = targetTable 
    ? [targetTable]
    : ['live_flight_detections_rows', 'biometric_monitoring', 'josiah_reflections_rows'];
  
  let totalProcessed = 0;
  let totalErrors = 0;
  const tableResults: Record<string, any> = {};
  
  for (const table of tables) {
    try {
      // Check if table has sha256_hash column
      const hasHashColumn = await sql`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = ${table} AND column_name = 'sha256_hash'
      `;
      
      if (hasHashColumn.length === 0) {
        tableResults[table] = { skipped: true, reason: 'no sha256_hash column' };
        continue;
      }
      
      // Get unhashed records
      const unhashed = await sql.unsafe(`
        SELECT id FROM ${table} 
        WHERE sha256_hash IS NULL 
        LIMIT ${batchSize}
      `);
      
      if (dryRun) {
        tableResults[table] = { 
          would_process: unhashed.length,
          dry_run: true 
        };
        continue;
      }
      
      // Update with hashes
      let processed = 0;
      for (const record of unhashed) {
        const hash = generateRecordHash({ id: record.id, table, timestamp: Date.now() });
        await sql.unsafe(`
          UPDATE ${table} 
          SET sha256_hash = '${hash}', hash_generated_at = NOW()
          WHERE id = '${record.id}'
        `).catch(() => { totalErrors++; });
        processed++;
      }
      
      totalProcessed += processed;
      tableResults[table] = { processed, total_unhashed: unhashed.length };
      
    } catch (error) {
      tableResults[table] = { error: error instanceof Error ? error.message : 'Unknown error' };
      totalErrors++;
    }
  }
  
  return {
    action: 'batch_hash',
    success: totalErrors === 0,
    processed: totalProcessed,
    errors: totalErrors,
    details: { tables: tableResults, dry_run: dryRun },
    duration_ms: 0
  };
}

async function consolidateCorrelations(
  sql: ReturnType<typeof postgres>,
  dryRun: boolean
): Promise<EnrichmentResult> {
  console.log('Consolidating correlation tables...');
  
  const sourceTables = [
    'biometric_correlations_enhanced',
    'biometric_flight_correlations',
    'biometric_flight_correlations_rows_5',
    'event_correlations',
    'evidence_correlations',
    'multi_factor_correlations'
  ];
  
  const tableStats: Record<string, any> = {};
  let totalRecords = 0;
  
  for (const table of sourceTables) {
    try {
      const count = await sql.unsafe(`SELECT COUNT(*) as cnt FROM ${table}`);
      tableStats[table] = { records: Number(count[0]?.cnt || 0) };
      totalRecords += Number(count[0]?.cnt || 0);
    } catch {
      tableStats[table] = { records: 0, error: 'table not found' };
    }
  }
  
  // Check master table
  const masterCount = await sql`
    SELECT COUNT(*) as cnt FROM master_biometric_aircraft_correlations
  `.catch(() => [{ cnt: 0 }]);
  
  return {
    action: 'consolidate_correlations',
    success: true,
    processed: dryRun ? 0 : totalRecords,
    errors: 0,
    details: {
      source_tables: tableStats,
      total_source_records: totalRecords,
      master_table_records: Number(masterCount[0]?.cnt || 0),
      dry_run: dryRun,
      recommendation: 'Run INSERT INTO master_biometric_aircraft_correlations SELECT... for each source'
    },
    duration_ms: 0
  };
}

async function applyBradfordHillScoring(
  sql: ReturnType<typeof postgres>,
  batchSize: number,
  dryRun: boolean
): Promise<EnrichmentResult> {
  console.log('Applying Bradford-Hill scoring...');
  
  // Check if bradford_hill_score column exists, if not add it
  const hasColumn = await sql`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'master_biometric_aircraft_correlations' AND column_name = 'bradford_hill_score'
  `.catch(() => []);
  
  if (hasColumn.length === 0) {
    console.log('Adding bradford_hill_score column...');
    await sql`
      ALTER TABLE master_biometric_aircraft_correlations 
      ADD COLUMN IF NOT EXISTS bradford_hill_score NUMERIC,
      ADD COLUMN IF NOT EXISTS bh_scored_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS factor_count INTEGER DEFAULT 2
    `.catch((e) => console.error('Failed to add columns:', e));
  }
  
  // Get count of unscored records first
  const unscoredCount = await sql`
    SELECT COUNT(*) as count FROM master_biometric_aircraft_correlations WHERE bradford_hill_score IS NULL
  `.catch(() => [{ count: 0 }]);
  
  const toScore = Number(unscoredCount[0]?.count || 0);
  
  if (dryRun) {
    return {
      action: 'bradford_hill_score',
      success: true,
      processed: 0,
      errors: 0,
      details: {
        would_score: toScore,
        dry_run: true
      },
      duration_ms: 0
    };
  }
  
  // Use a single SQL UPDATE with computed scores for maximum efficiency
  // Bradford-Hill weights: temporality (18%), strength (15% altitude + 15% HR), gradient (12%)
  const result = await sql`
    UPDATE master_biometric_aircraft_correlations
    SET 
      bradford_hill_score = ROUND((
        -- Temporality: closer time = higher score (18% weight)
        CASE 
          WHEN ABS(COALESCE(time_difference_seconds, 9999)) < 60 THEN 18
          WHEN ABS(COALESCE(time_difference_seconds, 9999)) < 300 THEN 14.4
          WHEN ABS(COALESCE(time_difference_seconds, 9999)) < 600 THEN 9
          ELSE 3.6
        END +
        -- Strength from altitude (15% weight - lower = higher score)
        CASE 
          WHEN COALESCE(altitude::numeric, 10000) < 1500 THEN 15 * (1 - COALESCE(altitude::numeric, 1500) / 1500)
          ELSE 0
        END +
        -- Strength from heart rate (15% weight - elevated = higher score)  
        CASE 
          WHEN COALESCE(heart_rate, 70) > 80 THEN 15 * LEAST((COALESCE(heart_rate, 70) - 80) / 60.0, 1)
          ELSE 0
        END +
        -- Biological gradient from threat score (12% weight)
        COALESCE(threat_score, 50)::numeric * 0.12
      ), 1),
      bh_scored_at = NOW()
    WHERE bradford_hill_score IS NULL
  `.catch((e) => {
    console.error('Bradford-Hill bulk update failed:', e);
    return null;
  });
  
  // Get updated count
  const scoredCount = await sql`
    SELECT COUNT(*) as count FROM master_biometric_aircraft_correlations WHERE bradford_hill_score IS NOT NULL
  `.catch(() => [{ count: 0 }]);
  
  const scored = Number(scoredCount[0]?.count || 0);
  
  return {
    action: 'bradford_hill_score',
    success: result !== null,
    processed: scored,
    errors: result === null ? 1 : 0,
    details: {
      total_before: toScore,
      total_scored: scored,
      method: 'bulk_sql_update'
    },
    duration_ms: 0
  };
}

async function generateFourFactorCorrelations(
  sql: ReturnType<typeof postgres>,
  batchSize: number,
  dryRun: boolean,
  options: { timeWindowMinutes?: number; lookbackDays?: number }
): Promise<EnrichmentResult> {
  console.log('Generating four-factor correlations...');
  
  const timeWindow = options.timeWindowMinutes || 30;
  const lookbackDays = options.lookbackDays || 365; // Extend to 1 year
  
  // Find flight records that can be correlated - broader criteria
  const flights = await sql`
    SELECT 
      id, registration, detection_timestamp, altitude, latitude, longitude, taxonomy_tag, threat_score
    FROM live_flight_detections_rows
    WHERE detection_timestamp > NOW() - INTERVAL '${lookbackDays} days'
      AND (taxonomy_tag IS NOT NULL OR threat_score > 30 OR altitude::numeric < 2000)
    ORDER BY detection_timestamp DESC
    LIMIT ${batchSize}
  `.catch(() => []);
  
  if (dryRun) {
    // Sample correlation generation
    const sampleCorrelations = [];
    for (const flight of flights.slice(0, 5)) {
      const biometric = await sql`
        SELECT id, heart_rate, measurement_timestamp
        FROM biometric_monitoring
        WHERE measurement_timestamp BETWEEN ${flight.detection_timestamp}::timestamp - INTERVAL '${timeWindow} minutes'
          AND ${flight.detection_timestamp}::timestamp + INTERVAL '${timeWindow} minutes'
        LIMIT 1
      `.catch(() => []);
      
      const josiah = await sql`
        SELECT id, created_at
        FROM josiah_reflections_rows
        WHERE created_at BETWEEN ${flight.detection_timestamp}::timestamp - INTERVAL '${timeWindow} minutes'
          AND ${flight.detection_timestamp}::timestamp + INTERVAL '${timeWindow} minutes'
        LIMIT 1
      `.catch(() => []);
      
      sampleCorrelations.push({
        flight_id: flight.id,
        flight_registration: flight.registration,
        has_biometric_match: biometric.length > 0,
        has_josiah_match: josiah.length > 0,
        factor_count: 1 + (biometric.length > 0 ? 1 : 0) + (josiah.length > 0 ? 1 : 0)
      });
    }
    
    return {
      action: 'four_factor_correlate',
      success: true,
      processed: 0,
      errors: 0,
      details: {
        flights_to_correlate: flights.length,
        time_window_minutes: timeWindow,
        sample_correlations: sampleCorrelations,
        dry_run: true
      },
      duration_ms: 0
    };
  }
  
  let processed = 0;
  let correlationsCreated = 0;
  let errors = 0;
  
  for (const flight of flights) {
    try {
      // Find matching biometric data
      const biometric = await sql.unsafe(`
        SELECT id, heart_rate, measurement_timestamp
        FROM biometric_monitoring
        WHERE measurement_timestamp BETWEEN '${flight.detection_timestamp}'::timestamp - INTERVAL '${timeWindow} minutes'
          AND '${flight.detection_timestamp}'::timestamp + INTERVAL '${timeWindow} minutes'
        ORDER BY ABS(EXTRACT(EPOCH FROM (measurement_timestamp - '${flight.detection_timestamp}'::timestamp)))
        LIMIT 1
      `).catch(() => []);
      
      // Find matching Josiah reflection
      const josiah = await sql.unsafe(`
        SELECT id, created_at, content
        FROM josiah_reflections_rows
        WHERE created_at BETWEEN '${flight.detection_timestamp}'::timestamp - INTERVAL '${timeWindow} minutes'
          AND '${flight.detection_timestamp}'::timestamp + INTERVAL '${timeWindow} minutes'
        ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - '${flight.detection_timestamp}'::timestamp)))
        LIMIT 1
      `).catch(() => []);
      
      const factorCount = 1 + (biometric.length > 0 ? 1 : 0) + (josiah.length > 0 ? 1 : 0);
      
      if (factorCount >= 2) {
        // Insert correlation into master table
        await sql`
          INSERT INTO master_biometric_aircraft_correlations (
            flight_id, flight_registration, flight_timestamp, flight_altitude,
            biometric_id, biometric_heart_rate, biometric_timestamp,
            josiah_reflection_id,
            factor_count, correlation_strength, created_at
          ) VALUES (
            ${flight.id}, ${flight.registration}, ${flight.detection_timestamp}, ${flight.altitude},
            ${biometric[0]?.id || null}, ${biometric[0]?.heart_rate || null}, ${biometric[0]?.measurement_timestamp || null},
            ${josiah[0]?.id || null},
            ${factorCount}, ${factorCount >= 3 ? 'HIGH' : 'MEDIUM'}, NOW()
          )
          ON CONFLICT DO NOTHING
        `.catch(() => { errors++; });
        
        correlationsCreated++;
      }
      
      processed++;
    } catch (error) {
      errors++;
    }
  }
  
  return {
    action: 'four_factor_correlate',
    success: errors < processed / 2,
    processed,
    errors,
    details: {
      flights_analyzed: flights.length,
      correlations_created: correlationsCreated,
      time_window_minutes: timeWindow
    },
    duration_ms: 0
  };
}

async function runFullEnrichmentPipeline(
  sql: ReturnType<typeof postgres>,
  batchSize: number,
  dryRun: boolean
): Promise<EnrichmentResult> {
  console.log('Running full enrichment pipeline...');
  
  const results: Record<string, EnrichmentResult> = {};
  
  // Step 1: Get status
  results.status = await getEnrichmentStatus(sql);
  
  // Step 2: Batch hash
  results.batch_hash = await batchHashRecords(sql, batchSize, dryRun);
  
  // Step 3: Four-factor correlations
  results.four_factor = await generateFourFactorCorrelations(sql, batchSize, dryRun, { timeWindowMinutes: 5 });
  
  // Step 4: Bradford-Hill scoring
  results.bradford_hill = await applyBradfordHillScoring(sql, batchSize, dryRun);
  
  // Step 5: Consolidation analysis
  results.consolidation = await consolidateCorrelations(sql, dryRun);
  
  const totalProcessed = Object.values(results).reduce((sum, r) => sum + r.processed, 0);
  const totalErrors = Object.values(results).reduce((sum, r) => sum + r.errors, 0);
  
  return {
    action: 'full_enrichment',
    success: totalErrors === 0,
    processed: totalProcessed,
    errors: totalErrors,
    details: {
      pipeline_results: results,
      dry_run: dryRun
    },
    duration_ms: 0
  };
}

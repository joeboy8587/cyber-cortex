import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Define table categories for enrichment
const UNIFIED_TARGETS = {
  flight_primary: 'live_flight_detections_rows',
  biometric_primary: 'biometric_monitoring',
  josiah_primary: 'josiah_reflections_rows',
  timeline_primary: 'unified_timeline_enhanced',
  registry_primary: 'aircraft_registry_enhanced_rows',
  correlation_primary: 'correlation_events',
};

const ENRICHMENT_SOURCES = {
  flight_sources: [
    'aircraft_detections', 'aircraft_detections_enriched', 'flight_data', 
    'flight_events', 'flight_surveillance', 'flight_surveillance_analysis',
    'live_airspace_observations', 'live_flight_detections_rows', 'flight_tracking_evidence'
  ],
  biometric_sources: [
    'biometric_data', 'biometric_data_rows', 'biometric_events', 'biometric_evidence',
    'biometric_measurements', 'biometric_readings_extended', 'biometric_uploads_proper',
    'biometrics_rows', 'biometrics_rows_4', 'pulse_logs_rows', 'integrated_biometric_data'
  ],
  josiah_sources: [
    'josiah_chat_history', 'josiah_chronological_archive', 'josiah_chronological_archive_v2',
    'josiah_conversations', 'josiah_event_log', 'josiah_evidence_uploads', 
    'josiah_timeline', 'josiah_timeline_events', 'josiah_timeline_full'
  ],
  registry_sources: [
    'aircraft_registry', 'aircraft_registry_comprehensive', 'aircraft_registry_enriched',
    'aircraft_profiles', 'aircraft_ownership', 'operator_profiles', 'operator_profiles_enriched'
  ],
  correlation_sources: [
    'biometric_flight_correlations', 'biometric_flight_correlations_rows_5',
    'event_correlations', 'evidence_correlations', 'multi_factor_correlations',
    'convergence_events', 'aircraft_biometric_correlation_matrix'
  ]
};

const SAFE_DROP_CANDIDATES = [
  'aircraft_detections_1', // duplicate
  'normalized_flight_flagged_aircraft_rows_rows', // empty normalized table
  'normalized_flight_live_flight_detections_rows', // empty normalized table
  'normalized_flight_public_air_traffic_rows', // empty normalized table
  'flight_biometric_correlations', // empty table
  'mnist_test', // irrelevant ML test data
  'mnist_train_small', // irrelevant ML training data
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  if (!databaseUrl) {
    return new Response(JSON.stringify({ error: 'NEON_DATABASE_URL not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let pool: Pool | null = null;

  try {
    const { action, category, dryRun = true } = await req.json();
    
    pool = new Pool(databaseUrl, 3, true);

    const results: any = {
      action,
      timestamp: new Date().toISOString(),
      dryRun,
    };

    if (action === 'scan') {
      // Scan all tables and categorize enrichment opportunities
      const scanResults = await scanForEnrichment(pool);
      results.scan = scanResults;
    } else if (action === 'analyze_duplicates') {
      // Identify duplicate/mergeable tables
      const duplicates = await analyzeDuplicates(pool);
      results.duplicates = duplicates;
    } else if (action === 'enrich_flights') {
      // Enrich live_flight_detections_rows from source tables
      const enrichment = await enrichFlightData(pool, dryRun);
      results.flight_enrichment = enrichment;
    } else if (action === 'enrich_biometrics') {
      // Enrich biometric_monitoring from source tables
      const enrichment = await enrichBiometricData(pool, dryRun);
      results.biometric_enrichment = enrichment;
    } else if (action === 'enrich_correlations') {
      // Populate correlation_events from source tables
      const enrichment = await enrichCorrelations(pool, dryRun);
      results.correlation_enrichment = enrichment;
    } else if (action === 'merge_josiah') {
      // Merge Josiah tables into unified view
      const merge = await mergeJosiahData(pool, dryRun);
      results.josiah_merge = merge;
    } else if (action === 'cleanup_empty') {
      // Identify and optionally drop empty/duplicate tables
      const cleanup = await cleanupTables(pool, dryRun);
      results.cleanup = cleanup;
    } else if (action === 'full_enrichment') {
      // Run complete enrichment pipeline
      const full = await runFullEnrichment(pool, dryRun);
      results.full_enrichment = full;
    } else {
      return new Response(JSON.stringify({ 
        error: 'Unknown action',
        available_actions: [
          'scan', 'analyze_duplicates', 'enrich_flights', 
          'enrich_biometrics', 'enrich_correlations', 
          'merge_josiah', 'cleanup_empty', 'full_enrichment'
        ]
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Convert BigInt to Number for JSON serialization
    const safeResults = JSON.parse(JSON.stringify(results, (_, value) =>
      typeof value === 'bigint' ? Number(value) : value
    ));

    return new Response(JSON.stringify(safeResults), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Enrichment error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } finally {
    if (pool) {
      await pool.end();
    }
  }
});

async function scanForEnrichment(pool: Pool) {
  const client = await pool.connect();
  try {
    // Get all tables with row counts and sizes
    const tablesQuery = await client.queryObject<{table_name: string, row_count: number, size_bytes: number}>(`
      SELECT 
        t.table_name,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as col_count,
        pg_total_relation_size(quote_ident(t.table_name)) as size_bytes
      FROM information_schema.tables t
      WHERE t.table_schema = 'public'
      ORDER BY pg_total_relation_size(quote_ident(t.table_name)) DESC
    `);

    // Categorize tables
    const categories = {
      flight_related: [] as any[],
      biometric_related: [] as any[],
      josiah_related: [] as any[],
      registry_related: [] as any[],
      correlation_related: [] as any[],
      evidence_related: [] as any[],
      legal_related: [] as any[],
      empty_tables: [] as any[],
      duplicate_candidates: [] as any[],
      other: [] as any[],
    };

    for (const table of tablesQuery.rows) {
      const name = table.table_name.toLowerCase();
      
      // Get row count
      const countResult = await client.queryObject<{count: number}>(`
        SELECT COUNT(*) as count FROM "${table.table_name}" LIMIT 1
      `).catch(() => ({ rows: [{ count: 0 }] }));
      const rowCount = countResult.rows[0]?.count || 0;

      const tableInfo = { ...table, row_count: rowCount };

      // Categorize
      if (rowCount === 0) {
        categories.empty_tables.push(tableInfo);
      } else if (name.includes('flight') || name.includes('aircraft') || name.includes('detection')) {
        categories.flight_related.push(tableInfo);
      } else if (name.includes('biometric') || name.includes('pulse') || name.includes('heart')) {
        categories.biometric_related.push(tableInfo);
      } else if (name.includes('josiah')) {
        categories.josiah_related.push(tableInfo);
      } else if (name.includes('registry') || name.includes('operator')) {
        categories.registry_related.push(tableInfo);
      } else if (name.includes('correlation') || name.includes('convergence')) {
        categories.correlation_related.push(tableInfo);
      } else if (name.includes('evidence') || name.includes('chain') || name.includes('custody')) {
        categories.evidence_related.push(tableInfo);
      } else if (name.includes('legal') || name.includes('ada') || name.includes('rico')) {
        categories.legal_related.push(tableInfo);
      } else {
        categories.other.push(tableInfo);
      }

      // Check for duplicate patterns
      if (name.match(/_\d+$/) || name.includes('backup') || name.includes('_rows_rows')) {
        categories.duplicate_candidates.push(tableInfo);
      }
    }

    return {
      total_tables: tablesQuery.rows.length,
      categories,
      unified_targets: UNIFIED_TARGETS,
      enrichment_sources: ENRICHMENT_SOURCES,
    };
  } finally {
    client.release();
  }
}

async function analyzeDuplicates(pool: Pool) {
  const client = await pool.connect();
  try {
    const duplicates: any[] = [];

    // Check for tables with similar names (potential duplicates)
    const duplicatePatterns = [
      { pattern: 'aircraft_detections%', group: 'aircraft_detections' },
      { pattern: 'biometric%rows%', group: 'biometric_data' },
      { pattern: 'josiah_chronological%', group: 'josiah_archive' },
      { pattern: 'legal_ada_violations%', group: 'ada_violations' },
      { pattern: 'public_air_traffic%', group: 'air_traffic' },
      { pattern: '%backup%', group: 'backups' },
    ];

    for (const { pattern, group } of duplicatePatterns) {
      const result = await client.queryObject<{table_name: string}>(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name LIKE '${pattern}'
      `);
      
      if (result.rows.length > 1) {
        const tableDetails = [];
        for (const row of result.rows) {
          const countResult = await client.queryObject<{count: number}>(`
            SELECT COUNT(*) as count FROM "${row.table_name}"
          `).catch(() => ({ rows: [{ count: 0 }] }));
          tableDetails.push({
            table_name: row.table_name,
            row_count: countResult.rows[0]?.count || 0,
          });
        }
        duplicates.push({ group, tables: tableDetails });
      }
    }

    return duplicates;
  } finally {
    client.release();
  }
}

async function enrichFlightData(pool: Pool, dryRun: boolean) {
  const client = await pool.connect();
  try {
    const results = {
      sources_checked: [] as any[],
      records_to_merge: 0,
      records_merged: 0,
      new_fields_added: [] as string[],
    };

    // Check primary table structure
    const primaryCols = await client.queryObject<{column_name: string}>(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = '${UNIFIED_TARGETS.flight_primary}' AND table_schema = 'public'
    `);
    const primaryColumns = new Set(primaryCols.rows.map(r => r.column_name));

    // Check each source table for mergeable data
    for (const source of ENRICHMENT_SOURCES.flight_sources) {
      const sourceExists = await client.queryObject(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = '${source}' AND table_schema = 'public'
      `);
      
      if (sourceExists.rows.length === 0) continue;

      const sourceCount = await client.queryObject<{count: number}>(`
        SELECT COUNT(*) as count FROM "${source}"
      `).catch(() => ({ rows: [{ count: 0 }] }));

      const sourceCols = await client.queryObject<{column_name: string}>(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = '${source}' AND table_schema = 'public'
      `);

      const newCols = sourceCols.rows.filter(r => !primaryColumns.has(r.column_name));

      results.sources_checked.push({
        table: source,
        row_count: sourceCount.rows[0]?.count || 0,
        new_columns: newCols.map(c => c.column_name),
      });

      results.records_to_merge += Number(sourceCount.rows[0]?.count || 0);
    }

    // If not dry run, perform actual enrichment
    if (!dryRun) {
      // Merge aircraft_detections_enriched into primary (has enriched operator data)
      const enrichedMerge = await client.queryObject(`
        INSERT INTO ${UNIFIED_TARGETS.flight_primary} (registration, altitude, detection_timestamp, operator_enriched)
        SELECT DISTINCT registration, altitude, timestamp, operator
        FROM aircraft_detections_enriched ade
        WHERE NOT EXISTS (
          SELECT 1 FROM ${UNIFIED_TARGETS.flight_primary} lfdr
          WHERE lfdr.registration = ade.registration 
          AND lfdr.detection_timestamp = ade.timestamp
        )
        ON CONFLICT DO NOTHING
      `).catch(e => ({ rowCount: 0, error: e.message }));

      results.records_merged = (enrichedMerge as any).rowCount || 0;
    }

    return results;
  } finally {
    client.release();
  }
}

async function enrichBiometricData(pool: Pool, dryRun: boolean) {
  const client = await pool.connect();
  try {
    const results = {
      sources_checked: [] as any[],
      records_to_merge: 0,
      records_merged: 0,
    };

    for (const source of ENRICHMENT_SOURCES.biometric_sources) {
      const sourceExists = await client.queryObject(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = '${source}' AND table_schema = 'public'
      `);
      
      if (sourceExists.rows.length === 0) continue;

      const sourceCount = await client.queryObject<{count: number}>(`
        SELECT COUNT(*) as count FROM "${source}"
      `).catch(() => ({ rows: [{ count: 0 }] }));

      results.sources_checked.push({
        table: source,
        row_count: sourceCount.rows[0]?.count || 0,
      });

      results.records_to_merge += Number(sourceCount.rows[0]?.count || 0);
    }

    if (!dryRun) {
      // Merge pulse_logs into biometric_monitoring
      const pulseMerge = await client.queryObject(`
        INSERT INTO biometric_monitoring (measurement_timestamp, heart_rate, source_table)
        SELECT timestamp, heart_rate, 'pulse_logs_rows'
        FROM pulse_logs_rows plr
        WHERE heart_rate IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM biometric_monitoring bm
          WHERE bm.measurement_timestamp = plr.timestamp
          AND bm.heart_rate = plr.heart_rate
        )
        ON CONFLICT DO NOTHING
      `).catch(e => ({ rowCount: 0, error: e.message }));

      results.records_merged = (pulseMerge as any).rowCount || 0;
    }

    return results;
  } finally {
    client.release();
  }
}

async function enrichCorrelations(pool: Pool, dryRun: boolean) {
  const client = await pool.connect();
  try {
    const results = {
      four_factor_correlations: 0,
      flight_biometric_joins: 0,
      time_window: '±5 minutes',
    };

    if (!dryRun) {
      // Generate four-factor correlations
      const correlationQuery = await client.queryObject(`
        INSERT INTO correlation_events (
          event_timestamp, 
          flight_registration, 
          biometric_heart_rate,
          josiah_reflection_id,
          correlation_strength,
          correlation_type
        )
        SELECT 
          lfdr.detection_timestamp,
          lfdr.registration,
          bm.heart_rate,
          jr.id,
          CASE 
            WHEN bm.heart_rate > 100 AND lfdr.altitude < 1500 THEN 'HIGH'
            WHEN bm.heart_rate > 90 THEN 'MEDIUM'
            ELSE 'LOW'
          END as correlation_strength,
          'four_factor' as correlation_type
        FROM live_flight_detections_rows lfdr
        LEFT JOIN biometric_monitoring bm 
          ON bm.measurement_timestamp BETWEEN 
            lfdr.detection_timestamp - INTERVAL '5 minutes' 
            AND lfdr.detection_timestamp + INTERVAL '5 minutes'
        LEFT JOIN josiah_reflections_rows jr
          ON jr.created_at BETWEEN 
            lfdr.detection_timestamp - INTERVAL '10 minutes' 
            AND lfdr.detection_timestamp + INTERVAL '10 minutes'
        WHERE lfdr.registration IN ('N912KC', 'N913KC', 'N743AM', 'N229AM', 'N790FA', 'N788FA')
        AND bm.heart_rate IS NOT NULL
        LIMIT 10000
        ON CONFLICT DO NOTHING
      `).catch(e => ({ rowCount: 0, error: e.message }));

      results.four_factor_correlations = (correlationQuery as any).rowCount || 0;
    }

    return results;
  } finally {
    client.release();
  }
}

async function mergeJosiahData(pool: Pool, dryRun: boolean) {
  const client = await pool.connect();
  try {
    const results = {
      sources_analyzed: [] as any[],
      total_josiah_records: 0,
    };

    for (const source of ENRICHMENT_SOURCES.josiah_sources) {
      const sourceExists = await client.queryObject(`
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = '${source}' AND table_schema = 'public'
      `);
      
      if (sourceExists.rows.length === 0) continue;

      const sourceCount = await client.queryObject<{count: number}>(`
        SELECT COUNT(*) as count FROM "${source}"
      `).catch(() => ({ rows: [{ count: 0 }] }));

      results.sources_analyzed.push({
        table: source,
        row_count: sourceCount.rows[0]?.count || 0,
      });

      results.total_josiah_records += Number(sourceCount.rows[0]?.count || 0);
    }

    return results;
  } finally {
    client.release();
  }
}

async function cleanupTables(pool: Pool, dryRun: boolean) {
  const client = await pool.connect();
  try {
    const results = {
      empty_tables: [] as string[],
      duplicate_tables: [] as string[],
      safe_to_drop: [] as string[],
      storage_recoverable: '0 MB',
    };

    // Find empty tables
    const allTables = await client.queryObject<{table_name: string}>(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    let totalRecoverableBytes = 0;

    for (const { table_name } of allTables.rows) {
      const countResult = await client.queryObject<{count: number, size: number}>(`
        SELECT COUNT(*) as count, pg_total_relation_size('${table_name}') as size
        FROM "${table_name}"
      `).catch(() => ({ rows: [{ count: 0, size: 0 }] }));

      if (Number(countResult.rows[0]?.count || 0) === 0) {
        results.empty_tables.push(table_name);
        totalRecoverableBytes += Number(countResult.rows[0]?.size || 0);
      }

      if (SAFE_DROP_CANDIDATES.includes(table_name)) {
        results.safe_to_drop.push(table_name);
        totalRecoverableBytes += Number(countResult.rows[0]?.size || 0);
      }
    }

    results.storage_recoverable = `${(totalRecoverableBytes / 1024 / 1024).toFixed(2)} MB`;

    if (!dryRun) {
      // Drop safe candidates
      for (const tableName of SAFE_DROP_CANDIDATES) {
        await client.queryObject(`DROP TABLE IF EXISTS "${tableName}"`).catch(e => {
          console.log(`Could not drop ${tableName}: ${e.message}`);
        });
      }
    }

    return results;
  } finally {
    client.release();
  }
}

async function runFullEnrichment(pool: Pool, dryRun: boolean) {
  const results = {
    scan: await scanForEnrichment(pool),
    duplicates: await analyzeDuplicates(pool),
    flight_enrichment: await enrichFlightData(pool, dryRun),
    biometric_enrichment: await enrichBiometricData(pool, dryRun),
    correlation_enrichment: await enrichCorrelations(pool, dryRun),
    josiah_merge: await mergeJosiahData(pool, dryRun),
    cleanup: await cleanupTables(pool, dryRun),
    summary: {
      dryRun,
      timestamp: new Date().toISOString(),
    }
  };

  return results;
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ColSet = Set<string>;

const toColSet = (rows: Array<{ column_name: string }>): ColSet => new Set(rows.map((r) => r.column_name));

const pickFirstExisting = (cols: ColSet, candidates: string[]) =>
  candidates.find((c) => cols.has(c));

const buildUnifiedBiometricsUnion = (tableCols: Record<string, ColSet>) => {
  const tables = Object.keys(tableCols);

  const tsCandidates = [
    'measurement_timestamp',
    'timestamp',
    'reading_timestamp',
    'recorded_at',
    'created_at',
    'created_timestamp',
  ];
  const hrCandidates = ['heart_rate', 'hr', 'bpm', 'pulse'];
  const hrvCandidates = ['hrv', 'heart_rate_variability', 'variability'];

  const selects: string[] = [];

  // Normalize timestamps so every SELECT in the UNION returns the same type (timestamptz)
  const tsExpr = (col: string) => `NULLIF((${col})::text, '')::timestamptz`;

  for (const table of tables) {
    const cols = tableCols[table];
    const ts = pickFirstExisting(cols, tsCandidates);
    const hr = pickFirstExisting(cols, hrCandidates);
    const hrv = pickFirstExisting(cols, hrvCandidates);

    // Need at least a timestamp + heart rate to be useful
    if (!ts || !hr) continue;

    const hrvExpr = hrv ? `${hrv}::numeric` : 'NULL::numeric';

    selects.push(
      `SELECT ${tsExpr(ts)} as ts, ${hr}::numeric as heart_rate, ${hrvExpr} as hrv, '${table}' as source FROM ${table} WHERE ${ts} IS NOT NULL AND NULLIF((${ts})::text, '') IS NOT NULL`
    );
  }

  // If nothing matches, return an empty result set instead of erroring
  if (selects.length === 0) {
    return `SELECT NULL::timestamptz as ts, NULL::numeric as heart_rate, NULL::numeric as hrv, 'none'::text as source WHERE false`;
  }

  return selects.join('\nUNION ALL\n');
};

serve(async (req) => {
  console.log('populate-correlations: Received request', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
  
  if (!databaseUrl) {
    console.error('NEON_DATABASE_URL is not configured');
    return new Response(
      JSON.stringify({ error: 'Database connection not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let sql: ReturnType<typeof postgres> | null = null;
  
  try {
    const body = await req.json().catch(() => ({}));
    const { action, timeWindowMinutes = 5, batchSize = 500, day } = body as {
      action?: string;
      timeWindowMinutes?: number;
      batchSize?: number;
      day?: string;
    };

    console.log('populate-correlations: Action:', action);

    if (!action || typeof action !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing required field: action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    sql = postgres(databaseUrl, {
      ssl: 'require',
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
    });

    let result;

    switch (action) {
      case 'getCorrelationStats': {
        console.log('getCorrelationStats: Fetching table stats...');
        // Get current correlation table stats with safe table checks
        const tableChecks = await sql`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('biometric_flight_correlations', 'correlation_events', 'multi_factor_correlations', 
                             'live_flight_detections_rows', 'biometric_monitoring', 'josiah_reflections_rows')
        `;
        const existingTables = new Set((tableChecks as unknown as Array<{table_name: string}>).map(t => t.table_name));
        console.log('getCorrelationStats: Found tables:', Array.from(existingTables));
        
        const getCnt = async (table: string) => {
          if (!existingTables.has(table)) return 0;
          try {
            // Use faster approximate count for large tables
            const r = await sql!.unsafe(`SELECT reltuples::bigint AS cnt FROM pg_class WHERE relname = $1`, [table]);
            const approx = Number((r as any)[0]?.cnt || 0);
            if (approx > 0) return approx;
            // Fallback to exact count for empty/small tables
            const exact = await sql!.unsafe(`SELECT COUNT(*) as cnt FROM ${table} LIMIT 1`);
            return Number((exact as any)[0]?.cnt || 0);
          } catch (e) {
            console.error(`Error counting ${table}:`, e);
            return 0;
          }
        };
        
        result = {
          bio_flight_count: await getCnt('biometric_flight_correlations'),
          correlation_events_count: await getCnt('correlation_events'),
          multi_factor_count: await getCnt('multi_factor_correlations'),
          flight_count: await getCnt('live_flight_detections_rows'),
          biometric_count: await getCnt('biometric_monitoring'),
          josiah_count: await getCnt('josiah_reflections_rows')
        };
        console.log('getCorrelationStats: Complete', result);
        break;
      }


      case 'findFlightBiometricCorrelations': {
        // Find flights that occurred within timeWindow of biometric events
        console.log(
          `Finding flight-biometric correlations with ${timeWindowMinutes} minute window across available biometric tables...`
        );

        // Discover schemas so we never reference non-existent columns
        const biometricTables = [
          'biometric_monitoring',
          'integrated_biometric_data',
          'biometrics_rows',
          'biometric_readings_extended',
          'biometric_data_rows',
        ];

        const colRows = await sql`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY(${biometricTables}::text[])
        `;

        const tableCols: Record<string, ColSet> = {};
        for (const t of biometricTables) tableCols[t] = new Set();
        for (const r of colRows as unknown as Array<{ table_name: string; column_name: string }>) {
          if (!tableCols[r.table_name]) tableCols[r.table_name] = new Set();
          tableCols[r.table_name].add(r.column_name);
        }

        const unionSql = buildUnifiedBiometricsUnion(tableCols);

        const querySql = `
          WITH unified_biometrics AS (
            ${unionSql}
          )
          SELECT 
            f.registration,
            f.detection_timestamp as flight_time,
            f.altitude,
            f.callsign,
            b.ts as bio_time,
            b.heart_rate,
            b.hrv,
            b.source as biometric_source,
            EXTRACT(EPOCH FROM (f.detection_timestamp - b.ts))/60 as time_diff_minutes
          FROM live_flight_detections_rows f
          JOIN unified_biometrics b ON 
            ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.ts))) <= ($1::int * 60)
          WHERE f.detection_timestamp IS NOT NULL 
            AND f.registration IS NOT NULL
          ORDER BY f.detection_timestamp DESC
          LIMIT $2::int
        `;

        const correlations = await sql.unsafe(querySql, [timeWindowMinutes, batchSize]);

        const sourceBreakdown: Record<string, number> = {};
        for (const c of correlations as any[]) {
          sourceBreakdown[c.biometric_source] = (sourceBreakdown[c.biometric_source] || 0) + 1;
        }

        console.log(`Found ${correlations.length} flight-biometric correlations`);
        result = {
          count: correlations.length,
          sourceBreakdown,
          sample: (correlations as any[]).slice(0, 10),
        };
        break;
      }


      case 'findFourFactorDays': {
        // Find days with all four factors present - handle missing tables gracefully
        console.log('Finding four-factor convergence days...');
        
        try {
          // First check which tables exist
          const tableCheck = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('live_flight_detections_rows', 'biometric_monitoring', 'josiah_reflections_rows', 'ocr_aircraft_holding_patterns')
          `;
          const existingTables = new Set((tableCheck as unknown as Array<{table_name: string}>).map(t => t.table_name));
          
          if (!existingTables.has('live_flight_detections_rows')) {
            result = { stats: { total: 0, fourFactor: 0, threeFactor: 0, twoFactor: 0 }, days: [], message: 'No flight data tables found' };
            break;
          }
          
          // Build dynamic query based on available tables
          const flightDaysCte = `SELECT DISTINCT DATE(detection_timestamp) as day, COUNT(*) as flight_count FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL GROUP BY DATE(detection_timestamp)`;
          const bioDaysCte = existingTables.has('biometric_monitoring') 
            ? `SELECT DISTINCT DATE(measurement_timestamp) as day, COUNT(*) as bio_count, MAX(heart_rate) as peak_hr FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL GROUP BY DATE(measurement_timestamp)`
            : `SELECT NULL::date as day, 0 as bio_count, 0 as peak_hr WHERE false`;
          const josiahDaysCte = existingTables.has('josiah_reflections_rows')
            ? `SELECT DISTINCT DATE(created_at) as day, COUNT(*) as josiah_count FROM josiah_reflections_rows WHERE created_at IS NOT NULL GROUP BY DATE(created_at)`
            : `SELECT NULL::date as day, 0 as josiah_count WHERE false`;
          const ocrDaysCte = existingTables.has('ocr_aircraft_holding_patterns')
            ? `SELECT DISTINCT DATE(COALESCE(observation_timestamp, imported_at)) as day, COUNT(*) as ocr_count FROM ocr_aircraft_holding_patterns WHERE observation_timestamp IS NOT NULL OR imported_at IS NOT NULL GROUP BY DATE(COALESCE(observation_timestamp, imported_at))`
            : `SELECT NULL::date as day, 0 as ocr_count WHERE false`;
          
          const fourFactorDays = await sql.unsafe(`
            WITH flight_days AS (${flightDaysCte}),
            bio_days AS (${bioDaysCte}),
            josiah_days AS (${josiahDaysCte}),
            ocr_days AS (${ocrDaysCte})
            SELECT f.day, f.flight_count,
              COALESCE(b.bio_count, 0) as bio_count,
              COALESCE(b.peak_hr, 0) as peak_hr,
              COALESCE(j.josiah_count, 0) as josiah_count,
              COALESCE(o.ocr_count, 0) as ocr_count,
              CASE WHEN b.day IS NOT NULL AND j.day IS NOT NULL AND o.day IS NOT NULL THEN 4
                   WHEN (b.day IS NOT NULL AND j.day IS NOT NULL) OR (b.day IS NOT NULL AND o.day IS NOT NULL) OR (j.day IS NOT NULL AND o.day IS NOT NULL) THEN 3
                   WHEN b.day IS NOT NULL OR j.day IS NOT NULL OR o.day IS NOT NULL THEN 2
                   ELSE 1 END as factor_count
            FROM flight_days f
            LEFT JOIN bio_days b ON f.day = b.day
            LEFT JOIN josiah_days j ON f.day = j.day
            LEFT JOIN ocr_days o ON f.day = o.day
            ORDER BY factor_count DESC, f.day DESC LIMIT 200
          `);
          
          const daysArray = fourFactorDays as unknown as Array<{ factor_count: number }>;
          result = {
            stats: {
              total: daysArray.length,
              fourFactor: daysArray.filter(d => d.factor_count === 4).length,
              threeFactor: daysArray.filter(d => d.factor_count === 3).length,
              twoFactor: daysArray.filter(d => d.factor_count === 2).length
            },
            days: fourFactorDays
          };
        } catch (e) {
          console.warn('findFourFactorDays error:', e);
          result = { stats: { total: 0, fourFactor: 0, threeFactor: 0, twoFactor: 0 }, days: [], error: String(e) };
        }
        break;
      }

      case 'findKCSOBiometricCorrelations': {
        // Find KCSO aircraft correlated with biometric stress events - handle missing tables
        console.log('Finding KCSO-biometric correlations...');
        
        try {
          const tableCheck = await sql`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name IN ('live_flight_detections_rows', 'biometric_monitoring')
          `;
          const existingTables = new Set((tableCheck as unknown as Array<{table_name: string}>).map(t => t.table_name));
          
          if (!existingTables.has('live_flight_detections_rows') || !existingTables.has('biometric_monitoring')) {
            result = { count: 0, correlations: [], message: 'Required tables not found' };
            break;
          }
          
          const kcsoCorrelations = await sql`
            SELECT f.registration, f.detection_timestamp as flight_time, f.altitude,
              b.measurement_timestamp as bio_time, b.heart_rate, b.hrv,
              EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))/60 as time_diff_minutes
            FROM live_flight_detections_rows f
            JOIN biometric_monitoring b ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= ${timeWindowMinutes * 60}
            WHERE f.registration LIKE 'N91%KC' AND f.detection_timestamp IS NOT NULL AND b.measurement_timestamp IS NOT NULL
            ORDER BY b.heart_rate DESC LIMIT ${batchSize}
          `;
          result = { count: kcsoCorrelations.length, correlations: kcsoCorrelations };
        } catch (e) {
          console.warn('findKCSOBiometricCorrelations error:', e);
          result = { count: 0, correlations: [], error: String(e) };
        }
        break;
      }


      case 'calculateBradfordHillScores': {
        // Calculate Bradford Hill causation scores for aircraft
        console.log('Calculating Bradford Hill scores with available biometric schemas...');

        const biometricTables = [
          'biometric_monitoring',
          'integrated_biometric_data',
          'biometrics_rows',
          'biometric_readings_extended',
          'biometric_data_rows',
        ];

        const colRows = await sql`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY(${biometricTables}::text[])
        `;

        const tableCols: Record<string, ColSet> = {};
        for (const t of biometricTables) tableCols[t] = new Set();
        for (const r of colRows as unknown as Array<{ table_name: string; column_name: string }>) {
          if (!tableCols[r.table_name]) tableCols[r.table_name] = new Set();
          tableCols[r.table_name].add(r.column_name);
        }

        const unionSql = buildUnifiedBiometricsUnion(tableCols);

        const scoresSql = `
          WITH unified_biometrics AS (
            ${unionSql}
          ),
          aircraft_stats AS (
            SELECT 
              registration,
              COUNT(*) as detection_count,
              COUNT(DISTINCT DATE(detection_timestamp)) as unique_days,
              ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
              MIN(COALESCE(altitude, 9999)) as min_altitude
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL
            GROUP BY registration
            HAVING COUNT(*) > 5
          ),
          bio_correlation_counts AS (
            SELECT 
              f.registration,
              COUNT(*) as bio_correlations,
              MAX(b.heart_rate) as peak_hr,
              MIN(b.hrv) as min_hrv,
              COUNT(CASE WHEN b.heart_rate > 100 THEN 1 END) as stress_events
            FROM live_flight_detections_rows f
            JOIN unified_biometrics b ON 
              ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.ts))) <= 300
            WHERE f.detection_timestamp IS NOT NULL
            GROUP BY f.registration
          )
          SELECT 
            a.registration,
            a.detection_count,
            a.unique_days,
            a.avg_altitude,
            a.min_altitude,
            COALESCE(bc.bio_correlations, 0) as bio_correlations,
            COALESCE(bc.peak_hr, 0) as peak_heart_rate,
            COALESCE(bc.min_hrv, 0) as min_hrv,
            COALESCE(bc.stress_events, 0) as stress_events,
            ROUND((
              LEAST(a.detection_count / 10.0, 20) +
              LEAST(a.unique_days / 5.0, 10) +
              LEAST(COALESCE(bc.bio_correlations, 0) / 5.0, 15) +
              LEAST(COALESCE(bc.stress_events, 0) / 3.0, 15) +
              CASE WHEN a.min_altitude < 1000 THEN 10 
                   WHEN a.min_altitude < 1500 THEN 7
                   WHEN a.min_altitude < 2000 THEN 4
                   ELSE 2 END +
              LEAST(COALESCE(bc.bio_correlations, 0) / 10.0, 10)
            )::numeric, 1) as bradford_hill_score
          FROM aircraft_stats a
          LEFT JOIN bio_correlation_counts bc ON a.registration = bc.registration
          ORDER BY bradford_hill_score DESC
          LIMIT 100
        `;

        const scores = await sql.unsafe(scoresSql, []);

        console.log(`Calculated Bradford Hill scores for ${scores.length} aircraft`);
        result = {
          count: scores.length,
          scores,
        };
        break;
      }


      case 'getComprehensiveSummary': {
        // Get comprehensive evidence summary with safe table access
        console.log('Generating comprehensive evidence summary...');
        
        try {
          const tableCheck = await sql`
            SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
            AND table_name IN ('live_flight_detections_rows', 'biometric_monitoring', 'josiah_reflections_rows', 
                               'ocr_aircraft_holding_patterns', 'physician_verified_ecgs')
          `;
          const existingTables = new Set((tableCheck as unknown as Array<{table_name: string}>).map(t => t.table_name));
          
          const safeCount = async (table: string): Promise<number> => {
            if (!existingTables.has(table)) return 0;
            const r = await sql!.unsafe(`SELECT COUNT(*) as cnt FROM ${table}`);
            return Number((r as any)[0]?.cnt || 0);
          };
          
          const tableStats = {
            flights: await safeCount('live_flight_detections_rows'),
            biometrics: await safeCount('biometric_monitoring'),
            josiah_logs: await safeCount('josiah_reflections_rows'),
            ocr_patterns: await safeCount('ocr_aircraft_holding_patterns'),
            ecgs: await safeCount('physician_verified_ecgs'),
            unique_aircraft: existingTables.has('live_flight_detections_rows') 
              ? Number((await sql!.unsafe(`SELECT COUNT(DISTINCT registration) as cnt FROM live_flight_detections_rows`) as any)[0]?.cnt || 0)
              : 0
          };
          
          let topAircraft: any[] = [];
          if (existingTables.has('live_flight_detections_rows')) {
            topAircraft = await sql`SELECT registration, COUNT(*) as count FROM live_flight_detections_rows WHERE registration IS NOT NULL GROUP BY registration ORDER BY count DESC LIMIT 10`;
          }
          
          result = {
            tableStats,
            topAircraft,
            dateRange: { earliest_flight: null, latest_flight: null, earliest_bio: null, latest_bio: null },
            kcsoStats: { total_detections: 0, unique_days: 0, avg_altitude: 0 }
          };
        } catch (e) {
          console.warn('getComprehensiveSummary error:', e);
          result = { tableStats: {}, topAircraft: [], dateRange: {}, kcsoStats: {}, error: String(e) };
        }
        break;
      }

      case 'populateCorrelations': {
        // Batched insert into biometric_flight_correlations_rows_5 (or whatever columns exist)
        console.log('Populating biometric_flight_correlations_rows_5...', { timeWindowMinutes, batchSize, day });

        // First check the schema of the target table
        const schemaCheck = await sql`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = 'biometric_flight_correlations_rows_5'
          ORDER BY ordinal_position
        `;

        if (schemaCheck.length === 0) {
          throw new Error('Target table biometric_flight_correlations_rows_5 does not exist');
        }

        const columns = (schemaCheck as unknown as Array<{ column_name: string }>).map((c) => c.column_name);
        const hasCol = (c: string) => columns.includes(c);

        const insertCols: string[] = [];
        const selectExprs: string[] = [];

        const add = (col: string, expr: string) => {
          if (!hasCol(col)) return;
          insertCols.push(col);
          selectExprs.push(expr);
        };

        add('id', 'gen_random_uuid()');
        add('correlation_id', `CONCAT(f.registration, '_', DATE(f.detection_timestamp)::text)`);
        add('flight_detection_id', 'f.registration');
        add('biometric_log_id', 'b.measurement_timestamp');
        add('time_offset_minutes', `ROUND(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))/60, 2)`);
        add(
          'correlation_strength',
          `CASE 
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 60 THEN 0.9
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 180 THEN 0.7
            ELSE 0.5
          END`
        );
        add('hr_spike_detected', '(b.heart_rate > 100)');
        add('hrv_drop_detected', '(b.hrv < 30)');
        add(
          'stress_correlation_score',
          `CASE 
            WHEN b.heart_rate > 120 THEN 90
            WHEN b.heart_rate > 100 THEN 70
            WHEN b.heart_rate > 85 THEN 50
            ELSE 30
          END`
        );
        add('correlation_timestamp', 'f.detection_timestamp');
        add('created_at', 'NOW()');

        if (insertCols.length === 0) {
          throw new Error('No compatible columns found on biometric_flight_correlations_rows_5');
        }

        const dayFilter = day
          ? ` AND DATE(f.detection_timestamp) = $3::date AND DATE(b.measurement_timestamp) = $3::date `
          : '';

        // Use SQL string to avoid relying on non-existent columns.
        const insertSql = `
          INSERT INTO biometric_flight_correlations_rows_5 (${insertCols.map((c) => `"${c}"`).join(', ')})
          SELECT ${selectExprs.join(', ')}
          FROM live_flight_detections_rows f
          JOIN biometric_monitoring b
            ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= ($1::int * 60)
          WHERE f.detection_timestamp IS NOT NULL
            AND b.measurement_timestamp IS NOT NULL
            AND f.registration IS NOT NULL
            ${dayFilter}
          ORDER BY f.detection_timestamp DESC
          LIMIT $2::int
          ON CONFLICT DO NOTHING
        `;

        const params = day ? [timeWindowMinutes, batchSize, day] : [timeWindowMinutes, batchSize];
        const insertRes = await sql.unsafe(insertSql, params as any);

        const countRes = await sql`SELECT COUNT(*) as total FROM biometric_flight_correlations_rows_5`;

        result = {
          message: 'Correlations populated',
          insertedBatchRequested: batchSize,
          totalInTable: countRes[0]?.total,
          day: day ?? null,
          note: 'Insert uses dynamic column matching; if IDs are not present in source tables, surrogate keys are used.'
        };
        break;
      }

      case 'populateTemporalCorrelations': {
        // Batch-insert temporal correlations joining flight, biometric, Josiah, and OCR data
        const windowMinutes = body.windowMinutes ?? 30;
        const limit = batchSize;
        
        console.log(`Populating temporal correlations with ${windowMinutes} minute window, batch ${limit}...`);

        // First check if correlation_events table exists and get its schema
        const correlationSchema = await sql`
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name = 'correlation_events'
          ORDER BY ordinal_position
        `;

        if (correlationSchema.length === 0) {
          // Try multi_factor_correlations instead
          const multiFactorSchema = await sql`
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'multi_factor_correlations'
            ORDER BY ordinal_position
          `;

          if (multiFactorSchema.length === 0) {
            throw new Error('Neither correlation_events nor multi_factor_correlations table exists');
          }

          // Use multi_factor_correlations table
          const mfCols = (multiFactorSchema as unknown as Array<{ column_name: string }>).map(c => c.column_name);
          const hasMfCol = (c: string) => mfCols.includes(c);

          const mfInsertCols: string[] = [];
          const mfSelectExprs: string[] = [];

          const addMf = (col: string, expr: string) => {
            if (!hasMfCol(col)) return;
            mfInsertCols.push(col);
            mfSelectExprs.push(expr);
          };

          addMf('id', 'gen_random_uuid()');
          addMf('correlation_id', `CONCAT('MF_', f.registration, '_', DATE(f.detection_timestamp)::text)`);
          addMf('aircraft_registration', 'f.registration');
          addMf('flight_timestamp', 'f.detection_timestamp');
          addMf('biometric_timestamp', 'b.measurement_timestamp');
          addMf('heart_rate', 'b.heart_rate');
          addMf('hrv', 'b.hrv');
          addMf('altitude', 'f.altitude');
          addMf('time_offset_seconds', `EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))`);
          addMf('correlation_strength', `CASE 
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 60 THEN 0.95
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 300 THEN 0.8
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600 THEN 0.6
            ELSE 0.4 END`);
          addMf('factor_count', '2');
          addMf('created_at', 'NOW()');

          if (mfInsertCols.length === 0) {
            throw new Error('No compatible columns found on multi_factor_correlations');
          }

          const mfInsertSql = `
            INSERT INTO multi_factor_correlations (${mfInsertCols.map(c => `"${c}"`).join(', ')})
            SELECT ${mfSelectExprs.join(', ')}
            FROM live_flight_detections_rows f
            JOIN biometric_monitoring b
              ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= ($1::int * 60)
            WHERE f.detection_timestamp IS NOT NULL
              AND b.measurement_timestamp IS NOT NULL
              AND f.registration IS NOT NULL
            ORDER BY f.detection_timestamp DESC
            LIMIT $2::int
            ON CONFLICT DO NOTHING
          `;

          await sql.unsafe(mfInsertSql, [windowMinutes, limit]);
          const mfCount = await sql`SELECT COUNT(*) as total FROM multi_factor_correlations`;

          result = {
            message: 'Temporal correlations populated into multi_factor_correlations',
            windowMinutes,
            batchSize: limit,
            totalInTable: mfCount[0]?.total
          };
        } else {
          // Use correlation_events table
          const ceCols = (correlationSchema as unknown as Array<{ column_name: string }>).map(c => c.column_name);
          const hasCeCol = (c: string) => ceCols.includes(c);

          const ceInsertCols: string[] = [];
          const ceSelectExprs: string[] = [];

          const addCe = (col: string, expr: string) => {
            if (!hasCeCol(col)) return;
            ceInsertCols.push(col);
            ceSelectExprs.push(expr);
          };

          addCe('id', 'gen_random_uuid()');
          addCe('event_id', `CONCAT('TE_', f.registration, '_', EXTRACT(EPOCH FROM f.detection_timestamp)::text)`);
          addCe('event_type', "'temporal_correlation'");
          addCe('aircraft_registration', 'f.registration');
          addCe('event_timestamp', 'f.detection_timestamp');
          addCe('biometric_timestamp', 'b.measurement_timestamp');
          addCe('heart_rate', 'b.heart_rate');
          addCe('hrv', 'b.hrv');
          addCe('altitude', 'f.altitude');
          addCe('callsign', 'f.callsign');
          addCe('time_offset_seconds', `EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))`);
          addCe('correlation_score', `CASE 
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 60 THEN 95
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 300 THEN 80
            WHEN ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= 600 THEN 60
            ELSE 40 END`);
          addCe('created_at', 'NOW()');

          if (ceInsertCols.length === 0) {
            throw new Error('No compatible columns found on correlation_events');
          }

          const ceInsertSql = `
            INSERT INTO correlation_events (${ceInsertCols.map(c => `"${c}"`).join(', ')})
            SELECT ${ceSelectExprs.join(', ')}
            FROM live_flight_detections_rows f
            JOIN biometric_monitoring b
              ON ABS(EXTRACT(EPOCH FROM (f.detection_timestamp - b.measurement_timestamp))) <= ($1::int * 60)
            WHERE f.detection_timestamp IS NOT NULL
              AND b.measurement_timestamp IS NOT NULL
              AND f.registration IS NOT NULL
            ORDER BY f.detection_timestamp DESC
            LIMIT $2::int
            ON CONFLICT DO NOTHING
          `;

          await sql.unsafe(ceInsertSql, [windowMinutes, limit]);
          const ceCount = await sql`SELECT COUNT(*) as total FROM correlation_events`;

          result = {
            message: 'Temporal correlations populated into correlation_events',
            windowMinutes,
            batchSize: limit,
            totalInTable: ceCount[0]?.total
          };
        }
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await sql.end();

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err as Error;
    console.error('Correlation engine error:', error);
    if (sql) {
      try {
        await sql.end();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

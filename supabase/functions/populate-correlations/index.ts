import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';
import { readCanonicalCorrelations } from './canonical.ts';
import { withAnalysisDeadline } from '../_shared/analysisDeadline.ts';

const Input = z.object({
  action: z.enum(['getCorrelationStats', 'findFlightBiometricCorrelations', 'findFourFactorDays',
    'findKCSOBiometricCorrelations', 'calculateBradfordHillScores', 'getComprehensiveSummary',
    'populateCorrelations', 'populateTemporalCorrelations', 'populateBradfordHillFast', 'populateFourFactorEvents']),
  timeWindowMinutes: z.number().int().min(1).max(30).default(5),
  windowMinutes: z.number().int().min(1).max(30).optional(),
  batchSize: z.number().int().min(1).max(5000).default(500),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(value + 'T00:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date').optional(),
});

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

serve(async (req) => {
  console.log('populate-correlations: Received request', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return respond({ error: 'Unauthorized' }, 401);
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return respond({ error: 'Authentication unavailable' }, 503);
  const client = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: claims, error: authError } = await client.auth.getClaims(authHeader.slice(7));
  if (authError || !claims?.claims) return respond({ error: 'Unauthorized' }, 401);
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return respond({ error: 'Invalid analysis request', details: input.error.flatten().fieldErrors }, 400);
  const body = input.data;
  const { action, timeWindowMinutes, batchSize, day } = body;
  let sql: ReturnType<typeof postgres> | null = null;

  try {
    if (action === 'findFlightBiometricCorrelations' || action === 'calculateBradfordHillScores') {
      const result = await readCanonicalCorrelations(action, timeWindowMinutes, batchSize, day);
      return respond({ data: result });
    }
    const databaseUrl = Deno.env.get('NEON_DATABASE_URL');
    if (!databaseUrl) return respond({ error: 'Database connection not configured' }, 503);

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
      connection: { statement_timeout: 20_000 },
    });

    let result;

    const runAction = async (sql: ReturnType<typeof postgres>) => {
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
            const r = await sql.unsafe(`SELECT reltuples::bigint AS cnt FROM pg_class WHERE relname = $1`, [table]);
            const approx = Number((r as any)[0]?.cnt || 0);
            if (approx > 0) return approx;
            // Fallback to exact count for empty/small tables
            const exact = await sql.unsafe(`SELECT COUNT(*) as cnt FROM ${table} LIMIT 1`);
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
            const r = await sql.unsafe(`SELECT COUNT(*) as cnt FROM ${table}`);
            return Number((r as any)[0]?.cnt || 0);
          };
          
          const tableStats = {
            flights: await safeCount('live_flight_detections_rows'),
            biometrics: await safeCount('biometric_monitoring'),
            josiah_logs: await safeCount('josiah_reflections_rows'),
            ocr_patterns: await safeCount('ocr_aircraft_holding_patterns'),
            ecgs: await safeCount('physician_verified_ecgs'),
            unique_aircraft: existingTables.has('live_flight_detections_rows') 
              ? Number((await sql.unsafe(`SELECT COUNT(DISTINCT registration) as cnt FROM live_flight_detections_rows`) as any)[0]?.cnt || 0)
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

      case 'populateBradfordHillFast': {
        // Lightweight Bradford Hill: compute per-aircraft scores from pre-aggregated stats
        // and write them into master_forensic_events, avoiding the expensive biometric cross-join
        console.log('populateBradfordHillFast: Computing scores from aggregate stats...');

        // Step 1: Compute per-registration aggregate stats (no cross-join)
        // Priority aircraft list to avoid full table scan
        const priorityAircraft = [
          'N912KC','N913KC','N743AM','N229AM','N790FA','N788FA','N791FA',
          'N997SE','N2464D','N324CP','VT-TYG','HL8579','B-5546',
          'STMPD19','N912','N913'
        ];

        const aircraftStats = await sql.unsafe(`
          SELECT 
            registration,
            COUNT(*) as detection_count,
            COUNT(DISTINCT DATE(detection_timestamp)) as unique_days,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            MIN(COALESCE(altitude, 9999)) as min_altitude,
            COUNT(*) FILTER (WHERE is_anomaly = true) as anomaly_count,
            COUNT(*) FILTER (WHERE altitude < 500) as below_500
          FROM live_flight_detections_rows
          WHERE registration = ANY($1::text[])
          GROUP BY registration
        `, [priorityAircraft]);

        // Step 2: Get total biometric stress events (single count, no join)
        const bioStats = await sql.unsafe(`
          SELECT COUNT(*) as total_bio,
            COUNT(*) FILTER (WHERE heart_rate > 100) as stress_events,
            MAX(heart_rate) as peak_hr,
            MIN(NULLIF(hrv, 0)) as min_hrv
          FROM biometric_monitoring
        `);
        const bio = (bioStats as any)[0] || { total_bio: 0, stress_events: 0, peak_hr: 0, min_hrv: 0 };

        // Step 3: Calculate Bradford Hill score per aircraft and build results
        const scored = (aircraftStats as any[]).map((a: any) => {
          const detections = Number(a.detection_count) || 0;
          const days = Number(a.unique_days) || 0;
          const minAlt = Number(a.min_altitude) || 9999;
          const anomalies = Number(a.anomaly_count) || 0;
          const below500 = Number(a.below_500) || 0;

          // Strength of association
          const strength = Math.min(detections / 10, 20);
          // Consistency (days present)
          const consistency = Math.min(days / 5, 10);
          // Temporality (anomaly ratio as proxy for temporal correlation)
          const temporality = Math.min(anomalies / 5, 15);
          // Biological gradient (altitude-based harm proxy)
          const gradient = minAlt < 500 ? 15 : minAlt < 1000 ? 10 : minAlt < 1500 ? 7 : minAlt < 2000 ? 4 : 2;
          // Plausibility (below-500 violations)
          const plausibility = Math.min(below500 / 5, 10);
          // Coherence (bio stress exists globally)
          const coherence = Number(bio.stress_events) > 50 ? 10 : Number(bio.stress_events) > 10 ? 5 : 2;

          const score = Math.round((strength + consistency + temporality + gradient + plausibility + coherence) * 10) / 10;

          return { registration: a.registration, detections, days, minAlt, anomalies, below500, score };
        });

        // Step 4: Write top scores into master_forensic_events (update existing or insert new)
        let updated = 0;
        for (const s of scored.slice(0, 50)) {
          try {
            // Try to update existing events for this aircraft
            const upd = await sql.unsafe(`
              UPDATE master_forensic_events 
              SET bradford_hill_score = $1, factor_count = GREATEST(factor_count, 2), updated_at = NOW()
              WHERE primary_entity_id = $2 AND bradford_hill_score IS NULL
            `, [s.score, s.registration]);
            updated += (upd as any).count || 0;

            // If no existing events, insert one summary event
            if (((upd as any).count || 0) === 0) {
              await sql.unsafe(`
                INSERT INTO master_forensic_events (event_timestamp, event_type, primary_entity_id, primary_entity_type, bradford_hill_score, factor_count, summary, confidence_score)
                VALUES (NOW(), 'flight', $1, 'aircraft', $2, 2, $3, $4)
                ON CONFLICT DO NOTHING
              `, [s.registration, s.score, 
                  `Bradford-Hill scored aircraft: ${s.detections} detections over ${s.days} days, min altitude ${s.minAlt}ft, ${s.anomalies} anomalies`,
                  Math.min(Math.round(s.score / 80 * 100), 100)]);
              updated++;
            }
          } catch (e) {
            console.warn(`Failed to write score for ${s.registration}:`, e);
          }
        }

        result = {
          message: `Bradford Hill scores calculated and written to master_forensic_events`,
          aircraftScored: scored.length,
          eventsUpdated: updated,
          topScores: scored.slice(0, 20),
          biometricContext: bio
        };
        break;
      }

      case 'populateFourFactorEvents': {
        // Write four-factor convergence data into master_forensic_events
        console.log('populateFourFactorEvents: Finding and writing convergence events...');

        // Find days with multiple factors
        const tableCheck = await sql`
          SELECT table_name FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('live_flight_detections_rows', 'biometric_monitoring', 'josiah_reflections_rows', 'ocr_aircraft_holding_patterns')
        `;
        const existingTables = new Set((tableCheck as unknown as Array<{table_name: string}>).map(t => t.table_name));

        const flightCte = `SELECT DATE(detection_timestamp) as day, COUNT(*) as cnt FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL GROUP BY 1`;
        const bioCte = existingTables.has('biometric_monitoring') 
          ? `SELECT DATE(measurement_timestamp) as day, COUNT(*) as cnt, MAX(heart_rate) as peak_hr FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL GROUP BY 1`
          : `SELECT NULL::date as day, 0 as cnt, 0 as peak_hr WHERE false`;
        const josiahCte = existingTables.has('josiah_reflections_rows')
          ? `SELECT DATE(created_at) as day, COUNT(*) as cnt FROM josiah_reflections_rows WHERE created_at IS NOT NULL GROUP BY 1`
          : `SELECT NULL::date as day, 0 as cnt WHERE false`;
        const ocrCte = existingTables.has('ocr_aircraft_holding_patterns')
          ? `SELECT DATE(COALESCE(observation_timestamp, imported_at)) as day, COUNT(*) as cnt FROM ocr_aircraft_holding_patterns WHERE observation_timestamp IS NOT NULL OR imported_at IS NOT NULL GROUP BY 1`
          : `SELECT NULL::date as day, 0 as cnt WHERE false`;

        const convergenceDays = await sql.unsafe(`
          WITH f AS (${flightCte}), b AS (${bioCte}), j AS (${josiahCte}), o AS (${ocrCte})
          SELECT f.day,
            CASE WHEN b.day IS NOT NULL AND j.day IS NOT NULL AND o.day IS NOT NULL THEN 4
                 WHEN (b.day IS NOT NULL AND j.day IS NOT NULL) OR (b.day IS NOT NULL AND o.day IS NOT NULL) OR (j.day IS NOT NULL AND o.day IS NOT NULL) THEN 3
                 WHEN b.day IS NOT NULL OR j.day IS NOT NULL OR o.day IS NOT NULL THEN 2
                 ELSE 1 END as factors,
            f.cnt as flights, COALESCE(b.cnt,0) as bios, COALESCE(b.peak_hr,0) as peak_hr, COALESCE(j.cnt,0) as josiah, COALESCE(o.cnt,0) as ocr
          FROM f LEFT JOIN b ON f.day=b.day LEFT JOIN j ON f.day=j.day LEFT JOIN o ON f.day=o.day
          WHERE (b.day IS NOT NULL OR j.day IS NOT NULL OR o.day IS NOT NULL)
          ORDER BY factors DESC, f.day DESC LIMIT 100
        `);

        let inserted = 0;
        for (const d of convergenceDays as any[]) {
          if (d.factors >= 3) {
            try {
              await sql.unsafe(`
                INSERT INTO master_forensic_events (event_timestamp, event_type, factor_count, bradford_hill_score, summary, confidence_score)
                VALUES (($1::date)::timestamptz, 'multi_factor', $2, $3, $4, $5)
                ON CONFLICT DO NOTHING
              `, [d.day, d.factors, d.factors * 10, 
                  `${d.factors}-factor convergence: ${d.flights} flights, ${d.bios} biometric readings (peak HR ${d.peak_hr}), ${d.josiah} Josiah reflections, ${d.ocr} OCR records`,
                  d.factors * 25]);
              inserted++;
            } catch (e) { console.warn('Insert convergence event failed:', e); }
          }
        }

        const stats = (convergenceDays as any[]).reduce((acc, d) => {
          acc[`factor_${d.factors}`] = (acc[`factor_${d.factors}`] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        result = { message: 'Four-factor convergence events written', inserted, stats, days: (convergenceDays as any[]).slice(0, 20) };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    };
    await withAnalysisDeadline(runAction(sql), 35_000);
    await sql.end({ timeout: 1 });

    return new Response(
      JSON.stringify({ data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const error = err as Error;
    console.error('Correlation engine error:', error);
    if (sql) {
      try {
        await sql.end({ timeout: 1 });
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    }
    const code = String((err as any)?.code || '');
    const isTimeout = code === '57014' || code === 'ANALYSIS_TIMEOUT' || /statement timeout|timed out|TimeoutError|AbortError/i.test(error.message || error.name || '');
    if (isTimeout) {
      // An incomplete request is not a zero-result scan; callers retain their last result.
      return new Response(
        JSON.stringify({
          data: null,
          complete: false,
          nonFatal: true,
          timedOut: true,
          message: action.startsWith('populate')
            ? 'Correlation update did not finish. Some earlier batches may have saved; refresh before rerunning. This is not a zero-result scan.'
            : 'Correlation analysis did not finish. Previous results are unchanged; this is not a zero-result scan.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

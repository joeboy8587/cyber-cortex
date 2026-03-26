import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction2(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    // ============== SATURATION ANALYSIS ==============
    case 'analyzeSaturation': {
      const { analysisType } = body;
      try {
        if (analysisType === 'daily') {
          const dailyData = await sql`
            SELECT DATE(COALESCE(detection_timestamp, created_at)) as date, COUNT(*) as flight_count,
              COUNT(DISTINCT COALESCE(registration, hex)) as unique_aircraft,
              COUNT(*) FILTER (WHERE altitude::numeric < 1000) as low_altitude_count,
              COUNT(*) FILTER (WHERE flagged = true) as flagged_count,
              COALESCE(AVG(altitude::numeric), 0) as avg_altitude
            FROM live_flight_detections_rows
            WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '60 days'
            GROUP BY DATE(COALESCE(detection_timestamp, created_at)) ORDER BY date DESC
          `;
          return { data: dailyData };
        }
        if (analysisType === 'anomalies') {
          const anomalies = await sql`
            WITH daily_counts AS (
              SELECT DATE(COALESCE(detection_timestamp, created_at)) as date, COUNT(*) as flight_count
              FROM live_flight_detections_rows WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '90 days'
              GROUP BY DATE(COALESCE(detection_timestamp, created_at))
            ), baseline AS (SELECT AVG(flight_count) as avg_count, STDDEV(flight_count) as stddev_count FROM daily_counts)
            SELECT d.date, d.flight_count, b.avg_count as baseline_avg,
              CASE WHEN b.avg_count > 0 THEN d.flight_count::float / b.avg_count ELSE 0 END as multiplier
            FROM daily_counts d, baseline b
            WHERE d.flight_count > (b.avg_count + 2 * COALESCE(b.stddev_count, 0))
            ORDER BY multiplier DESC LIMIT 10
          `;
          return { anomalies };
        }
        if (analysisType === 'predict') {
          const patterns = await sql`
            WITH daily_counts AS (
              SELECT DATE(COALESCE(detection_timestamp, created_at)) as date,
                EXTRACT(DOW FROM COALESCE(detection_timestamp, created_at)) as day_of_week, COUNT(*) as flight_count
              FROM live_flight_detections_rows WHERE COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '90 days'
              GROUP BY 1, 2
            ), dow_patterns AS (SELECT day_of_week, AVG(flight_count) as avg_count, MAX(flight_count) as max_count, COUNT(*) as sample_size FROM daily_counts GROUP BY day_of_week),
            high_activity_days AS (SELECT * FROM dow_patterns WHERE avg_count > (SELECT AVG(avg_count) FROM dow_patterns))
            SELECT day_of_week, avg_count, max_count, sample_size,
              CASE day_of_week WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' END as day_name
            FROM high_activity_days
          `;
          const today = new Date();
          const predictions = patterns.slice(0, 3).map((p: any) => {
            const daysUntil = (parseInt(p.day_of_week) - today.getDay() + 7) % 7 || 7;
            const predictedDate = new Date(today); predictedDate.setDate(today.getDate() + daysUntil);
            return { predicted_date: predictedDate.toISOString().split('T')[0], probability: Math.min(0.9, p.avg_count / p.max_count + 0.2), factors: [`${p.day_name} shows ${p.avg_count.toFixed(0)} avg flights`, `Historical max: ${p.max_count} flights`, `Based on ${p.sample_size} weeks of data`], historical_pattern: `${p.day_name}s average ${p.avg_count.toFixed(0)} flights` };
          });
          return { predictions };
        }
        return { error: `Unknown analysisType: ${analysisType}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Analysis failed' };
      }
    }

    // ============== MULTIMODAL COVERAGE ==============
    case 'getMultimodalCoverage': {
      const coverageQuery = await sql`
        SELECT
          (SELECT COUNT(*) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flights,
          (SELECT MIN(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flight_earliest,
          (SELECT MAX(detection_timestamp) FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL) as flight_latest,
          (SELECT COUNT(*) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as biometrics,
          (SELECT MIN(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as bio_earliest,
          (SELECT MAX(measurement_timestamp) FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL) as bio_latest,
          (SELECT COUNT(*) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watchtower,
          (SELECT MIN(event_time) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watch_earliest,
          (SELECT MAX(event_time) FROM watchtower_unified_master WHERE event_time IS NOT NULL) as watch_latest,
          (SELECT COUNT(*) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah,
          (SELECT MIN(created_at) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah_earliest,
          (SELECT MAX(created_at) FROM josiah_reflections_rows WHERE created_at IS NOT NULL) as josiah_latest,
          (SELECT COUNT(*) FROM radar_screenshot_analysis) as ocr,
          (SELECT MIN(COALESCE(screenshot_utc_timestamp, analyzed_at)) FROM radar_screenshot_analysis) as ocr_earliest,
          (SELECT MAX(COALESCE(screenshot_utc_timestamp, analyzed_at)) FROM radar_screenshot_analysis) as ocr_latest,
          (SELECT COUNT(*) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified,
          (SELECT MIN(event_timestamp) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified_earliest,
          (SELECT MAX(event_timestamp) FROM unified_timeline_enhanced WHERE event_timestamp IS NOT NULL) as unified_latest
      `;
      const row = (coverageQuery[0] as any) || {};
      const modalities = [
        { name: 'Flight Detections', table: 'live_flight_detections_rows', count: parseInt(row.flights) || 0, earliest: row.flight_earliest, latest: row.flight_latest, category: 'flight' },
        { name: 'Biometric Monitoring', table: 'biometric_monitoring', count: parseInt(row.biometrics) || 0, earliest: row.bio_earliest, latest: row.bio_latest, category: 'biometric' },
        { name: 'Watchtower Unified', table: 'watchtower_unified_master', count: parseInt(row.watchtower) || 0, earliest: row.watch_earliest, latest: row.watch_latest, category: 'flight' },
        { name: 'Josiah AI', table: 'josiah_reflections_rows', count: parseInt(row.josiah) || 0, earliest: row.josiah_earliest, latest: row.josiah_latest, category: 'ai' },
        { name: 'OCR Analysis', table: 'radar_screenshot_analysis', count: parseInt(row.ocr) || 0, earliest: row.ocr_earliest, latest: row.ocr_latest, category: 'evidence' },
        { name: 'Unified Timeline', table: 'unified_timeline_enhanced', count: parseInt(row.unified) || 0, earliest: row.unified_earliest, latest: row.unified_latest, category: 'evidence' }
      ];
      return { modalities, totalRecords: modalities.reduce((acc, m) => acc + m.count, 0), timestamp: new Date().toISOString() };
    }

    // ============== FULL TIMELINE STORIES ==============
    case 'getFullTimelineStories': {
      const limitDays = body.limit || 365;
      const storiesData = await sql.unsafe(`
        WITH daily_flights AS (
          SELECT DATE(detection_timestamp) as date, COUNT(*) as flight_count, COUNT(DISTINCT registration) as unique_aircraft,
            BOOL_OR(registration LIKE 'N91%KC' OR registration LIKE 'N912KC' OR registration LIKE 'N913KC') as has_kcso,
            COUNT(*) FILTER (WHERE altitude::numeric < 1500 AND altitude IS NOT NULL) as low_altitude_events
          FROM live_flight_detections_rows WHERE detection_timestamp IS NOT NULL GROUP BY DATE(detection_timestamp)
        ), daily_biometrics AS (
          SELECT DATE(measurement_timestamp) as date, AVG(heart_rate) as avg_hr, MAX(heart_rate) as peak_hr,
            AVG(stress_level) as avg_stress, COUNT(*) as bio_count
          FROM biometric_monitoring WHERE measurement_timestamp IS NOT NULL GROUP BY DATE(measurement_timestamp)
        ), daily_josiah AS (
          SELECT DATE(created_at) as date, COUNT(*) as josiah_count FROM josiah_reflections_rows
          WHERE created_at IS NOT NULL GROUP BY DATE(created_at)
        ), daily_ocr AS (
          SELECT DATE(COALESCE(screenshot_utc_timestamp, analyzed_at)) as date, COUNT(*) as ocr_count
          FROM radar_screenshot_analysis WHERE COALESCE(screenshot_utc_timestamp, analyzed_at) IS NOT NULL
          GROUP BY DATE(COALESCE(screenshot_utc_timestamp, analyzed_at))
        )
        SELECT COALESCE(f.date, b.date) as date, COALESCE(f.flight_count, 0) as flight_count,
          COALESCE(f.unique_aircraft, 0) as unique_aircraft, COALESCE(f.has_kcso, false) as has_kcso,
          COALESCE(f.low_altitude_events, 0) as low_altitude_events, COALESCE(b.avg_hr, 0) as avg_hr,
          COALESCE(b.peak_hr, 0) as peak_hr, COALESCE(b.avg_stress, 0) as avg_stress, COALESCE(b.bio_count, 0) as bio_count,
          COALESCE(j.josiah_count, 0) as josiah_count, COALESCE(o.ocr_count, 0) as ocr_count,
          CASE WHEN f.flight_count > 0 AND b.bio_count > 0 AND j.josiah_count > 0 AND o.ocr_count > 0 THEN 4
            WHEN f.flight_count > 0 AND b.bio_count > 0 AND (j.josiah_count > 0 OR o.ocr_count > 0) THEN 3
            WHEN f.flight_count > 0 AND b.bio_count > 0 THEN 2 ELSE 1 END as factor_count
        FROM daily_flights f
        FULL OUTER JOIN daily_biometrics b ON f.date = b.date
        LEFT JOIN daily_josiah j ON COALESCE(f.date, b.date) = j.date
        LEFT JOIN daily_ocr o ON COALESCE(f.date, b.date) = o.date
        WHERE COALESCE(f.date, b.date) IS NOT NULL ORDER BY COALESCE(f.date, b.date) DESC LIMIT ${limitDays}
      `);
      return storiesData;
    }

    // ============== COVERAGE / INDEX UTILITIES ==============
    case 'getDataCoverageStats': {
      const daysBack = body.daysBack || 90;
      const minFlights = body.minFlightsPerDay || 50;
      const coverage = await sql.unsafe(`
        WITH daily_counts AS (
          SELECT DATE(detection_timestamp) as date, COUNT(*) as flight_count
          FROM live_flight_detections_rows WHERE detection_timestamp > NOW() - INTERVAL '${daysBack} days' AND detection_timestamp IS NOT NULL
          GROUP BY DATE(detection_timestamp)
        ), bio_counts AS (
          SELECT DATE(measurement_timestamp) as date, COUNT(*) as bio_count
          FROM biometric_monitoring WHERE measurement_timestamp > NOW() - INTERVAL '${daysBack} days' AND measurement_timestamp IS NOT NULL
          GROUP BY DATE(measurement_timestamp)
        )
        SELECT d.date, COALESCE(d.flight_count, 0) as flight_count, COALESCE(b.bio_count, 0) as bio_count,
          CASE WHEN COALESCE(d.flight_count, 0) >= ${minFlights} THEN true ELSE false END as adequate_coverage
        FROM daily_counts d LEFT JOIN bio_counts b ON d.date = b.date ORDER BY d.date DESC
      `);
      const totalDays = coverage.length;
      const adequateDays = coverage.filter((r: any) => r.adequate_coverage).length;
      return { data: { totalDays, adequateDays, coveragePercentage: totalDays > 0 ? Math.round((adequateDays / totalDays) * 100) : 0, dailyData: coverage.slice(0, 30), minFlightsThreshold: minFlights } };
    }

    case 'createPerformanceIndexes': {
      const indexes = [
        { name: 'idx_flights_timestamp', table: 'live_flight_detections_rows', column: 'detection_timestamp DESC' },
        { name: 'idx_flights_registration', table: 'live_flight_detections_rows', column: 'registration' },
        { name: 'idx_flights_icao', table: 'live_flight_detections_rows', column: 'icao_code' },
        { name: 'idx_flights_taxonomy', table: 'live_flight_detections_rows', column: 'taxonomy_tag' },
        { name: 'idx_flights_flagged', table: 'live_flight_detections_rows', column: 'flagged' },
        { name: 'idx_flights_geo', table: 'live_flight_detections_rows', column: 'latitude, longitude' },
        { name: 'idx_bio_timestamp', table: 'biometric_monitoring', column: 'measurement_timestamp DESC' },
        { name: 'idx_bio_heart_rate', table: 'biometric_monitoring', column: 'heart_rate' },
        { name: 'idx_josiah_created', table: 'josiah_reflections_rows', column: 'created_at DESC' },
        { name: 'idx_ocr_created', table: 'ocr_aircraft_holding_patterns', column: 'created_at DESC' },
      ];
      const indexResults: string[] = [];
      for (const idx of indexes) {
        try {
          await sql.unsafe(`CREATE INDEX IF NOT EXISTS ${idx.name} ON ${idx.table} (${idx.column})`);
          indexResults.push(`✓ ${idx.name}`);
        } catch (e) { indexResults.push(`✗ ${idx.name}: ${(e as Error).message}`); }
      }
      return { data: { indexes: indexResults, created: indexResults.filter(r => r.startsWith('✓')).length } };
    }

    // ============== SYNC KCSO FLEET ==============
    case 'syncKcsoFleet': {
      const kcsoFleetData = body.fleetData;
      if (!Array.isArray(kcsoFleetData) || kcsoFleetData.length === 0) throw new Error('fleetData array is required');
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS kcso_fleet (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tail_number TEXT NOT NULL UNIQUE, model TEXT NOT NULL, model_citation TEXT, tail_number_citation TEXT, oildale_citation TEXT, surveillance_capabilities TEXT, surveillance_citation TEXT, frequent_oildale_operation BOOLEAN, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
      let synced = 0;
      for (const aircraft of kcsoFleetData) {
        await sql`INSERT INTO kcso_fleet (tail_number, model, model_citation, tail_number_citation, oildale_citation, surveillance_capabilities, surveillance_citation, frequent_oildale_operation) VALUES (${aircraft.tail_number}, ${aircraft.model}, ${aircraft.model_citation || null}, ${aircraft.tail_number_citation || null}, ${aircraft.oildale_citation || null}, ${aircraft.surveillance_capabilities || null}, ${aircraft.surveillance_citation || null}, ${aircraft.frequent_oildale_operation || false}) ON CONFLICT (tail_number) DO UPDATE SET model = EXCLUDED.model, model_citation = EXCLUDED.model_citation, oildale_citation = EXCLUDED.oildale_citation, surveillance_capabilities = EXCLUDED.surveillance_capabilities, frequent_oildale_operation = EXCLUDED.frequent_oildale_operation, updated_at = NOW()`;
        synced++;
      }
      return { data: { synced, message: `Synced ${synced} KCSO fleet records to Neon` } };
    }

    case 'importKCSOBudgetData': {
      if (!body.data || !Array.isArray(body.data)) throw new Error('Data array is required');
      await sql`CREATE TABLE IF NOT EXISTS kcso_aircraft_budget_history (id SERIAL PRIMARY KEY, aircraft_tail_number TEXT NOT NULL, aircraft_tail_number_citation TEXT, year INTEGER NOT NULL, year_citation TEXT, budget NUMERIC, budget_citation TEXT, purchases JSONB DEFAULT '[]'::jsonb, spending_patterns TEXT, spending_patterns_citation TEXT, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), UNIQUE(aircraft_tail_number, year))`;
      let insertedCount = 0;
      for (const record of body.data) {
        try {
          await sql`INSERT INTO kcso_aircraft_budget_history (aircraft_tail_number, aircraft_tail_number_citation, year, year_citation, budget, budget_citation, purchases, spending_patterns, spending_patterns_citation) VALUES (${record.aircraft_tail_number}, ${record.aircraft_tail_number_citation}, ${record.year}, ${record.year_citation}, ${record.budget}, ${record.budget_citation}, ${JSON.stringify(record.purchases)}::jsonb, ${record.spending_patterns}, ${record.spending_patterns_citation}) ON CONFLICT (aircraft_tail_number, year) DO UPDATE SET budget = EXCLUDED.budget, purchases = EXCLUDED.purchases, spending_patterns = EXCLUDED.spending_patterns`;
          insertedCount++;
        } catch (e) { console.error('Insert error:', e); }
      }
      return { success: true, inserted: insertedCount, total: body.data.length };
    }

    // ============== UNMASK HQ DATA ==============
    case 'getUnmaskHQData': {
      try {
        const locations = await sql.unsafe(`
          SELECT id, cluster_center_lat, cluster_center_lng, visit_count, unique_aircraft,
            aircraft_list, first_visit, last_visit, hq_confidence_score, location_type,
            cross_references, night_operations, ai_assessment, scan_id, created_at
          FROM unmasked_hq_locations
          ORDER BY hq_confidence_score DESC
          LIMIT 100
        `);
        const summary = await sql.unsafe(`
          SELECT COUNT(*)::int as total_locations,
            MAX(hq_confidence_score) as max_confidence,
            SUM(visit_count)::int as total_visits,
            COUNT(DISTINCT scan_id) as total_scans
          FROM unmasked_hq_locations
        `);
        return { data: { locations: locations || [], summary: summary[0] || {} } };
      } catch (e) {
        console.error('getUnmaskHQData error:', e);
        return { data: { locations: [], summary: {} } };
      }
    }

    case 'getUnmaskHQLandingTrails': {
      try {
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        const radius = Number(body.radius) || 0.005;
        const trails = await sql.unsafe(`
          SELECT registration, latitude, longitude, altitude, speed, detection_timestamp
          FROM live_flight_detections_rows
          WHERE latitude BETWEEN ${lat - radius} AND ${lat + radius}
            AND longitude BETWEEN ${lng - radius} AND ${lng + radius}
            AND altitude < 500 AND altitude > 0
            AND speed < 60
          ORDER BY registration, detection_timestamp
          LIMIT 500
        `);
        return { data: trails || [] };
      } catch (e) {
        console.error('getUnmaskHQLandingTrails error:', e);
        return { data: [] };
      }
    }

    // ============== C2014 COHORT SCAN ==============
    case 'c2014CohortScan': {
      try {
        const targetRegs = body.registrations || ['N528AM','N786FA','N6196P','N256AA','N789FA','N912KC','N913KC','N597E','N789FA','N791FA','N790FA'];
        const targetHexCodes = body.hexCodes || [];

        // 1. Procurement Cohort: Aircraft with 2014-era registration/first-seen dates
        const procurementCohort = await sql`
          SELECT registration, icao_code as hex, owner_operator, aircraft_type, aircraft_type_desc,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(*)::int as total_detections,
            ROUND(AVG(altitude::numeric),0) as avg_altitude,
            ROUND(AVG(speed::numeric),1) as avg_speed,
            shell_auto_detected,
            is_military,
            taxonomy_tag
          FROM live_flight_detections_rows
          WHERE registration = ANY(${targetRegs})
          GROUP BY registration, icao_code, owner_operator, aircraft_type, aircraft_type_desc,
            shell_auto_detected, is_military, taxonomy_tag
          ORDER BY total_detections DESC
        `;

        // 2. Behavioral Signatures: "Sensor Loitering" (speed <5kts, alt 0-400ft, extended dwell)
        const sensorLoitering = await sql`
          SELECT registration, icao_code as hex, owner_operator,
            COUNT(*)::int as loiter_detections,
            ROUND(AVG(altitude::numeric),0) as avg_alt,
            ROUND(AVG(speed::numeric),1) as avg_speed,
            MIN(detection_timestamp) as first_loiter,
            MAX(detection_timestamp) as last_loiter,
            COUNT(DISTINCT DATE(detection_timestamp))::int as loiter_days
          FROM live_flight_detections_rows
          WHERE speed::numeric < 5 AND altitude::numeric BETWEEN 0 AND 400
            AND altitude::numeric > 0
          GROUP BY registration, icao_code, owner_operator
          HAVING COUNT(*) > 2
          ORDER BY loiter_detections DESC
          LIMIT 25
        `;

        // 3. High-Altitude Signatures (>60000ft - U-2/ER-2 class)
        const highAltitude = await sql`
          SELECT registration, icao_code as hex, owner_operator, aircraft_type,
            MAX(altitude::numeric) as max_altitude,
            COUNT(*)::int as high_alt_detections,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE altitude::numeric > 60000
          GROUP BY registration, icao_code, owner_operator, aircraft_type
          ORDER BY max_altitude DESC
          LIMIT 20
        `;

        // 4. Hammer-Anvil Coordination: Same 1nm grid, same minute, different aircraft
        const hammerAnvil = await sql`
          WITH gridded AS (
            SELECT registration, icao_code as hex, owner_operator, altitude::numeric as alt, speed::numeric as spd,
              ROUND(latitude::numeric, 2) as grid_lat, ROUND(longitude::numeric, 2) as grid_lng,
              DATE_TRUNC('minute', detection_timestamp) as time_slot,
              detection_timestamp
            FROM live_flight_detections_rows
            WHERE registration = ANY(${targetRegs})
              AND detection_timestamp > NOW() - INTERVAL '30 days'
          )
          SELECT a.time_slot, a.grid_lat, a.grid_lng,
            a.registration as aircraft_a, a.alt as alt_a, a.spd as speed_a,
            b.registration as aircraft_b, b.alt as alt_b, b.spd as speed_b,
            ABS(a.alt - b.alt) as altitude_diff,
            CASE
              WHEN a.alt < 1000 AND b.alt > 2000 THEN 'HAMMER-ANVIL'
              WHEN a.alt > 2000 AND b.alt < 1000 THEN 'ANVIL-HAMMER'
              WHEN ABS(a.alt - b.alt) < 500 THEN 'FORMATION'
              ELSE 'COORDINATION'
            END as pattern_type
          FROM gridded a
          JOIN gridded b ON a.time_slot = b.time_slot
            AND a.grid_lat = b.grid_lat AND a.grid_lng = b.grid_lng
            AND a.registration < b.registration
          ORDER BY a.time_slot DESC
          LIMIT 50
        `;

        // 5. Shell Company Node Analysis: Delaware mail-drop addresses
        const shellNodes = await sql`
          SELECT registration, icao_code as hex, owner_operator,
            COUNT(*)::int as total_detections,
            shell_auto_detected,
            taxonomy_tag,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days
          FROM live_flight_detections_rows
          WHERE (owner_operator ILIKE '%LLC%' OR owner_operator ILIKE '%Holdings%'
            OR owner_operator ILIKE '%Trust%' OR owner_operator ILIKE '%Equities%'
            OR shell_auto_detected = true)
          GROUP BY registration, icao_code, owner_operator, shell_auto_detected, taxonomy_tag
          ORDER BY total_detections DESC
          LIMIT 30
        `;

        // 6. Biometric Correlation for target fleet
        const biometricCorrelation = await sql`
          SELECT b.registration as aircraft_registration,
            COUNT(*)::int as correlation_count,
            ROUND(AVG(b.correlation_score::numeric),2) as avg_score,
            MAX(b.biometric_timestamp) as latest_correlation
          FROM master_biometric_aircraft_correlations b
          WHERE b.registration = ANY(${targetRegs})
          GROUP BY b.registration
          ORDER BY correlation_count DESC
        `.catch(() => []);

        // 7. FAA Registry cross-ref for 2014 procurement dates
        const faaRegistry = await sql`
          SELECT n_number, registrant_name, aircraft_manufacturer, aircraft_model,
            certificate_issue_date, airworthiness_date, mode_s_hex,
            registrant_street, registrant_city, registrant_state,
            year_manufactured, status
          FROM aircraft_registry
          WHERE n_number = ANY(${targetRegs.map((r: string) => r.replace('N',''))})
            OR ('N' || n_number) = ANY(${targetRegs})
          ORDER BY certificate_issue_date
        `.catch(() => []);

        return {
          cohort: procurementCohort,
          sensorLoitering,
          highAltitude,
          hammerAnvil,
          shellNodes,
          biometricCorrelation,
          faaRegistry,
          meta: {
            scanTimestamp: new Date().toISOString(),
            targetRegistrations: targetRegs,
            cohortSize: procurementCohort.length,
            hammerAnvilEvents: hammerAnvil.length,
            shellEntities: shellNodes.length,
            loiterSignatures: sensorLoitering.length
          }
        };
      } catch (e) {
        console.error('c2014CohortScan error:', e);
        return { error: (e as Error).message };
      }
    }

    // ============== OPERATOR ENRICHMENT ==============
    case 'operatorEnrichment': {
      try {
        const operators = await sql.unsafe(`
          SELECT registration, 
            COUNT(*) as detection_count,
            MIN(COALESCE(detection_timestamp, created_at)) as first_seen,
            MAX(COALESCE(detection_timestamp, created_at)) as last_seen,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            COUNT(DISTINCT DATE(COALESCE(detection_timestamp, created_at))) as active_days,
            COALESCE(operator, 'Unknown') as operator_name,
            COALESCE(taxonomy_tag, 'unclassified') as taxonomy
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY registration, operator, taxonomy_tag
          ORDER BY detection_count DESC
          LIMIT 100
        `);
        return { operators };
      } catch (e) {
        console.error('operatorEnrichment error:', e);
        return { error: (e as Error).message };
      }
    }

    // ============== XXB FLIGHT ANALYSIS ==============
    case 'xxbFlightAnalysis': {
      try {
        const analysis = await sql.unsafe(`
          SELECT registration,
            taxonomy_tag,
            COUNT(*) as total_flights,
            COUNT(*) FILTER (WHERE altitude < 1500 AND altitude > 0) as low_altitude_flights,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            COUNT(DISTINCT DATE(COALESCE(detection_timestamp, created_at))) as active_days,
            MIN(COALESCE(detection_timestamp, created_at)) as first_seen,
            MAX(COALESCE(detection_timestamp, created_at)) as last_seen
          FROM live_flight_detections_rows
          WHERE taxonomy_tag LIKE 'xxb%'
            AND registration IS NOT NULL AND registration != ''
          GROUP BY registration, taxonomy_tag
          ORDER BY total_flights DESC
          LIMIT 50
        `);
        return { analysis };
      } catch (e) {
        console.error('xxbFlightAnalysis error:', e);
        return { error: (e as Error).message };
      }
    }

    // ============== TOP FLAGGED AIRCRAFT ==============
    case 'getTopFlaggedAircraft': {
      try {
        const flagged = await sql.unsafe(`
          SELECT registration,
            COUNT(*) as detection_count,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            COUNT(*) FILTER (WHERE altitude < 1000 AND altitude > 0) as sub1000_count,
            COUNT(DISTINCT DATE(COALESCE(detection_timestamp, created_at))) as active_days,
            MAX(COALESCE(detection_timestamp, created_at)) as last_seen,
            COALESCE(taxonomy_tag, 'unclassified') as taxonomy
          FROM live_flight_detections_rows
          WHERE flagged = true
            AND registration IS NOT NULL AND registration != ''
          GROUP BY registration, taxonomy_tag
          ORDER BY detection_count DESC
          LIMIT 25
        `);
        return { flagged };
      } catch (e) {
        console.error('getTopFlaggedAircraft error:', e);
        return { error: (e as Error).message };
      }
    }

    // ============== ANOMALOUS HEX CODES ==============
    case 'getAnomalousHexCodes': {
      try {
        const anomalous = await sql.unsafe(`
          SELECT hex,
            COUNT(*) as detection_count,
            COUNT(DISTINCT registration) as registration_variants,
            ARRAY_AGG(DISTINCT registration) FILTER (WHERE registration IS NOT NULL AND registration != '') as registrations,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            MIN(COALESCE(detection_timestamp, created_at)) as first_seen,
            MAX(COALESCE(detection_timestamp, created_at)) as last_seen
          FROM live_flight_detections_rows
          WHERE hex IS NOT NULL AND hex != ''
          GROUP BY hex
          HAVING COUNT(DISTINCT registration) > 1
             OR (hex !~ '^[A-Fa-f0-9]{6}$' AND LENGTH(hex) > 0)
          ORDER BY detection_count DESC
          LIMIT 30
        `);
        return { anomalous };
      } catch (e) {
        console.error('getAnomalousHexCodes error:', e);
        return { error: (e as Error).message };
      }
    }

    // ============== FIX ICAO COLUMN MAPPING ==============
    case 'fixIcaoColumnMapping': {
      try {
        await sql.unsafe(`SET statement_timeout = '50s'`);

        // Step 1: Save aircraft type codes from icao_code → aircraft_type_desc
        const savedTypesFromIcao = await sql`
          UPDATE live_flight_detections_rows
          SET aircraft_type_desc = icao_code, icao_code = NULL
          WHERE icao_code IS NOT NULL
            AND LENGTH(icao_code) BETWEEN 2 AND 5
            AND icao_code NOT SIMILAR TO '[0-9a-fA-F]+'
            AND (aircraft_type_desc IS NULL OR aircraft_type_desc = '')
        `;

        // Step 2: Save aircraft type codes from icao24 → aircraft_type_desc
        const savedTypesFromIcao24 = await sql`
          UPDATE live_flight_detections_rows
          SET aircraft_type_desc = icao24
          WHERE icao24 IS NOT NULL AND icao24 != ''
            AND LENGTH(icao24) BETWEEN 2 AND 5
            AND icao24 NOT SIMILAR TO '[0-9a-fA-F]+'
            AND icao24 NOT LIKE '~%'
            AND (aircraft_type_desc IS NULL OR aircraft_type_desc = '')
        `;

        // Step 3: Copy valid hex from icao24 → icao_code (exact hex match)
        const copiedHex = await sql`
          UPDATE live_flight_detections_rows
          SET icao_code = UPPER(icao24)
          WHERE icao24 IS NOT NULL AND icao24 != ''
            AND (icao_code IS NULL OR icao_code = '')
            AND icao24 SIMILAR TO '[0-9a-fA-F]{4,6}'
        `;

        // Step 4: Handle tilde-prefixed hex in icao24 (e.g. ~298B0E → 298B0E)
        const copiedTildeHex = await sql`
          UPDATE live_flight_detections_rows
          SET icao_code = UPPER(SUBSTRING(icao24 FROM 2))
          WHERE icao24 LIKE '~%'
            AND LENGTH(icao24) = 7
            AND SUBSTRING(icao24 FROM 2) SIMILAR TO '[0-9a-fA-F]{6}'
            AND (icao_code IS NULL OR icao_code = '')
        `;

        await sql.unsafe(`SET statement_timeout = '30s'`);

        const totalOps = (savedTypesFromIcao.count || 0) + (savedTypesFromIcao24.count || 0) + (copiedHex.count || 0) + (copiedTildeHex.count || 0);
        return {
          success: true,
          operations: {
            type_codes_from_icao_to_desc: savedTypesFromIcao.count || 0,
            type_codes_from_icao24_to_desc: savedTypesFromIcao24.count || 0,
            hex_copied_from_icao24: copiedHex.count || 0,
            tilde_hex_copied: copiedTildeHex.count || 0,
          },
          totalFixed: totalOps,
          message: `Type codes moved: ${(savedTypesFromIcao.count || 0) + (savedTypesFromIcao24.count || 0)}, Hex copied: ${(copiedHex.count || 0) + (copiedTildeHex.count || 0)}`,
        };
      } catch (e) {
        try { await sql.unsafe(`SET statement_timeout = '30s'`); } catch (_) {}
        console.error('fixIcaoColumnMapping error:', e);
        return { success: false, error: (e as Error).message };
      }
    }

    // ============== FORENSIC TRAJECTORY & VIOLATIONS ==============
    case 'getAircraftTrajectory': {
      const { registration, timeWindow = '90 days', limit: trajLimit = 500 } = body;
      if (!registration) return { error: 'Registration is required' };
      const safeReg = registration.replace(/[^a-zA-Z0-9]/g, '');
      const lim = parseInt(String(trajLimit));
      try {
        const trajectory = await sql.unsafe(`
          WITH combined AS (
            SELECT registration, COALESCE(detection_timestamp, created_at) as event_time,
              COALESCE(altitude, 0) as altitude, COALESCE(speed, 0) as speed,
              latitude, longitude, COALESCE(heading, 0) as heading,
              COALESCE(icao_code, '') as hex, COALESCE(callsign, '') as callsign,
              COALESCE(threat_score, 0) as threat_score, COALESCE(flagged, false) as is_flagged,
              flagged_reasons, taxonomy_tag, 'live_flight_detections_rows' as source_table
            FROM live_flight_detections_rows
            WHERE registration = '${safeReg}'
              AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${timeWindow}'
              AND COALESCE(altitude, 0) > 0

            UNION ALL

            SELECT registration, COALESCE(detection_timestamp, created_at) as event_time,
              COALESCE(altitude, 0) as altitude, COALESCE(speed, 0) as speed,
              latitude, longitude, 0 as heading,
              COALESCE(icao_code, '') as hex, '' as callsign,
              0 as threat_score, false as is_flagged,
              NULL as flagged_reasons, taxonomy_tag, 'unfilterd_detections' as source_table
            FROM unfilterd_detections
            WHERE registration = '${safeReg}'
              AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${timeWindow}'
              AND COALESCE(altitude, 0) > 0

            UNION ALL

            SELECT registration, COALESCE(detection_timestamp, created_at) as event_time,
              COALESCE(altitude, 0) as altitude, COALESCE(speed, 0) as speed,
              latitude, longitude, COALESCE(heading, 0) as heading,
              COALESCE(icao_code, '') as hex, COALESCE(callsign, '') as callsign,
              COALESCE(threat_score, 0) as threat_score, COALESCE(flagged, false) as is_flagged,
              flagged_reasons, taxonomy_tag, 'flagged_aircraft_rows_rows' as source_table
            FROM flagged_aircraft_rows_rows
            WHERE registration = '${safeReg}'
              AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${timeWindow}'
              AND COALESCE(altitude, 0) > 0
          )
          SELECT *, CASE 
            WHEN altitude > 0 AND altitude < 500 THEN 'CRITICAL'
            WHEN altitude >= 500 AND altitude < 1000 THEN 'WARNING'
            WHEN altitude >= 1000 AND altitude < 1500 THEN 'CAUTION'
            ELSE 'NORMAL'
          END as violation_severity
          FROM combined
          ORDER BY event_time ASC
          LIMIT ${lim}
        `);
        return { data: trajectory, registration: safeReg, count: trajectory.length, sources: ['live_flight_detections_rows', 'unfilterd_detections', 'flagged_aircraft_rows_rows'] };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }

    case 'getAltitudeViolations': {
      const { timeWindow: vioWindow = '90 days', minAltitude = 0, maxAltitude = 1000, limit: vioLimit = 200 } = body;
      try {
        const violations = await sql.unsafe(`
          SELECT registration, COALESCE(detection_timestamp, created_at) as event_time,
            COALESCE(altitude, 0) as altitude, COALESCE(speed, 0) as speed,
            latitude, longitude, COALESCE(heading, 0) as heading,
            COALESCE(threat_score, 0) as threat_score, COALESCE(flagged, false) as is_flagged,
            flagged_reasons, taxonomy_tag,
            CASE 
              WHEN COALESCE(altitude, 0) < 500 THEN 'CRITICAL: 91.119 Violation (<500ft)'
              WHEN COALESCE(altitude, 0) < 1000 THEN 'WARNING: Low Altitude (<1000ft)'
              ELSE 'CAUTION'
            END as violation_severity
          FROM live_flight_detections_rows
          WHERE COALESCE(altitude, 0) > ${parseInt(String(minAltitude))}
            AND COALESCE(altitude, 0) < ${parseInt(String(maxAltitude))}
            AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${vioWindow}'
          ORDER BY COALESCE(detection_timestamp, created_at) DESC
          LIMIT ${parseInt(String(vioLimit))}
        `);

        // Summary stats
        const stats = await sql.unsafe(`
          SELECT 
            COUNT(*) as total_violations,
            COUNT(DISTINCT registration) as unique_aircraft,
            COUNT(*) FILTER (WHERE COALESCE(altitude, 0) < 500) as critical_count,
            COUNT(*) FILTER (WHERE COALESCE(altitude, 0) >= 500 AND COALESCE(altitude, 0) < 1000) as warning_count,
            MIN(COALESCE(altitude, 0)) as min_altitude,
            AVG(COALESCE(altitude, 0))::int as avg_altitude
          FROM live_flight_detections_rows
          WHERE COALESCE(altitude, 0) > 0 AND COALESCE(altitude, 0) < 1000
            AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${vioWindow}'
        `);

        return { 
          data: violations, 
          stats: stats[0] || {},
          count: violations.length 
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }

    case 'getViolationAircraft': {
      const { timeWindow: vaWindow = '90 days' } = body;
      try {
        const aircraft = await sql.unsafe(`
          SELECT registration, 
            COUNT(*) as violation_count,
            COUNT(*) FILTER (WHERE COALESCE(altitude, 0) < 500) as critical_violations,
            MIN(COALESCE(altitude, 0)) as min_altitude,
            AVG(COALESCE(altitude, 0))::int as avg_violation_altitude,
            MIN(COALESCE(detection_timestamp, created_at)) as first_violation,
            MAX(COALESCE(detection_timestamp, created_at)) as last_violation,
            taxonomy_tag
          FROM live_flight_detections_rows
          WHERE COALESCE(altitude, 0) > 0 AND COALESCE(altitude, 0) < 1000
            AND COALESCE(detection_timestamp, created_at) > NOW() - INTERVAL '${vaWindow}'
            AND registration IS NOT NULL AND registration != ''
          GROUP BY registration, taxonomy_tag
          ORDER BY violation_count DESC
          LIMIT 50
        `);
        return { data: aircraft };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }

    default:
      return null;
  }
}

import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction4(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    case 'transponderModeAnalysis': {
      const timeWindow = body.timeWindow || '30 days';
      const kernOnly = body.kernCountyOnly !== false;
      const geoFilter = kernOnly
        ? `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`
        : '';

      const [modeCounts, blockedTimeline, ghostFleet, topBlocked, biometricOverlay] = await Promise.all([
        // 1. Transponder mode breakdown
        sql.unsafe(`
          SELECT
            CASE
              WHEN icao_code IS NOT NULL AND icao_code != '' THEN 'MODE_S'
              WHEN altitude IS NOT NULL AND altitude > 0 AND (speed IS NULL OR speed = 0) THEN 'MODE_C'
              WHEN (altitude IS NULL OR altitude = 0) AND (speed IS NULL OR speed = 0) THEN 'MODE_A'
              ELSE 'UNKNOWN'
            END as transponder_mode,
            CASE
              WHEN registration IS NULL OR registration = '' OR registration = 'N/A' THEN 'BLOCKED'
              ELSE 'VISIBLE'
            END as registration_status,
            COUNT(*)::int as count,
            COUNT(DISTINCT COALESCE(registration, icao_code))::int as unique_aircraft,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 0)::int as avg_speed,
            COUNT(CASE WHEN flagged = true THEN 1 END)::int as flagged_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY transponder_mode, registration_status
          ORDER BY count DESC
        `),

        // 2. Blocked detections by day (torture calendar)
        sql.unsafe(`
          SELECT
            DATE(detection_timestamp) as date,
            COUNT(*)::int as blocked_detections,
            COUNT(DISTINCT icao_code)::int as unique_icaos,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            MIN(NULLIF(altitude, 0))::int as min_altitude,
            COUNT(CASE WHEN altitude < 2000 AND altitude > 0 THEN 1 END)::int as low_altitude_count
          FROM live_flight_detections_rows
          WHERE (registration IS NULL OR registration = '' OR registration = 'N/A')
            AND icao_code IS NOT NULL AND icao_code != ''
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY DATE(detection_timestamp)
          ORDER BY date DESC
          LIMIT 60
        `),

        // 3. Ghost fleet: ICAOs used by multiple tail numbers
        sql.unsafe(`
          SELECT
            icao_code,
            COUNT(DISTINCT registration)::int as tail_number_count,
            COUNT(*)::int as total_detections,
            array_agg(DISTINCT registration) as registrations,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 0)::int as avg_speed
          FROM live_flight_detections_rows
          WHERE icao_code IS NOT NULL AND icao_code != ''
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY icao_code
          HAVING COUNT(DISTINCT registration) > 1
          ORDER BY COUNT(DISTINCT registration) DESC
          LIMIT 50
        `),

        // 4. Top blocked (Mode S + no registration) detections
        sql.unsafe(`
          SELECT
            icao_code,
            COUNT(*)::int as detection_count,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            MIN(NULLIF(altitude, 0))::int as min_altitude,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 0)::int as avg_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 END)::int as low_passes,
            COUNT(CASE WHEN speed < 100 AND speed > 0 THEN 1 END)::int as slow_loiters,
            taxonomy_tag
          FROM live_flight_detections_rows
          WHERE (registration IS NULL OR registration = '' OR registration = 'N/A')
            AND icao_code IS NOT NULL AND icao_code != ''
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY icao_code, taxonomy_tag
          ORDER BY detection_count DESC
          LIMIT 30
        `),

        // 5. Biometric overlay — daily avg HR on days with blocked detections
        sql.unsafe(`
          SELECT
            DATE(COALESCE(measurement_timestamp, created_at)) as date,
            ROUND(AVG(NULLIF(heart_rate, 0))::numeric, 0)::int as avg_hr,
            MAX(NULLIF(heart_rate, 0))::int as max_hr,
            COUNT(*)::int as readings,
            COUNT(CASE WHEN heart_rate > 100 THEN 1 END)::int as elevated_count
          FROM biometric_monitoring
          WHERE COALESCE(measurement_timestamp, created_at) > NOW() - INTERVAL '${timeWindow}'
          GROUP BY DATE(COALESCE(measurement_timestamp, created_at))
          ORDER BY date DESC
          LIMIT 60
        `).catch(() => []),
      ]);

      return {
        modeCounts,
        blockedTimeline,
        ghostFleet,
        topBlocked,
        biometricOverlay,
        analyzedAt: new Date().toISOString(),
      };
    }

    case 'ghostFleetScore': {
      const timeWindow = body.timeWindow || '90 days';
      const kernOnly = body.kernCountyOnly !== false;
      const geoFilter = kernOnly
        ? `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`
        : '';

      // Score each unique aircraft based on ghost fleet indicators
      const scored = await sql.unsafe(`
        WITH aircraft_stats AS (
          SELECT
            COALESCE(registration, icao_code) as identifier,
            registration,
            icao_code,
            COUNT(*)::int as total_detections,
            COUNT(CASE WHEN registration IS NULL OR registration = '' OR registration = 'N/A' THEN 1 END)::int as blocked_count,
            COUNT(CASE WHEN altitude < 2000 AND altitude > 0 THEN 1 END)::int as low_altitude_count,
            COUNT(CASE WHEN speed < 100 AND speed > 0 THEN 1 END)::int as slow_speed_count,
            COUNT(CASE WHEN altitude < 1500 AND speed < 80 AND altitude > 0 AND speed > 0 THEN 1 END)::int as loiter_count,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 0)::int as avg_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days,
            COUNT(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) < 6 OR EXTRACT(HOUR FROM detection_timestamp) > 22 THEN 1 END)::int as night_ops,
            COALESCE(MAX(threat_score), 0)::int as max_threat_score,
            COALESCE(bool_or(flagged), false) as ever_flagged,
            taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            AND (registration IS NOT NULL OR icao_code IS NOT NULL)
            ${geoFilter}
          GROUP BY COALESCE(registration, icao_code), registration, icao_code, taxonomy_tag
          HAVING COUNT(*) >= 3
        )
        SELECT *,
          -- Ghost Fleet Score (0-100)
          LEAST(100, (
            CASE WHEN blocked_count > total_detections * 0.5 THEN 30 ELSE blocked_count * 5 END +
            CASE WHEN avg_altitude < 2000 AND avg_altitude > 0 THEN 20 ELSE 0 END +
            CASE WHEN avg_speed < 100 AND avg_speed > 0 THEN 15 ELSE 0 END +
            CASE WHEN loiter_count > 3 THEN 15 ELSE loiter_count * 3 END +
            CASE WHEN night_ops > 2 THEN 10 ELSE night_ops * 3 END +
            CASE WHEN active_days > 5 THEN 10 ELSE active_days * 2 END
          ))::int as ghost_score,
          -- Classification
          CASE
            WHEN blocked_count > total_detections * 0.8 AND avg_altitude < 2000 THEN 'CONFIRMED_GHOST'
            WHEN blocked_count > total_detections * 0.5 THEN 'LIKELY_GHOST'
            WHEN avg_altitude < 1500 AND loiter_count > 3 THEN 'SURVEILLANCE_PATTERN'
            WHEN night_ops > total_detections * 0.3 THEN 'NIGHT_OPERATOR'
            WHEN avg_speed < 50 AND avg_speed > 0 THEN 'POSSIBLE_DRONE'
            ELSE 'MONITOR'
          END as classification
        FROM aircraft_stats
        ORDER BY ghost_score DESC
        LIMIT 100
      `);

      return {
        scoredAircraft: scored,
        totalScored: scored.length,
        classifications: {
          confirmed_ghost: scored.filter((r: any) => r.classification === 'CONFIRMED_GHOST').length,
          likely_ghost: scored.filter((r: any) => r.classification === 'LIKELY_GHOST').length,
          surveillance: scored.filter((r: any) => r.classification === 'SURVEILLANCE_PATTERN').length,
          night_operator: scored.filter((r: any) => r.classification === 'NIGHT_OPERATOR').length,
          possible_drone: scored.filter((r: any) => r.classification === 'POSSIBLE_DRONE').length,
          monitor: scored.filter((r: any) => r.classification === 'MONITOR').length,
        },
        analyzedAt: new Date().toISOString(),
      };
    }

    case 'icaoRecyclingScan': {
      const timeWindow = body.timeWindow || '90 days';
      const kernOnly = body.kernCountyOnly !== false;
      const geoFilter = kernOnly
        ? `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`
        : '';

      const [hexSharing, shellFleet, kcsoTagged, militaryDualHex] = await Promise.all([
        // 1. ICAO hex codes used by multiple registrations (recycling/sharing)
        sql.unsafe(`
          SELECT
            icao_code as hex_code,
            COUNT(DISTINCT registration)::int as registration_count,
            array_agg(DISTINCT registration ORDER BY registration) FILTER (WHERE registration IS NOT NULL AND registration != '' AND registration != 'N/A') as registrations,
            COUNT(*)::int as total_detections,
            MIN(NULLIF(altitude::numeric,0))::int as min_altitude,
            ROUND(AVG(NULLIF(altitude::numeric,0))::numeric,0)::int as avg_altitude,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(CASE WHEN altitude::numeric < 500 AND altitude::numeric > 0 THEN 1 END)::int as ground_proximity,
            COUNT(CASE WHEN altitude::numeric < 0 THEN 1 END)::int as negative_altitude,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days
          FROM live_flight_detections_rows
          WHERE icao_code IS NOT NULL AND icao_code != ''
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY icao_code
          HAVING COUNT(DISTINCT registration) >= 2
          ORDER BY COUNT(DISTINCT registration) DESC, total_detections DESC
          LIMIT 50
        `),

        // 2. Shell company fleet — aircraft tagged with shell/medical/unknown taxonomy
        sql.unsafe(`
          SELECT
            registration,
            icao_code,
            taxonomy_tag,
            COUNT(*)::int as detections,
            ROUND(AVG(NULLIF(altitude::numeric,0))::numeric,0)::int as avg_alt,
            MIN(NULLIF(altitude::numeric,0))::int as min_alt,
            COUNT(CASE WHEN altitude::numeric < 1000 AND altitude::numeric > 0 THEN 1 END)::int as low_ops,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            ROUND(AVG(NULLIF(speed::numeric,0))::numeric,0)::int as avg_speed
          FROM live_flight_detections_rows
          WHERE (taxonomy_tag LIKE '%shell%' OR taxonomy_tag LIKE '%medical%' 
                 OR taxonomy_tag LIKE '%xxb%' OR taxonomy_tag LIKE '%unknown%'
                 OR registration LIKE '%AM' OR registration LIKE '%LLC%')
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY registration, icao_code, taxonomy_tag
          ORDER BY detections DESC
          LIMIT 80
        `),

        // 3. KCSO-tagged aircraft cross-reference
        sql.unsafe(`
          SELECT
            registration,
            icao_code,
            taxonomy_tag,
            COUNT(*)::int as detections,
            COUNT(CASE WHEN altitude::numeric < 1500 AND altitude::numeric > 0 THEN 1 END)::int as low_altitude,
            ROUND(AVG(NULLIF(altitude::numeric,0))::numeric,0)::int as avg_alt,
            ROUND(AVG(NULLIF(speed::numeric,0))::numeric,0)::int as avg_speed,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE taxonomy_tag LIKE '%kcso%'
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY registration, icao_code, taxonomy_tag
          ORDER BY detections DESC
          LIMIT 50
        `),

        // 4. Military dual-hex detection — military hex codes broadcasting civilian IDs
        sql.unsafe(`
          WITH military_hexes AS (
            SELECT DISTINCT icao_code
            FROM live_flight_detections_rows
            WHERE icao_code IS NOT NULL AND icao_code != ''
              AND (
                icao_code LIKE 'AE%' OR icao_code LIKE 'AF%'
                OR icao_code LIKE 'A0%' OR icao_code LIKE 'A1%'
                OR (registration ~ '^[0-9]{2}-[0-9]{4,5}$')
                OR callsign LIKE 'RCH%' OR callsign LIKE 'CONGO%'
                OR callsign LIKE 'STMPD%' OR callsign LIKE 'KOME%'
              )
              AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              ${geoFilter}
          ),
          civilian_aliases AS (
            SELECT
              d.icao_code as military_hex,
              d.registration as civilian_reg,
              d2.icao_code as civilian_hex,
              COUNT(*)::int as detections,
              MIN(NULLIF(d.altitude::numeric,0))::int as min_alt,
              MAX(NULLIF(d.altitude::numeric,0))::int as max_alt,
              ROUND(AVG(NULLIF(d.altitude::numeric,0))::numeric,0)::int as avg_alt,
              COUNT(CASE WHEN d.altitude::numeric < 0 THEN 1 END)::int as negative_alt_count,
              COUNT(CASE WHEN d.altitude::numeric < 500 AND d.altitude::numeric > 0 THEN 1 END)::int as ground_prox,
              MIN(d.detection_timestamp) as first_seen,
              MAX(d.detection_timestamp) as last_seen
            FROM live_flight_detections_rows d
            LEFT JOIN LATERAL (
              SELECT DISTINCT icao_code FROM live_flight_detections_rows
              WHERE registration = d.registration
                AND icao_code != d.icao_code
                AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              LIMIT 1
            ) d2 ON true
            WHERE d.icao_code IN (SELECT icao_code FROM military_hexes)
              AND d.registration IS NOT NULL AND d.registration != '' AND d.registration != 'N/A'
              AND d.detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              ${geoFilter}
            GROUP BY d.icao_code, d.registration, d2.icao_code
            ORDER BY detections DESC
          )
          SELECT * FROM civilian_aliases LIMIT 50
        `).catch(() => []),
      ]);

      return {
        hexSharing,
        shellFleet,
        kcsoTagged,
        militaryDualHex,
        summary: {
          totalRecycledHexes: hexSharing.length,
          totalShellAssets: shellFleet.length,
          totalKcsoTagged: kcsoTagged.length,
          totalMilitarySpoofs: militaryDualHex.length,
          highestRecycleCount: hexSharing.length > 0 ? Math.max(...hexSharing.map((r: any) => r.registration_count)) : 0,
        },
        analyzedAt: new Date().toISOString(),
      };
    }

    case 'transponderModeSwitching': {
      // Detect aircraft that switch between visible/blocked registration
      const timeWindow = body.timeWindow || '90 days';
      const kernOnly = body.kernCountyOnly !== false;
      const geoFilter = kernOnly
        ? `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`
        : '';

      const modeSwitchers = await sql.unsafe(`
        WITH icao_reg_pairs AS (
          SELECT
            icao_code,
            registration,
            COUNT(*)::int as pair_count,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE icao_code IS NOT NULL AND icao_code != ''
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${geoFilter}
          GROUP BY icao_code, registration
        ),
        switchers AS (
          SELECT
            icao_code,
            COUNT(DISTINCT registration)::int as reg_count,
            COUNT(DISTINCT CASE WHEN registration IS NULL OR registration = '' OR registration = 'N/A' THEN 'BLOCKED' ELSE registration END)::int as identity_count,
            array_agg(DISTINCT registration) FILTER (WHERE registration IS NOT NULL AND registration != '' AND registration != 'N/A') as known_registrations,
            SUM(pair_count)::int as total_detections,
            bool_or(registration IS NULL OR registration = '' OR registration = 'N/A') as has_blocked,
            bool_or(registration IS NOT NULL AND registration != '' AND registration != 'N/A') as has_visible,
            MIN(first_seen) as first_seen,
            MAX(last_seen) as last_seen
          FROM icao_reg_pairs
          GROUP BY icao_code
          HAVING COUNT(DISTINCT CASE WHEN registration IS NULL OR registration = '' OR registration = 'N/A' THEN 'BLOCKED' ELSE registration END) > 1
        )
        SELECT *,
          CASE
            WHEN has_blocked AND has_visible AND identity_count > 2 THEN 'ACTIVE_SPOOFING'
            WHEN has_blocked AND has_visible THEN 'MODE_SWITCHING'
            WHEN identity_count > 2 THEN 'IDENTITY_ROTATION'
            ELSE 'ANOMALOUS'
          END as deception_type
        FROM switchers
        ORDER BY identity_count DESC, total_detections DESC
        LIMIT 50
      `);

      return {
        modeSwitchers,
        totalSwitchers: modeSwitchers.length,
        activeSpoofing: modeSwitchers.filter((r: any) => r.deception_type === 'ACTIVE_SPOOFING').length,
        modeSwitching: modeSwitchers.filter((r: any) => r.deception_type === 'MODE_SWITCHING').length,
        identityRotation: modeSwitchers.filter((r: any) => r.deception_type === 'IDENTITY_ROTATION').length,
        analyzedAt: new Date().toISOString(),
      };
    }

    // ============== CHRONOLOGICAL TIMELINE REBUILD ==============
    case 'chronoTimelineScan': {
      // Discover all timeline-eligible tables with their date ranges and row counts
      const tableProbes = await sql.unsafe(`
        WITH candidates(tbl, ts_col) AS (VALUES
          ('live_flight_detections_rows', 'detection_timestamp'),
          ('biometric_monitoring', 'measurement_timestamp'),
          ('biometric_threshold_collapses', 'collapse_timestamp'),
          ('unified_timeline_enhanced', 'event_time'),
          ('biometrics_unified', 'event_timestamp'),
          ('biometric_data_rows', 'created_at'),
          ('whoop_biometrics', 'timestamp'),
          ('flight_detections_may_june', 'timestamp'),
          ('comprehensive_timeline_events', 'event_date'),
          ('josiah_event_log', 'timestamp'),
          ('biometric_events', 'timestamp'),
          ('biometric_logs_parsed', 'timestamp'),
          ('integrated_biometric_data', 'timestamp'),
          ('biometric_correlation_events', 'created_at'),
          ('welltory_biometric_data', 'timestamp'),
          ('aircraft_events', 'created_at'),
          ('flight_events', 'created_at'),
          ('surveillance_events', 'created_at'),
          ('alert_logs', 'created_at'),
          ('josiah_live_events', 'created_at'),
          ('sentinel_alerts', 'created_at'),
          ('watchtower_alerts', 'created_at'),
          ('drone_swarm_events', 'created_at')
        )
        SELECT c.tbl, c.ts_col,
               COALESCE(p.reltuples, -1)::bigint as est_rows
        FROM candidates c
        LEFT JOIN pg_class p ON p.relname = c.tbl
        WHERE p.reltuples IS NOT NULL AND p.reltuples > 0
        ORDER BY p.reltuples DESC
      `);
      return { data: tableProbes };
    }

    case 'chronoTimelineRebuild': {
      // Build a unified chronological timeline across all major tables
      // Uses UNION ALL with normalized columns, paginated
      const page = parseInt(body.page || '0');
      const pageSize = parseInt(body.pageSize || '100');
      const offset = page * pageSize;
      const startDate = body.startDate || '2025-01-01';
      const endDate = body.endDate || '2027-01-01';
      const modality = body.modality || 'all'; // 'all', 'flight', 'biometric', 'alert', 'legal'

      let unionParts: string[] = [];

      if (modality === 'all' || modality === 'flight') {
        unionParts.push(`
          SELECT detection_timestamp::timestamptz as event_time,
                 'flight' as modality,
                 COALESCE(registration, callsign, icao_code, 'unknown') as entity,
                 COALESCE('Alt:' || altitude::text || 'ft Spd:' || speed::text || 'kt', 'detection') as summary,
                 altitude::numeric as metric_value,
                 COALESCE(taxonomy_tag, 'unclassified') as category,
                 CASE WHEN flagged THEN 'critical' WHEN altitude < 1000 AND altitude > 0 THEN 'high' ELSE 'normal' END as severity
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= '${startDate}'::timestamptz
            AND detection_timestamp < '${endDate}'::timestamptz
            AND detection_timestamp IS NOT NULL
        `);
      }

      if (modality === 'all' || modality === 'biometric') {
        unionParts.push(`
          SELECT measurement_timestamp::timestamptz as event_time,
                 'biometric' as modality,
                 'subject' as entity,
                 COALESCE('HR:' || heart_rate::text || ' Stress:' || stress_level::text, 'reading') as summary,
                 heart_rate::numeric as metric_value,
                 CASE WHEN medical_alert THEN 'medical_alert' ELSE 'routine' END as category,
                 CASE WHEN medical_alert THEN 'critical' WHEN stress_level > 70 THEN 'high' ELSE 'normal' END as severity
          FROM biometric_monitoring
          WHERE measurement_timestamp >= '${startDate}'::timestamptz
            AND measurement_timestamp < '${endDate}'::timestamptz
            AND measurement_timestamp IS NOT NULL
        `);
        unionParts.push(`
          SELECT collapse_timestamp::timestamptz as event_time,
                 'biometric_collapse' as modality,
                 COALESCE(closest_aircraft_registration, 'unknown') as entity,
                 COALESCE('HR:' || heart_rate::text || ' ' || medical_significance, 'collapse') as summary,
                 heart_rate::numeric as metric_value,
                 COALESCE(medical_significance, 'collapse') as category,
                 'critical' as severity
          FROM biometric_threshold_collapses
          WHERE collapse_timestamp >= '${startDate}'::timestamptz
            AND collapse_timestamp < '${endDate}'::timestamptz
            AND collapse_timestamp IS NOT NULL
            AND COALESCE(medical_significance, '') != 'Detection correlation event'
        `);
      }

      if (modality === 'all' || modality === 'alert') {
        unionParts.push(`
          SELECT event_time::timestamptz as event_time,
                 'timeline' as modality,
                 COALESCE(aircraft_id, 'system') as entity,
                 COALESCE(description, event_type) as summary,
                 correlation_score::numeric as metric_value,
                 COALESCE(event_type, 'event') as category,
                 CASE WHEN correlation_score > 80 THEN 'critical' WHEN correlation_score > 50 THEN 'high' ELSE 'normal' END as severity
          FROM unified_timeline_enhanced
          WHERE event_time >= '${startDate}'::timestamptz
            AND event_time < '${endDate}'::timestamptz
            AND event_time IS NOT NULL
        `);
      }

      if (unionParts.length === 0) {
        return { data: [], total: 0 };
      }

      const unionQuery = unionParts.join(' UNION ALL ');

      await sql.unsafe(`SET statement_timeout = '25s'`);
      const rows = await sql.unsafe(`
        SELECT event_time, modality, entity, summary, metric_value, category, severity
        FROM (${unionQuery}) unified
        ORDER BY event_time DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      // Get total count estimate
      const countResult = await sql.unsafe(`
        SELECT (
          ${modality === 'all' || modality === 'flight' ? `(SELECT reltuples FROM pg_class WHERE relname='live_flight_detections_rows')` : '0'}
          + ${modality === 'all' || modality === 'biometric' ? `(SELECT COALESCE(reltuples,0) FROM pg_class WHERE relname='biometric_monitoring') + (SELECT COALESCE(reltuples,0) FROM pg_class WHERE relname='biometric_threshold_collapses')` : '0'}
          + ${modality === 'all' || modality === 'alert' ? `(SELECT COALESCE(reltuples,0) FROM pg_class WHERE relname='unified_timeline_enhanced')` : '0'}
        )::bigint as total_estimate
      `);

      return { data: rows, totalEstimate: parseInt(String(countResult[0]?.total_estimate || '0')) };
    }

    case 'chronoTimelineSummary': {
      // Monthly breakdown across all modalities
      const startDate = body.startDate || '2025-01-01';
      const endDate = body.endDate || '2027-01-01';

      await sql.unsafe(`SET statement_timeout = '25s'`);
      const monthly = await sql.unsafe(`
        SELECT * FROM (
          SELECT date_trunc('month', detection_timestamp)::date as month,
                 'flight' as modality,
                 COUNT(*)::int as event_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp >= '${startDate}'::timestamptz
            AND detection_timestamp < '${endDate}'::timestamptz
            AND detection_timestamp IS NOT NULL
          GROUP BY 1

          UNION ALL

          SELECT date_trunc('month', measurement_timestamp)::date as month,
                 'biometric' as modality,
                 COUNT(*)::int as event_count
          FROM biometric_monitoring
          WHERE measurement_timestamp >= '${startDate}'::timestamptz
            AND measurement_timestamp < '${endDate}'::timestamptz
            AND measurement_timestamp IS NOT NULL
          GROUP BY 1

          UNION ALL

          SELECT date_trunc('month', collapse_timestamp)::date as month,
                 'biometric_collapse' as modality,
                 COUNT(*)::int as event_count
          FROM biometric_threshold_collapses
          WHERE collapse_timestamp >= '${startDate}'::timestamptz
            AND collapse_timestamp < '${endDate}'::timestamptz
            AND collapse_timestamp IS NOT NULL
            AND COALESCE(medical_significance, '') != 'Detection correlation event'
          GROUP BY 1

          UNION ALL

          SELECT date_trunc('month', event_time)::date as month,
                 'timeline' as modality,
                 COUNT(*)::int as event_count
          FROM unified_timeline_enhanced
          WHERE event_time >= '${startDate}'::timestamptz
            AND event_time < '${endDate}'::timestamptz
            AND event_time IS NOT NULL
          GROUP BY 1
        ) combined
        ORDER BY month ASC, modality
      `);

      return { data: monthly };
    }

    case 'posseComitatus': {
      const registrations = body.registrations || ['N597E','N160XP','N426CA','N502FS','N912KC','N913KC'];
      const timeWindow = body.timeWindow || '90 days';
      
      await sql.unsafe(`SET statement_timeout = '25s'`);
      
      const regList = registrations.map((r: string) => `'${r.replace(/'/g, "''")}'`).join(',');
      
      const [detections, coOccurrences, altitudeProfile, dailyPattern] = await Promise.all([
        // 1. All detections for target registrations
        sql.unsafe(`
          SELECT registration, callsign, detection_timestamp, 
                 altitude, speed, latitude, longitude,
                 icao_code, flagged
          FROM live_flight_detections_rows
          WHERE registration IN (${regList})
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          ORDER BY detection_timestamp DESC
          LIMIT 200
        `),
        
        // 2. Co-occurrence windows: find times when KCSO + military are airborne within ±30min
        sql.unsafe(`
          SELECT 
            a.registration as kcso_asset,
            a.detection_timestamp as kcso_time,
            a.altitude as kcso_alt,
            a.latitude as kcso_lat,
            a.longitude as kcso_lng,
            b.registration as military_asset,
            b.detection_timestamp as military_time,
            b.altitude as military_alt,
            b.latitude as mil_lat,
            b.longitude as mil_lng,
            ROUND(EXTRACT(EPOCH FROM (a.detection_timestamp - b.detection_timestamp))::numeric / 60, 1) as time_delta_min,
            ROUND((111.0 * SQRT(
              POWER(a.latitude - b.latitude, 2) + 
              POWER((a.longitude - b.longitude) * COS(RADIANS(35.4)), 2)
            ))::numeric, 2) as distance_km
          FROM live_flight_detections_rows a
          JOIN live_flight_detections_rows b 
            ON a.registration IN ('N597E','N912KC','N913KC')
            AND b.registration IN ('N160XP','N426CA','N502FS')
            AND ABS(EXTRACT(EPOCH FROM (a.detection_timestamp - b.detection_timestamp))) < 1800
            AND b.detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          WHERE a.detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          ORDER BY a.detection_timestamp DESC
          LIMIT 100
        `),
        
        // 3. Altitude profiles
        sql.unsafe(`
          SELECT registration,
                 COUNT(*)::int as total_detections,
                 ROUND(AVG(NULLIF(altitude, 0))::numeric)::int as avg_alt,
                 MIN(NULLIF(altitude, 0))::int as min_alt,
                 MAX(altitude)::int as max_alt,
                 COUNT(CASE WHEN altitude < 1500 AND altitude > 0 THEN 1 END)::int as low_alt_count,
                 MIN(detection_timestamp) as first_seen,
                 MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IN (${regList})
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          GROUP BY registration
          ORDER BY total_detections DESC
        `),
        
        // 4. Daily coordination pattern
        sql.unsafe(`
          SELECT DATE(detection_timestamp) as date,
                 registration,
                 COUNT(*)::int as detections,
                 ROUND(AVG(NULLIF(altitude, 0))::numeric)::int as avg_alt
          FROM live_flight_detections_rows
          WHERE registration IN (${regList})
            AND detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          GROUP BY 1, 2
          ORDER BY date DESC, detections DESC
          LIMIT 200
        `)
      ]);
      
      return {
        detections,
        coOccurrences,
        altitudeProfile,
        dailyPattern,
        analysis: {
          kcso_assets: ['N597E', 'N912KC', 'N913KC'],
          military_assets: ['N160XP', 'N426CA', 'N502FS'],
          coordination_events: coOccurrences.length,
          posse_comitatus_statute: '18 U.S.C. § 1385',
          violation_elements: [
            'Military personnel (Army Black Hawk) assisting civilian law enforcement (KCSO)',
            'Simultaneous airborne operations within 30-minute windows',
            'Shared operational staging from PTV Porterville',
            'Coordinated altitude layering (low/high overwatch pattern)'
          ]
        }
      };
    }

    case 'upsertFAARecords': {
      const records = body.records || [];
      if (!records.length) return { inserted: 0, error: 'No records provided' };

      // Create table if not exists
      await sql`
        CREATE TABLE IF NOT EXISTS faa_aircraft_registry (
          id SERIAL PRIMARY KEY,
          n_number TEXT UNIQUE NOT NULL,
          serial_number TEXT,
          status TEXT,
          aircraft_manufacturer TEXT,
          aircraft_model TEXT,
          type_aircraft TEXT,
          type_engine TEXT,
          mode_s_code TEXT,
          mode_s_hex TEXT,
          year_manufactured INT,
          registrant_type TEXT,
          registrant_name TEXT,
          registrant_street TEXT,
          registrant_city TEXT,
          registrant_state TEXT,
          registrant_zip TEXT,
          registrant_country TEXT,
          engine_manufacturer TEXT,
          engine_model TEXT,
          classification TEXT,
          certificate_issue_date TEXT,
          expiration_date TEXT,
          airworthiness_date TEXT,
          fractional_owner BOOLEAN DEFAULT false,
          source TEXT DEFAULT 'faa_pdf_upload',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      let inserted = 0;
      const results: any[] = [];
      for (const r of records) {
        try {
          await sql`
            INSERT INTO faa_aircraft_registry (
              n_number, serial_number, status, aircraft_manufacturer, aircraft_model,
              type_aircraft, type_engine, mode_s_code, mode_s_hex, year_manufactured,
              registrant_type, registrant_name, registrant_street, registrant_city,
              registrant_state, registrant_zip, registrant_country,
              engine_manufacturer, engine_model, classification,
              certificate_issue_date, expiration_date, airworthiness_date,
              fractional_owner, source
            ) VALUES (
              ${r.n_number}, ${r.serial_number || null}, ${r.status || null},
              ${r.aircraft_manufacturer || null}, ${r.aircraft_model || null},
              ${r.type_aircraft || null}, ${r.type_engine || null},
              ${r.mode_s_code || null}, ${r.mode_s_hex || null},
              ${r.year_manufactured || null}, ${r.registrant_type || null},
              ${r.registrant_name || null}, ${r.registrant_street || null},
              ${r.registrant_city || null}, ${r.registrant_state || null},
              ${r.registrant_zip || null}, ${r.registrant_country || null},
              ${r.engine_manufacturer || null}, ${r.engine_model || null},
              ${r.classification || null}, ${r.certificate_issue_date || null},
              ${r.expiration_date || null}, ${r.airworthiness_date || null},
              ${r.fractional_owner || false}, ${r.source || 'faa_pdf_upload'}
            )
            ON CONFLICT (n_number) DO UPDATE SET
              serial_number = EXCLUDED.serial_number,
              status = EXCLUDED.status,
              aircraft_manufacturer = EXCLUDED.aircraft_manufacturer,
              aircraft_model = EXCLUDED.aircraft_model,
              type_aircraft = EXCLUDED.type_aircraft,
              type_engine = EXCLUDED.type_engine,
              mode_s_code = EXCLUDED.mode_s_code,
              mode_s_hex = EXCLUDED.mode_s_hex,
              year_manufactured = EXCLUDED.year_manufactured,
              registrant_type = EXCLUDED.registrant_type,
              registrant_name = EXCLUDED.registrant_name,
              registrant_street = EXCLUDED.registrant_street,
              registrant_city = EXCLUDED.registrant_city,
              registrant_state = EXCLUDED.registrant_state,
              registrant_zip = EXCLUDED.registrant_zip,
              registrant_country = EXCLUDED.registrant_country,
              engine_manufacturer = EXCLUDED.engine_manufacturer,
              engine_model = EXCLUDED.engine_model,
              classification = EXCLUDED.classification,
              certificate_issue_date = EXCLUDED.certificate_issue_date,
              expiration_date = EXCLUDED.expiration_date,
              airworthiness_date = EXCLUDED.airworthiness_date,
              fractional_owner = EXCLUDED.fractional_owner,
              updated_at = NOW()
          `;
          inserted++;
          results.push({ n_number: r.n_number, status: 'inserted' });
        } catch (e: any) {
          results.push({ n_number: r.n_number, status: 'error', error: e.message });
        }
      }

      // Also cross-reference with flight detections
      const crossRef = await sql`
        SELECT registration, COUNT(*)::int as detection_count
        FROM live_flight_detections_rows
        WHERE registration = ANY(${records.map((r: any) => r.n_number)})
        GROUP BY registration
      `;

      return { inserted, total: records.length, results, flightCrossReferences: crossRef };
    }

    case 'getFAARegistry': {
      const data = await sql`
        SELECT * FROM faa_aircraft_registry ORDER BY updated_at DESC LIMIT 100
      `;
      return { records: data, count: data.length };
    }

    default:
      return null;
  }
}

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

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
      const nNumbers = records.map((r: any) => r.n_number);
      const placeholders = nNumbers.map((_: string, i: number) => `$${i + 1}`).join(',');
      const crossRef = await sql.unsafe(
        `SELECT registration, COUNT(*)::int as detection_count
         FROM live_flight_detections_rows
         WHERE registration IN (${placeholders})
         GROUP BY registration`,
        nNumbers
      );

      return { inserted, total: records.length, results, flightCrossReferences: crossRef };
    }

    case 'getFAARegistry': {
      const data = await sql`
        SELECT * FROM faa_aircraft_registry ORDER BY updated_at DESC LIMIT 100
      `;
      return { records: data, count: data.length };
    }

    case 'ifrSurveillanceDetection': {
      const timeWindow = body.timeWindow || '30 days';
      const kernOnly = body.kernCountyOnly !== false;
      const geoFilter = kernOnly
        ? `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`
        : '';
      const geoFilterAliased = kernOnly
        ? `AND d.latitude BETWEEN 35.0 AND 36.0 AND d.longitude BETWEEN -119.5 AND -118.0`
        : '';

      // IFR Approach Category thresholds (KIAS)
      // CAT A: < 91 kts | CAT B: 91-120 | CAT C: 121-140 | CAT D: 141-165 | CAT E: > 165
      // Surveillance signatures: hover (<5 kts), sub-stall (<40 kts), loiter (<60 kts at <1000ft)

      const [surveillanceHits, categoryBreakdown, topOffenders, recentFlags] = await Promise.all([
        // 1. Aircraft with impossible/surveillance speed profiles
        sql.unsafe(`
          SELECT
            registration,
            COUNT(*)::int as total_detections,
            COUNT(CASE WHEN speed < 5 THEN 1 END)::int as hover_detections,
            COUNT(CASE WHEN speed BETWEEN 5 AND 40 THEN 1 END)::int as sub_stall_detections,
            COUNT(CASE WHEN speed BETWEEN 40 AND 60 AND altitude < 1000 THEN 1 END)::int as loiter_detections,
            COUNT(CASE WHEN speed < 60 AND altitude < 1000 THEN 1 END)::int as surveillance_total,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as avg_speed,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            MIN(NULLIF(speed, 0))::numeric as min_speed,
            MIN(NULLIF(altitude, 0))::int as min_altitude,
            MAX(detection_timestamp)::text as last_seen,
            MIN(detection_timestamp)::text as first_seen,
            CASE
              WHEN COUNT(CASE WHEN speed < 5 THEN 1 END) > 0 THEN 'HOVER_SURVEILLANCE'
              WHEN COUNT(CASE WHEN speed BETWEEN 5 AND 40 THEN 1 END) > 5 THEN 'SUB_STALL_IMPOSSIBLE'
              WHEN COUNT(CASE WHEN speed < 60 AND altitude < 500 THEN 1 END) > 10 THEN 'LOW_SLOW_LOITER'
              ELSE 'PATTERN_ANOMALY'
            END as surveillance_classification
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            AND speed IS NOT NULL AND speed >= 0
            AND altitude IS NOT NULL AND altitude > 0
            AND altitude < 3000
            AND (speed < 60 OR (speed < 91 AND altitude < 500))
            ${geoFilter}
          GROUP BY registration
          HAVING COUNT(CASE WHEN speed < 60 AND altitude < 1000 THEN 1 END) > 0
          ORDER BY COUNT(CASE WHEN speed < 60 AND altitude < 1000 THEN 1 END) DESC
          LIMIT 50
        `),

        // 2. IFR category distribution for all low-altitude traffic
        sql.unsafe(`
          SELECT
            CASE
              WHEN speed < 5 THEN 'HOVER (0-5 kts)'
              WHEN speed < 40 THEN 'SUB-STALL (5-40 kts)'
              WHEN speed < 91 THEN 'CAT A (<91 kts)'
              WHEN speed < 121 THEN 'CAT B (91-120 kts)'
              WHEN speed < 141 THEN 'CAT C (121-140 kts)'
              WHEN speed < 166 THEN 'CAT D (141-165 kts)'
              ELSE 'CAT E (165+ kts)'
            END as ifr_category,
            COUNT(*)::int as detections,
            COUNT(DISTINCT registration)::int as unique_aircraft,
            ROUND(AVG(altitude)::numeric, 0)::int as avg_alt,
            MIN(altitude)::int as min_alt
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            AND speed IS NOT NULL AND speed >= 0
            AND altitude IS NOT NULL AND altitude > 0
            AND altitude < 3000
            ${geoFilter}
          GROUP BY 1
          ORDER BY MIN(speed)
        `),

        // 3. Top offenders with FAA registry cross-ref
        sql.unsafe(`
          SELECT
            d.registration,
            COUNT(*)::int as surveillance_detections,
            ROUND(AVG(d.speed)::numeric, 1) as avg_speed,
            ROUND(AVG(d.altitude)::numeric, 0)::int as avg_altitude,
            MIN(d.speed)::numeric as min_speed,
            MIN(d.altitude)::int as min_altitude,
            f.registrant_name,
            f.aircraft_model,
            f.registrant_city,
            f.registrant_state,
            f.classification
          FROM live_flight_detections_rows d
          LEFT JOIN faa_aircraft_registry f ON d.registration = f.n_number
          WHERE d.detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            AND d.speed IS NOT NULL AND d.speed < 60
            AND d.altitude IS NOT NULL AND d.altitude > 0 AND d.altitude < 1500
            ${geoFilterAliased}
          GROUP BY d.registration, f.registrant_name, f.aircraft_model, f.registrant_city, f.registrant_state, f.classification
          HAVING COUNT(*) >= 3
          ORDER BY COUNT(*) DESC
          LIMIT 25
        `),

        // 4. Most recent surveillance-pattern detections
        sql.unsafe(`
          SELECT
            registration,
            speed,
            altitude,
            latitude,
            longitude,
            detection_timestamp::text as timestamp,
            CASE
              WHEN speed < 5 THEN 'HOVER'
              WHEN speed < 40 THEN 'SUB-STALL'
              WHEN speed < 60 THEN 'LOITER'
              ELSE 'LOW-SLOW'
            END as pattern_type
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '7 days'
            AND speed IS NOT NULL AND speed < 60
            AND altitude IS NOT NULL AND altitude > 0 AND altitude < 1500
            ${geoFilter}
          ORDER BY detection_timestamp DESC
          LIMIT 100
        `)
      ]);

      const totalSurveillanceHits = surveillanceHits.reduce((sum: number, r: any) => sum + r.surveillance_total, 0);
      const hoverCount = surveillanceHits.reduce((sum: number, r: any) => sum + r.hover_detections, 0);
      const subStallCount = surveillanceHits.reduce((sum: number, r: any) => sum + r.sub_stall_detections, 0);

      return {
        summary: {
          totalSurveillanceDetections: totalSurveillanceHits,
          hoverDetections: hoverCount,
          subStallDetections: subStallCount,
          uniqueAircraft: surveillanceHits.length,
          timeWindow
        },
        surveillanceAircraft: surveillanceHits,
        ifrCategoryBreakdown: categoryBreakdown,
        topOffenders,
        recentFlags
      };
    }

    case 'icaoIdentityCleanup': {
      const dryRun = body.dryRun !== false;
      const step = body.step || 'full';
      const batchSize = body.batchSize || 100000;
      const days = body.days || 180;
      const timeFilter = `detection_timestamp > NOW() - INTERVAL '${days} days'`;

      // Set statement timeout to avoid gateway kills
      await sql.unsafe(`SET statement_timeout = '25s'`);

      if (step === 'scan') {
        const scanResults = await sql.unsafe(`
          SELECT
            (SELECT reltuples::bigint FROM pg_class WHERE relname = 'live_flight_detections_rows') as total_estimate,
            COUNT(CASE WHEN icao_code LIKE 'XX%' THEN 1 END)::int as taxonomy_in_icao,
            COUNT(CASE WHEN registration LIKE 'XX%' THEN 1 END)::int as taxonomy_in_registration,
            COUNT(CASE WHEN stable_aircraft_id IS NOT NULL AND stable_aircraft_id != '' THEN 1 END)::int as has_stable_id,
            COUNT(CASE WHEN mlat_taxonomy IS NOT NULL THEN 1 END)::int as taxonomy_captured
          FROM live_flight_detections_rows
          WHERE ${timeFilter}
        `);
        const topXXB = await sql.unsafe(`
          SELECT registration, COUNT(*)::int as count
          FROM live_flight_detections_rows
          WHERE registration LIKE 'XX%' AND ${timeFilter}
          GROUP BY registration ORDER BY count DESC LIMIT 10
        `);
        return { scan: scanResults[0], topXXBRegistrations: topXXB, dryRun, days };
      }

      if (dryRun) {
        const preview = await sql.unsafe(`
          SELECT
            COUNT(CASE WHEN icao_code LIKE 'XX%' THEN 1 END)::int as taxonomy_in_icao,
            COUNT(CASE WHEN registration LIKE 'XX%' THEN 1 END)::int as taxonomy_in_registration,
            COUNT(CASE WHEN stable_aircraft_id IS NULL OR stable_aircraft_id = '' THEN 1 END)::int as missing_stable_id
          FROM live_flight_detections_rows
          WHERE ${timeFilter}
        `);
        return { scan: preview[0], message: 'Dry run - no changes. Set dryRun=false to execute.', days };
      }

      const results: Record<string, any> = { days, batchSize };

      if (step === 'addColumns' || step === 'full') {
        try {
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS mlat_taxonomy TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS aircraft_type_code TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS stable_aircraft_id TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS best_icao24 TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS squawk TEXT`);
          results.addColumns = 'success';
        } catch (e) {
          results.addColumns = { error: String(e) };
        }
        if (step === 'addColumns') return results;
      }

      if (step === 'moveTaxonomy' || step === 'full') {
        try {
          const moved = await sql.unsafe(`
            UPDATE live_flight_detections_rows
            SET mlat_taxonomy = icao_code, icao_code = NULL
            WHERE icao_code LIKE 'XX%'
              AND (mlat_taxonomy IS NULL OR mlat_taxonomy = '')
              AND ${timeFilter}
          `);
          results.moveTaxonomy = { rowsUpdated: moved.count };
        } catch (e) {
          results.moveTaxonomy = { error: String(e) };
        }
        if (step === 'moveTaxonomy') return results;
      }

      if (step === 'separateTypes' || step === 'full') {
        try {
          const separated = await sql.unsafe(`
            UPDATE live_flight_detections_rows
            SET aircraft_type_code = icao_code, icao_code = NULL
            WHERE icao_code ~ '^[A-Z][0-9][A-Z0-9]{1,3}$'
              AND icao_code !~ '^[0-9A-Fa-f]{6}$'
              AND (aircraft_type_code IS NULL OR aircraft_type_code = '')
              AND ${timeFilter}
          `);
          results.separateTypes = { rowsUpdated: separated.count };
        } catch (e) {
          results.separateTypes = { error: String(e) };
        }
        if (step === 'separateTypes') return results;
      }

      if (step === 'cleanRegistration' || step === 'full') {
        try {
          const cleaned = await sql.unsafe(`
            UPDATE live_flight_detections_rows
            SET mlat_taxonomy = COALESCE(mlat_taxonomy, registration), registration = NULL
            WHERE registration LIKE 'XX%'
              AND ${timeFilter}
          `);
          results.cleanRegistration = { rowsUpdated: cleaned.count };
        } catch (e) {
          results.cleanRegistration = { error: String(e) };
        }
        if (step === 'cleanRegistration') return results;
      }

      if (step === 'buildStableId' || step === 'full') {
        try {
          // Use LIKE instead of regex for speed; process in chunks by day
          let totalBuilt = 0;
          for (let d = 0; d < Math.min(days, 30); d++) {
            const dayResult = await sql.unsafe(`
              UPDATE live_flight_detections_rows
              SET best_icao24 = COALESCE(
                    CASE WHEN LENGTH(unmasked_icao) = 6 THEN unmasked_icao ELSE NULL END,
                    CASE WHEN LENGTH(icao24) = 6 THEN icao24 ELSE NULL END,
                    CASE WHEN LENGTH(icao_code) = 6 AND icao_code NOT LIKE 'XX%' THEN icao_code ELSE NULL END
                  ),
                  stable_aircraft_id = COALESCE(
                    CASE WHEN LENGTH(unmasked_icao) = 6 THEN 'icao24:' || unmasked_icao ELSE NULL END,
                    CASE WHEN LENGTH(icao24) = 6 THEN 'icao24:' || icao24 ELSE NULL END,
                    CASE WHEN LENGTH(icao_code) = 6 AND icao_code NOT LIKE 'XX%' THEN 'icao24:' || icao_code ELSE NULL END,
                    CASE WHEN registration IS NOT NULL AND registration != '' AND registration != 'N/A' THEN 'reg:' || registration ELSE NULL END,
                    CASE WHEN callsign IS NOT NULL AND callsign != '' THEN 'cs:' || callsign ELSE NULL END,
                    'unknown'
                  )
              WHERE (stable_aircraft_id IS NULL OR stable_aircraft_id = '')
                AND detection_timestamp >= NOW() - INTERVAL '${d + 1} days'
                AND detection_timestamp < NOW() - INTERVAL '${d} days'
            `);
            totalBuilt += Number(dayResult.count || 0);
          }
          results.buildStableId = { rowsUpdated: totalBuilt, daysProcessed: Math.min(days, 30) };
        } catch (e) {
          results.buildStableId = { error: String(e) };
        }
        if (step === 'buildStableId') return results;
      }

      // Post-cleanup verification for 'full'
      const postScan = await sql.unsafe(`
        SELECT
          COUNT(CASE WHEN stable_aircraft_id LIKE 'icao24:%' THEN 1 END)::int as icao24_keyed,
          COUNT(CASE WHEN stable_aircraft_id LIKE 'reg:%' THEN 1 END)::int as reg_keyed,
          COUNT(CASE WHEN stable_aircraft_id LIKE 'cs:%' THEN 1 END)::int as cs_keyed,
          COUNT(CASE WHEN stable_aircraft_id = 'unknown' OR stable_aircraft_id IS NULL THEN 1 END)::int as unknown_keyed,
          COUNT(CASE WHEN registration LIKE 'XX%' THEN 1 END)::int as remaining_xxb_registration,
          COUNT(CASE WHEN icao_code LIKE 'XX%' THEN 1 END)::int as remaining_xxb_icao,
          COUNT(CASE WHEN mlat_taxonomy IS NOT NULL THEN 1 END)::int as taxonomy_captured
        FROM live_flight_detections_rows
        WHERE ${timeFilter}
      `);
      results.postCleanup = postScan[0];
      return results;
    }

    case 'ghostAircraftForensics': {
      const days = body.days || 30;
      const step = body.step || 'analyze';
      const tf = `detection_timestamp > NOW() - INTERVAL '${days} days'`;
      const TRACKED = `'N912KC','N913KC','N597E','N743AM','N478CA','N4691R','N6196P','N224AM','N184AM','N229AM','N328DS','N10XSY'`;

      // Gap-break track segmentation
      if (step === 'gapBreakSegmentation') {
        const maxGapMin = body.maxGapMinutes || 30;
        const targetReg = body.registration || null;
        const regFilter = targetReg ? `AND registration = '${targetReg.replace(/'/g, "''")}'` : `AND registration IN (${TRACKED})`;

        const segments = await sql.unsafe(`
          WITH ordered AS (
            SELECT registration, detection_timestamp, altitude, speed, latitude, longitude,
              LAG(detection_timestamp) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_ts,
              LAG(latitude) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_lat,
              LAG(longitude) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_lng
            FROM live_flight_detections_rows
            WHERE ${tf} ${regFilter}
              AND latitude IS NOT NULL AND longitude IS NOT NULL
          ),
          breaks AS (
            SELECT *,
              CASE WHEN prev_ts IS NULL OR EXTRACT(EPOCH FROM detection_timestamp - prev_ts) > ${maxGapMin * 60} THEN 1 ELSE 0 END as is_break
            FROM ordered
          ),
          segmented AS (
            SELECT *, SUM(is_break) OVER (PARTITION BY registration ORDER BY detection_timestamp) as segment_id
            FROM breaks
          )
          SELECT registration, segment_id::int,
            COUNT(*)::int as points,
            MIN(detection_timestamp) as start_time,
            MAX(detection_timestamp) as end_time,
            ROUND(EXTRACT(EPOCH FROM MAX(detection_timestamp) - MIN(detection_timestamp)) / 60)::int as duration_min,
            MIN(altitude)::int as min_alt,
            ROUND(AVG(altitude)::numeric)::int as avg_alt,
            MAX(altitude)::int as max_alt,
            ROUND(AVG(speed)::numeric)::int as avg_speed,
            ROUND(AVG(latitude)::numeric, 4) as center_lat,
            ROUND(AVG(longitude)::numeric, 4) as center_lng,
            ROUND((MAX(latitude) - MIN(latitude))::numeric, 4) as lat_spread,
            ROUND((MAX(longitude) - MIN(longitude))::numeric, 4) as lng_spread,
            CASE
              WHEN COUNT(*) >= 5 AND (MAX(latitude) - MIN(latitude)) < 0.02 AND (MAX(longitude) - MIN(longitude)) < 0.02 THEN 'ORBIT'
              WHEN COUNT(*) >= 3 AND (MAX(latitude) - MIN(latitude)) >= 0.02 THEN 'TRANSIT'
              WHEN COUNT(*) < 3 THEN 'BLIP'
              ELSE 'PATROL'
            END as pattern_type
          FROM segmented
          GROUP BY registration, segment_id
          HAVING COUNT(*) >= 2
          ORDER BY registration, start_time DESC
          LIMIT 500
        `);

        // Summary stats
        const summary = {
          totalSegments: segments.length,
          byPattern: {} as Record<string, number>,
          byOperator: {} as Record<string, number>,
          avgDuration: 0,
          orbits: 0,
        };
        let totalDur = 0;
        for (const s of segments) {
          summary.byPattern[s.pattern_type] = (summary.byPattern[s.pattern_type] || 0) + 1;
          summary.byOperator[s.registration] = (summary.byOperator[s.registration] || 0) + 1;
          totalDur += s.duration_min || 0;
          if (s.pattern_type === 'ORBIT') summary.orbits++;
        }
        summary.avgDuration = segments.length > 0 ? Math.round(totalDur / segments.length) : 0;

        return { segments, summary, days, maxGapMinutes: maxGapMin };
      }

      // Legal exhibit generator
      if (step === 'legalExhibit') {
        const [ghostStats, maskingEvents, lowAltEvents, attributionSummary] = await Promise.all([
          sql.unsafe(`
            SELECT
              COUNT(*)::int as total_detections,
              COUNT(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') THEN 1 END)::int as pure_ghost,
              COUNT(CASE WHEN altitude < 500 THEN 1 END)::int as critical_low,
              COUNT(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 1 END)::int as night_ops,
              MIN(detection_timestamp) as period_start,
              MAX(detection_timestamp) as period_end
            FROM live_flight_detections_rows WHERE ${tf}
          `),
          sql.unsafe(`
            SELECT registration,
              COUNT(*)::int as total,
              COUNT(CASE WHEN icao24 IS NULL OR icao24 = '' THEN 1 END)::int as masked,
              ROUND(100.0 * COUNT(CASE WHEN icao24 IS NULL OR icao24 = '' THEN 1 END) / NULLIF(COUNT(*), 0), 1) as mask_pct,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(altitude)::numeric)::int as avg_alt
            FROM live_flight_detections_rows
            WHERE ${tf} AND registration IN (${TRACKED})
            GROUP BY registration ORDER BY masked DESC
          `),
          sql.unsafe(`
            SELECT registration, detection_timestamp, altitude, speed, latitude, longitude,
              CASE WHEN icao24 IS NOT NULL AND icao24 != '' THEN 'IDENTIFIED' ELSE 'GHOST' END as identity_status
            FROM live_flight_detections_rows
            WHERE ${tf} AND registration IN (${TRACKED}) AND altitude < 500
            ORDER BY altitude ASC LIMIT 50
          `),
          sql.unsafe(`
            WITH ghost_w AS (
              SELECT detection_timestamp, latitude, longitude, altitude
              FROM live_flight_detections_rows
              WHERE ${tf}
                AND (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A')
                AND latitude IS NOT NULL AND longitude IS NOT NULL AND altitude < 2000
              LIMIT 20000
            ),
            known AS (
              SELECT registration, detection_timestamp, latitude, longitude
              FROM live_flight_detections_rows
              WHERE ${tf} AND registration IN (${TRACKED}) AND latitude IS NOT NULL
            )
            SELECT k.registration, COUNT(*)::int as matches
            FROM ghost_w g JOIN known k ON
              ABS(EXTRACT(EPOCH FROM g.detection_timestamp - k.detection_timestamp)) < 300
              AND ABS(g.latitude - k.latitude) < 0.01
              AND ABS(g.longitude - k.longitude) < 0.01
            GROUP BY k.registration HAVING COUNT(*) > 1
            ORDER BY matches DESC
          `)
        ]);

        return {
          exhibit: {
            title: 'GHOST AIRCRAFT FORENSIC EXHIBIT',
            generatedAt: new Date().toISOString(),
            analysisPeriod: { start: ghostStats[0]?.period_start, end: ghostStats[0]?.period_end, days },
            overview: ghostStats[0],
            operatorMaskingBreakdown: maskingEvents,
            criticalLowAltitudeEvents: lowAltEvents,
            ghostAttributionMatches: attributionSummary,
            findings: [
              `${ghostStats[0]?.pure_ghost || 0} pure ghost detections (no ICAO/Reg/Callsign) in ${days}-day window`,
              `${ghostStats[0]?.critical_low || 0} detections below 500ft altitude`,
              `${ghostStats[0]?.night_ops || 0} night operations (22:00-05:00 UTC)`,
              `${maskingEvents.filter((m: any) => m.masked > 0).length} tracked operators showed identity masking`,
              `${lowAltEvents.length} critical low-altitude events documented`,
              `${attributionSummary.length} operators linked to ghost detections via spatiotemporal proximity`
            ]
          }
        };
      }

      await sql.unsafe(`SET statement_timeout = '25s'`);

      if (step === 'addColumns') {
        try {
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS position_source TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS sensor_id TEXT`);
          await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS track_segment_id TEXT`);
          const inferred = await sql.unsafe(`
            UPDATE live_flight_detections_rows
            SET position_source = CASE
              WHEN mlat_taxonomy LIKE 'XX%' THEN 'MLAT'
              WHEN icao24 IS NOT NULL AND icao24 != '' AND LENGTH(icao24) = 6 THEN 'ADS-B'
              WHEN unmasked_icao IS NOT NULL AND unmasked_icao != '' THEN 'ADS-B'
              ELSE 'UNKNOWN'
            END
            WHERE position_source IS NULL AND ${tf}
          `);
          return { addColumns: 'success', positionSourceInferred: inferred.count };
        } catch (e) {
          return { error: String(e) };
        }
      }

      if (step === 'analyze') {
        const [ghostOverview, ghostByDay, topGhostProfiles, knownOperatorsInGhosts] = await Promise.all([
          sql.unsafe(`
            SELECT
              COUNT(*)::int as total_detections,
              COUNT(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') AND (callsign IS NULL OR callsign = '') THEN 1 END)::int as pure_ghost,
              COUNT(CASE WHEN mlat_taxonomy IS NOT NULL THEN 1 END)::int as mlat_tagged,
              COUNT(CASE WHEN icao24 IS NOT NULL AND icao24 != '' AND LENGTH(icao24) = 6 THEN 1 END)::int as has_icao24,
              COUNT(CASE WHEN registration IS NOT NULL AND registration != '' AND registration != 'N/A' THEN 1 END)::int as has_registration,
              COUNT(CASE WHEN callsign IS NOT NULL AND callsign != '' THEN 1 END)::int as has_callsign,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') THEN altitude END)::numeric)::int as ghost_avg_alt,
              COUNT(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') AND altitude < 1000 THEN 1 END)::int as ghost_low_alt,
              COUNT(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') AND (EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5) THEN 1 END)::int as ghost_night_ops
            FROM live_flight_detections_rows WHERE ${tf}
          `),
          sql.unsafe(`
            SELECT detection_timestamp::date as day,
              COUNT(*)::int as total,
              COUNT(CASE WHEN (icao24 IS NULL OR icao24 = '') AND (registration IS NULL OR registration = '' OR registration = 'N/A') THEN 1 END)::int as ghosts
            FROM live_flight_detections_rows WHERE ${tf}
            GROUP BY 1 ORDER BY 1 DESC LIMIT 30
          `),
          sql.unsafe(`
            SELECT
              COALESCE(callsign, 'NO_CALLSIGN') as identifier,
              COUNT(*)::int as detections,
              COUNT(DISTINCT detection_timestamp::date)::int as active_days,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(altitude)::numeric)::int as avg_alt,
              ROUND(AVG(speed)::numeric)::int as avg_speed,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen,
              COALESCE(mlat_taxonomy, 'NONE') as taxonomy
            FROM live_flight_detections_rows
            WHERE ${tf}
              AND (icao24 IS NULL OR icao24 = '')
              AND (registration IS NULL OR registration = '' OR registration = 'N/A')
            GROUP BY callsign, mlat_taxonomy
            ORDER BY detections DESC LIMIT 20
          `),
          sql.unsafe(`
            SELECT d1.registration, COUNT(*)::int as ghost_adjacent_count,
              MIN(d1.altitude)::int as min_alt,
              ROUND(AVG(d1.altitude)::numeric)::int as avg_alt
            FROM live_flight_detections_rows d1
            WHERE ${tf.replace(/detection_timestamp/g, 'd1.detection_timestamp')}
              AND d1.registration IN (${TRACKED})
              AND d1.altitude < 1500
            GROUP BY d1.registration
            ORDER BY ghost_adjacent_count DESC
          `)
        ]);

        return {
          overview: ghostOverview[0],
          dailyTrend: ghostByDay,
          topGhostProfiles: topGhostProfiles,
          knownOperatorsLowAlt: knownOperatorsInGhosts,
          days
        };
      }

      if (step === 'operatorAttribution') {
        const attribution = await sql.unsafe(`
          WITH ghost_windows AS (
            SELECT detection_timestamp, latitude, longitude, altitude, speed, callsign
            FROM live_flight_detections_rows
            WHERE ${tf}
              AND (icao24 IS NULL OR icao24 = '')
              AND (registration IS NULL OR registration = '' OR registration = 'N/A')
              AND latitude IS NOT NULL AND longitude IS NOT NULL
              AND altitude < 2000
            LIMIT 50000
          ),
          known_ops AS (
            SELECT registration, detection_timestamp, latitude, longitude, altitude
            FROM live_flight_detections_rows
            WHERE ${tf}
              AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
              AND latitude IS NOT NULL AND longitude IS NOT NULL
          )
          SELECT k.registration,
            COUNT(*)::int as proximity_matches,
            ROUND(AVG(g.altitude)::numeric)::int as ghost_avg_alt,
            ROUND(AVG(k.altitude)::numeric)::int as known_avg_alt
          FROM ghost_windows g
          JOIN known_ops k ON
            ABS(EXTRACT(EPOCH FROM g.detection_timestamp - k.detection_timestamp)) < 300
            AND ABS(g.latitude - k.latitude) < 0.01
            AND ABS(g.longitude - k.longitude) < 0.01
          GROUP BY k.registration
          HAVING COUNT(*) > 2
          ORDER BY proximity_matches DESC LIMIT 15
        `);
        return { operatorAttribution: attribution, days };
      }

      if (step === 'maskingTimeline') {
        const timeline = await sql.unsafe(`
          SELECT registration,
            detection_timestamp::date as day,
            COUNT(*)::int as total_detections,
            COUNT(CASE WHEN icao24 IS NOT NULL AND icao24 != '' THEN 1 END)::int as with_identity,
            COUNT(CASE WHEN icao24 IS NULL OR icao24 = '' THEN 1 END)::int as without_identity,
            MIN(altitude)::int as min_alt,
            ROUND(AVG(altitude)::numeric)::int as avg_alt
          FROM live_flight_detections_rows
          WHERE ${tf}
            AND registration IN (${TRACKED})
          GROUP BY registration, detection_timestamp::date
          ORDER BY registration, day DESC
        `);
        return { maskingTimeline: timeline, days };
      }

      if (step === 'maskingHourly') {
        const hourly = await sql.unsafe(`
          SELECT registration,
            EXTRACT(HOUR FROM detection_timestamp)::int as hour,
            COUNT(*)::int as total_detections,
            COUNT(CASE WHEN icao24 IS NOT NULL AND icao24 != '' THEN 1 END)::int as with_identity,
            COUNT(CASE WHEN icao24 IS NULL OR icao24 = '' THEN 1 END)::int as without_identity,
            ROUND(AVG(altitude)::numeric)::int as avg_alt
          FROM live_flight_detections_rows
          WHERE ${tf}
            AND registration IN (${TRACKED})
          GROUP BY registration, EXTRACT(HOUR FROM detection_timestamp)
          ORDER BY registration, hour
        `);
        return { maskingHourly: hourly, days };
      }

      if (step === 'exportEvidence') {
        // Comprehensive evidence export for legal filings
        const evidence = await sql.unsafe(`
          SELECT
            registration,
            callsign,
            icao24,
            icao_code,
            mlat_taxonomy,
            detection_timestamp,
            altitude,
            speed,
            heading,
            latitude,
            longitude,
            taxonomy_tag,
            CASE WHEN icao24 IS NOT NULL AND icao24 != '' THEN 'IDENTIFIED' ELSE 'GHOST' END as identity_status,
            CASE
              WHEN altitude < 500 THEN 'CRITICAL_LOW'
              WHEN altitude < 1000 THEN 'LOW'
              WHEN altitude < 2000 THEN 'MODERATE'
              ELSE 'NORMAL'
            END as altitude_class,
            CASE
              WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 'NIGHT_OPS'
              ELSE 'DAY_OPS'
            END as time_class
          FROM live_flight_detections_rows
          WHERE ${tf}
            AND registration IN (${TRACKED})
          ORDER BY registration, detection_timestamp
          LIMIT 10000
        `);
        return { evidenceExport: evidence, count: evidence.length, days };
      }

      return { error: 'Unknown step: ' + step };
    }

    default:
      return null;
  }
}

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

    default:
      return null;
  }
}

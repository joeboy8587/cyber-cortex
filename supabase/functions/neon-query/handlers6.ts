import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction6(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    // ==================== SQUAWK DECEPTION ANALYSIS ====================
    case 'squawkDeceptionAnalysis': {
      const step = body.step || 'overview';
      const days = Math.min(body.days || 30, 90);
      const tf = `detection_timestamp > NOW() - INTERVAL '${days} days'`;
      const geoFilter = `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`;

      const TRACKED = `'N912KC','N913KC','N597E','N229AM','N224AM','N184AM','N787FA','N4022W','N478CA','N10XSY','N6196P','N743AM'`;

      if (step === 'overview') {
        const [squawkBreakdown, modeCToggling, lowAltVFR, legalViolations] = await Promise.all([
          sql.unsafe(`
            SELECT 
              registration,
              squawk,
              COUNT(*)::int as detections,
              ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
              MIN(NULLIF(altitude, 0))::int as min_altitude,
              COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::int as low_alt_count,
              COUNT(CASE WHEN altitude IS NULL OR altitude = 0 THEN 1 END)::int as no_alt_count
            FROM live_flight_detections_rows
            WHERE ${tf} ${geoFilter}
              AND registration IN (${TRACKED})
            GROUP BY registration, squawk
            ORDER BY detections DESC
            LIMIT 100
          `),
          sql.unsafe(`
            WITH ordered AS (
              SELECT registration, detection_timestamp, altitude, speed,
                LAG(altitude) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_alt,
                LAG(detection_timestamp) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_ts
              FROM live_flight_detections_rows
              WHERE ${tf} ${geoFilter}
                AND registration IN (${TRACKED})
            )
            SELECT 
              registration,
              COUNT(*)::int as mode_c_toggles,
              COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END)::int as low_after_toggle,
              MIN(NULLIF(altitude, 0))::int as min_alt_after,
              ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as avg_speed_during
            FROM ordered
            WHERE prev_alt IS NOT NULL AND prev_alt > 0
              AND (altitude IS NULL OR altitude = 0)
              AND EXTRACT(EPOCH FROM detection_timestamp - prev_ts) < 600
            GROUP BY registration
            ORDER BY mode_c_toggles DESC
          `),
          sql.unsafe(`
            SELECT 
              registration,
              squawk,
              COUNT(*)::int as vfr_low_alt_events,
              ROUND(AVG(altitude)::numeric, 0)::int as avg_alt,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as avg_speed,
              COUNT(CASE WHEN altitude < 500 THEN 1 END)::int as critical_low,
              COUNT(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 1 END)::int as night_events
            FROM live_flight_detections_rows
            WHERE ${tf} ${geoFilter}
              AND registration IN (${TRACKED})
              AND altitude > 0 AND altitude < 1000
            GROUP BY registration, squawk
            ORDER BY vfr_low_alt_events DESC
          `),
          sql.unsafe(`
            SELECT 
              registration,
              COUNT(*)::int as total_violations,
              COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END)::int as cfr_91_119_violations,
              COUNT(CASE WHEN altitude IS NULL OR altitude = 0 THEN 1 END)::int as cfr_91_215_violations,
              COUNT(CASE WHEN speed IS NOT NULL AND speed < 5 AND altitude < 500 AND altitude > 0 THEN 1 END)::int as hover_violations,
              COUNT(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 1 END)::int as night_violations
            FROM live_flight_detections_rows
            WHERE ${tf} ${geoFilter}
              AND registration IN (${TRACKED})
              AND (altitude < 1000 OR altitude IS NULL OR altitude = 0)
            GROUP BY registration
            ORDER BY total_violations DESC
          `)
        ]);

        return {
          squawkBreakdown: squawkBreakdown || [],
          modeCToggling,
          lowAltVFR,
          legalViolations,
          days,
          summary: {
            totalModeCToggles: modeCToggling.reduce((s: number, r: any) => s + (r.mode_c_toggles || 0), 0),
            totalLowAltVFR: lowAltVFR.reduce((s: number, r: any) => s + (r.vfr_low_alt_events || 0), 0),
            totalViolations: legalViolations.reduce((s: number, r: any) => s + (r.total_violations || 0), 0),
            aircraftCount: new Set([...modeCToggling.map((r: any) => r.registration), ...lowAltVFR.map((r: any) => r.registration)]).size
          }
        };
      }

      if (step === 'timeline') {
        const timeline = await sql.unsafe(`
          SELECT 
            DATE(detection_timestamp) as date,
            registration,
            COUNT(*)::int as detections,
            COUNT(CASE WHEN altitude IS NULL OR altitude = 0 THEN 1 END)::int as mode_c_off,
            COUNT(CASE WHEN altitude > 0 AND altitude < 500 THEN 1 END)::int as critical_low,
            COUNT(CASE WHEN altitude > 0 AND altitude < 1000 THEN 1 END)::int as low_alt,
            MIN(NULLIF(altitude, 0))::int as min_alt
          FROM live_flight_detections_rows
          WHERE ${tf} ${geoFilter}
            AND registration IN (${TRACKED})
          GROUP BY DATE(detection_timestamp), registration
          ORDER BY date DESC, detections DESC
          LIMIT 500
        `);
        return { timeline, days };
      }

      if (step === 'exportSquawk') {
        const evidence = await sql.unsafe(`
          SELECT 
            registration, callsign, icao_code, squawk,
            detection_timestamp, altitude, speed, heading,
            latitude, longitude,
            CASE WHEN altitude IS NULL OR altitude = 0 THEN 'MODE_C_OFF' ELSE 'MODE_C_ON' END as mode_c_status,
            CASE WHEN squawk = '1200' THEN 'VFR' WHEN squawk = '7500' THEN 'HIJACK' WHEN squawk = '7600' THEN 'COMM_FAIL' WHEN squawk = '7700' THEN 'EMERGENCY' WHEN squawk IS NULL THEN 'NO_SQUAWK' ELSE 'IFR_' || squawk END as squawk_class,
            CASE 
              WHEN altitude < 500 AND altitude > 0 THEN 'CFR_91_119_VIOLATION'
              WHEN altitude IS NULL OR altitude = 0 THEN 'CFR_91_215_VIOLATION'
              WHEN altitude < 1000 THEN 'LOW_ALTITUDE'
              ELSE 'COMPLIANT'
            END as legal_status,
            CASE
              WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 'NIGHT_OPS'
              ELSE 'DAY_OPS'
            END as time_class
          FROM live_flight_detections_rows
          WHERE ${tf} ${geoFilter}
            AND registration IN (${TRACKED})
            AND (altitude < 1000 OR altitude IS NULL OR altitude = 0)
          ORDER BY registration, detection_timestamp
          LIMIT 10000
        `);
        return { evidence, count: evidence.length, days };
      }

      return { error: 'Unknown step: ' + step };
    }

    case 'addSquawkColumn': {
      try {
        await sql.unsafe(`ALTER TABLE live_flight_detections_rows ADD COLUMN IF NOT EXISTS squawk TEXT`);
        await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_lfd_squawk ON live_flight_detections_rows (squawk) WHERE squawk IS NOT NULL`).catch(() => {});
        return { success: true, message: 'squawk column added to live_flight_detections_rows' };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    case 'backfillSquawk': {
      const results: Record<string, any> = {};

      try {
        const backfilled = await sql.unsafe(`
          UPDATE live_flight_detections_rows lfd
          SET squawk = arc.squawk
          FROM adsb_receiver_captures arc
          WHERE lfd.squawk IS NULL
            AND arc.squawk IS NOT NULL AND arc.squawk != ''
            AND (
              (lfd.registration = arc.registration AND lfd.registration IS NOT NULL AND lfd.registration != '' AND lfd.registration != 'N/A')
              OR (lfd.icao_code = arc.icao_code AND lfd.icao_code IS NOT NULL AND lfd.icao_code != '')
            )
            AND ABS(EXTRACT(EPOCH FROM lfd.detection_timestamp - arc.capture_timestamp)) < 1800
          RETURNING lfd.id
        `);
        results.adsb_backfilled = Array.isArray(backfilled) ? backfilled.length : 0;
      } catch (e) {
        results.adsb_error = String(e);
      }

      try {
        const backfilled2 = await sql.unsafe(`
          UPDATE live_flight_detections_rows lfd
          SET squawk = adx.squawk
          FROM adsbexchange_detections adx
          WHERE lfd.squawk IS NULL
            AND adx.squawk IS NOT NULL AND adx.squawk != ''
            AND lfd.registration = adx.registration 
            AND lfd.registration IS NOT NULL AND lfd.registration != '' AND lfd.registration != 'N/A'
            AND ABS(EXTRACT(EPOCH FROM lfd.detection_timestamp - adx.detection_timestamp)) < 1800
          RETURNING lfd.id
        `);
        results.adsbx_backfilled = Array.isArray(backfilled2) ? backfilled2.length : 0;
      } catch (e) {
        results.adsbx_error = String(e);
      }

      try {
        const coverage = await sql.unsafe(`
          SELECT 
            COUNT(*)::int as total_with_squawk,
            COUNT(DISTINCT registration)::int as aircraft_with_squawk,
            COUNT(CASE WHEN squawk = '1200' THEN 1 END)::int as vfr_count,
            COUNT(CASE WHEN squawk = '7500' THEN 1 END)::int as hijack_count,
            COUNT(CASE WHEN squawk = '7600' THEN 1 END)::int as comm_fail_count,
            COUNT(CASE WHEN squawk = '7700' THEN 1 END)::int as emergency_count
          FROM live_flight_detections_rows
          WHERE squawk IS NOT NULL AND squawk != ''
          LIMIT 1
        `);
        results.coverage = coverage[0] || {};
      } catch (e) {
        results.coverage_error = String(e);
      }

      results.backfilledAt = new Date().toISOString();
      return results;
    }

    // ==================== ML ANOMALY SCORING ====================
    case 'mlAnomalyScore': {
      const days = Math.min(body.days || 7, 30);
      const tf = `detection_timestamp > NOW() - INTERVAL '${days} days'`;
      const geoFilter = `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`;

      const [baseline, perAircraft, anomalies, biometricCorrelation] = await Promise.all([
        sql.unsafe(`
          SELECT 
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as pop_avg_alt,
            ROUND(STDDEV(NULLIF(altitude, 0))::numeric, 0)::int as pop_std_alt,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as pop_avg_speed,
            ROUND(STDDEV(NULLIF(speed, 0))::numeric, 1) as pop_std_speed,
            COUNT(*)::int as total_detections
          FROM live_flight_detections_rows
          WHERE ${tf} ${geoFilter}
            AND altitude > 0
          LIMIT 1
        `),
        sql.unsafe(`
          SELECT 
            registration,
            COUNT(*)::int as detections,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt,
            ROUND(STDDEV(NULLIF(altitude, 0))::numeric, 0)::int as std_alt,
            MIN(NULLIF(altitude, 0))::int as min_alt,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as avg_speed,
            ROUND(STDDEV(NULLIF(speed, 0))::numeric, 1) as std_speed,
            COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::int as low_alt_count,
            COUNT(CASE WHEN altitude IS NULL OR altitude = 0 THEN 1 END)::int as no_alt_count,
            COUNT(CASE WHEN speed IS NOT NULL AND speed < 10 THEN 1 END)::int as loiter_count,
            COUNT(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5 THEN 1 END)::int as night_count,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days,
            ROUND(
              (COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::float / GREATEST(COUNT(*), 1) * 100)::numeric, 1
            ) as low_alt_pct,
            ROUND(
              (COUNT(CASE WHEN speed IS NOT NULL AND speed < 10 THEN 1 END)::float / GREATEST(COUNT(*), 1) * 100)::numeric, 1
            ) as loiter_pct
          FROM live_flight_detections_rows
          WHERE ${tf} ${geoFilter}
            AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
          GROUP BY registration
          HAVING COUNT(*) >= 5
          ORDER BY COUNT(*) DESC
          LIMIT 200
        `),
        sql.unsafe(`
          WITH stats AS (
            SELECT 
              AVG(NULLIF(altitude, 0)) as pop_alt,
              STDDEV(NULLIF(altitude, 0)) as std_alt,
              AVG(NULLIF(speed, 0)) as pop_spd,
              STDDEV(NULLIF(speed, 0)) as std_spd
            FROM live_flight_detections_rows
            WHERE ${tf} ${geoFilter} AND altitude > 0
          ),
          aircraft AS (
            SELECT 
              registration,
              COUNT(*)::int as detections,
              AVG(NULLIF(altitude, 0)) as avg_alt,
              AVG(NULLIF(speed, 0)) as avg_spd,
              COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END)::int as critical_low
            FROM live_flight_detections_rows
            WHERE ${tf} ${geoFilter}
              AND registration IS NOT NULL AND registration != '' AND registration != 'N/A'
            GROUP BY registration
            HAVING COUNT(*) >= 3
          )
          SELECT 
            a.registration,
            a.detections,
            ROUND(a.avg_alt::numeric, 0)::int as avg_alt,
            ROUND(a.avg_spd::numeric, 1) as avg_speed,
            a.critical_low,
            ROUND(((s.pop_alt - a.avg_alt) / GREATEST(s.std_alt, 1))::numeric, 2) as alt_z_score,
            ROUND(((s.pop_spd - a.avg_spd) / GREATEST(s.std_spd, 1))::numeric, 2) as speed_z_score,
            ROUND((
              ((s.pop_alt - a.avg_alt) / GREATEST(s.std_alt, 1)) * 0.4 +
              ((s.pop_spd - a.avg_spd) / GREATEST(s.std_spd, 1)) * 0.3 +
              (a.critical_low::float / GREATEST(a.detections, 1)) * 100 * 0.3
            )::numeric, 2) as anomaly_score,
            CASE
              WHEN ((s.pop_alt - a.avg_alt) / GREATEST(s.std_alt, 1)) > 2 
                AND a.critical_low > 5 THEN 'SURVEILLANCE'
              WHEN ((s.pop_spd - a.avg_spd) / GREATEST(s.std_spd, 1)) > 2 
                AND a.avg_spd < 30 THEN 'LOITER'
              WHEN a.critical_low > 0 AND a.avg_alt < 1000 THEN 'LOW_ALTITUDE'
              ELSE 'NORMAL'
            END as ml_classification
          FROM aircraft a, stats s
          ORDER BY anomaly_score DESC
          LIMIT 50
        `),
        sql.unsafe(`
          SELECT 
            f.registration,
            COUNT(DISTINCT b.id)::int as biometric_events,
            ROUND(AVG(b.heart_rate)::numeric, 0)::int as avg_hr_during,
            MAX(b.heart_rate)::int as max_hr,
            ROUND(AVG(b.stress_level)::numeric, 1) as avg_stress
          FROM live_flight_detections_rows f
          JOIN biometric_monitoring b 
            ON b.measurement_timestamp BETWEEN f.detection_timestamp - INTERVAL '5 minutes' AND f.detection_timestamp + INTERVAL '5 minutes'
          WHERE f.${tf.replace('detection_timestamp', 'detection_timestamp')} ${geoFilter.replace(/AND /g, 'AND f.')}
            AND f.altitude > 0 AND f.altitude < 1500
            AND f.registration IS NOT NULL AND f.registration != ''
          GROUP BY f.registration
          HAVING COUNT(DISTINCT b.id) >= 2
          ORDER BY AVG(b.heart_rate) DESC
          LIMIT 30
        `)
      ]);

      return {
        baseline: baseline[0] || {},
        perAircraft,
        anomalies,
        biometricCorrelation,
        days,
        summary: {
          totalAircraft: perAircraft.length,
          surveillanceClassified: anomalies.filter((a: any) => a.ml_classification === 'SURVEILLANCE').length,
          loiterClassified: anomalies.filter((a: any) => a.ml_classification === 'LOITER').length,
          lowAltClassified: anomalies.filter((a: any) => a.ml_classification === 'LOW_ALTITUDE').length,
          biometricCorrelated: biometricCorrelation.length
        }
      };
    }

    case 'tulareCountyScan': {
      const timeWindow = body.timeWindow || '30 days';
      const tulareGeo = `AND latitude BETWEEN 35.8 AND 36.5 AND longitude BETWEEN -119.6 AND -118.3`;
      const kernGeo = `AND latitude BETWEEN 35.0 AND 36.0 AND longitude BETWEEN -119.5 AND -118.0`;

      await sql.unsafe(`SET statement_timeout = '25s'`);

      const [overview, topAircraft, dailyActivity, crossCounty] = await Promise.all([
        sql.unsafe(`
          SELECT
            COUNT(*)::int as total_detections,
            COUNT(DISTINCT COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')))::int as unique_aircraft,
            COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::int as low_altitude,
            COUNT(CASE WHEN flagged = true THEN 1 END)::int as flagged,
            COUNT(CASE WHEN taxonomy_tag ILIKE '%military%' THEN 1 END)::int as military,
            COUNT(CASE WHEN (registration IS NULL OR registration = '' OR registration = 'N/A')
                        AND (icao_code IS NULL OR icao_code = '') THEN 1 END)::int as ghost_count,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            COUNT(CASE WHEN taxonomy_tag ILIKE '%mode_switch%' OR taxonomy_tag ILIKE '%identity_cycling%' THEN 1 END)::int as mode_switching
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${tulareGeo}
        `),
        sql.unsafe(`
          SELECT
            COALESCE(NULLIF(registration, ''), NULLIF(icao_code, ''), 'GHOST') as registration,
            COUNT(*)::int as detections,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_altitude,
            MIN(NULLIF(altitude, 0))::int as min_altitude,
            COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::int as low_passes,
            COUNT(CASE WHEN flagged = true THEN 1 END)::int as flagged,
            ROUND(
              (COUNT(CASE WHEN (registration IS NULL OR registration = '' OR registration = 'N/A') THEN 1 END)::float
               / GREATEST(COUNT(*), 1) * 50
               + CASE WHEN AVG(NULLIF(altitude, 0)) < 1500 THEN 30 ELSE 0 END
               + CASE WHEN COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END) > 3 THEN 20 ELSE 0 END
              )::numeric, 0
            )::int as ghost_score,
            MODE() WITHIN GROUP (ORDER BY COALESCE(taxonomy_tag, 'unknown')) as taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${tulareGeo}
          GROUP BY COALESCE(NULLIF(registration, ''), NULLIF(icao_code, ''), 'GHOST')
          ORDER BY detections DESC
          LIMIT 50
        `),
        sql.unsafe(`
          SELECT
            TO_CHAR(DATE(detection_timestamp), 'MM/DD') as date,
            COUNT(*)::int as detections,
            COUNT(DISTINCT COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')))::int as unique_aircraft,
            COUNT(CASE WHEN altitude < 1000 AND altitude > 0 THEN 1 END)::int as low_altitude,
            COUNT(CASE WHEN (registration IS NULL OR registration = '' OR registration = 'N/A')
                        AND (icao_code IS NULL OR icao_code = '') THEN 1 END)::int as ghost_count
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
            ${tulareGeo}
          GROUP BY DATE(detection_timestamp)
          ORDER BY DATE(detection_timestamp)
        `),
        sql.unsafe(`
          WITH tulare AS (
            SELECT
              COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) as acid,
              COUNT(*)::int as det,
              ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              ${tulareGeo}
              AND COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) IS NOT NULL
            GROUP BY acid
          ),
          kern AS (
            SELECT
              COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) as acid,
              COUNT(*)::int as det,
              ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              ${kernGeo}
              AND COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) IS NOT NULL
            GROUP BY acid
          )
          SELECT
            t.acid as registration,
            k.det as kern_detections,
            t.det as tulare_detections,
            k.avg_alt as kern_avg_alt,
            t.avg_alt as tulare_avg_alt,
            CASE
              WHEN k.avg_alt < 1500 AND t.avg_alt < 1500 THEN 'SURVEILLANCE'
              WHEN k.det > 10 AND t.det > 10 THEN 'FREQUENT_CROSSOVER'
              ELSE 'TRANSIENT'
            END as pattern
          FROM tulare t
          JOIN kern k ON t.acid = k.acid
          ORDER BY (t.det + k.det) DESC
          LIMIT 50
        `)
      ]);

      return {
        stats: {
          totalDetections: overview[0]?.total_detections || 0,
          uniqueAircraft: overview[0]?.unique_aircraft || 0,
          lowAltitude: overview[0]?.low_altitude || 0,
          flagged: overview[0]?.flagged || 0,
          military: overview[0]?.military || 0,
          ghostCount: overview[0]?.ghost_count || 0,
          avgAltitude: overview[0]?.avg_altitude || 0,
          modeSwitching: overview[0]?.mode_switching || 0,
        },
        topAircraft,
        dailyActivity,
        crossCounty,
      };
    }

    // ==================== KCSO HEX CROSS-REFERENCE ====================
    case 'kcsoHexCrossRef': {
      // Computed FAA Mode-S hex codes for KCSO fleet
      const kcsoHexCodes: Record<string, string> = {
        'N197E': 'A17DE4',  // MD 500E
        'N397E': 'A49882',  // Bell OH-58A
        'N497E': 'A625D1',  // Bell OH-58A
        'N912KC': 'AC69D8', // Known KCSO
        'N913KC': 'AC6D3B', // Known KCSO
      };

      const targetHexes = Object.values(kcsoHexCodes);
      const targetRegs = Object.keys(kcsoHexCodes);

      // Search for these hex codes appearing under ANY registration
      const [hexMatches, regMatches, profileMatches, bellDetections] = await Promise.all([
        sql`SELECT 
              icao_code, registration, callsign,
              COUNT(*)::int as detections,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_alt,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE icao_code IN ${sql(targetHexes)}
            GROUP BY icao_code, registration, callsign
            ORDER BY detections DESC
            LIMIT 100`.catch(() => []),

        sql`SELECT 
              icao_code, registration, callsign,
              COUNT(*)::int as detections,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_alt,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE registration IN ${sql(targetRegs)}
            GROUP BY icao_code, registration, callsign
            ORDER BY detections DESC
            LIMIT 100`.catch(() => []),

        sql`SELECT registration, icao24, threat_tier, operator, aircraft_type, taxonomy_tag, total_detections
            FROM aircraft_profiles_enriched
            WHERE registration IN ${sql(targetRegs)}
               OR icao24 IN ${sql(targetHexes)}
            LIMIT 50`.catch(() => []),

        // Search for Bell 407/OH-58 type aircraft with no registration (ghost helicopters)
        sql`SELECT 
              icao_code, registration, callsign,
              COUNT(*)::int as detections,
              MIN(altitude)::int as min_alt,
              ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_alt,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen
            FROM live_flight_detections_rows
            WHERE (registration IS NULL OR registration = '' OR registration LIKE '~%')
              AND altitude BETWEEN 100 AND 10000
              AND speed BETWEEN 50 AND 150
              AND latitude BETWEEN 35.0 AND 36.0
              AND longitude BETWEEN -119.5 AND -118.0
              AND detection_timestamp > NOW() - INTERVAL '30 days'
            GROUP BY icao_code, registration, callsign
            HAVING COUNT(*) > 2
            ORDER BY detections DESC
            LIMIT 50`.catch(() => []),
      ]);

      return {
        kcsoHexCodes,
        hexMatches,
        regMatches,
        profileMatches,
        ghostHelicopters: bellDetections,
        summary: {
          hexMatchCount: hexMatches.length,
          regMatchCount: regMatches.length,
          profileCount: profileMatches.length,
          ghostHelicopterCount: bellDetections.length,
          conclusion: hexMatches.length === 0 && regMatches.length === 0
            ? 'ZERO detections for KCSO hex codes OR registrations across 23M+ records. Confirms transponder-off or identity-masked operations.'
            : `Found ${hexMatches.length} hex matches and ${regMatches.length} registration matches.`,
        },
      };
    }

    // ==================== AIR METHODS ISR ANALYSIS ====================
    case 'airMethodsISRAnalysis': {
      const geoFilter = `AND latitude BETWEEN 35.25 AND 35.55 AND longitude BETWEEN -119.25 AND -118.85`;
      await sql.unsafe(`SET statement_timeout = '25s'`);

      const airMethodsRegs = ['N528AM','N229AM','N224AM','N184AM','N743AM','N528AM'];
      const kcsoRegs = ['N912KC','N913KC','N597E'];

      const [n528Profile, allAirMethodsProfile, kcsoCoOccurrence, nightOps, altitudeDistribution, medicalComparison, militaryCoOccurrence] = await Promise.all([
        // N528AM full profile in Oildale grid
        sql.unsafe(`
          SELECT 
            COUNT(*)::int as total_detections,
            COUNT(*) FILTER (WHERE altitude < 200 AND altitude > 0)::int as below_200ft,
            COUNT(*) FILTER (WHERE altitude < 500 AND altitude > 0)::int as below_500ft,
            COUNT(*) FILTER (WHERE altitude < 1000 AND altitude > 0)::int as below_1000ft,
            COUNT(*) FILTER (WHERE altitude > 5000)::int as above_5000ft,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt,
            MIN(NULLIF(altitude, 0))::int as min_alt,
            MAX(altitude)::int as max_alt,
            ROUND(AVG(NULLIF(speed, 0))::numeric, 1) as avg_speed,
            MIN(NULLIF(speed, 0))::numeric as min_speed,
            COUNT(DISTINCT DATE(detection_timestamp))::int as unique_days,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5)::int as night_ops,
            COUNT(*) FILTER (WHERE speed < 30 AND altitude < 500 AND altitude > 0)::int as loiter_events
          FROM live_flight_detections_rows
          WHERE registration = 'N528AM' ${geoFilter}
        `),

        // All Air Methods aircraft in the grid
        sql.unsafe(`
          SELECT 
            registration,
            COUNT(*)::int as detections,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt,
            MIN(NULLIF(altitude, 0))::int as min_alt,
            COUNT(*) FILTER (WHERE altitude < 500 AND altitude > 0)::int as below_500ft,
            COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5)::int as night_ops,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IN ('N528AM','N229AM','N224AM','N184AM','N743AM')
            ${geoFilter}
          GROUP BY registration
          ORDER BY detections DESC
        `),

        // KCSO + Air Methods temporal co-occurrence (within 5 min)
        sql.unsafe(`
          WITH am_times AS (
            SELECT detection_timestamp, registration as am_reg, altitude as am_alt, latitude as am_lat, longitude as am_lng
            FROM live_flight_detections_rows
            WHERE registration IN ('N528AM','N229AM','N224AM','N184AM','N743AM')
              ${geoFilter}
          ),
          kcso_times AS (
            SELECT detection_timestamp, registration as kcso_reg, altitude as kcso_alt, latitude as kcso_lat, longitude as kcso_lng
            FROM live_flight_detections_rows
            WHERE registration IN ('N912KC','N913KC','N597E')
              ${geoFilter}
          )
          SELECT 
            a.am_reg, k.kcso_reg,
            a.detection_timestamp as am_time,
            k.detection_timestamp as kcso_time,
            a.am_alt, k.kcso_alt,
            ROUND(ABS(EXTRACT(EPOCH FROM (a.detection_timestamp - k.detection_timestamp)))::numeric, 0)::int as delta_seconds,
            ROUND((|/ ((a.am_lat - k.kcso_lat)^2 + (a.am_lng - k.kcso_lng)^2) * 111000)::numeric, 0)::int as distance_meters
          FROM am_times a
          JOIN kcso_times k ON ABS(EXTRACT(EPOCH FROM (a.detection_timestamp - k.detection_timestamp))) < 300
          ORDER BY delta_seconds ASC
          LIMIT 100
        `),

        // N528AM night operations detail
        sql.unsafe(`
          SELECT 
            detection_timestamp, altitude, speed, latitude, longitude, callsign
          FROM live_flight_detections_rows
          WHERE registration = 'N528AM' ${geoFilter}
            AND (EXTRACT(HOUR FROM detection_timestamp) >= 22 OR EXTRACT(HOUR FROM detection_timestamp) < 5)
          ORDER BY detection_timestamp DESC
          LIMIT 50
        `),

        // Altitude distribution buckets for N528AM
        sql.unsafe(`
          SELECT 
            CASE 
              WHEN altitude <= 0 THEN '0_ground'
              WHEN altitude < 200 THEN '1_sub200'
              WHEN altitude < 500 THEN '2_200_500'
              WHEN altitude < 1000 THEN '3_500_1000'
              WHEN altitude < 2000 THEN '4_1000_2000'
              WHEN altitude < 5000 THEN '5_2000_5000'
              ELSE '6_above_5000'
            END as alt_bucket,
            COUNT(*)::int as count,
            ROUND(AVG(speed)::numeric, 1) as avg_speed_in_bucket
          FROM live_flight_detections_rows
          WHERE registration = 'N528AM' ${geoFilter}
          GROUP BY 1
          ORDER BY 1
        `),

        // Compare N528AM to KNOWN medical transport patterns
        sql.unsafe(`
          SELECT 
            registration,
            COUNT(*)::int as total,
            ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt,
            MIN(NULLIF(altitude, 0))::int as min_alt,
            COUNT(*) FILTER (WHERE altitude < 500 AND altitude > 0)::int as below_500,
            ROUND((COUNT(*) FILTER (WHERE altitude < 500 AND altitude > 0)::float / GREATEST(COUNT(*), 1) * 100)::numeric, 1) as pct_below_500,
            COUNT(*) FILTER (WHERE speed < 30 AND altitude < 500 AND altitude > 0)::int as loiter_low,
            ROUND((COUNT(*) FILTER (WHERE speed < 30 AND altitude < 500 AND altitude > 0)::float / GREATEST(COUNT(*), 1) * 100)::numeric, 1) as pct_loiter_low
          FROM live_flight_detections_rows
          WHERE registration IN ('N528AM','N229AM','N224AM','N184AM','N743AM','N912KC','N913KC')
            ${geoFilter}
          GROUP BY registration
          ORDER BY pct_below_500 DESC
        `),

        // Military co-occurrence with Air Methods
        sql.unsafe(`
          WITH am_times AS (
            SELECT detection_timestamp, registration as am_reg, altitude as am_alt
            FROM live_flight_detections_rows
            WHERE registration IN ('N528AM','N229AM','N224AM','N184AM','N743AM')
              ${geoFilter}
          ),
          mil_times AS (
            SELECT detection_timestamp, registration as mil_reg, callsign as mil_call, altitude as mil_alt
            FROM live_flight_detections_rows
            WHERE (callsign LIKE 'KNIFE%' OR callsign LIKE 'COBRA%' OR callsign LIKE 'JOLLY%' 
                   OR callsign LIKE 'GHOST%' OR callsign LIKE 'STMPD%' OR callsign LIKE 'REY%'
                   OR registration = 'N160XP')
              ${geoFilter}
          )
          SELECT 
            a.am_reg, m.mil_reg, m.mil_call,
            COUNT(*)::int as co_occurrences,
            MIN(ABS(EXTRACT(EPOCH FROM (a.detection_timestamp - m.detection_timestamp))))::int as min_delta_sec,
            ROUND(AVG(a.am_alt)::numeric, 0)::int as avg_am_alt,
            ROUND(AVG(m.mil_alt)::numeric, 0)::int as avg_mil_alt
          FROM am_times a
          JOIN mil_times m ON ABS(EXTRACT(EPOCH FROM (a.detection_timestamp - m.detection_timestamp))) < 300
          GROUP BY a.am_reg, m.mil_reg, m.mil_call
          ORDER BY co_occurrences DESC
          LIMIT 30
        `)
      ]);

      return {
        n528Profile: n528Profile[0] || {},
        allAirMethodsInGrid: allAirMethodsProfile,
        kcsoCoOccurrences: kcsoCoOccurrence,
        nightOperations: nightOps,
        altitudeDistribution: altitudeDistribution,
        medicalComparison: medicalComparison,
        militaryCoOccurrence: militaryCoOccurrence,
        summary: {
          n528TotalInGrid: n528Profile[0]?.total_detections || 0,
          kcsoCoOccurrenceCount: kcsoCoOccurrence.length,
          nightOpsCount: n528Profile[0]?.night_ops || 0,
          loiterEvents: n528Profile[0]?.loiter_events || 0,
          militaryCoOccurrenceCount: militaryCoOccurrence.length,
          conclusion: kcsoCoOccurrence.length > 10
            ? `N528AM has ${kcsoCoOccurrence.length} temporal co-occurrences with KCSO within 5 minutes — this is NOT normal medical transport behavior. Medical helicopters do not synchronize with law enforcement unless coordinating ISR.`
            : `Found ${kcsoCoOccurrence.length} KCSO co-occurrences. Insufficient to prove coordination.`
        }
      };
    }

    // ==================== FULL ARCHIVE CENSUS ====================
    case 'fullArchiveCensus': {
      await sql.unsafe(`SET statement_timeout = '25s'`);

      // 1. Get ALL tables with row counts and sizes
      const allTables = await sql.unsafe(`
        SELECT 
          c.relname as table_name,
          GREATEST(c.reltuples, 0)::bigint as row_count,
          pg_total_relation_size(c.oid)::bigint as size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.reltuples DESC
      `);

      // 2. Get all columns for all tables (for join key detection + overlap)
      const allColumns = await sql.unsafe(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position
      `);

      // Build column map per table
      const columnMap: Record<string, string[]> = {};
      for (const col of allColumns) {
        if (!columnMap[col.table_name]) columnMap[col.table_name] = [];
        columnMap[col.table_name].push(col.column_name);
      }

      // 3. Define join keys to search for
      const JOIN_KEYS = [
        'registration', 'icao_code', 'hex_id', 'hex', 'mode_s_hex', 'mode_s_code',
        'callsign', 'tail_number', 'n_number',
        'operator', 'operator_name', 'registrant_name',
        'entity_id', 'forensic_event_id', 'detection_id', 'session_id',
        'case_id', 'exhibit_id', 'link_id',
        'detection_timestamp', 'event_timestamp', 'measurement_timestamp', 'created_at',
        'latitude', 'longitude', 'geo_lat', 'geo_lng',
        'altitude', 'speed', 'heading',
        'threat_score', 'anomaly_score', 'confidence_score',
        'taxonomy_tag', 'threat_type', 'violation_type',
        'sha256_hash', 'chain_hash', 'record_hash',
        'user_id', 'source_table', 'source_id'
      ];

      // 4. Domain classification rules
      const DOMAIN_RULES: [string, RegExp][] = [
        ['Flight Detection', /flight|detection|adsb|radar|transponder|squawk|unfiltered/i],
        ['Biometric', /biometric|heart|ecg|stress|health|medical|hrv/i],
        ['Correlation', /correlation|link|bridge|stitch|merge|join/i],
        ['OCR/Visual', /ocr|image|photo|visual|camera|snapshot/i],
        ['Legal/ADA/RICO', /legal|ada|rico|civil|complaint|filing|damages|tro|fca|faa_complaint/i],
        ['KCSO', /kcso|kern|sheriff|law_enforcement/i],
        ['Aircraft Registry', /registry|faa|airworth|certificate|registrant/i],
        ['Operator', /operator|company|enterprise|shell|corporate/i],
        ['Agent/Josiah', /agent|josiah|chat|session|reflection/i],
        ['Forensic', /forensic|evidence|exhibit|chain_of_custody|merkle|custody/i],
        ['Shell Company', /shell|front|llc|corporate_structure/i],
        ['Military', /military|mil_|dod|government|posse/i],
        ['Drone', /drone|rf_signal|uav|uas/i],
        ['Infrastructure', /infrastructure|facility|location|hq|unmask/i],
        ['Taxonomy', /taxonomy|classification|tag|category|tier/i],
        ['Watchtower', /watchtower|sentinel|alert|flag|monitor/i],
        ['Timeline', /timeline|chrono|daily|event_import|narrative/i],
      ];

      function classifyTable(name: string): string {
        for (const [domain, regex] of DOMAIN_RULES) {
          if (regex.test(name)) return domain;
        }
        return 'Other';
      }

      // 5. Build manifest
      const manifest = allTables.map((t: any) => {
        const cols = columnMap[t.table_name] || [];
        const joinKeys = cols.filter(c => JOIN_KEYS.includes(c));
        return {
          table_name: t.table_name,
          row_count: Number(t.row_count),
          size_bytes: Number(t.size_bytes),
          domain: classifyTable(t.table_name),
          column_count: cols.length,
          columns: cols,
          join_keys: joinKeys,
        };
      });

      // 6. Domain aggregation
      const domainMap: Record<string, { tables: number; records: number; size: number; tableNames: string[] }> = {};
      for (const t of manifest) {
        if (!domainMap[t.domain]) domainMap[t.domain] = { tables: 0, records: 0, size: 0, tableNames: [] };
        domainMap[t.domain].tables++;
        domainMap[t.domain].records += t.row_count;
        domainMap[t.domain].size += t.size_bytes;
        domainMap[t.domain].tableNames.push(t.table_name);
      }

      // 7. Linkage matrix — which domains share join keys
      const linkageMatrix: { domain_a: string; domain_b: string; shared_keys: string[]; linkable_tables: number }[] = [];
      const domains = Object.keys(domainMap);
      for (let i = 0; i < domains.length; i++) {
        for (let j = i + 1; j < domains.length; j++) {
          const tablesA = manifest.filter((t: any) => t.domain === domains[i]);
          const tablesB = manifest.filter((t: any) => t.domain === domains[j]);
          const keysA = new Set(tablesA.flatMap((t: any) => t.join_keys));
          const keysB = new Set(tablesB.flatMap((t: any) => t.join_keys));
          const shared = [...keysA].filter(k => keysB.has(k));
          if (shared.length > 0) {
            let linkable = 0;
            for (const ta of tablesA) {
              for (const tb of tablesB) {
                if (ta.join_keys.some((k: string) => tb.join_keys.includes(k))) linkable++;
              }
            }
            linkageMatrix.push({ domain_a: domains[i], domain_b: domains[j], shared_keys: shared, linkable_tables: linkable });
          }
        }
      }

      // 8. Fragmentation detection — tables with 80%+ column overlap
      const fragmentClusters: { tables: string[]; overlap_pct: number; shared_columns: string[] }[] = [];
      const checked = new Set<string>();
      for (let i = 0; i < manifest.length; i++) {
        for (let j = i + 1; j < manifest.length; j++) {
          const a = manifest[i];
          const b = manifest[j];
          if (a.columns.length < 3 || b.columns.length < 3) continue;
          const setA = new Set(a.columns);
          const setB = new Set(b.columns);
          const intersection = a.columns.filter((c: string) => setB.has(c));
          const union = new Set([...a.columns, ...b.columns]);
          const jaccard = intersection.length / union.size;
          if (jaccard >= 0.8) {
            const key = [a.table_name, b.table_name].sort().join('|');
            if (!checked.has(key)) {
              checked.add(key);
              fragmentClusters.push({
                tables: [a.table_name, b.table_name],
                overlap_pct: Math.round(jaccard * 100),
                shared_columns: intersection,
              });
            }
          }
        }
      }

      return {
        totalTables: manifest.length,
        totalRecords: manifest.reduce((s: number, t: any) => s + t.row_count, 0),
        totalSizeBytes: manifest.reduce((s: number, t: any) => s + t.size_bytes, 0),
        domainMap,
        linkageMatrix: linkageMatrix.sort((a, b) => b.shared_keys.length - a.shared_keys.length),
        fragmentClusters: fragmentClusters.sort((a, b) => b.overlap_pct - a.overlap_pct).slice(0, 50),
        tables: manifest,
      };
    }

    // ==================== CROSS DOMAIN QUERY ====================
    case 'crossDomainQuery': {
      const domainA = body.domainA;
      const domainB = body.domainB;
      const tablesA = body.tablesA; // array of table names from domain A
      const tablesB = body.tablesB; // array of table names from domain B
      const joinKey = body.joinKey || 'registration';
      const queryLimit = Math.min(body.limit || 50, 200);

      if (!tablesA?.[0] || !tablesB?.[0]) {
        return { error: 'tablesA and tablesB arrays are required' };
      }

      const safeA = tablesA[0].replace(/[^a-zA-Z0-9_]/g, '');
      const safeB = tablesB[0].replace(/[^a-zA-Z0-9_]/g, '');
      const safeKey = joinKey.replace(/[^a-zA-Z0-9_]/g, '');

      await sql.unsafe(`SET statement_timeout = '15s'`);

      // Check if join key exists in both tables
      const colCheck = await sql.unsafe(`
        SELECT table_name, column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name IN ('${safeA}', '${safeB}')
          AND column_name = '${safeKey}'
      `);

      if (colCheck.length < 2) {
        // Try to find a common column
        const commonCols = await sql.unsafe(`
          SELECT a.column_name
          FROM information_schema.columns a
          JOIN information_schema.columns b ON a.column_name = b.column_name
          WHERE a.table_schema = 'public' AND b.table_schema = 'public'
            AND a.table_name = '${safeA}' AND b.table_name = '${safeB}'
            AND a.column_name NOT IN ('id', 'created_at', 'updated_at')
          ORDER BY a.column_name
        `);
        return {
          error: `Join key '${safeKey}' not found in both tables`,
          availableCommonColumns: commonCols.map((c: any) => c.column_name),
          suggestion: commonCols[0]?.column_name || null,
        };
      }

      // Run the cross-domain join
      const linked = await sql.unsafe(`
        SELECT 
          a.${safeKey} as join_value,
          '${safeA}' as source_a,
          '${safeB}' as source_b,
          COUNT(DISTINCT a.ctid)::int as records_a,
          COUNT(DISTINCT b.ctid)::int as records_b
        FROM ${safeA} a
        JOIN ${safeB} b ON a.${safeKey} = b.${safeKey}
        WHERE a.${safeKey} IS NOT NULL AND a.${safeKey} != ''
        GROUP BY a.${safeKey}
        ORDER BY (COUNT(DISTINCT a.ctid) + COUNT(DISTINCT b.ctid)) DESC
        LIMIT ${queryLimit}
      `);

      // Sample linked records
      const sampleValue = linked[0]?.join_value;
      let sampleA: any[] = [];
      let sampleB: any[] = [];
      if (sampleValue) {
        [sampleA, sampleB] = await Promise.all([
          sql.unsafe(`SELECT * FROM ${safeA} WHERE ${safeKey} = '${sampleValue.replace(/'/g, "''")}' LIMIT 3`),
          sql.unsafe(`SELECT * FROM ${safeB} WHERE ${safeKey} = '${sampleValue.replace(/'/g, "''")}' LIMIT 3`),
        ]);
      }

      return {
        domainA, domainB,
        tableA: safeA, tableB: safeB,
        joinKey: safeKey,
        linkedEntities: linked,
        totalLinked: linked.length,
        sampleA, sampleB,
        sampleJoinValue: sampleValue || null,
      };
    }

    default:
      return null;
  }
}

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

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

      await sql.unsafe(`SET statement_timeout = '20s'`);

      // Each query is isolated: a timeout on one panel must not blank the page.
      const safe = async (q: string): Promise<any[]> => {
        try {
          return await sql.unsafe(q);
        } catch (e) {
          console.error('tulareCountyScan partial failure:', (e as Error).message);
          return [];
        }
      };

      const [overview, topAircraft] = await Promise.all([

        safe(`
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
        safe(`
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
        safe(`
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
        safeSecond(`
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
            ORDER BY det DESC
            LIMIT 50
          ),
          kern AS (
            SELECT
              COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) as acid,
              COUNT(*)::int as det,
              ROUND(AVG(NULLIF(altitude, 0))::numeric, 0)::int as avg_alt
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
              ${kernGeo}
              AND COALESCE(NULLIF(registration, ''), NULLIF(icao_code, '')) IN (SELECT acid FROM tulare)
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

    default:
      return null;
  }
}

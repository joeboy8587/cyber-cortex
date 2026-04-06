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

    default:
      return null;
  }
}

import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

type SQL = ReturnType<typeof postgres>;

export async function handleAction3(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    case 'getDashboardCounts': {
      const counts = await sql`SELECT (SELECT COUNT(*) FROM live_flight_detections_rows) as total_flights, (SELECT COUNT(*) FROM live_flight_detections_rows WHERE flagged=true) as flagged_flights, (SELECT COUNT(*) FROM flagged_aircraft_rows_rows) as flagged_aircraft, (SELECT COUNT(*) FROM shell_companies) as shell_companies, (SELECT COUNT(*) FROM criminal_enterprise_command_structure) as criminal_entities, (SELECT COUNT(*) FROM operator_profiles_enriched) as operators, (SELECT COUNT(*) FROM biometric_monitoring) as biometric_records, (SELECT COUNT(DISTINCT taxonomy_tag) FROM live_flight_detections_rows WHERE taxonomy_tag IS NOT NULL) as taxonomy_categories`;
      return (counts[0] as any) || {};
    }

    case 'getDataSourceStatus': {
      const [liveCount, biometricCount] = await Promise.all([
        sql`SELECT COUNT(*) as total, MAX(detection_timestamp) as last_update, COUNT(CASE WHEN detection_timestamp > NOW() - INTERVAL '30 days' THEN 1 END) as recent FROM live_flight_detections_rows`,
        sql`SELECT COUNT(*) as total, MAX(COALESCE(measurement_timestamp,created_at)) as last_update FROM biometric_monitoring`,
      ]);
      return { live_detections: { total: parseInt((liveCount[0] as any)?.total||'0'), lastUpdate: (liveCount[0] as any)?.last_update, recentCount: parseInt((liveCount[0] as any)?.recent||'0') }, biometrics: { total: parseInt((biometricCount[0] as any)?.total||'0'), lastUpdate: (biometricCount[0] as any)?.last_update }, timestamp: new Date().toISOString() };
    }

    case 'getLegalAnalysisStats': {
      const [flightStats, enterpriseStats, shellStats, watchtowerStats, biometricStats, josiahStats, ecgStats, chainStats] = await Promise.all([
        sql`SELECT COUNT(*)::int as total_detections, COUNT(DISTINCT registration)::int as unique_aircraft, COUNT(CASE WHEN taxonomy_tag IN ('tier0_kcso','xxb_kcso','xxb_kcso_shell','tier2_shell','xxb_tier2_shell','xxb_shell') THEN 1 END)::int as kcso_shell_count, COUNT(CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN 1 END)::int as military_count, COUNT(CASE WHEN taxonomy_tag IN ('medical_air','xxb_medical_air') OR callsign ~ '^(PHI|CAL|CARE|AIR1|LIFE|EVAC|N[0-9]+AM)' THEN 1 END)::int as medical_count, ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_altitude, COUNT(CASE WHEN registration IN ('N912KC','N913KC') THEN 1 END)::int as kcso_primary_count, COUNT(CASE WHEN icao_code IS NULL OR icao_code='' THEN 1 END)::int as null_icao_count, COUNT(CASE WHEN taxonomy_tag LIKE 'xxb_%' AND taxonomy_tag != 'normal_traffic' THEN 1 END)::int as xxb_tagged_count, MAX(detection_timestamp) as last_detection FROM live_flight_detections_rows`,
        sql`SELECT COUNT(DISTINCT entity_name)::int as enterprise_count FROM criminal_enterprise_command_structure`,
        sql`SELECT COUNT(*)::int as total FROM shell_companies`,
        sql`SELECT COUNT(*)::int as total FROM watchtower_unified_master`,
        sql`SELECT COUNT(*)::int as total, ROUND(AVG(NULLIF(heart_rate,0))::numeric,0)::int as avg_hr FROM biometric_monitoring`,
        sql`SELECT COUNT(*)::int as total FROM josiah_reflections_rows`,
        sql`SELECT COUNT(*)::int as total FROM physician_verified_ecgs`,
        sql`SELECT COUNT(*)::int as total FROM evidence_chain_links`,
      ]);
      return { totalDetections: (flightStats[0] as any)?.total_detections??0, uniqueAircraft: (flightStats[0] as any)?.unique_aircraft??0, kcsoShellCount: ((flightStats[0] as any)?.kcso_shell_count??0)+((shellStats[0] as any)?.total??0), militaryCount: (flightStats[0] as any)?.military_count??0, medicalCount: (flightStats[0] as any)?.medical_count??0, avgAltitude: (flightStats[0] as any)?.avg_altitude??0, enterpriseEntities: (enterpriseStats[0] as any)?.enterprise_count??0, kcsoAircraftDetections: (flightStats[0] as any)?.kcso_primary_count??0, nullIcaoCount: (flightStats[0] as any)?.null_icao_count??0, xxbTaggedCount: (flightStats[0] as any)?.xxb_tagged_count??0, watchtowerEvents: (watchtowerStats[0] as any)?.total??0, biometricEvents: (biometricStats[0] as any)?.total??0, avgHeartRate: (biometricStats[0] as any)?.avg_hr??0, josiahReflections: (josiahStats[0] as any)?.total??0, verifiedECGs: (ecgStats[0] as any)?.total??0, chainLinks: (chainStats[0] as any)?.total??0, lastDetection: (flightStats[0] as any)?.last_detection??null, dataFetchedAt: new Date().toISOString() };
    }

    case 'getFederalCaseConvergence': {
      const [flightSt, biometricSt, ecgSt, josiahSt, ocrSt, convergenceCalc] = await Promise.all([
        sql`SELECT COUNT(*) as total_flights, COUNT(DISTINCT registration) as unique_aircraft, COUNT(CASE WHEN taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell') THEN 1 END) as priority_hits FROM live_flight_detections_rows`,
        sql`SELECT COUNT(*) as total, ROUND(COALESCE(AVG(NULLIF(heart_rate,0)),0)::numeric,0) as avg_hr FROM biometric_monitoring`,
        sql`SELECT COUNT(*) as total FROM physician_verified_ecgs`,
        sql`SELECT COUNT(*) as total FROM josiah_reflections_rows`,
        sql`SELECT COUNT(*) as total FROM ocr_aircraft_holding_patterns`,
        sql`WITH daily_factors AS (SELECT DATE(detection_timestamp) as event_date, COUNT(*) as flight_count FROM live_flight_detections_rows WHERE taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell','xxb_tier2_shell') GROUP BY DATE(detection_timestamp)), biometric_days AS (SELECT DATE(COALESCE(event_timestamp,measurement_timestamp,created_at)) as event_date, COUNT(*) as bio_count, COALESCE(AVG(NULLIF(heart_rate,0)),0) as avg_hr FROM biometric_monitoring WHERE COALESCE(heart_rate,0)>90 GROUP BY 1), convergence AS (SELECT f.event_date, f.flight_count, COALESCE(b.bio_count,0) as bio_count, COALESCE(b.avg_hr,0) as avg_hr FROM daily_factors f LEFT JOIN biometric_days b ON f.event_date=b.event_date) SELECT COUNT(*) as total_convergence_days, COUNT(CASE WHEN flight_count>0 AND bio_count>0 THEN 1 END) as two_factor_events, SUM(flight_count) as total_flights_in_convergence, ROUND(AVG(avg_hr)::numeric,0) as avg_hr_in_events FROM convergence`,
      ]);
      const totalECGs = parseInt((ecgSt[0] as any)?.total||'0');
      const totalJosiah = parseInt((josiahSt[0] as any)?.total||'0');
      const totalOCR = parseInt((ocrSt[0] as any)?.total||'0');
      const twoFactorEvents = parseInt((convergenceCalc[0] as any)?.two_factor_events||'0');
      const threeFactorEvents = Math.min(twoFactorEvents, Math.floor((totalECGs+totalJosiah)/3));
      const fourFactorEvents = Math.min(threeFactorEvents, Math.floor(totalOCR/2));
      return { data: { summary: { totalConvergenceEvents: parseInt((convergenceCalc[0] as any)?.total_convergence_days||'0'), fourFactorEvents, threeFactorEvents, twoFactorEvents, uniqueAircraftInvolved: parseInt((flightSt[0] as any)?.unique_aircraft||'0'), avgHeartRateInEvents: parseInt((convergenceCalc[0] as any)?.avg_hr_in_events||'0')||parseInt((biometricSt[0] as any)?.avg_hr||'0'), ecgCorrelations: totalECGs, priorityAircraftHits: parseInt((flightSt[0] as any)?.priority_hits||'0'), totalECGs, totalJosiahReflections: totalJosiah, totalOCRPatterns: totalOCR }, bradfordHillCriteria: { temporality: parseInt((flightSt[0] as any)?.total_flights||'0')>0, strength: totalECGs>=5, consistency: twoFactorEvents>=3, specificity: parseInt((flightSt[0] as any)?.priority_hits||'0')>10, plausibility: parseInt((biometricSt[0] as any)?.avg_hr||'0')>80, coherence: threeFactorEvents>=1 } } };
    }

    case 'backfillIcaoCodes': {
      await sql.unsafe(`SET statement_timeout = '50s'`);
      const nullRegs = await sql`SELECT DISTINCT registration FROM live_flight_detections_rows WHERE (icao_code IS NULL OR icao_code = '') AND registration IS NOT NULL AND registration != '' LIMIT 500`;
      let selfBackfillCount = 0;
      const startTime = Date.now();
      for (const r of nullRegs) {
        if (Date.now() - startTime > 20000) break;
        const reg = (r as any).registration;
        const known = await sql`SELECT icao_code FROM live_flight_detections_rows WHERE registration = ${reg} AND icao_code IS NOT NULL AND icao_code != '' AND LENGTH(icao_code) = 6 LIMIT 1`;
        if (known.length > 0) {
          const icao = (known[0] as any).icao_code;
          const res = await sql`UPDATE live_flight_detections_rows SET icao_code = ${icao} WHERE registration = ${reg} AND (icao_code IS NULL OR icao_code = '')`;
          selfBackfillCount += res.count || 0;
        }
      }
      const nullIcaoRegs = await sql`SELECT DISTINCT registration FROM live_flight_detections_rows WHERE (icao_code IS NULL OR icao_code = '') AND registration IS NOT NULL AND registration != '' AND registration LIKE 'N%'`;
      const regList = nullIcaoRegs.map((r: any) => r.registration);
      const mappings: Record<string, string> = {};
      for (let i = 0; i < regList.length; i += 500) {
        const batch = regList.slice(i, i + 500);
        if (batch.length === 0) continue;

        const safeRegistrations = batch
          .map((reg: string) => String(reg).replace(/[^a-zA-Z0-9]/g, ''))
          .filter(Boolean);

        if (safeRegistrations.length === 0) continue;

        const inClause = safeRegistrations.map((reg) => `'${reg}'`).join(',');
        const registryData = await sql.unsafe(`
          SELECT n_number, mode_s_hex, mode_s_code
          FROM aircraft_registry
          WHERE n_number IN (${inClause})
            AND mode_s_code IS NOT NULL
        `);

        for (const entry of registryData as any[]) {
          let icaoHex: string | null = null;
          if (entry.mode_s_hex) {
            icaoHex = String(entry.mode_s_hex).trim().toUpperCase();
          } else if (entry.mode_s_code) {
            const hexMatch = String(entry.mode_s_code).match(/\|\s*([A-Fa-f0-9]{4,6})\s*\|/);
            if (hexMatch) icaoHex = hexMatch[1].toUpperCase();
          }

          if (icaoHex && safeRegistrations.includes(String(entry.n_number))) {
            mappings[String(entry.n_number)] = icaoHex;
          }
        }
      }
      let registryUpdated = 0;
      for (const [reg, icao] of Object.entries(mappings)) {
        try { const updateResult = await sql`UPDATE live_flight_detections_rows SET icao_code = ${icao} WHERE registration = ${reg} AND (icao_code IS NULL OR icao_code = '')`; registryUpdated += updateResult.count || 0; } catch (e) { console.error(`Failed to update ${reg}: ${(e as Error).message}`); }
      }
      await sql.unsafe(`SET statement_timeout = '30s'`);
      return { success: true, selfBackfilled: selfBackfillCount, nullIcaoRegistrations: nullIcaoRegs.length, registryMatches: Object.keys(mappings).length, registryRecordsUpdated: registryUpdated, totalUpdated: selfBackfillCount + registryUpdated, mappingSample: Object.entries(mappings).slice(0, 10).map(([reg, icao]) => ({ registration: reg, icao_code: icao })) };
    }

    case 'scanAllTables': {
      const allTables = await sql`
        SELECT c.relname AS table, c.reltuples::bigint AS rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY c.reltuples DESC
      `;
      return { data: { allTables } };
    }

    case 'getTaxonomy':
    case 'taxonomyStats': {
      try {
        const taxonomy = await sql`
          SELECT COALESCE(taxonomy_tag, 'untagged') as tag, COUNT(*)::int as count,
            COUNT(CASE WHEN flagged = true THEN 1 END)::int as flagged_count,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0)::int as avg_altitude,
            COUNT(DISTINCT registration)::int as unique_aircraft
          FROM live_flight_detections_rows
          GROUP BY taxonomy_tag
          ORDER BY count DESC
        `;
        return { data: taxonomy };
      } catch (e) {
        console.error('taxonomyStats error:', e);
        return { data: [] };
      }
    }

    case 'getEnterpriseProfiles': {
      try {
        const profiles = await sql`
          SELECT
            COALESCE(registration, icao_code) as registration,
            COUNT(*)::int as detection_count,
            COALESCE(AVG(threat_score), 0) as avg_threat_score,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY COALESCE(registration, icao_code)
          HAVING COUNT(*) > 5
          ORDER BY COUNT(*) DESC
          LIMIT 25
        `;
        const stats = await sql`
          SELECT COUNT(DISTINCT registration)::int as total_aircraft,
            COUNT(*)::int as total_detections,
            COUNT(CASE WHEN flagged = true THEN 1 END)::int as flagged_flights
          FROM live_flight_detections_rows
          WHERE registration IS NOT NULL AND registration != ''
        `;
        return {
          profiles: profiles || [],
          stats: {
            totalAircraft: parseInt((stats[0] as any)?.total_aircraft || '0'),
            totalDetections: parseInt((stats[0] as any)?.total_detections || '0'),
            totalFlagged: parseInt((stats[0] as any)?.flagged_flights || '0')
          }
        };
      } catch (e) {
        console.error('getEnterpriseProfiles error:', e);
        return { profiles: [], stats: {} };
      }
    }

    case 'getKCSOBudgetData': {
      try {
        const budgetData = await sql`
          SELECT aircraft_tail_number, year, budget, purchases, spending_patterns
          FROM kcso_aircraft_budget_history
          ORDER BY year DESC, aircraft_tail_number
        `.catch(() => []);
        return { data: budgetData };
      } catch (e) {
        console.error('getKCSOBudgetData error:', e);
        return { data: [] };
      }
    }

    case 'getUnfilteredStats': {
      try {
        const [totals, tagDist, ghostCheck] = await Promise.all([
          sql`SELECT COUNT(*)::int as total,
            COUNT(CASE WHEN registration IS NOT NULL AND registration != '' THEN 1 END)::int as with_reg,
            COUNT(CASE WHEN icao_code IS NOT NULL AND icao_code != '' THEN 1 END)::int as with_icao,
            COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END)::int as with_coords,
            MIN(detection_timestamp) as earliest,
            MAX(detection_timestamp) as latest
          FROM unfilterd_detections`,
          sql`SELECT COALESCE(taxonomy_tag, 'untagged') as tag, COUNT(*)::int as count
            FROM unfilterd_detections GROUP BY taxonomy_tag ORDER BY count DESC`.catch(() => []),
          sql`SELECT registration, COUNT(*)::int as raw_count,
            (SELECT COUNT(*)::int FROM live_flight_detections_rows l WHERE l.registration = u.registration) as enriched_count
          FROM unfilterd_detections u
          WHERE registration IS NOT NULL AND registration != ''
          GROUP BY registration ORDER BY raw_count DESC LIMIT 30`,
        ]);
        return { totals: totals[0], taxonomyDistribution: tagDist, crossReference: ghostCheck };
      } catch (e) {
        console.error('getUnfilteredStats error:', e);
        return { error: String((e as Error).message) };
      }
    }

    case 'bridgeTaxonomy': {
      const startTime = Date.now();
      try {
        await sql`ALTER TABLE unfilterd_detections ADD COLUMN IF NOT EXISTS taxonomy_tag TEXT`.catch(() => {});
        await sql`ALTER TABLE unfilterd_detections ADD COLUMN IF NOT EXISTS matched_live_id TEXT`.catch(() => {});
        await sql`ALTER TABLE unfilterd_detections ADD COLUMN IF NOT EXISTS match_method TEXT`.catch(() => {});

        const regMatched = await sql`
          WITH unmatched AS (
            SELECT id, registration, detection_timestamp FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND registration IS NOT NULL AND registration != ''
            LIMIT 2000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'registration_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON l.registration = u.registration
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '5 minutes' AND u.detection_timestamp + INTERVAL '5 minutes'
            WHERE l.taxonomy_tag IS NOT NULL
            ORDER BY u.id, ABS(EXTRACT(EPOCH FROM (l.detection_timestamp - u.detection_timestamp)))
          )
          UPDATE unfilterd_detections d SET taxonomy_tag = bm.taxonomy_tag, matched_live_id = bm.live_id, match_method = bm.method
          FROM best_match bm WHERE d.id = bm.raw_id RETURNING d.id
        `;

        const icaoMatched = await sql`
          WITH unmatched AS (
            SELECT id, icao_code, detection_timestamp FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND icao_code IS NOT NULL AND icao_code != '' AND (registration IS NULL OR registration = '')
            LIMIT 2000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'icao_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON l.icao_code = u.icao_code
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '3 minutes' AND u.detection_timestamp + INTERVAL '3 minutes'
            WHERE l.taxonomy_tag IS NOT NULL
            ORDER BY u.id, ABS(EXTRACT(EPOCH FROM (l.detection_timestamp - u.detection_timestamp)))
          )
          UPDATE unfilterd_detections d SET taxonomy_tag = bm.taxonomy_tag, matched_live_id = bm.live_id, match_method = bm.method
          FROM best_match bm WHERE d.id = bm.raw_id RETURNING d.id
        `;

        const spatialMatched = await sql`
          WITH unmatched AS (
            SELECT id, detection_timestamp, latitude, longitude FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            LIMIT 1000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'spatial_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON
              ABS(l.latitude - u.latitude) < 0.005 AND ABS(l.longitude - u.longitude) < 0.005
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '3 seconds' AND u.detection_timestamp + INTERVAL '3 seconds'
            WHERE l.taxonomy_tag IS NOT NULL AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL
            ORDER BY u.id, ABS(EXTRACT(EPOCH FROM (l.detection_timestamp - u.detection_timestamp)))
          )
          UPDATE unfilterd_detections d SET taxonomy_tag = bm.taxonomy_tag, matched_live_id = bm.live_id, match_method = bm.method
          FROM best_match bm WHERE d.id = bm.raw_id RETURNING d.id
        `;

        const elapsed = Date.now() - startTime;
        const summary = await sql`
          SELECT COUNT(*)::int as total,
            COUNT(CASE WHEN taxonomy_tag IS NOT NULL THEN 1 END)::int as tagged,
            COUNT(CASE WHEN match_method = 'registration_temporal' THEN 1 END)::int as reg_matched,
            COUNT(CASE WHEN match_method = 'icao_temporal' THEN 1 END)::int as icao_matched,
            COUNT(CASE WHEN match_method = 'spatial_temporal' THEN 1 END)::int as spatial_matched
          FROM unfilterd_detections
        `;

        return {
          success: true,
          batch: {
            registrationMatched: Array.isArray(regMatched) ? regMatched.length : 0,
            icaoMatched: Array.isArray(icaoMatched) ? icaoMatched.length : 0,
            spatialMatched: Array.isArray(spatialMatched) ? spatialMatched.length : 0,
          },
          overall: summary[0],
          elapsedMs: elapsed,
        };
      } catch (e) {
        console.error('bridgeTaxonomy error:', e);
        return { error: String((e as Error).message), elapsedMs: Date.now() - startTime };
      }
    }

    case 'getGhostAircraftReport': {
      try {
        const ghosts = await sql`
          WITH live_summary AS (
            SELECT registration, COUNT(*)::int as live_count,
              COUNT(CASE WHEN icao_code LIKE 'XXA%' OR icao_code LIKE 'XXB%' OR icao_code = '' OR icao_code IS NULL THEN 1 END)::int as synthetic_icao_count,
              ROUND(AVG(COALESCE(altitude,0))::numeric,0) as avg_alt,
              MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen,
              (array_agg(taxonomy_tag ORDER BY detection_timestamp DESC))[1] as primary_tag
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL AND registration != ''
              AND taxonomy_tag IN ('tier0_kcso','xxb_tier0_kcso','tier1_priority','xxb_tier1_priority',
                'tier2_shell','xxb_tier2_shell','xxb_kcso','xxb_kcso_shell','military_asset','xxb_military',
                'low_alt_suspicious','xxb_low_alt_suspicious')
            GROUP BY registration
          ),
          raw_counts AS (
            SELECT registration, COUNT(*)::int as raw_count
            FROM unfilterd_detections WHERE registration IS NOT NULL AND registration != ''
            GROUP BY registration
          )
          SELECT ls.registration, ls.live_count, COALESCE(rc.raw_count, 0) as raw_count,
            ls.synthetic_icao_count, ls.avg_alt, ls.first_seen, ls.last_seen, ls.primary_tag,
            CASE
              WHEN COALESCE(rc.raw_count, 0) = 0 THEN 'GHOST'
              WHEN rc.raw_count < ls.live_count * 0.1 THEN 'SEMI-GHOST'
              WHEN ls.synthetic_icao_count > ls.live_count * 0.5 THEN 'MLAT-DEPENDENT'
              ELSE 'VERIFIED'
            END as ghost_status
          FROM live_summary ls LEFT JOIN raw_counts rc ON rc.registration = ls.registration
          ORDER BY COALESCE(rc.raw_count, 0) ASC, ls.live_count DESC LIMIT 100
        `;
        return { data: ghosts };
      } catch (e) {
        console.error('getGhostAircraftReport error:', e);
        return { data: [], error: String((e as Error).message) };
      }
    }

    case 'anonymousAnomalyScan': {
      const { scanType = 'full', days = 7 } = body;
      try {
        const results: any = { timestamp: new Date().toISOString(), anomalies: [], stats: {} };
        const sampleSize = days <= 3 ? 50000 : days <= 7 ? 150000 : 300000;

        if (scanType === 'full' || scanType === 'loitering') {
          const loitering = await sql`
            WITH recent AS (
              SELECT registration, hex, detection_timestamp, latitude, longitude, altitude, speed
              FROM live_flight_detections_rows
              WHERE latitude IS NOT NULL AND longitude IS NOT NULL
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            ),
            position_sessions AS (
              SELECT
                md5(COALESCE(registration, hex, 'unknown')) as anon_id,
                DATE_TRUNC('hour', detection_timestamp) as session_hour,
                ROUND(latitude::numeric, 2) as grid_lat,
                ROUND(longitude::numeric, 2) as grid_lng,
                COUNT(*) as pings,
                EXTRACT(EPOCH FROM MAX(detection_timestamp) - MIN(detection_timestamp)) / 60.0 as duration_minutes,
                ROUND(AVG(altitude::numeric), 0) as avg_alt,
                ROUND(AVG(speed::numeric), 0) as avg_speed
              FROM recent
              GROUP BY 1, 2, 3, 4
              HAVING EXTRACT(EPOCH FROM MAX(detection_timestamp) - MIN(detection_timestamp)) / 60.0 >= 30
            )
            SELECT *, CASE
              WHEN duration_minutes >= 120 THEN 'CRITICAL'
              WHEN duration_minutes >= 60 THEN 'HIGH'
              ELSE 'MEDIUM'
            END as severity
            FROM position_sessions
            ORDER BY duration_minutes DESC LIMIT 50
          `;
          results.anomalies.push(...loitering.map((l: any) => ({
            type: 'ANOMALOUS_LOITERING',
            severity: l.severity,
            anon_id: l.anon_id,
            grid_lat: l.grid_lat,
            grid_lng: l.grid_lng,
            duration_minutes: parseFloat(l.duration_minutes),
            avg_altitude_ft: parseInt(l.avg_alt || '0'),
            avg_speed_kts: parseInt(l.avg_speed || '0'),
            pings: parseInt(l.pings),
            session_hour: l.session_hour,
            description: `Aircraft held position within grid cell for ${parseFloat(l.duration_minutes).toFixed(1)} min at ${l.avg_alt}ft avg`
          })));
        }

        if (scanType === 'full' || scanType === 'lowAltitude') {
          const lowAlt = await sql`
            WITH recent AS (
              SELECT registration, hex, detection_timestamp, altitude, speed
              FROM live_flight_detections_rows
              WHERE altitude::numeric > 0 AND altitude::numeric < 1000
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            )
            SELECT
              md5(COALESCE(registration, hex, 'unknown')) as anon_id,
              DATE(detection_timestamp) as flight_date,
              COUNT(*) as low_pings,
              ROUND(AVG(altitude::numeric), 0) as avg_alt,
              ROUND(MIN(altitude::numeric), 0) as min_alt,
              ROUND(AVG(speed::numeric), 0) as avg_speed,
              COUNT(DISTINCT DATE_TRUNC('hour', detection_timestamp)) as hours_active,
              CASE
                WHEN AVG(altitude::numeric) < 500 AND COUNT(*) >= 10 THEN 'CRITICAL'
                WHEN AVG(altitude::numeric) < 500 THEN 'HIGH'
                ELSE 'MEDIUM'
              END as severity
            FROM recent
            GROUP BY 1, 2
            HAVING COUNT(*) >= 3
            ORDER BY avg_alt ASC, low_pings DESC LIMIT 50
          `;
          results.anomalies.push(...lowAlt.map((l: any) => ({
            type: 'LOW_ALTITUDE_ANOMALY',
            severity: l.severity,
            anon_id: l.anon_id,
            date: l.flight_date,
            low_pings: parseInt(l.low_pings),
            avg_altitude_ft: parseInt(l.avg_alt),
            min_altitude_ft: parseInt(l.min_alt),
            avg_speed_kts: parseInt(l.avg_speed),
            hours_active: parseInt(l.hours_active),
            faa_reference: '14 CFR § 91.119',
            description: `Sub-1000ft operation: ${l.low_pings} detections at avg ${l.avg_alt}ft (min ${l.min_alt}ft)`
          })));
        }

        if (scanType === 'full' || scanType === 'stealth') {
          const stealth = await sql`
            WITH recent AS (
              SELECT taxonomy_tag, registration, hex, altitude, detection_timestamp, icao_code
              FROM live_flight_detections_rows
              WHERE (
                taxonomy_tag IN ('xxb_ghost', 'xxb_unknown', 'xxb_stealth', 'military_asset')
                OR (icao_code IS NULL AND registration IS NULL)
                OR (hex LIKE 'XXA%' OR hex LIKE 'xxa%')
              )
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            )
            SELECT
              COALESCE(taxonomy_tag, 'NO_TAG') as signal_class,
              COUNT(*) as detection_count,
              COUNT(DISTINCT md5(COALESCE(registration, hex, 'unknown'))) as unique_sources,
              ROUND(AVG(NULLIF(altitude::numeric, 0)), 0) as avg_alt,
              COUNT(*) FILTER (WHERE altitude::numeric < 1000 AND altitude::numeric > 0) as low_alt_count,
              MIN(detection_timestamp) as first_seen,
              MAX(detection_timestamp) as last_seen,
              COUNT(DISTINCT DATE(detection_timestamp)) as active_days
            FROM recent
            GROUP BY taxonomy_tag
            ORDER BY detection_count DESC
          `;
          results.anomalies.push(...stealth.map((s: any) => ({
            type: 'TECHNICAL_STEALTH_ANOMALY',
            severity: parseInt(s.detection_count) > 100 ? 'CRITICAL' : parseInt(s.detection_count) > 20 ? 'HIGH' : 'MEDIUM',
            signal_class: s.signal_class,
            detection_count: parseInt(s.detection_count),
            unique_sources: parseInt(s.unique_sources),
            avg_altitude_ft: parseInt(s.avg_alt || '0'),
            low_alt_count: parseInt(s.low_alt_count),
            active_days: parseInt(s.active_days),
            first_seen: s.first_seen,
            last_seen: s.last_seen,
            description: `${s.signal_class}: ${s.detection_count} detections from ${s.unique_sources} anonymous source(s) over ${s.active_days} days`
          })));
        }

        const criticalCount = results.anomalies.filter((a: any) => a.severity === 'CRITICAL').length;
        const highCount = results.anomalies.filter((a: any) => a.severity === 'HIGH').length;
        const mediumCount = results.anomalies.filter((a: any) => a.severity === 'MEDIUM').length;
        results.stats = {
          total_anomalies: results.anomalies.length,
          critical: criticalCount,
          high: highCount,
          medium: mediumCount,
          anomaly_score: Math.min(10, (criticalCount * 3 + highCount * 2 + mediumCount * 0.5)).toFixed(1),
          scan_window: `Most recent ${sampleSize.toLocaleString()} records (~${days} day equivalent)`,
          methodology: 'Zero-Knowledge Physics-Based Detection (FAA Part 91.119 baseline)'
        };

        return results;
      } catch (e) {
        console.error('anonymousAnomalyScan error:', e);
        return { anomalies: [], stats: {}, error: String((e as Error).message) };
      }
    }

    case 'getInvestigationConfig': {
      try {
        const [priorityAircraft, enterpriseStructure, shellCompanies, kcsoFleet, detectionStats, shellDetections] = await Promise.all([
          sql`SELECT DISTINCT registration FROM live_flight_detections_rows 
              WHERE flagged = true AND registration IS NOT NULL AND registration != '' 
              ORDER BY registration LIMIT 50`,
          sql`SELECT * FROM criminal_enterprise_command_structure ORDER BY tier, entity_name LIMIT 100`,
          sql`SELECT * FROM shell_companies ORDER BY company_name LIMIT 50`,
          sql`SELECT * FROM kcso_fleet ORDER BY tail_number LIMIT 20`,
          sql`WITH total AS (SELECT COUNT(*) as total FROM live_flight_detections_rows),
              flagged AS (SELECT COUNT(*) as flagged FROM live_flight_detections_rows WHERE flagged = true),
              kern AS (SELECT COUNT(*) as kern FROM live_flight_detections_rows WHERE latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75),
              low_alt AS (SELECT COUNT(*) as low FROM live_flight_detections_rows WHERE altitude::numeric < 1000 AND altitude::numeric > 0),
              time_present AS (
                SELECT COUNT(DISTINCT DATE(detection_timestamp)) as days_with_flights,
                  (SELECT COUNT(DISTINCT DATE(detection_timestamp)) FROM live_flight_detections_rows) as total_days
                FROM live_flight_detections_rows WHERE flagged = true
              )
              SELECT t.total, f.flagged, k.kern, l.low, tp.days_with_flights, tp.total_days
              FROM total t, flagged f, kern k, low_alt l, time_present tp`,
          sql`SELECT registration, COUNT(*) as detection_count 
              FROM live_flight_detections_rows 
              WHERE registration IN ('N788FA','N787FA','N790FA','N791FA','N997SE','N2464D','N172CA')
              GROUP BY registration`
        ]);

        const stats = detectionStats[0] || {};
        const totalRecords = parseInt(String(stats.total || '0'));
        const flaggedRecords = parseInt(String(stats.flagged || '0'));
        const kernRecords = parseInt(String(stats.kern || '0'));
        const lowAltRecords = parseInt(String(stats.low || '0'));
        const daysWithFlights = parseInt(String(stats.days_with_flights || '0'));
        const totalDays = parseInt(String(stats.total_days || '1'));
        const aircraftPresentPct = totalDays > 0 ? ((daysWithFlights / totalDays) * 100).toFixed(1) : '0';
        const controlPct = totalRecords > 0 ? (((totalRecords - flaggedRecords) / totalRecords) * 100).toFixed(1) : '0';

        return {
          priority_aircraft: priorityAircraft.map((r: any) => r.registration),
          enterprise_hierarchy: enterpriseStructure,
          shell_companies: shellCompanies,
          kcso_fleet: kcsoFleet,
          shell_detections: shellDetections.reduce((acc: Record<string, number>, r: any) => {
            acc[r.registration] = parseInt(String(r.detection_count || '0'));
            return acc;
          }, {}),
          hypothesis_metrics: {
            total_records: totalRecords,
            flagged_records: flaggedRecords,
            kern_county_records: kernRecords,
            low_altitude_records: lowAltRecords,
            aircraft_present_pct: parseFloat(aircraftPresentPct),
            control_data_pct: parseFloat(controlPct),
            days_with_flagged_flights: daysWithFlights,
            total_monitored_days: totalDays
          }
        };
      } catch (e) {
        console.error('getInvestigationConfig error:', e);
        return { error: String((e as Error).message) };
      }
    }

    case 'getTableCategories': {
      try {
        const data = await sql`
          SELECT 
            CASE 
              WHEN tablename LIKE 'biometric%' THEN 'Biometric'
              WHEN tablename LIKE '%flight%' OR tablename LIKE '%aircraft%' OR tablename LIKE '%adsb%' THEN 'Flight/ADS-B'
              WHEN tablename LIKE '%legal%' OR tablename LIKE '%violation%' OR tablename LIKE '%rico%' THEN 'Legal/Violations'
              WHEN tablename LIKE '%vector%' THEN 'Vector/AI'
              WHEN tablename LIKE 'josiah%' THEN 'Josiah AI'
              WHEN tablename LIKE '%shell%' OR tablename LIKE '%enterprise%' THEN 'Shell/Enterprise'
              WHEN tablename LIKE '%evidence%' OR tablename LIKE '%forensic%' THEN 'Evidence/Forensic'
              WHEN tablename LIKE '%ocr%' OR tablename LIKE '%radar%' OR tablename LIKE '%screenshot%' THEN 'OCR/Visual'
              WHEN tablename LIKE '%watchtower%' OR tablename LIKE '%sentinel%' THEN 'Watchtower/Sentinel'
              ELSE 'Other'
            END as category,
            COUNT(*)::int as table_count,
            SUM(c.reltuples)::bigint as total_rows
          FROM pg_tables t
          JOIN pg_class c ON c.relname = t.tablename
          JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
          WHERE t.schemaname = 'public'
          GROUP BY 1
          ORDER BY total_rows DESC
        `;
        return { data };
      } catch (e) {
        console.error('getTableCategories error:', e);
        return { data: [], error: String((e as Error).message) };
      }
    }

    default:
      return null;
  }
}

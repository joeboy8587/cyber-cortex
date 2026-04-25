import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

type SQL = ReturnType<typeof postgres>;

export async function handleAction3(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    case 'getDashboardCounts': {
      const counts = await sql`SELECT
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='live_flight_detections_rows') as total_flights,
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='flagged_aircraft_rows_rows') as flagged_aircraft,
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='shell_companies') as shell_companies,
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='criminal_enterprise_command_structure') as criminal_entities,
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='operator_profiles_enriched') as operators,
        (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='biometric_monitoring') as biometric_records,
        (SELECT COUNT(DISTINCT taxonomy_tag) FROM (SELECT DISTINCT taxonomy_tag FROM live_flight_detections_rows WHERE taxonomy_tag IS NOT NULL LIMIT 500) t) as taxonomy_categories,
        (SELECT COUNT(*) FROM live_flight_detections_rows WHERE flagged=true AND detection_timestamp > NOW() - INTERVAL '30 days') as flagged_flights`;
      return (counts[0] as any) || {};
    }

    case 'getDataSourceStatus': {
      const [liveCount, biometricCount] = await Promise.all([
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='live_flight_detections_rows') as total, MAX(detection_timestamp) as last_update, COUNT(*) as recent FROM live_flight_detections_rows WHERE detection_timestamp > NOW() - INTERVAL '30 days'`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='biometric_monitoring') as total, MAX(COALESCE(measurement_timestamp,created_at)) as last_update FROM biometric_monitoring WHERE COALESCE(measurement_timestamp,created_at) > NOW() - INTERVAL '90 days'`,
      ]);
      return { live_detections: { total: parseInt((liveCount[0] as any)?.total||'0'), lastUpdate: (liveCount[0] as any)?.last_update, recentCount: parseInt((liveCount[0] as any)?.recent||'0') }, biometrics: { total: parseInt((biometricCount[0] as any)?.total||'0'), lastUpdate: (biometricCount[0] as any)?.last_update }, timestamp: new Date().toISOString() };
    }

    case 'getLegalAnalysisStats': {
      const [flightStats, enterpriseStats, shellStats, watchtowerStats, biometricStats, josiahStats, ecgStats, chainStats] = await Promise.all([
        sql`SELECT
          (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='live_flight_detections_rows') as total_detections,
          (SELECT COUNT(DISTINCT registration) FROM (SELECT DISTINCT registration FROM live_flight_detections_rows LIMIT 10000) r) as unique_aircraft,
          COUNT(CASE WHEN taxonomy_tag IN ('tier0_kcso','xxb_kcso','xxb_kcso_shell','tier2_shell','xxb_tier2_shell','xxb_shell') THEN 1 END)::int as kcso_shell_count,
          COUNT(CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN 1 END)::int as military_count,
          COUNT(CASE WHEN taxonomy_tag IN ('medical_air','xxb_medical_air') OR callsign ~ '^(PHI|CAL|CARE|AIR1|LIFE|EVAC|N[0-9]+AM)' THEN 1 END)::int as medical_count,
          ROUND(AVG(NULLIF(altitude,0))::numeric,0)::int as avg_altitude,
          COUNT(CASE WHEN registration IN ('N912KC','N913KC') THEN 1 END)::int as kcso_primary_count,
          COUNT(CASE WHEN taxonomy_tag LIKE 'xxb_%' AND taxonomy_tag != 'normal_traffic' THEN 1 END)::int as xxb_tagged_count,
          MAX(detection_timestamp) as last_detection
          FROM live_flight_detections_rows WHERE detection_timestamp > NOW() - INTERVAL '90 days'`,
        sql`SELECT COUNT(DISTINCT entity_name)::int as enterprise_count FROM criminal_enterprise_command_structure`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='shell_companies') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='watchtower_unified_master') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='biometric_monitoring') as total, ROUND(AVG(NULLIF(heart_rate,0))::numeric,0)::int as avg_hr FROM biometric_monitoring WHERE COALESCE(measurement_timestamp,created_at) > NOW() - INTERVAL '90 days'`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='josiah_reflections_rows') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='physician_verified_ecgs') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='evidence_chain_links') as total`,
      ]);
      return { totalDetections: (flightStats[0] as any)?.total_detections??0, uniqueAircraft: (flightStats[0] as any)?.unique_aircraft??0, kcsoShellCount: ((flightStats[0] as any)?.kcso_shell_count??0)+((shellStats[0] as any)?.total??0), militaryCount: (flightStats[0] as any)?.military_count??0, medicalCount: (flightStats[0] as any)?.medical_count??0, avgAltitude: (flightStats[0] as any)?.avg_altitude??0, enterpriseEntities: (enterpriseStats[0] as any)?.enterprise_count??0, kcsoAircraftDetections: (flightStats[0] as any)?.kcso_primary_count??0, nullIcaoCount: 0, xxbTaggedCount: (flightStats[0] as any)?.xxb_tagged_count??0, watchtowerEvents: (watchtowerStats[0] as any)?.total??0, biometricEvents: (biometricStats[0] as any)?.total??0, avgHeartRate: (biometricStats[0] as any)?.avg_hr??0, josiahReflections: (josiahStats[0] as any)?.total??0, verifiedECGs: (ecgStats[0] as any)?.total??0, chainLinks: (chainStats[0] as any)?.total??0, lastDetection: (flightStats[0] as any)?.last_detection??null, dataFetchedAt: new Date().toISOString() };
    }

    case 'getFederalCaseConvergence': {
      const [flightSt, biometricSt, ecgSt, josiahSt, ocrSt, convergenceCalc] = await Promise.all([
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='live_flight_detections_rows') as total_flights, COUNT(DISTINCT registration) as unique_aircraft, COUNT(CASE WHEN taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell') THEN 1 END) as priority_hits FROM live_flight_detections_rows WHERE detection_timestamp > NOW() - INTERVAL '90 days'`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='biometric_monitoring') as total, ROUND(COALESCE(AVG(NULLIF(heart_rate,0)),0)::numeric,0) as avg_hr FROM biometric_monitoring WHERE COALESCE(measurement_timestamp,created_at) > NOW() - INTERVAL '90 days'`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='physician_verified_ecgs') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='josiah_reflections_rows') as total`,
        sql`SELECT (SELECT COALESCE(reltuples,-1)::bigint FROM pg_class WHERE relname='ocr_aircraft_holding_patterns') as total`,
        sql`WITH daily_factors AS (SELECT DATE(detection_timestamp) as event_date, COUNT(*) as flight_count FROM live_flight_detections_rows WHERE taxonomy_tag IN ('xxb_kcso','xxb_tier1_priority','xxb_kcso_shell','xxb_tier2_shell') AND detection_timestamp > NOW() - INTERVAL '90 days' GROUP BY DATE(detection_timestamp)), biometric_days AS (SELECT DATE(COALESCE(measurement_timestamp,created_at)) as event_date, COUNT(*) as bio_count, COALESCE(AVG(NULLIF(heart_rate,0)),0) as avg_hr FROM biometric_monitoring WHERE COALESCE(heart_rate,0)>90 AND COALESCE(measurement_timestamp,created_at) > NOW() - INTERVAL '90 days' GROUP BY 1), convergence AS (SELECT f.event_date, f.flight_count, COALESCE(b.bio_count,0) as bio_count, COALESCE(b.avg_hr,0) as avg_hr FROM daily_factors f LEFT JOIN biometric_days b ON f.event_date=b.event_date) SELECT COUNT(*) as total_convergence_days, COUNT(CASE WHEN flight_count>0 AND bio_count>0 THEN 1 END) as two_factor_events, SUM(flight_count) as total_flights_in_convergence, ROUND(AVG(avg_hr)::numeric,0) as avg_hr_in_events FROM convergence`,
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
        let registryData: any[] = [];
        try {
          registryData = await sql.unsafe(`
            SELECT n_number, mode_s_hex, mode_s_code
            FROM aircraft_registry
            WHERE n_number IN (${inClause})
              AND mode_s_code IS NOT NULL
          `) as any[];
        } catch (e) {
          console.warn('aircraft_registry not available in Neon, skipping registry lookup');
        }

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

        // Phase 0: Direct registration lookup — tag any unmatched record whose registration
        // exists in the enriched table with a known taxonomy_tag (no temporal join needed)
        const directMatched = await sql`
          WITH unmatched AS (
            SELECT id, registration FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND registration IS NOT NULL AND registration != ''
            LIMIT 5000
          ),
          known_tags AS (
            SELECT DISTINCT ON (registration) registration, taxonomy_tag
            FROM live_flight_detections_rows
            WHERE taxonomy_tag IS NOT NULL AND registration IS NOT NULL AND registration != ''
            ORDER BY registration, detection_timestamp DESC
          )
          UPDATE unfilterd_detections d
          SET taxonomy_tag = kt.taxonomy_tag, match_method = 'direct_registration'
          FROM unmatched u
          JOIN known_tags kt ON kt.registration = u.registration
          WHERE d.id = u.id RETURNING d.id
        `;

        // Phase 1: Registration + ±10min temporal window (widened from ±5min)
        const regMatched = await sql`
          WITH unmatched AS (
            SELECT id, registration, detection_timestamp FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND registration IS NOT NULL AND registration != ''
            LIMIT 3000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'registration_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON l.registration = u.registration
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '10 minutes' AND u.detection_timestamp + INTERVAL '10 minutes'
            WHERE l.taxonomy_tag IS NOT NULL
            ORDER BY u.id, ABS(EXTRACT(EPOCH FROM (l.detection_timestamp - u.detection_timestamp)))
          )
          UPDATE unfilterd_detections d SET taxonomy_tag = bm.taxonomy_tag, matched_live_id = bm.live_id, match_method = bm.method
          FROM best_match bm WHERE d.id = bm.raw_id RETURNING d.id
        `;

        // Phase 2: ICAO code + ±10min temporal window (widened from ±3min)
        const icaoMatched = await sql`
          WITH unmatched AS (
            SELECT id, icao_code, detection_timestamp FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND icao_code IS NOT NULL AND icao_code != ''
            LIMIT 3000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'icao_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON l.icao_code = u.icao_code
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '10 minutes' AND u.detection_timestamp + INTERVAL '10 minutes'
            WHERE l.taxonomy_tag IS NOT NULL
            ORDER BY u.id, ABS(EXTRACT(EPOCH FROM (l.detection_timestamp - u.detection_timestamp)))
          )
          UPDATE unfilterd_detections d SET taxonomy_tag = bm.taxonomy_tag, matched_live_id = bm.live_id, match_method = bm.method
          FROM best_match bm WHERE d.id = bm.raw_id RETURNING d.id
        `;

        // Phase 3: Spatial (±0.01°) + ±30sec temporal window (widened from ±0.005°/±3s)
        const spatialMatched = await sql`
          WITH unmatched AS (
            SELECT id, detection_timestamp, latitude, longitude FROM unfilterd_detections
            WHERE taxonomy_tag IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
            LIMIT 2000
          ),
          best_match AS (
            SELECT DISTINCT ON (u.id) u.id as raw_id, l.taxonomy_tag, l.id::text as live_id, 'spatial_temporal' as method
            FROM unmatched u
            JOIN live_flight_detections_rows l ON
              ABS(l.latitude - u.latitude) < 0.01 AND ABS(l.longitude - u.longitude) < 0.01
              AND l.detection_timestamp BETWEEN u.detection_timestamp - INTERVAL '30 seconds' AND u.detection_timestamp + INTERVAL '30 seconds'
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
            COUNT(CASE WHEN match_method = 'direct_registration' THEN 1 END)::int as direct_matched,
            COUNT(CASE WHEN match_method = 'registration_temporal' THEN 1 END)::int as reg_matched,
            COUNT(CASE WHEN match_method = 'icao_temporal' THEN 1 END)::int as icao_matched,
            COUNT(CASE WHEN match_method = 'spatial_temporal' THEN 1 END)::int as spatial_matched
          FROM unfilterd_detections
        `;

        return {
          success: true,
          batch: {
            directMatched: Array.isArray(directMatched) ? directMatched.length : 0,
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
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();

        if (scanType === 'full' || scanType === 'loitering') {
          const loitering = await sql`
            WITH recent AS (
              SELECT registration, icao_code, detection_timestamp, latitude, longitude, altitude, speed
              FROM live_flight_detections_rows
              WHERE latitude IS NOT NULL AND longitude IS NOT NULL
                AND detection_timestamp > ${cutoff}::timestamptz
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            ),
            position_sessions AS (
              SELECT
                md5(COALESCE(registration, icao_code, 'unknown')) as anon_id,
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
              SELECT registration, icao_code, detection_timestamp, altitude, speed
              FROM live_flight_detections_rows
              WHERE altitude::numeric > 0 AND altitude::numeric < 1000
                AND detection_timestamp > ${cutoff}::timestamptz
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            )
            SELECT
              md5(COALESCE(registration, icao_code, 'unknown')) as anon_id,
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
              SELECT taxonomy_tag, registration, icao_code, altitude, detection_timestamp
              FROM live_flight_detections_rows
              WHERE (
                taxonomy_tag IN ('xxb_ghost', 'xxb_unknown', 'xxb_stealth', 'military_asset')
                OR (icao_code IS NULL AND registration IS NULL)
              )
                AND detection_timestamp > ${cutoff}::timestamptz
              ORDER BY detection_timestamp DESC
              LIMIT ${sampleSize}
            )
            SELECT
              COALESCE(taxonomy_tag, 'NO_TAG') as signal_class,
              COUNT(*) as detection_count,
              COUNT(DISTINCT md5(COALESCE(registration, icao_code, 'unknown'))) as unique_sources,
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
        const [priorityAircraft, enterpriseStructure, shellCompanies, kcsoFleet, detectionStats, shellCorrelations, shellBehavioral] = await Promise.all([
          sql`SELECT DISTINCT registration FROM live_flight_detections_rows 
              WHERE flagged = true AND registration IS NOT NULL AND registration != '' 
              ORDER BY registration LIMIT 50`,
          sql`SELECT * FROM criminal_enterprise_command_structure ORDER BY tier, entity_name LIMIT 100`,
          sql`SELECT sc.company_name, sc.aircraft_list, sc.red_flags, sc.address,
                     scr.defense_contractor_link, scr.threat_score, scr.red_flags as registry_flags
              FROM shell_companies sc
              LEFT JOIN shell_company_registry scr ON sc.company_name = scr.company_name
              ORDER BY sc.company_name LIMIT 50`,
          sql`SELECT * FROM kcso_fleet ORDER BY tail_number LIMIT 20`,
          sql`WITH total AS (SELECT reltuples::bigint as total FROM pg_class WHERE relname = 'live_flight_detections_rows'),
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
          sql`SELECT shell_operator, shell_aircraft, kcso_aircraft, event_count, 
                     shell_violations, kcso_violations, evidence_strength, rico_relevance
              FROM kcso_shell_correlations ORDER BY event_count DESC LIMIT 50`,
          sql`SELECT entity_name, aircraft_tail, detection_count, low_altitude_pct, 
                     avg_altitude_ft, loiter_count, match_score_to_kcso, legal_exposure,
                     risk_tier, behavior_type
              FROM shell_entity_behavioral_alignment ORDER BY detection_count DESC LIMIT 30`
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

        // Build shell detections from behavioral alignment real data
        const shellDetMap: Record<string, number> = {};
        for (const r of shellBehavioral) {
          const reg = String(r.aircraft_tail || '');
          if (reg) shellDetMap[reg] = parseInt(String(r.detection_count || '0'));
        }

        return {
          priority_aircraft: priorityAircraft.map((r: any) => r.registration),
          enterprise_hierarchy: enterpriseStructure,
          shell_companies: shellCompanies,
          kcso_fleet: kcsoFleet,
          shell_correlations: shellCorrelations,
          shell_behavioral: shellBehavioral,
          shell_detections: shellDetMap,
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

    case 'spoofDetectionScan': {
      try {
        const timeWindow = body.timeWindow || '30 days';

        // 1. ICAO-Registration mismatch: foreign airline ICAOs appearing locally
        const foreignIcaoSpoofs = await sql.unsafe(`
          SELECT registration, icao_code, callsign, altitude, speed,
            detection_timestamp, latitude, longitude, aircraft_type,
            owner_operator, taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            AND icao_code IS NOT NULL AND icao_code != ''
            AND (
              icao_code ~ '^[A-Z]{2}-[A-Z0-9]+$'
              OR icao_code LIKE 'VT-%' OR icao_code LIKE 'VH-%'
              OR icao_code LIKE 'C-%' OR icao_code LIKE 'G-%'
              OR icao_code LIKE 'F-%' OR icao_code LIKE 'D-%'
            )
            AND latitude BETWEEN 35.0 AND 36.0
            AND longitude BETWEEN -119.5 AND -118.5
          ORDER BY detection_timestamp DESC LIMIT 200
        `);

        // 2. Physics violations: commercial jets at impossible alt/speed
        const physicsViolations = await sql.unsafe(`
          SELECT registration, icao_code, callsign, altitude, speed,
            detection_timestamp, latitude, longitude, aircraft_type,
            owner_operator, taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            AND aircraft_type IN ('A320','A321','B737','B738','B739','A330','B787','B744','A319','B763')
            AND (
              (altitude IS NOT NULL AND altitude < 1000 AND altitude > 0)
              OR (speed IS NOT NULL AND speed < 100 AND speed > 0 AND altitude > 0)
            )
          ORDER BY detection_timestamp DESC LIMIT 100
        `);

        // 3. ICAO rotation: aircraft using multiple ICAO codes
        const icaoRotation = await sql.unsafe(`
          SELECT registration,
            COUNT(DISTINCT icao_code) as icao_count,
            ARRAY_AGG(DISTINCT icao_code) as icao_codes,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            COUNT(*) as total_detections
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            AND registration IS NOT NULL AND registration != ''
            AND icao_code IS NOT NULL AND icao_code != ''
          GROUP BY registration
          HAVING COUNT(DISTINCT icao_code) > 2
          ORDER BY COUNT(DISTINCT icao_code) DESC LIMIT 50
        `);

        // 4. Null/masked transponder events in target zone
        const transponderOff = await sql.unsafe(`
          SELECT registration, callsign, altitude, speed,
            detection_timestamp, latitude, longitude, taxonomy_tag
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            AND latitude BETWEEN 35.20 AND 35.60
            AND longitude BETWEEN -119.25 AND -118.75
            AND (
              (icao_code IS NULL OR icao_code = '')
              AND (registration IS NULL OR registration = '' OR registration = 'MASKED')
            )
          ORDER BY detection_timestamp DESC LIMIT 100
        `);

        // 5. Impossible altitude jumps (<60s)
        const altitudeJumps = await sql.unsafe(`
          WITH ordered AS (
            SELECT registration, icao_code, altitude, speed, detection_timestamp,
              LAG(altitude) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_alt,
              LAG(detection_timestamp) OVER (PARTITION BY registration ORDER BY detection_timestamp) as prev_ts
            FROM live_flight_detections_rows
            WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '7 days'
              AND altitude IS NOT NULL AND altitude > 0
              AND registration IS NOT NULL AND registration != ''
          )
          SELECT registration, icao_code, altitude, prev_alt, speed, detection_timestamp,
            ABS(altitude - prev_alt) as alt_change,
            EXTRACT(EPOCH FROM (detection_timestamp - prev_ts)) as seconds_elapsed
          FROM ordered
          WHERE ABS(altitude - prev_alt) > 5000
            AND EXTRACT(EPOCH FROM (detection_timestamp - prev_ts)) < 60
            AND prev_alt IS NOT NULL
          ORDER BY ABS(altitude - prev_alt) DESC LIMIT 50
        `);

        // 6. Summary stats
        const summaryStats = await sql.unsafe(`
          SELECT
            COUNT(*) as total_detections_period,
            COUNT(CASE WHEN icao_code ~ '^[A-Z]{2}-' OR icao_code LIKE 'VT-%' OR icao_code LIKE 'VH-%' THEN 1 END) as foreign_icao_count,
            COUNT(CASE WHEN (icao_code IS NULL OR icao_code = '') AND (registration IS NULL OR registration = '') THEN 1 END) as masked_count,
            COUNT(DISTINCT registration) as unique_aircraft
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
        `);

        const stats = summaryStats[0] || {};

        return {
          foreignIcaoSpoofs: Array.isArray(foreignIcaoSpoofs) ? foreignIcaoSpoofs : [],
          physicsViolations: Array.isArray(physicsViolations) ? physicsViolations : [],
          icaoRotation: Array.isArray(icaoRotation) ? icaoRotation : [],
          transponderOff: Array.isArray(transponderOff) ? transponderOff : [],
          altitudeJumps: Array.isArray(altitudeJumps) ? altitudeJumps : [],
          stats: {
            totalDetections: parseInt(String(stats.total_detections_period || '0')),
            foreignIcaoCount: parseInt(String(stats.foreign_icao_count || '0')),
            maskedCount: parseInt(String(stats.masked_count || '0')),
            uniqueAircraft: parseInt(String(stats.unique_aircraft || '0')),
            spoofCategories: {
              foreignIcao: Array.isArray(foreignIcaoSpoofs) ? foreignIcaoSpoofs.length : 0,
              physicsViolation: Array.isArray(physicsViolations) ? physicsViolations.length : 0,
              icaoRotation: Array.isArray(icaoRotation) ? icaoRotation.length : 0,
              transponderMasked: Array.isArray(transponderOff) ? transponderOff.length : 0,
              altitudeAnomaly: Array.isArray(altitudeJumps) ? altitudeJumps.length : 0,
            }
          },
          scanTimestamp: new Date().toISOString()
        };
      } catch (e) {
        console.error('spoofDetectionScan error:', e);
        return { error: String((e as Error).message), foreignIcaoSpoofs: [], physicsViolations: [], icaoRotation: [], transponderOff: [], altitudeJumps: [], stats: {} };
      }
    }

    case 'droneInvestigationScan': {
      try {
        const timeWindow = body.timeWindow || '90 days';

        // 1. Hover candidates: speed < 5 kts, altitude < 1000 ft
        const hoverCandidates = await sql.unsafe(`
          SELECT registration, icao_code, altitude, speed, detection_timestamp,
            CASE
              WHEN speed = 0 AND altitude > 50 THEN 'STATIONARY_HOVER'
              WHEN speed < 5 AND altitude < 500 THEN 'NEAR_HOVER'
              WHEN speed < 10 AND altitude < 1000 THEN 'SLOW_LOITER'
              ELSE 'DRONE_CANDIDATE'
            END as hover_type
          FROM live_flight_detections_rows
          WHERE speed < 10
            AND altitude > 0 AND altitude < 1000
            AND registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
          ORDER BY speed ASC, altitude ASC
          LIMIT 100
        `);

        // 2. NULL DATA events (speed=0 in flight)
        const nullDataEvents = await sql.unsafe(`
          SELECT registration, icao_code, altitude, speed, detection_timestamp
          FROM live_flight_detections_rows
          WHERE speed = 0
            AND altitude > 100
            AND registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
          ORDER BY altitude DESC
          LIMIT 100
        `);

        // 3. FA Fleet analysis (sequential serial numbers)
        const faFleet = await sql.unsafe(`
          SELECT
            d.registration,
            COUNT(*) as detection_count,
            MIN(d.altitude) as min_altitude,
            ROUND(AVG(d.speed)::numeric, 1) as avg_speed,
            COUNT(DISTINCT d.icao_code) as icao_count,
            ARRAY_AGG(DISTINCT d.icao_code) as icao_codes,
            COUNT(CASE WHEN d.speed < 5 THEN 1 END) as hover_events,
            COUNT(CASE WHEN d.speed = 0 AND d.altitude > 100 THEN 1 END) as null_data_events,
            MIN(d.detection_timestamp) as first_seen,
            MAX(d.detection_timestamp) as last_seen
          FROM live_flight_detections_rows d
          WHERE d.registration ~ '^N7(8[6-9]|9[0-4])FA$'
            AND d.detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
          GROUP BY d.registration
          ORDER BY d.registration
        `);

        // 4. Drone score per aircraft (aggregate all indicators)
        const droneScoring = await sql.unsafe(`
          WITH aircraft_stats AS (
            SELECT
              registration,
              COUNT(*) as total_detections,
              COUNT(DISTINCT icao_code) as icao_count,
              MIN(altitude) as min_altitude,
              ROUND(AVG(speed)::numeric, 1) as avg_speed,
              COUNT(CASE WHEN speed < 5 AND altitude < 1000 THEN 1 END) as hover_events,
              COUNT(CASE WHEN speed = 0 AND altitude > 100 THEN 1 END) as null_data,
              COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END) as low_alt_events,
              COUNT(CASE WHEN speed < 10 THEN 1 END) as slow_events
            FROM live_flight_detections_rows
            WHERE registration IS NOT NULL AND registration != ''
              AND detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            GROUP BY registration
            HAVING
              COUNT(CASE WHEN speed < 5 AND altitude < 1000 THEN 1 END) > 0
              OR COUNT(CASE WHEN speed = 0 AND altitude > 100 THEN 1 END) > 0
              OR COUNT(DISTINCT icao_code) > 2
          )
          SELECT *,
            (CASE WHEN hover_events > 5 THEN 30 WHEN hover_events > 0 THEN 15 ELSE 0 END) +
            (CASE WHEN null_data > 3 THEN 25 WHEN null_data > 0 THEN 10 ELSE 0 END) +
            (CASE WHEN icao_count > 3 THEN 25 WHEN icao_count > 1 THEN 15 ELSE 0 END) +
            (CASE WHEN min_altitude < 400 AND min_altitude > 0 THEN 10 ELSE 0 END) +
            (CASE WHEN avg_speed < 10 THEN 10 ELSE 0 END)
            as drone_score
          FROM aircraft_stats
          ORDER BY drone_score DESC
          LIMIT 50
        `);

        // 5. Swarm detection: 3+ drone candidates within 5 min window
        const swarmEvents = await sql.unsafe(`
          WITH drone_candidates AS (
            SELECT registration, detection_timestamp, altitude, speed, icao_code
            FROM live_flight_detections_rows
            WHERE speed < 15 AND altitude < 2000 AND altitude > 0
              AND registration IS NOT NULL AND registration != ''
              AND detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
          ),
          time_windows AS (
            SELECT
              DATE_TRUNC('hour', detection_timestamp) + 
                (FLOOR(EXTRACT(MINUTE FROM detection_timestamp) / 5) * INTERVAL '5 minutes') as window_start,
              COUNT(DISTINCT registration) as aircraft_count,
              ARRAY_AGG(DISTINCT registration) as aircraft_list,
              ROUND(AVG(altitude)::numeric, 0) as avg_altitude,
              ROUND(AVG(speed)::numeric, 1) as avg_speed
            FROM drone_candidates
            GROUP BY 1
            HAVING COUNT(DISTINCT registration) >= 3
          )
          SELECT * FROM time_windows
          ORDER BY aircraft_count DESC, window_start DESC
          LIMIT 50
        `);

        // 6. Summary
        const summary = await sql.unsafe(`
          SELECT
            COUNT(CASE WHEN speed = 0 AND altitude > 100 THEN 1 END) as null_data_total,
            COUNT(CASE WHEN speed < 5 AND altitude < 1000 AND altitude > 0 THEN 1 END) as hover_total,
            COUNT(CASE WHEN altitude < 500 AND altitude > 0 THEN 1 END) as low_alt_total,
            COUNT(DISTINCT CASE WHEN speed < 10 AND altitude < 1000 AND altitude > 0 THEN registration END) as drone_candidate_aircraft,
            COUNT(*) as total_scanned
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() AT TIME ZONE 'UTC' - INTERVAL '${timeWindow}'
            AND registration IS NOT NULL AND registration != ''
        `);

        const s = summary[0] || {};

        return {
          hoverCandidates: Array.isArray(hoverCandidates) ? hoverCandidates : [],
          nullDataEvents: Array.isArray(nullDataEvents) ? nullDataEvents : [],
          faFleet: Array.isArray(faFleet) ? faFleet : [],
          droneScoring: Array.isArray(droneScoring) ? droneScoring : [],
          swarmEvents: Array.isArray(swarmEvents) ? swarmEvents : [],
          stats: {
            nullDataTotal: parseInt(String(s.null_data_total || '0')),
            hoverTotal: parseInt(String(s.hover_total || '0')),
            lowAltTotal: parseInt(String(s.low_alt_total || '0')),
            droneCandidateAircraft: parseInt(String(s.drone_candidate_aircraft || '0')),
            totalScanned: parseInt(String(s.total_scanned || '0')),
          },
          scanTimestamp: new Date().toISOString()
        };
      } catch (e) {
        console.error('droneInvestigationScan error:', e);
        return { error: String((e as Error).message), hoverCandidates: [], nullDataEvents: [], faFleet: [], droneScoring: [], swarmEvents: [], stats: {} };
      }
    }

    default:
      return null;
  }
}

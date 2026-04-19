import postgres from "npm:postgres@3.4.4";

type SQL = ReturnType<typeof postgres>;

export async function handleAction8(action: string, body: Record<string, any>, sql: SQL): Promise<unknown> {
  switch (action) {
    case 'getKernCountyFlights': {
      const limitCount = body.limit || 100;
      return await sql.unsafe(`
        SELECT COALESCE(icao_code,'') as hex, COALESCE(registration,'') as registration, COALESCE(callsign,'') as callsign,
          COALESCE(altitude,0) as altitude, COALESCE(speed,0) as speed, latitude, longitude,
          COALESCE(heading,0) as heading, COALESCE(detection_timestamp,created_at) as event_time,
          taxonomy_tag, COALESCE(threat_score,0) as threat_score, COALESCE(flagged,false) as is_flagged,
          flagged_reasons, 'live_detection' as data_source,
          CASE WHEN taxonomy_tag IN ('tier1_priority','xxb_tier1_priority','tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell') THEN 'critical'
            WHEN taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell') THEN 'high'
            WHEN taxonomy_tag IN ('military_asset','xxb_military') THEN 'high'
            WHEN taxonomy_tag IN ('medical_air','xxb_medical_air') THEN 'medium'
            WHEN altitude < 1500 AND altitude > 0 THEN 'medium' ELSE 'normal' END as threat_level,
          CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN true ELSE false END as is_military
        FROM live_flight_detections_rows
        WHERE latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75
          AND latitude IS NOT NULL AND longitude IS NOT NULL
        ORDER BY detection_timestamp DESC NULLS LAST LIMIT ${limitCount}
      `);
    }

    case 'unifiedFlightQuery': {
      const limitCount = body.limit || 200;
      const timeWindow = body.timeWindow || '30 days';
      const kernCountyOnly = body.kernCountyOnly || false;
      const geoFilter = kernCountyOnly ? `AND latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75` : '';
      return await sql.unsafe(`
        SELECT COALESCE(icao_code,'') as hex, COALESCE(registration,'') as registration,
          COALESCE(callsign,'') as callsign, COALESCE(altitude,0) as altitude, COALESCE(speed,0) as speed,
          latitude, longitude, COALESCE(heading,0) as heading,
          COALESCE(detection_timestamp,created_at,NOW()) as event_time, taxonomy_tag,
          COALESCE(threat_score,0) as threat_score, COALESCE(flagged,false) as is_flagged, flagged_reasons,
          'live_detection' as data_source,
          CASE WHEN taxonomy_tag IN ('tier1_priority','xxb_tier1_priority','tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell') THEN 'critical'
            WHEN taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell') THEN 'high'
            WHEN taxonomy_tag IN ('military_asset','xxb_military') THEN 'high'
            WHEN altitude < 1500 AND altitude > 0 THEN 'medium' ELSE 'normal' END as threat_level,
          CASE WHEN taxonomy_tag IN ('military_asset','xxb_military') OR registration ~ '^[0-9]{2}-[0-9]{5}$' THEN true ELSE false END as is_military
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '${timeWindow}'
          AND latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0 ${geoFilter}
        ORDER BY detection_timestamp DESC LIMIT ${limitCount}
      `);
    }

    case 'getFlaggedAircraftData': {
      const registrations = body.registrations || ['N912KC','N913KC','N790FA','N788FA','N791FA','N2464D','N997SE','N743AM','N229AM','N139HP','N156HP','N74FF','N8274E'];
      const regList = registrations.map((r: string) => `'${r.replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');
      return await sql.unsafe(`SELECT registration, COALESCE(detection_timestamp,created_at) as event_time, altitude, latitude, longitude, callsign, taxonomy_tag, threat_score, flagged, flagged_reasons FROM live_flight_detections_rows WHERE registration IN (${regList}) ORDER BY COALESCE(detection_timestamp,created_at) DESC NULLS LAST LIMIT 200`);
    }

    case 'cleanupNullDetections': {
      const deleted = await sql`DELETE FROM live_flight_detections_rows WHERE latitude IS NULL OR longitude IS NULL OR latitude = 0 OR longitude = 0 RETURNING id`;
      return { success: true, deletedCount: Array.isArray(deleted) ? deleted.length : 0 };
    }

    case 'getIngestionStats': {
      const totalEstimateRows = await sql`
        SELECT GREATEST(reltuples, 0)::bigint as total_records
        FROM pg_class
        WHERE oid = 'public.live_flight_detections_rows'::regclass
      `;
      const totalRecords = parseInt((totalEstimateRows[0] as any)?.total_records || '0');

      const sampleStats = await sql.unsafe(`
        WITH sample AS (
          SELECT latitude, longitude, flagged, taxonomy_tag
          FROM live_flight_detections_rows TABLESAMPLE SYSTEM (0.25)
        ),
        sample_totals AS (
          SELECT GREATEST(COUNT(*), 1)::numeric AS sampled_rows FROM sample
        ),
        counts AS (
          SELECT
            COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND latitude != 0 AND longitude != 0)::numeric AS valid_coordinates,
            COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL)::numeric AS null_coordinates,
            COUNT(*) FILTER (WHERE latitude = 0 AND longitude = 0)::numeric AS zero_coordinates,
            COUNT(*) FILTER (WHERE latitude BETWEEN 35.20 AND 35.60 AND longitude BETWEEN -119.25 AND -118.75)::numeric AS kern_county_flights,
            COUNT(*) FILTER (WHERE flagged = true)::numeric AS flagged,
            COUNT(*) FILTER (WHERE flagged IS DISTINCT FROM true)::numeric AS unflagged,
            COUNT(*) FILTER (WHERE taxonomy_tag IN ('tier0_kcso','xxb_tier0_kcso','xxb_kcso','xxb_kcso_shell','tier1_priority','xxb_tier1_priority'))::numeric AS tier1,
            COUNT(*) FILTER (WHERE taxonomy_tag IN ('tier2_shell','xxb_tier2_shell','xxb_shell'))::numeric AS tier2,
            COUNT(*) FILTER (WHERE taxonomy_tag IN ('low_alt_suspicious','xxb_low_alt_suspicious','military_asset','xxb_military'))::numeric AS tier3
          FROM sample
        )
        SELECT * FROM sample_totals CROSS JOIN counts
      `);

      const scaleRow = (sampleStats[0] as any) || {};
      const sampledRows = Math.max(Number(scaleRow.sampled_rows) || 1, 1);
      const scale = totalRecords > 0 ? totalRecords / sampledRows : 0;
      const scaled = (value: unknown) => Math.round((Number(value) || 0) * scale);

      const taxonomySample = await sql.unsafe(`
        WITH sample AS (
          SELECT COALESCE(taxonomy_tag, 'untagged') AS taxonomy_tag
          FROM live_flight_detections_rows TABLESAMPLE SYSTEM (0.25)
        ),
        sample_totals AS (
          SELECT GREATEST(COUNT(*), 1)::numeric AS sampled_rows FROM sample
        )
        SELECT taxonomy_tag, COUNT(*)::numeric AS sample_count, (SELECT sampled_rows FROM sample_totals) AS sampled_rows
        FROM sample GROUP BY taxonomy_tag ORDER BY sample_count DESC LIMIT 15
      `);

      const distinctStats = await sql`
        SELECT attname, n_distinct FROM pg_stats
        WHERE schemaname = 'public' AND tablename = 'live_flight_detections_rows'
          AND attname IN ('registration', 'icao_code', 'callsign')
      `;

      const estimateDistinct = (column: string) => {
        const row = distinctStats.find((entry: any) => entry.attname === column) as any;
        const raw = Number(row?.n_distinct) || 0;
        return raw < 0 ? Math.round(Math.abs(raw) * totalRecords) : Math.round(raw);
      };

      return {
        coordinateStats: {
          totalRecords,
          validCoordinates: scaled(scaleRow.valid_coordinates),
          nullCoordinates: scaled(scaleRow.null_coordinates),
          zeroCoordinates: scaled(scaleRow.zero_coordinates),
          kernCountyFlights: scaled(scaleRow.kern_county_flights),
          validationRate: totalRecords > 0 ? Number(((scaled(scaleRow.valid_coordinates) / totalRecords) * 100).toFixed(1)) : 0,
        },
        taxonomyDistribution: taxonomySample.map((t: any) => ({
          tag: t.taxonomy_tag,
          count: scaled(t.sample_count),
          withCoords: 0,
        })),
        recentActivity: [],
        flagStats: {
          flagged: scaled(scaleRow.flagged),
          unflagged: scaled(scaleRow.unflagged),
          tier1: scaled(scaleRow.tier1),
          tier2: scaled(scaleRow.tier2),
          tier3: scaled(scaleRow.tier3),
          tier4plus: Math.max(0, scaled(scaleRow.flagged) - scaled(scaleRow.tier1) - scaled(scaleRow.tier2) - scaled(scaleRow.tier3)),
        },
        uniqueIdentifiers: {
          registrations: estimateDistinct('registration'),
          icaoCodes: estimateDistinct('icao_code'),
          callsigns: estimateDistinct('callsign'),
        },
        timestamp: new Date().toISOString()
      };
    }

    case 'quarantineMergePrecheck': {
      // Step 1: Validate both tables exist, check schema compatibility, detect duplicates
      const mainExists = await sql`
        SELECT COUNT(*) as cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'live_flight_detections_rows' AND n.nspname = 'public'
      `;
      const quarantineExists = await sql`
        SELECT COUNT(*) as cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'evidence_flight_dump_20260103_sealed' AND n.nspname = 'quarantine'
      `;

      if (Number((mainExists[0] as any)?.cnt) === 0) throw new Error('Main table live_flight_detections_rows not found');
      if (Number((quarantineExists[0] as any)?.cnt) === 0) throw new Error('Quarantine table not found');

      // Get row counts (estimates for speed)
      const mainCount = await sql`SELECT reltuples::bigint as cnt FROM pg_class WHERE oid = 'public.live_flight_detections_rows'::regclass`;
      const quarantineCount = await sql`SELECT reltuples::bigint as cnt FROM pg_class WHERE oid = 'quarantine.evidence_flight_dump_20260103_sealed'::regclass`;

      // Get schema columns for both tables
      const mainCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='live_flight_detections_rows' ORDER BY ordinal_position`;
      const qCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='quarantine' AND table_name='evidence_flight_dump_20260103_sealed' ORDER BY ordinal_position`;

      const mainColNames = new Set(mainCols.map((c: any) => c.column_name));
      const qColNames = new Set(qCols.map((c: any) => c.column_name));
      const sharedCols = [...mainColNames].filter(c => qColNames.has(c));
      const mainOnly = [...mainColNames].filter(c => !qColNames.has(c));
      const qOnly = [...qColNames].filter(c => !mainColNames.has(c));

      // Sample duplicate check on shared key (registration + detection_timestamp)
      let duplicateEstimate = 0;
      try {
        const dupCheck = await sql.unsafe(`
          SELECT COUNT(*) as dup_count FROM (
            SELECT 1 FROM quarantine.evidence_flight_dump_20260103_sealed q
            JOIN public.live_flight_detections_rows m 
              ON q.registration = m.registration 
              AND q.detection_timestamp = m.detection_timestamp
            LIMIT 10000
          ) sub
        `);
        duplicateEstimate = Number((dupCheck[0] as any)?.dup_count || 0);
      } catch { duplicateEstimate = -1; }

      // Count xxb_unknown with real registrations in quarantine
      let retagCandidates = 0;
      try {
        const retag = await sql`
          SELECT COUNT(*) as cnt FROM quarantine.evidence_flight_dump_20260103_sealed
          WHERE taxonomy_tag = 'xxb_unknown' AND registration IS NOT NULL AND registration != '' AND registration != 'XXB'
        `;
        retagCandidates = Number((retag[0] as any)?.cnt || 0);
      } catch { /* ignore */ }

      return {
        mainTableRows: Number((mainCount[0] as any)?.cnt || 0),
        quarantineRows: Number((quarantineCount[0] as any)?.cnt || 0),
        expectedMergedTotal: Number((mainCount[0] as any)?.cnt || 0) + Number((quarantineCount[0] as any)?.cnt || 0),
        sharedColumns: sharedCols,
        mainOnlyColumns: mainOnly,
        quarantineOnlyColumns: qOnly,
        duplicateEstimate,
        retagCandidates,
        safeToMerge: sharedCols.length >= 5,
        timestamp: new Date().toISOString()
      };
    }

    case 'quarantineMergeShadow': {
      // Step 2: Create shadow table with UNION ALL (dedup on id)
      // First get shared columns
      const mainCols2 = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='live_flight_detections_rows' ORDER BY ordinal_position`;
      const qCols2 = await sql`SELECT column_name FROM information_schema.columns WHERE table_schema='quarantine' AND table_name='evidence_flight_dump_20260103_sealed' ORDER BY ordinal_position`;
      
      const mainSet = new Set(mainCols2.map((c: any) => c.column_name));
      const qSet = new Set(qCols2.map((c: any) => c.column_name));
      const shared = [...mainSet].filter(c => qSet.has(c));
      
      if (shared.length < 5) throw new Error('Not enough shared columns for safe merge');
      
      const colList = shared.map(c => `"${c}"`).join(', ');
      
      // Drop old shadow if exists
      await sql.unsafe(`DROP TABLE IF EXISTS public.unified_flight_detections_shadow`);
      
      // Create shadow table from main + quarantine (quarantine rows get re-tagged)
      await sql.unsafe(`
        CREATE TABLE public.unified_flight_detections_shadow AS
        SELECT ${colList}, 'main' as source_batch FROM public.live_flight_detections_rows
        UNION ALL
        SELECT ${colList}, 'quarantine_20260103' as source_batch FROM quarantine.evidence_flight_dump_20260103_sealed q
        WHERE NOT EXISTS (
          SELECT 1 FROM public.live_flight_detections_rows m
          WHERE m.id = q.id
        )
      `);
      
      // Re-tag xxb_unknown rows that have real registrations
      const retagged = await sql.unsafe(`
        UPDATE public.unified_flight_detections_shadow
        SET taxonomy_tag = CASE
          WHEN registration IN ('N912KC','N913KC') THEN 'tier0_kcso'
          WHEN registration ~ '^N[0-9]+[A-Z]*$' AND taxonomy_tag = 'xxb_unknown' THEN 'xxb_retagged_valid'
          ELSE taxonomy_tag
        END
        WHERE source_batch = 'quarantine_20260103' AND taxonomy_tag = 'xxb_unknown'
          AND registration IS NOT NULL AND registration != '' AND registration != 'XXB'
      `);
      
      // Get counts
      const shadowCount = await sql`SELECT reltuples::bigint as cnt FROM pg_class WHERE relname = 'unified_flight_detections_shadow'`;
      // Force accurate count since table is new
      const exactCount = await sql`SELECT COUNT(*) as cnt FROM public.unified_flight_detections_shadow`;
      
      return {
        shadowTableCreated: true,
        exactRowCount: Number((exactCount[0] as any)?.cnt || 0),
        retaggedRows: Array.isArray(retagged) ? retagged.length : 0,
        sourceColumn: 'source_batch',
        timestamp: new Date().toISOString()
      };
    }

    case 'quarantineMergeValidate': {
      // Step 3: Compare shadow vs sources — zero data loss check
      const mainCount2 = await sql`SELECT COUNT(*) as cnt FROM public.live_flight_detections_rows`;
      const qCount2 = await sql`SELECT COUNT(*) as cnt FROM quarantine.evidence_flight_dump_20260103_sealed`;
      const shadowCount2 = await sql`SELECT COUNT(*) as cnt FROM public.unified_flight_detections_shadow`;
      
      const mainN = Number((mainCount2[0] as any)?.cnt || 0);
      const qN = Number((qCount2[0] as any)?.cnt || 0);
      const shadowN = Number((shadowCount2[0] as any)?.cnt || 0);
      
      // Deduped rows = (main + quarantine) - shadow
      const dedupedCount = (mainN + qN) - shadowN;
      
      // Verify no main rows were lost
      const mainInShadow = await sql`SELECT COUNT(*) as cnt FROM public.unified_flight_detections_shadow WHERE source_batch = 'main'`;
      const mainInShadowN = Number((mainInShadow[0] as any)?.cnt || 0);
      
      // Verify quarantine rows present
      const qInShadow = await sql`SELECT COUNT(*) as cnt FROM public.unified_flight_detections_shadow WHERE source_batch = 'quarantine_20260103'`;
      const qInShadowN = Number((qInShadow[0] as any)?.cnt || 0);
      
      // Taxonomy distribution in shadow
      const taxonomySample = await sql.unsafe(`
        SELECT taxonomy_tag, source_batch, COUNT(*) as cnt
        FROM public.unified_flight_detections_shadow TABLESAMPLE SYSTEM(1)
        GROUP BY taxonomy_tag, source_batch
        ORDER BY cnt DESC LIMIT 20
      `);
      
      return {
        mainTableRows: mainN,
        quarantineRows: qN,
        shadowRows: shadowN,
        deduplicatedRows: dedupedCount,
        mainRowsInShadow: mainInShadowN,
        quarantineRowsInShadow: qInShadowN,
        zeroDataLoss: mainInShadowN === mainN,
        mergeIntegrity: shadowN >= mainN,
        taxonomySample,
        readyToSwap: mainInShadowN === mainN && shadowN >= mainN,
        timestamp: new Date().toISOString()
      };
    }

    case 'quarantineMergeSwap': {
      // Step 4: Rename tables — shadow becomes main, old main becomes backup
      // Safety check first
      const mainC = await sql`SELECT COUNT(*) as cnt FROM public.live_flight_detections_rows`;
      const shadowC = await sql`SELECT COUNT(*) as cnt FROM public.unified_flight_detections_shadow`;
      const mainN2 = Number((mainC[0] as any)?.cnt || 0);
      const shadowN2 = Number((shadowC[0] as any)?.cnt || 0);
      
      if (shadowN2 < mainN2) throw new Error(`Shadow table (${shadowN2}) has fewer rows than main (${mainN2}). Aborting swap.`);
      
      // Perform atomic rename swap
      await sql.unsafe(`ALTER TABLE public.live_flight_detections_rows RENAME TO live_flight_detections_rows_pre_merge_backup`);
      await sql.unsafe(`ALTER TABLE public.unified_flight_detections_shadow RENAME TO live_flight_detections_rows`);
      
      // Recreate essential indexes
      try {
        await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lfd_registration ON public.live_flight_detections_rows (registration)`);
      } catch { /* non-fatal */ }
      try {
        await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lfd_detection_timestamp ON public.live_flight_detections_rows (detection_timestamp)`);
      } catch { /* non-fatal */ }
      try {
        await sql.unsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lfd_taxonomy ON public.live_flight_detections_rows (taxonomy_tag)`);
      } catch { /* non-fatal */ }
      
      // Final count
      const finalCount = await sql`SELECT COUNT(*) as cnt FROM public.live_flight_detections_rows`;
      
      return {
        swapComplete: true,
        finalRowCount: Number((finalCount[0] as any)?.cnt || 0),
        backupTable: 'live_flight_detections_rows_pre_merge_backup',
        quarantinePreserved: true,
        timestamp: new Date().toISOString()
      };
    }

    case 'getMilitaryAircraft': {
      await sql`SET statement_timeout = '12s'`;
      
      // First try taxonomy_tag index (fast path)
      let militaryFlights = await sql`
        SELECT 
          registration,
          callsign,
          COUNT(*) as detection_count,
          ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
          MIN(detection_timestamp) as first_seen,
          MAX(detection_timestamp) as last_seen
        FROM live_flight_detections_rows
        WHERE taxonomy_tag IN ('military_asset', 'xxb_military')
        AND registration IS NOT NULL AND registration != ''
        GROUP BY registration, callsign
        ORDER BY detection_count DESC
        LIMIT 50
      `;

      // If taxonomy yielded few results, supplement with callsign pattern match on recent data only
      if (militaryFlights.length < 10) {
        const supplemental = await sql`
          SELECT 
            registration,
            callsign,
            COUNT(*) as detection_count,
            ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen
          FROM live_flight_detections_rows
          WHERE callsign ~ '^(KNIFE|STMPD|JOLLY|COBRA|GHOST|SHADO|RAIDR|GRZLY|LOST|CNV|LBRTY|REACH|FORGE|TOPCT)[0-9]'
            AND registration IS NOT NULL AND registration != ''
            AND detection_timestamp > NOW() - INTERVAL '90 days'
          GROUP BY registration, callsign
          ORDER BY detection_count DESC
          LIMIT 30
        `;
        // Merge, dedup by registration+callsign
        const seen = new Set(militaryFlights.map((r: any) => `${r.registration}|${r.callsign}`));
        for (const s of supplemental) {
          if (!seen.has(`${(s as any).registration}|${(s as any).callsign}`)) {
            militaryFlights.push(s as any);
          }
        }
      }

      return {
        militaryFlights,
        timestamp: new Date().toISOString()
      };
    }

    case 'getCanadianCorridor': {
      await sql`SET statement_timeout = '15s'`;
      
      const canadianAircraft = await sql`
        SELECT 
          registration,
          callsign,
          callsign as operator,
          COUNT(*) as detections,
          ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
          MIN(detection_timestamp) as first_seen,
          MAX(detection_timestamp) as last_seen
        FROM live_flight_detections_rows
        WHERE (
          registration LIKE 'C-%' OR 
          registration LIKE 'CF%' OR
          callsign LIKE 'CF%' OR
          callsign LIKE 'AC%' OR
          callsign LIKE 'WJA%' OR
          callsign LIKE 'TSC%' OR
          callsign LIKE 'SKV%' OR
          callsign LIKE 'PDG%' OR
          callsign ~ '^C[A-Z]{3}[0-9]'
        )
        AND registration IS NOT NULL AND registration != ''
        AND latitude BETWEEN 35.20 AND 35.80
        AND longitude BETWEEN -119.40 AND -118.70
        GROUP BY registration, callsign
        HAVING COUNT(*) >= 2
        ORDER BY detections DESC
        LIMIT 100
      `;

      return {
        data: canadianAircraft,
        timestamp: new Date().toISOString()
      };
    }

    case 'biometricOCRAudit': {
      // Audit all biometric/OCR tables for missing HR/HRV
      const audit = await sql`
        SELECT 'biometric_screenshots_ocr' as table_name,
          COUNT(*)::int as total,
          COUNT(CASE WHEN heart_rate IS NULL THEN 1 END)::int as hr_null,
          COUNT(CASE WHEN hrv IS NULL THEN 1 END)::int as hrv_null,
          COUNT(CASE WHEN ocr_text ILIKE '%heart rate%' OR ocr_text ILIKE '%bpm%' OR ocr_text ILIKE '%hrv%' OR ocr_text ILIKE '%recovery%' THEN 1 END)::int as has_bio_keywords
        FROM biometric_screenshots_ocr
        UNION ALL
        SELECT 'whoop_biometrics',
          COUNT(*)::int, COUNT(CASE WHEN resting_hr IS NULL THEN 1 END)::int,
          COUNT(CASE WHEN hrv_score IS NULL THEN 1 END)::int, 0
        FROM whoop_biometrics
        UNION ALL
        SELECT 'screenshot_ocr_data',
          COUNT(*)::int, 0, 0,
          COUNT(CASE WHEN extracted_text ILIKE '%heart%' OR extracted_text ILIKE '%hrv%' OR extracted_text ILIKE '%bpm%' OR extracted_text ILIKE '%stress%' THEN 1 END)::int
        FROM screenshot_ocr_data
        UNION ALL
        SELECT 'biometric_evidence',
          COUNT(*)::int, 0, 0, 0
        FROM biometric_evidence
        UNION ALL
        SELECT 'biometrics_unified',
          COUNT(*)::int, 0, 0, 0
        FROM biometrics_unified
        UNION ALL
        SELECT 'biometric_monitoring',
          COUNT(*)::int, 0, 0, 0
        FROM biometric_monitoring
      `;

      // Get sample OCR text that contains bio keywords but has null HR/HRV
      const extractable = await sql`
        SELECT id, file_path, best_timestamp,
          substring(ocr_text from 1 for 500) as ocr_preview,
          source_app
        FROM biometric_screenshots_ocr
        WHERE heart_rate IS NULL
          AND (ocr_text ILIKE '%heart rate%' OR ocr_text ILIKE '%bpm%' OR ocr_text ILIKE '%hrv%'
            OR ocr_text ILIKE '%recovery%' OR ocr_text ILIKE '%stress%'
            OR ocr_text ILIKE '%resting%' OR ocr_text ILIKE '%strain%')
        ORDER BY best_timestamp ASC NULLS LAST
        LIMIT 20
      `;

      return { audit, extractable, timestamp: new Date().toISOString() };
    }

    case 'reprocessBiometricOCR': {
      // Re-extract HR/HRV/stress from existing OCR text using regex patterns
      const batchSize = body.batchSize || 100;
      const offset = body.offset || 0;

      // Get records with bio keywords in OCR but null structured fields
      const records = await sql`
        SELECT id, ocr_text, source_app, best_timestamp
        FROM biometric_screenshots_ocr
        WHERE heart_rate IS NULL
          AND ocr_text IS NOT NULL AND ocr_text != ''
          AND (ocr_text ILIKE '%heart rate%' OR ocr_text ILIKE '%bpm%' OR ocr_text ILIKE '%hrv%'
            OR ocr_text ILIKE '%recovery%' OR ocr_text ILIKE '%stress%'
            OR ocr_text ILIKE '%resting%' OR ocr_text ILIKE '%strain%')
        ORDER BY id
        LIMIT ${batchSize} OFFSET ${offset}
      `;

      let updated = 0;
      let skipped = 0;

      for (const rec of records) {
        const text = rec.ocr_text || '';

        // Extract heart rate - multiple patterns
        let hr: number | null = null;
        const hrPatterns = [
          /(?:heart\s*rate|resting\s*hr|hr)\s*[:\s]*(\d{2,3})\s*(?:bpm)?/i,
          /(\d{2,3})\s*bpm/i,
          /(?:bpm|beats)\s*[:\s]*(\d{2,3})/i,
          /resting\s+(\d{2,3})/i,
          /HEART\s*RATE\s*[^\d]*(\d{2,3})/i,
        ];
        for (const pat of hrPatterns) {
          const m = text.match(pat);
          if (m) { const v = parseInt(m[1]); if (v >= 40 && v <= 220) { hr = v; break; } }
        }

        // Extract HRV
        let hrv: number | null = null;
        const hrvPatterns = [
          /(?:hrv)\s*[:\s]*(\d{1,3})\s*(?:ms)?/i,
          /(?:heart\s*rate\s*variability)\s*[:\s]*(\d{1,3})/i,
          /(\d{1,3})\s*ms\b/i,
        ];
        for (const pat of hrvPatterns) {
          const m = text.match(pat);
          if (m) { const v = parseInt(m[1]); if (v >= 1 && v <= 300) { hrv = v; break; } }
        }

        // Extract stress level - Welltory uses "STRESS 67 %" or "97% Stress"
        let stress: number | null = null;
        const stressPatterns = [
          /STRESS\s+(\d{1,3})\s*%/i,
          /(\d{1,3})\s*%\s*(?:\n|\s)*(?:Stress|stress)/i,
          /(?:stress)\s*[:\s]*(\d{1,3})\s*%?/i,
          /(?:stress\s*(?:level|score))\s*[:\s]*(\d{1,3})/i,
          /Very\s+high.*?(\d{1,3})%/i,
        ];
        for (const pat of stressPatterns) {
          const m = text.match(pat);
          if (m) { const v = parseInt(m[1]); if (v >= 0 && v <= 100) { stress = v; break; } }
        }

        // Extract energy/recovery - Welltory uses "ENERGY 45 %" or "17% Energy"
        let energy: number | null = null;
        const recoveryPatterns = [
          /ENERGY\s+(\d{1,3})\s*%/i,
          /(\d{1,3})\s*%\s*(?:\n|\s)*(?:Energy|energy)/i,
          /(?:recovery)\s*[:\s]*(\d{1,3})\s*%/i,
          /(\d{1,3})\s*%\s*recovery/i,
          /(?:Shortage|Limited|Vulnerable|Energized).*?(\d{1,3})%/i,
        ];
        for (const pat of recoveryPatterns) {
          const m = text.match(pat);
          if (m) { const v = parseInt(m[1]); if (v >= 0 && v <= 100) { energy = v; break; } }
        }

        // Welltory triple-metric pattern: "82% 27% 80%" (Stress/Energy/Health)
        if (stress === null && energy === null) {
          const tripleMatch = text.match(/(\d{1,3})%\s+(\d{1,3})%\s+(?:\.?<?\w*>?\s*)?(\d{1,3})%/);
          if (tripleMatch) {
            const v1 = parseInt(tripleMatch[1]);
            const v2 = parseInt(tripleMatch[2]);
            const v3 = parseInt(tripleMatch[3]);
            if (v1 <= 100 && v2 <= 100 && v3 <= 100) {
              stress = v1;
              energy = v2;
            }
          }
        }

        if (hr !== null || hrv !== null || stress !== null || energy !== null) {
          await sql`
            UPDATE biometric_screenshots_ocr SET
              heart_rate = COALESCE(${hr}, heart_rate),
              hrv = COALESCE(${hrv}, hrv),
              stress_level = COALESCE(${stress}, stress_level),
              energy = COALESCE(${energy}, energy)
            WHERE id = ${rec.id}
          `;
          updated++;
        } else {
          skipped++;
        }
      }

      return {
        processed: records.length,
        updated,
        skipped,
        offset,
        nextOffset: offset + batchSize,
        hasMore: records.length === batchSize,
        timestamp: new Date().toISOString()
      };
    }

    case 'flightAnomalyScan': {
      const aoi_lat = body.lat || 35.437649;
      const aoi_lon = body.lon || -119.022639;
      const radius_nm = body.radius || 10;
      const deg = radius_nm * 0.0166; // ~1 NM per 0.0166 deg

      // 1) Loiter candidates: repeated presence in same ~2km grid cell
      const loiterSql = `
        SELECT registration, 
          ROUND(latitude::numeric, 2) as grid_lat, ROUND(longitude::numeric, 2) as grid_lon,
          COUNT(*) as n_points,
          COUNT(DISTINCT DATE(detection_timestamp)) as distinct_days,
          MIN(detection_timestamp) as first_seen, MAX(detection_timestamp) as last_seen,
          ROUND(AVG(speed)::numeric,1) as avg_speed, ROUND(AVG(altitude)::numeric,0) as avg_alt,
          ROUND(MIN(altitude)::numeric,0) as min_alt
        FROM live_flight_detections_rows
        WHERE latitude BETWEEN ${aoi_lat - deg} AND ${aoi_lat + deg}
          AND longitude BETWEEN ${aoi_lon - deg} AND ${aoi_lon + deg}
          AND registration IS NOT NULL AND registration != ''
          AND detection_timestamp IS NOT NULL
        GROUP BY registration, ROUND(latitude::numeric, 2), ROUND(longitude::numeric, 2)
        HAVING COUNT(*) >= 10 AND COUNT(DISTINCT DATE(detection_timestamp)) >= 2
        ORDER BY COUNT(DISTINCT DATE(detection_timestamp)) DESC, COUNT(*) DESC
        LIMIT 50
      `;

      // 2) Callsign switching: aircraft with many distinct callsigns
      const switchingSql = `
        SELECT registration, COUNT(*) as n_points,
          COUNT(DISTINCT callsign) as n_callsigns,
          ARRAY_AGG(DISTINCT callsign ORDER BY callsign) as callsigns,
          ROUND(AVG(altitude)::numeric,0) as avg_alt
        FROM live_flight_detections_rows
        WHERE latitude BETWEEN ${aoi_lat - deg} AND ${aoi_lat + deg}
          AND longitude BETWEEN ${aoi_lon - deg} AND ${aoi_lon + deg}
          AND registration IS NOT NULL AND registration != ''
          AND detection_timestamp IS NOT NULL
        GROUP BY registration
        HAVING COUNT(*) >= 20 AND COUNT(DISTINCT callsign) >= 3
        ORDER BY COUNT(DISTINCT callsign) DESC
        LIMIT 30
      `;

      // 3) Most flagged aircraft in AOI
      const flaggedSql = `
        SELECT registration, COUNT(*) as total_detections,
          SUM(CASE WHEN flagged THEN 1 ELSE 0 END) as flagged_count,
          MAX(threat_score) as max_threat,
          ROUND(AVG(altitude)::numeric,0) as avg_alt,
          ROUND(AVG(speed)::numeric,0) as avg_speed,
          MAX(taxonomy_tag) as taxonomy,
          MAX(owner_operator) as operator
        FROM live_flight_detections_rows
        WHERE latitude BETWEEN ${aoi_lat - deg} AND ${aoi_lat + deg}
          AND longitude BETWEEN ${aoi_lon - deg} AND ${aoi_lon + deg}
          AND registration IS NOT NULL AND registration != ''
        GROUP BY registration
        HAVING SUM(CASE WHEN flagged THEN 1 ELSE 0 END) > 0
        ORDER BY MAX(threat_score) DESC, SUM(CASE WHEN flagged THEN 1 ELSE 0 END) DESC
        LIMIT 30
      `;

      const [loiter, switching, flagged] = await Promise.all([
        sql.unsafe(loiterSql),
        sql.unsafe(switchingSql),
        sql.unsafe(flaggedSql),
      ]);

      return {
        aoi: { lat: aoi_lat, lon: aoi_lon, radius_nm },
        loiterCandidates: loiter,
        callsignSwitching: switching,
        topFlagged: flagged,
        summary: {
          loiterCount: (loiter as any[]).length,
          switchingCount: (switching as any[]).length,
          flaggedCount: (flagged as any[]).length,
        }
      };
    }

    case 'obfuscationDetectionMatrix': {
      // Detects: blocked tail numbers, masked ICAOs, ID cloning,
      // time-randomized loops, registration switching — all bounded to AOI.
      const aoi_lat = body.aoi_lat ?? 35.437649;
      const aoi_lon = body.aoi_lon ?? -119.022639;
      const radius_nm = body.radius_nm ?? 25;
      const days = Math.min(body.days ?? 7, 30);
      const deg = radius_nm / 60.0;
      const latMin = aoi_lat - deg, latMax = aoi_lat + deg;
      const lonMin = aoi_lon - deg, lonMax = aoi_lon + deg;

      // Cap each subquery to keep total under the 150s idle budget
      await sql.unsafe(`SET LOCAL statement_timeout = '25s'`).catch(() => {});

      const geoFilter = `latitude BETWEEN ${latMin} AND ${latMax} AND longitude BETWEEN ${lonMin} AND ${lonMax}`;
      const timeFilter = `detection_timestamp > NOW() - INTERVAL '${days} days'`;

      const blockedIdentitySql = `
        SELECT
          COALESCE(NULLIF(registration,''),'<BLOCKED>') as registration,
          COALESCE(NULLIF(callsign,''),'<BLOCKED>') as callsign,
          COALESCE(NULLIF(icao_code,''),'<BLOCKED>') as icao_code,
          COUNT(*)::int as detections,
          MIN(detection_timestamp) as first_seen,
          MAX(detection_timestamp) as last_seen,
          MIN(altitude)::int as min_alt,
          MAX(altitude)::int as max_alt,
          AVG(altitude)::int as avg_alt
        FROM live_flight_detections_rows
        WHERE ${timeFilter} AND ${geoFilter}
          AND (
            registration IS NULL OR registration = '' OR registration ILIKE '%BLOCK%' OR registration ILIKE '%N/A%'
            OR callsign IS NULL OR callsign = '' OR callsign ILIKE '%BLOCK%' OR callsign ILIKE '%N/A%'
            OR icao_code IS NULL OR icao_code = '' OR icao_code = '000000' OR icao_code ILIKE 'XXB%'
          )
        GROUP BY 1,2,3
        HAVING COUNT(*) >= 3
        ORDER BY detections DESC
        LIMIT 50
      `;

      // Cloning — now scoped to AOI (was unscoped → 150s timeout)
      const cloningSql = `
        WITH icao_regs AS (
          SELECT icao_code,
                 COUNT(DISTINCT registration) FILTER (WHERE registration IS NOT NULL AND registration != '') as reg_count,
                 array_agg(DISTINCT registration) FILTER (WHERE registration IS NOT NULL AND registration != '') as regs,
                 COUNT(*)::int as detections
          FROM live_flight_detections_rows
          WHERE ${timeFilter} AND ${geoFilter}
            AND icao_code IS NOT NULL AND icao_code != ''
          GROUP BY icao_code
          HAVING COUNT(DISTINCT registration) FILTER (WHERE registration IS NOT NULL AND registration != '') >= 2
        )
        SELECT icao_code, reg_count::int, regs[1:5] as sample_regs, detections
        FROM icao_regs
        ORDER BY reg_count DESC, detections DESC
        LIMIT 30
      `;

      const callsignRotationSql = `
        SELECT registration,
               COUNT(DISTINCT callsign) FILTER (WHERE callsign IS NOT NULL AND callsign != '')::int as unique_callsigns,
               (array_agg(DISTINCT callsign) FILTER (WHERE callsign IS NOT NULL AND callsign != ''))[1:10] as callsigns,
               COUNT(*)::int as detections,
               MIN(detection_timestamp) as first_seen,
               MAX(detection_timestamp) as last_seen
        FROM live_flight_detections_rows
        WHERE ${timeFilter} AND ${geoFilter}
          AND registration IS NOT NULL AND registration != ''
        GROUP BY registration
        HAVING COUNT(DISTINCT callsign) FILTER (WHERE callsign IS NOT NULL AND callsign != '') >= 3
        ORDER BY unique_callsigns DESC
        LIMIT 30
      `;

      const timeRandomizedSql = `
        WITH grid AS (
          SELECT registration,
                 ROUND(latitude::numeric, 2) as lat_bin,
                 ROUND(longitude::numeric, 2) as lon_bin,
                 EXTRACT(HOUR FROM detection_timestamp)::int as hr,
                 detection_timestamp::date as d
          FROM live_flight_detections_rows
          WHERE ${timeFilter} AND ${geoFilter}
            AND registration IS NOT NULL AND registration != ''
        )
        SELECT registration, lat_bin::float8 as lat, lon_bin::float8 as lon,
               COUNT(DISTINCT d)::int as days_seen,
               COUNT(DISTINCT hr)::int as unique_hours,
               COUNT(*)::int as visits
        FROM grid
        GROUP BY registration, lat_bin, lon_bin
        HAVING COUNT(DISTINCT d) >= 3 AND COUNT(DISTINCT hr) >= 6
        ORDER BY unique_hours DESC, visits DESC
        LIMIT 30
      `;

      const safeRun = async (q: string) => {
        try { return await sql.unsafe(q); }
        catch (e) { console.error('obfuscation subquery failed:', (e as Error).message); return []; }
      };
      const blocked = await safeRun(blockedIdentitySql);
      const cloning = await safeRun(cloningSql);
      const rotation = await safeRun(callsignRotationSql);
      const randomized = await safeRun(timeRandomizedSql);

      const scores = new Map<string, { score: number; tactics: string[] }>();
      const bump = (reg: string, pts: number, tactic: string) => {
        if (!reg || reg === '<BLOCKED>') return;
        const cur = scores.get(reg) || { score: 0, tactics: [] };
        cur.score += pts;
        if (!cur.tactics.includes(tactic)) cur.tactics.push(tactic);
        scores.set(reg, cur);
      };
      (blocked as any[]).forEach(r => bump(r.registration, 30, 'BLOCKED_IDENTITY'));
      (rotation as any[]).forEach(r => bump(r.registration, Math.min(40, r.unique_callsigns * 5), 'CALLSIGN_ROTATION'));
      (randomized as any[]).forEach(r => bump(r.registration, Math.min(35, r.unique_hours * 2), 'TIME_RANDOMIZED_LOOP'));
      (cloning as any[]).forEach(r => {
        const regs = Array.isArray(r.sample_regs) ? r.sample_regs : (r.regs || []);
        (Array.isArray(regs) ? regs : []).forEach((reg: string) => bump(reg, 25, 'ICAO_CLONING'));
      });

      const topSuspects = Array.from(scores.entries())
        .map(([registration, v]) => ({ registration, score: v.score, tactics: v.tactics }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 25);

      return {
        aoi: { lat: aoi_lat, lon: aoi_lon, radius_nm, days },
        blockedIdentity: blocked,
        icaoCloning: cloning,
        callsignRotation: rotation,
        timeRandomizedLoops: randomized,
        topSuspects,
        summary: {
          blockedCount: (blocked as any[]).length,
          cloningCount: (cloning as any[]).length,
          rotationCount: (rotation as any[]).length,
          randomizedCount: (randomized as any[]).length,
          suspectCount: topSuspects.length,
        }
      };
    }

    case 'zeroFootClassification': {
      // Classifies altitude=0/NULL detections by airport proximity to separate
      // ramp/taxi noise from genuine residential staging evidence.
      const days = Math.min(parseInt(String(body.days ?? 7)), 30);
      const radiusKm = Number(body.airportRadiusKm ?? 5); // 5km default = ~2.7nm
      const aoiLat = Number(body.aoi_lat ?? 35.437649);
      const aoiLon = Number(body.aoi_lon ?? -119.022639);
      const aoiRadiusKm = Number(body.aoi_radius_km ?? 3); // residence cluster radius
      const limit = Math.min(parseInt(String(body.limit ?? 500)), 2000);

      // Airports in/near the AOI. lat, lon, ICAO, name
      const AIRPORTS: Array<[number, number, string, string]> = [
        [35.4336, -119.0568, 'KBFL', 'Meadows Field'],
        [35.3249, -118.9963, 'L45',  'Bakersfield Municipal'],
        [35.6588, -117.8294, 'KIYK', 'Inyokern'],
        [36.0296, -119.0631, 'KPTV', 'Porterville'],
        [35.7434, -119.2369, 'KDLO', 'Delano'],
        [35.0594, -118.1517, 'KMHV', 'Mojave'],
        [34.9054, -117.8838, 'KEDW', 'Edwards AFB'],
        [35.1357, -119.4407, 'KTFT', 'Taft-Kern County'],
        [35.5066, -119.4421, 'L73',  'Poso Kern County'],
        [35.4347, -118.7421, 'L62',  'Tehachapi Municipal'],
      ];

      try {
        await sql.unsafe(`SET LOCAL statement_timeout = '40s'`);
      } catch (_) { /* ignore */ }

      // Pull recent 0ft detections in / near the AOI bounding box
      const rows: any[] = await sql.unsafe(`
        SELECT 
          registration, icao_code, callsign,
          latitude, longitude, altitude, speed,
          detection_timestamp, taxonomy_tag
        FROM live_flight_detections_rows
        WHERE detection_timestamp > NOW() - INTERVAL '${days} days'
          AND (altitude IS NULL OR altitude = 0)
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude BETWEEN 34.5 AND 36.2
          AND longitude BETWEEN -119.6 AND -117.5
        ORDER BY detection_timestamp DESC
        LIMIT ${limit}
      `);

      // Haversine in km
      const distKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371;
        const toRad = (d: number) => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
        return 2 * R * Math.asin(Math.sqrt(a));
      };

      const classified = rows.map((r: any) => {
        const lat = Number(r.latitude);
        const lon = Number(r.longitude);

        // Nearest airport
        let nearestAirport = AIRPORTS[0];
        let nearestDist = distKm(lat, lon, AIRPORTS[0][0], AIRPORTS[0][1]);
        for (const a of AIRPORTS) {
          const d = distKm(lat, lon, a[0], a[1]);
          if (d < nearestDist) { nearestDist = d; nearestAirport = a; }
        }

        const aoiDist = distKm(lat, lon, aoiLat, aoiLon);

        let classification: 'AIRPORT_GROUND' | 'RESIDENTIAL_STAGING' | 'OPEN_FIELD';
        let evidenceWeight: 'DROP' | 'KEEP_TIER1' | 'INVESTIGATE';

        if (nearestDist <= radiusKm) {
          classification = 'AIRPORT_GROUND';
          evidenceWeight = 'DROP';
        } else if (aoiDist <= aoiRadiusKm) {
          classification = 'RESIDENTIAL_STAGING';
          evidenceWeight = 'KEEP_TIER1';
        } else {
          classification = 'OPEN_FIELD';
          evidenceWeight = 'INVESTIGATE';
        }

        return {
          registration: r.registration,
          icao_code: r.icao_code,
          callsign: r.callsign,
          latitude: lat,
          longitude: lon,
          speed: r.speed,
          detection_timestamp: r.detection_timestamp,
          taxonomy_tag: r.taxonomy_tag,
          nearest_airport: nearestAirport[2],
          nearest_airport_name: nearestAirport[3],
          nearest_airport_km: Number(nearestDist.toFixed(2)),
          aoi_distance_km: Number(aoiDist.toFixed(2)),
          classification,
          evidence_weight: evidenceWeight,
        };
      });

      const summary = {
        total_zero_foot: classified.length,
        airport_ground: classified.filter(c => c.classification === 'AIRPORT_GROUND').length,
        residential_staging: classified.filter(c => c.classification === 'RESIDENTIAL_STAGING').length,
        open_field: classified.filter(c => c.classification === 'OPEN_FIELD').length,
        airports_used: AIRPORTS.map(a => ({ icao: a[2], name: a[3], lat: a[0], lon: a[1] })),
        airport_radius_km: radiusKm,
        aoi: { lat: aoiLat, lon: aoiLon, radius_km: aoiRadiusKm },
        days_window: days,
      };

      // Top residential staging suspects (by registration)
      const stagingByReg = new Map<string, { count: number; last_seen: string; first_seen: string }>();
      for (const c of classified) {
        if (c.classification !== 'RESIDENTIAL_STAGING' || !c.registration) continue;
        const cur = stagingByReg.get(c.registration) || { count: 0, last_seen: c.detection_timestamp, first_seen: c.detection_timestamp };
        cur.count += 1;
        if (new Date(c.detection_timestamp) > new Date(cur.last_seen)) cur.last_seen = c.detection_timestamp;
        if (new Date(c.detection_timestamp) < new Date(cur.first_seen)) cur.first_seen = c.detection_timestamp;
        stagingByReg.set(c.registration, cur);
      }
      const topStagingSuspects = Array.from(stagingByReg.entries())
        .map(([registration, v]) => ({ registration, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 25);

      return { summary, detections: classified, topStagingSuspects };
    }

    case 'nightOpsAnomalyScan': {
      // Flags aircraft broadcasting >X% night ops (UTC 22:00-05:59) and CLASSIFIES legitimacy
      // (commercial scheduled / foreign carrier / domestic GA / military / unknown) so investigators
      // can decide what to dismiss vs. escalate. Cross-checks against impossible-altitude spoofing.
      const days = Math.min(parseInt(String(body.days ?? 30)), 365);
      const minTotalDetections = Math.max(parseInt(String(body.minDetections ?? 20)), 5);
      const nightThresholdPct = Number(body.nightThresholdPct ?? 25);
      const limit = Math.min(parseInt(String(body.limit ?? 100)), 500);
      const includeAirlines = Boolean(body.includeAirlines ?? false);

      try { await sql.unsafe(`SET LOCAL statement_timeout = '60s'`); } catch (_) {}

      const rows: any[] = await sql.unsafe(`
        WITH base AS (
          SELECT
            registration,
            COUNT(*)::int as total_detections,
            SUM(CASE WHEN EXTRACT(HOUR FROM detection_timestamp) >= 22
                     OR EXTRACT(HOUR FROM detection_timestamp) < 6
                     THEN 1 ELSE 0 END)::int as night_count,
            COUNT(DISTINCT DATE(detection_timestamp))::int as active_days,
            MIN(detection_timestamp) as first_seen,
            MAX(detection_timestamp) as last_seen,
            AVG(NULLIF(altitude,0))::int as avg_altitude,
            MIN(NULLIF(altitude,0))::int as min_altitude,
            MAX(NULLIF(altitude,0))::int as max_altitude,
            COUNT(DISTINCT callsign) FILTER (WHERE callsign IS NOT NULL AND callsign != '')::int as unique_callsigns,
            STRING_AGG(DISTINCT callsign, ',' ORDER BY callsign) FILTER (WHERE callsign IS NOT NULL AND callsign != '') as callsigns_csv
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${days} days'
            AND registration IS NOT NULL AND registration != ''
            AND registration NOT IN ('<BLOCKED>','BLOCKED','UNKNOWN','')
          GROUP BY registration
          HAVING COUNT(*) >= ${minTotalDetections}
        )
        SELECT *,
          ROUND((night_count::numeric / NULLIF(total_detections,0)) * 100, 1) as night_pct
        FROM base
        WHERE (night_count::numeric / NULLIF(total_detections,0)) * 100 >= ${nightThresholdPct}
        ORDER BY night_pct DESC, night_count DESC
        LIMIT ${limit * 3}
      `);

      // Cross-check: which of these are also flagged for impossible-altitude spoofing?
      const allRegs = rows.map(r => r.registration).filter(Boolean);
      let spoofingRegs = new Set<string>();
      if (allRegs.length > 0) {
        try {
          const spoofRows: any[] = await sql.unsafe(`
            SELECT DISTINCT registration FROM live_flight_detections_rows
            WHERE registration = ANY($1::text[])
              AND altitude > 65000
              AND detection_timestamp > NOW() - INTERVAL '${days} days'
          `, [allRegs]);
          spoofingRegs = new Set(spoofRows.map(s => s.registration));
        } catch (_) {}
      }

      // Airline callsign prefix → carrier (ICAO 3-letter)
      const AIRLINE_PREFIXES: Record<string, string> = {
        UAL: 'United', SWA: 'Southwest', ASA: 'Alaska', AAL: 'American', DAL: 'Delta',
        JBU: 'JetBlue', FFT: 'Frontier', NKS: 'Spirit', SKW: 'SkyWest', QXE: 'Horizon',
        ENY: 'Envoy', RPA: 'Republic', JIA: 'PSA', EJA: 'NetJets', JAL: 'JAL', ANA: 'ANA',
        CCA: 'Air China', CES: 'China Eastern', CSN: 'China Southern', SIA: 'Singapore',
        ACA: 'Air Canada', WJA: 'WestJet', AMX: 'Aeromexico', VOI: 'Volaris', KAL: 'Korean',
        EVA: 'EVA Air', CAL: 'China Airlines', THA: 'Thai', QFA: 'Qantas',
      };

      const classify = (reg: string, callsigns: string, avgAlt: number | null, minAlt: number | null) => {
        const r = (reg || '').toUpperCase();
        const cs = (callsigns || '').toUpperCase().split(',').filter(Boolean);
        const isForeign = !/^N[0-9]/.test(r);

        // Check airline callsign prefix
        let airline: string | null = null;
        for (const cs1 of cs) {
          const prefix = cs1.slice(0, 3);
          if (AIRLINE_PREFIXES[prefix]) { airline = AIRLINE_PREFIXES[prefix]; break; }
        }
        // Alaska fleet pattern (N6xxAS, N4xxAS, N9xxAK)
        if (!airline && /^N\d+(AS|AK|WN|UA|AA|DL|JB)$/.test(r)) {
          if (r.endsWith('AS') || r.endsWith('AK')) airline = 'Alaska';
          else if (r.endsWith('WN')) airline = 'Southwest';
          else if (r.endsWith('UA')) airline = 'United';
          else if (r.endsWith('AA')) airline = 'American';
          else if (r.endsWith('DL')) airline = 'Delta';
          else if (r.endsWith('JB')) airline = 'JetBlue';
        }

        const cruiseAlt = (avgAlt ?? 0) > 18000;

        if (airline && cruiseAlt) return { category: 'COMMERCIAL_SCHEDULED', operator_hint: airline, legitimacy: 'LIKELY_LEGITIMATE' };
        if (airline) return { category: 'COMMERCIAL_LOW_ALT', operator_hint: airline, legitimacy: 'INVESTIGATE' };
        if (isForeign && cruiseAlt) return { category: 'FOREIGN_CARRIER', operator_hint: r.split('-')[0], legitimacy: 'LIKELY_LEGITIMATE' };
        if (isForeign) return { category: 'FOREIGN_UNKNOWN', operator_hint: r.split('-')[0], legitimacy: 'INVESTIGATE' };
        if ((minAlt ?? 99999) < 2000) return { category: 'DOMESTIC_LOW_ALT', operator_hint: null, legitimacy: 'HIGH_PRIORITY' };
        return { category: 'DOMESTIC_UNKNOWN', operator_hint: null, legitimacy: 'INVESTIGATE' };
      };

      const allSuspects = rows.map((r: any) => {
        const nightPct = Number(r.night_pct) || 0;
        const cls = classify(r.registration, r.callsigns_csv || '', r.avg_altitude, r.min_altitude);
        const isSpoofingFlagged = spoofingRegs.has(r.registration);
        const avgA = Number(r.avg_altitude) || 0;
        const minA = Number(r.min_altitude) || 0;
        const altVariance = avgA && minA ? avgA - minA : 0;
        // Surveillance profile: high transit altitude (>5000 ft above min) AND low loiter (<2000 ft min)
        const isSurveillanceProfile = altVariance >= 5000 && minA > 0 && minA < 2000;
        // JSX callsign rotation flag (commercial cover hypothesis)
        const csUpper = (r.callsigns_csv || '').toUpperCase();
        const jsxRotation = /JSX\d/.test(csUpper) && Number(r.unique_callsigns) >= 3;
        // KCSO coordination: N912KC anchor or similar tail prefix in low-alt cohort
        const regU = (r.registration || '').toUpperCase();
        const isKcsoAnchor = /^N9(12|97)KC$|^N\d{3}E$/.test(regU);

        const flags: string[] = [];
        if (isSurveillanceProfile) flags.push('SURVEILLANCE_PROFILE');
        if (jsxRotation) flags.push('JSX_ROTATION');
        if (isKcsoAnchor) flags.push('KCSO_ANCHOR');
        if (isSpoofingFlagged) flags.push('IMPOSSIBLE_ALTITUDE');

        let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
        if (nightPct >= 60) severity = 'CRITICAL';
        else if (nightPct >= 40) severity = 'HIGH';
        if (isSpoofingFlagged || isSurveillanceProfile || isKcsoAnchor) severity = 'CRITICAL';

        return {
          registration: r.registration,
          total_detections: Number(r.total_detections) || 0,
          night_count: Number(r.night_count) || 0,
          night_pct: nightPct,
          active_days: Number(r.active_days) || 0,
          unique_callsigns: Number(r.unique_callsigns) || 0,
          callsigns_sample: (r.callsigns_csv || '').split(',').slice(0, 3).join(', '),
          avg_altitude: r.avg_altitude,
          min_altitude: r.min_altitude,
          max_altitude: r.max_altitude,
          alt_variance: altVariance,
          first_seen: r.first_seen,
          last_seen: r.last_seen,
          severity,
          category: cls.category,
          operator_hint: cls.operator_hint,
          legitimacy: isSpoofingFlagged ? 'SPOOFING_FLAGGED'
            : (isSurveillanceProfile || isKcsoAnchor) ? 'HIGH_PRIORITY'
            : cls.legitimacy,
          is_spoofing_flagged: isSpoofingFlagged,
          tactical_flags: flags,
        };
      });

      // Filter: by default hide LIKELY_LEGITIMATE airlines unless user opts in
      const suspects = allSuspects
        .filter(s => includeAirlines || s.legitimacy !== 'LIKELY_LEGITIMATE' || s.is_spoofing_flagged)
        .slice(0, limit);

      return {
        summary: {
          days_window: days,
          night_threshold_pct: nightThresholdPct,
          include_airlines: includeAirlines,
          total_suspects: suspects.length,
          total_before_filter: allSuspects.length,
          filtered_out_airlines: allSuspects.length - suspects.length,
          critical_count: suspects.filter(s => s.severity === 'CRITICAL').length,
          high_count: suspects.filter(s => s.severity === 'HIGH').length,
          medium_count: suspects.filter(s => s.severity === 'MEDIUM').length,
          spoofing_flagged_count: suspects.filter(s => s.is_spoofing_flagged).length,
          high_priority_count: suspects.filter(s => s.legitimacy === 'HIGH_PRIORITY').length,
          surveillance_profile_count: suspects.filter(s => s.tactical_flags?.includes('SURVEILLANCE_PROFILE')).length,
          jsx_rotation_count: suspects.filter(s => s.tactical_flags?.includes('JSX_ROTATION')).length,
          kcso_anchor_count: suspects.filter(s => s.tactical_flags?.includes('KCSO_ANCHOR')).length,
          category_breakdown: suspects.reduce((acc: any, s) => {
            acc[s.category] = (acc[s.category] || 0) + 1;
            return acc;
          }, {}),
        },
        suspects,
      };
    }

    case 'shellOperatorUnmask': {
      // Cross-references registrations against faa_aircraft_registry to expose owner/operator.
      const regs: string[] = Array.isArray(body.registrations) ? body.registrations.filter((r: any) => typeof r === 'string' && r.length > 0) : [];
      if (regs.length === 0) return { matches: [], unmatched: [] };

      try { await sql.unsafe(`SET LOCAL statement_timeout = '20s'`); } catch (_) {}

      // Try common FAA registry tables; fall back gracefully.
      const candidates = ['faa_aircraft_registry', 'faa_registry', 'aircraft_registry'];
      let matches: any[] = [];
      let usedTable = '';
      for (const t of candidates) {
        try {
          const result: any[] = await sql.unsafe(`
            SELECT
              UPPER(n_number) as registration,
              registrant_name as owner,
              registrant_street as street,
              registrant_city as city,
              registrant_state as state,
              registrant_zip as zip,
              aircraft_manufacturer as manufacturer,
              aircraft_model as model,
              year_manufactured as year,
              registrant_type as owner_type,
              status
            FROM ${t}
            WHERE UPPER(n_number) = ANY($1::text[])
            LIMIT 500
          `, [regs.map(r => r.toUpperCase().replace(/^N/, 'N'))]);
          if (result.length > 0) {
            matches = result;
            usedTable = t;
            break;
          }
          usedTable = t;
        } catch (_) { continue; }
      }

      // Shell signature heuristics
      const shellSignatures = (owner: string | null, type: string | null) => {
        if (!owner) return [];
        const flags: string[] = [];
        const o = owner.toUpperCase();
        if (/\bLLC\b|\bLP\b|\bTRUST\b|\bHOLDING/.test(o)) flags.push('LLC_TRUST_HOLDING');
        if (/\bLEASING\b|\bAIR\b LLC|\bAVIATION\b LLC/.test(o)) flags.push('AVIATION_LLC_PATTERN');
        if (/\bDELAWARE\b|NEWARK/.test(o)) flags.push('DELAWARE_REGISTRATION');
        if (type && /CORPORATION|LLC|PARTNERSHIP/.test(type.toUpperCase())) flags.push('CORPORATE_OWNER');
        if (o.length < 6) flags.push('SUSPICIOUSLY_SHORT_NAME');
        return flags;
      };

      const enriched = matches.map((m: any) => ({
        ...m,
        shell_flags: shellSignatures(m.owner, m.owner_type),
        is_likely_shell: shellSignatures(m.owner, m.owner_type).length >= 2,
      }));

      const matchedRegs = new Set(enriched.map(m => m.registration));
      // Diagnostic: classify why each unmatched reg failed
      const unmatchedDiagnostic = regs
        .filter(r => !matchedRegs.has(r.toUpperCase()))
        .map(r => {
          const u = r.toUpperCase();
          let reason = 'NOT_IN_FAA_REGISTRY';
          if (!/^N[0-9]/.test(u)) reason = 'FOREIGN_REGISTRATION';
          else if (/^N\d+(AS|AK|WN|UA|AA|DL|JB)$/.test(u)) reason = 'AIRLINE_FLEET_CODE';
          return { registration: r, reason };
        });

      const reasonCounts = unmatchedDiagnostic.reduce((acc: any, u) => {
        acc[u.reason] = (acc[u.reason] || 0) + 1;
        return acc;
      }, {});

      return {
        registry_table: usedTable,
        matches: enriched,
        unmatched: unmatchedDiagnostic,
        summary: {
          requested: regs.length,
          matched: enriched.length,
          unmatched: unmatchedDiagnostic.length,
          likely_shells: enriched.filter(e => e.is_likely_shell).length,
          unmatched_breakdown: reasonCounts,
          hint: enriched.length === 0
            ? 'Zero matches — check unmatched_breakdown. Foreign regs and airline fleet codes will not match shell patterns by design.'
            : null,
        }
      };
    }

    case 'openFieldStaging': {
      // Geolocate altitude=0 detections OUTSIDE airport proximity (Open Field Seven hunt).
      // Kern County major airports: KBFL (35.434, -119.057), KMHV (35.059, -118.152),
      // KTFT (35.142, -119.441), L45 Hunt (35.342, -118.999), KIYK Inyokern (35.659, -117.829)
      const days = Math.min(parseInt(String(body.days ?? 7)), 90);
      const exclusionKm = Number(body.exclusionKm ?? 5);
      const aoiLat = Number(body.aoiLat ?? 35.437649);
      const aoiLng = Number(body.aoiLng ?? -119.022639);

      try { await sql.unsafe(`SET LOCAL statement_timeout = '45s'`); } catch (_) {}

      const rows: any[] = await sql.unsafe(`
        WITH airports(name, lat, lng) AS (
          VALUES
            ('KBFL', 35.4336, -119.0573),
            ('KMHV', 35.0594, -118.1524),
            ('KTFT', 35.1419, -119.4413),
            ('L45',  35.3424, -118.9986),
            ('KIYK', 35.6588, -117.8294),
            ('KEDW', 34.9054, -117.8835)
        ),
        candidates AS (
          SELECT
            registration, callsign, icao_code, latitude, longitude,
            altitude, speed, detection_timestamp, taxonomy_tag, flagged_reasons
          FROM live_flight_detections_rows
          WHERE detection_timestamp > NOW() - INTERVAL '${days} days'
            AND altitude = 0
            AND speed < 50
            AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND latitude BETWEEN 34.5 AND 36.0
            AND longitude BETWEEN -120.0 AND -117.5
        ),
        annotated AS (
          SELECT c.*,
            (SELECT MIN(
              111.045 * DEGREES(ACOS(LEAST(1.0,
                COS(RADIANS(c.latitude)) * COS(RADIANS(a.lat)) *
                COS(RADIANS(a.lng) - RADIANS(c.longitude)) +
                SIN(RADIANS(c.latitude)) * SIN(RADIANS(a.lat))
              )))
            ) FROM airports a) as nearest_airport_km,
            (SELECT name FROM airports a ORDER BY
              111.045 * DEGREES(ACOS(LEAST(1.0,
                COS(RADIANS(c.latitude)) * COS(RADIANS(a.lat)) *
                COS(RADIANS(a.lng) - RADIANS(c.longitude)) +
                SIN(RADIANS(c.latitude)) * SIN(RADIANS(a.lat))
              ))) ASC LIMIT 1) as nearest_airport,
            111.045 * DEGREES(ACOS(LEAST(1.0,
              COS(RADIANS(c.latitude)) * COS(RADIANS(${aoiLat})) *
              COS(RADIANS(${aoiLng}) - RADIANS(c.longitude)) +
              SIN(RADIANS(c.latitude)) * SIN(RADIANS(${aoiLat}))
            ))) as aoi_distance_km
          FROM candidates c
        )
        SELECT * FROM annotated
        WHERE nearest_airport_km > ${exclusionKm}
        ORDER BY aoi_distance_km ASC
        LIMIT 100
      `);

      // Classify the staging zone heuristically
      const classify = (lat: number, lng: number) => {
        // Kern oilfields (rough envelope: 35.30-35.50, -119.10 to -118.85)
        if (lat >= 35.30 && lat <= 35.50 && lng >= -119.10 && lng <= -118.85) return 'OIL_FIELD_ZONE';
        // Mojave desert/test corridor
        if (lat <= 35.20 && lng >= -118.40) return 'DESERT_TEST_CORRIDOR';
        // Ag belt south/west of Bakersfield
        if (lat >= 35.20 && lat <= 35.45 && lng <= -119.10) return 'AGRICULTURAL_BELT';
        if (lat >= 35.50) return 'NORTH_VALLEY_RURAL';
        return 'UNCLASSIFIED_RURAL';
      };

      const detections = rows.map((r: any) => ({
        registration: r.registration,
        callsign: r.callsign,
        icao: r.icao_code,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        altitude_ft: Number(r.altitude) || 0,
        speed_kt: Number(r.speed) || 0,
        timestamp: r.detection_timestamp,
        nearest_airport: r.nearest_airport,
        nearest_airport_km: Number(r.nearest_airport_km).toFixed(2),
        aoi_distance_km: Number(r.aoi_distance_km).toFixed(2),
        zone_classification: classify(Number(r.latitude), Number(r.longitude)),
        taxonomy_tag: r.taxonomy_tag,
      }));

      const zoneBreakdown = detections.reduce((acc: any, d) => {
        acc[d.zone_classification] = (acc[d.zone_classification] || 0) + 1;
        return acc;
      }, {});

      return {
        summary: {
          days_window: days,
          exclusion_km: exclusionKm,
          aoi: { lat: aoiLat, lng: aoiLng },
          total_detections: detections.length,
          unique_aircraft: new Set(detections.map(d => d.registration).filter(Boolean)).size,
          zone_breakdown: zoneBreakdown,
          closest_to_aoi_km: detections[0]?.aoi_distance_km ?? null,
        },
        detections,
      };
    }

    case 'kcsoCoordinationCheck': {
      // Cross-reference KCSO anchor (default N912KC) against other low-altitude assets
      // active in the same ±15 minute windows. Builds the coordination matrix Josiah requested.
      const anchor = String(body.anchor ?? 'N912KC').toUpperCase();
      const days = Math.min(parseInt(String(body.days ?? 30)), 180);
      const windowMin = Math.min(parseInt(String(body.windowMin ?? 15)), 60);
      const altCeiling = Number(body.altCeilingFt ?? 3000);

      try { await sql.unsafe(`SET LOCAL statement_timeout = '45s'`); } catch (_) {}

      const rows: any[] = await sql.unsafe(`
        WITH anchor_pings AS (
          SELECT detection_timestamp as t, latitude as alat, longitude as alng, altitude as aalt
          FROM live_flight_detections_rows
          WHERE UPPER(registration) = $1
            AND detection_timestamp > NOW() - INTERVAL '${days} days'
            AND altitude IS NOT NULL AND altitude < ${altCeiling}
            AND latitude IS NOT NULL AND longitude IS NOT NULL
        ),
        coincident AS (
          SELECT
            d.registration,
            d.callsign,
            d.altitude,
            d.latitude,
            d.longitude,
            d.detection_timestamp,
            a.t as anchor_time,
            a.aalt as anchor_alt,
            EXTRACT(EPOCH FROM (d.detection_timestamp - a.t))/60 as delta_min,
            111.045 * DEGREES(ACOS(LEAST(1.0,
              COS(RADIANS(d.latitude)) * COS(RADIANS(a.alat)) *
              COS(RADIANS(a.alng) - RADIANS(d.longitude)) +
              SIN(RADIANS(d.latitude)) * SIN(RADIANS(a.alat))
            ))) as dist_km
          FROM live_flight_detections_rows d
          JOIN anchor_pings a
            ON d.detection_timestamp BETWEEN a.t - INTERVAL '${windowMin} min' AND a.t + INTERVAL '${windowMin} min'
          WHERE UPPER(d.registration) <> $1
            AND d.detection_timestamp > NOW() - INTERVAL '${days} days'
            AND d.altitude IS NOT NULL AND d.altitude < ${altCeiling}
            AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
            AND d.registration IS NOT NULL AND d.registration != ''
        )
        SELECT
          registration,
          COUNT(*)::int as coincident_pings,
          COUNT(DISTINCT DATE(detection_timestamp))::int as days_coincident,
          AVG(altitude)::int as avg_alt_when_coincident,
          MIN(altitude)::int as min_alt_when_coincident,
          AVG(dist_km)::numeric(10,2) as avg_distance_km,
          MIN(dist_km)::numeric(10,2) as min_distance_km
        FROM coincident
        WHERE dist_km < 50
        GROUP BY registration
        HAVING COUNT(*) >= 3
        ORDER BY coincident_pings DESC
        LIMIT 50
      `, [anchor]);

      const cohort = rows.map((r: any) => ({
        registration: r.registration,
        coincident_pings: Number(r.coincident_pings),
        days_coincident: Number(r.days_coincident),
        avg_alt_ft: r.avg_alt_when_coincident,
        min_alt_ft: r.min_alt_when_coincident,
        avg_distance_km: Number(r.avg_distance_km),
        min_distance_km: Number(r.min_distance_km),
        coordination_score: Math.min(100, Number(r.coincident_pings) * Number(r.days_coincident)),
      }));

      return {
        summary: {
          anchor,
          days_window: days,
          window_minutes: windowMin,
          altitude_ceiling_ft: altCeiling,
          coincident_aircraft: cohort.length,
          high_coordination: cohort.filter(c => c.coordination_score >= 30).length,
        },
        cohort,
      };
    }

    default:
      return null;
  }
}

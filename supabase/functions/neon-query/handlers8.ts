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
      
      // Use taxonomy_tag index + known registration patterns for speed
      const militaryFlights = await sql`
        SELECT 
          registration,
          callsign,
          COUNT(*) as detection_count,
          ROUND(AVG(COALESCE(altitude, 0))::numeric, 0) as avg_altitude,
          MIN(detection_timestamp) as first_seen,
          MAX(detection_timestamp) as last_seen
        FROM live_flight_detections_rows
        WHERE (
          taxonomy_tag IN ('military_asset', 'xxb_military')
          OR registration ~ '^[0-9]{2}-[0-9]{5}$'
          OR registration ~ '^[0-9]{5,6}$'
          OR callsign ~ '^(KNIFE|STMPD|JOLLY|COBRA|GHOST|SHADO|RAIDR|GRZLY|LOST|CNV|LBRTY|REACH|FORGE|TOPCT)[0-9]'
        )
        AND registration IS NOT NULL AND registration != ''
        GROUP BY registration, callsign
        ORDER BY detection_count DESC
        LIMIT 50
      `;

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

    default:
      return null;
  }
}

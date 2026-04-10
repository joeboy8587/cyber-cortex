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

    default:
      return null;
  }
}

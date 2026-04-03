import { useCallback } from 'react';
import { useNeonDatabase } from './useNeonDatabase';
import { extractNeonData, safeNumber } from '@/lib/formatters';
import { neonQuery } from '@/lib/neonQueryRetry';

export interface ArchiveQueryParams {
  startDate?: string;
  endDate?: string;
  category?: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ArchiveSummary {
  totalRecords: number;
  dateRange: { earliest: string | null; latest: string | null };
  categories: Record<string, number>;
}

export function useArchiveDatabase() {
  const { customQuery, isLoading, error, connectionStatus } = useNeonDatabase();

  // ===== canonical_forensic_events =====
  // Columns: canonical_id, source_table, source_id, event_timestamp, registration, callsign, icao_code, icao24, altitude, speed, latitude, longitude, heading, threat_score, flagged, taxonomy_tag, anomaly_flags, network_classification, drone_likelihood, row_payload
  const getForensicEvents = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, category, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND event_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND event_timestamp <= '${endDate}'`;
    if (category) where += ` AND taxonomy_tag = '${category}'`;
    const data = await customQuery(
      `SELECT canonical_id, event_timestamp, registration, callsign, taxonomy_tag, threat_score, altitude, source_table, flagged, network_classification
       FROM canonical_forensic_events ${where}
       ORDER BY event_timestamp DESC LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getForensicEventsSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(event_timestamp) as earliest,
             MAX(event_timestamp) as latest
      FROM canonical_forensic_events
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT taxonomy_tag, COUNT(*)::int as cnt
      FROM canonical_forensic_events
      WHERE taxonomy_tag IS NOT NULL
      GROUP BY taxonomy_tag ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.taxonomy_tag || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  // ===== master_unified_evidence =====
  // Keeping original query — this table returned 2.8M records so columns likely match
  const getUnifiedEvidence = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, category, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND event_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND event_timestamp <= '${endDate}'`;
    if (category) where += ` AND evidence_type = '${category}'`;
    const data = await customQuery(
      `SELECT * FROM master_unified_evidence ${where}
       ORDER BY event_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getUnifiedEvidenceSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(event_timestamp) as earliest,
             MAX(event_timestamp) as latest
      FROM master_unified_evidence
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT evidence_type, COUNT(*)::int as cnt
      FROM master_unified_evidence
      WHERE evidence_type IS NOT NULL
      GROUP BY evidence_type ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.evidence_type || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  // ===== threat_tiers =====
  // Columns: detection_id, wti_score, tier_level, threat_level, components, computed_at, method_version, as_of_timestamp
  const getThreatTiers = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0, category } = params;
    let where = 'WHERE 1=1';
    if (category) where += ` AND tier_level = '${category}'`;
    const data = await customQuery(
      `SELECT detection_id, tier_level, wti_score, threat_level, components, computed_at
       FROM threat_tiers ${where}
       ORDER BY wti_score DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getThreatTiersSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(computed_at) as earliest,
             MAX(computed_at) as latest
      FROM threat_tiers
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT tier_level, COUNT(*)::int as cnt
      FROM threat_tiers
      WHERE tier_level IS NOT NULL
      GROUP BY tier_level ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.tier_level || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  // ===== sentinel_violations =====
  // Columns: id, detection_timestamp, aircraft_registration, aircraft_type, altitude, latitude, longitude, violation_type, severity, description, correlated_biometric, evidence_hash, created_at, alert_sent, sha256_hash
  const getSentinelViolations = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND detection_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND detection_timestamp <= '${endDate}'`;
    const data = await customQuery(
      `SELECT id, detection_timestamp, aircraft_registration, aircraft_type, violation_type, severity, description, altitude
       FROM sentinel_violations ${where}
       ORDER BY detection_timestamp DESC LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getSentinelViolationsSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(detection_timestamp) as earliest,
             MAX(detection_timestamp) as latest
      FROM sentinel_violations
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT violation_type, COUNT(*)::int as cnt
      FROM sentinel_violations
      WHERE violation_type IS NOT NULL
      GROUP BY violation_type ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.violation_type || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  // ===== watchtower_unified_master =====
  // Columns: event_id, event_type, source_table, source_id, event_timestamp, registration, icao_code, callsign, altitude_ft, ground_speed, heading, heart_rate, hrv, stress_level, ...
  const getWatchtowerMaster = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT event_id, event_type, source_table, event_timestamp, registration, callsign, altitude_ft, heart_rate, stress_level
       FROM watchtower_unified_master
       ORDER BY event_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  // ===== biometric tables =====
  const getBiometricCollapses = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND collapse_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND collapse_timestamp <= '${endDate}'`;
    const data = await customQuery(
      `SELECT * FROM biometric_threshold_collapses ${where}
       ORDER BY collapse_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricBatchEvents = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT * FROM unified_biometric_batch_events
       ORDER BY event_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricEvidence = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT * FROM biometric_evidence
       ORDER BY measurement_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricAircraftCorrelations = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT * FROM master_biometric_aircraft_correlations
       ORDER BY biometric_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  // ===== case_evidence_links =====
  // Columns: id, case_id, evidence_table, evidence_id, evidence_type, relevance_score, confidence_score, link_description, added_by_josiah, created_at, sha256_hash, evidence_hash
  const getCaseEvidenceLinks = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0, category } = params;
    let where = 'WHERE 1=1';
    if (category) where += ` AND evidence_table = '${category}'`;
    const data = await customQuery(
      `SELECT id, case_id, evidence_table, evidence_id, evidence_type, relevance_score, confidence_score, link_description, created_at
       FROM case_evidence_links ${where}
       ORDER BY created_at DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getCaseEvidenceLinksSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
      FROM case_evidence_links
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT evidence_table, COUNT(*)::int as cnt
      FROM case_evidence_links
      WHERE evidence_table IS NOT NULL
      GROUP BY evidence_table ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.evidence_table || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  // ===== investigator_master_view_rows =====
  // Columns: serial_id, event_id, source_table, event_type, event_description, aircraft_id, event_timestamp, threat_level, altitude, speed, latitude, longitude, heart_rate, stress_score, correlation_strength, low_altitude_flag, high_stress_flag, sha256_hash
  const getInvestigatorMasterView = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT serial_id, event_id, source_table, event_type, event_description, aircraft_id, event_timestamp, threat_level, altitude, heart_rate, stress_score
       FROM investigator_master_view_rows
       ORDER BY event_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getFullBiometricSummary = useCallback(async () => {
    const data = await customQuery(`
      SELECT 'biometric_threshold_collapses' as source, COUNT(*)::int as cnt FROM biometric_threshold_collapses
      UNION ALL SELECT 'unified_biometric_batch_events', COUNT(*)::int FROM unified_biometric_batch_events
      UNION ALL SELECT 'biometric_evidence', COUNT(*)::int FROM biometric_evidence
      UNION ALL SELECT 'master_biometric_aircraft_correlations', COUNT(*)::int FROM master_biometric_aircraft_correlations
      UNION ALL SELECT 'biometric_monitoring', COUNT(*)::int FROM biometric_monitoring
    `);
    const rows = extractNeonData(data);
    const result: Record<string, number> = {};
    rows.forEach((r: any) => { result[r.source] = safeNumber(r.cnt); });
    return result;
  }, [customQuery]);

  // ===== Cross-Modal Stitched View =====
  const getCrossModalStitched = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 25, offset = 0 } = params;
    const data = await customQuery(`
      SELECT
        spine.event_time,
        spine.event_type,
        spine.aircraft_id as registration,
        f.altitude as flight_altitude,
        f.speed as flight_speed,
        f.callsign as flight_callsign,
        b.heart_rate as bio_heart_rate,
        b.medical_significance as bio_severity,
        ada.violation_type as legal_violation,
        ada.harm_severity as legal_section,
        cel.case_id,
        (CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END
         + CASE WHEN b.collapse_id IS NOT NULL THEN 1 ELSE 0 END
         + CASE WHEN ada.id IS NOT NULL THEN 1 ELSE 0 END
         + CASE WHEN cel.id IS NOT NULL THEN 1 ELSE 0 END) as modal_count
      FROM unified_timeline_enhanced spine
      LEFT JOIN LATERAL (
        SELECT id, altitude, speed, callsign
        FROM live_flight_detections_rows
        WHERE registration = spine.aircraft_id
          AND ABS(EXTRACT(EPOCH FROM (detection_timestamp - spine.event_time))) < 1800
        ORDER BY ABS(EXTRACT(EPOCH FROM (detection_timestamp - spine.event_time)))
        LIMIT 1
      ) f ON true
      LEFT JOIN LATERAL (
        SELECT collapse_id, heart_rate, medical_significance
        FROM biometric_threshold_collapses
        WHERE closest_aircraft_registration = spine.aircraft_id
          OR ABS(EXTRACT(EPOCH FROM (collapse_timestamp - spine.event_time))) < 300
        ORDER BY ABS(EXTRACT(EPOCH FROM (collapse_timestamp - spine.event_time)))
        LIMIT 1
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT id, violation_type, harm_severity
        FROM legal_ada_violations_proper
        WHERE aircraft_registration = spine.aircraft_id
        LIMIT 1
      ) ada ON true
      LEFT JOIN LATERAL (
        SELECT id, case_id
        FROM case_evidence_links
        WHERE sha256_hash IS NOT NULL AND sha256_hash = spine.sha256_hash
        LIMIT 1
      ) cel ON true
      WHERE spine.aircraft_id IS NOT NULL
      ORDER BY spine.event_time DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);
    return extractNeonData(data);
  }, [customQuery]);

  const getCrossModalStitchSummary = useCallback(async () => {
    const data = await customQuery(
      `SELECT
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'unified_timeline_enhanced') as spine_count,
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'live_flight_detections_rows') as flight_count,
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'biometric_threshold_collapses') as bio_count,
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'legal_ada_violations_proper') as legal_count,
        (SELECT reltuples::bigint FROM pg_class WHERE relname = 'case_evidence_links') as case_count`
    );
    const rows = extractNeonData(data);
    const row = rows[0] || {};
    return {
      spineEvents: safeNumber(row.spine_count),
      flightRecords: safeNumber(row.flight_count),
      biometricRecords: safeNumber(row.bio_count),
      legalRecords: safeNumber(row.legal_count),
      caseLinks: safeNumber(row.case_count),
    };
  }, [customQuery]);

  // ===== Chronological Timeline Rebuild =====
  const getChronoTimelineScan = useCallback(async () => {
    const { data } = await neonQuery({ action: 'chronoTimelineScan' });
    return extractNeonData(data);
  }, []);

  const getChronoTimelineRebuild = useCallback(async (params: {
    page?: number; pageSize?: number; startDate?: string; endDate?: string; modality?: string;
  } = {}) => {
    const { data } = await neonQuery({
      action: 'chronoTimelineRebuild',
      page: params.page || 0,
      pageSize: params.pageSize || 100,
      startDate: params.startDate || '2025-01-01',
      endDate: params.endDate || '2027-01-01',
      modality: params.modality || 'all',
    });
    return data;
  }, []);

  const getChronoTimelineSummary = useCallback(async (startDate?: string, endDate?: string) => {
    const { data } = await neonQuery({
      action: 'chronoTimelineSummary',
      startDate: startDate || '2025-01-01',
      endDate: endDate || '2027-01-01',
    });
    return data;
  }, []);

  const getPosseComitatus = useCallback(async (params: {
    registrations?: string[]; timeWindow?: string;
  } = {}) => {
    const { data } = await neonQuery({
      action: 'posseComitatus',
      registrations: params.registrations,
      timeWindow: params.timeWindow || '90 days',
    });
    return data;
  }, []);

  return {
    isLoading,
    error,
    connectionStatus,
    getForensicEvents,
    getForensicEventsSummary,
    getUnifiedEvidence,
    getUnifiedEvidenceSummary,
    getThreatTiers,
    getThreatTiersSummary,
    getSentinelViolations,
    getSentinelViolationsSummary,
    getWatchtowerMaster,
    getBiometricCollapses,
    getBiometricBatchEvents,
    getBiometricEvidence,
    getBiometricAircraftCorrelations,
    getFullBiometricSummary,
    getCaseEvidenceLinks,
    getCaseEvidenceLinksSummary,
    getInvestigatorMasterView,
    getCrossModalStitched,
    getCrossModalStitchSummary,
    getChronoTimelineScan,
    getChronoTimelineRebuild,
    getChronoTimelineSummary,
    getPosseComitatus,
  };
}

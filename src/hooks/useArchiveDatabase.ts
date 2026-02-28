import { useCallback } from 'react';
import { useNeonDatabase } from './useNeonDatabase';
import { extractNeonData, safeNumber } from '@/lib/formatters';

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

  const getForensicEvents = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, category, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND event_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND event_timestamp <= '${endDate}'`;
    if (category) where += ` AND event_type = '${category}'`;
    const data = await customQuery(
      `SELECT id, event_timestamp, event_type, source_table, confidence_score, summary, entity_id
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
      SELECT event_type, COUNT(*)::int as cnt
      FROM canonical_forensic_events
      GROUP BY event_type ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.event_type || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  const getUnifiedEvidence = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, category, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND event_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND event_timestamp <= '${endDate}'`;
    if (category) where += ` AND evidence_type = '${category}'`;
    const data = await customQuery(
      `SELECT id, event_timestamp, evidence_type, source_table, summary, confidence_score
       FROM master_unified_evidence ${where}
       ORDER BY event_timestamp DESC LIMIT ${limit} OFFSET ${offset}`
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

  const getThreatTiers = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0, category } = params;
    let where = 'WHERE 1=1';
    if (category) where += ` AND tier = '${category}'`;
    const data = await customQuery(
      `SELECT id, registration, tier, threat_score, event_type, source_table, created_at
       FROM threat_tiers ${where}
       ORDER BY threat_score DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getThreatTiersSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
      FROM threat_tiers
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT tier, COUNT(*)::int as cnt
      FROM threat_tiers
      GROUP BY tier ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.tier || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  const getSentinelViolations = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND detected_at >= '${startDate}'`;
    if (endDate) where += ` AND detected_at <= '${endDate}'`;
    const data = await customQuery(
      `SELECT id, registration, violation_type, severity, detected_at, details
       FROM sentinel_violations ${where}
       ORDER BY detected_at DESC LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getSentinelViolationsSummary = useCallback(async (): Promise<ArchiveSummary> => {
    const data = await customQuery(`
      SELECT COUNT(*)::int as total,
             MIN(detected_at) as earliest,
             MAX(detected_at) as latest
      FROM sentinel_violations
    `);
    const rows = extractNeonData(data);
    const row = rows[0] || {};

    const catData = await customQuery(`
      SELECT violation_type, COUNT(*)::int as cnt
      FROM sentinel_violations
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

  const getWatchtowerMaster = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT id, registration, event_type, severity, detected_at, source, details
       FROM watchtower_unified_master
       ORDER BY detected_at DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricCollapses = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { startDate, endDate, limit = 50, offset = 0 } = params;
    let where = 'WHERE 1=1';
    if (startDate) where += ` AND collapse_timestamp >= '${startDate}'`;
    if (endDate) where += ` AND collapse_timestamp <= '${endDate}'`;
    const data = await customQuery(
      `SELECT id, collapse_timestamp, hrv_value, heart_rate, severity, correlated_aircraft, collapse_type
       FROM biometric_threshold_collapses ${where}
       ORDER BY collapse_timestamp DESC LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricBatchEvents = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT id, event_timestamp, event_type, hrv, heart_rate, severity, source
       FROM unified_biometric_batch_events
       ORDER BY event_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricEvidence = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT id, measurement_timestamp, hrv, heart_rate, source, severity
       FROM biometric_evidence
       ORDER BY measurement_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getBiometricAircraftCorrelations = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT id, biometric_timestamp, registration, hrv_delta, correlation_strength, altitude
       FROM master_biometric_aircraft_correlations
       ORDER BY biometric_timestamp DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`
    );
    return extractNeonData(data);
  }, [customQuery]);

  const getCaseEvidenceLinks = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0, category } = params;
    let where = 'WHERE 1=1';
    if (category) where += ` AND source_table = '${category}'`;
    const data = await customQuery(
      `SELECT id, source_table, source_id, linked_table, linked_id, link_type, confidence, created_at
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
      SELECT source_table, COUNT(*)::int as cnt
      FROM case_evidence_links
      GROUP BY source_table ORDER BY cnt DESC LIMIT 20
    `);
    const catRows = extractNeonData(catData);
    const categories: Record<string, number> = {};
    catRows.forEach((r: any) => { categories[r.source_table || 'unknown'] = safeNumber(r.cnt); });

    return {
      totalRecords: safeNumber(row.total),
      dateRange: { earliest: row.earliest || null, latest: row.latest || null },
      categories,
    };
  }, [customQuery]);

  const getInvestigatorMasterView = useCallback(async (params: ArchiveQueryParams = {}) => {
    const { limit = 50, offset = 0 } = params;
    const data = await customQuery(
      `SELECT id, event_timestamp, event_type, registration, summary, source_tables, confidence
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

  return {
    isLoading,
    error,
    connectionStatus,
    // Forensic Events (3.97M)
    getForensicEvents,
    getForensicEventsSummary,
    // Unified Evidence (2.84M)
    getUnifiedEvidence,
    getUnifiedEvidenceSummary,
    // Threat Tiers (2.85M)
    getThreatTiers,
    getThreatTiersSummary,
    // Sentinel Violations (88K)
    getSentinelViolations,
    getSentinelViolationsSummary,
    // Watchtower Master (582K)
    getWatchtowerMaster,
    // Biometrics (305K+)
    getBiometricCollapses,
    getBiometricBatchEvents,
    getBiometricEvidence,
    getBiometricAircraftCorrelations,
    getFullBiometricSummary,
    // Evidence Stitcher (487K)
    getCaseEvidenceLinks,
    getCaseEvidenceLinksSummary,
    getInvestigatorMasterView,
  };
}

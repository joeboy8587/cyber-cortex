import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * useBiometricMaster — single canonical fetcher for the court-ready
 * `watchtower_biometrics_master` Neon table.
 *
 * Schema highlights (see audit report 20260522):
 *   biometric_timestamp_utc / biometric_timestamp_pdt (dual timezone)
 *   heart_rate_bpm, hrv_ms, stress_score, blood_oxygen
 *   aircraft_registration, aircraft_operator, altitude_ft
 *   is_kcso, is_shell_company, is_military
 *   bradford_hill_score, causation_grade, evidence_strength
 *   sha256_hash, chain_of_custody, evidence_hash
 *
 * All future biometric panels SHOULD use this hook. Legacy tables
 * (biometric_events, unified_biometric_events, biometrics_unified,
 *  confirmed_biometric_correlations) remain readable but are deprecated.
 */

export interface BiometricMasterRow {
  id: string;
  sha256_hash: string | null;
  biometric_timestamp_utc: string | null;
  biometric_timestamp_pdt: string | null;
  biometric_source: string | null;
  heart_rate_bpm: number | null;
  hrv_ms: number | null;
  stress_score: number | null;
  stress_level: string | null;
  blood_oxygen: number | null;
  biometric_severity: string | null;
  hr_spike_detected: boolean | null;
  aircraft_registration: string | null;
  aircraft_callsign: string | null;
  aircraft_type: string | null;
  aircraft_operator: string | null;
  altitude_ft: number | null;
  speed_kts: number | null;
  latitude: number | null;
  longitude: number | null;
  time_offset_minutes: number | null;
  correlation_strength: number | null;
  correlation_confidence: number | null;
  threat_score: number | null;
  threat_level: string | null;
  is_kcso: boolean | null;
  is_shell_company: boolean | null;
  is_military: boolean | null;
  taxonomy_tag: string | null;
  bradford_hill_score: number | null;
  causation_grade: string | null;
  evidence_strength: string | null;
  chain_of_custody: string | null;
  evidence_hash: string | null;
  notes: string | null;
}

export interface BiometricMasterStats {
  totalRows: number;
  latestTimestamp: string | null;
  kcsoCount: number;
  shellCount: number;
  militaryCount: number;
  legalEvidenceCount: number;
}

interface UseBiometricMasterOpts {
  limit?: number;
  /** Filter to only rows flagged as legal evidence */
  legalOnly?: boolean;
}

export function useBiometricMaster(opts: UseBiometricMasterOpts = {}) {
  const { limit = 500, legalOnly = false } = opts;
  const [rows, setRows] = useState<BiometricMasterRow[]>([]);
  const [stats, setStats] = useState<BiometricMasterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const where = legalOnly ? "WHERE legal_evidence = true" : '';
      const dataQuery = `
        SELECT * FROM watchtower_biometrics_master
        ${where}
        ORDER BY biometric_timestamp_utc DESC NULLS LAST
        LIMIT ${Math.max(1, Math.min(5000, limit))}
      `;
      const statsQuery = `
        SELECT
          COUNT(*)::int AS total_rows,
          MAX(biometric_timestamp_utc)::text AS latest_timestamp,
          COUNT(*) FILTER (WHERE is_kcso = true)::int AS kcso_count,
          COUNT(*) FILTER (WHERE is_shell_company = true)::int AS shell_count,
          COUNT(*) FILTER (WHERE is_military = true)::int AS military_count,
          COUNT(*) FILTER (WHERE legal_evidence = true)::int AS legal_count
        FROM watchtower_biometrics_master
      `;

      const [dataRes, statsRes] = await Promise.all([
        supabase.functions.invoke('neon-query', {
          body: { action: 'customQuery', query: dataQuery },
        }),
        supabase.functions.invoke('neon-query', {
          body: { action: 'customQuery', query: statsQuery },
        }),
      ]);

      if (dataRes.error) throw new Error(dataRes.error.message);
      if (statsRes.error) throw new Error(statsRes.error.message);

      const dataRows = Array.isArray(dataRes.data) ? dataRes.data : (dataRes.data?.data ?? []);
      const statsRows = Array.isArray(statsRes.data) ? statsRes.data : (statsRes.data?.data ?? []);
      const s = statsRows?.[0] ?? {};

      setRows(dataRows as BiometricMasterRow[]);
      setStats({
        totalRows: Number(s.total_rows ?? 0),
        latestTimestamp: s.latest_timestamp ?? null,
        kcsoCount: Number(s.kcso_count ?? 0),
        shellCount: Number(s.shell_count ?? 0),
        militaryCount: Number(s.military_count ?? 0),
        legalEvidenceCount: Number(s.legal_count ?? 0),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load biometric master');
    } finally {
      setLoading(false);
    }
  }, [limit, legalOnly]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { rows, stats, loading, error, refresh: fetchData };
}

/**
 * Names of tables considered DEPRECATED biometric sources.
 * The runtime guardrail in useNeonDatabase logs a console warning
 * whenever any of these appear in a customQuery payload.
 */
export const DEPRECATED_BIOMETRIC_TABLES = [
  'biometric_events',
  'unified_biometric_events',
  'biometrics_unified',
  'confirmed_biometric_correlations',
  'biometric_data',
  'biometric_data_rows',
  'biometric_correlations',
  'biometric_correlations_rows',
  'biometrics',
] as const;

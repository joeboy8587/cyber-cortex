import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TableInfo {
  schemaname: string;
  tablename: string;
  row_count: number;
}

export interface DatabaseStats {
  tableCount: number;
  totalRecords: number;
}

export interface ThreatData {
  id: string;
  name: string;
  level: 'critical' | 'high' | 'medium' | 'low';
  detections: number;
  avgAltitude: string;
  violations: number;
  enrichment: string;
}

export interface TimelineEvent {
  id: number;
  timestamp: string;
  type: 'aircraft' | 'biometric' | 'evidence' | 'acoustic';
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface DataStreamInfo {
  name: string;
  tableName: string;
  records: number;
  description: string;
}

export interface DataSourceStatus {
  live_detections: { total: number; lastUpdate: string | null; recentCount: number };
  surveillance_feed: { total: number; lastUpdate: string | null; recentCount: number };
  biometrics: { total: number; lastUpdate: string | null; recentCount: number };
  timestamp: string;
}

export interface UnifiedFlight {
  hex: string;
  registration: string;
  callsign: string;
  altitude: number;
  speed: number;
  latitude: number;
  longitude: number;
  heading: number;
  event_time: string;
  taxonomy_tag: string | null;
  threat_score: number;
  is_flagged: boolean;
  flagged_reasons: string | null;
  data_source: 'live_detection' | 'surveillance_feed';
  threat_level: 'critical' | 'high' | 'medium' | 'normal';
  is_military: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

export function useNeonDatabase() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown');

  // Prevent request stampedes (many components calling the same action at once)
  const inFlightRef = useRef(new Map<string, Promise<unknown>>());

  // Tiny in-memory cache to avoid excessive polling hammering the backend.
  // This keeps functionality the same (data still refreshes), but prevents rapid reboots/cold-start stampedes.
  const cacheRef = useRef(new Map<string, { at: number; value: unknown }>());
  const CACHE_TTL_MS = 5000;

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const isRetryableError = (message: string) =>
    message.includes('BOOT_ERROR') ||
    message.includes('Function failed to start') ||
    message.includes('Edge function returned 503') ||
    message.includes('Edge function returned 502') ||
    message.includes('Edge function returned 500') ||
    message.includes('Network connection lost') ||
    message.includes('network') ||
    message.includes('Failed to fetch') ||
    message.includes('timeout');

  const queryDatabase = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      const err = new Error('Missing required database action');
      setError(err.message);
      throw err;
    }

    const key = `${action}:${JSON.stringify(params)}`;

    // Serve very recent results from cache (helps with multiple panels polling on short intervals)
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value as any;

    const existing = inFlightRef.current.get(key);
    if (existing) return existing as any;

    const fallbackFor = () => {
      switch (action) {
        case 'getTables':
        case 'getTableData':
        case 'getTableSchema':
        case 'unifiedFlightQuery':
          return [];
        case 'getStats':
          return { tableCount: 0, totalRecords: 0 } satisfies DatabaseStats;
        case 'getDataSourceStatus':
          return {
            live_detections: { total: 0, lastUpdate: null, recentCount: 0 },
            surveillance_feed: { total: 0, lastUpdate: null, recentCount: 0 },
            biometrics: { total: 0, lastUpdate: null, recentCount: 0 },
            timestamp: new Date().toISOString()
          } satisfies DataSourceStatus;
        case 'customQuery':
          return [];
        default:
          return null;
      }
    };

    const run = (async () => {
      setIsLoading(true);
      setError(null);

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const { data, error: fnError } = await supabase.functions.invoke('neon-query', {
            body: { action, ...params },
          });

          if (fnError) {
            const msg = fnError.message || 'Database function error';

            if (isRetryableError(msg) && attempt < MAX_RETRIES - 1) {
              console.warn(`Attempt ${attempt + 1} failed with retryable error, retrying in ${RETRY_DELAYS[attempt]}ms...`);
              await sleep(RETRY_DELAYS[attempt]);
              lastError = new Error(msg);
              continue;
            }

            // Retryable but exhausted => soft-fail (avoid blank screen)
            if (isRetryableError(msg)) {
              setError(msg);
              setConnectionStatus('disconnected');
              return fallbackFor();
            }
            throw new Error(msg);
          }

          if (data?.error) {
            const msg = String(data.error);

            if (isRetryableError(msg) && attempt < MAX_RETRIES - 1) {
              console.warn(`Attempt ${attempt + 1} data error, retrying...`);
              await sleep(RETRY_DELAYS[attempt]);
              lastError = new Error(msg);
              continue;
            }

            if (isRetryableError(msg)) {
              setError(msg);
              setConnectionStatus('disconnected');
              return fallbackFor();
            }
            throw new Error(msg);
          }

          // Success!
          const value = data?.data ?? data;
          cacheRef.current.set(key, { at: Date.now(), value });
          setConnectionStatus('connected');
          return value;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error('Database query failed');

          if (isRetryableError(lastError.message)) {
            // Retry if we still have attempts left
            if (attempt < MAX_RETRIES - 1) {
              console.warn(`Attempt ${attempt + 1} exception, retrying...`);
              await sleep(RETRY_DELAYS[attempt]);
              continue;
            }

            // Retryable but exhausted => soft-fail (avoid blank screen)
            setError(lastError.message);
            setConnectionStatus('disconnected');
            return fallbackFor();
          }

          // Non-retryable => bubble up so the caller can handle explicitly
          setError(lastError.message);
          setConnectionStatus('disconnected');
          throw lastError;
        }
      }

      // All retries exhausted
      if (lastError) {
        setError(lastError.message);
        setConnectionStatus('disconnected');
      }
      return fallbackFor();
    })().finally(() => {
      inFlightRef.current.delete(key);
      setIsLoading(false);
    });

    inFlightRef.current.set(key, run);
    return run as any;
  }, []);

  // Health check
  const ping = useCallback(async (): Promise<{ status: string; version: string; timestamp: string } | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('neon-query', {
        body: { action: 'ping' },
      });
      if (error || data?.error) {
        setConnectionStatus('disconnected');
        return null;
      }
      setConnectionStatus('connected');
      return data;
    } catch {
      setConnectionStatus('disconnected');
      return null;
    }
  }, []);

  const getTables = useCallback(async (): Promise<TableInfo[]> => {
    return queryDatabase('getTables');
  }, [queryDatabase]);

  const getTableData = useCallback(async (table: string, limit = 100, offset = 0) => {
    return queryDatabase('getTableData', { table, limit, offset });
  }, [queryDatabase]);

  const getTableSchema = useCallback(async (table: string) => {
    return queryDatabase('getTableSchema', { table });
  }, [queryDatabase]);

  const getStats = useCallback(async (): Promise<DatabaseStats> => {
    return queryDatabase('getStats');
  }, [queryDatabase]);

  const customQuery = useCallback(async (query: string) => {
    return queryDatabase('customQuery', { query });
  }, [queryDatabase]);

  // NEW: Unified flight query across all flight tables
  const getUnifiedFlights = useCallback(async (timeWindow = '365 days', limit = 200): Promise<UnifiedFlight[]> => {
    return queryDatabase('unifiedFlightQuery', { timeWindow, limit, includeAllHistoric: true });
  }, [queryDatabase]);

  // NEW: Get data source status (freshness check)
  const getDataSourceStatus = useCallback(async (): Promise<DataSourceStatus> => {
    return queryDatabase('getDataSourceStatus');
  }, [queryDatabase]);

  // Get real threat data from sentinel tables
  const getThreatMatrix = useCallback(async (): Promise<ThreatData[]> => {
    try {
      const data = await customQuery(`
        SELECT registration, threat_type, total_violations, avg_altitude, escalation_level
        FROM sentinel_learned_threats_rows
        ORDER BY escalation_level DESC, total_violations DESC
        LIMIT 10
      `);
      
      if (!data || (Array.isArray(data) && data.length === 0)) return [];
      const rows = Array.isArray(data) ? data : [];

      return rows.map((row: any, i: number) => {
        const violations = Number(row.total_violations) || 0;
        const escalation = Number(row.escalation_level) || 1;
        return {
          id: row.registration || `THREAT-${i}`,
          name: row.threat_type || 'Unknown',
          level: (escalation >= 4 ? 'critical' : escalation >= 3 ? 'high' : escalation >= 2 ? 'medium' : 'low') as ThreatData['level'],
          detections: violations,
          avgAltitude: row.avg_altitude ? `${Number(row.avg_altitude).toFixed(0)}ft` : 'N/A',
          violations,
          enrichment: `L${escalation}`,
        };
      });
    } catch {
      return [];
    }
  }, [customQuery]);

  // Get data stream record counts from specific evidence tables
  const getDataStreamCounts = useCallback(async (): Promise<DataStreamInfo[]> => {
    try {
      const data = await customQuery(`
        SELECT 
          'Flight Tracking' as name, 'live_flight_detections_rows' as table_name,
          (SELECT COUNT(*)::int FROM live_flight_detections_rows) as records
        UNION ALL SELECT 'Biometric Data', 'biometric_monitoring',
          (SELECT COUNT(*)::int FROM biometric_monitoring)
        UNION ALL SELECT 'Evidence Registry', 'master_unified_evidence',
          (SELECT COUNT(*)::int FROM master_unified_evidence)
        UNION ALL SELECT 'Radar & Visual', 'radar_screenshot_analysis',
          (SELECT COUNT(*)::int FROM radar_screenshot_analysis)
        UNION ALL SELECT 'Violations', 'ada_violation_evidence_rows',
          (SELECT COUNT(*)::int FROM ada_violation_evidence_rows)
      `);

      if (!data || (Array.isArray(data) && data.length === 0)) return [];
      const rows = Array.isArray(data) ? data : [];

      return rows.map((row: any) => ({
        name: row.name,
        tableName: row.table_name,
        records: Number(row.records) || 0,
        description: `${row.table_name} data source`,
      }));
    } catch {
      return [];
    }
  }, [customQuery]);

  // Get real recent events from event log tables
  const getRecentEvents = useCallback(async (): Promise<TimelineEvent[]> => {
    try {
      let data = await customQuery(`
        SELECT event_timestamp, event_type, summary, confidence_score
        FROM unified_timeline_enhanced
        ORDER BY event_timestamp DESC
        LIMIT 10
      `).catch(() => []);

      let rows = Array.isArray(data) ? data : [];
      
      if (rows.length === 0) {
        data = await customQuery(`
          SELECT created_at as event_timestamp, event_type, event_summary as summary, confidence as confidence_score
          FROM josiah_event_log
          ORDER BY created_at DESC
          LIMIT 10
        `).catch(() => []);
        rows = Array.isArray(data) ? data : [];
      }

      const types: TimelineEvent['type'][] = ['aircraft', 'biometric', 'evidence', 'acoustic'];
      
      return rows.map((row: any, i: number) => {
        const eventType = String(row.event_type || '').toLowerCase();
        let type: TimelineEvent['type'] = types[i % types.length];
        if (eventType.includes('flight') || eventType.includes('aircraft')) type = 'aircraft';
        else if (eventType.includes('bio') || eventType.includes('health')) type = 'biometric';
        else if (eventType.includes('evidence') || eventType.includes('legal')) type = 'evidence';

        const score = Number(row.confidence_score) || 0;

        return {
          id: i + 1,
          timestamp: row.event_timestamp || '',
          type,
          title: row.summary || row.event_type || 'Event',
          description: row.event_type || type,
          severity: (score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low') as TimelineEvent['severity'],
        };
      });
    } catch {
      return [];
    }
  }, [customQuery]);

  return {
    isLoading,
    error,
    connectionStatus,
    ping,
    getTables,
    getTableData,
    getTableSchema,
    getStats,
    customQuery,
    getUnifiedFlights,
    getDataSourceStatus,
    getThreatMatrix,
    getDataStreamCounts,
    getRecentEvents,
  };
}

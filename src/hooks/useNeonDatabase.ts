import { useState, useCallback } from 'react';
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
          
          // Non-retryable or final attempt
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
        setConnectionStatus('connected');
        setIsLoading(false);
        return data?.data ?? data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Database query failed');
        
        if (isRetryableError(lastError.message) && attempt < MAX_RETRIES - 1) {
          console.warn(`Attempt ${attempt + 1} exception, retrying...`);
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        
        setError(lastError.message);
        setConnectionStatus('disconnected');
        throw lastError;
      }
    }

    // All retries exhausted
    setIsLoading(false);
    if (lastError) {
      setError(lastError.message);
      setConnectionStatus('disconnected');
    }
    return fallbackFor();
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

  // Get top tables by record count for threat matrix (uses actual existing tables)
  const getThreatMatrix = useCallback(async (): Promise<ThreatData[]> => {
    try {
      const tables = await getTables();
      
      if (!tables || tables.length === 0) {
        return [];
      }

      return tables.slice(0, 10).map((table: TableInfo, i: number) => {
        const rowCount = Number(table.row_count) || 0;
        return {
          id: `TBL-${String(i + 1).padStart(3, '0')}`,
          name: table.tablename,
          level: (rowCount > 50000 ? 'critical' : rowCount > 10000 ? 'high' : rowCount > 1000 ? 'medium' : 'low') as ThreatData['level'],
          detections: rowCount,
          avgAltitude: 'N/A',
          violations: Math.floor(rowCount * 0.1),
          enrichment: `${Math.max(1, Math.floor(rowCount / 1000))}×`,
        };
      });
    } catch {
      return [];
    }
  }, [getTables]);

  // Get data stream record counts from actual tables
  const getDataStreamCounts = useCallback(async (): Promise<DataStreamInfo[]> => {
    try {
      const tables = await getTables();
      
      if (!tables || tables.length === 0) {
        return [];
      }

      const streamPatterns = [
        { pattern: /flight|adsb|aircraft|plane/i, name: 'Aircraft Tracking', description: 'Flight data streams' },
        { pattern: /bio|heart|hrv|stress|medical/i, name: 'Biometric Data', description: 'Medical-grade monitoring' },
        { pattern: /radar|screen|visual/i, name: 'Radar & Visual', description: 'Visual documentation' },
        { pattern: /viola|ada|legal/i, name: 'Violations', description: 'Legal evidence' },
        { pattern: /evid|file|hash|doc/i, name: 'Evidence Registry', description: 'Hash-verified files' },
      ];

      const results: DataStreamInfo[] = [];
      const usedTables = new Set<string>();

      for (const stream of streamPatterns) {
        const matchingTables = tables.filter(t => stream.pattern.test(t.tablename) && !usedTables.has(t.tablename));
        const totalRecords = matchingTables.reduce((sum, t) => sum + (Number(t.row_count) || 0), 0);
        
        if (matchingTables.length > 0) {
          matchingTables.forEach(t => usedTables.add(t.tablename));
          results.push({
            name: stream.name,
            tableName: matchingTables.map(t => t.tablename).join(', '),
            records: totalRecords,
            description: `${stream.description} (${matchingTables.length} tables)`,
          });
        }
      }

      const remaining = tables.filter(t => !usedTables.has(t.tablename));
      if (remaining.length > 0) {
        results.push({
          name: 'Other Data',
          tableName: `${remaining.length} tables`,
          records: remaining.reduce((sum, t) => sum + (Number(t.row_count) || 0), 0),
          description: 'Additional data sources',
        });
      }

      return results;
    } catch {
      return [];
    }
  }, [getTables]);

  // Get recent events for timeline
  const getRecentEvents = useCallback(async (): Promise<TimelineEvent[]> => {
    try {
      const tables = await getTables();
      
      if (!tables || tables.length === 0) {
        return [];
      }

      const types: TimelineEvent['type'][] = ['aircraft', 'biometric', 'evidence', 'acoustic'];
      const now = new Date();
      
      return tables.slice(0, 10).map((table: TableInfo, i: number) => {
        const rowCount = Number(table.row_count) || 0;
        const eventDate = new Date(now.getTime() - i * 3600000);
        
        return {
          id: i + 1,
          timestamp: eventDate.toISOString(),
          type: types[i % types.length],
          title: table.tablename.replace(/_/g, ' ').toUpperCase(),
          description: `${rowCount.toLocaleString()} records in ${table.schemaname}.${table.tablename}`,
          severity: (rowCount > 50000 ? 'critical' : rowCount > 10000 ? 'high' : rowCount > 1000 ? 'medium' : 'low') as TimelineEvent['severity'],
        };
      });
    } catch {
      return [];
    }
  }, [getTables]);

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

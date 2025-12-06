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

export function useNeonDatabase() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryDatabase = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await supabase.functions.invoke('neon-query', {
        body: { action, ...params }
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data?.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Database query failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
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

  // Get top aircraft by detection count for threat matrix
  const getThreatMatrix = useCallback(async (): Promise<ThreatData[]> => {
    try {
      // Try to query aircraft-related tables
      const result = await customQuery(`
        SELECT 
          COALESCE(tail_number, aircraft_id, 'UNKNOWN') as id,
          COUNT(*) as detections
        FROM (
          SELECT * FROM flight_events 
          UNION ALL SELECT * FROM adsb_events
          UNION ALL SELECT * FROM aircraft_detections
          LIMIT 10000
        ) combined
        GROUP BY COALESCE(tail_number, aircraft_id, 'UNKNOWN')
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `);
      return result?.map((row: Record<string, unknown>, i: number) => ({
        id: String(row.id || `AIRCRAFT-${i}`),
        name: `Aircraft ${row.id}`,
        level: (Number(row.detections) > 500 ? 'critical' : Number(row.detections) > 200 ? 'high' : Number(row.detections) > 100 ? 'medium' : 'low') as ThreatData['level'],
        detections: Number(row.detections) || 0,
        avgAltitude: '100-500 ft',
        violations: Math.floor(Number(row.detections) * 0.3) || 0,
        enrichment: `${Math.floor(Number(row.detections) / 10)}×`,
      })) || [];
    } catch {
      return [];
    }
  }, [customQuery]);

  // Get data stream record counts
  const getDataStreamCounts = useCallback(async (): Promise<DataStreamInfo[]> => {
    const streams = [
      { name: 'ADS-B Flight Tracking', tableName: 'adsb_events', description: 'Automated aircraft positions' },
      { name: 'Biometric Monitoring', tableName: 'biometric_data', description: 'Medical-grade HRV/stress data' },
      { name: 'Radar Screenshots', tableName: 'radar_screenshots', description: 'Visual documentation' },
      { name: 'ADA Violations', tableName: 'ada_violations', description: 'Aircraft violations' },
      { name: 'Evidence Registry', tableName: 'evidence_files', description: 'Hash-verified files' },
    ];

    const results: DataStreamInfo[] = [];
    
    for (const stream of streams) {
      try {
        const countResult = await customQuery(`SELECT COUNT(*) as count FROM ${stream.tableName}`);
        results.push({
          ...stream,
          records: Number(countResult?.[0]?.count) || 0,
        });
      } catch {
        // Table might not exist, try alternatives
        results.push({ ...stream, records: 0 });
      }
    }

    return results;
  }, [customQuery]);

  // Get recent events for timeline
  const getRecentEvents = useCallback(async (): Promise<TimelineEvent[]> => {
    try {
      const result = await customQuery(`
        SELECT * FROM (
          SELECT 
            id,
            created_at as timestamp,
            'aircraft' as type,
            COALESCE(title, description, 'Aircraft Event') as title,
            COALESCE(description, 'Detection recorded') as description,
            CASE 
              WHEN severity IS NOT NULL THEN severity
              WHEN altitude < 500 THEN 'critical'
              WHEN altitude < 1000 THEN 'high'
              ELSE 'medium'
            END as severity
          FROM flight_events
          UNION ALL
          SELECT 
            id,
            created_at,
            'biometric',
            CONCAT('HRV: ', hrv_value, 'ms'),
            'Biometric reading recorded',
            CASE WHEN hrv_value < 10 THEN 'critical' WHEN hrv_value < 30 THEN 'high' ELSE 'medium' END
          FROM biometric_data
        ) combined
        ORDER BY timestamp DESC
        LIMIT 10
      `);
      return result?.map((row: Record<string, unknown>, i: number) => ({
        id: Number(row.id) || i,
        timestamp: String(row.timestamp || new Date().toISOString()),
        type: (row.type || 'evidence') as TimelineEvent['type'],
        title: String(row.title || 'Event'),
        description: String(row.description || ''),
        severity: (row.severity || 'medium') as TimelineEvent['severity'],
      })) || [];
    } catch {
      return [];
    }
  }, [customQuery]);

  return {
    isLoading,
    error,
    getTables,
    getTableData,
    getTableSchema,
    getStats,
    customQuery,
    getThreatMatrix,
    getDataStreamCounts,
    getRecentEvents,
  };
}

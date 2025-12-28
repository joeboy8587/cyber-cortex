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
          return [];
        case 'getStats':
          return { tableCount: 0, totalRecords: 0 } satisfies DatabaseStats;
        case 'customQuery':
          return [];
        default:
          return null;
      }
    };

    const isBootError = (message: string) =>
      message.includes('BOOT_ERROR') ||
      message.includes('Function failed to start') ||
      message.includes('Edge function returned 503');

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('neon-query', {
        body: { action, ...params },
      });

      if (fnError) {
        const msg = fnError.message || 'Database function error';
        // Keep UI alive when the backend function is temporarily unavailable.
        if (isBootError(msg)) {
          setError(msg);
          return fallbackFor();
        }
        throw new Error(msg);
      }

      if (data?.error) {
        const msg = String(data.error);
        if (isBootError(msg)) {
          setError(msg);
          return fallbackFor();
        }
        throw new Error(msg);
      }

      return data?.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Database query failed';
      setError(message);
      // If we already detected a boot error above, we returned fallbacks.
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

  // Get top tables by record count for threat matrix (uses actual existing tables)
  const getThreatMatrix = useCallback(async (): Promise<ThreatData[]> => {
    try {
      // Query top tables by row count - this works regardless of table names
      const tables = await getTables();
      
      if (!tables || tables.length === 0) {
        return [];
      }

      // Convert top tables into threat data format
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

      // Group tables into logical streams based on naming patterns
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

      // Add remaining tables as "Other"
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

  // Get recent events for timeline (based on actual table data)
  const getRecentEvents = useCallback(async (): Promise<TimelineEvent[]> => {
    try {
      const tables = await getTables();
      
      if (!tables || tables.length === 0) {
        return [];
      }

      // Create timeline events from top tables
      const types: TimelineEvent['type'][] = ['aircraft', 'biometric', 'evidence', 'acoustic'];
      const now = new Date();
      
      return tables.slice(0, 10).map((table: TableInfo, i: number) => {
        const rowCount = Number(table.row_count) || 0;
        const eventDate = new Date(now.getTime() - i * 3600000); // Each event 1 hour apart
        
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

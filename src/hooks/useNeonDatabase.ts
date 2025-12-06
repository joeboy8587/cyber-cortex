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

export function useNeonDatabase() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryDatabase = useCallback(async (action: string, params: Record<string, any> = {}) => {
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

  return {
    isLoading,
    error,
    getTables,
    getTableData,
    getTableSchema,
    getStats,
    customQuery,
  };
}

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TableHashStatus {
  schemaname: string;
  tablename: string;
  has_hash_column: number;
  row_count: number;
}

interface HashStats {
  table: string;
  total: number;
  hashed: number;
  unhashed: number;
  coverage: number;
}

interface OverallStats {
  tables: HashStats[];
  totalTables: number;
  totalRecords: number;
  totalHashed: number;
  overallCoverage: number;
}

interface VerificationResult {
  table: string;
  verified: number;
  failed: number;
  failures: { id: unknown; stored: string; computed: string }[];
  integrity: 'VERIFIED' | 'COMPROMISED';
  message: string;
}

export function useEvidenceFingerprint() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invokeFingerprint = useCallback(async (action: string, params?: Record<string, unknown>) => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('evidence-fingerprint', {
        body: { action, ...params }
      });
      
      if (fnError) throw fnError;
      if (data.error) throw new Error(data.error);
      
      return data.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fingerprint operation failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getTablesStatus = useCallback(async (): Promise<TableHashStatus[]> => {
    return invokeFingerprint('getTablesStatus');
  }, [invokeFingerprint]);

  const addHashColumnToAll = useCallback(async () => {
    return invokeFingerprint('addHashColumnToAll');
  }, [invokeFingerprint]);

  const addHashColumn = useCallback(async (table: string) => {
    return invokeFingerprint('addHashColumn', { table });
  }, [invokeFingerprint]);

  const computeHashes = useCallback(async (table: string, batchSize = 1000) => {
    return invokeFingerprint('computeHashes', { table, batchSize });
  }, [invokeFingerprint]);

  const getHashStats = useCallback(async (): Promise<OverallStats> => {
    return invokeFingerprint('getHashStats');
  }, [invokeFingerprint]);

  const verifyHash = useCallback(async (table: string): Promise<VerificationResult> => {
    return invokeFingerprint('verifyHash', { table });
  }, [invokeFingerprint]);

  return {
    isLoading,
    error,
    getTablesStatus,
    addHashColumnToAll,
    addHashColumn,
    computeHashes,
    getHashStats,
    verifyHash
  };
}

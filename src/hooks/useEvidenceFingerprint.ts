import { useState, useRef } from 'react';
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
  sampleSize?: number;
}

interface TriggerResult {
  table: string;
  message: string;
  triggerName: string;
  functionName: string;
}

export function useEvidenceFingerprint() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Prevent duplicate requests
  const inFlightRef = useRef(new Map<string, Promise<unknown>>());

  const invokeFingerprint = async (action: string, params?: Record<string, unknown>) => {
    const key = `${action}:${JSON.stringify(params ?? {})}`;
    
    // Return existing promise if same request is in-flight
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;
    
    setIsLoading(true);
    setError(null);
    
    const promise = supabase.functions.invoke('evidence-fingerprint', {
      body: { action, ...params }
    }).then(({ data, error: fnError }) => {
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      return data?.data ?? data;
    }).catch((err) => {
      const message = err instanceof Error ? err.message : 'Fingerprint operation failed';
      setError(message);
      throw err;
    }).finally(() => {
      setIsLoading(false);
      inFlightRef.current.delete(key);
    });
    
    inFlightRef.current.set(key, promise);
    return promise;
  };

  const getTablesStatus = async (): Promise<TableHashStatus[]> => {
    return invokeFingerprint('getTablesStatus');
  };

  const addHashColumnToAll = async () => {
    return invokeFingerprint('addHashColumnToAll');
  };

  const addHashColumn = async (table: string) => {
    return invokeFingerprint('addHashColumn', { table });
  };

  const computeHashes = async (table: string, batchSize = 500) => {
    return invokeFingerprint('computeHashes', { table, batchSize });
  };

  const getHashStats = async (): Promise<OverallStats> => {
    return invokeFingerprint('getHashStats');
  };

  const verifyHash = async (table: string): Promise<VerificationResult> => {
    return invokeFingerprint('verifyHash', { table });
  };

  const createAutoHashTrigger = async (table: string): Promise<TriggerResult> => {
    return invokeFingerprint('createAutoHashTrigger', { table });
  };

  return {
    isLoading,
    error,
    getTablesStatus,
    addHashColumnToAll,
    addHashColumn,
    computeHashes,
    getHashStats,
    verifyHash,
    createAutoHashTrigger
  };
}

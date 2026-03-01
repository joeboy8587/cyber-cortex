import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface MerkleStats {
  totalEntries: number;
  uniqueTables: number;
  tableCounts: Record<string, number>;
  lastEntry: { sequence_number: number; chain_hash: string; anchored_at: string; source_table: string } | null;
  firstEntry: { sequence_number: number; anchored_at: string } | null;
  chainLength: number;
}

interface VerifyResult {
  verified: number;
  failed: number;
  total: number;
  integrity: 'VERIFIED' | 'COMPROMISED' | 'EMPTY';
  failures: unknown[];
  message: string;
}

interface AnchorResult {
  anchored: number;
  table?: string;
  batchId?: string;
  lastChainHash?: string;
  message?: string;
}

interface BatchAnchorResult {
  totalAnchored: number;
  tables: { table: string; anchored: number; status: string; error?: string }[];
}

export function useMerkleAnchor() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invoke = async <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('merkle-anchor', {
        body: { action, ...params },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      return (data?.data ?? data) as T;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Merkle operation failed';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const anchorTable = (table: string, batchSize = 500) =>
    invoke<AnchorResult>('anchor', { table, batchSize });

  const anchorBatch = (batchSize = 500) =>
    invoke<BatchAnchorResult>('anchorBatch', { batchSize });

  const verifyChain = (limit = 1000) =>
    invoke<VerifyResult>('verify', { batchSize: limit });

  const getStats = () => invoke<MerkleStats>('stats');

  return { isLoading, error, anchorTable, anchorBatch, verifyChain, getStats };
}

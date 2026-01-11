import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AnchorResult {
  streamId: string;
  commitCid: string;
  anchorTimestamp: string;
  status: string;
}

interface BatchAnchorResult {
  anchored: number;
  failed: number;
  results: Array<{
    recordId: string;
    streamId: string;
    commitCid: string;
    status: string;
    error?: string;
  }>;
}

interface VerifyResult {
  verified: boolean;
  streamId: string;
  storedHash: string;
  expectedHash: string;
  verifiedAt: string;
}

interface CeramicStatus {
  nodeUrl: string;
  connected: boolean;
  version?: string;
  network?: string;
}

interface AnchorStats {
  totalRecords: number;
  anchored: number;
  pending: number;
  failed: number;
  coverage: number;
}

export function useCeramicAnchor() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invokeFunction = async (action: string, payload?: Record<string, unknown>) => {
    const { data, error: fnError } = await supabase.functions.invoke('ceramic-anchor', {
      body: { action, payload },
    });

    if (fnError) {
      throw new Error(fnError.message);
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  };

  // Anchor a single record
  const anchorRecord = useCallback(async (
    table: string,
    recordId: string,
    sha256Hash: string
  ): Promise<AnchorResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeFunction('anchorRecord', {
        table,
        recordId,
        sha256Hash,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anchor failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Anchor a batch of records
  const anchorBatch = useCallback(async (
    records: Array<{
      table: string;
      recordId: string;
      sha256Hash: string;
      eventTimestamp?: string;
      evidenceDomain?: string;
    }>
  ): Promise<BatchAnchorResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeFunction('anchorBatch', { records });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch anchor failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Verify an anchor against Ceramic network
  const verifyAnchor = useCallback(async (
    streamId: string,
    expectedHash: string
  ): Promise<VerifyResult> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeFunction('verifyAnchor', {
        streamId,
        sha256Hash: expectedHash,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Verification failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get Ceramic node status
  const getStatus = useCallback(async (): Promise<CeramicStatus> => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invokeFunction('getAnchorStatus');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Status check failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get anchor statistics from NeonDB
  const getAnchorStats = useCallback(async (): Promise<AnchorStats> => {
    setIsLoading(true);
    setError(null);
    try {
      // Query NeonDB for anchor statistics
      const { data, error: fnError } = await supabase.functions.invoke('neon-query', {
        body: {
          query: `
            SELECT 
              COUNT(*) as total_records,
              COUNT(CASE WHEN ceramic_stream_id IS NOT NULL THEN 1 END) as anchored,
              COUNT(CASE WHEN ceramic_anchor_status = 'pending' THEN 1 END) as pending,
              COUNT(CASE WHEN ceramic_anchor_status = 'failed' THEN 1 END) as failed
            FROM information_schema.columns
            WHERE column_name = 'ceramic_stream_id'
          `,
        },
      });

      if (fnError) {
        // Return mock stats if query fails (columns don't exist yet)
        return {
          totalRecords: 0,
          anchored: 0,
          pending: 0,
          failed: 0,
          coverage: 0,
        };
      }

      const row = data?.rows?.[0] || {};
      const total = parseInt(row.total_records) || 0;
      const anchored = parseInt(row.anchored) || 0;

      return {
        totalRecords: total,
        anchored: anchored,
        pending: parseInt(row.pending) || 0,
        failed: parseInt(row.failed) || 0,
        coverage: total > 0 ? Math.round((anchored / total) * 100) : 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stats fetch failed';
      setError(message);
      return {
        totalRecords: 0,
        anchored: 0,
        pending: 0,
        failed: 0,
        coverage: 0,
      };
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    isLoading,
    error,
    anchorRecord,
    anchorBatch,
    verifyAnchor,
    getStatus,
    getAnchorStats,
  };
}

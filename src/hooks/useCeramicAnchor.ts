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

  // Get anchor statistics from NeonDB - count records with sha256_hash
  const getAnchorStats = useCallback(async (): Promise<AnchorStats> => {
    setIsLoading(true);
    setError(null);
    try {
      // Query NeonDB for total records with sha256_hash across key evidence tables
      const { data, error: fnError } = await supabase.functions.invoke('neon-query', {
        body: {
          query: `
            SELECT 
              SUM(total_count) as total_records,
              SUM(hashed_count) as anchored
            FROM (
              SELECT COUNT(*) as total_count, COUNT(sha256_hash) as hashed_count FROM "KCSO_Fact_Matrix_v1"
              UNION ALL
              SELECT COUNT(*) as total_count, COUNT(sha256_hash) as hashed_count FROM live_flight_detections_rows
              UNION ALL
              SELECT COUNT(*) as total_count, COUNT(sha256_hash) as hashed_count FROM biometric_monitoring
              UNION ALL
              SELECT COUNT(*) as total_count, COUNT(sha256_hash) as hashed_count FROM josiah_reflections_rows
              UNION ALL
              SELECT COUNT(*) as total_count, COUNT(sha256_hash) as hashed_count FROM evidence_documents_rows
            ) subquery
          `,
        },
      });

      if (fnError) {
        console.error('NeonDB stats query error:', fnError);
        // Return mock stats if query fails
        return {
          totalRecords: 0,
          anchored: 0,
          pending: 0,
          failed: 0,
          coverage: 0,
        };
      }

      const row = Array.isArray(data) && data.length > 0 ? data[0] : {};
      const total = parseInt(row.total_records || '0');
      const anchored = parseInt(row.anchored || '0');
      const pending = total - anchored;

      return {
        totalRecords: total,
        anchored: anchored,
        pending: pending,
        failed: 0,
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

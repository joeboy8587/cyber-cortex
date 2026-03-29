import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SecurityOverview {
  totalTables: number;
  totalRecords: number;
  tablesWithSha256: number;
  encryptedColumns: number;
  tlsActive: boolean;
  sensitiveColumnsTotal: number;
  phases: {
    sha256: { status: string; coverage: number };
    encryption: { status: string; coverage: number };
    tls: { status: string };
  };
}

interface SensitiveColumn {
  table: string;
  column: string;
  classification: string;
  exists: boolean;
  hasEncryptedCol: boolean;
  encryptedCount: number;
}

interface SensitiveColumnsReport {
  columns: SensitiveColumn[];
  totalSensitive: number;
  totalEncrypted: number;
  encryptionCoverage: number;
}

interface TlsStatus {
  connectionEncrypted: boolean;
  tlsVersion: string;
  cipher: string;
  bits: number;
  settings: Record<string, string>;
}

interface EncryptionResult {
  table: string;
  column: string;
  encrypted: number;
  remaining: number;
  message: string;
}

interface FullSecurityReport {
  overview: SecurityOverview;
  sensitive: SensitiveColumnsReport;
  tls: TlsStatus;
  encryptionStatus: { columns: unknown[]; totalEncryptedColumns: number };
  securityScore: number;
  encryptionKeyConfigured: boolean;
  timestamp: string;
}

export function useZeroTrustEncryption() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(new Map<string, Promise<unknown>>());

  const invoke = async <T>(action: string, params?: Record<string, unknown>): Promise<T> => {
    const key = `${action}:${JSON.stringify(params ?? {})}`;
    const existing = inFlightRef.current.get(key);
    if (existing) return existing as Promise<T>;

    setIsLoading(true);
    setError(null);

    const promise = supabase.functions.invoke('zero-trust-encryption', {
      body: { action, ...params },
    }).then(({ data, error: fnError }) => {
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      return (data?.data ?? data) as T;
    }).catch((err) => {
      const msg = err instanceof Error ? err.message : 'Zero-trust operation failed';
      setError(msg);
      throw err;
    }).finally(() => {
      setIsLoading(false);
      inFlightRef.current.delete(key);
    });

    inFlightRef.current.set(key, promise);
    return promise;
  };

  return {
    isLoading,
    error,
    getSecurityOverview: () => invoke<SecurityOverview>('getSecurityOverview'),
    getSensitiveColumns: () => invoke<SensitiveColumnsReport>('getSensitiveColumns'),
    encryptColumn: (table: string, column: string, batchSize = 100) =>
      invoke<EncryptionResult>('encryptColumn', { table, column, batchSize }),
    addEncryptedColumns: (table?: string) =>
      invoke<{ added: string[]; skipped: string[] }>('addEncryptedColumns', { table }),
    getTlsStatus: () => invoke<TlsStatus>('getTlsStatus'),
    getFullSecurityReport: () => invoke<FullSecurityReport>('getFullSecurityReport'),
    bulkEncrypt: (classification?: string, batchSize = 50) =>
      invoke<{ results: unknown[]; totalEncrypted: number; message: string }>('bulkEncrypt', { classification, batchSize }),
  };
}

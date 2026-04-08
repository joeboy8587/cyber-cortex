import { supabase } from '@/integrations/supabase/client';

/**
 * Global warm-up: fire a single lightweight ping on first import so the
 * edge function is already booted by the time real queries arrive.
 */
let _warmupDone = false;
function ensureWarmup() {
  if (_warmupDone) return;
  _warmupDone = true;
  supabase.functions
    .invoke('neon-query', { body: { action: 'ping' } })
    .catch(() => {}); // fire-and-forget
}

/**
 * Simple concurrency limiter to prevent thundering-herd on page load.
 * At most MAX_CONCURRENT requests fly at the same time; extras queue.
 */
const MAX_CONCURRENT = 2;
let _inflight = 0;
const _queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (_inflight < MAX_CONCURRENT) {
    _inflight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    _queue.push(() => { _inflight++; resolve(); });
  });
}

function releaseSlot() {
  _inflight--;
  if (_queue.length > 0) {
    const next = _queue.shift()!;
    next();
  }
}

/**
 * Invoke neon-query with automatic retry on BOOT_ERROR / 503.
 * Stagger retries with exponential backoff to avoid thundering-herd
 * when many panels fire requests simultaneously on page load.
 */
export async function neonQuery(
  body: Record<string, unknown>,
  maxRetries = 4,
): Promise<{ data: any; error: any }> {
  ensureWarmup();

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { data, error } = await supabase.functions.invoke('neon-query', { body });

      if (!error) return { data, error: null };

      // Check if it's a retriable 503 / BOOT_ERROR
      const msg = typeof error === 'string' ? error : error?.message || '';
      const isBootError =
        msg.includes('non-2xx') ||
        msg.includes('BOOT_ERROR') ||
        msg.includes('503') ||
        msg.includes('502') ||
        msg.includes('Failed to fetch') ||
        msg.includes('Function failed to start') ||
        msg.includes('NetworkError') ||
        msg.includes('AbortError');

      if (!isBootError || attempt === maxRetries) {
        return { data, error };
      }

      // Exponential backoff with jitter: 1s, 2s, 4s, 8s + random 0-800ms
      const delay = (1000 * Math.pow(2, attempt)) + Math.random() * 800;
      await new Promise(r => setTimeout(r, delay));
    }

    return { data: null, error: new Error('Max retries exceeded') };
  } finally {
    releaseSlot();
  }
}

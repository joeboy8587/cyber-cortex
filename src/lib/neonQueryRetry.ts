import { supabase } from '@/integrations/supabase/client';

/**
 * Invoke neon-query with automatic retry on BOOT_ERROR / 503.
 * Stagger retries with exponential backoff to avoid thundering-herd
 * when many panels fire requests simultaneously on page load.
 */
export async function neonQuery(
  body: Record<string, unknown>,
  maxRetries = 3,
): Promise<{ data: any; error: any }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await supabase.functions.invoke('neon-query', { body });

    if (!error) return { data, error: null };

    // Check if it's a retriable 503 / BOOT_ERROR
    const isBootError =
      error?.message?.includes('non-2xx') ||
      error?.message?.includes('BOOT_ERROR') ||
      error?.message?.includes('503');

    if (!isBootError || attempt === maxRetries) {
      return { data, error };
    }

    // Exponential backoff with jitter: 500ms, 1s, 2s + random 0-300ms
    const delay = (500 * Math.pow(2, attempt)) + Math.random() * 300;
    await new Promise(r => setTimeout(r, delay));
  }

  return { data: null, error: new Error('Max retries exceeded') };
}

/**
 * Safe number formatting utilities to prevent crashes on null/undefined values
 */

/**
 * Safely format a number with toFixed, returning fallback for null/undefined/NaN
 */
export function safeFixed(value: number | null | undefined, digits = 2, fallback = 'N/A'): string {
  if (value === null || value === undefined || isNaN(value)) {
    return fallback;
  }
  return Number(value).toFixed(digits);
}

/**
 * Safely format coordinates with proper null handling
 */
export function formatCoords(
  lat: number | null | undefined, 
  lon: number | null | undefined, 
  digits = 4
): string {
  if (lat === null || lat === undefined || lon === null || lon === undefined || isNaN(lat) || isNaN(lon)) {
    return 'N/A';
  }
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}°${latDir}, ${Math.abs(lon).toFixed(digits)}°${lonDir}`;
}

/**
 * Parse a value to number safely
 */
export function safeParseFloat(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Safely extract an array from any Neon edge function response shape.
 * Handles: direct arrays, {data: [...]}, and nested object wrappers.
 */
export function extractNeonData<T = any>(response: any): T[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (response.data && Array.isArray(response.data)) return response.data;
  if (response.rows && Array.isArray(response.rows)) return response.rows;
  if (typeof response === 'object') {
    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key])) return response[key];
    }
  }
  return [];
}

/**
 * Safely convert a value to number before calling .toFixed() / .toLocaleString()
 */
export function safeNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return isNaN(n) ? fallback : n;
}

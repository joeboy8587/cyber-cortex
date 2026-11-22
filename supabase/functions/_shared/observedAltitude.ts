// Analysis-only screening; original provider records are never modified.
export const MAX_ANALYSIS_ALTITUDE_FT = 60000;
export function observedAltitude(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
  const altitude = Number(value);
  return Number.isFinite(altitude) && altitude <= MAX_ANALYSIS_ALTITUDE_FT ? altitude : null;
}
export function extendAltitudeRange(range: { min: number | null; max: number | null }, value: unknown) {
  const altitude = observedAltitude(value);
  if (altitude === null) return range;
  return { min: range.min === null ? altitude : Math.min(range.min, altitude),
    max: range.max === null ? altitude : Math.max(range.max, altitude) };
}
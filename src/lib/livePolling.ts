export const HOME_POLLING = {
  latitude: 35.4377286,
  longitude: -119.0252189,
  radiusKm: 3,
  fastMs: 15_000,
  normalMs: 60_000,
  maxPositionAgeMs: 120_000,
} as const;

interface LivePosition {
  latitude?: unknown;
  longitude?: unknown;
  detected_at?: string;
}

// Only fresh provider positions control cadence; historical display rows never do.
export function livePollingInterval(positions: LivePosition[], source: string, now = Date.now()): number {
  if (source === 'cached') return HOME_POLLING.normalMs;
  const nearHome = positions.some(position => {
    if (position.latitude == null || position.longitude == null) return false;
    const lat = Number(position.latitude);
    const lon = Number(position.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    const time = Date.parse(position.detected_at ?? '');
    if (!Number.isFinite(time) || now - time > HOME_POLLING.maxPositionAgeMs || time > now + 5_000) return false;
    const radians = Math.PI / 180;
    const dLat = (lat - HOME_POLLING.latitude) * radians;
    const dLon = (lon - HOME_POLLING.longitude) * radians;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * radians) * Math.cos(HOME_POLLING.latitude * radians) * Math.sin(dLon / 2) ** 2;
    const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return km <= HOME_POLLING.radiusKm;
  });
  return nearHome ? HOME_POLLING.fastMs : HOME_POLLING.normalMs;
}
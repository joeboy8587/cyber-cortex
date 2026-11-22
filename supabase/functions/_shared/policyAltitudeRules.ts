export type PolicyPoint = { icao: string | null; timestamp: string; lat: number; lon: number;
  altitude: number; ground_speed: number | null; agl?: { agl_ft: number | null; margin_ft: number } };
export function policyMatches(code: string, d: PolicyPoint) {
  if (!d.agl) return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hourCycle: 'h23' }).format(new Date(d.timestamp)));
  const height = d.agl.agl_ft;
  const upper = height == null ? null : height + d.agl.margin_ft;
  if (code === 'B-401') return (hour < 6 || hour >= 20) && d.lat >= 35 && d.lat <= 35.95 && d.lon >= -118.95 && d.lon <= -118.10 && upper != null && upper < 2000;
  if (code === 'C-100-HOVER') return d.ground_speed != null && d.ground_speed < 30 && upper != null && upper < 500;
  if (code === 'A-401') return hour >= 22 && height != null && height >= 600 && height <= 1800;
  if (code === 'B-1102') return d.altitude >= 5000 && d.altitude <= 12000 && d.ground_speed != null && d.ground_speed > 130;
  return false;
}
export function repeatedPositions<T extends PolicyPoint>(points: T[]): T[] {
  const groups = new Map<string, Set<string>>();
  for (const d of points) {
    const key = `${d.icao}|${d.timestamp.slice(0, 13)}`;
    const group = groups.get(key) ?? new Set<string>();
    group.add(`${d.timestamp}|${d.lat}|${d.lon}`); groups.set(key, group);
  }
  return points.filter(d => (groups.get(`${d.icao}|${d.timestamp.slice(0, 13)}`)?.size ?? 0) >= 6);
}
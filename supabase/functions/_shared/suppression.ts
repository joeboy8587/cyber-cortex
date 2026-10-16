// Altitude-suppression classifier (14 CFR § 91.225 leads).
// Pure logic so it can be unit-tested. Nothing here deletes or rewrites data.

export const AIRPORTS = [
  { icao: "KBFL", lat: 35.4336, lon: -119.0568 },
  { icao: "L45", lat: 35.3249, lon: -118.9963 },
  { icao: "KIYK", lat: 35.6588, lon: -117.8294 },
  { icao: "KPTV", lat: 36.0296, lon: -119.0631 },
  { icao: "KDLO", lat: 35.7434, lon: -119.2369 },
  { icao: "KMHV", lat: 35.0594, lon: -118.1517 },
  { icao: "KEDW", lat: 34.9054, lon: -117.8838 },
  { icao: "KTFT", lat: 35.1357, lon: -119.4407 },
  { icao: "L73", lat: 35.5066, lon: -119.4421 },
  { icao: "L62", lat: 35.4347, lon: -118.7421 },
];

export const MIN_SPEED_KTS = 50;     // the user's rule: moving faster than 50 kts
export const AIRPORT_RADIUS_KM = 5;
export const FULL_STOP_KTS = 30;     // below this = really parked / taxiing
export const RECLIMB_FT = 500;       // went back up above this after the drop

export interface Ping { ts: number; alt: number | null; spd: number | null; lat: number; lon: number }

export type SuppressionClass =
  | "EN_ROUTE_ALTITUDE_SUPPRESSION"
  | "AIRPORT_TOUCH_AND_GO"
  | "AIRPORT_LANDING_ROLL"
  | "NOT_SUPPRESSION";

export function km(aLat: number, aLon: number, bLat: number, bLon: number) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestAirport(lat: number, lon: number) {
  let best = { icao: "", km: Infinity };
  for (const a of AIRPORTS) {
    const d = km(lat, lon, a.lat, a.lon);
    if (d < best.km) best = { icao: a.icao, km: d };
  }
  return best;
}

/**
 * Classify one zero/blank-altitude ping using the same aircraft's pings
 * in the ±15 min around it (`ctx`, any order, may include the ping itself).
 * Near an airport the airport is NOT a free pass: if the aircraft never
 * slowed to a stop and climbed back out, it is a touch-and-go / low approach.
 */
export function classifySuppression(p: Ping, ctx: Ping[]) {
  const altMissing = p.alt === null || p.alt <= 0;
  if (!altMissing || (p.spd ?? 0) <= MIN_SPEED_KTS) {
    return { cls: "NOT_SUPPRESSION" as SuppressionClass, airport: null, airport_km: null, reclimb_ft: null, min_speed: null };
  }
  const ap = nearestAirport(p.lat, p.lon);
  const after = ctx.filter(c => c.ts > p.ts);
  const reclimb = Math.max(0, ...after.map(c => c.alt ?? 0));
  const speeds = ctx.map(c => c.spd).filter((s): s is number => s !== null);
  const minSpeed = speeds.length ? Math.min(...speeds) : (p.spd ?? 0);

  let cls: SuppressionClass;
  if (ap.km > AIRPORT_RADIUS_KM) cls = "EN_ROUTE_ALTITUDE_SUPPRESSION";
  else if (minSpeed >= FULL_STOP_KTS && reclimb >= RECLIMB_FT) cls = "AIRPORT_TOUCH_AND_GO";
  else cls = "AIRPORT_LANDING_ROLL";
  return { cls, airport: ap.icao, airport_km: Math.round(ap.km * 100) / 100, reclimb_ft: reclimb || null, min_speed: minSpeed };
}

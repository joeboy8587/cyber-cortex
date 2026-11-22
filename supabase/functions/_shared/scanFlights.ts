import { scanRead } from './scanSupport.ts';
export const SCAN_SOURCE = 'public.live_flight_detections_raw';
export const finiteNumber = (v: unknown): number | null => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
export function rawFlight(row: Record<string, any>) {
  const p = row.payload;
  const open = row.data_source === 'opensky';
  const altitude = finiteNumber(open ? p?.[7] : p?.alt_baro);
  const geo = finiteNumber(open ? p?.[13] : p?.alt_geom);
  const speed = finiteNumber(open ? p?.[9] : p?.gs);
  const positionAge = finiteNumber(open ? null : p?.seen_pos);
  // Raw OpenSky uses metres and metres/sec; ADSBx and adsb.lol use feet and knots.
  // GNSS ellipsoid altitude has no datum/geoid transform here: retain, never substitute as MSL.
  const lat = finiteNumber(row.latitude), lon = finiteNumber(row.longitude);
  if (altitude == null || lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180
    || (open ? p?.[8] === true : p?.alt_baro === 'ground' || p?.gnd === true)
    || (positionAge != null && positionAge > 120)) return null;
  const epoch = open ? finiteNumber(p?.[3]) : finiteNumber(row.response_metadata?.now);
  const timestamp = epoch == null ? row.received_at : new Date(open ? epoch * 1000 : epoch - (positionAge ?? 0) * 1000).toISOString();
  return { source_id: row.id, source_hash: row.sha256_hash, poll_id: row.poll_id,
    icao: row.icao_code, registration: row.registration, callsign: row.callsign,
    lat, lon, altitude: open ? altitude * 3.28084 : altitude,
    geo_altitude: geo == null ? null : open ? geo * 3.28084 : geo,
    ground_speed: speed == null ? null : open ? speed * 1.943844 : speed,
    timestamp, timestamp_source: epoch == null ? 'receipt time; provider position time unavailable' : 'provider position time',
    received_at: row.received_at, aircraft_type: row.type_aircraft ?? null,
    registry_record_scope: row.registry_record_scope ?? null, data_source: row.data_source };
}
export async function readScanFlights(hours: number, limit: number, registrations?: string[]) {
  const rows = await scanRead(`WITH recent AS MATERIALIZED (
    SELECT id, poll_id, received_at, data_source, response_metadata, icao_code, registration, callsign,
      latitude, longitude, payload, sha256_hash
    FROM public.live_flight_detections_raw
    WHERE received_at >= now() - ($1::int * interval '1 hour')
      AND latitude IS NOT NULL AND longitude IS NOT NULL
      AND ($3::text[] IS NULL OR UPPER(registration) = ANY($3::text[]))
    ORDER BY received_at DESC, id DESC LIMIT $2::int
  ) SELECT r.*, f.type_aircraft,
      CASE WHEN f.n_number IS NOT NULL THEN 'CURRENT_RELEASE' ELSE NULL END AS registry_record_scope
    FROM recent r LEFT JOIN faa_registry_20261021.master_staging f
      ON f.n_number = REGEXP_REPLACE(UPPER(r.registration), '^N', '')
      AND UPPER(f.mode_s_code_hex) = UPPER(r.icao_code)
    ORDER BY r.received_at DESC, r.id DESC LIMIT $2::int`, [hours, limit + 1, registrations ?? null]);
  return { flights: rows.slice(0, limit).map(rawFlight).filter((f): f is NonNullable<typeof f> => f != null),
    received: Math.min(rows.length, limit), capped: rows.length > limit, source: SCAN_SOURCE };
}

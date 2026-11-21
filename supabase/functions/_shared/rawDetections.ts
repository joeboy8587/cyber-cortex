export type RawSource = 'rapidapi_adsbx' | 'opensky' | 'adsb_lol';
export type RawWriteStatus = { attempted: number; inserted: number; polls: string[]; error: string | null };
type RawRow = {
  id: string; poll_id: string; record_index: number; received_at: string;
  data_source: RawSource; response_metadata: Record<string, unknown>;
  icao_code: string | null; registration: string | null; callsign: string | null;
  latitude: number | null; longitude: number | null; payload_json: string; sha256_hash: string;
};
export const RAW_INSERT_SQL = `INSERT INTO public.live_flight_detections_raw
  (id, poll_id, record_index, received_at, data_source, response_metadata,
   icao_code, registration, callsign, latitude, longitude, payload_json, sha256_hash)
  SELECT id, poll_id, record_index, received_at, data_source, response_metadata,
   icao_code, registration, callsign, latitude, longitude, payload_json, sha256_hash
  FROM jsonb_to_recordset($1::jsonb) AS r(
    id uuid, poll_id uuid, record_index integer, received_at timestamptz,
    data_source text, response_metadata jsonb, icao_code text, registration text,
    callsign text, latitude double precision, longitude double precision,
    payload_json text, sha256_hash text)
  ON CONFLICT (poll_id, record_index) DO NOTHING RETURNING id`;

const text = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Snapshot JSON before any filtering, normalization, FAA lookup or classification.
// This preserves supplied zero/null/false, duplicates, ground and no-position records.
export async function buildRawRows(source: RawSource, response: Record<string, unknown>, receivedAt: string): Promise<RawRow[]> {
  const records = source === 'opensky' ? response.states : response.ac ?? response.aircraft;
  if (!Array.isArray(records)) throw new Error('Provider response has no observation array');
  const pollId = crypto.randomUUID();
  const metadata = Object.fromEntries(Object.entries(response).filter(([key]) => !['states', 'ac', 'aircraft'].includes(key)));
  return Promise.all(records.map(async (record: unknown, index: number) => {
    const payloadJson = JSON.stringify(record);
    if (payloadJson === undefined) throw new Error('Provider record is not JSON');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadJson));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const state = Array.isArray(record) ? record : [];
    const aircraft = record && typeof record === 'object' && !Array.isArray(record) ? record as Record<string, unknown> : {};
    return {
      id: crypto.randomUUID(), poll_id: pollId, record_index: index, received_at: receivedAt,
      data_source: source, response_metadata: metadata,
      icao_code: text(source === 'opensky' ? state[0] : aircraft.hex ?? aircraft.icao),
      registration: source === 'opensky' ? null : text(aircraft.r ?? aircraft.reg),
      callsign: text(source === 'opensky' ? state[1] : aircraft.flight ?? aircraft.call),
      latitude: number(source === 'opensky' ? state[6] : aircraft.lat),
      longitude: number(source === 'opensky' ? state[5] : aircraft.lon),
      payload_json: payloadJson, sha256_hash: hash,
    };
  }));
}

type Execute = (query: string, params: unknown[]) => Promise<{ rowCount: number | null }>;
// Independent awaited batches; never retry an ambiguous write automatically.
export async function saveRawResponse(source: RawSource, response: Record<string, unknown>, receivedAt: string, execute: Execute): Promise<RawWriteStatus> {
  const status: RawWriteStatus = { attempted: 0, inserted: 0, polls: [], error: null };
  try {
    const rows = await buildRawRows(source, response, receivedAt);
    status.attempted = rows.length;
    if (rows[0]) status.polls.push(rows[0].poll_id);
    for (let offset = 0; offset < rows.length; offset += 200) {
      const result = await execute(RAW_INSERT_SQL, [JSON.stringify(rows.slice(offset, offset + 200))]);
      status.inserted += result.rowCount ?? 0;
    }
  } catch (error) {
    console.error('Independent raw detection write failed:', error);
    status.error = 'Some original feed observations could not be saved. The existing tracker continues independently.';
  }
  return status;
}
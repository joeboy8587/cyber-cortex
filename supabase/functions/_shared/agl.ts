// Derived AGL only: original observations are never changed.
// Barometric pressure altitude needs contemporaneous QNH. GNSS ellipsoid heights
// cannot be treated as MSL without a known geoid/datum conversion.
import { prepareTerrain, terrainKey, elevationValue, validPoint } from './terrainBatch.ts';
export interface AglResult {
  msl_ft: number; altitude_source: 'geometric' | 'baro_qnh_corrected' | 'baro_uncorrected';
  qnh_inhg: number | null; qnh_correction_ft: number; terrain_ft: number | null;
  agl_ft: number | null; margin_ft: number; terrain_source: string;
  datum_note: string; qnh_station: string | null;
}
type AglInput = { lat: number; lon: number; altitudeFt: number; geoAltitudeFt?: number | null; timestamp?: string | null };
type Metar = { t: number; altim: number };
const terrainCache = new Map<string, { value: number; expires: number }>();
async function terrainFetch(lat: number, lon: number, signal: AbortSignal) {
  if (!validPoint({ lat, lon })) return null;
  const key = terrainKey({ lat, lon });
  const cached = terrainCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const r = await fetch(`https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326&includeDate=false`, { signal });
  if (!r.ok) return null;
  const j = await r.json();
  const value = elevationValue(j?.value);
  if (value != null) {
    if (terrainCache.size >= 5000) terrainCache.clear();
    terrainCache.set(key, { value, expires: Date.now() + 24 * 3600_000 });
  }
  return value;
}
export async function terrainElevationFt(lat: number, lon: number): Promise<number | null> {
  try { return await terrainFetch(lat, lon, AbortSignal.timeout(4_000)); } catch { return null; }
}
let metarCache: { rows: Metar[]; expires: number } | null = null;
let metarPending: Promise<Metar[]> | null = null;
async function loadKbflMetars(): Promise<Metar[]> {
  if (metarCache && metarCache.expires > Date.now()) return metarCache.rows;
  if (metarPending) return metarPending;
  metarPending = (async () => {
    try {
      const r = await fetch('https://aviationweather.gov/api/data/metar?ids=KBFL&format=json&hours=360', { signal: AbortSignal.timeout(8_000) });
      if (!r.ok) return [];
      const arr = await r.json();
      if (!Array.isArray(arr)) return [];
      const rows: Metar[] = [];
      for (const m of arr) {
        const t = Number(m.obsTime) * 1000;
        let altim = Number(m.altim);
        if (altim > 100) altim /= 33.8639;
        if (Number.isFinite(t) && altim >= 27 && altim <= 33) rows.push({ t, altim });
      }
      if (rows.length) metarCache = { rows, expires: Date.now() + 5 * 60_000 };
      return rows;
    } catch { return []; }
  })();
  try { return await metarPending; } finally { metarPending = null; }
}
export async function qnhAt(iso?: string | null): Promise<number | null> {
  return qnhFrom(await loadKbflMetars(), iso);
}
function qnhFrom(rows: Metar[], iso?: string | null): number | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  let best: Metar | null = null;
  for (const m of rows) if (!best || Math.abs(m.t - ts) < Math.abs(best.t - ts)) best = m;
  return !best || Math.abs(best.t - ts) > 90 * 60_000 ? null : best.altim;
}
export function deriveAgl(opts: AglInput, terrain: number | null, qnh: number | null): AglResult {
  // KBFL QNH is only a local correction, not a county-wide weather assumption.
  const local = Math.abs(opts.lat - 35.4336) <= 0.25 && Math.abs(opts.lon + 119.0568) <= 0.30;
  const setting = local ? qnh : null;
  const correction = setting == null ? 0 : Math.round((setting - 29.92) * 1000);
  const msl = opts.altitudeFt + correction;
  return { msl_ft: Math.round(msl), altitude_source: setting == null ? 'baro_uncorrected' : 'baro_qnh_corrected',
    qnh_inhg: setting == null ? null : Number(setting.toFixed(2)), qnh_correction_ft: correction,
    terrain_ft: terrain == null ? null : Math.round(terrain), agl_ft: terrain == null ? null : Math.round(msl - terrain),
    margin_ft: setting == null ? 300 : 150, terrain_source: 'USGS 3DEP (EPQS)',
    datum_note: 'Pressure altitude corrected where local QNH is available; GNSS altitude retained separately, datum not verified. Uncertainty margins are screening allowances, not certified error bounds.',
    qnh_station: setting == null ? null : 'KBFL' };
}
export async function computeAgl(opts: AglInput): Promise<AglResult> {
  const [terrain, qnh] = await Promise.all([terrainElevationFt(opts.lat, opts.lon), qnhAt(opts.timestamp)]);
  return deriveAgl(opts, terrain, qnh);
}
export async function computeAglBatch(inputs: AglInput[]) {
  // Prime one shared METAR fetch in parallel with the bounded terrain workers.
  const [terrain, metars] = await Promise.all([prepareTerrain(inputs, { lookup: (p, signal) => terrainFetch(p.lat, p.lon, signal) }), loadKbflMetars()]);
  const results = inputs.map(opts => deriveAgl(opts, terrain.values.get(terrainKey(opts)) ?? null, qnhFrom(metars, opts.timestamp)));
  return { results, terrain: { unique: terrain.unique, attempted: terrain.attempted, resolved: terrain.resolved, deferred: terrain.deferred, budgetMs: terrain.budgetMs } };
}
export function judge(aglFt: number | null, marginFt: number, limitFt: number): 'violation' | 'borderline' | 'clear' | 'unknown' {
  if (aglFt == null || !Number.isFinite(aglFt)) return 'unknown';
  if (aglFt + marginFt < limitFt) return 'violation';
  if (aglFt - marginFt < limitFt) return 'borderline';
  return 'clear';
}

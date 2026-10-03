// AGL (height above ground) computation.
// ADS-B reports MSL altitude: barometric (pressure altitude, standard 29.92 inHg)
// or geometric (GNSS). 14 CFR 91.119 and KCSO manual limits are AGL.
//   AGL = corrected MSL − terrain elevation (USGS 3DEP via EPQS)
// Baro is corrected with KBFL altimeter setting (QNH) when a METAR within
// 90 min is available; otherwise an uncertainty margin is widened.
// Raw records are never modified — results are attached as evidence.

export interface AglResult {
  msl_ft: number;
  altitude_source: "geometric" | "baro_qnh_corrected" | "baro_uncorrected";
  qnh_inhg: number | null;
  qnh_correction_ft: number;
  terrain_ft: number | null;
  agl_ft: number | null;
  margin_ft: number; // ± uncertainty
  terrain_source: string;
}

const terrainCache = new Map<string, number | null>();

export async function terrainElevationFt(lat: number, lon: number): Promise<number | null> {
  // ~100 m grid cache
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (terrainCache.has(key)) return terrainCache.get(key)!;
  let val: number | null = null;
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const j = await r.json();
      const v = Number(j?.value);
      if (isFinite(v) && v > -1000) val = v;
    }
  } catch { /* leave null */ }
  terrainCache.set(key, val);
  return val;
}

let metarCache: Array<{ t: number; altim: number }> | null = null;

async function loadKbflMetars(): Promise<Array<{ t: number; altim: number }>> {
  if (metarCache) return metarCache;
  metarCache = [];
  try {
    const r = await fetch("https://aviationweather.gov/api/data/metar?ids=KBFL&format=json&hours=360", { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const arr = await r.json();
      for (const m of arr || []) {
        const t = Number(m.obsTime) * 1000;
        let a = Number(m.altim); // hPa in this API
        if (!isFinite(t) || !isFinite(a)) continue;
        if (a > 100) a = a / 33.8639; // hPa → inHg
        metarCache.push({ t, altim: a });
      }
    }
  } catch { /* none */ }
  return metarCache;
}

export async function qnhAt(iso?: string | null): Promise<number | null> {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!isFinite(ts)) return null;
  const list = await loadKbflMetars();
  let best: { t: number; altim: number } | null = null;
  for (const m of list) if (!best || Math.abs(m.t - ts) < Math.abs(best.t - ts)) best = m;
  if (!best || Math.abs(best.t - ts) > 90 * 60 * 1000) return null;
  return best.altim;
}

export async function computeAgl(opts: {
  lat: number; lon: number; altitudeFt: number; geoAltitudeFt?: number | null; timestamp?: string | null;
}): Promise<AglResult> {
  const terrain = await terrainElevationFt(opts.lat, opts.lon);
  let msl = opts.altitudeFt;
  let source: AglResult["altitude_source"] = "baro_uncorrected";
  let qnh: number | null = null;
  let corr = 0;
  let margin = 300; // uncorrected baro: weather can shift ±300 ft

  if (opts.geoAltitudeFt != null && isFinite(opts.geoAltitudeFt) && opts.geoAltitudeFt > 0) {
    msl = opts.geoAltitudeFt;
    source = "geometric";
    margin = 150; // GNSS vertical + DEM error
  } else {
    qnh = await qnhAt(opts.timestamp);
    if (qnh != null) {
      corr = Math.round((qnh - 29.92) * 1000); // ~1000 ft per inHg
      msl = opts.altitudeFt + corr;
      source = "baro_qnh_corrected";
      margin = 150; // 25-ft ADS-B quantisation + altimetry + DEM
    }
  }
  const agl = terrain == null ? null : Math.round(msl - terrain);
  return {
    msl_ft: Math.round(msl), altitude_source: source, qnh_inhg: qnh ? Number(qnh.toFixed(2)) : null,
    qnh_correction_ft: corr, terrain_ft: terrain == null ? null : Math.round(terrain),
    agl_ft: agl, margin_ft: margin, terrain_source: "USGS 3DEP (EPQS)",
  };
}

/** "violation" only if still below limit after the full margin; "borderline" if within margin. */
export function judge(aglFt: number | null, marginFt: number, limitFt: number): "violation" | "borderline" | "clear" | "unknown" {
  if (aglFt == null) return "unknown";
  if (aglFt + marginFt < limitFt) return "violation";
  if (aglFt - marginFt < limitFt) return "borderline";
  return "clear";
}

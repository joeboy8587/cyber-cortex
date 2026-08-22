import { supabase } from '@/integrations/supabase/client';
import { utcWindow } from '@/lib/timezone';

/**
 * Correlate a screenshot (converted to a UTC instant) against the ADS-B evidence
 * tables. Screenshots are Pacific local time; both detection tables are UTC, so the
 * caller must pass an already-converted UTC ISO instant (see lib/timezone).
 */

export interface AdsbMatch {
  source: 'LIVE' | 'ARCHIVE';
  registration: string | null;
  callsign: string | null;
  icao24: string | null;
  altitude: number | null;
  speed: number | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  detection_timestamp: string;
  delta_seconds: number;
  match_type: 'REGISTRATION' | 'ICAO' | 'CALLSIGN' | 'TIME_WINDOW';
}

export interface CorrelationResult {
  capturedAtUtc: string;
  windowMinutes: number;
  identityMatches: AdsbMatch[];
  contextMatches: AdsbMatch[];
  liveCount: number;
  archiveCount: number;
  error?: string;
}

const esc = (v: string) => v.replace(/'/g, "''");

function normReg(v?: string | null): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  return s.length >= 3 ? s : null;
}

const COLS = `registration, callsign, icao24, icao_code, altitude, speed, latitude, longitude, heading, detection_timestamp`;

function mapRows(rows: any[]): AdsbMatch[] {
  return rows.map((r) => ({
    source: r.source === 'ARCHIVE' ? 'ARCHIVE' : 'LIVE',
    registration: r.registration ?? null,
    callsign: r.callsign ?? null,
    icao24: r.icao24 ?? r.icao_code ?? null,
    altitude: r.altitude != null ? Number(r.altitude) : null,
    speed: r.speed != null ? Number(r.speed) : null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    heading: r.heading != null ? Number(r.heading) : null,
    detection_timestamp: r.detection_timestamp,
    delta_seconds: Math.round(Number(r.delta_seconds ?? 0)),
    match_type: (r.match_type as AdsbMatch['match_type']) ?? 'TIME_WINDOW',
  }));
}

async function runQuery(query: string): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke('neon-query', {
    body: { action: 'customQuery', query },
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : data?.data || [];
  return rows;
}

export async function correlateScreenshotWithAdsb(opts: {
  capturedAtUtc: string;
  registration?: string | null;
  icao?: string | null;
  callsign?: string | null;
  windowMinutes?: number;
  contextLimit?: number;
}): Promise<CorrelationResult> {
  const windowMinutes = opts.windowMinutes ?? 15;
  const { start, end } = utcWindow(opts.capturedAtUtc, windowMinutes);
  const reg = normReg(opts.registration);
  const icao = opts.icao ? opts.icao.toUpperCase().replace(/[^A-F0-9]/g, '') : null;
  const cs = opts.callsign ? opts.callsign.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;

  const identityPredicates: string[] = [];
  if (reg) identityPredicates.push(`REPLACE(UPPER(TRIM(registration)), '-', '') = '${esc(reg)}'`);
  if (icao)
    identityPredicates.push(
      `UPPER(COALESCE(icao24, icao_code, '')) = '${esc(icao)}'`
    );
  if (cs) identityPredicates.push(`UPPER(TRIM(callsign)) = '${esc(cs)}'`);

  const matchTypeExpr = `CASE
      ${reg ? `WHEN REPLACE(UPPER(TRIM(registration)), '-', '') = '${esc(reg)}' THEN 'REGISTRATION'` : ''}
      ${icao ? `WHEN UPPER(COALESCE(icao24, icao_code, '')) = '${esc(icao)}' THEN 'ICAO'` : ''}
      ${cs ? `WHEN UPPER(TRIM(callsign)) = '${esc(cs)}' THEN 'CALLSIGN'` : ''}
      ELSE 'TIME_WINDOW' END`;

  const base = (table: string, source: string, where: string, limit: number) => `
    SELECT '${source}' AS source, ${COLS}, ${matchTypeExpr} AS match_type,
           ABS(EXTRACT(EPOCH FROM (detection_timestamp - TIMESTAMPTZ '${esc(opts.capturedAtUtc)}'))) AS delta_seconds
    FROM ${table}
    WHERE detection_timestamp >= TIMESTAMPTZ '${esc(start)}'
      AND detection_timestamp <= TIMESTAMPTZ '${esc(end)}'
      ${where}
    ORDER BY delta_seconds ASC
    LIMIT ${limit}`;

  const result: CorrelationResult = {
    capturedAtUtc: opts.capturedAtUtc,
    windowMinutes,
    identityMatches: [],
    contextMatches: [],
    liveCount: 0,
    archiveCount: 0,
  };

  try {
    if (identityPredicates.length > 0) {
      const idWhere = `AND (${identityPredicates.join(' OR ')})`;
      const rows = await runQuery(`
        ${base('live_flight_detections_rows', 'LIVE', idWhere, 25)}
        UNION ALL
        ${base('public.evidence_flight_dump_20260103_unsealed', 'ARCHIVE', idWhere, 25)}
      `);
      result.identityMatches = mapRows(rows).sort((a, b) => a.delta_seconds - b.delta_seconds);
    }

    const contextRows = await runQuery(
      base('live_flight_detections_rows', 'LIVE', '', opts.contextLimit ?? 40)
    );
    let context = mapRows(contextRows);
    if (context.length === 0) {
      const archiveRows = await runQuery(
        base('public.evidence_flight_dump_20260103_unsealed', 'ARCHIVE', '', opts.contextLimit ?? 40)
      );
      context = mapRows(archiveRows);
    }
    const seen = new Set(result.identityMatches.map((m) => `${m.registration}|${m.detection_timestamp}`));
    result.contextMatches = context.filter(
      (m) => !seen.has(`${m.registration}|${m.detection_timestamp}`)
    );

    result.liveCount = [...result.identityMatches, ...result.contextMatches].filter(
      (m) => m.source === 'LIVE'
    ).length;
    result.archiveCount = [...result.identityMatches, ...result.contextMatches].filter(
      (m) => m.source === 'ARCHIVE'
    ).length;
  } catch (e: any) {
    result.error = e?.message || 'Correlation query failed';
  }

  return result;
}

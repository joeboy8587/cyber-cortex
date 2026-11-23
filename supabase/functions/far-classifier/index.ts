import { z } from 'npm:zod@3';
import { computeAglBatch } from '../_shared/agl.ts';
import { altitudeRule, FAR_ALTITUDE_TEXT, FAR_REVIEW } from '../_shared/farAltitudeRules.ts';
import { readScanFlights, SCAN_SOURCE } from '../_shared/scanFlights.ts';
import { scanClient, scanRead, saveScanRecords, scanHash, respondScan } from '../_shared/scanSupport.ts';
const Detection = z.object({ icao: z.string().max(20).nullable().optional(), registration: z.string().max(20).nullable().optional(),
  callsign: z.string().max(30).nullable().optional(), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  altitude: z.number().finite(), timestamp: z.string().datetime({ offset: true }).nullable().optional(),
  geo_altitude: z.number().finite().nullable().optional() });
const Input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('scan'), lookbackHours: z.number().int().min(1).max(720).default(24), limit: z.number().int().min(1).max(1000).default(400) }),
  z.object({ action: z.literal('classifyOne'), detection: Detection }),
]);
function distanceNm(lat: number, lon: number) {
  const rad = Math.PI / 180, a = Math.sin((lat - 35.4377286) * rad / 2) ** 2
    + Math.cos(lat * rad) * Math.cos(35.4377286 * rad) * Math.sin((lon + 119.0252189) * rad / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}
Deno.serve(async req => {
  const deadline = Date.now() + 100_000;
  if (req.method === 'OPTIONS') return respondScan({ ok: true });
  if (req.method !== 'POST') return respondScan({ error: 'Method not allowed' }, 405);
  try {
    const client = await scanClient(req);
    const raw = await req.json().catch(() => null);
    const parsed = Input.safeParse(raw && { ...raw, action: raw.action ?? 'scan' });
    if (!parsed.success) return respondScan({ error: 'Invalid scan input', issues: parsed.error.flatten() }, 400);
    const input = parsed.data;
    if (input.action === 'classifyOne') {
      const d = input.detection;
      const { results } = await computeAglBatch([{ lat: d.lat, lon: d.lon, altitudeFt: d.altitude, timestamp: d.timestamp }]);
      const agl = results[0];
      if (!agl) throw new Error('Altitude calculation unavailable');
      return respondScan({ ok: true, classification: { ...altitudeRule(agl.agl_ft, agl.margin_ft, distanceNm(d.lat, d.lon) <= 3),
        agl, evidence_status: 'ALTITUDE_REVIEW', regulations: FAR_REVIEW } });
    }
    const limit = Math.min(input.limit, 600);
    const source = await readScanFlights(input.lookbackHours, limit, undefined, 9000);
    // Spend the finite terrain budget on the lowest reported flights first.
    const flights = [...source.flights].sort((a, b) => a.altitude - b.altitude);
    let regulationGap: string | null = null;
    let regulationRows: Record<string, any>[] = [];
    try { regulationRows = await scanRead("SELECT section, content, last_updated, sha256_hash FROM public.faa_regulations WHERE section = ANY($1::text[]) LIMIT 5", [['91.119', '91.13', '91.117', '91.155', '91.209']]); }
    catch (e) { regulationGap = e instanceof Error ? e.message : 'Stored regulation text not retrieved'; }
    const batch = await computeAglBatch(flights.map(d => ({ lat: d.lat, lon: d.lon, altitudeFt: d.altitude, timestamp: d.timestamp })));
    let borderline = 0, clear = 0, unknown = 0;
    const records: Record<string, any>[] = [], samples: Record<string, any>[] = [];
    for (const [i, d] of flights.entries()) {
      const agl = batch.results[i];
      if (!agl) { unknown++; continue; }
      const distance = distanceNm(d.lat, d.lon);
      const type = d.registry_record_scope === 'CURRENT_RELEASE' ? d.aircraft_type : null;
      const result = altitudeRule(agl.agl_ft, agl.margin_ft, distance <= 3, type);
      if (samples.length < 20) samples.push({ registration: d.registration, icao: d.icao, timestamp: d.timestamp,
        msl_reported_ft: Math.round(d.altitude), agl, status: result.status });
      if (result.status === 'unknown') unknown++;
      if (result.status === 'borderline') borderline++;
      if (result.status === 'clear') clear++;
      if (!result.citation) continue;
      const regulation = regulationRows.find(r => r.section === '91.119');
      const gaps = ['Takeoff/landing necessity not checked', 'Congested-area / obstacle / surface-separation context not verified'];
      if (!type) gaps.push('Current FAA aircraft category not resolved; helicopter provision remains open');
      if (type === '6') gaps.push('Helicopter hazard and FAA-prescribed route/altitude checks required');
      if (agl.agl_ft != null && agl.agl_ft < 0) gaps.push('Nominal AGL is below terrain; review pressure/position/terrain alignment and measurement allowance, not literal underground flight');
      records.push({ icao: d.icao || d.registration || 'unknown', callsign: d.callsign, detected_at: d.timestamp,
        rule_code: result.citation, rule_title: `${result.citation} — low-altitude pattern review`, manual_section: '14 CFR Part 91',
        severity: distance <= 3 && (agl.agl_ft ?? Infinity) + agl.margin_ft < 500 ? 'critical' : 'high',
        rule_source: 'FAR_REVIEW', citation: result.citation,
        far_text: regulation?.content || FAR_ALTITUDE_TEXT[result.citation], altitude_ft: Math.round(d.altitude),
        lat: d.lat, lon: d.lon, source_table: SCAN_SOURCE,
        sha256: await scanHash(['FAR_AGL_REVIEW_v3', d.source_id, d.source_hash, result.citation]),
        evidence: { registration: d.registration, source_id: d.source_id, source_sha256: d.source_hash, poll_id: d.poll_id,
          msl_reported_ft: d.altitude, geometric_altitude_reported_ft: d.geo_altitude, agl,
          threshold_ft: result.threshold, evidence_status: 'ALTITUDE_REVIEW', gaps,
          current_faa_aircraft_type: type, registry_record_scope: d.registry_record_scope,
          distance_from_aoi_nm: distance, timestamp_source: d.timestamp_source,
          regulation_source: regulation ? 'Neon faa_regulations' : 'Source-checked eCFR text',
          regulation_last_updated: regulation?.last_updated ?? null, regulation_sha256: regulation?.sha256_hash ?? null,
          rule_version: 'FAR_AGL_REVIEW_v3',
          routine_angle: 'Test necessary takeoff/landing and applicable aircraft-specific provisions against the actual track.',
          cover_angle: 'Test repeated low passes, timing and orbit geometry; airport proximity alone does not settle the pattern.',
        } });
    }
    const saved = await saveScanRecords(client, records, deadline);
    const issues = [regulationGap, saved.error, unknown ? `${unknown} sightings have no ground-height result; not cleared.` : null].filter(Boolean);
    return respondScan({ ok: true, complete: issues.length === 0 && !source.capped, issues, source_table: SCAN_SOURCE,
      source_scope: 'Independent raw feed only; no contaminated legacy observations copied',
      date_scope: { lookbackHours: input.lookbackHours, basis: 'Receipt time', latest_batch_limit: limit },
      capped: source.capped, received: source.received, scanned: source.flights.length, violations_generated: records.length,
      findings_generated: records.length, inserted: saved.inserted, borderline, cleared_after_agl: clear, terrain_unknown: unknown,
      terrain: batch.terrain, samples, regulations: FAR_REVIEW, evidence_status: 'ALTITUDE_REVIEW' });
  } catch (e) {
    console.error('FAR scan failed', e);
    return respondScan({ error: e instanceof Error ? e.message : 'FAR scan did not finish', complete: false }, (e as { status?: number }).status ?? 503);
  }
});

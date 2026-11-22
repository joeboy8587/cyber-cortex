import { z } from 'npm:zod@3';
import { computeAglBatch } from '../_shared/agl.ts';
import { policyMatches, repeatedPositions } from '../_shared/policyAltitudeRules.ts';
import { readScanFlights, SCAN_SOURCE } from '../_shared/scanFlights.ts';
import { scanClient, saveScanRecords, scanHash, respondScan } from '../_shared/scanSupport.ts';
const Input = z.object({ lookbackDays: z.number().int().min(1).max(90).default(14), dryRun: z.boolean().default(false) });
const DEFINITIONS = [
  { code: 'B-401', title: 'Night/mountain low-altitude pattern', section: 'KCSO Air Support B-401', gaps: ['Manual provision and applicability require source verification', 'Night VFR conditions require sunset/weather checks'] },
  { code: 'C-100-HOVER', title: 'Repeated low/slow observations', section: 'KCSO Air Support C-100', gaps: ['Mission / SAR status not retrieved', 'Low ground speed is not hover or indicated airspeed'] },
  { code: 'A-401', title: 'Late-night mission-authorization check', section: 'KCSO Air Support A-401', gaps: ['CAD/dispatch authorization not retrieved; absence cannot be inferred'] },
  { code: 'B-1102', title: 'Transport-profile review', section: 'KCSO Air Support B-1102', gaps: ['Manifest and mission purpose not retrieved; absence cannot be inferred'] },
];
Deno.serve(async req => {
  const deadline = Date.now() + 100_000;
  if (req.method === 'OPTIONS') return respondScan({ ok: true });
  if (req.method !== 'POST') return respondScan({ error: 'Method not allowed' }, 405);
  try {
    const client = await scanClient(req);
    const input = Input.safeParse(await req.json().catch(() => null));
    if (!input.success) return respondScan({ error: 'Invalid policy scan input', issues: input.error.flatten() }, 400);
    const { lookbackDays, dryRun } = input.data;
    const { data: fleet, error: fleetError } = await client.from('kcso_fleet').select('tail_number');
    if (fleetError) throw new Error('Documented KCSO fleet could not be retrieved; no callsign-based ownership guesses used.');
    const registrations = (fleet || []).map(r => r.tail_number.trim().toUpperCase());
    if (!registrations.length) throw new Error('Documented KCSO fleet is empty; scan not run.');
    const source = await readScanFlights(lookbackDays * 24, 600, registrations);
    const batch = await computeAglBatch(source.flights.map(d => ({ lat: d.lat, lon: d.lon, altitudeFt: d.altitude, timestamp: d.timestamp })));
    const rows = source.flights.map((d, i) => ({ ...d, agl: batch.results[i] })).filter(d => d.agl != null);
    const report: Record<string, any>[] = [], issues: string[] = [];
    const unknown = rows.filter(d => d.agl?.agl_ft == null).length;
    if (unknown) issues.push(`${unknown} sightings have no ground-height result; altitude checks remain open.`);
    let totalInserted = 0;
    for (const rule of DEFINITIONS) {
      let matches = rows.filter(d => policyMatches(rule.code, d));
      if (rule.code === 'C-100-HOVER') matches = repeatedPositions(matches);
      const records = await Promise.all(matches.map(async d => ({ icao: d.icao || d.registration || 'unknown', callsign: d.callsign,
        detected_at: d.timestamp, rule_code: rule.code, rule_title: `${rule.title} — policy review`,
        manual_section: rule.section, severity: rule.code === 'B-401' || rule.code === 'C-100-HOVER' ? 'high' : 'medium',
        rule_source: 'POLICY_REVIEW', source_table: SCAN_SOURCE, altitude_ft: Math.round(d.altitude), lat: d.lat, lon: d.lon,
        sha256: await scanHash(['POLICY_AGL_REVIEW_v3', rule.code, d.source_id, d.source_hash]),
        evidence: { registration: d.registration, source_id: d.source_id, source_sha256: d.source_hash, poll_id: d.poll_id,
          msl_reported_ft: d.altitude, geometric_altitude_reported_ft: d.geo_altitude, agl: d.agl, ground_speed_kts: d.ground_speed,
          timestamp_source: d.timestamp_source, evidence_status: 'POLICY_REVIEW', gaps: rule.gaps,
          aircraft_identity_basis: 'Reported registration matches documented kcso_fleet; not inferred from callsign. FAA identity check remains separate.',
          rule_version: 'POLICY_AGL_REVIEW_v3',
          routine_angle: 'Check actual mission, dispatch and authorized operating provisions.',
          cover_angle: 'Check repeated location/timing and low-flight geometry against the stated mission; paperwork alone does not settle the pattern.',
        } })));
      const saved = dryRun ? { inserted: 0, error: null } : await saveScanRecords(client, records, deadline);
      totalInserted += saved.inserted;
      if (saved.error) issues.push(`${rule.code}: ${saved.error}`);
      report.push({ rule_code: rule.code, rule_title: rule.title, matches: records.length, inserted: saved.inserted,
        complete: saved.error == null && (rule.code === 'B-1102' || unknown === 0), error: saved.error,
        evidence_status: 'POLICY_REVIEW' });
      // Stop after an ambiguous write; don't compound a saving failure.
      if (saved.error) break;
    }
    return respondScan({ ok: true, complete: issues.length === 0 && !source.capped, issues, lookbackDays, dryRun, totalInserted,
      rules: report, source_table: SCAN_SOURCE, source_scope: 'Independent raw feed; documented fleet registrations only',
      received: source.received, scanned: source.flights.length, capped: source.capped, terrain_unknown: unknown,
      terrain: batch.terrain, date_scope: { lookbackDays, basis: 'Receipt time', latest_batch_limit: 600 },
      generated_at: new Date().toISOString() });
  } catch (e) {
    console.error('Policy scan failed', e);
    return respondScan({ error: e instanceof Error ? e.message : 'Policy scan did not finish', complete: false }, (e as { status?: number }).status ?? 503);
  }
});

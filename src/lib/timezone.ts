/**
 * Timezone helpers for forensic evidence.
 *
 * Screenshots (phone camera / FlightRadar24 / ADS-B Exchange app) carry EXIF and
 * on-screen clocks in LOCAL Pacific time (PDT/PST). Every ADS-B detection table in
 * the evidence database (live_flight_detections_rows, the unsealed archive dump) is
 * stored in UTC. Comparing them directly is a 7 or 8 hour error, so all screenshot
 * timestamps must be converted before any correlation query.
 */

export const PACIFIC_TZ = 'America/Los_Angeles';

/** Offset in minutes that Pacific time is BEHIND UTC at the given instant (420 for PDT, 480 for PST). */
export function pacificOffsetMinutes(atUtc: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(atUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
  return Math.round((atUtc.getTime() - asUtc) / 60000);
}

/** True when Pacific daylight time (PDT, UTC-7) is in effect at that instant. */
export function isPacificDaylight(atUtc: Date): boolean {
  return pacificOffsetMinutes(atUtc) === 420;
}

/** Label the offset for display / chain-of-custody notes. */
export function pacificZoneLabel(atUtc: Date): 'PDT' | 'PST' {
  return isPacificDaylight(atUtc) ? 'PDT' : 'PST';
}

/**
 * Interpret a naive local timestamp ("2026-08-19T10:11:00", no zone — which is what
 * EXIF DateTimeOriginal and screenshot filenames give us) as Pacific wall-clock time
 * and return the equivalent UTC instant.
 */
export function pacificNaiveToUtc(naive: string): Date | null {
  const m = naive
    .trim()
    .match(/^(\d{4})[-:](\d{2})[-:](\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const fallback = new Date(naive);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi, s] = m;
  const naiveAsUtcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  // First pass with the offset at the naive instant, then re-resolve near DST edges.
  let offset = pacificOffsetMinutes(new Date(naiveAsUtcMs));
  let utcMs = naiveAsUtcMs + offset * 60000;
  const refined = pacificOffsetMinutes(new Date(utcMs));
  if (refined !== offset) {
    offset = refined;
    utcMs = naiveAsUtcMs + offset * 60000;
  }
  return new Date(utcMs);
}

/**
 * Normalise any screenshot timestamp string to a UTC ISO instant.
 * Strings that already carry a zone (Z or ±HH:MM) are trusted as-is.
 */
export function screenshotTimestampToUtcIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim());
  if (hasZone) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = pacificNaiveToUtc(raw);
  return d ? d.toISOString() : null;
}

/** Format a UTC instant as Pacific wall-clock for the operator-facing UI. */
export function formatPacific(utcIso: string | Date, withSeconds = true): string {
  const d = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  if (isNaN(d.getTime())) return '—';
  const text = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hour12: false,
  }).format(d);
  return `${text} ${pacificZoneLabel(d)}`;
}

/** Format a UTC instant for database-facing display. */
export function formatUtc(utcIso: string | Date, withSeconds = true): string {
  const d = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  if (isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, withSeconds ? 19 : 16) + ' UTC';
}

/** ± window around a UTC instant, as ISO strings, for SQL BETWEEN clauses. */
export function utcWindow(utcIso: string, minutes: number): { start: string; end: string } {
  const t = new Date(utcIso).getTime();
  return {
    start: new Date(t - minutes * 60000).toISOString(),
    end: new Date(t + minutes * 60000).toISOString(),
  };
}

/**
 * Timestamp arbitration — four signals, never one.
 *
 * A wrong timestamp is worse than no timestamp: it fabricates a mismatch.
 * So every screenshot fragment gets a `captured_at` decided by best-source-wins
 * with agreement scoring, and disagreements are FLAGGED, never silently resolved.
 *
 * Priority:
 *  1. Google Photos takeout JSON sidecar (`photoTakenTime.timestamp`) — highest
 *  2. EXIF DateTimeOriginal / PNG tEXt "Creation Time" — high
 *  3. Filesystem lastModified (birthtime/mtime) — medium
 *  4. Status-bar clock read by the VLM — minute precision, dateless, cross-check only
 */

import { pacificNaiveToUtc, screenshotTimestampToUtcIso } from './timezone';

export type TsSource =
  | 'TAKEOUT_SIDECAR'
  | 'EXIF_DATETIME_ORIGINAL'
  | 'PNG_TEXT_CREATION_TIME'
  | 'FILE_MTIME'
  | 'SCREEN_CLOCK'
  | 'FILENAME';

export type TsConfidence = 'HIGHEST' | 'HIGH' | 'MEDIUM' | 'CROSS_CHECK_ONLY';

export interface TsCandidate {
  source: TsSource;
  /** UTC ISO instant, or null for dateless signals (status-bar clock). */
  utcIso: string | null;
  /** Raw string as read from the source, for chain of custody. */
  raw: string;
  confidence: TsConfidence;
}

export interface ArbitrationResult {
  capturedAtUtc: string | null;
  chosen: TsSource | null;
  confidence: TsConfidence | 'NONE';
  /** true when two dated signals disagree by more than the tolerance. */
  needsReview: boolean;
  agreementCount: number;
  disagreements: string[];
  candidates: TsCandidate[];
}

const PRIORITY: Record<TsSource, number> = {
  TAKEOUT_SIDECAR: 1,
  EXIF_DATETIME_ORIGINAL: 2,
  PNG_TEXT_CREATION_TIME: 3,
  FILE_MTIME: 4,
  SCREEN_CLOCK: 98,
  FILENAME: 99,
};

const CONFIDENCE_OF: Record<TsSource, TsConfidence> = {
  TAKEOUT_SIDECAR: 'HIGHEST',
  EXIF_DATETIME_ORIGINAL: 'HIGH',
  PNG_TEXT_CREATION_TIME: 'HIGH',
  FILE_MTIME: 'MEDIUM',
  SCREEN_CLOCK: 'CROSS_CHECK_ONLY',
  FILENAME: 'CROSS_CHECK_ONLY',
};

/** Signals that count as authoritative dated evidence. */
const DATED: TsSource[] = [
  'TAKEOUT_SIDECAR',
  'EXIF_DATETIME_ORIGINAL',
  'PNG_TEXT_CREATION_TIME',
  'FILE_MTIME',
];

/** Two dated signals within this many minutes are "in agreement". */
export const AGREEMENT_TOLERANCE_MIN = 5;

export function candidate(
  source: TsSource,
  raw: string | null | undefined,
  utcIso?: string | null,
): TsCandidate | null {
  if (!raw && !utcIso) return null;
  return {
    source,
    raw: String(raw ?? utcIso),
    utcIso: utcIso ?? screenshotTimestampToUtcIso(String(raw)),
    confidence: CONFIDENCE_OF[source],
  };
}

/** Google Photos takeout sidecar -> UTC ISO. */
export function fromTakeoutSidecar(json: any): TsCandidate | null {
  const epoch =
    json?.photoTakenTime?.timestamp ??
    json?.creationTime?.timestamp ??
    null;
  if (!epoch) return null;
  const ms = Number(epoch) * 1000;
  if (!isFinite(ms) || ms <= 0) return null;
  return candidate('TAKEOUT_SIDECAR', String(epoch), new Date(ms).toISOString());
}

/**
 * Fold a dateless status-bar clock ("09:34", Pacific local) onto the date of the
 * best dated candidate, so it can be compared minute-to-minute.
 */
export function screenClockCandidate(
  clock: string | null | undefined,
  dateBasisUtcIso: string | null,
): TsCandidate | null {
  if (!clock) return null;
  const m = String(clock).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  if (!dateBasisUtcIso) return { source: 'SCREEN_CLOCK', raw: clock, utcIso: null, confidence: 'CROSS_CHECK_ONLY' };
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dateBasisUtcIso));
  const utc = pacificNaiveToUtc(`${localDate}T${m[1].padStart(2, '0')}:${m[2]}:00`);
  return {
    source: 'SCREEN_CLOCK',
    raw: clock,
    utcIso: utc ? utc.toISOString() : null,
    confidence: 'CROSS_CHECK_ONLY',
  };
}

const minutesApart = (a: string, b: string) =>
  Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;

/** Best-source-wins with agreement scoring; disagreement flags for review. */
export function arbitrateTimestamp(input: Array<TsCandidate | null>): ArbitrationResult {
  const candidates = input.filter((c): c is TsCandidate => !!c);
  const dated = candidates
    .filter((c) => c.utcIso && DATED.includes(c.source))
    .sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source]);

  if (dated.length === 0) {
    return {
      capturedAtUtc: null,
      chosen: null,
      confidence: 'NONE',
      needsReview: true,
      agreementCount: 0,
      disagreements: ['No dated timestamp signal available (EXIF, sidecar and file time all missing)'],
      candidates,
    };
  }

  const winner = dated[0];
  const disagreements: string[] = [];
  let agreementCount = 1;

  for (const other of dated.slice(1)) {
    const delta = minutesApart(winner.utcIso!, other.utcIso!);
    if (delta <= AGREEMENT_TOLERANCE_MIN) agreementCount++;
    else
      disagreements.push(
        `${winner.source} and ${other.source} differ by ${Math.round(delta)} min`,
      );
  }

  const clock = candidates.find((c) => c.source === 'SCREEN_CLOCK' && c.utcIso);
  if (clock) {
    const delta = minutesApart(winner.utcIso!, clock.utcIso!);
    if (delta <= AGREEMENT_TOLERANCE_MIN) agreementCount++;
    else
      disagreements.push(
        `Status-bar clock (${clock.raw}) is ${Math.round(delta)} min off ${winner.source}`,
      );
  }

  // A lone medium-confidence signal is never trusted silently.
  const loneWeak = dated.length === 1 && winner.source === 'FILE_MTIME' && !clock;

  return {
    capturedAtUtc: winner.utcIso,
    chosen: winner.source,
    confidence: winner.confidence,
    needsReview: disagreements.length > 0 || loneWeak,
    agreementCount,
    disagreements: loneWeak
      ? [...disagreements, 'Only filesystem time available — corroborate before use as evidence']
      : disagreements,
    candidates,
  };
}

/** Read PNG tEXt/iTXt chunks in the browser (screenshots often keep capture time here). */
export async function readPngTextChunks(file: File): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const buf = new Uint8Array(await file.slice(0, 2_000_000).arrayBuffer());
    if (!(buf[0] === 0x89 && buf[1] === 0x50)) return out;
    let off = 8;
    const dv = new DataView(buf.buffer);
    while (off + 8 < buf.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
      const dataStart = off + 8;
      if (type === 'IDAT' || type === 'IEND') break;
      if (type === 'tEXt' || type === 'iTXt') {
        const bytes = buf.slice(dataStart, dataStart + len);
        const text = new TextDecoder().decode(bytes);
        const nul = text.indexOf('\0');
        if (nul > 0) {
          const key = text.slice(0, nul);
          const value = text.slice(nul + 1).replace(/\0/g, ' ').trim();
          if (key && value) out[key] = value;
        }
      }
      off = dataStart + len + 4;
      if (len < 0 || off <= dataStart) break;
    }
  } catch {
    /* non-PNG or truncated — no chunks */
  }
  return out;
}

export function pngTextCandidate(chunks: Record<string, string>): TsCandidate | null {
  const key = Object.keys(chunks).find((k) =>
    /creation ?time|date ?time|capture/i.test(k),
  );
  if (!key) return null;
  return candidate('PNG_TEXT_CREATION_TIME', chunks[key]);
}

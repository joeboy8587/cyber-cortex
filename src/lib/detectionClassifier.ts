/**
 * Detection Classifier — canonical bucketing for ADS-B / MLAT / Mode-S detections.
 *
 * Background: The project previously treated `XXB`, null ICAO, 0-altitude, and
 * 0-speed as "spoofing." Per project memory (mem://investigation/quarantine-
 * unmasking-and-shadow-merge-protocol and public/data/XXB_EXPLANATION.md),
 * XXB is a LEGITIMATE MLAT placeholder used by FlightRadar24, ADS-B Exchange,
 * and OpenSky for aircraft tracked via multilateration without ADS-B.
 *
 * This module provides a single source of truth so every dashboard classifies
 * the same way and stops generating false "spoofing" alerts.
 */

export type DetectionBucket =
  | 'mlat_artifact'        // XXB / null ICAO with altitude=0 — tracker placeholder, not the aircraft
  | 'on_ground'            // Real aircraft parked/taxiing (on_ground=true OR within 5km of airport)
  | 'adsb_suppression'     // Valid registration, but altitude=0/null mid-flight — likely 14 CFR § 91.225 violation
  | 'true_spoofing'        // Physics violation OR registration impossible OR ICAO recycled mid-flight
  | 'identity_masked'      // Deliberate registration hiding (LADD program, no on-ground flag, real flight profile)
  | 'normal'               // Everything else
  | 'insufficient_data';   // Not enough fields to classify

export interface DetectionInput {
  registration?: string | null;
  icao_code?: string | null;
  icao24?: string | null;
  callsign?: string | null;
  altitude?: number | null;
  speed?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  on_ground?: boolean | null;
  source?: string | null;          // 'adsb' | 'mlat' | 'mode_s'
  taxonomy_tag?: string | null;
  nearest_airport_km?: number | null;
}

/** XXB / placeholder strings that indicate MLAT-only or unknown identity. */
const MLAT_PLACEHOLDERS = new Set(['XXB', 'XXA', 'XXC', 'XXD', 'XXX', 'UNKNOWN', '~XXB', '']);

/** Valid US registration prefix. */
const N_REG = /^N[0-9]{1,5}[A-Z]{0,2}$/i;

/** Valid 6-char hex ICAO24. */
const HEX_ICAO = /^[0-9A-Fa-f]{6}$/;

export function isMlatPlaceholder(value?: string | null): boolean {
  if (!value) return true;
  const v = value.trim().toUpperCase();
  return MLAT_PLACEHOLDERS.has(v);
}

export function isValidIcao24(value?: string | null): boolean {
  if (!value) return false;
  return HEX_ICAO.test(value.trim());
}

export function isValidRegistration(value?: string | null): boolean {
  if (!value) return false;
  const v = value.trim().toUpperCase();
  if (MLAT_PLACEHOLDERS.has(v)) return false;
  // US (N), Canada (C-), UK (G-), generic alphanumeric 2-7 chars
  return N_REG.test(v) || /^[A-Z0-9-]{2,7}$/.test(v);
}

/**
 * Classify a single detection into one of the canonical buckets.
 *
 * Decision tree:
 *  1. XXB / null ICAO + altitude≈0 + speed≈0  → mlat_artifact
 *  2. on_ground=true OR (altitude≈0 + within 5km of airport)  → on_ground
 *  3. Valid registration + altitude=0/null + speed>0 + NOT on ground  → adsb_suppression
 *  4. Speed > aircraft physics envelope OR impossible altitude jump  → true_spoofing (caller must pre-compute)
 *  5. Valid registration + missing icao24 + valid flight profile  → identity_masked (LADD)
 *  6. default → normal
 */
export function classifyDetection(d: DetectionInput): DetectionBucket {
  const alt = d.altitude ?? null;
  const spd = d.speed ?? null;
  const hasReg = isValidRegistration(d.registration);
  const hasIcao = isValidIcao24(d.icao24 ?? d.icao_code);
  const placeholder = isMlatPlaceholder(d.registration) && isMlatPlaceholder(d.icao_code) && isMlatPlaceholder(d.icao24);

  // 0. Not enough info
  if (alt === null && spd === null && !hasReg && !hasIcao) return 'insufficient_data';

  // 1. MLAT artifact: placeholder identity + zero/null kinematics
  if (placeholder && (alt === null || alt <= 0) && (spd === null || spd <= 0)) {
    return 'mlat_artifact';
  }

  // 2. On-ground (real aircraft parked/taxiing)
  const nearAirport = (d.nearest_airport_km ?? 999) <= 5;
  if (d.on_ground === true || (alt !== null && alt <= 50 && spd !== null && spd <= 30 && nearAirport)) {
    return 'on_ground';
  }

  // 3. ADS-B suppression: valid aircraft, broadcasting position but altitude=0/null mid-flight
  if (hasReg && (alt === null || alt <= 0) && spd !== null && spd > 30 && !nearAirport) {
    return 'adsb_suppression';
  }

  // 4. Identity masked (LADD): valid reg, no icao24, normal flight profile
  if (hasReg && !hasIcao && alt !== null && alt > 500 && spd !== null && spd > 50) {
    return 'identity_masked';
  }

  return 'normal';
}

/** Human-friendly label + color token for UI. */
export const BUCKET_META: Record<DetectionBucket, {
  label: string;
  shortLabel: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  legalCitation?: string;
}> = {
  mlat_artifact: {
    label: 'MLAT-Only Track',
    shortLabel: 'MLAT',
    description: 'Aircraft tracked by ground-station triangulation. No ADS-B payload received — altitude/speed/identity fields are tracker placeholders, not the aircraft. Not a violation.',
    severity: 'info',
  },
  on_ground: {
    label: 'On Ground',
    shortLabel: 'GROUND',
    description: 'Aircraft parked or taxiing. Zero altitude is legitimate.',
    severity: 'low',
  },
  adsb_suppression: {
    label: 'ADS-B Altitude Suppression',
    shortLabel: 'SUPPRESSED',
    description: 'Valid aircraft broadcasting position but no altitude mid-flight. Possible 14 CFR § 91.225 violation.',
    severity: 'high',
    legalCitation: '14 CFR § 91.225 — ADS-B Out altitude required',
  },
  true_spoofing: {
    label: 'Confirmed Spoofing',
    shortLabel: 'SPOOF',
    description: 'Physics-impossible parameters or impossible altitude jumps. Fabricated transponder data.',
    severity: 'critical',
    legalCitation: '18 U.S.C. § 32 — False ADS-B data',
  },
  identity_masked: {
    label: 'Identity Masked (LADD)',
    shortLabel: 'LADD',
    description: 'Valid registration but ICAO24 hidden via FAA Limited Aircraft Data Display program.',
    severity: 'medium',
  },
  normal: {
    label: 'Normal',
    shortLabel: 'NORMAL',
    description: 'Standard detection with valid identity and physics.',
    severity: 'low',
  },
  insufficient_data: {
    label: 'Insufficient Data',
    shortLabel: 'N/A',
    description: 'Detection lacks enough fields to classify.',
    severity: 'info',
  },
};

/** Aggregate a list of detections into bucket counts. */
export function bucketCounts(detections: DetectionInput[]): Record<DetectionBucket, number> {
  const counts: Record<DetectionBucket, number> = {
    mlat_artifact: 0,
    on_ground: 0,
    adsb_suppression: 0,
    true_spoofing: 0,
    identity_masked: 0,
    normal: 0,
    insufficient_data: 0,
  };
  for (const d of detections) {
    counts[classifyDetection(d)]++;
  }
  return counts;
}

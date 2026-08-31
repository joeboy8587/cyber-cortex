/**
 * Medical / HEMS ("air ambulance") fleet definition — shared across scoring engines.
 *
 * DOCTRINE: A medical registrant is NOT an exemption. Air-ambulance liveries are the
 * single most effective cover for low-altitude loitering over a residence, because
 * every analyst instinctively writes them off as "a medevac."
 *
 * We therefore do the opposite of a whitelist: medical operators are given an explicit
 * MISSION CONSISTENCY test. Behaviour that matches a real HEMS mission (direct transit,
 * scene landing, hospital terminus, base return) scores ZERO. Behaviour that cannot be
 * explained by a medical mission (repeat orbits over the AOI, low-speed dwell, night
 * passes with no hospital terminus) is scored HIGHER than an unmarked aircraft doing
 * the same thing, because the medical marking supplies the concealment.
 *
 * Labels stay forensic ("MEDICAL_PROFILE_ANOMALY"), never accusatory — legal framing
 * belongs in the briefs, not the detector.
 */

/** FAA registrant-name patterns for air-ambulance / HEMS operators (POSIX regex, upper-case). */
export const MEDICAL_REGISTRANT_REGEX =
  "(AIR METHODS|MERCY AIR|REACH AIR|REACH MEDICAL|PHI AIR MEDICAL|PHI HELICOPTER|CALSTAR|AIR EVAC|" +
  "GUARDIAN FLIGHT|CLASSIC AIR MEDICAL|LIFE ?FLIGHT|MEDIVAC|MEDEVAC|AIR AMBULANCE|HALL AMBULANCE|" +
  "AIRMEDICAL|AIR MEDICAL|ROCKY MOUNTAIN HOLDINGS|MED-TRANS|MEDTRANS|SURVIVAL FLIGHT|AIRLIFE)";

/**
 * Tail-number suffixes used by the Air Methods group and its subsidiaries.
 * N###AM is the Air Methods block (N224AM, N258AM, ...); the others are legacy
 * sub-brand blocks that remain on Air Methods LLC certificates.
 */
export const MEDICAL_TAIL_REGEX = "^N[0-9]{1,4}(AM|MH|LF|CH|PM|LN|RX|MA)$";

/** Known Kern County hospital / helipad termini — a real HEMS mission ends at one of these. */
export const HOSPITALS: { name: string; lat: number; lng: number }[] = [
  { name: "Kern Medical Center", lat: 35.36081, lng: -118.99744 },
  { name: "Bakersfield Memorial Hospital", lat: 35.37331, lng: -119.02069 },
  { name: "Adventist Health Bakersfield", lat: 35.35271, lng: -119.01932 },
  { name: "Mercy Hospital Southwest", lat: 35.34663, lng: -119.10971 },
  { name: "Mercy Hospital Downtown", lat: 35.37669, lng: -119.02605 },
  { name: "Bakersfield Heart Hospital", lat: 35.36622, lng: -119.10361 },
  { name: "Delano Regional Medical Center", lat: 35.76166, lng: -119.24215 },
  { name: "Ridgecrest Regional Hospital", lat: 35.62306, lng: -117.66889 },
  { name: "Tehachapi Valley Healthcare", lat: 35.13389, lng: -118.44194 },
];

/** Operating bases (a return-to-base leg is legitimate, not evidence). */
export const MEDICAL_BASES: { name: string; lat: number; lng: number }[] = [
  { name: "Meadows Field (KBFL)", lat: 35.43360, lng: -119.05677 },
  { name: "Bakersfield Municipal (L45)", lat: 35.32472, lng: -118.99639 },
];

/** SQL boolean: is this detection row operated by a medical/HEMS registrant? */
export const MEDICAL_OPERATOR_SQL = `(
  upper(coalesce(owner_operator,'') || ' ' || coalesce(operator_inferred,'')) ~ '${MEDICAL_REGISTRANT_REGEX}'
  OR upper(coalesce(registration,'')) ~ '${MEDICAL_TAIL_REGEX}'
)`;

/** SQL boolean: is the aircraft physically at a hospital or base (mission terminus)? */
export function nearPointsSql(
  points: { lat: number; lng: number }[],
  radiusDeg: number,
): string {
  return (
    "(" +
    points
      .map(
        (p) =>
          `(latitude BETWEEN ${p.lat - radiusDeg} AND ${p.lat + radiusDeg} AND longitude BETWEEN ${
            p.lng - radiusDeg * 1.22
          } AND ${p.lng + radiusDeg * 1.22})`,
      )
      .join(" OR ") +
    ")"
  );
}

/** ~0.6 nm around a hospital pad, ~1.2 nm around a base. */
export const NEAR_HOSPITAL_SQL = nearPointsSql(HOSPITALS, 0.011);
export const NEAR_BASE_SQL = nearPointsSql(MEDICAL_BASES, 0.022);

export interface MedicalCoverMetrics {
  registration: string;
  registrant: string | null;
  detections: number;
  active_days: number;
  aoi_passes: number;
  aoi_minutes: number;
  aoi_nights: number;
  min_alt_near_aoi: number | null;
  loiter_samples: number;
  hospital_terminus: number;
  base_ops: number;
  first_seen: string | null;
  last_seen: string | null;
}

export interface MedicalCoverVerdict {
  score: number;
  tier: "MEDICAL_CONSISTENT" | "REVIEW" | "MEDICAL_PROFILE_ANOMALY" | "MEDICAL_COVER_SUSPECTED";
  reasons: string[];
  rebuttal: string;
}

/**
 * Mission-consistency scoring. Every point requires an observation a real HEMS
 * mission would not produce, so the output survives a "it was a medevac" rebuttal.
 */
export function scoreMedicalCover(m: MedicalCoverMetrics): MedicalCoverVerdict {
  const reasons: string[] = [];
  let score = 0;

  if (m.aoi_passes >= 25) { score += 30; reasons.push(`${m.aoi_passes} detections over the residence AOI`); }
  else if (m.aoi_passes >= 8) { score += 18; reasons.push(`${m.aoi_passes} detections over the residence AOI`); }
  else if (m.aoi_passes > 0) { score += 6; reasons.push(`${m.aoi_passes} AOI detections`); }

  if (m.aoi_minutes >= 20) { score += 20; reasons.push(`${m.aoi_minutes} minutes of dwell time over the AOI`); }
  else if (m.aoi_minutes >= 6) { score += 10; reasons.push(`${m.aoi_minutes} minutes of dwell over the AOI`); }

  if (m.loiter_samples >= 10) { score += 18; reasons.push("sustained low-speed low-altitude orbit (not transit)"); }
  else if (m.loiter_samples > 0) { score += 8; reasons.push("low-speed low-altitude samples over the AOI"); }

  if (m.aoi_nights >= 5) { score += 12; reasons.push(`${m.aoi_nights} overnight (00:00–05:00) AOI passes`); }
  else if (m.aoi_nights > 0) { score += 5; reasons.push("overnight AOI passes"); }

  if (m.min_alt_near_aoi !== null && m.min_alt_near_aoi > 0 && m.min_alt_near_aoi < 500) {
    score += 15; reasons.push(`descended to ${m.min_alt_near_aoi} ft over the AOI`);
  } else if (m.min_alt_near_aoi !== null && m.min_alt_near_aoi > 0 && m.min_alt_near_aoi < 1000) {
    score += 8; reasons.push(`${m.min_alt_near_aoi} ft minimum over the AOI`);
  }

  // The decisive test: AOI activity with no hospital terminus anywhere in the window.
  if (m.aoi_passes >= 5 && m.hospital_terminus === 0) {
    score += 22;
    reasons.push("no hospital/helipad terminus recorded in the entire window — AOI activity is unexplained by a patient transport");
  } else if (m.hospital_terminus > 0) {
    score -= 10;
    reasons.push(`${m.hospital_terminus} hospital terminus samples (consistent with genuine transport)`);
  }

  // Meadows Field (KBFL) sits ~1.4 nm from the residence, so base traffic legitimately
  // crosses the AOI. Damp that honestly rather than letting the corridor inflate scores.
  if (m.base_ops > 0 && m.aoi_passes > 0) {
    if (m.loiter_samples === 0 && m.aoi_minutes < 6) {
      score -= 20;
      reasons.push("AOI crossings are consistent with the Meadows Field approach/departure corridor");
    } else if (m.base_ops >= m.aoi_passes && m.loiter_samples < 10) {
      score -= 12;
      reasons.push("caveat: most AOI samples coincide with Meadows Field base operations");
    } else {
      reasons.push("caveat: aircraft is based at Meadows Field — corridor transit accounted for, orbit behaviour is in excess of it");
    }
  }


  score = Math.max(0, Math.min(100, Math.round(score)));

  const tier: MedicalCoverVerdict["tier"] =
    score >= 70 ? "MEDICAL_COVER_SUSPECTED" :
    score >= 45 ? "MEDICAL_PROFILE_ANOMALY" :
    score >= 20 ? "REVIEW" : "MEDICAL_CONSISTENT";

  const rebuttal =
    m.hospital_terminus === 0 && m.aoi_passes >= 5
      ? "Anticipated defence: 'this was an emergency medical flight.' Rebuttal: across the whole observation window this airframe never terminated at a hospital pad while repeatedly operating over the residence."
      : m.loiter_samples > 0
      ? "Anticipated defence: 'this was a scene response.' Rebuttal: a scene response descends, lands and departs; this profile holds a low-speed orbit without a landing."
      : "Profile is consistent with lawful air-ambulance operations; retained for baseline comparison only.";

  return { score, tier, reasons, rebuttal };
}

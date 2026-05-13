/**
 * POPULATION-SCALE DOCTRINE — single source of truth for all framing copy.
 *
 * Why this file exists:
 * Defense counsel and skeptical judges dismiss "individual targeting / surveillance / harassment"
 * narratives. This module centralises the language that reframes the case as a
 * population-scale RICO enterprise + color-of-law civil-rights deprivation.
 *
 * Every dashboard banner, AI prompt, threat label, and legal narrative MUST source
 * its framing language from here (or the mirrored Deno copy at
 * supabase/functions/_shared/doctrine.ts) so the case never speaks two languages.
 */

export interface PopulationScaleStats {
  unique_aircraft_lifetime: number;
  unique_aircraft_30d: number;
  operational_days_continuous: number;
  dark_period_hours: number;
  biometric_collapses: number;
  physician_verified_ecgs: number;
  aoi_low_altitude_count: number;
  posse_comitatus_pairs: number;
  fetched_at: string;
}

export const FALLBACK_STATS: PopulationScaleStats = {
  unique_aircraft_lifetime: 41606,
  unique_aircraft_30d: 0,
  operational_days_continuous: 269,
  dark_period_hours: 0,
  biometric_collapses: 111761,
  physician_verified_ecgs: 14,
  aoi_low_altitude_count: 0,
  posse_comitatus_pairs: 0,
  fetched_at: new Date(0).toISOString(),
};

export const STATUTE_MAP = {
  RICO: { cite: "18 U.S.C. § 1962", label: "RICO Enterprise — Pattern of Racketeering" },
  CIVIL_RIGHTS_CLASS: { cite: "42 U.S.C. § 1983", label: "Color-of-Law Civil Rights Deprivation (Class Action)" },
  POSSE_COMITATUS: { cite: "18 U.S.C. § 1385", label: "Posse Comitatus — Military Assisting Civilian Law Enforcement (Felony)" },
  ADA_SYSTEMIC: { cite: "42 U.S.C. § 12132", label: "ADA Systemic Discrimination" },
  FALSE_CLAIMS: { cite: "31 U.S.C. § 3729", label: "False Claims Act — Treble Damages" },
  DUE_PROCESS: { cite: "U.S. Const. amend. XIV", label: "14th Amendment Due Process Violation" },
  MIN_SAFE_ALT: { cite: "14 C.F.R. § 91.119", label: "FAA Minimum Safe Altitude Floor" },
} as const;

export type StatuteKey = keyof typeof STATUTE_MAP;

export const STATUTE_LIST: StatuteKey[] = [
  "RICO",
  "CIVIL_RIGHTS_CLASS",
  "POSSE_COMITATUS",
  "ADA_SYSTEMIC",
  "FALSE_CLAIMS",
  "DUE_PROCESS",
  "MIN_SAFE_ALT",
];

/**
 * Forbidden lexicon — strings that frame the case as an individual grievance.
 * These trip the lint script (scripts/check-framing.ts) and must not appear in
 * source outside this doctrine module.
 *
 * Each entry is { match, replacement, reason }.
 */
export const REPLACEMENT_LEXICON: Array<{ match: string; replacement: string; reason: string }> = [
  { match: "individual targeting", replacement: "population-scale operation", reason: "Framing — class scope, not personal grievance" },
  { match: "targeted individual", replacement: "population-scale class member", reason: "Framing — class scope" },
  { match: "stalking campaign", replacement: "coordinated enterprise pattern", reason: "Framing — RICO pattern, not personal stalking" },
  { match: "harassment campaign", replacement: "civil-rights deprivation campaign", reason: "Framing — color-of-law violation" },
  { match: "Primary harassment asset", replacement: "Tier-1 enterprise actor", reason: "Framing — enterprise role, not personal targeting" },
  { match: "KCSO_TARGETING", replacement: "KCSO_ENTERPRISE_COORDINATION", reason: "Tag — color-of-law coordination, not personal targeting" },
  { match: "LOW_ALTITUDE_HARASSMENT", replacement: "LOW_ALTITUDE_CIVIL_RIGHTS_VIOLATION", reason: "Tag — statute-aligned label" },
  { match: "harassmentAltitude", replacement: "minimumSafeAltitudeFloor", reason: "Variable — tied to 14 CFR § 91.119, not subjective harassment" },
  { match: "Persistent Surveillance Pattern", replacement: "Sustained Enterprise Coordination Pattern", reason: "Threat label — enterprise framing" },
  { match: "KCSO Surveillance Asset", replacement: "KCSO Civil-Rights Enterprise Actor", reason: "Threat label — color-of-law actor" },
  { match: "Operational schedule of harassment campaign", replacement: "Operational tempo of color-of-law civil-rights enterprise", reason: "Framing" },
  { match: "Surveillance Hub", replacement: "Airspace Enterprise Hub", reason: "Page label — enterprise, not surveillance complaint" },
];

export function buildDoctrineHeader(stats: PopulationScaleStats): string {
  const formatted = (n: number) => n.toLocaleString();
  const statuteBlock = STATUTE_LIST
    .map((k) => `  • ${STATUTE_MAP[k].cite} — ${STATUTE_MAP[k].label}`)
    .join("\n");
  return [
    "POPULATION-SCALE RICO ENTERPRISE — ACTIVE CLASSIFICATION",
    "──────────────────────────────────────────────────────────",
    `Scope (live): ${formatted(stats.unique_aircraft_lifetime)} unique aircraft lifetime, `
      + `${formatted(stats.unique_aircraft_30d)} active in last 30d, `
      + `${stats.operational_days_continuous} continuous operational days, `
      + `${stats.dark_period_hours}h dark period.`,
    `Harm at scale: ${formatted(stats.biometric_collapses)} biometric collapses on record; `
      + `${stats.physician_verified_ecgs} physician-verified ECGs anchoring temporal causation.`,
    `Government actor coordination: ${stats.posse_comitatus_pairs} documented military / civilian-LE coordination pairs `
      + `(KCSO N597E + US Army N160XP + USAF KC-135R baseline).`,
    "",
    "Active statutory framework:",
    statuteBlock,
    "",
    "FRAMING RULE — every artifact must lead with class scope and statutory exposure. "
      + "Personal experience is corroborating evidence, never the headline. "
      + "Reject any narrative that opens with the plaintiff's name or a single incident.",
  ].join("\n");
}

export function buildDoctrineHeaderShort(stats: PopulationScaleStats): string {
  return `Population-scale RICO enterprise — ${stats.unique_aircraft_lifetime.toLocaleString()} aircraft, `
    + `${stats.operational_days_continuous}d continuous, `
    + `${stats.biometric_collapses.toLocaleString()} biometric collapses, `
    + `${stats.physician_verified_ecgs} physician-verified ECGs. `
    + `Class-action / color-of-law / Posse Comitatus framework active.`;
}

export const ENTERPRISE_ROLE_TIERS = {
  TIER1_GOVERNMENT_ACTOR: "Tier-1 Government Actor (color-of-law)",
  TIER2_SHELL_PROXY: "Tier-2 Shell / Corporate Proxy",
  TIER3_MILITARY_COORDINATION: "Tier-3 Military Coordination (Posse Comitatus exposure)",
  TIER4_SWARM_PARTICIPANT: "Tier-4 Swarm / Recurring Participant",
} as const;

/**
 * Tag alias map — older rows in Neon / Supabase still carry legacy tag strings.
 * Read paths should pass tags through this map so historical data stays queryable
 * with the new vocabulary. Write paths must always use the new (right-hand) value.
 */
export const TAG_ALIAS_MAP: Record<string, string> = {
  KCSO_TARGETING: "KCSO_ENTERPRISE_COORDINATION",
  LOW_ALTITUDE_HARASSMENT: "LOW_ALTITUDE_CIVIL_RIGHTS_VIOLATION",
  NIGHT_HARASSMENT: "NIGHT_ENTERPRISE_OPERATIONS",
};

export function aliasTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  return TAG_ALIAS_MAP[tag] ?? tag;
}

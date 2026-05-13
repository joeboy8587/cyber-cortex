/**
 * POPULATION-SCALE DOCTRINE — Deno mirror of src/lib/framing/populationScaleDoctrine.ts.
 *
 * Edge functions cannot import from src/, so this file duplicates the doctrine
 * exports. Keep both in sync. The lint script enforces it.
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

export const STATUTE_LIST = [
  "RICO", "CIVIL_RIGHTS_CLASS", "POSSE_COMITATUS",
  "ADA_SYSTEMIC", "FALSE_CLAIMS", "DUE_PROCESS", "MIN_SAFE_ALT",
] as const;

export function buildDoctrineHeader(stats: PopulationScaleStats): string {
  const fmt = (n: number) => n.toLocaleString();
  const statuteBlock = STATUTE_LIST
    .map((k) => `  • ${STATUTE_MAP[k].cite} — ${STATUTE_MAP[k].label}`)
    .join("\n");
  return [
    "POPULATION-SCALE RICO ENTERPRISE — ACTIVE CLASSIFICATION",
    "──────────────────────────────────────────────────────────",
    `Scope (live): ${fmt(stats.unique_aircraft_lifetime)} unique aircraft lifetime, `
      + `${fmt(stats.unique_aircraft_30d)} active in last 30d, `
      + `${stats.operational_days_continuous} continuous operational days, `
      + `${stats.dark_period_hours}h dark period.`,
    `Harm at scale: ${fmt(stats.biometric_collapses)} biometric collapses on record; `
      + `${stats.physician_verified_ecgs} physician-verified ECGs anchoring temporal causation.`,
    `Government actor coordination: ${stats.posse_comitatus_pairs} documented military / civilian-LE pairs.`,
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

export const TAG_ALIAS_MAP: Record<string, string> = {
  KCSO_TARGETING: "KCSO_ENTERPRISE_COORDINATION",
  LOW_ALTITUDE_HARASSMENT: "LOW_ALTITUDE_CIVIL_RIGHTS_VIOLATION",
  NIGHT_HARASSMENT: "NIGHT_ENTERPRISE_OPERATIONS",
};

/**
 * Fetch live stats by invoking the population-scale-stats edge function.
 * Falls back to FALLBACK_STATS on any error so downstream prompts never crash.
 */
export async function fetchPopulationScaleStats(
  supabaseUrl: string,
  serviceKey: string,
): Promise<PopulationScaleStats> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/population-scale-stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
      body: "{}",
    });
    if (!r.ok) return FALLBACK_STATS;
    const j = await r.json();
    return (j?.stats as PopulationScaleStats) ?? FALLBACK_STATS;
  } catch {
    return FALLBACK_STATS;
  }
}

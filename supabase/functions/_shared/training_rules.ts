// Training-readiness rules. Pure, deterministic, ordered: exclude → proven → normal → unsorted.
// Labels say whether a record is safe to learn from. They never change the record itself.
export const RULE_VERSION = "TRv1";

export type Label = "proven" | "normal" | "exclude" | "unsorted";
export interface Decision { label: Label; reason_code: string; reason_text: string }

export interface FlightInput {
  icao: string | null;
  registration: string | null;
  callsign: string | null;
  ts: string;
  altitude: number | null;
  speed: number | null;
  on_ground: boolean | null;
  taxonomy_tag: string | null;
  /** how many rows in this batch share this exact timestamp (bulk-import fingerprint) */
  sameTimestampCount: number;
}
export interface Context {
  watchlist: Set<string>;      // upper-case registrations / hex codes
  provenSubjects: Set<string>; // upper-case registrations / hex codes from confirmed facts & exhibits
  unsourcedHex: Set<string>;   // known test / sample codes with no source (e.g. A0B312)
  faaMatched: Set<string>;     // registrations found in the FAA registry
}

const COLUMN_NAMES = new Set(["ICAO", "ICAO24", "ICAO_CODE", "REGISTRATION", "CALLSIGN", "NULL", "UNDEFINED", "HEX"]);
export const BULK_TIMESTAMP_THRESHOLD = 50;
export const GROUND_SPEED_KTS = 30;

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export function classifyFlight(r: FlightInput, ctx: Context): Decision {
  const icao = up(r.icao), reg = up(r.registration), cs = up(r.callsign);
  const keys = [icao, reg].filter(Boolean);

  // 1. Don't use
  if (COLUMN_NAMES.has(icao) || COLUMN_NAMES.has(reg) || COLUMN_NAMES.has(cs))
    return { label: "exclude", reason_code: "DAMAGED_IMPORT_COLUMN_NAME", reason_text: "Damaged import: a column name is stored as a value." };
  if (r.sameTimestampCount >= BULK_TIMESTAMP_THRESHOLD)
    return { label: "exclude", reason_code: "DAMAGED_IMPORT_SAME_TIMESTAMP", reason_text: `Damaged import: ${r.sameTimestampCount} rows share the exact same time.` };
  if (icao && ctx.unsourcedHex.has(icao))
    return { label: "exclude", reason_code: "UNSOURCED_TEST_CODE", reason_text: `Code ${icao} has no source in any record (likely a test/sample entry).` };
  if (!icao && !reg)
    return { label: "exclude", reason_code: "NO_IDENTITY", reason_text: "No aircraft code or tail number." };
  // XXB (MLAT) is legitimate — never excluded for being XXB.

  const watch = keys.some(k => ctx.watchlist.has(k));

  // 2. Proven
  const proven = keys.find(k => ctx.provenSubjects.has(k));
  if (proven) return { label: "proven", reason_code: "CONFIRMED_FACT", reason_text: `${proven} is tied to a confirmed fact or exhibit.` };
  if (reg && ctx.faaMatched.has(reg) && watch)
    return { label: "proven", reason_code: "FAA_VERIFIED_WATCHLIST", reason_text: `${reg} identity matches the FAA registry (watchlist airframe).` };

  // 3. Normal — never for a watchlist airframe
  if (!watch) {
    if (r.taxonomy_tag === "normal_traffic")
      return { label: "normal", reason_code: "NORMAL_TRAFFIC", reason_text: "Routine airline/airport traffic (already filtered from threat metrics)." };
    if (r.on_ground === true && (r.speed ?? 0) < GROUND_SPEED_KTS)
      return { label: "normal", reason_code: "GROUND_TAXI", reason_text: "Parked or taxiing on the ground." };
  }

  // 4. Not yet sorted
  return {
    label: "unsorted",
    reason_code: watch ? "WATCHLIST_NEEDS_REVIEW" : "NEEDS_REVIEW",
    reason_text: watch ? "Watchlist airframe — never auto-labeled normal; needs review." : "No rule applied yet; kept for review.",
  };
}

export interface PolicyFlagInput { rule_code: string; evidence: Record<string, unknown> | null; altitude_ft: number | null }
const ALT_RULES = /^(B-401|FAR-91\.119|91\.119|HOVER|ALT-LOW|LOW-ALT)/i;

export function classifyPolicyFlag(f: PolicyFlagInput): Decision {
  const ev = f.evidence ?? {};
  const isAltitudeRule = ALT_RULES.test(f.rule_code) || (f.altitude_ft != null && !f.rule_code.startsWith("ALT-SUP"));
  if (isAltitudeRule && !("agl" in ev) && !("method" in ev))
    return { label: "exclude", reason_code: "PRE_AGL_ALTITUDE_FLAG", reason_text: "Altitude flag made before the ground-height fix (raw sea-level reading)." };
  return { label: "unsorted", reason_code: "LEAD_NEEDS_REVIEW", reason_text: "Lead — not proof until reviewed." };
}

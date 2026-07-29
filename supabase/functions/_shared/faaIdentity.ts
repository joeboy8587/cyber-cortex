// ============================================================================
// FAA MASTER IDENTITY RESOLVER
// Authoritative operator/aircraft identification from the full FAA registry
// (`faa_master` + `faa_aircraft_ref`). Feed-supplied "ownOp" strings and
// registration-prefix heuristics are NOT evidence — they are hints. This module
// is the single source of truth used by every ingest path.
// ============================================================================

export interface FaaIdentity {
  nNumber: string;              // with leading N (e.g. N597E)
  modeSHex: string | null;      // uppercase FAA-assigned hex
  registrantName: string | null;
  registrantType: string | null; // decoded (LLC, Government, Corporation, ...)
  city: string | null;
  state: string | null;
  country: string | null;
  manufacturer: string | null;
  model: string | null;
  typeAircraft: string | null;
  yearManufactured: number | null;
  statusCode: string | null;
}

const REGISTRANT_TYPES: Record<string, string> = {
  '1': 'Individual',
  '2': 'Partnership',
  '3': 'Corporation',
  '4': 'Co-Owned',
  '5': 'Government',
  '7': 'LLC',
  '8': 'Non-Citizen Corporation',
  '9': 'Non-Citizen Co-Owned',
};

/** FAA master stores N-numbers without the leading "N". */
export function faaKeyFromRegistration(reg?: string | null): string | null {
  const r = String(reg || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!r || r.startsWith('XXB') || r === 'UNKNOWN' || r === 'NA') return null;
  const key = r.startsWith('N') ? r.slice(1) : r;
  return /^[0-9][A-Z0-9]{0,4}$/.test(key) ? key : null;
}

export function normalizeHex(hex?: string | null): string | null {
  const h = String(hex || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return h.length === 6 ? h : null;
}

export interface IdentityLookupInput {
  registration?: string | null;
  hex?: string | null;
}

export interface ResolvedIdentityMap {
  byNNumber: Map<string, FaaIdentity>; // key: N-number WITH prefix
  byHex: Map<string, FaaIdentity>;     // key: uppercase 6-char hex
}

/**
 * Bulk-resolve identities against the FAA master registry.
 * Uses the indexed raw columns (n_number, mode_s_code_hex) so it stays fast
 * even for a few hundred live contacts.
 */
export async function resolveFaaIdentities(
  // deno-lint-ignore no-explicit-any
  sql: any,
  items: IdentityLookupInput[],
): Promise<ResolvedIdentityMap> {
  const byNNumber = new Map<string, FaaIdentity>();
  const byHex = new Map<string, FaaIdentity>();

  const regKeys = new Set<string>();
  const hexKeys = new Set<string>();
  for (const it of items) {
    const rk = faaKeyFromRegistration(it.registration);
    if (rk) regKeys.add(rk);
    const hk = normalizeHex(it.hex);
    if (hk) { hexKeys.add(hk); hexKeys.add(hk.toLowerCase()); }
  }
  if (regKeys.size === 0 && hexKeys.size === 0) return { byNNumber, byHex };

  const rows = await sql`
    SELECT
      m.n_number,
      UPPER(m.mode_s_code_hex)  AS hex,
      NULLIF(TRIM(m.name), '')  AS name,
      m.type_registrant,
      NULLIF(TRIM(m.city), '')  AS city,
      NULLIF(TRIM(m.state), '') AS state,
      NULLIF(TRIM(m.country), '') AS country,
      NULLIF(TRIM(m.year_mfr), '') AS year_mfr,
      m.status_code,
      m.type_aircraft,
      NULLIF(TRIM(r.mfr), '')   AS mfr,
      NULLIF(TRIM(r.model), '') AS model
    FROM faa_master m
    LEFT JOIN faa_aircraft_ref r ON r.code = m.mfr_mdl_code
    WHERE m.n_number = ANY(${[...regKeys]})
       OR m.mode_s_code_hex = ANY(${[...hexKeys]})
  `;

  for (const r of rows) {
    const identity: FaaIdentity = {
      nNumber: `N${String(r.n_number || '').trim().toUpperCase()}`,
      modeSHex: r.hex || null,
      registrantName: r.name || null,
      registrantType: REGISTRANT_TYPES[String(r.type_registrant || '').trim()] || null,
      city: r.city || null,
      state: r.state || null,
      country: r.country || null,
      manufacturer: r.mfr || null,
      model: r.model || null,
      typeAircraft: r.type_aircraft || null,
      yearManufactured: r.year_mfr ? Number(r.year_mfr) || null : null,
      statusCode: r.status_code ? String(r.status_code).trim() : null,
    };
    byNNumber.set(identity.nNumber, identity);
    if (identity.modeSHex) byHex.set(identity.modeSHex, identity);
  }

  return { byNNumber, byHex };
}

export interface IdentityDecision {
  ownerOperator: string;
  aircraftType: string;
  aircraftTypeDesc: string;
  yearManufactured: number | null;
  /** faa_master | faa_master_hex | feed | unresolved */
  identitySource: string;
  /** feed operator disagreed with the FAA registrant */
  operatorMismatch: boolean;
  /** ADS-B hex does not match the FAA-assigned Mode-S hex for this N-number */
  hexMismatch: boolean;
  identity: FaaIdentity | null;
}

/**
 * Decide the authoritative operator for a single contact.
 * FAA master always wins; the feed value is only kept when the registry has no
 * record (foreign / military / unregistered airframes).
 */
export function decideIdentity(
  map: ResolvedIdentityMap,
  contact: { registration?: string | null; hex?: string | null; ownOp?: string | null; aircraftType?: string | null; aircraftTypeDesc?: string | null; yearManufactured?: number | null },
): IdentityDecision {
  const feedOwnOp = String(contact.ownOp || '').trim();
  const regKey = faaKeyFromRegistration(contact.registration);
  const hexKey = normalizeHex(contact.hex);

  let identity: FaaIdentity | null = null;
  let source = 'unresolved';
  if (regKey && map.byNNumber.has(`N${regKey}`)) {
    identity = map.byNNumber.get(`N${regKey}`)!;
    source = 'faa_master';
  } else if (hexKey && map.byHex.has(hexKey)) {
    identity = map.byHex.get(hexKey)!;
    source = 'faa_master_hex';
  }

  if (!identity) {
    return {
      ownerOperator: feedOwnOp,
      aircraftType: contact.aircraftType || '',
      aircraftTypeDesc: contact.aircraftTypeDesc || '',
      yearManufactured: contact.yearManufactured ?? null,
      identitySource: feedOwnOp ? 'feed' : 'unresolved',
      operatorMismatch: false,
      hexMismatch: false,
      identity: null,
    };
  }

  const faaName = identity.registrantName || '';
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const operatorMismatch = Boolean(
    feedOwnOp && faaName && !norm(faaName).includes(norm(feedOwnOp)) && !norm(feedOwnOp).includes(norm(faaName)),
  );
  const hexMismatch = Boolean(hexKey && identity.modeSHex && hexKey !== identity.modeSHex);

  const model = [identity.manufacturer, identity.model].filter(Boolean).join(' ');

  return {
    ownerOperator: faaName || feedOwnOp,
    aircraftType: contact.aircraftType || identity.model || '',
    aircraftTypeDesc: model || contact.aircraftTypeDesc || '',
    yearManufactured: identity.yearManufactured ?? contact.yearManufactured ?? null,
    identitySource: source,
    operatorMismatch,
    hexMismatch,
    identity,
  };
}

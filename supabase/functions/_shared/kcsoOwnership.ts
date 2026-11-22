import { scanRead } from './scanSupport.ts';
import { type FleetIdentity } from './kcsoOwnershipRules.ts';

export const FLEET_IDENTITY_QUERY = `
  WITH candidates AS (
    SELECT UPPER(TRIM(tail_number)) AS registration, true AS listed_in_fleet
    FROM public.kcso_fleet WHERE tail_number IS NOT NULL
    UNION ALL
    SELECT UNNEST($1::text[]) AS registration, false AS listed_in_fleet
  ), distinct_candidates AS (
    SELECT registration, BOOL_OR(listed_in_fleet) AS listed_in_fleet
    FROM candidates GROUP BY registration
  )
  SELECT c.registration, c.listed_in_fleet, f.name AS registrant_name,
    f.mode_s_code_hex AS faa_hex,
    CASE WHEN f.n_number IS NOT NULL THEN 'CURRENT_RELEASE' ELSE 'PUBLIC_REGISTRY_UNAVAILABLE' END AS registry_record_scope,
    '2026-10-21' AS registry_release_date
  FROM distinct_candidates c
  LEFT JOIN faa_registry_20261021.master_staging f
    ON f.n_number = REGEXP_REPLACE(c.registration, '^N', '')
  ORDER BY c.registration LIMIT 1000`;

export async function loadFleetIdentities(registrations: string[] = []) {
  const rows = await scanRead(FLEET_IDENTITY_QUERY, [registrations]);
  if (rows.length >= 1000) throw new Error('Fleet identity list exceeded its limit; ownership checks are incomplete');
  return rows as FleetIdentity[];
}
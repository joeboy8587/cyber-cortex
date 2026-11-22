export type FleetIdentity = {
  registration: string;
  listed_in_fleet: boolean;
  registrant_name: string | null;
  faa_hex: string | null;
  registry_record_scope: string;
  registry_release_date: string;
};

export function isKcsoRegistrant(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const normalized = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return ['KERN COUNTY SHERIFFS OFFICE', 'KERN COUNTY SHERIFFS DEPARTMENT', 'KERN COUNTY SHERIFF', 'KERN CO SHERIFFS OFFICE'].includes(normalized);
}

export function hasCurrentKcsoOwnership(row: FleetIdentity): boolean {
  return row.registry_record_scope === 'CURRENT_RELEASE' && isKcsoRegistrant(row.registrant_name);
}

export function fleetOwnershipStatus(row: FleetIdentity) {
  if (hasCurrentKcsoOwnership(row)) return 'FAA_CONFIRMED_KCSO';
  if (row.registry_record_scope !== 'CURRENT_RELEASE' || !row.registrant_name) return 'CURRENT_IDENTITY_UNAVAILABLE';
  if (['COUNTY OF KERN', 'KERN COUNTY'].includes(row.registrant_name.toUpperCase().trim())) return 'KERN_COUNTY_REGISTRANT_OPERATOR_CHECK';
  return row.listed_in_fleet ? 'FLEET_LIST_IDENTITY_CONFLICT' : 'OTHER_CURRENT_REGISTRANT';
}
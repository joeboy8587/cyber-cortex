import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { hasCurrentKcsoOwnership, fleetOwnershipStatus, type FleetIdentity } from './kcsoOwnershipRules.ts';

const row = (registration: string, registrant_name: string | null, listed_in_fleet = true): FleetIdentity => ({
  registration, registrant_name, listed_in_fleet, faa_hex: null,
  registry_record_scope: 'CURRENT_RELEASE', registry_release_date: '2026-10-21',
});
test('N912KC current sheriff registrant confirms ownership', () => {
  assert.equal(hasCurrentKcsoOwnership(row('N912KC', 'KERN COUNTY SHERIFFS OFFICE')), true);
});
test('N528AM fleet membership cannot override Air Methods identity', () => {
  const identity = row('N528AM', 'AIR METHODS LLC');
  assert.equal(hasCurrentKcsoOwnership(identity), false);
  assert.equal(fleetOwnershipStatus(identity), 'FLEET_LIST_IDENTITY_CONFLICT');
});
test('N788FA fleet membership cannot override AB Prop Plane identity', () => {
  assert.equal(hasCurrentKcsoOwnership(row('N788FA', 'AB PROP PLANE II LLC')), false);
});
test('N140UD is not sheriff owned or a fleet-list member', () => {
  assert.equal(fleetOwnershipStatus(row('N140UD', 'AB PROP PLANE II LLC', false)), 'OTHER_CURRENT_REGISTRANT');
});
test('historical sheriff identity cannot confirm current ownership', () => {
  assert.equal(hasCurrentKcsoOwnership({ ...row('N912KC', 'KERN COUNTY SHERIFFS OFFICE'), registry_record_scope: 'HISTORICAL_ONLY' }), false);
});
test('missing identity remains unknown even for a KC registration in the fleet list', () => {
  const identity = { ...row('N913KC', null), registry_record_scope: 'PUBLIC_REGISTRY_UNAVAILABLE' };
  assert.equal(hasCurrentKcsoOwnership(identity), false);
  assert.equal(fleetOwnershipStatus(identity), 'CURRENT_IDENTITY_UNAVAILABLE');
});
test('sheriff department spelling confirms N497E and N97E without a fleet shortcut', () => {
  assert.equal(hasCurrentKcsoOwnership(row('N497E', 'KERN COUNTY SHERIFFS DEPARTMENT')), true);
  assert.equal(hasCurrentKcsoOwnership(row('N97E', 'KERN COUNTY SHERIFFS DEPARTMENT')), true);
});
test('N597E county registrant is not a conflict or sheriff-operator confirmation', () => {
  const identity = row('N597E', 'COUNTY OF KERN');
  assert.equal(fleetOwnershipStatus(identity), 'KERN_COUNTY_REGISTRANT_OPERATOR_CHECK');
  assert.equal(hasCurrentKcsoOwnership(identity), false);
});
import { behavioralFactors, hasBehavioralBasis } from './sentinel_reasons.ts';
function assert(value: boolean) { if (!value) throw new Error('Assertion failed'); }
Deno.test('registration and watchlist membership alone never justify raising an aircraft', () => {
  assert(!hasBehavioralBasis(['holding/leasing registrant', 'watchlist airframe'], ['SHELL_COMPANY', 'REPEAT_OFFENDER']));
});
Deno.test('multiple observed current behaviors support attention', () => {
  assert(hasBehavioralBasis(['tight orbit (720° of turning)', '22 min over the area', 'watchlist airframe'], []));
  assert(behavioralFactors(['watchlist airframe', '22 min over the area']).length === 1);
});
Deno.test('distinct historical behavioral patterns support attention over time', () => {
  assert(hasBehavioralBasis(['watchlist airframe'], ['TIGHT_ORBIT', 'ALTITUDE_SUPPRESSION']));
});
Deno.test('repeated copies of one historical pattern are not multiple factors', () => {
  assert(!hasBehavioralBasis(['holding/leasing registrant'], ['TIGHT_ORBIT', 'PERSISTENT_LOITER']));
});
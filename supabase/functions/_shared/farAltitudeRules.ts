// Source-checked 2026-11-22: https://www.ecfr.gov/current/title-14/section-91.119
// Threshold findings are operational leads, not automatic legal determinations.
export function altitudeRule(agl: number | null, margin: number, nearResidence: boolean, aircraftType?: string | null) {
  if (agl == null) return { status: 'unknown', citation: null, threshold: null };
  const threshold = nearResidence ? 1000 : 500;
  const status = agl + margin < threshold ? 'below' : agl - margin < threshold ? 'borderline' : 'clear';
  return { status, threshold,
    citation: status === 'below' ? (aircraftType === '6' ? '14 CFR 91.119(d)(1)' : nearResidence ? '14 CFR 91.119(b)' : '14 CFR 91.119(c)') : null };
}
export const FAR_REVIEW = [
  { section: '91.119', url: 'https://www.ecfr.gov/current/title-14/section-91.119', scope: 'Altitude: (b) 1,000 ft above the highest obstacle within 2,000 ft horizontally; (c) 500 ft above surface with open-water/sparse-area separation provisions; (d) helicopter and other aircraft provisions; takeoff/landing necessity applies.' },
  { section: '91.13', url: 'https://www.ecfr.gov/current/title-14/section-91.13', scope: 'Endangerment evidence required; never added by counting other citations.' },
  { section: '91.117', url: 'https://www.ecfr.gov/current/title-14/section-91.117', scope: 'Indicated airspeed and airspace required; ADS-B ground speed alone is not a speed violation.' },
  { section: '91.155', url: 'https://www.ecfr.gov/current/title-14/section-91.155', scope: 'Visibility, cloud clearance and flight/airspace context required.' },
  { section: '91.209', url: 'https://www.ecfr.gov/current/title-14/section-91.209', scope: 'Lighting evidence and applicable sunset/sunrise required; nighttime presence alone is not a lighting violation.' },
];
export const FAR_ALTITUDE_TEXT: Record<string, string> = {
  '14 CFR 91.119(b)': 'Over any congested area of a city, town, or settlement, or over any open air assembly of persons, an altitude of 1,000 feet above the highest obstacle within a horizontal radius of 2,000 feet of the aircraft.',
  '14 CFR 91.119(c)': 'Over other than congested areas, an altitude of 500 feet above the surface, except over open water or sparsely populated areas. In those cases, the aircraft may not be operated closer than 500 feet to any person, vessel, vehicle, or structure.',
  '14 CFR 91.119(d)(1)': 'If the operation is conducted without hazard to persons or property on the surface, a helicopter may be operated at less than the minimums prescribed in paragraph (b) or (c), provided each person operating it complies with routes or altitudes specifically prescribed by the FAA.',
};

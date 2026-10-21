export interface AircraftReasons {
  registration: string;
  current: string[];
  historical: Array<{ description: string; observed_at: string | null; source: string }>;
  context: string[];
  history_status: 'available' | 'not_found' | 'unavailable';
}

/** Identity and list membership cannot serve as independent behavioral evidence. */
export function behavioralFactors(factors: string[]): string[] {
  return factors.filter(f => !/holding\/leasing registrant|watchlist airframe/i.test(f));
}

export function behavioralCategory(type: string): string | null {
  if (/orbit|loiter|holding_pattern/i.test(type)) return 'orbit';
  if (/bimodal/i.test(type)) return 'bimodal';
  if (/altitude|suppression/i.test(type)) return 'altitude';
  if (/convergence|coordination|co.presence/i.test(type)) return 'coordination';
  if (/dwell|persistent_presence/i.test(type)) return 'dwell';
  if (/night/i.test(type)) return 'night';
  if (/physics|kinematic|speed/i.test(type)) return 'physics';
  return null;
}

export function hasBehavioralBasis(current: string[], historyTypes: string[]): boolean {
  const categories = new Set(historyTypes.map(behavioralCategory).filter(Boolean));
  return behavioralFactors(current).length >= 2 || categories.size >= 2;
}
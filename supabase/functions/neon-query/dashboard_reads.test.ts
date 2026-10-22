import { describe, expect, test } from 'bun:test';
import { DASHBOARD_READ_ACTIONS, DASHBOARD_STATEMENT_TIMEOUT_MS, RECENT_DETECTIONS_CTE, dashboardReadScope } from './dashboard_reads';

describe('bounded dashboard reads', () => {
  test('all four reported actions receive a real statement timeout', () => {
    for (const action of ['getTaxonomy', 'taxonomyStats', 'getBehavioralAlignment', 'getMilitaryGovBehavioralAlignment']) {
      expect(DASHBOARD_READ_ACTIONS.has(action)).toBe(true);
    }
    expect(DASHBOARD_STATEMENT_TIMEOUT_MS).toBe(18000);
  });
  test('recent reads declare their complete 30-day scope without sampling', () => {
    expect(RECENT_DETECTIONS_CTE).toContain("WHERE detection_timestamp >= NOW() - INTERVAL '30 days'");
    expect(RECENT_DETECTIONS_CTE).not.toMatch(/LIMIT|TABLESAMPLE/i);
    expect(dashboardReadScope()).toEqual({ windowDays: 30, timestampField: 'detection_timestamp', sampled: false });
  });
});
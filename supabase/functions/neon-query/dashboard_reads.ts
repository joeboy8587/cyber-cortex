// Dashboard reads use complete recent windows, never sampled evidence totals.
export const DASHBOARD_WINDOW_DAYS = 30;
export const DASHBOARD_STATEMENT_TIMEOUT_MS = 18000;
export const DASHBOARD_READ_ACTIONS = new Set([
  'getTaxonomy', 'taxonomyStats', 'getBehavioralAlignment', 'getMilitaryGovBehavioralAlignment',
]);
export const RECENT_DETECTIONS_CTE = `recent_detections AS MATERIALIZED (
  SELECT registration, callsign, taxonomy_tag, flagged, altitude, speed,
    detection_timestamp, created_at
  FROM live_flight_detections_rows
  WHERE detection_timestamp >= NOW() - INTERVAL '${DASHBOARD_WINDOW_DAYS} days'
)`;
export function dashboardReadScope() {
  return { windowDays: DASHBOARD_WINDOW_DAYS, timestampField: 'detection_timestamp', sampled: false };
}
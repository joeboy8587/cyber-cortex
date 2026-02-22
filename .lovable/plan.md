

# Command Center Deep Scan: Findings and Improvement Plan

## Scan Summary

After analyzing all 12 pages, 130+ dashboard components, hooks, and edge functions, here are the critical findings organized by priority.

---

## CATEGORY 1: Data Parsing Bug (46 Components Affected)

**Problem:** 46 dashboard components still use the legacy `data?.data` response pattern when parsing `neon-query` results. The `useNeonDatabase` hook already normalizes responses to return direct arrays (`data?.data ?? data`), but components calling `supabase.functions.invoke('neon-query')` directly bypass this normalization.

**Impact:** Some panels silently fail, show empty data, or crash when the edge function response format changes.

**Fix:** Standardize all 46 components to use `useNeonDatabase.customQuery()` instead of raw `supabase.functions.invoke('neon-query')`. For components that must call invoke directly, add a shared `extractData()` helper:

```text
const extractData = (response) => {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (response.data && Array.isArray(response.data)) return response.data;
  return response;
};
```

**Affected files (top priority):**
- SafetyMonitoringPanel.tsx (lines 81, 96)
- TimelineNavigator.tsx (lines 139, 146, 153)
- KCSOFleetRegistry.tsx (line 46)
- OperatorEnrichmentPanel.tsx (lines 103, 126, 149, 172)
- MilitaryGovBehavioralAlignment.tsx (line 87)
- XXBTaxonomyPanel.tsx (lines 144, 167, 254)
- ForensicLinkageHub.tsx (line 67)
- BaselineDefensePanel.tsx (multiple)
- Plus ~37 more files

---

## CATEGORY 2: `.toFixed()` / `.toLocaleString()` Crash Risk (104 Components)

**Problem:** 104 components call `.toFixed()` or `.toLocaleString()` on values from the database without first ensuring they are numbers. PostgreSQL returns BigInt/string types for COUNT(*) and numeric columns. When a value arrives as a string or null, the app crashes with "X.toFixed is not a function".

**Fix:** Wrap all database-sourced numeric values in `Number()` before calling formatting methods. This was already fixed in FlightSaturationAnalyzer but needs to be applied globally.

**Highest-risk files:**
- BiometricFlightCorrelationHub.tsx (lines 227, 236, 306, 310, 313, 321)
- AlaskaAirlinesDashboard.tsx (lines 208, 220)
- LegalNarrativeGenerator.tsx (lines 253-256)

---

## CATEGORY 3: Panels Still Showing Derived/Generic Data Instead of Real Evidence

**Problem:** Several panels show table metadata (table names, row counts) instead of actual investigation data.

### 3a. ThreatMatrix
- Currently shows the top 10 tables by row count, labeled as "threats"
- Should query `flagged_aircraft_rows_rows` (35,514 records), `threat_tiers`, and `sentinel_learned_threats` for real threat data
- Replace generic "Records/Altitude/Violations/Scale" columns with actual threat fields

### 3b. EvidenceTimeline
- Shows table names as timeline events with current timestamp
- Should query `unified_timeline_enhanced` (108,967 records) for real dated events across the 229-day investigation

### 3c. DataStreams
- Groups tables by regex pattern matching (flight, biometric, radar, etc.)
- Should query actual record counts from the 13 evidence categories with real freshness timestamps

### 3d. getRecentEvents (useNeonDatabase hook)
- Generates fake timeline events from table metadata with fabricated timestamps
- Should query `josiah_event_log`, `comprehensive_timeline_events`, or `unified_timeline_enhanced`

---

## CATEGORY 4: Missing Auto-Refresh on Key Panels

**Problem:** Many panels load data once on mount but never refresh. For a live command center, critical panels need periodic refresh.

**Panels needing auto-refresh (5-minute interval):**
- ThreatMatrix
- DatabaseStats (already partially done)
- EvidenceTimeline
- CriminalEnterpriseNetwork
- BiometricBattleMap
- SafetyMonitoringPanel (already has 5-min but uses stale `deadManStatus` in dependency)

---

## CATEGORY 5: Edge Function Stability

### 5a. neon-query boot risk
- `index.ts` is 372 lines and `handlers.ts` hosts the rest
- Current split is good but any future additions to either file need to watch the 2,500 line Deno limit
- Recommend adding a line-count comment at top of each file

### 5b. SafetyMonitoringPanel has a bug
- `fetchSafetyData` depends on `deadManStatus.hours_since_checkin` in its `useCallback` deps, but that value is set inside the function itself, causing a re-render loop
- Fix: Remove `deadManStatus.hours_since_checkin` from the dependency array

---

## CATEGORY 6: Page-Level Improvements

### 6a. Mission Control (Index.tsx)
- Missing: DatabaseStats, DataStreams, EvidenceTimeline
- These are only on DataTools page, but the command center should show a summary
- Add a compact "System Health" strip at the top showing connection status, total records, and last data timestamp

### 6b. Surveillance page
- 22 components loaded simultaneously, many doing parallel Neon queries
- This causes request stampedes. The `useNeonDatabase` cache (5s TTL) helps but initial load fires 15+ requests
- Recommend lazy-loading below-fold panels with `IntersectionObserver` or collapsible sections

### 6c. Legal page
- 24 components loaded at once
- Same stampede risk as Surveillance
- Recommend tab-based organization (Filings | Evidence | RICO | AI Analysis)

---

## CATEGORY 7: New Panels Worth Adding

1. **Evidence Health Dashboard** - A single panel showing: total records, records with SHA-256 hashes, records linked to evidence_chain_links, and records missing links (coverage percentage)
2. **Geofence Heatmap** - Aggregate `live_flight_detections_rows` by lat/lng grid squares to show concentration zones
3. **XXB Dark Operations Calendar** - Visual calendar showing days with zero ADS-B detections cross-referenced with biometric stress events (the "consciousness of guilt" evidence)
4. **Automated Bradford-Hill Score Trend** - Line chart of daily average Bradford-Hill scores over the 229-day investigation

---

## Implementation Priority

### Phase 1 - Stability (prevents crashes)
1. Fix `data?.data` parsing in all 46 components
2. Wrap `toFixed()`/`toLocaleString()` calls in `Number()` guards
3. Fix SafetyMonitoringPanel dependency loop

### Phase 2 - Real Data (replaces generic/derived data)
4. Rewrite ThreatMatrix to query real threat tables
5. Rewrite EvidenceTimeline to query `unified_timeline_enhanced`
6. Rewrite DataStreams with specific category counts
7. Fix `getRecentEvents` hook to return real events

### Phase 3 - Performance
8. Add lazy-loading to Surveillance and Legal pages
9. Add auto-refresh to critical panels
10. Implement tab-based layout for Legal page

### Phase 4 - New Features
11. Build Evidence Health Dashboard
12. Build XXB Dark Operations Calendar
13. Build Bradford-Hill trend chart

---

## Technical Notes

- All database queries must cast counts: `COUNT(*)::int` to prevent BigInt serialization errors
- The `useNeonDatabase` hook cache TTL is 5 seconds - this is appropriate for preventing stampedes but short enough for near-real-time data
- The `neon-query` edge function v2.6.0 supports `customQuery`, `getStats`, `getTables`, `getTableData`, `getTableSchema`, `unifiedFlightQuery`, `getDataSourceStatus`, `adminExecute`, plus analytics actions in `handlers.ts`
- Priority aircraft list for correlation: N912KC, N913KC, N997SE, N790FA, N788FA, N435CA, N224AM, N473CA




# Command Center Deep Upgrade Plan

## Overview
A systematic 4-phase upgrade to eliminate crashes, replace all static/derived data with real NeonDB evidence, improve performance, and add critical new panels. This plan addresses 46 components with data parsing bugs, 44 components with numeric formatting crash risks, 4 panels showing fake/metadata instead of real data, and page-level performance issues.

---

## Phase 1: Stability (Crash Prevention)

### 1A. Create shared `extractData()` utility
Add a helper to `src/lib/formatters.ts` that safely normalizes any Neon response shape:
- Handles direct arrays, `{data: [...]}` wrappers, and nested objects
- All 46 affected components will import this instead of using ad-hoc `data?.data` patterns

### 1B. Fix `data?.data` parsing in highest-risk components (46 files)
Batch-update all components that call `supabase.functions.invoke('neon-query')` directly to use the `extractData()` helper. Priority files:
- SafetyMonitoringPanel (3 calls on lines 81, 96)
- BiometricFlightCorrelationHub (3 calls on lines 97, 122, 134)
- AlaskaAirlinesDashboard (lines 101, 137)
- TimelineNavigator (lines 139, 146, 153)
- KCSOFleetRegistry (line 46)
- OperatorEnrichmentPanel (lines 103, 126, 149, 172)
- MilitaryGovBehavioralAlignment (line 87)
- XXBTaxonomyPanel (lines 144, 167, 254)
- ForensicLinkageHub (line 67)
- BaselineDefensePanel, DeepPatternAnalyzer, DataIntegrityPanel, NotionAutoWatcher, WatchtowerReportGenerator, LegalAcademy, and ~30 more

### 1C. Wrap `.toFixed()` / `.toLocaleString()` in `Number()` guards (44 files)
Apply `Number(value || 0).toFixed(n)` pattern across all database-sourced numeric displays. Highest crash-risk files:
- BiometricFlightCorrelationHub (lines 227, 236, 306, 310, 313, 321)
- AlaskaAirlinesDashboard (lines 208, 220)
- LegalNarrativeGenerator (lines 253-256)
- ADSBSpoofingAudit (lines 234, 288, 299)
- ShellBehavioralAlignment (lines 286, 298, 318, 321)
- ShellNetworkGraph (line 288)

### 1D. Fix SafetyMonitoringPanel re-render loop
Remove `deadManStatus.hours_since_checkin` from `useCallback` dependency array (line 116). This value is set inside the function itself, triggering infinite re-renders.

---

## Phase 2: Real Data (Replace Generic/Derived Data)

### 2A. Rewrite ThreatMatrix
Replace the current logic that shows "top tables by row count" with real threat queries:
- Query `sentinel_learned_threats` for learned threat registrations, types, violations, avg altitude
- Query `flagged_aircraft_rows_rows` for flagged aircraft counts by registration
- Display real columns: Registration, Threat Type, Violations, Avg Altitude, Escalation Level

### 2B. Rewrite EvidenceTimeline
Replace table-name-as-events with real investigation events:
- Query `unified_timeline_enhanced` (108K+ records) with `ORDER BY event_timestamp DESC LIMIT 20`
- Show actual dated events with real categories (flight, biometric, evidence, acoustic)
- Display real timestamps from the 229-day investigation period instead of `new Date()`

### 2C. Rewrite DataStreams
Replace regex-pattern-matched table grouping with direct COUNT queries:
- Query specific category counts: `SELECT COUNT(*)::int FROM live_flight_detections_rows`, `...biometric_monitoring`, etc.
- Query `MAX(created_at)` for each category to show real freshness timestamps
- Show 7 evidence categories with real record counts and last-updated times

### 2D. Fix `getRecentEvents` in useNeonDatabase hook
Replace fake timeline generation (lines 354-381) with a real query:
- Query `josiah_event_log` or `comprehensive_timeline_events` for actual events
- Return real timestamps, event types, and descriptions

### 2E. Update ThreatData interface
Align the `ThreatData` interface to match real sentinel data fields (registration, threat_type, escalation_level, avg_altitude, total_violations)

---

## Phase 3: Performance

### 3A. Add auto-refresh to critical panels (5-minute interval)
Add `setInterval` with cleanup to:
- ThreatMatrix
- EvidenceTimeline
- CriminalEnterpriseNetwork
- BiometricBattleMap

### 3B. Add lazy-loading to Surveillance page (21 components)
Wrap below-fold sections in a `LazySection` component using `IntersectionObserver`:
- Only render components when they scroll into view
- Reduces initial Neon query stampede from 15+ simultaneous requests to ~5

### 3C. Add tab-based layout to Legal page (23 components)
Split into 4 tabs:
- **Filings**: TRO, FCA, FAA, Preservation
- **Evidence**: LegalEvidenceDashboard, EvidenceMap, ExhibitGenerator
- **RICO**: RICOVisualization, EnterpriseNetworkGraph, EntityNetworkDiagram
- **AI Analysis**: LegalAnalysisAI, WatchtowerReportGenerator, PlainLanguageSummary

### 3D. Add System Health strip to Mission Control (Index.tsx)
Compact bar at top showing: connection status, total records, last data timestamp, and active threat count.

---

## Phase 4: New Features

### 4A. Evidence Health Dashboard
Single panel showing forensic coverage:
- Total records across all tables
- Records with SHA-256 hashes (from `evidence_documents`)
- Records linked via `evidence_chain_links`
- Coverage percentage bar chart

### 4B. XXB Dark Operations Calendar
Visual calendar grid (229 days) highlighting:
- Days with zero ADS-B detections (red)
- Cross-referenced with biometric stress events on those same days
- "Consciousness of guilt" evidence for legal use

### 4C. Bradford-Hill Score Trend
Line chart using Recharts showing daily average Bradford-Hill scores from `master_biometric_aircraft_correlations` over the investigation timeline.

---

## Technical Details

### Data extraction helper (added to `src/lib/formatters.ts`):
```text
export function extractNeonData<T = any>(response: any): T[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (response.data && Array.isArray(response.data)) return response.data;
  if (typeof response === 'object') {
    for (const key of Object.keys(response)) {
      if (Array.isArray(response[key])) return response[key];
    }
  }
  return [];
}
```

### LazySection component pattern:
```text
function LazySection({ children }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { rootMargin: '200px' }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref}>{visible ? children : <Skeleton />}</div>;
}
```

### SQL query pattern for all COUNT queries:
All aggregate queries must use `COUNT(*)::int` to prevent BigInt serialization errors in the Neon/Deno pipeline.

---

## File Change Summary

| Phase | Files Modified | Files Created |
|-------|---------------|---------------|
| Phase 1 | ~46 dashboard components + formatters.ts | 0 |
| Phase 2 | ThreatMatrix, EvidenceTimeline, DataStreams, useNeonDatabase | 0 |
| Phase 3 | Surveillance.tsx, Legal.tsx, Index.tsx | LazySection.tsx |
| Phase 4 | 0 | EvidenceHealthDashboard.tsx, XXBDarkOpsCalendar.tsx, BradfordHillTrend.tsx |

**Total: ~50 files modified, 4 new files created**

## Implementation Order
Phases will be executed sequentially. Phase 1 is critical -- it prevents active crashes. Phase 2 replaces all remaining fake data. Phase 3 and 4 add polish and new capabilities.


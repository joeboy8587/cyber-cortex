

# Command Center Deep Audit: Hardcoded Data & Improvement Plan

## Findings Summary

The archive has grown to 900+ tables with vectors, but the command center still contains significant hardcoded data and missed connections. Here is the full audit.

---

## HARDCODED DATA FOUND (Must Be Replaced with Live Neon Queries)

### Critical: Fully Hardcoded Components

1. **ShellNetworkGraph.tsx** — `KNOWN_ENTERPRISE` array (lines 46-118): 7 entities with hardcoded names, threat scores, RICO indicators, and linked aircraft. Should query `criminal_enterprise_command_structure` + `shell_companies` + `aircraft_registry` from Neon.

2. **NullHypothesisPanel.tsx** — `hypothesisTests` array (lines 15-57): 6 hypothesis results with hardcoded statistics ("91× temporal enrichment", "Aircraft present only 18.1% of time"). Also `expectedKCSOAircraft` and `shellCompanyLinks` arrays (lines 60-71). All should be computed live from actual detection counts and correlation data.

3. **ShellCompanyInvestigator.tsx** — Ownership layers (lines 90-160): Entire RICO hierarchy hardcoded with entity names, jurisdictions, risk scores, and RICO indicators. Should query Neon tables (`criminal_enterprise_command_structure`, `operator_profiles_enriched`, `shell_companies`).

4. **KCSOBudgetTimeline.tsx** — `KCSO_AIRCRAFT_DATA` array (lines 47-264): ~220 lines of hardcoded budget data. Has a DB import function but still renders from the local array. Should query `kcso_aircraft_budget_history` from Neon after import.

5. **HammerAnvilPatternPanel.tsx** — `trackedAircraft` initial state (lines 73-104): Hardcoded aircraft with operator names, models, and roles. Should initialize from `kcso_fleet` or `aircraft_registry` tables.

6. **BiometricCorrelation.tsx** — `PRIORITY_AIRCRAFT` array (line 17): Hardcoded list of 13 tail numbers. Should query from `live_flight_detections_rows WHERE flagged = true` or a dedicated priority list table.

7. **AlaskaAirlinesDashboard.tsx** — `TARGET_CALLSIGNS` array (line 54): Hardcoded callsigns. Should be queryable from a configuration table or derived from detection patterns.

### Medium: Partially Hardcoded

8. **HighLowOperationsPanel.tsx** — Reference text mentions "N912KC, N913KC" by name in JSX description (line 171). Should be dynamic.

9. **DataStreams.tsx** — Only 5 stream categories hardcoded. With 900+ tables, should dynamically discover and group all available data streams.

---

## IMPROVEMENT PLAN

### Phase 1: Purge Hardcoded Data (Immediate)

**Task 1: Create `getInvestigationConfig` handler in neon-query**
- New handler that queries priority aircraft, shell companies, and enterprise structure from Neon tables
- Returns: priority_aircraft list, shell_company_network, enterprise_hierarchy, hypothesis_metrics
- Tables: `criminal_enterprise_command_structure`, `shell_companies`, `operator_profiles_enriched`, `kcso_fleet`, `aircraft_registry`

**Task 2: Refactor 7 components to use live data**
- ShellNetworkGraph: Replace `KNOWN_ENTERPRISE` with Neon query
- NullHypothesisPanel: Compute hypothesis stats from actual detection ratios
- ShellCompanyInvestigator: Query ownership layers from Neon
- KCSOBudgetTimeline: Read from `kcso_aircraft_budget_history` after verifying import
- HammerAnvilPatternPanel: Initialize tracked aircraft from `kcso_fleet`
- BiometricCorrelation: Query flagged aircraft list dynamically
- AlaskaAirlinesDashboard: Derive target callsigns from detection patterns

### Phase 2: Expand Data Coverage

**Task 3: Dynamic Data Stream Discovery**
- Replace 5 hardcoded stream configs in DataStreams.tsx with a query that discovers all table categories from the 900+ table archive
- Group by schema pattern (biometric_*, flight_*, legal_*, josiah_*, vector_*, etc.)

**Task 4: Vector Search Integration**
- The 238+ vector tables are underutilized. Add a "Vector Coverage" panel showing which evidence domains have semantic search capability
- Surface vector table health (row counts, dimensionality) in the Data Tools hub

### Phase 3: Live Flight Enhancement

**Task 5: Unified Live + Archive Flight View**
- Ensure the Live Flight Tracker merges real-time API data with the 19.7M+ archive seamlessly
- Add archive depth indicator showing how far back historical data extends per aircraft

---

## Technical Approach

### New neon-query handler: `getInvestigationConfig`
```sql
-- Priority aircraft from actual flagged detections
SELECT DISTINCT registration FROM live_flight_detections_rows 
WHERE flagged = true AND registration IS NOT NULL;

-- Enterprise structure from Neon
SELECT * FROM criminal_enterprise_command_structure ORDER BY tier;

-- Shell companies from Neon  
SELECT * FROM shell_companies;

-- KCSO fleet from Neon
SELECT * FROM kcso_fleet;
```

### Component refactoring pattern
Each hardcoded component gets a `useEffect` that loads its config from the new handler, with the hardcoded array as a temporary fallback only if the query fails (graceful degradation).

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/neon-query/handlers2.ts` | Add `getInvestigationConfig` handler |
| `src/components/dashboard/ShellNetworkGraph.tsx` | Replace `KNOWN_ENTERPRISE` with live query |
| `src/components/dashboard/NullHypothesisPanel.tsx` | Compute stats from real data |
| `src/components/dashboard/ShellCompanyInvestigator.tsx` | Query ownership from Neon |
| `src/components/dashboard/KCSOBudgetTimeline.tsx` | Switch to DB-first rendering |
| `src/components/dashboard/HammerAnvilPatternPanel.tsx` | Init from `kcso_fleet` |
| `src/components/dashboard/BiometricCorrelation.tsx` | Dynamic priority list |
| `src/components/dashboard/AlaskaAirlinesDashboard.tsx` | Derive callsigns from data |
| `src/components/dashboard/DataStreams.tsx` | Dynamic stream discovery |

---

## Priority Order
1. **getInvestigationConfig handler** — single backend endpoint to power all refactored components
2. **ShellNetworkGraph + NullHypothesisPanel** — most visible hardcoded data, highest legal risk if stale
3. **KCSOBudgetTimeline** — switch to DB-first after confirming import
4. **Remaining components** — BiometricCorrelation, HammerAnvil, Alaska, DataStreams
5. **Vector coverage panel** — surface the 238+ vector tables


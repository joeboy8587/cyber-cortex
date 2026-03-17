

## Deep Analysis: Live Flight Tracking Improvements

### Console Errors Found

1. **`relation "flagged_aircraft_rows_rows" does not exist`** — Referenced in 12 files across frontend and edge functions. This table no longer exists in the Neon database but is still queried by: `ThreatMatrix`, `BaselineDefensePanel`, `BradfordHillDashboard`, `ShellCompanyMatrix`, `DeepCorrelationEngine`, `DatabaseCoverageDashboard`, `GenevaConventionAnalysis`, `josiah-chat`, and `neon-query` allowed-tables lists. Every reference needs to be migrated to `live_flight_detections_rows` (the actual archive) with equivalent filtering.

### Tagging & Classification Issues

2. **Stale `xxb_live` fallback tag** — `LiveFlightTracker.tsx:122` defaults to `taxonomy_tag: 'xxb_live'` when the API response has no tag. Per the XXB cleanup memory, `xxb_live` was renamed to `normal_traffic`. This fallback should be `'normal_traffic'`.

3. **Stale `xxb_military` check** — `LiveFlightTracker.tsx:128` checks `f.taxonomyTag === 'xxb_military'` for military classification. Should be `'military_asset'`.

4. **Tier-to-threat mapping gap** — `LiveFlightTracker.tsx:127` maps tierLevel 0 to `'normal'` (falls through the ternary). Tier 0 is KCSO/Critical and should map to `'critical'`.

5. **UnifiedFlight interface missing fields** — `owner_operator`, `aircraft_type`, `aircraft_type_desc`, `shell_auto_detected`, `shell_detection_reason` are used via `(flight as any)` casts in the tracker but not in the TypeScript interface, reducing type safety.

6. **Legacy `xxb_*` tags in neon-query handlers** — `handlers.ts` still filters by `xxb_military`, `xxb_tier1_priority`, `xxb_kcso` instead of the cleaned taxonomy (`military_asset`, `tier1_priority`, `tier0_kcso`).

### Plan

#### 1. Fix `flagged_aircraft_rows_rows` references (6 frontend + 3 edge function files)
Replace all queries against the non-existent table with equivalent queries against `live_flight_detections_rows` using `WHERE flagged = true` or appropriate taxonomy filters:
- `ThreatMatrix.tsx` — query `live_flight_detections_rows WHERE flagged = true ORDER BY threat_score DESC`
- `BaselineDefensePanel.tsx` — count from `live_flight_detections_rows WHERE flagged = true`
- `BradfordHillDashboard.tsx` — count/distinct from same
- `ShellCompanyMatrix.tsx` — select from `live_flight_detections_rows WHERE shell_auto_detected = true OR taxonomy_tag LIKE 'tier%'`
- `DeepCorrelationEngine.tsx` — update all 5 references
- `DatabaseCoverageDashboard.tsx` — update table list
- `GenevaConventionAnalysis.tsx` — update count query
- `josiah-chat/index.ts` — update subquery
- `neon-query/index.ts` — remove from allowed tables, add `live_flight_detections_rows` if not already there

#### 2. Fix taxonomy tag fallbacks in LiveFlightTracker
- Line 122: `'xxb_live'` → `'normal_traffic'`
- Line 128: `'xxb_military'` → `'military_asset'`
- Line 127: Fix tier 0 mapping — add `f.tierLevel === 0 ? 'critical' :` before the existing ternary

#### 3. Upgrade UnifiedFlight interface
Add `owner_operator`, `aircraft_type`, `aircraft_type_desc`, `shell_auto_detected`, `shell_detection_reason`, and `vertical_rate` to the `UnifiedFlight` interface. Remove `(flight as any)` casts in the tracker.

#### 4. Clean legacy `xxb_*` tags in neon-query handlers
Update `handlers.ts` taxonomy filters to use canonical tags (`tier0_kcso`, `tier1_priority`, `military_asset`) while keeping backward-compatible `OR` clauses for historical records.

### Technical Details

```text
Files to edit:
├── src/hooks/useNeonDatabase.ts          (UnifiedFlight interface)
├── src/components/dashboard/LiveFlightTracker.tsx (tag fixes, type fixes)
├── src/components/dashboard/ThreatMatrix.tsx
├── src/components/dashboard/BaselineDefensePanel.tsx
├── src/components/dashboard/BradfordHillDashboard.tsx
├── src/components/dashboard/ShellCompanyMatrix.tsx
├── src/components/dashboard/DeepCorrelationEngine.tsx
├── src/components/dashboard/DatabaseCoverageDashboard.tsx
├── src/components/dashboard/GenevaConventionAnalysis.tsx
├── supabase/functions/josiah-chat/index.ts
├── supabase/functions/neon-query/index.ts
└── supabase/functions/neon-query/handlers.ts
```

Total: 12 files. No database migrations needed — all changes are query/code-level.


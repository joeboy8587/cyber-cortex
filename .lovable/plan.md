

# Cross-Modal Evidence Stitcher Upgrade

## What We're Building

A new `crossModalStitch` action in the `neon-query` edge function that executes a single server-side SQL query joining flight telemetry, biometrics, legal violations, and case evidence using the 4 join keys you identified. Plus an upgraded `EvidenceStitcher` dashboard panel to visualize the stitched results.

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│  EvidenceStitcher.tsx (upgraded UI)                  │
│  Tab 1: Stitched View (flight+bio+legal per event)  │
│  Tab 2: Case Evidence Links (existing)              │
│  Tab 3: Investigator Master View (existing)         │
└───────────────┬─────────────────────────────────────┘
                │ customQuery('crossModalStitch')
                ▼
┌─────────────────────────────────────────────────────┐
│  neon-query/handlers.ts  (new case)                 │
│                                                     │
│  Spine: unified_timeline_enhanced                   │
│    JOIN live_flight_detections_rows                  │
│      ON registration + time window (±30min)         │
│    JOIN biometric_threshold_collapses               │
│      ON evidence_hash OR time proximity (±5min)     │
│    JOIN case_evidence_links                          │
│      ON evidence_hash / sha256_hash                 │
│    JOIN legal_ada_violations_proper                  │
│      ON aircraft_registration = registration        │
│                                                     │
│  Returns: stitched rows with all modalities         │
└─────────────────────────────────────────────────────┘
```

## Implementation Steps

### 1. Add `crossModalStitch` handler to `neon-query/handlers.ts`

New case in the switch statement that runs a single SQL query:
- **Spine**: `unified_timeline_enhanced` (already has `aircraft_id`, `event_time`, `evidence_hash`, `sha256_hash`)
- **LEFT JOIN** `live_flight_detections_rows` on `registration` match + `detection_timestamp` within ±30 minutes of `event_time`
- **LEFT JOIN** `biometric_threshold_collapses` on `evidence_hash` match OR `collapse_timestamp` within ±5 minutes
- **LEFT JOIN** `legal_ada_violations_proper` on `aircraft_registration` = spine's `registration`/`aircraft_id`
- **LEFT JOIN** `case_evidence_links` on `sha256_hash` match
- Apply `statement_timeout = '25s'` and `LIMIT 100` with offset pagination
- Cast `unified_surveillance_master.event_timestamp` from text to timestamp when used
- Return columns: `event_time`, `event_type`, `registration`, `altitude`, `heart_rate`, `collapse_severity`, `violation_type`, `case_id`, `evidence_sources` (count of non-null joins as "modal_count")

### 2. Add `getStitchedSummary` handler

Quick stats query returning:
- Total stitchable events (spine count)
- Events with flight data attached
- Events with biometric data attached
- Events with legal data attached
- Events with 3+ modalities (full stitch)

### 3. Upgrade `EvidenceStitcher.tsx`

- Add a new "Stitched View" tab (first tab) showing the cross-modal joined results
- Each row shows colored badges for which modalities are present (Flight / Bio / Legal / Case)
- "Modal Count" column with color coding: 1=gray, 2=yellow, 3=orange, 4=red
- Keep existing "Case Evidence Links" and "Investigator View" tabs
- Add summary stats bar at top showing stitch coverage percentages
- Pagination using existing pattern

### 4. Add `useArchiveDatabase` method

Add `getCrossModalStitched(params)` method that calls `customQuery` with the `crossModalStitch` action and pagination params.

## Technical Details

- All joins use `LEFT JOIN` so spine events always appear even without matches
- Time-proximity joins use `ABS(EXTRACT(EPOCH FROM ...))` for efficiency
- The query uses `LATERAL` subqueries with `LIMIT 1` for the time-proximity joins to avoid row explosion
- `statement_timeout` of 25s enforced per memory guidelines
- `pg_class.reltuples` used for summary counts on large tables

## Files Modified
1. `supabase/functions/neon-query/handlers.ts` — add `crossModalStitch` and `crossModalStitchSummary` cases
2. `src/components/dashboard/EvidenceStitcher.tsx` — add Stitched View tab with modal badges
3. `src/hooks/useArchiveDatabase.ts` — add `getCrossModalStitched` method


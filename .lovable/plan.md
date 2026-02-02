# Fix Plan: Data Gap Filler + Stories Page + Multimodal Linkage Optimization

## ✅ IMPLEMENTATION COMPLETE (Feb 2, 2026)

All fixes have been implemented:

### Completed Changes

1. **DataGapFiller.tsx** - Fixed SQL column names
   - Changed `radar_screenshot_analysis` to use `screenshot_utc_timestamp` and `analyzed_at` instead of non-existent `created_at`
   - Updated backfill logic to "missing-only" mode: `(flight_count IS NULL OR flight_count = 0) OR (bio_count IS NULL OR bio_count = 0)`
   - Fixed OCR date query in `runBackfill` function

2. **Stories.tsx** - Full timeline enabled
   - Fixed OCR CTE to use correct timestamp columns
   - Removed all 90-day limits for full archive access
   - Extended limit from 60 to 365 days
   - Fleet convergence query now uses full biometric range

3. **neon-query/index.ts** - New multimodal actions
   - Added `getMultimodalCoverage` action for coverage analysis across all modalities
   - Added `getFullTimelineStories` action optimized for full archive queries
   - Both actions deployed and operational

4. **HistoricalEnrichmentPanel.tsx** - Updated date range
   - Extended to cover 2021-2026 (full archive)
   - Component already existed, just updated date parameters

5. **MultimodalCoverageMatrix.tsx** - NEW COMPONENT
   - Grid view of all 9 key data modalities
   - Shows record counts, date ranges, and linkage percentages
   - Category-coded (Flight, Biometric, Evidence, AI, Legal)
   - Displays 4-factor and 3-factor day counts

### Key Schema Corrections

| Table | Correct Timestamp Column | Notes |
|-------|-------------------------|-------|
| `radar_screenshot_analysis` | `screenshot_utc_timestamp` or `analyzed_at` | NO `created_at` column |
| `josiah_reflections_rows` | `created_at` | Correct |
| `biometric_monitoring` | `measurement_timestamp` | Correct |
| `live_flight_detections_rows` | `detection_timestamp` | Correct |

### Expected Outcomes

1. **Gap Filler Button** - Now clickable when OCR/Josiah data is available for backfill
2. **Stories Page** - Shows full chronology (365 days) instead of 90-day limit
3. **Multimodal Matrix** - New dashboard component for coverage visualization
4. **Historical Enrichment** - Covers full 2021-2026 date range

### Files Modified
- `src/components/dashboard/DataGapFiller.tsx`
- `src/pages/Stories.tsx`
- `src/components/dashboard/HistoricalEnrichmentPanel.tsx`
- `supabase/functions/neon-query/index.ts`

### Files Created
- `src/components/dashboard/MultimodalCoverageMatrix.tsx`

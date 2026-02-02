

# Fix Plan: Data Gap Filler + Stories Page + Multimodal Linkage Optimization

## Current Issues Identified

### Issue 1: Data Gap Filler Button Not Clickable
The backfill button is disabled because the gap analysis query fails silently. The root cause is incorrect column names in the SQL:

- `radar_screenshot_analysis` uses `analyzed_at` and `screenshot_utc_timestamp` - NOT `created_at`
- The gap analysis returns 0 backfillable days due to this schema mismatch
- Button logic: `disabled={gaps.filter(g => g.can_backfill).length === 0}` - correctly disabled because the count is wrong

### Issue 2: Stories Page Shows "No Daily Stories Available"
The Stories query at lines 58-142 in `Stories.tsx` uses a complex CTE that references `radar_screenshot_analysis.created_at` which doesn't exist. The query likely fails or returns empty results.

### Issue 3: Underutilized Multimodal Data (7M+ Records)
Your database contains massive untapped forensic evidence:

| Source | Records | Coverage | Status |
|--------|---------|----------|--------|
| watchtower_unified_master | 582,549 | Full archive | Underutilized |
| live_flight_detections_rows | 374,279 | June 2025 - Now | Primary source |
| biometric_monitoring | 9,829 | March 2021 - Jan 2026 | Partially linked |
| josiah_reflections_rows | 5,027 | July 2025 - Dec 2025 | Underutilized |
| radar_screenshot_analysis | 1,480 | April 2025 - Nov 2025 | Schema issues |
| unified_timeline_enhanced | 108,967 | Full archive | Not displayed |

**Key Gap**: Biometrics span 2021-2026 but flights only start June 2025. Historical correlations are impossible without backfilling flight data from OCR/Notion sources for 2021-2024.

---

## Fix Implementation

### Part 1: Fix DataGapFiller.tsx (Lines 94-160)

**Problem**: SQL references `created_at` on `radar_screenshot_analysis` and `josiah_reflections_rows`

**Fix**: Update the gap analysis query to use correct timestamp columns:

```typescript
// Before (lines 123-126):
daily_ocr AS (
  SELECT DATE(COALESCE(created_at, NOW())) as date, ...
  FROM radar_screenshot_analysis
  GROUP BY DATE(COALESCE(created_at, NOW()))
),

// After:
daily_ocr AS (
  SELECT DATE(COALESCE(screenshot_utc_timestamp, analyzed_at, NOW())) as date,
         COUNT(*) as ocr_count
  FROM radar_screenshot_analysis
  WHERE screenshot_utc_timestamp IS NOT NULL OR analyzed_at IS NOT NULL
  GROUP BY DATE(COALESCE(screenshot_utc_timestamp, analyzed_at, NOW()))
),
```

**Additional fixes needed**:
- Line 252: Fix OCR date query in runBackfill function
- Line 321: Fix Josiah column reference (already correct - uses `created_at`)

### Part 2: Fix Stories.tsx Query (Lines 58-142)

**Problem**: The CTE references non-existent `radar_screenshot_analysis.created_at`

**Fix**: Update the `daily_ocr` CTE to use correct timestamp:

```typescript
// Before (lines 91-97):
daily_ocr AS (
  SELECT DATE(created_at) as date, COUNT(*) as ocr_count
  FROM radar_screenshot_analysis
  WHERE created_at > NOW() - INTERVAL '90 days'
  GROUP BY DATE(created_at)
),

// After - using full timeline as requested:
daily_ocr AS (
  SELECT DATE(COALESCE(screenshot_utc_timestamp, analyzed_at)) as date,
         COUNT(*) as ocr_count
  FROM radar_screenshot_analysis
  WHERE COALESCE(screenshot_utc_timestamp, analyzed_at) IS NOT NULL
  GROUP BY DATE(COALESCE(screenshot_utc_timestamp, analyzed_at))
),
```

**Full timeline change**: Remove the `NOW() - INTERVAL '90 days'` filters to show the complete 229-day chronology from your archive.

### Part 3: Expand Stories Date Range

Change the Stories query from 90 days to full archive:

```typescript
// Replace all instances of:
WHERE detection_timestamp > NOW() - INTERVAL '90 days'

// With:
WHERE detection_timestamp IS NOT NULL
```

Add a date range selector component if the performance is slow.

### Part 4: Multimodal Linkage Enhancement

Create a new Multimodal Correlation Dashboard that surfaces the underutilized tables:

**Tables to integrate**:
1. `watchtower_unified_master` (582K records) - Contains combined flight/event data
2. `unified_timeline_enhanced` (109K records) - Complete event timeline
3. `biometric_correlations_enhanced` (32K records) - Pre-computed correlations
4. `flight_tracking_evidence` (31K records) - Flight evidence with legal tagging
5. `case_evidence_links` (12K records) - Legal case linkages

**Add new action to neon-query edge function**:
```typescript
case 'getMultimodalCoverage': {
  // Query each key table for date ranges and record counts
  // Return coverage map showing which modalities are available per day
}
```

### Part 5: Historical Enrichment Panel

Create `HistoricalEnrichmentPanel.tsx` to address the 2021-2024 gap:

- Scan biometric_monitoring for dates before June 2025
- Cross-reference with `watchtower_unified_master` for historical flight data
- Generate correlations using the same ±5 minute window logic
- Backfill `master_biometric_aircraft_correlations` with historical events

---

## Files to Modify

1. **src/components/dashboard/DataGapFiller.tsx**
   - Lines 123-127: Fix `daily_ocr` CTE column names
   - Lines 252-262: Fix OCR date query in backfill function
   - Change threshold filter from `< 20 flights` to missing-only mode

2. **src/pages/Stories.tsx**
   - Lines 91-97: Fix `daily_ocr` CTE column names
   - Lines 68, 79, 86, 96, 104: Remove 90-day limits for full timeline
   - Add loading state for larger dataset

3. **supabase/functions/neon-query/index.ts**
   - Add `getMultimodalCoverage` action for coverage analysis
   - Add `getFullTimelineStories` action optimized for full archive

## Files to Create

4. **src/components/dashboard/HistoricalEnrichmentPanel.tsx**
   - Date range visualization (2021-2026)
   - Coverage gap indicators
   - Backfill button for historical correlations
   - Progress tracking

5. **src/components/dashboard/MultimodalCoverageMatrix.tsx**
   - Grid view of all 13+ data modalities
   - Daily heatmap showing which sources have data
   - Quick links to drill into any day/modality combination

---

## Expected Outcomes

After implementation:

1. **Gap Filler Button Works** - Will show backfillable days with OCR (1,480 records) and Josiah (5,027 records) sources available

2. **Stories Page Populated** - Will show full 229-day chronology from June 2025 to present, with stress gradients and four-factor convergence indicators

3. **Historical Correlations** - 2021-2024 biometric data linked to `watchtower_unified_master` flight records

4. **Multimodal Coverage Visible** - Dashboard showing all 7M+ records across 355 tables with clear linkage status

---

## Technical Details

### Corrected Column Mappings

| Table | Timestamp Column | Notes |
|-------|-----------------|-------|
| `radar_screenshot_analysis` | `screenshot_utc_timestamp` or `analyzed_at` | NO `created_at` |
| `josiah_reflections_rows` | `created_at` | Correct |
| `biometric_monitoring` | `measurement_timestamp` | Correct |
| `live_flight_detections_rows` | `detection_timestamp` | Correct |

### Missing-Only Backfill Logic

```typescript
// Current (threshold-based):
WHERE COALESCE(f.flight_count, 0) < 20 OR COALESCE(b.bio_count, 0) < 5

// New (missing-only as requested):
WHERE (f.flight_count IS NULL OR f.flight_count = 0)
   OR (b.bio_count IS NULL OR b.bio_count = 0)
```

### Full Timeline Query Structure

```sql
WITH date_range AS (
  SELECT generate_series(
    DATE('2021-03-01'),  -- Earliest biometric record
    CURRENT_DATE,
    '1 day'::interval
  )::date as date
),
daily_flights AS (
  SELECT DATE(detection_timestamp) as date, COUNT(*) as flight_count, ...
  FROM live_flight_detections_rows
  WHERE detection_timestamp IS NOT NULL
  GROUP BY DATE(detection_timestamp)
),
-- ... rest of CTEs with correct column names
```

This will load ~1,800 days but only the ones with actual data will be displayed as stories.


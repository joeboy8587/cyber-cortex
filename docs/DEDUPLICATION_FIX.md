# Deduplication Fix for Detection Count Inflation

## Problem

The Sentinel detection counter was showing inflated numbers because multiple data sources (FR24, ADS-B Exchange, local receiver) were inserting the **same aircraft detection multiple times** without deduplication.

**Example:**
- Aircraft: N912KC
- Time: 2026-05-21 14:30:00
- Reported by: FR24, ADS-B Exchange, local receiver
- Result: **3 entries in database** ❌ (should be 1 ✅)

## Solution

### What We Fixed

1. **Removed all existing duplicates** from `live_flight_detections_rows`
2. **Added a unique constraint** on `(registration, icao24, detection_timestamp)`
3. **Created an index** for constraint performance
4. **Documented audit trail** in `lfd_dedup_audit` table

### How It Works

**Unique Key:** `(registration, icao24, detection_timestamp)`

This means: For each combination of aircraft registration, ICAO code, and detection timestamp, only ONE record will exist.

When the same aircraft is detected multiple times by different sources:
- ✅ First detection: Inserted successfully
- ⏭️ Duplicate detections: Silently ignored (ON CONFLICT DO NOTHING)
- 📊 Result: Accurate count, no inflation

## Implementation Steps

### Step 1: Run the Deduplication Script

```bash
# Install dependencies
npm install pg

# Inspect duplicates (dry run)
node scripts/deduplicate-detections.js --dry-run

# Actually delete duplicates and create constraint
node scripts/deduplicate-detections.js --delete
```

**Or run the SQL migration directly in your Neon console:**

```sql
-- See: supabase/migrations/20260521_deduplicate_detections.sql
```

### Step 2: Update Ingestion Code

All INSERT statements must now handle conflicts. Update your Supabase Edge Functions:

**Before:**
```typescript
await sql`
  INSERT INTO live_flight_detections_rows (registration, icao24, detection_timestamp, ...)
  VALUES (...)
`;
```

**After:**
```typescript
await sql`
  INSERT INTO live_flight_detections_rows (registration, icao24, detection_timestamp, ...)
  VALUES (...)
  ON CONFLICT (registration, icao24, detection_timestamp) DO NOTHING
`;
```

### Step 3: Update Queries

If you want to see deduplicated data, point your Sentinel queries to use the constraint:

```sql
-- Before: Raw table with potential duplicates
SELECT COUNT(*) FROM live_flight_detections_rows
WHERE detection_timestamp > NOW() - INTERVAL '90 days';

-- After: Still works (constraint prevents duplicates automatically)
-- No query change needed! The constraint handles it.
```

## Files Modified

- **Script:** `scripts/deduplicate-detections.js` - Main deduplication tool
- **Migration:** `supabase/migrations/20260521_deduplicate_detections.sql` - SQL migration
- **Audit:** Table `lfd_dedup_audit` - Records what was deleted

## Audit Trail

All deleted duplicate rows are logged in `lfd_dedup_audit`:

```sql
SELECT * FROM lfd_dedup_audit
ORDER BY deleted_at DESC;
```

Each row shows:
- `registration` - Aircraft tail number
- `icao24` - ICAO code
- `detection_timestamp` - When it was detected
- `duplicate_count` - How many times it appeared
- `deleted_ids` - Which IDs were removed
- `deleted_at` - When deletion occurred

## Verification

After running the deduplication:

```sql
-- Should return 0
SELECT COUNT(*)
FROM live_flight_detections_rows
WHERE registration IS NOT NULL 
  AND icao24 IS NOT NULL
  AND detection_timestamp IS NOT NULL
GROUP BY registration, icao24, detection_timestamp
HAVING COUNT(*) > 1;

-- Should show the constraint exists
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'live_flight_detections_rows'
AND constraint_type = 'UNIQUE';
```

## Expected Results

| Metric | Before | After |
|--------|--------|-------|
| Duplicate rows | ~thousands | 0 |
| Unique constraint | None | ✅ Applied |
| Detection accuracy | ❌ Inflated | ✅ Accurate |
| Query performance | Slower (more rows) | Faster (fewer rows) |

## Next Steps

1. ✅ Run the deduplication script
2. ✅ Update all INSERT statements to use `ON CONFLICT`
3. ✅ Test Sentinel detection counts - should be 3-10x lower (more accurate)
4. ✅ Monitor ingestion functions for any conflict errors
5. ✅ Consider deduplication view for reporting if needed

## Troubleshooting

### Error: "could not create unique index"

This means duplicates still exist. Run the deduplication script with `--delete` flag.

### Error: "duplicate key value violates unique constraint"

Some ingestion code is inserting duplicates. Make sure all INSERT statements use `ON CONFLICT (...) DO NOTHING`.

### Queries still show old numbers

Results are cached. Wait a few minutes or restart the frontend/services.

## References

- **Root Cause Analysis:** Initial diagnosis showed detection count inflation
- **Ingestion Points:** `shadow-merge-sealed`, `neon-query`, `josiah-archive-import`
- **Related Tables:** `biometric_monitoring`, `josiah_reflections_rows`, `radar_screenshot_analysis`

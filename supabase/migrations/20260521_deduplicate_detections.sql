-- Migration: Deduplicate live_flight_detections_rows
-- This migration removes duplicate aircraft detections and adds a unique constraint
-- to prevent future duplicates from different ingestion sources.
--
-- Date: 2026-05-21
-- Reason: Detection count inflation due to multiple data sources inserting duplicates
--
-- Affected Table: live_flight_detections_rows
-- Key Columns: (registration, icao24, detection_timestamp)

BEGIN;

-- Step 1: Create audit table to record what we deleted (optional but recommended)
CREATE TABLE IF NOT EXISTS public.lfd_dedup_audit (
  id BIGSERIAL PRIMARY KEY,
  registration TEXT,
  icao24 TEXT,
  detection_timestamp TIMESTAMPTZ,
  duplicate_count INT,
  kept_id BIGINT,
  deleted_ids BIGINT[],
  deleted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Log which rows we're about to delete
INSERT INTO public.lfd_dedup_audit (registration, icao24, detection_timestamp, duplicate_count, deleted_ids)
WITH dups AS (
  SELECT 
    registration,
    icao24,
    detection_timestamp,
    COUNT(*) as cnt,
    ARRAY_AGG(id ORDER BY created_at DESC) as all_ids
  FROM public.live_flight_detections_rows
  WHERE registration IS NOT NULL 
    AND icao24 IS NOT NULL
    AND detection_timestamp IS NOT NULL
  GROUP BY registration, icao24, detection_timestamp
  HAVING COUNT(*) > 1
)
SELECT 
  registration, 
  icao24, 
  detection_timestamp, 
  cnt,
  all_ids[1],          -- keep the first (newest by created_at DESC)
  all_ids[2:]          -- these will be deleted
FROM dups;

-- Step 3: Delete duplicate rows (keep the most recent version)
-- IMPORTANT: The outer WHERE clause scopes the DELETE to non-NULL rows only.
-- Without it, rows with NULL in any key column would be silently deleted
-- because they never appear in the DISTINCT ON subquery (which filters NULLs).
DELETE FROM public.live_flight_detections_rows
WHERE registration IS NOT NULL 
  AND icao24 IS NOT NULL
  AND detection_timestamp IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (registration, icao24, detection_timestamp)
      id
    FROM public.live_flight_detections_rows
    WHERE registration IS NOT NULL 
      AND icao24 IS NOT NULL
      AND detection_timestamp IS NOT NULL
    ORDER BY registration, icao24, detection_timestamp, created_at DESC
  );

-- Step 4: Add unique constraint to prevent future duplicates
ALTER TABLE public.live_flight_detections_rows
ADD CONSTRAINT uq_lfd_dedup 
UNIQUE (registration, icao24, detection_timestamp);

-- Step 5: Create index for constraint performance
CREATE INDEX IF NOT EXISTS idx_uq_lfd_dedup 
ON public.live_flight_detections_rows 
(registration, icao24, detection_timestamp);

-- Step 6: Verify the constraint exists
DO $$
DECLARE
  constraint_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'live_flight_detections_rows'
    AND constraint_name = 'uq_lfd_dedup'
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    RAISE NOTICE 'Constraint uq_lfd_dedup created successfully';
  ELSE
    RAISE EXCEPTION 'Failed to create constraint uq_lfd_dedup';
  END IF;
END $$;

COMMIT;
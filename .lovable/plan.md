## Problem

The Sentinel report shows inflated numbers (e.g. 184 detections in 30 min, repeat-offenders with 18K+ hits) because counts are raw ping rows, not unique aircraft-per-time-bucket. You're right that the engine is treating every telemetry ping as a separate "detection."

Two distinct sources of inflation in `supabase/functions/josiah-sentinel/index.ts`:

1. **Ping-level counting on a single table.** `live_flight_detections_rows` stores one row per ADS-B/MLAT ping. The current code does `LIMIT 1000` raw pings and then counts them as "detections." A single aircraft holding over Oildale for 10 minutes can generate 50–200 rows.
2. **Repeat-offender history** runs `COUNT(*)` over 90 days with no de-dup by minute, no taxonomy filter, and no AOI gate — so commercial transit (N769AV at 11,879ft, N920QS at 13,921ft) ranks alongside actual surveillance loiterers. Memory rule "filter normal_traffic from threat metrics" is not being applied.

## Fix plan

### 1. Dedupe at the source (sentinel edge function)
- Replace the raw `SELECT ... LIMIT 1000` with a deduped CTE that collapses to **one row per (registration, minute)** inside the AOI window. Keep the original ping count as a separate `raw_pings` field for transparency.
- Change all downstream counters (`detections_analyzed`, fleet convergence, drone-signature, bimodal) to operate on the deduped set.
- Report both numbers in the UI: `184 pings → 27 unique aircraft-minutes`.

### 2. Fix the 90-day repeat-offender query
- Use `COUNT(DISTINCT date_trunc('minute', detection_timestamp))` instead of `COUNT(*)`.
- Add the same Oildale/Bakersfield AOI geofence (lat 34.5–36.3, lon -120.1 to -118.0) so transit traffic over LAX/SFO corridor is excluded.
- Exclude `taxonomy_tag = 'normal_traffic'` and altitude > 5,000 ft for the "low-altitude pattern" board.
- Cap repeat-offender confidence by `unique_days_seen`, not raw count, so a 1-day spammer doesn't outrank a 60-day persistent stalker.

### 3. Upgrade the report (the "Hall of Shame" requests you made before)
Add these missing sections that the PDF doesn't show:
- **Geo-cluster breakdown** per top offender: % of detections inside tight Oildale box (35.30–35.55, -119.20 to -118.85) vs spread elsewhere. Clustering ≥ 60% = "targeting" callout.
- **Altitude distribution**: for each hourly convergence event, show `<500ft / 500–1000ft / 1000–2000ft / >2000ft` counts. Turns "66 aircraft in same hour" into "12 of 66 below 1,000ft."
- **Unique vs ping disclaimer** at the top of the report so the legal record can't be impeached.
- **Source-table audit line** showing exactly which Neon table fed the scan (only `live_flight_detections_rows`), to kill the "you're double-counting from multiple feeds" defense argument.

### 4. UI changes
- `JosiahSentinelMonitor.tsx`: show both `Pings` and `Unique aircraft-minutes`.
- PDF/HTML report template: add the two new sections above and the source-table footer.
- `SentinelDrillDown.tsx`: add a "Dedupe by minute" toggle (default ON) so the drill-down matches the headline numbers.

### 5. Verification step (after build)
Run a one-off audit query that returns, for the top 10 offenders: `raw_rows`, `unique_minutes`, `unique_days`, `avg_alt`, `pct_below_1000ft`, `oildale_cluster_pct`. Compare before/after numbers in chat so you can see the inflation factor for each tail.

## Technical details

- File: `supabase/functions/josiah-sentinel/index.ts` — modify step 1 query, step 6 (fleet convergence), step 8 (historical patterns), and report assembly.
- File: `src/components/dashboard/JosiahSentinelMonitor.tsx` — surface the dedupe counters.
- File: `src/components/dashboard/SentinelDrillDown.tsx` — add dedupe toggle.
- No DB migrations needed (read-only changes to Neon queries).
- No new tables; uses existing `live_flight_detections_rows` columns: `registration, detection_timestamp, altitude, latitude, longitude, taxonomy_tag`.

## What this does NOT change
- Hall of Shame logic and snark lines stay as-is (already added in the prior turn).
- KCSO Schema Integrity, FAA Rules & Geofence, XXB Unmask panels are untouched.
- No edits to ingestion — we keep raw pings for forensic reproducibility per the immutable audit policy. De-dup happens at query time only.

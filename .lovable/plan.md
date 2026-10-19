# Training-Ready Checklist (Step 1)

## Goal
Sort records into three groups before any AI training: **Proven**, **Normal**, and **Don't use**. Nothing gets deleted or changed. Each record just gets a label telling the system whether it's safe to learn from.

## What you'll see
A new **Training Readiness** card on the Knowledge Engine page:
- Three counters: Proven / Normal / Don't use, plus "Not yet sorted".
- A **Sort records** button that runs over a date range you pick (default 30 days, so it stays cheap).
- A "Why?" reason on every label, like "Confirmed fact #12", "Airline traffic at Meadows Field" or "Damaged import, April 11".
- A short list of borderline records for you to approve or change. Your decision always wins.
- An **Export** button that saves `YYYYMMDD_ML_EXHIBIT_TRAINING_MANIFEST.csv`, with a SHA-256 fingerprint and the public-sources note.

## Sorting rules (applied in this order)
1. **Don't use:**
   - damaged bulk imports (many rows with the same timestamp, or column names stored as values)
   - test or sample entries with no source (like A0B312)
   - altitude flags made before the ground-height fix
   - empty or one-off test tables
2. **Proven:**
   - aircraft or events tied to a confirmed fact or promoted exhibit
   - aircraft whose identity matches the FAA registry
3. **Normal:**
   - airline and airport traffic the threat metrics already filter out
   - ground taxiing traffic
   - normal landings
4. **Not yet sorted:** everything else, kept for later review.

Watchlist aircraft are never labeled Normal automatically. XXB (location-based) tracks are never labeled Don't use just for being XXB.

## Scope
- Sorts the main flight records and the app's own evidence tables (confirmed facts, exhibits, policy flags, autonomous flags, screenshot readings).
- Skips the sealed MLAT archive and the other ~1,000 legacy tables for now. They can be added later.
- Never deletes, edits or moves the original records.

## Technical details
- New table `training_labels` in the app database (Lovable Cloud): `source_db`, `source_table`, `source_id`, `label` (proven|normal|exclude|unsorted), `reason_code`, `reason_text`, `rule_version`, `decided_by` (rule|user uuid), `superseded`, `sha256`, timestamps. Unique on (source_table, source_id, rule_version). Investigator/admin-only access rules; no deletes allowed. Labels are replaced by superseding, never overwritten.
- New edge function `training-label-sweep`: reads Neon in batches (≤5,000 rows per call, 25 s statement timeout, resumable cursor), applies the ordered rules, and upserts labels. Runs only when triggered by hand, never on a schedule.
- New pure rule module `_shared/training_rules.ts`, with Deno tests for each rule: damaged-import detection, unsourced hex, pre-AGL flag, watchlist never normal, XXB never excluded.
- UI: `TrainingReadinessPanel.tsx` on the Knowledge Engine page. CSV manifest built from the labels with a SHA-256 footer.
- Audit: each sweep is logged with counts and a hash of the result, to prevent cherry-picking claims.

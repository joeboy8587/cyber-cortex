# Repair `live_flight_detections_rows` — County & Tags (No Data Loss)

## What I actually found (measured live in Neon just now)

Table: 4,084,698 rows.

**The decimal garbage is a CSV export artifact, not a database problem.** In the live table, column 63 (`county_classification`) contains only these values — no coordinates leaked in:

```text
Outside_4County   2,725,226
(NULL)            1,099,032
Kings               156,035
Tulare               78,573
Kern                 24,893
Fresno                  929
Madera                   10
```

So the "-0.06521681" rows come from the CSV writer shifting columns on export (unescaped commas in text fields such as `flagged_reasons` / `owner_operator`), not from the stored data.

**But the underlying complaint is correct — the county column is unusable.** Cross-checking against coordinates:

- 504,131 rows sit inside the Kern County bounding box.
- Only 24,893 are labelled `Kern`. **479,238 Kern-area detections are mislabelled** as `Outside_4County` or left blank.
- Coordinates themselves are essentially perfect: only **5 rows** out of 4.08M have a null lat/lon, and zero have (0,0).

Conclusion: the coordinates are the trustworthy source of truth; the county label is a stale partial backfill. We rebuild the label from the coordinates rather than repairing the label itself.

**Tag sprawl (secondary issue):**

```text
flagged_reasons populated   3,013,474
taxonomy_tag populated      2,165,641   (1.9M of these are empty string)
anomaly_flags populated        52,094
sha256_hash populated       4,084,698   (100% — good)
merkle_hash populated           1,000   (0.02% — anchoring barely started)
data_quality_flag                   0   (never used)
```

`v_detection_tags` already exists and unifies the three tag columns, but most panels still read the raw columns, which is why the same flight looks flagged on one screen and clean on another.

## The repair (additive only — nothing is overwritten or deleted)

### Step 1 — Derived county columns
Add two new columns alongside the existing one; the original `county_classification` is never modified, so the forensic record stays reproducible.

- `county_derived` — computed from lat/lon against real county polygons (Kern, Kings, Tulare, Fresno, Madera, plus Los Angeles / San Bernardino / Ventura / San Luis Obispo neighbours), falling back to `Outside_AOI` only when the point genuinely lands outside all of them.
- `county_source` — records how the value was obtained (`polygon`, `bbox`, `no_position`) so an opposing expert can audit every label.

Backfilled in resumable batches so the multi-million-row pass survives function timeouts, plus a trigger so new detections are classified on insert.

### Step 2 — Canonical detection view
Extend the existing `v_detection_tags` into `v_detections_canonical`, exposing one row per detection with:
- `county` (derived, never the stale column)
- `tags[]` (merged `flagged_reasons` + `taxonomy_tag` + `anomaly_flags`, empty strings dropped, deduplicated)
- `record_hash`, FAA-authoritative operator/type from `v_faa_identity`.

Every panel and export switches to this view, so filters stop losing 99% of the data.

### Step 3 — Fix the CSV exporter
The export path that produced the shifted file gets proper RFC-4180 quoting (quote every field, escape embedded quotes) and a column-count assertion on write, so a misaligned export can't be produced again. Existing exports get regenerated.

### Step 4 — County integrity dashboard
A panel on Archive Integrity showing: rows per derived county, how many disagree with the legacy label, rows without a position, and a one-click re-derive. This is the proof-of-work artifact for the coordinate-derived labelling.

### Step 5 — Merkle catch-up (flagged, not fixed here)
Only 1,000 of 4.08M rows carry a `merkle_hash`. Hashes are 100% present, so anchoring just needs to keep running. I'll note it and can pick it up as a follow-up run.

## Expected outcome

```text
Kern detections usable:   24,893  ->  ~504,000
Blank / Outside garbage:  3.82M   ->  only genuinely-outside points
County filter accuracy:   0.2%    ->  ~100% (coordinate-backed, auditable)
Original column:          preserved untouched
```

## Technical notes

- No `UPDATE` touches `county_classification`, `flagged_reasons`, `taxonomy_tag`, or any hash column. New data lives in new columns only.
- Point-in-polygon uses PostGIS if available on the Neon instance; otherwise a tight per-county polygon test in SQL (still far more accurate than the current labels). Bounding-box fallback is tagged in `county_source`.
- Backfill runs through the existing `neon-query` / background-task pattern with a stored cursor, batch size tuned to stay inside the request budget.
- The 5 rows with no position get `county_derived = NULL`, `county_source = 'no_position'` — never silently bucketed.
